/**
 * Push a posted Receipt Note into a Zoho CRM custom module.
 *
 * Enabled only when ZOHO_RECEIPT_MODULE is the module API name.
 * Logistics stays in AssetEngine: post fetches the receipt's Purchase Order
 * from Zoho (its number is the Outbound PO Number) and creates one record.
 *
 * Module API name: Receipt_Notes.
 * India DC only (accounts.zoho.in, ZohoCRM.modules.ALL). A .com token is INVALID_TOKEN.
 * Name is the record name and must equal Receipt_Note_Number (the Receipt ID).
 * Header: Outbound_PO (lookup to Purchase_Orders), Outbound_PO_Number (text),
 * Outbound_PO_Identifier (text), PO_Version_Number (number), Vendor_Name,
 * Vendor_Invoice_No, Delivery_Note_No, Received_At (YYYY-MM-DD),
 * Received_At_Location, Received_By, AssetEngine_Status.
 * Subform Receipt_Lines: Product (lookup to Products), Item_Description,
 * Ordered_Qty, Received_Qty, Qty_Accepted, Qty_Rejected, Qty_Damaged, Unit.
 * Outbound PO identifier, number, and version are the values stored on the
 * local mirror at pull time. The internal PPO- row id is never sent.
 */
const path = require('path');
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const { db } = require('../utils');
const zohoService = require('./zohoService');
const zohoProcurement = require('./zohoProcurementService');

require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

function moduleName() {
  return String(process.env.ZOHO_RECEIPT_MODULE || '').trim();
}

function isConfigured() {
  return moduleName().length > 0;
}

function httpError(message, statusCode, reasonCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.reasonCode = reasonCode;
  return err;
}

function qty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function put(record, key, value) {
  if (value == null || value === '') return;
  record.addKeyValue(key, value);
}

async function storedOutboundIdentity(note) {
  const empty = { outboundPoIdentifier: null, outboundPoNumber: null, poVersionNumber: null };
  if (!note || !note.po_id || !(await db.schema.hasTable('procurement_po'))) return empty;
  if (!(await db.schema.hasColumn('procurement_po', 'outbound_po_identifier'))) return empty;
  const row = await db('procurement_po').where({ id: note.po_id }).first();
  if (!row) return empty;
  const version = row.po_version_number != null && row.po_version_number !== ''
    ? Number(row.po_version_number)
    : null;
  return {
    outboundPoIdentifier: row.outbound_po_identifier || null,
    outboundPoNumber: row.outbound_po_number || null,
    poVersionNumber: Number.isFinite(version) ? version : null
  };
}

async function resolveZohoPoId(note) {
  if (note.zoho_po_id) return String(note.zoho_po_id);
  if (note.po_id && await db.schema.hasTable('procurement_po')) {
    const mirror = await db('procurement_po').where({ id: note.po_id }).first();
    if (mirror && mirror.zoho_po_id) return String(mirror.zoho_po_id);
  }
  return '';
}

function parseCreatedId(response) {
  if (response == null) throw httpError('Zoho returned no response', 502, 'ZOHO_EMPTY_RESPONSE');
  const status = response.getStatusCode && response.getStatusCode();
  const body = response.getObject();
  if (body instanceof ZOHOCRMSDK.Record.APIException) {
    throw httpError(String(body.getMessage && body.getMessage() || 'Zoho API exception'), status || 502, 'ZOHO_API_EXCEPTION');
  }
  if (body instanceof ZOHOCRMSDK.Record.ActionWrapper) {
    const action = (body.getData() || [])[0];
    if (action instanceof ZOHOCRMSDK.Record.SuccessResponse) {
      const details = action.getDetails();
      const rawId = details && typeof details.get === 'function' ? details.get('id') : null;
      const remoteId = rawId != null ? String(rawId) : '';
      if (!remoteId) throw httpError('Zoho create succeeded without a record id', 502, 'MALFORMED_RESPONSE');
      return remoteId;
    }
    if (action instanceof ZOHOCRMSDK.Record.APIException) {
      const message = typeof action.getMessage === 'function' ? action.getMessage() : 'Zoho rejected the receipt';
      throw httpError(String(message), status && status >= 400 ? status : 400, 'REMOTE_4XX');
    }
  }
  throw httpError('Zoho returned an unexpected create response', status || 502, 'ZOHO_UNEXPECTED_RESPONSE');
}

/**
 * @returns {Promise<{ remoteId: string }>}
 */
async function createReceipt({ receiptNote, lines }) {
  const moduleApi = moduleName();
  if (!moduleApi) throw httpError('ZOHO_RECEIPT_MODULE is not set', 501, 'ADAPTER_NOT_CONFIGURED');
  const zohoPoId = await resolveZohoPoId(receiptNote || {});
  if (!zohoPoId) {
    throw httpError(
      `Receipt ${receiptNote && receiptNote.id} has no Zoho Purchase Order to fetch`,
      400,
      'ZOHO_PO_MISSING'
    );
  }
  const po = await zohoProcurement.getPurchaseOrder(zohoPoId);
  const orderedByLine = new Map((po.lines || []).map((line) => [String(line.zohoLineId), line.quantity]));
  const productByLine = new Map(
    (po.lines || []).map((line) => [String(line.zohoLineId), line.zohoProductId])
  );
  const stored = await storedOutboundIdentity(receiptNote);

  await zohoService.init();
  const record = new ZOHOCRMSDK.Record.Record();
  const noteId = String(receiptNote.id);
  put(record, 'Name', noteId);
  put(record, 'Receipt_Note_Number', noteId);
  // Stored pull wins. A blank Zoho read must not replace an OPO id we already kept.
  const poNumber = stored.outboundPoNumber || po.outboundPoNumber || po.legacyPoNumber;
  const identifier = stored.outboundPoIdentifier || po.outboundPoIdentifier;
  const version = stored.poVersionNumber != null ? stored.poVersionNumber : po.poVersionNumber;
  put(record, 'Outbound_PO_Number', poNumber != null && poNumber !== '' ? String(poNumber) : null);
  put(record, 'Outbound_PO_Identifier', identifier);
  if (version != null && Number.isFinite(Number(version))) {
    record.addKeyValue('PO_Version_Number', Number(version));
  }

  const vendor = po.vendorName && typeof po.vendorName === 'object' ? po.vendorName.name : po.vendorName;
  put(record, 'Vendor_Name', vendor || receiptNote.vendor_name);

  put(record, 'Vendor_Invoice_No', receiptNote.vendor_invoice_no);
  put(record, 'Delivery_Note_No', receiptNote.delivery_note_no);
  put(record, 'Received_At', dateOnly(receiptNote.received_at));
  put(record, 'Received_At_Location', receiptNote.received_at_location);
  put(record, 'Received_By', receiptNote.received_by || receiptNote.posted_by);
  put(record, 'AssetEngine_Status', 'POSTED');

  const lookup = new ZOHOCRMSDK.Record.Record();
  lookup.setId(zohoService.toZohoRecordBigInt(po.zohoPoId, 'zoho_po_id'));
  record.addKeyValue('Outbound_PO', lookup);

  const subform = (lines || [])
    .filter((line) => qty(line.qty_received) || qty(line.qty_accepted) || qty(line.qty_rejected) || qty(line.qty_damaged))
    .map((line) => {
      const row = new ZOHOCRMSDK.Record.Record();
      const lineKey = String(line.zoho_line_id || '');
      const liveOrdered = orderedByLine.get(lineKey);

      const productId = line.zoho_product_id || productByLine.get(lineKey);
      if (productId && /^\d+$/.test(String(productId))) {
        const product = new ZOHOCRMSDK.Record.Record();
        product.setId(zohoService.toZohoRecordBigInt(productId, 'zoho_product_id'));
        row.addKeyValue('Product', product);
      }

      put(row, 'Item_Description', line.item_description_snapshot || line.po_line_id);
      row.addKeyValue('Ordered_Qty', liveOrdered != null ? qty(liveOrdered) : qty(line.ordered_qty_snapshot));
      row.addKeyValue('Received_Qty', qty(line.qty_received));
      row.addKeyValue('Qty_Accepted', qty(line.qty_accepted));
      row.addKeyValue('Qty_Rejected', qty(line.qty_rejected));
      row.addKeyValue('Qty_Damaged', qty(line.qty_damaged));
      put(row, 'Unit', line.unit || line.unit_snapshot);
      return row;
    });
  if (subform.length) record.addKeyValue('Receipt_Lines', subform);

  const recordOperations = new ZOHOCRMSDK.Record.RecordOperations(moduleApi);
  const request = new ZOHOCRMSDK.Record.BodyWrapper();
  request.setData([record]);
  const response = await recordOperations.createRecords(request);
  return { remoteId: parseCreatedId(response) };
}

module.exports = {
  isConfigured,
  createReceipt
};
