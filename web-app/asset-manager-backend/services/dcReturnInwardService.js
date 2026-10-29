/**
 * DC Return Log + Return Inward Receipt Note lifecycle.
 *
 * Create Return Log + OPEN RETURN_INWARD RN → no stock effect.
 * POST RETURN_INWARD RN → physical restoration (same assets / qty lineage).
 * SALE DCs cannot be returned.
 */
const crypto = require('crypto');
const {
  db,
  generateReturnLogId,
  verifyReturnLogId,
  generateReceiptNoteId,
  verifyReceiptNoteId,
  generateReceiptLineId,
  verifyReceiptLineId
} = require('../utils');
const reservationService = require('./reservationService');
const deliveryChallanEventService = require('./deliveryChallanEventService');
const reasonCatalog = require('./dcReasonCatalog');

/** Returnable / exit / destination code sets from the DC reason catalog. */
async function reasonSets(runner = db) {
  const codes = await reasonCatalog.codesByBehaviour(runner);
  return {
    returnable: codes.returnable,
    isReturnable: (c) => codes.returnable.includes(String(c || '').toUpperCase()),
    isExit: (c) => codes.exit.includes(String(c || '').toUpperCase()),
    needsDestination: (c) => codes.destination.includes(String(c || '').toUpperCase())
  };
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) {
      throw httpError(`ID generator produced a non-canonical ${label} id: ${id}`, 500);
    }
    const existing = await trx(table).where({ id }).first();
    if (!existing) return id;
  }
  throw httpError(`Could not allocate a unique ${label} ID`, 500);
}

/** Qty already committed in OPEN (not yet posted) Return Logs against a disposition line. */
async function pendingOpenReturnQty(trx, dispositionLineId) {
  const rows = await trx('dc_return_log_line as l')
    .join('dc_return_log as g', 'g.id', 'l.return_log_id')
    .where('l.disposition_line_id', dispositionLineId)
    .where('g.status', 'OPEN')
    .select('l.quantity');
  return rows.reduce((s, r) => s + qtyNum(r.quantity), 0);
}

const RETURN_REASONS = Object.freeze([
  'DEMO_COMPLETED',
  'RENTAL_COMPLETED',
  'REPAIR_COMPLETED',
  'CUSTOMER_RETURN',
  'PROJECT_COMPLETED',
  'UNUSED_RETURN',
  'DAMAGED_RETURN',
  'INTERNAL_USE_COMPLETED',
  'TRANSFER_RECEIVED',
  'OTHER'
]);

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function trimText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function qtyNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normReturnReason(raw) {
  const r = String(raw || '').trim().toUpperCase();
  if (!RETURN_REASONS.includes(r)) {
    throw httpError(
      `returnReason must be one of ${RETURN_REASONS.join(', ')}`,
      400,
      'INVALID_RETURN_REASON'
    );
  }
  return r;
}

function newReturnLogLineId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RTL-${stamp}-${rand}`;
}

function publicReturnLog(row, lines = []) {
  if (!row) return null;
  return {
    id: row.id,
    deliveryChallanId: row.delivery_challan_id,
    receiptNoteId: row.receipt_note_id,
    status: row.status,
    returnReason: row.return_reason,
    returnedByParty: row.returned_by_party,
    receivedByUser: row.received_by_user,
    accountName: row.account_name,
    projectReference: row.project_reference,
    returnDate: row.return_date,
    notes: row.notes,
    returnHome: row.return_home || null,
    returnLocation: row.return_location || null,
    createdBy: row.created_by,
    postedAt: row.posted_at,
    postedBy: row.posted_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    createdAt: row.created_at,
    lines: lines.map((l) => ({
      id: l.id,
      dispositionLineId: l.disposition_line_id,
      resourceType: l.resource_type,
      resourceId: l.resource_id,
      quantity: qtyNum(l.quantity),
      serialSnapshot: l.serial_snapshot,
      productId: l.product_id
    }))
  };
}

async function getReturnPosition(dcId) {
  const disp = await db('dc_disposition_line').where({ delivery_challan_id: dcId });
  const sets = await reasonSets();
  let dispatchedQty = 0;
  let returnedQty = 0;
  let dispatchedAssets = 0;
  let returnedAssets = 0;
  for (const line of disp) {
    if (sets.isExit(line.dispatch_reason)) continue;
    const q = qtyNum(line.quantity);
    const r = qtyNum(line.quantity_returned);
    dispatchedQty += q;
    returnedQty += r;
    if (line.resource_type === 'ASSET') {
      dispatchedAssets += 1;
      if (r >= q - 1e-9 || String(line.disposition_status) === 'RETURNED') returnedAssets += 1;
    }
  }
  const outstanding = Math.max(dispatchedQty - returnedQty, 0);
  let position = 'NO_RETURN';
  if (returnedQty > 0 && outstanding > 1e-9) position = 'PARTIALLY_RETURNED';
  if (dispatchedQty > 0 && outstanding <= 1e-9) position = 'FULLY_RETURNED';
  if (!disp.length) position = 'NO_RETURN';
  return {
    deliveryChallanId: dcId,
    position,
    dispatchedQuantity: dispatchedQty,
    returnedQuantity: returnedQty,
    outstandingQuantity: outstanding,
    dispatchedAssets,
    returnedAssets,
    stillOutAssets: Math.max(dispatchedAssets - returnedAssets, 0)
  };
}

async function listReturnLogsForDc(dcId) {
  if (!(await db.schema.hasTable('dc_return_log'))) return [];
  const logs = await db('dc_return_log')
    .where({ delivery_challan_id: dcId })
    .orderBy('return_date', 'desc')
    .orderBy('created_at', 'desc');
  const out = [];
  for (const log of logs) {
    const lines = await db('dc_return_log_line').where({ return_log_id: log.id });
    out.push(publicReturnLog(log, lines));
  }
  return out;
}

/**
 * Create Return Log + OPEN RETURN_INWARD Receipt Note.
 * Does NOT restore physical stock.
 */
async function createReturnLog(args = {}) {
  const dcId = trimText(args.dcId || args.deliveryChallanId);
  if (!dcId) throw httpError('deliveryChallanId is required', 400, 'MISSING_DC');
  const returnReason = normReturnReason(args.returnReason);
  const returnedByParty = trimText(args.returnedByParty || args.returnedBy);
  const receivedByUser = trimText(args.receivedByUser || args.receivedBy);
  const actor = trimText(args.actor) || 'web';
  const notes = trimText(args.notes);
  const returnHome = String(args.returnHome || 'ORIGIN').trim().toUpperCase();
  const returnLocation = trimText(args.returnLocation);
  if (!['ORIGIN', 'ASSET', 'INVENTORY'].includes(returnHome)) {
    throw httpError('returnHome must be ORIGIN, ASSET, or INVENTORY', 400, 'INVALID_RETURN_HOME');
  }
  if ((returnHome === 'ASSET' || returnHome === 'INVENTORY') && !returnLocation) {
    throw httpError('Choose the location this return is received into', 400, 'MISSING_RETURN_LOCATION');
  }
  const vendorInvoiceNo = trimText(args.vendorInvoiceNo || args.vendor_invoice_no);
  if (!returnedByParty) throw httpError('returnedByParty is required', 400, 'MISSING_RETURNED_BY');
  if (!receivedByUser) throw httpError('receivedByUser is required', 400, 'MISSING_RECEIVED_BY');

  const dcPeek = await db('delivery_challans').where({ id: dcId }).first();
  if (!dcPeek) throw httpError(`Delivery Challan ${dcId} not found`, 404, 'NOT_FOUND');
  if (String(dcPeek.lifecycle_status || '').toUpperCase() !== 'DISPATCHED') {
    throw httpError('Only DISPATCHED DCs can receive returns', 409, 'NOT_DISPATCHED');
  }
  const sets = await reasonSets();
  const peekReason = String(dcPeek.dispatch_reason || '').toUpperCase();
  if (sets.isExit(peekReason)) {
    throw httpError(`${peekReason} dispatches have no ordinary Return Inward path`, 409, 'SALE_NO_RETURN');
  }
  if (!sets.isReturnable(peekReason)) {
    throw httpError('DC dispatch reason is not returnable', 409, 'NOT_RETURNABLE');
  }
  if (!vendorInvoiceNo) throw httpError('Invoice number is required', 400, 'INVOICE_REQUIRED');

  let inputLines = Array.isArray(args.lines) ? args.lines : [];
  // Allow omit lines → return all outstanding returnable disposition lines
  if (!inputLines.length && args.autoAll !== false) {
    const outstanding = await db('dc_disposition_line')
      .where({ delivery_challan_id: dcId })
      .whereIn('dispatch_reason', sets.returnable)
      .whereNot('disposition_status', 'RETURNED')
      .whereRaw('COALESCE(quantity_returned,0) < quantity');
    inputLines = outstanding.map((d) => ({
      dispositionLineId: d.id,
      quantity: d.resource_type === 'ASSET' ? 1 : qtyNum(d.quantity) - qtyNum(d.quantity_returned),
      serialNumber: d.serial_snapshot
    }));
  }
  if (!inputLines.length) throw httpError('At least one return line is required', 400, 'EMPTY_RETURN');

  return db.transaction(async (trx) => {
    const dc = await trx('delivery_challans').where({ id: dcId }).forUpdate().first();
    if (!dc) throw httpError(`Delivery Challan ${dcId} not found`, 404, 'NOT_FOUND');
    if (String(dc.lifecycle_status || '').toUpperCase() !== 'DISPATCHED') {
      throw httpError('Only DISPATCHED DCs can receive returns', 409, 'NOT_DISPATCHED');
    }
    const dispatchReason = String(dc.dispatch_reason || '').toUpperCase();
    if (sets.isExit(dispatchReason)) {
      throw httpError(`${dispatchReason} dispatches have no ordinary Return Inward path`, 409, 'SALE_NO_RETURN');
    }
    if (!sets.isReturnable(dispatchReason)) {
      throw httpError('DC dispatch reason is not returnable', 409, 'NOT_RETURNABLE');
    }

    const prepared = [];
    for (const raw of inputLines) {
      const dispositionLineId = trimText(raw.dispositionLineId || raw.disposition_line_id);
      if (!dispositionLineId) throw httpError('dispositionLineId is required on each line', 400, 'MISSING_DISPOSITION_LINE');
      const disp = await trx('dc_disposition_line').where({ id: dispositionLineId }).forUpdate().first();
      if (!disp || disp.delivery_challan_id !== dcId) {
        throw httpError(`Disposition line ${dispositionLineId} does not belong to DC ${dcId}`, 409, 'DISPOSITION_MISMATCH');
      }
      if (sets.isExit(disp.dispatch_reason)) {
        throw httpError(`Cannot return a ${disp.dispatch_reason} disposition line`, 409, 'SALE_NO_RETURN');
      }
      if (String(disp.disposition_status) === 'RETURNED') {
        throw httpError(`Disposition line ${dispositionLineId} is already fully returned`, 409, 'ALREADY_RETURNED');
      }
      const dispatched = qtyNum(disp.quantity);
      const already = qtyNum(disp.quantity_returned);
      const pending = await pendingOpenReturnQty(trx, dispositionLineId);
      const outstanding = dispatched - already - pending;
      let qty = qtyNum(raw.quantity != null ? raw.quantity : (disp.resource_type === 'ASSET' ? 1 : 0));
      if (disp.resource_type === 'ASSET') qty = 1;
      if (!(qty > 0)) throw httpError('Return quantity must be > 0', 400, 'INVALID_QUANTITY');
      if (qty > outstanding + 1e-9) {
        throw httpError(
          `Return quantity ${qty} exceeds outstanding ${outstanding} on ${disp.resource_id}`,
          409,
          'OVER_RETURN',
          { dispositionLineId, outstanding, requested: qty, alreadyReturned: already, pendingOpen: pending }
        );
      }
      if (disp.resource_type === 'ASSET') {
        const serialExpected = trimText(disp.serial_snapshot);
        const serialGiven = trimText(raw.serialNumber || raw.serialSnapshot || raw.srNo);
        const asset = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [disp.resource_id]).first();
        if (!asset) throw httpError(`Asset ${disp.resource_id} not found`, 404, 'ASSET_NOT_FOUND');
        const assetSerial = trimText(asset.srno || asset.SrNo || asset.serial_number || asset.serialNumber);
        const expected = serialExpected || assetSerial;
        if (expected && serialGiven && expected.toLowerCase() !== serialGiven.toLowerCase()) {
          throw httpError(
            `Serial mismatch for ${disp.resource_id}: expected ${expected}, got ${serialGiven}`,
            409,
            'SERIAL_MISMATCH'
          );
        }
        if (expected && !serialGiven) {
          raw.serialNumber = expected;
        }
        if (Number(asset.is_retired) === 1 || String(asset.status || '').toLowerCase() === 'sold') {
          throw httpError(`Sold/retired asset ${disp.resource_id} cannot be returned`, 409, 'ASSET_SOLD');
        }
        if (trimText(asset.sentagainstdc) && trimText(asset.sentagainstdc) !== trimText(dc.challanno)) {
          throw httpError(
            `Asset ${disp.resource_id} is not committed to DC ${dc.challanno}`,
            409,
            'ASSET_NOT_ON_DC'
          );
        }
      }
      let productId = trimText(raw.productId) || trimText(disp.product_id);
      if (!productId && disp.resource_type === 'ASSET') {
        const holder = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [disp.resource_id]).first('product_id');
        productId = trimText(holder && holder.product_id);
      }
      prepared.push({
        disp,
        quantity: qty,
        serialSnapshot: trimText(raw.serialNumber || raw.serialSnapshot || disp.serial_snapshot),
        productId
      });
    }

    const payload = (() => {
      try {
        return typeof dc.payloadjson === 'string' ? JSON.parse(dc.payloadjson) : (dc.payloadjson || {});
      } catch (_) {
        return {};
      }
    })();

    const returnLogId = await uniquePrefixedId(
      trx,
      'dc_return_log',
      generateReturnLogId,
      verifyReturnLogId,
      'Return Log'
    );
    const receiptNoteId = await uniquePrefixedId(
      trx,
      'receipt_note',
      generateReceiptNoteId,
      verifyReceiptNoteId,
      'Receipt Note'
    );

    await trx('dc_return_log').insert({
      id: returnLogId,
      delivery_challan_id: dcId,
      receipt_note_id: null,
      status: 'OPEN',
      return_reason: returnReason,
      returned_by_party: returnedByParty,
      received_by_user: receivedByUser,
      account_name: trimText(payload.account?.accountName) || trimText(dc.customername),
      project_reference: trimText(payload.meta?.referenceNo),
      return_date: args.returnDate ? new Date(args.returnDate).toISOString() : new Date().toISOString(),
      notes,
      return_home: returnHome,
      return_location: returnHome === 'ORIGIN' ? null : returnLocation,
      created_by: actor,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await trx('receipt_note').insert({
      id: receiptNoteId,
      status: 'OPEN',
      po_source: 'LOCAL',
      po_id: null,
      po_number: null,
      vendor_name: returnedByParty,
      vendor_invoice_no: vendorInvoiceNo,
      delivery_note_no: dc.challanno,
      received_at: null,
      received_at_location: trimText(args.location) || null,
      received_by: receivedByUser,
      created_by: actor,
      inward_kind: 'RETURN_INWARD',
      delivery_challan_id: dcId,
      return_log_id: returnLogId,
      return_reason: returnReason,
      returned_by_party: returnedByParty,
      received_by_user: receivedByUser,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await trx('dc_return_log').where({ id: returnLogId }).update({
      receipt_note_id: receiptNoteId,
      updated_at: new Date().toISOString()
    });

    if (await trx.schema.hasTable('receipt_event')) {
      await trx('receipt_event').insert({
        receipt_note_id: receiptNoteId,
        type: 'NOTE_OPENED',
        actor,
        timestamp: new Date().toISOString(),
        note: `RETURN_INWARD for DC ${dc.challanno} · Return Log ${returnLogId}`,
        metadata_json: JSON.stringify({
          eventType: 'RETURN_INWARD_CREATED',
          returnLogCreated: true,
          returnLogId,
          deliveryChallanId: dcId,
          returnReason,
          returnedByParty,
          receivedByUser,
          recordedBy: actor
        })
      });
    }

    let sort = 0;
    for (const prep of prepared) {
      const logLineId = newReturnLogLineId();
      await trx('dc_return_log_line').insert({
        id: logLineId,
        return_log_id: returnLogId,
        disposition_line_id: prep.disp.id,
        resource_type: prep.disp.resource_type,
        resource_id: prep.disp.resource_id,
        quantity: prep.quantity,
        serial_snapshot: prep.serialSnapshot,
        product_id: prep.productId,
        created_at: new Date().toISOString()
      });

      const rnLineId = await uniquePrefixedId(
        trx,
        'receipt_note_line',
        generateReceiptLineId,
        verifyReceiptLineId,
        'Receipt Note Line'
      );
      await trx('receipt_note_line').insert({
        id: rnLineId,
        receipt_note_id: receiptNoteId,
        po_line_id: `RETLINE:${prep.disp.id}`,
        product_id: prep.productId,
        ordered_qty_snapshot: prep.quantity,
        ordered_qty_current: prep.quantity,
        unit_snapshot: 'Nos',
        item_description_snapshot: `${prep.disp.resource_type} ${prep.disp.resource_id}`,
        po_number_snapshot: dc.challanno,
        vendor_name_snapshot: returnedByParty,
        qty_received: prep.quantity,
        qty_accepted: prep.quantity,
        qty_rejected: 0,
        qty_damaged: 0,
        unit: 'Nos',
        creation_mode: null,
        sort_order: sort++,
        notes: `Return of ${prep.disp.resource_id}`,
        disposition_line_id: prep.disp.id,
        resource_type: prep.disp.resource_type,
        resource_id: prep.disp.resource_id,
        serial_snapshot: prep.serialSnapshot,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    await deliveryChallanEventService.writeDcEvent(trx, {
      deliveryChallanId: dcId,
      type: 'UPDATED',
      actor,
      note: `Return Log ${returnLogId} created (OPEN) → RN ${receiptNoteId}`,
      metadata: {
        returnLogId,
        receiptNoteId,
        returnReason,
        returnedByParty,
        receivedByUser,
        lineCount: prepared.length
      }
    });

    const log = await trx('dc_return_log').where({ id: returnLogId }).first();
    const lines = await trx('dc_return_log_line').where({ return_log_id: returnLogId });
    return {
      returnLog: publicReturnLog(log, lines),
      receiptNoteId,
      deliveryChallanId: dcId,
      physicalEffect: false,
      message: 'Return Log and Return Inward RN created OPEN. Stock restores only when RN is POSTED.'
    };
  });
}

/**
 * Called from receiptService.postReceipt when inward_kind = RETURN_INWARD.
 * Restores physical holdings for the linked Return Log lines.
 */
async function applyPhysicalReturnOnPost(trx, note, actor) {
  if (String(note.inward_kind || '').toUpperCase() !== 'RETURN_INWARD') {
    throw httpError('Not a RETURN_INWARD receipt', 400, 'NOT_RETURN_INWARD');
  }
  const returnLogId = note.return_log_id;
  if (!returnLogId) throw httpError('RETURN_INWARD missing return_log_id', 409, 'MISSING_RETURN_LOG');
  const log = await trx('dc_return_log').where({ id: returnLogId }).forUpdate().first();
  if (!log) throw httpError('Return Log not found', 404, 'RETURN_LOG_NOT_FOUND');
  if (String(log.status).toUpperCase() === 'POSTED') {
    return { alreadyPosted: true, returnLogId };
  }
  if (String(log.status).toUpperCase() !== 'OPEN') {
    throw httpError(`Return Log ${log.status} cannot be posted`, 409, 'INVALID_RETURN_LOG_STATUS');
  }

  const dc = await trx('delivery_challans').where({ id: log.delivery_challan_id }).forUpdate().first();
  if (!dc) throw httpError('Originating DC not found', 404, 'DC_NOT_FOUND');
  const sets = await reasonSets(trx);
  if (sets.isExit(dc.dispatch_reason)) {
    throw httpError(`${dc.dispatch_reason} cannot be returned`, 409, 'SALE_NO_RETURN');
  }
  const isTransfer = sets.needsDestination(dc.dispatch_reason);
  const transferDestination = isTransfer ? trimText(dc.transfer_destination) : null;
  const returnHome = String(log.return_home || '').toUpperCase();
  // ORIGIN leaves the holding where it left from. ASSET / INVENTORY set the chosen place.
  // Logs created before this choice still follow the stock-transfer destination.
  const landing = (returnHome === 'ASSET' || returnHome === 'INVENTORY')
    ? trimText(log.return_location)
    : (returnHome === 'ORIGIN' ? null : transferDestination);

  const logLines = await trx('dc_return_log_line').where({ return_log_id: returnLogId });
  const restored = [];
  for (const line of logLines) {
    const disp = await trx('dc_disposition_line').where({ id: line.disposition_line_id }).forUpdate().first();
    if (!disp) throw httpError(`Disposition line ${line.disposition_line_id} missing`, 409, 'DISPOSITION_MISSING');
    const qty = qtyNum(line.quantity);
    const already = qtyNum(disp.quantity_returned);
    const outstanding = qtyNum(disp.quantity) - already;
    if (qty > outstanding + 1e-9) {
      throw httpError('Over-return at post time', 409, 'OVER_RETURN');
    }
    let locationMove = null;

    if (line.resource_type === 'ASSET') {
      const restoreStatus =
        String(disp.dispatch_reason).toUpperCase() === 'REPAIR'
          ? (disp.prior_asset_status && String(disp.prior_asset_status).toLowerCase() !== 'out for repair'
            ? disp.prior_asset_status
            : 'Under Inspection')
          : (disp.prior_asset_status || 'In Store');
      const assetPatch = {
        status: restoreStatus,
        sentagainstdc: null,
        lastupdated: new Date().toISOString()
      };
      const held = await trx('assets').where({ id: line.resource_id }).first('is_quantity_tracked', 'quantity_total', 'quantity_available');
      if (held && Number(held.is_quantity_tracked) === 1) {
        const total = qtyNum(held.quantity_total);
        const available = qtyNum(held.quantity_available);
        assetPatch.quantity_available = Math.min(total, available + qty);
      }
      if (landing) {
        const current = await trx('assets').where({ id: line.resource_id }).first('currentlocation');
        assetPatch.previouslocation = current?.currentlocation || null;
        assetPatch.currentlocation = landing;
        locationMove = { from: assetPatch.previouslocation, to: landing, home: returnHome || 'TRANSFER' };
      }
      await trx('assets').where({ id: line.resource_id }).update(assetPatch);
      await deliveryChallanEventService.writeHoldingHistory(trx, {
        resourceType: 'ASSET',
        resourceId: line.resource_id,
        action: 'DC_RETURNED',
        oldValue: disp.disposition_status,
        newValue: restoreStatus,
        actor,
        details: `Brought back on DC ${dc.challanno} by Return Inward ${note.id}${landing ? ` to ${landing}` : ''}`
      });
    } else if (line.resource_type === 'INVENTORY') {
      // Temporary dispositions keep reservation until return — release the returned qty
      if (disp.reservation_id) {
        const res = await trx('reservation').where({ id: disp.reservation_id }).first();
        if (res && String(res.status).toUpperCase() === 'ACTIVE') {
          const remainingAfter = outstanding - qty;
          if (remainingAfter <= 1e-9) {
            await reservationService.release({
              trx,
              id: res.id,
              actor: actor || null,
              reason: `Return Inward ${note.id}`
            });
          } else {
            await reservationService.release({
              trx,
              id: res.id,
              quantity: qty,
              actor: actor || null,
              reason: `Partial return Inward ${note.id}`
            });
          }
        }
      }
      if (landing) {
        // Inventory moves location only when the whole item was transferred; a partial
        // quantity would need a split, so its location is left unchanged.
        const inv = await trx('inventory_items').where({ id: line.resource_id }).first('currentlocation', 'quantity_total');
        const wholeItem = inv && qtyNum(disp.quantity) >= qtyNum(inv.quantity_total) - 1e-9;
        const lastReceipt = already + qty >= qtyNum(disp.quantity) - 1e-9;
        if (wholeItem && lastReceipt) {
          await trx('inventory_items').where({ id: line.resource_id }).update({
            currentlocation: landing,
            lastupdated: new Date().toISOString()
          });
          locationMove = { from: inv.currentlocation || null, to: landing, home: returnHome || 'TRANSFER' };
        } else {
          locationMove = {
            from: inv?.currentlocation || null,
            to: inv?.currentlocation || null,
            skipped: wholeItem ? 'PARTIAL_RECEIPT' : 'PARTIAL_QUANTITY_TRANSFER'
          };
        }
      }
      await deliveryChallanEventService.writeHoldingHistory(trx, {
        resourceType: 'INVENTORY',
        resourceId: line.resource_id,
        action: 'DC_RETURNED',
        oldValue: disp.disposition_status,
        newValue: 'RETURNED',
        actor,
        details: `Brought back on DC ${dc.challanno} by Return Inward ${note.id}${landing ? ` to ${landing}` : ''}`,
        metadata: { deliveryChallanId: dc.id, challanNo: dc.challanno, receiptNoteId: note.id, quantity: qty }
      });
    }

    const newReturned = already + qty;
    const fully = newReturned >= qtyNum(disp.quantity) - 1e-9;
    await trx('dc_disposition_line').where({ id: disp.id }).update({
      quantity_returned: newReturned,
      disposition_status: fully ? 'RETURNED' : disp.disposition_status,
      returned_at: fully ? new Date().toISOString() : disp.returned_at,
      returned_by: fully ? (actor || null) : disp.returned_by
    });
    restored.push({
      dispositionLineId: disp.id,
      resourceType: line.resource_type,
      resourceId: line.resource_id,
      quantity: qty,
      fullyReturned: fully,
      ...(locationMove ? { locationMove } : {})
    });
  }

  const now = new Date().toISOString();
  await trx('dc_return_log').where({ id: returnLogId }).update({
    status: 'POSTED',
    posted_at: now,
    posted_by: actor || null,
    updated_at: now
  });

  // Derived DC return timestamps when fully returned
  const remaining = await trx('dc_disposition_line')
    .where({ delivery_challan_id: dc.id })
    .whereIn('dispatch_reason', sets.returnable)
    .whereRaw('COALESCE(quantity_returned,0) < quantity')
    .count('* as c')
    .first();
  if (Number(remaining?.c || 0) === 0) {
    await trx('delivery_challans').where({ id: dc.id }).update({
      returned_at: now,
      returned_by: actor || null
    });
  }

  await deliveryChallanEventService.writeDcEvent(trx, {
    deliveryChallanId: dc.id,
    type: 'RETURNED',
    actor: actor || null,
    note: `Return Inward ${note.id} POSTED (${log.return_reason}). Holdings: ${restored.map((line) => `${line.resourceType} ${line.resourceId}`).join(', ') || 'none'}`,
    metadata: {
      returnLogId,
      receiptNoteId: note.id,
      returnReason: log.return_reason,
      returnHome: returnHome || null,
      returnLocation: landing,
      returnedByParty: log.returned_by_party,
      receivedByUser: log.received_by_user,
      recordedBy: actor || null,
      restored
    }
  });

  if (await trx.schema.hasTable('dc_return_inward_outbox')) {
    const idem = `return-inward-posted-${note.id}`;
    const existing = await trx('dc_return_inward_outbox').where({ idempotency_key: idem }).first();
    if (!existing) {
      await trx('dc_return_inward_outbox').insert({
        return_log_id: returnLogId,
        receipt_note_id: note.id,
        delivery_challan_id: dc.id,
        event_type: 'RETURN_INWARD_POSTED',
        status: 'PENDING',
        idempotency_key: idem,
        payload_json: JSON.stringify({
          eventType: 'RETURN_INWARD_POSTED',
          returnLogId,
          receiptNoteId: note.id,
          deliveryChallanId: dc.id,
          challanNo: dc.challanno,
          returnReason: log.return_reason,
          returnedByParty: log.returned_by_party,
          receivedByUser: log.received_by_user,
          recordedBy: actor || null,
          restored
        }),
        created_at: now,
        updated_at: now
      });
    }
  }

  return { alreadyPosted: false, returnLogId, restored };
}

/** Replace immediate restore — create Return Log package instead. */
async function returnFromDispatch(dcId, actor, args = {}) {
  const { returnable } = await reasonSets();
  const dispLines = await db('dc_disposition_line')
    .where({ delivery_challan_id: dcId })
    .whereNull('returned_at')
    .whereIn('dispatch_reason', returnable)
    .whereNot('disposition_status', 'RETURNED');
  let selected = dispLines;
  if (Array.isArray(args.lineIds) && args.lineIds.length) {
    selected = dispLines.filter((d) => args.lineIds.includes(d.id));
  }
  if (!selected.length) {
    throw httpError('No returnable disposition lines', 409, 'NOTHING_TO_RETURN');
  }
  return createReturnLog({
    dcId,
    returnReason: args.returnReason || 'OTHER',
    returnedByParty: args.returnedByParty || args.returnedBy || 'External party',
    receivedByUser: args.receivedByUser || args.receivedBy || actor || 'operator',
    vendorInvoiceNo: args.vendorInvoiceNo || args.vendor_invoice_no,
    notes: args.notes || 'Created via DC return shortcut',
    actor,
    lines: selected.map((d) => ({
      dispositionLineId: d.id,
      quantity: d.resource_type === 'ASSET' ? 1 : qtyNum(d.quantity) - qtyNum(d.quantity_returned),
      serialNumber: d.serial_snapshot
    }))
  });
}

module.exports = {
  RETURN_REASONS,
  createReturnLog,
  applyPhysicalReturnOnPost,
  getReturnPosition,
  listReturnLogsForDc,
  returnFromDispatch,
  publicReturnLog
};
