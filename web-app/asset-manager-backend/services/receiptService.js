/**
 * Phase 7 Receipt Note engine.
 *
 * Records inbound physical receiving against a local PO (project_orders).
 * Creates accepted Asset/Inventory only on POST. Does not reserve, convert,
 * break, allocate Sets, create Products, or call Zoho.
 */
const crypto = require('crypto');
const qrcode = require('qrcode');
const {
  db,
  generateReceiptNoteId,
  verifyReceiptNoteId,
  generateReceiptLineId,
  verifyReceiptLineId,
  generateModernAssetId
} = require('../utils');
const { EVENT_TYPES } = require('../../shared/inventoryEventSystem');
const receiptProjectionService = require('./receiptProjectionService');

const NOTE_STATUSES = Object.freeze(['OPEN', 'POSTED', 'CANCELLED', 'REVERSED']);
const CREATION_MODES = Object.freeze(['INVENTORY', 'ASSET_GROUPED', 'ASSET_INDIVIDUAL']);
const PO_SOURCES = Object.freeze(['LOCAL', 'ZOHO']);
const ID_RE = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{4}-[A-Z0-9]{6}-[A-Z0-9]$/;
const MIS_ID = 'MIS-MUM-0826-H4XVLL-W';

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError('Invalid quantity value', 400, 'INVALID_QUANTITY');
  return n;
}

function roundQty(value, precision = 6) {
  const p = Math.min(6, Math.max(0, parseInt(precision, 10) || 0));
  const n = qtyNum(value);
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function qtyEq(a, b, precision = 6) {
  return roundQty(a, precision) === roundQty(b, precision);
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

function trimText(value) {
  return nonempty(value) ? String(value).trim() : null;
}

function actorOf(args) {
  return trimText(args && (args.actor || args.createdBy)) || null;
}

function idempotencyKeyOf(args) {
  const raw = args && (args.idempotencyKey || args.idempotency_key);
  if (!raw) return null;
  return String(raw).trim().slice(0, 64) || null;
}

function isUniqueViolation(err, name) {
  if (!err || String(err.code) !== '23505') return false;
  const hay = `${err.constraint || ''} ${err.message || ''}`;
  return hay.includes(name);
}

function sourceHash({ poLineId, productId, orderedQty, unit, description }) {
  const payload = JSON.stringify({
    po_line_id: String(poLineId || ''),
    product_id: String(productId || ''),
    ordered_qty: String(roundQty(orderedQty, 6)),
    unit: String(unit || ''),
    description: String(description || '')
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function requestHost(host) {
  const value = String(host || '').trim();
  if (!value) throw httpError('Host is required to generate a QR', 400, 'MISSING_HOST');
  return value.replace(/^https?:\/\//i, '');
}

async function buildQrDataUrl(host, publicPath, id) {
  const urlText = `http://${requestHost(host)}/${publicPath}/${encodeURIComponent(id)}`;
  return qrcode.toDataURL(urlText, { width: 512, margin: 2 });
}

function clientLabelFromId(id) {
  const parts = String(id || '').split('-');
  return `${parts[0] || 'AST'}-${parts[1] || 'LOC'}-${parts[3] || '000000'}`;
}

async function tablesReady(runner = db) {
  return runner.schema.hasTable('receipt_note');
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Receipt Note tables are not installed', 503, 'NOT_INSTALLED');
  }
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

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return { raw: value };
  }
}

function publicLine(row, extra = {}) {
  if (!row) return null;
  const received = qtyNum(row.qty_received);
  const accepted = qtyNum(row.qty_accepted);
  const rejected = qtyNum(row.qty_rejected);
  const damaged = qtyNum(row.qty_damaged);
  return {
    id: row.id,
    receiptNoteId: row.receipt_note_id,
    poLineId: row.po_line_id,
    productId: row.product_id || null,
    orderedQtySnapshot: qtyNum(row.ordered_qty_snapshot),
    orderedQtyCurrent: row.ordered_qty_current == null ? null : qtyNum(row.ordered_qty_current),
    unitSnapshot: row.unit_snapshot || null,
    itemDescriptionSnapshot: row.item_description_snapshot || null,
    poNumberSnapshot: row.po_number_snapshot || null,
    vendorNameSnapshot: row.vendor_name_snapshot || null,
    fetchedAt: row.fetched_at,
    sourceHash: row.source_hash || null,
    qtyReceived: received,
    qtyAccepted: accepted,
    qtyRejected: rejected,
    qtyDamaged: damaged,
    unit: row.unit || row.unit_snapshot || null,
    creationMode: row.creation_mode || null,
    sortOrder: row.sort_order,
    notes: row.notes || null,
    folderId: row.folder_id || null,
    kindId: row.kind_id || null,
    physicalMarkings: parseJson(row.physical_markings),
    ...extra
  };
}

function publicNote(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    poSource: row.po_source,
    poId: row.po_id,
    poNumber: row.po_number || null,
    vendorName: row.vendor_name || null,
    vendorInvoiceNo: row.vendor_invoice_no || null,
    deliveryNoteNo: row.delivery_note_no || null,
    receivedAt: row.received_at,
    receivedAtLocation: row.received_at_location || null,
    receivedBy: row.received_by || null,
    createdBy: row.created_by || null,
    postedBy: row.posted_by || null,
    postedAt: row.posted_at,
    cancelledBy: row.cancelled_by || null,
    cancelledAt: row.cancelled_at,
    reversedBy: row.reversed_by || null,
    reversedAt: row.reversed_at,
    idempotencyKey: row.idempotency_key || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

function publicEvent(row) {
  return {
    id: row.id,
    receiptNoteId: row.receipt_note_id,
    receiptLineId: row.receipt_line_id || null,
    type: row.type,
    productId: row.product_id || null,
    qtyReceived: row.qty_received == null ? null : qtyNum(row.qty_received),
    qtyAccepted: row.qty_accepted == null ? null : qtyNum(row.qty_accepted),
    qtyRejected: row.qty_rejected == null ? null : qtyNum(row.qty_rejected),
    qtyDamaged: row.qty_damaged == null ? null : qtyNum(row.qty_damaged),
    actor: row.actor || null,
    timestamp: row.timestamp,
    note: row.note || null,
    receivedAtLocation: row.received_at_location || null,
    metadata: parseJson(row.metadata_json)
  };
}

function publicOutput(row) {
  return {
    id: row.id,
    receiptLineId: row.receipt_line_id,
    receiptNoteId: row.receipt_note_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    quantity: qtyNum(row.quantity)
  };
}

async function writeReceiptEvent(trx, payload) {
  await trx('receipt_event').insert({
    receipt_note_id: payload.receiptNoteId,
    receipt_line_id: payload.receiptLineId || null,
    type: payload.type,
    product_id: payload.productId || null,
    qty_received: payload.qtyReceived == null ? null : payload.qtyReceived,
    qty_accepted: payload.qtyAccepted == null ? null : payload.qtyAccepted,
    qty_rejected: payload.qtyRejected == null ? null : payload.qtyRejected,
    qty_damaged: payload.qtyDamaged == null ? null : payload.qtyDamaged,
    actor: payload.actor || null,
    timestamp: new Date().toISOString(),
    note: payload.note || null,
    received_at_location: payload.receivedAtLocation || null,
    metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
  });
}

async function writeQuantityEvent(trx, { table, rootId, type, actor, note, metadata, lines }) {
  const now = new Date().toISOString();
  const isAsset = table === 'assets';
  const eventTable = isAsset ? 'quantity_events' : 'inventory_quantity_events';
  const lineTable = isAsset ? 'quantity_event_lines' : 'inventory_quantity_event_lines';
  if (!(await trx.schema.hasTable(eventTable))) return null;
  const inserted = await trx(eventTable)
    .insert({
      root_id: rootId,
      type,
      actor: actor || null,
      timestamp: now,
      note: note || null,
      metadata_json: metadata ? JSON.stringify(metadata) : null
    })
    .returning('id');
  const eventId = Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
  if (eventId && Array.isArray(lines) && lines.length && (await trx.schema.hasTable(lineTable))) {
    await trx(lineTable).insert(
      lines.map((line) => (isAsset
        ? {
            event_id: eventId,
            asset_id: line.id,
            unit: line.unit || null,
            delta_available: line.deltaAvailable,
            delta_total: line.deltaTotal
          }
        : {
            event_id: eventId,
            item_id: line.id,
            unit: line.unit || null,
            delta_available: line.deltaAvailable,
            delta_total: line.deltaTotal
          }))
    );
  }
  return eventId;
}

async function writeAssetHistory(trx, assetId, action, oldValue, newValue, actor, details) {
  if (!(await trx.schema.hasTable('asset_history'))) return;
  await trx('asset_history').insert({
    assetid: assetId,
    action,
    oldvalue: oldValue == null ? null : String(oldValue),
    newvalue: newValue == null ? null : String(newValue),
    user: actor || 'web',
    timestamp: new Date().toISOString(),
    details: details || ''
  });
}

async function findByCreateKey(runner, key) {
  if (!key) return null;
  return runner('receipt_note').where({ idempotency_key: key }).first();
}

function scopedIdempotencyKey(operation, key) {
  if (!key) return null;
  return `${operation}:${key}`.slice(0, 64);
}

async function findIdempotency(runner, key) {
  if (!key) return null;
  return runner('receipt_idempotency').where({ idempotency_key: key }).first();
}

async function storeIdempotency(trx, key, operation, receiptNoteId) {
  if (!key) return;
  await trx('receipt_idempotency').insert({
    idempotency_key: scopedIdempotencyKey(operation, key),
    operation,
    receipt_note_id: receiptNoteId,
    created_at: new Date().toISOString()
  });
}

async function loadLocalPo(runner, poId) {
  const id = String(poId || '').trim();
  if (!id) throw httpError('poId is required', 400, 'MISSING_PO');
  let header = await runner('project_orders').where({ id }).first();
  if (!header) {
    header = await runner('project_orders').where({ ponumber: id }).first();
  }
  if (!header || Number(header.is_deleted) === 1) {
    throw httpError(`PO ${id} is not available`, 409, 'PO_UNAVAILABLE');
  }
  const items = await runner('project_order_items').where({ orderid: header.id }).where(function notDeleted() {
    this.where('is_deleted', 0).orWhereNull('is_deleted');
  }).orderBy('srno');
  return { header, items };
}

async function loadPoContext(runner, poSource, poId) {
  if (String(poSource).toUpperCase() === 'ZOHO') {
    const procurementService = require('./procurementService');
    return procurementService.loadMirrorForReceipt(runner, poId);
  }
  const local = await loadLocalPo(runner, poId);
  return { header: local.header, items: local.items, po: null };
}

async function lockPoLine(trx, poLineId, poSource = 'LOCAL') {
  const id = String(poLineId || '').trim();
  if (String(poSource).toUpperCase() === 'ZOHO') {
    const row = await trx('procurement_po_line').where({ id }).forUpdate().first();
    if (!row) throw httpError(`PO line ${id} is not available`, 409, 'PO_UNAVAILABLE');
    return {
      id: row.id,
      orderid: row.procurement_po_id,
      qtyordered: row.ordered_qty,
      uom: row.unit,
      itemdescription: row.description,
      product_id: row.product_id,
      zoho_line_id: row.zoho_line_id,
      line_status: row.line_status
    };
  }
  if (!/^\d+$/.test(id)) {
    throw httpError(`PO line ${id} is not a local integer line id`, 400, 'INVALID_PO_LINE');
  }
  const row = await trx('project_order_items').where({ id: Number(id) }).forUpdate().first();
  if (!row) throw httpError(`PO line ${id} is not available`, 409, 'PO_UNAVAILABLE');
  return row;
}

async function acceptedToDate(trx, poLineId, exceptNoteId) {
  let q = trx('receipt_note_line as l')
    .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
    .where('l.po_line_id', String(poLineId))
    .where('n.status', 'POSTED');
  if (exceptNoteId) q = q.andWhereNot('n.id', exceptNoteId);
  const row = await q.sum({ total: 'l.qty_accepted' }).first();
  return roundQty(row && row.total, 6);
}

async function loadProduct(trx, productId) {
  if (!nonempty(productId)) return null;
  const row = await trx('product').where({ id: String(productId).trim() }).first();
  if (!row) throw httpError(`Product ${productId} not found`, 409, 'PRODUCT_REQUIRED');
  if (String(row.status || '').toUpperCase() === 'ARCHIVED') {
    throw httpError(`Product ${productId} is archived`, 409, 'PRODUCT_REQUIRED');
  }
  return row;
}

function normalizeLineInput(raw, index) {
  const poLineId = String(raw.poLineId || raw.po_line_id || '').trim();
  if (!poLineId) throw httpError(`lines[${index}].poLineId is required`, 400, 'MISSING_PO_LINE');
  const accepted = roundQty(raw.qtyAccepted ?? raw.qty_accepted ?? 0);
  const rejected = roundQty(raw.qtyRejected ?? raw.qty_rejected ?? 0);
  const damaged = roundQty(raw.qtyDamaged ?? raw.qty_damaged ?? 0);
  let received = raw.qtyReceived ?? raw.qty_received;
  if (received == null || received === '') {
    received = roundQty(accepted + rejected + damaged);
  } else {
    received = roundQty(received);
  }
  if (accepted < 0 || rejected < 0 || damaged < 0 || received < 0) {
    throw httpError('Quantities cannot be negative', 400, 'INVALID_QUANTITY');
  }
  if (!qtyEq(received, accepted + rejected + damaged)) {
    throw httpError(
      `received must equal accepted + rejected + damaged (got ${received} vs ${accepted}+${rejected}+${damaged})`,
      400,
      'QUANTITY_EQUATION'
    );
  }
  const mode = trimText(raw.creationMode || raw.creation_mode);
  if (mode && !CREATION_MODES.includes(mode)) {
    throw httpError(`creationMode must be ${CREATION_MODES.join('|')}`, 400, 'INVALID_CREATION_MODE');
  }
  return {
    poLineId,
    productId: trimText(raw.productId || raw.product_id),
    qtyReceived: received,
    qtyAccepted: accepted,
    qtyRejected: rejected,
    qtyDamaged: damaged,
    unit: trimText(raw.unit),
    creationMode: mode,
    notes: trimText(raw.notes),
    folderId: trimText(raw.folderId || raw.folder_id),
    kindId: trimText(raw.kindId || raw.kind_id),
    physicalMarkings: Array.isArray(raw.physicalMarkings || raw.physical_markings)
      ? (raw.physicalMarkings || raw.physical_markings)
      : null,
    sortOrder: Number.isFinite(Number(raw.sortOrder ?? raw.sort_order)) ? Number(raw.sortOrder ?? raw.sort_order) : index
  };
}

function snapshotFromPoLine(header, poLine, productId) {
  const ordered = roundQty(poLine.qtyordered ?? poLine.QtyOrdered ?? 0);
  const unit = trimText(poLine.uom) || null;
  const description = trimText(poLine.itemdescription) || null;
  return {
    orderedQty: ordered,
    unit,
    description,
    poNumber: trimText(header.ponumber) || header.id,
    vendorName: trimText(header.vendorname),
    fetchedAt: new Date().toISOString(),
    sourceHash: sourceHash({
      poLineId: poLine.id,
      productId,
      orderedQty: ordered,
      unit,
      description
    })
  };
}

async function insertLines(trx, noteId, header, itemsById, lineInputs, actor) {
  const rows = [];
  for (let i = 0; i < lineInputs.length; i += 1) {
    const input = lineInputs[i];
    const poLine = itemsById.get(String(input.poLineId));
    if (!poLine) {
      throw httpError(`PO line ${input.poLineId} does not belong to this PO`, 400, 'PO_LINE_MISMATCH');
    }
    if (input.productId) await loadProduct(trx, input.productId);
    else if (poLine.product_id) input.productId = poLine.product_id;
    const snap = snapshotFromPoLine(header, poLine, input.productId);
    const lineId = await uniquePrefixedId(trx, 'receipt_note_line', generateReceiptLineId, verifyReceiptLineId, 'Receipt line');
    const lineInsert = {
      id: lineId,
      receipt_note_id: noteId,
      po_line_id: String(poLine.id),
      product_id: input.productId,
      ordered_qty_snapshot: snap.orderedQty,
      ordered_qty_current: snap.orderedQty,
      unit_snapshot: input.unit || snap.unit,
      item_description_snapshot: snap.description,
      po_number_snapshot: snap.poNumber,
      vendor_name_snapshot: snap.vendorName,
      fetched_at: snap.fetchedAt,
      source_hash: snap.sourceHash,
      qty_received: input.qtyReceived,
      qty_accepted: input.qtyAccepted,
      qty_rejected: input.qtyRejected,
      qty_damaged: input.qtyDamaged,
      unit: input.unit || snap.unit,
      creation_mode: input.creationMode,
      sort_order: input.sortOrder,
      notes: input.notes,
      folder_id: input.folderId,
      kind_id: input.kindId,
      physical_markings: input.physicalMarkings ? JSON.stringify(input.physicalMarkings) : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (await trx.schema.hasColumn('receipt_note_line', 'zoho_line_id')) {
      lineInsert.zoho_line_id = poLine.zoho_line_id ? String(poLine.zoho_line_id) : null;
    }
    await trx('receipt_note_line').insert(lineInsert);
    await writeReceiptEvent(trx, {
      receiptNoteId: noteId,
      receiptLineId: lineId,
      type: 'LINE_RECORDED',
      productId: input.productId,
      qtyReceived: input.qtyReceived,
      qtyAccepted: input.qtyAccepted,
      qtyRejected: input.qtyRejected,
      qtyDamaged: input.qtyDamaged,
      actor,
      note: input.notes,
      metadata: { poLineId: String(poLine.id) }
    });
    rows.push(lineId);
  }
  return rows;
}

async function hydrate(runner, row) {
  const [lines, outputs, events, outbox] = await Promise.all([
    runner('receipt_note_line').where({ receipt_note_id: row.id }).orderBy('sort_order'),
    runner('receipt_physical_output').where({ receipt_note_id: row.id }).orderBy('id'),
    runner('receipt_event').where({ receipt_note_id: row.id }).orderBy('id'),
    receiptProjectionService.getOutbox(runner, row.id)
  ]);
  const balances = [];
  const grouped = new Map();
  for (const line of lines) {
    const accepted = await acceptedToDate(runner, line.po_line_id);
    grouped.set(line.po_line_id, accepted);
  }
  const canReverse = row.status === 'POSTED'
    ? (await reverseBlockers(runner, row.id)).length === 0
    : false;
  return {
    receiptNote: publicNote(row, {
      projectionStatus: outbox ? outbox.status : null,
      projectionSkipReason: outbox ? outbox.skip_reason : null,
      zohoReceiptId: outbox ? outbox.zoho_receipt_id : null,
      canReverse
    }),
    lines: lines.map((line) => publicLine(line, {
      acceptedToDate: grouped.get(line.po_line_id),
      outstanding: roundQty(
        qtyNum(line.ordered_qty_current != null ? line.ordered_qty_current : line.ordered_qty_snapshot)
          - qtyNum(grouped.get(line.po_line_id)),
        6
      )
    })),
    outputs: outputs.map(publicOutput),
    events: events.map(publicEvent),
    projection: outbox || null,
    balances
  };
}

async function getReceiptNote(id) {
  await requireTables();
  const row = await db('receipt_note').where({ id: String(id || '').trim() }).first();
  if (!row) throw httpError('Receipt Note not found', 404, 'NOT_FOUND');
  return hydrate(db, row);
}

async function listReceiptNotes(filters = {}) {
  await requireTables();
  let q = db('receipt_note').orderBy('created_at', 'desc');
  if (filters.status) q = q.andWhere('status', String(filters.status).toUpperCase());
  if (filters.poId || filters.po_id) q = q.andWhere('po_id', String(filters.poId || filters.po_id));
  if (filters.q) {
    const term = `%${String(filters.q).trim()}%`;
    q = q.andWhere(function filterQ() {
      this.where('id', 'ilike', term)
        .orWhere('po_number', 'ilike', term)
        .orWhere('vendor_name', 'ilike', term)
        .orWhere('po_id', 'ilike', term);
    });
  }
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const rows = await q.limit(limit);
  const notes = [];
  for (const row of rows) {
    const lines = await db('receipt_note_line').where({ receipt_note_id: row.id });
    const accepted = lines.reduce((sum, line) => sum + qtyNum(line.qty_accepted), 0);
    const outbox = await receiptProjectionService.getOutbox(db, row.id);
    notes.push(publicNote(row, {
      acceptedQuantity: roundQty(accepted, 6),
      lineCount: lines.length,
      projectionStatus: outbox ? outbox.status : null
    }));
  }
  return { receiptNotes: notes };
}

async function getPoBalance(poId) {
  await requireTables();
  const key = String(poId || '').trim();
  if (await db.schema.hasTable('procurement_po')) {
    const mirror = await db('procurement_po').where({ id: key }).orWhere({ zoho_po_id: key }).first();
    if (mirror) {
      const procurementService = require('./procurementService');
      const po = await procurementService.getPurchaseOrder(mirror.id);
      return {
        poSource: 'ZOHO',
        poId: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendorName,
        status: po.status,
        zohoPoId: po.zohoPoId,
        reconciliationRequired: po.reconciliationRequired,
        mappingRequired: po.mappingRequired,
        lines: (po.lines || []).map((line) => ({
          poLineId: line.id,
          srno: line.sequenceNumber,
          description: line.description || null,
          unit: line.unit || null,
          ordered: line.ordered,
          acceptedToDate: line.accepted,
          rejected: line.rejected,
          damaged: line.damaged,
          outstanding: line.outstanding,
          onOrder: line.onOrder,
          reconciliationStatus: line.reconciliationStatus,
          productId: line.productId,
          mappingRequired: line.mappingRequired,
          zohoLineId: line.zohoLineId
        }))
      };
    }
  }
  const { header, items } = await loadLocalPo(db, poId);
  const lines = [];
  for (const item of items) {
    const accepted = await acceptedToDate(db, item.id);
    const ordered = roundQty(item.qtyordered || 0);
    lines.push({
      poLineId: String(item.id),
      srno: item.srno,
      description: item.itemdescription || null,
      unit: item.uom || null,
      ordered,
      acceptedToDate: accepted,
      outstanding: roundQty(ordered - accepted, 6),
      poLineStatus: item.status || null,
      assetid: item.assetid || null
    });
  }
  return {
    poSource: 'LOCAL',
    poId: header.id,
    poNumber: header.ponumber || null,
    vendorName: header.vendorname || null,
    status: header.status || null,
    lines
  };
}

async function createReceiptNote(args) {
  await requireTables();
  const poSource = String(args.poSource || args.po_source || 'LOCAL').toUpperCase();
  if (!PO_SOURCES.includes(poSource)) throw httpError('poSource must be LOCAL or ZOHO', 400, 'INVALID_PO_SOURCE');
  if (poSource === 'ZOHO') {
    const procurementService = require('./procurementService');
    await procurementService.assertReceivable(db, args.poId || args.po_id, {
      actor: actorOf(args),
      refreshStale: true
    });
  }
  const key = idempotencyKeyOf(args);
  if (key) {
    const existing = await findByCreateKey(db, key);
    if (existing) return hydrate(db, existing);
  }
  const actor = actorOf(args);
  const rawLines = Array.isArray(args.lines) ? args.lines : [];
  const lineInputs = rawLines.map((line, i) => normalizeLineInput(line, i));
  const poIds = new Set();

  try {
    return await db.transaction(async (trx) => {
      if (key) {
        const replay = await findByCreateKey(trx, key);
        if (replay) return hydrate(trx, replay);
      }
      const { header, items } = await loadPoContext(trx, poSource, args.poId || args.po_id);
      poIds.add(header.id);
      const itemsById = new Map(items.map((item) => [String(item.id), item]));
      if (poSource === 'ZOHO') {
        const procurementService = require('./procurementService');
        for (const input of lineInputs) {
          const poLine = itemsById.get(String(input.poLineId));
          await procurementService.assertReceivableLine(trx, header, poLine, input.qtyAccepted);
          if (input.productId && poLine.product_id && input.productId !== poLine.product_id) {
            throw httpError(
              'Receipt Product must match the mapped Purchase Order line Product',
              409,
              'WRONG_PRODUCT'
            );
          }
        }
      }
      const noteId = await uniquePrefixedId(trx, 'receipt_note', generateReceiptNoteId, verifyReceiptNoteId, 'Receipt Note');
      const now = new Date().toISOString();
      const noteInsert = {
        id: noteId,
        status: 'OPEN',
        po_source: poSource,
        po_id: header.id,
        po_number: trimText(header.ponumber) || header.id,
        vendor_name: trimText(header.vendorname),
        vendor_invoice_no: trimText(args.vendorInvoiceNo || args.vendor_invoice_no),
        delivery_note_no: trimText(args.deliveryNoteNo || args.delivery_note_no),
        received_at: args.receivedAt || args.received_at || now,
        received_at_location: trimText(args.receivedAtLocation || args.received_at_location),
        received_by: trimText(args.receivedBy || args.received_by) || actor,
        created_by: actor,
        idempotency_key: key,
        created_at: now,
        updated_at: now
      };
      if (await trx.schema.hasColumn('receipt_note', 'zoho_po_id')) {
        noteInsert.zoho_po_id = header.zoho_po_id ? String(header.zoho_po_id) : null;
      }
      await trx('receipt_note').insert(noteInsert);
      await writeReceiptEvent(trx, {
        receiptNoteId: noteId,
        type: 'NOTE_OPENED',
        actor,
        receivedAtLocation: trimText(args.receivedAtLocation || args.received_at_location),
        metadata: { poId: header.id, poNumber: header.ponumber || null }
      });
      if (lineInputs.length) {
        await insertLines(trx, noteId, header, itemsById, lineInputs, actor);
      }
      if (key) await storeIdempotency(trx, key, 'CREATE', noteId);
      const row = await trx('receipt_note').where({ id: noteId }).first();
      return hydrate(trx, row);
    });
  } catch (err) {
    if (key && isUniqueViolation(err, 'receipt_note_idempotency_key_unique')) {
      const existing = await findByCreateKey(db, key);
      if (existing) return hydrate(db, existing);
    }
    if (key && isUniqueViolation(err, 'receipt_idempotency')) {
      const existing = await findIdempotency(db, scopedIdempotencyKey('CREATE', key));
      if (existing) {
        const row = await db('receipt_note').where({ id: existing.receipt_note_id }).first();
        if (row) return hydrate(db, row);
      }
    }
    throw err;
  }
}

async function updateReceiptNote(id, args) {
  await requireTables();
  const noteId = String(id || '').trim();
  const actor = actorOf(args);
  return db.transaction(async (trx) => {
    const row = await trx('receipt_note').where({ id: noteId }).forUpdate().first();
    if (!row) throw httpError('Receipt Note not found', 404, 'NOT_FOUND');
    if (row.status !== 'OPEN') {
      throw httpError('Posted Receipt Notes cannot be edited', 409, 'RECEIPT_IMMUTABLE');
    }
    const patch = { updated_at: new Date().toISOString() };
    if (args.vendorInvoiceNo !== undefined || args.vendor_invoice_no !== undefined) {
      patch.vendor_invoice_no = trimText(args.vendorInvoiceNo || args.vendor_invoice_no);
    }
    if (args.deliveryNoteNo !== undefined || args.delivery_note_no !== undefined) {
      patch.delivery_note_no = trimText(args.deliveryNoteNo || args.delivery_note_no);
    }
    if (args.receivedAtLocation !== undefined || args.received_at_location !== undefined) {
      patch.received_at_location = trimText(args.receivedAtLocation || args.received_at_location);
    }
    if (args.receivedAt !== undefined || args.received_at !== undefined) {
      patch.received_at = args.receivedAt || args.received_at;
    }
    await trx('receipt_note').where({ id: noteId }).update(patch);

    if (Array.isArray(args.lines)) {
      const { header, items } = await loadPoContext(trx, row.po_source, row.po_id);
      const itemsById = new Map(items.map((item) => [String(item.id), item]));
      const existing = await trx('receipt_note_line').where({ receipt_note_id: noteId });
      const byPoLine = new Map(existing.map((line) => [String(line.po_line_id), line]));
      const seen = new Set();
      const inputs = args.lines.map((line, i) => normalizeLineInput(line, i));
      for (const input of inputs) {
        seen.add(input.poLineId);
        const poLine = itemsById.get(input.poLineId);
        if (!poLine) throw httpError(`PO line ${input.poLineId} does not belong to this PO`, 400, 'PO_LINE_MISMATCH');
        if (input.productId) await loadProduct(trx, input.productId);
        const snap = snapshotFromPoLine(header, poLine, input.productId);
        const current = byPoLine.get(input.poLineId);
        if (current) {
          await trx('receipt_note_line').where({ id: current.id }).update({
            product_id: input.productId,
            ordered_qty_snapshot: snap.orderedQty,
            ordered_qty_current: snap.orderedQty,
            unit_snapshot: input.unit || snap.unit,
            item_description_snapshot: snap.description,
            fetched_at: snap.fetchedAt,
            source_hash: snap.sourceHash,
            qty_received: input.qtyReceived,
            qty_accepted: input.qtyAccepted,
            qty_rejected: input.qtyRejected,
            qty_damaged: input.qtyDamaged,
            unit: input.unit || snap.unit,
            creation_mode: input.creationMode,
            sort_order: input.sortOrder,
            notes: input.notes,
            folder_id: input.folderId,
            kind_id: input.kindId,
            physical_markings: input.physicalMarkings ? JSON.stringify(input.physicalMarkings) : null,
            updated_at: new Date().toISOString()
          });
          await writeReceiptEvent(trx, {
            receiptNoteId: noteId,
            receiptLineId: current.id,
            type: 'LINE_RECORDED',
            productId: input.productId,
            qtyReceived: input.qtyReceived,
            qtyAccepted: input.qtyAccepted,
            qtyRejected: input.qtyRejected,
            qtyDamaged: input.qtyDamaged,
            actor,
            note: 'Line updated'
          });
        } else {
          await insertLines(trx, noteId, header, itemsById, [input], actor);
        }
      }
    }
    const updated = await trx('receipt_note').where({ id: noteId }).first();
    return hydrate(trx, updated);
  });
}

async function uniqueHoldingId(trx, table, location, type) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateModernAssetId(location || 'Mumbai', type || 'GEN');
    if (!ID_RE.test(id) || /-NaN$/i.test(id)) {
      throw httpError(`ID generator produced a non-canonical id: ${id}`, 500);
    }
    const existing = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique physical ID', 500);
}

async function resolveInventoryFolder(trx, line) {
  if (line.folder_id && line.kind_id) {
    return { folderid: line.folder_id, kindid: line.kind_id };
  }
  const mis = await trx('inventory_items').where({ id: MIS_ID }).first();
  if (mis && mis.folderid && mis.kindid) {
    return { folderid: mis.folderid, kindid: mis.kindid, type: mis.type, category: mis.category };
  }
  const kind = await trx('inventory_kinds').first();
  if (!kind) {
    throw httpError('Inventory folder/kind is required to create Inventory from a Receipt', 409, 'INVENTORY_KIND_REQUIRED');
  }
  return { folderid: kind.folderid, kindid: kind.id, type: kind.name, category: kind.name };
}

async function createInventoryRow(trx, { product, qty, unit, location, line, host, actor, noteId }) {
  const folder = await resolveInventoryFolder(trx, line);
  const holdingId = await uniqueHoldingId(trx, 'inventory_items', location, folder.type || product.name || 'Inventory');
  const now = new Date().toISOString();
  const qr = await buildQrDataUrl(host, 'inventory', holdingId);
  await trx('inventory_items').insert({
    id: holdingId,
    itemname: product.name,
    itemdescription: line.item_description_snapshot || product.description || '',
    status: 'In Store',
    make: product.make || '',
    model: product.model || '',
    type: folder.type || 'Inventory',
    category: folder.category || folder.type || 'Inventory',
    folderid: folder.folderid,
    kindid: folder.kindid,
    currentlocation: location || '',
    lastupdated: now,
    purpose: 'Owned',
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: unit || product.unit || 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_parent_id: null,
    quantity_root_id: holdingId,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: product.id,
    receipt_line_id: line.id,
    parentid: null,
    qrcode: qr,
    noqr: 0,
    client_label: clientLabelFromId(holdingId),
    quantity_updated_at: now
  });
  await trx('receipt_physical_output').insert({
    receipt_line_id: line.id,
    receipt_note_id: noteId,
    resource_type: 'INVENTORY',
    resource_id: holdingId,
    quantity: qty,
    created_at: now
  });
  await writeQuantityEvent(trx, {
    table: 'inventory_items',
    rootId: holdingId,
    type: EVENT_TYPES.RECEIVE,
    actor,
    note: `Receipt ${noteId} line ${line.id}`,
    metadata: { receipt_note_id: noteId, receipt_line_id: line.id, po_line_id: line.po_line_id },
    lines: [{ id: holdingId, unit: unit || product.unit || 'Nos', deltaAvailable: qty, deltaTotal: qty }]
  });
  return { resourceType: 'INVENTORY', resourceId: holdingId, quantity: qty, qr: true };
}

async function createAssetRow(trx, { product, qty, unit, location, line, host, actor, noteId, marking }) {
  const holdingId = await uniqueHoldingId(trx, 'assets', location, product.make || 'GEN');
  const now = new Date().toISOString();
  const qr = await buildQrDataUrl(host, 'asset', holdingId);
  await trx('assets').insert({
    id: holdingId,
    itemname: product.name,
    itemdescription: line.item_description_snapshot || product.description || '',
    status: 'In Store',
    make: product.make || '',
    model: product.model || '',
    srno: '',
    type: product.make || 'GEN',
    category: product.model || '',
    isplaceholder: 0,
    parentid: null,
    currentlocation: location || '',
    lastupdated: now,
    purpose: 'Owned',
    qrcode: qr,
    assignedto: '',
    client_label: clientLabelFromId(holdingId),
    noqr: 0,
    is_quantity_tracked: 1,
    is_batch: 0,
    is_set: 0,
    quantity_unit: unit || product.unit || 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_parent_id: null,
    quantity_root_id: holdingId,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: product.id,
    receipt_line_id: line.id,
    quantity_updated_at: now
  });
  await trx('receipt_physical_output').insert({
    receipt_line_id: line.id,
    receipt_note_id: noteId,
    resource_type: 'ASSET',
    resource_id: holdingId,
    quantity: qty,
    created_at: now
  });
  if (marking && nonempty(marking.value || marking)) {
    const markingId = `PMK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await trx('physical_marking').insert({
      id: markingId,
      holding_type: 'ASSET',
      holding_id: holdingId,
      kind: trimText(marking.kind) || 'MANUFACTURER_SERIAL',
      value: String(marking.value || marking),
      status: 'ACTIVE',
      created_at: now,
      updated_at: now
    });
  }
  await writeQuantityEvent(trx, {
    table: 'assets',
    rootId: holdingId,
    type: EVENT_TYPES.RECEIVE,
    actor,
    note: `Receipt ${noteId} line ${line.id}`,
    metadata: { receipt_note_id: noteId, receipt_line_id: line.id, po_line_id: line.po_line_id },
    lines: [{ id: holdingId, unit: unit || product.unit || 'Nos', deltaAvailable: qty, deltaTotal: qty }]
  });
  await writeAssetHistory(
    trx,
    holdingId,
    'RECEIPT_POST',
    noteId,
    holdingId,
    actor,
    `Created from Receipt line ${line.id} (PO line ${line.po_line_id}) qty ${qty}`
  );
  return { resourceType: 'ASSET', resourceId: holdingId, quantity: qty, qr: true };
}

async function createPhysicalForLine(trx, { line, product, host, actor, noteId, location }) {
  const accepted = roundQty(line.qty_accepted);
  if (!(accepted > 0)) return [];
  const mode = String(line.creation_mode || '').toUpperCase();
  const unit = line.unit || product.unit || 'Nos';
  if (mode === 'INVENTORY') {
    return [await createInventoryRow(trx, { product, qty: accepted, unit, location, line, host, actor, noteId })];
  }
  if (mode === 'ASSET_GROUPED') {
    return [await createAssetRow(trx, { product, qty: accepted, unit, location, line, host, actor, noteId })];
  }
  if (mode === 'ASSET_INDIVIDUAL') {
    if (!qtyEq(accepted, Math.round(accepted), 0)) {
      throw httpError('Individual Assets require a whole accepted quantity', 400, 'INVALID_QUANTITY');
    }
    const count = Math.round(accepted);
    const markings = parseJson(line.physical_markings) || [];
    if (markings.length && markings.length !== count) {
      throw httpError('physicalMarkings length must match individual Asset count', 400, 'INVALID_MARKING');
    }
    const created = [];
    for (let i = 0; i < count; i += 1) {
      created.push(await createAssetRow(trx, {
        product,
        qty: 1,
        unit,
        location,
        line,
        host,
        actor,
        noteId,
        marking: markings[i] || null
      }));
    }
    return created;
  }
  throw httpError('creationMode is required when accepted quantity is greater than zero', 400, 'INVALID_CREATION_MODE');
}

async function postReceipt(id, args = {}) {
  await requireTables();
  const noteId = String(id || '').trim();
  const key = idempotencyKeyOf(args);
  if (key) {
    const existingOp = await findIdempotency(db, scopedIdempotencyKey('POST', key));
    if (existingOp && existingOp.operation === 'POST') {
      const row = await db('receipt_note').where({ id: existingOp.receipt_note_id }).first();
      if (row) return hydrate(db, row);
    }
  }
  const actor = actorOf(args);
  const host = args.host;
  const peek = await db('receipt_note').where({ id: noteId }).first();
  if (peek && peek.po_source === 'ZOHO' && peek.status === 'OPEN') {
    const procurementService = require('./procurementService');
    await procurementService.assertReceivable(db, peek.po_id, { actor, refreshStale: true });
  }
  let posted;
  try {
    posted = await db.transaction(async (trx) => {
      if (key) {
        const replay = await findIdempotency(trx, scopedIdempotencyKey('POST', key));
        if (replay && replay.operation === 'POST') {
          const row = await trx('receipt_note').where({ id: replay.receipt_note_id }).first();
          if (row) return hydrate(trx, row);
        }
      }
      const note = await trx('receipt_note').where({ id: noteId }).forUpdate().first();
      if (!note) throw httpError('Receipt Note not found', 404, 'NOT_FOUND');
      if (note.status === 'POSTED') {
        if (key) await storeIdempotency(trx, key, 'POST', note.id).catch(() => null);
        return hydrate(trx, note);
      }
      if (note.status !== 'OPEN') {
        throw httpError(`Receipt Note ${note.status} cannot be posted`, 409, 'INVALID_STATUS');
      }
      if (note.po_source === 'ZOHO') {
        const procurementService = require('./procurementService');
        await procurementService.assertReceivable(trx, note.po_id, {
          actor,
          refreshStale: false
        });
      }
      const { header, items } = await loadPoContext(trx, note.po_source, note.po_id);
      const itemsById = new Map(items.map((item) => [String(item.id), item]));
      const lines = await trx('receipt_note_line').where({ receipt_note_id: note.id }).orderBy('sort_order');
      const activeLines = lines.filter((line) => roundQty(line.qty_received) > 0);
      if (!activeLines.length) {
        throw httpError('POST requires at least one line with received quantity greater than zero', 400, 'EMPTY_RECEIPT');
      }

      const created = [];
      const staleWarnings = [];
      for (const line of activeLines) {
        const poLine = await lockPoLine(trx, line.po_line_id, note.po_source);
        if (String(poLine.orderid) !== String(header.id) || !itemsById.has(String(poLine.id))) {
          throw httpError(`PO line ${line.po_line_id} does not belong to PO ${header.id}`, 409, 'PO_LINE_MISMATCH');
        }
        const product = await loadProduct(trx, line.product_id);
        if (!product) {
          throw httpError(
            `Receipt line ${line.id} has no Product. Link an AssetEngine Product before posting.`,
            409,
            'PRODUCT_REQUIRED'
          );
        }
        if (note.po_source === 'ZOHO' && poLine.product_id && product.id !== poLine.product_id) {
          throw httpError(
            'Receipt Product must match the mapped Purchase Order line Product',
            409,
            'WRONG_PRODUCT'
          );
        }
        const received = roundQty(line.qty_received);
        const accepted = roundQty(line.qty_accepted);
        const rejected = roundQty(line.qty_rejected);
        const damaged = roundQty(line.qty_damaged);
        if (!qtyEq(received, accepted + rejected + damaged)) {
          throw httpError('received must equal accepted + rejected + damaged', 400, 'QUANTITY_EQUATION');
        }
        if (accepted > 0 && !CREATION_MODES.includes(String(line.creation_mode || '').toUpperCase())) {
          throw httpError('creationMode is required when accepted quantity is greater than zero', 400, 'INVALID_CREATION_MODE');
        }
        const snap = snapshotFromPoLine(header, poLine, product.id);
        const liveOrdered = snap.orderedQty;
        const priorAccepted = await acceptedToDate(trx, poLine.id, note.id);
        if (note.po_source === 'ZOHO') {
          const procurementService = require('./procurementService');
          await procurementService.assertReceivableLine(trx, header, poLine, accepted, note.id);
        }
        const outstanding = roundQty(Math.max(liveOrdered - priorAccepted, 0));
        if (liveOrdered + 1e-9 < priorAccepted) {
          throw httpError(
            `This PO line has less commercial quantity (${liveOrdered}) than has already been physically accepted (${priorAccepted}). Further receiving is blocked.`,
            409,
            'RECONCILIATION_REQUIRED',
            { poLineId: String(poLine.id), orderedCurrent: liveOrdered, acceptedToDate: priorAccepted }
          );
        }
        if (accepted - outstanding > 1e-9) {
          const code = outstanding > 0 ? 'INSUFFICIENT_OUTSTANDING' : 'OVER_RECEIPT';
          throw httpError(
            `Over-receipt rejected for PO line ${poLine.id}: accepted ${accepted} exceeds outstanding ${outstanding}`,
            409,
            code === 'INSUFFICIENT_OUTSTANDING' ? 'INSUFFICIENT_OUTSTANDING' : 'OVER_RECEIPT',
            {
              poLineId: String(poLine.id),
              orderedCurrent: liveOrdered,
              acceptedToDate: priorAccepted,
              outstanding,
              thisAccepted: accepted
            }
          );
        }
        if (line.source_hash && line.source_hash !== snap.sourceHash) {
          if (liveOrdered + 1e-9 < priorAccepted + accepted) {
            throw httpError(
              `PO line ${poLine.id} changed and no longer covers this receipt`,
              409,
              'STALE_PO',
              {
                snapshotOrdered: qtyNum(line.ordered_qty_snapshot),
                orderedCurrent: liveOrdered,
                acceptedToDate: priorAccepted,
                thisAccepted: accepted
              }
            );
          }
          staleWarnings.push({
            poLineId: String(poLine.id),
            snapshotOrdered: qtyNum(line.ordered_qty_snapshot),
            orderedCurrent: liveOrdered
          });
        }
        await trx('receipt_note_line').where({ id: line.id }).update({
          ordered_qty_current: liveOrdered,
          fetched_at: snap.fetchedAt,
          source_hash: snap.sourceHash,
          unit: line.unit || snap.unit,
          updated_at: new Date().toISOString()
        });
        const refreshed = await trx('receipt_note_line').where({ id: line.id }).first();
        const outputs = await createPhysicalForLine(trx, {
          line: refreshed,
          product,
          host,
          actor,
          noteId: note.id,
          location: note.received_at_location || 'Mumbai'
        });
        created.push(...outputs);
      }

      const now = new Date().toISOString();
      await trx('receipt_note').where({ id: note.id }).update({
        status: 'POSTED',
        posted_by: actor,
        posted_at: now,
        updated_at: now
      });
      await writeReceiptEvent(trx, {
        receiptNoteId: note.id,
        type: 'POSTED',
        actor,
        receivedAtLocation: note.received_at_location,
        note: 'Receipt posted',
        metadata: {
          physicalIds: created.map((c) => c.resourceId),
          staleWarnings
        }
      });
      const projection = await receiptProjectionService.enqueue(trx, {
        receiptNoteId: note.id,
        poSource: note.po_source,
        poId: note.po_id
      });
      await writeReceiptEvent(trx, {
        receiptNoteId: note.id,
        type: 'PROJECTION_ENQUEUED',
        actor,
        note: projection.status === 'SKIPPED' ? 'ADAPTER_NOT_CONFIGURED' : 'PENDING',
        metadata: projection
      });
      if (key) await storeIdempotency(trx, key, 'POST', note.id);
      const postedRow = await trx('receipt_note').where({ id: note.id }).first();
      const result = await hydrate(trx, postedRow);
      result.staleWarnings = staleWarnings;
      return result;
    });
  } catch (err) {
    if (key && isUniqueViolation(err, 'receipt_idempotency')) {
      const existing = await findIdempotency(db, scopedIdempotencyKey('POST', key));
      if (existing) {
        const row = await db('receipt_note').where({ id: existing.receipt_note_id }).first();
        if (row) return hydrate(db, row);
      }
    }
    throw err;
  }

  if (receiptProjectionService.adapterConfigured()) {
    await receiptProjectionService.attempt(noteId, { actor }).catch(() => null);
    const row = await db('receipt_note').where({ id: noteId }).first();
    return hydrate(db, row);
  }
  return posted;
}

async function cancelReceipt(id, args = {}) {
  await requireTables();
  const noteId = String(id || '').trim();
  const key = idempotencyKeyOf(args);
  const actor = actorOf(args);
  return db.transaction(async (trx) => {
    if (key) {
      const replay = await findIdempotency(trx, scopedIdempotencyKey('CANCEL', key));
      if (replay && replay.operation === 'CANCEL') {
        const row = await trx('receipt_note').where({ id: replay.receipt_note_id }).first();
        if (row) return hydrate(trx, row);
      }
    }
    const note = await trx('receipt_note').where({ id: noteId }).forUpdate().first();
    if (!note) throw httpError('Receipt Note not found', 404, 'NOT_FOUND');
    if (note.status === 'CANCELLED') return hydrate(trx, note);
    if (note.status !== 'OPEN') {
      throw httpError('Only OPEN Receipt Notes can be cancelled', 409, 'INVALID_STATUS');
    }
    const now = new Date().toISOString();
    await trx('receipt_note').where({ id: noteId }).update({
      status: 'CANCELLED',
      cancelled_by: actor,
      cancelled_at: now,
      updated_at: now
    });
    await writeReceiptEvent(trx, {
      receiptNoteId: noteId,
      type: 'CANCELLED',
      actor,
      note: trimText(args.reason) || 'Cancelled before post'
    });
    if (key) await storeIdempotency(trx, key, 'CANCEL', noteId);
    const row = await trx('receipt_note').where({ id: noteId }).first();
    return hydrate(trx, row);
  });
}

async function reverseBlockers(runner, noteId) {
  const outputs = await runner('receipt_physical_output').where({ receipt_note_id: noteId }).orderBy('id');
  const blockers = [];
  for (const output of outputs) {
    const table = output.resource_type === 'ASSET' ? 'assets' : 'inventory_items';
    const holding = await runner(table).whereRaw('LOWER(id) = LOWER(?)', [output.resource_id]).first();
    if (!holding) {
      blockers.push({ resourceId: output.resource_id, reason: 'MISSING_HOLDING' });
      continue;
    }
    const reserved = qtyNum(holding.quantity_reserved);
    const converted = qtyNum(holding.quantity_converted);
    const available = qtyNum(holding.quantity_available);
    const total = qtyNum(holding.quantity_total);
    if (reserved > 1e-9) blockers.push({ resourceId: holding.id, reason: 'RESERVED', reserved });
    if (converted > 1e-9) blockers.push({ resourceId: holding.id, reason: 'CONVERTED', converted });
    if (Math.abs(available - total) > 1e-9) {
      blockers.push({ resourceId: holding.id, reason: 'QUANTITY_COMMITTED', available, total });
    }
    if (output.resource_type === 'ASSET') {
      if (nonempty(holding.assignedto)) blockers.push({ resourceId: holding.id, reason: 'ASSIGNED' });
      if (nonempty(holding.sentagainstdc)) blockers.push({ resourceId: holding.id, reason: 'DISPATCHED' });
    }
    if (await runner.schema.hasTable('reservation')) {
      const rsv = await runner('reservation')
        .where({ resource_type: output.resource_type, status: 'ACTIVE' })
        .whereRaw('LOWER(resource_id) = LOWER(?)', [holding.id])
        .first();
      if (rsv) blockers.push({ resourceId: holding.id, reason: 'RESERVED', reservationId: rsv.id });
    }
    if (await runner.schema.hasTable('conversion')) {
      const conv = await runner('conversion')
        .where({ source_type: output.resource_type, status: 'ACTIVE' })
        .whereRaw('LOWER(source_id) = LOWER(?)', [holding.id])
        .first();
      if (conv) blockers.push({ resourceId: holding.id, reason: 'CONVERTED', conversionId: conv.id });
    }
    if (await runner.schema.hasTable('managed_set_components')) {
      const alloc = output.resource_type === 'ASSET'
        ? await runner('managed_set_components').where({ asset_id: holding.id, is_active: true }).first()
        : await runner('managed_set_components').where({ inventory_item_id: holding.id, is_active: true }).first();
      if (alloc) blockers.push({ resourceId: holding.id, reason: 'SET_ALLOCATED', allocationId: alloc.id });
    }
  }
  return blockers;
}

async function applyHoldingZero(trx, table, id, precision = 0) {
  const result = await trx.raw(
    `
      UPDATE ${table}
      SET quantity_total = 0,
          quantity_available = 0,
          lineage_status = 'INACTIVE',
          quantity_updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(id) = LOWER(?)
        AND ROUND(COALESCE(quantity_reserved, 0)::numeric, ?) = 0
        AND ROUND(COALESCE(quantity_converted, 0)::numeric, ?) = 0
      RETURNING id, quantity_total, quantity_available, quantity_reserved
    `,
    [id, precision, precision]
  );
  const row = result.rows && result.rows[0];
  if (!row) {
    throw httpError(`Cannot reverse ${id}; quantity is not safely reversible`, 409, 'NOT_REVERSIBLE');
  }
  return row;
}

async function reverseReceipt(id, args = {}) {
  await requireTables();
  const noteId = String(id || '').trim();
  const key = idempotencyKeyOf(args);
  const actor = actorOf(args);
  return db.transaction(async (trx) => {
    if (key) {
      const replay = await findIdempotency(trx, scopedIdempotencyKey('REVERSE', key));
      if (replay && replay.operation === 'REVERSE') {
        const row = await trx('receipt_note').where({ id: replay.receipt_note_id }).first();
        if (row) return hydrate(trx, row);
      }
    }
    const note = await trx('receipt_note').where({ id: noteId }).forUpdate().first();
    if (!note) throw httpError('Receipt Note not found', 404, 'NOT_FOUND');
    if (note.status === 'REVERSED') return hydrate(trx, note);
    if (note.status !== 'POSTED') {
      throw httpError('Only POSTED Receipt Notes can be reversed', 409, 'INVALID_STATUS');
    }
    const blockers = await reverseBlockers(trx, note.id);
    if (blockers.length) {
      throw httpError(
        'Receipt cannot be reversed because physical quantity is operationally committed',
        409,
        'NOT_REVERSIBLE',
        { blockers }
      );
    }
    const outputs = await trx('receipt_physical_output').where({ receipt_note_id: note.id }).orderBy('id');
    for (const output of outputs) {
      const table = output.resource_type === 'ASSET' ? 'assets' : 'inventory_items';
      const holding = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [output.resource_id]).forUpdate().first();
      const qty = qtyNum(holding.quantity_total);
      await applyHoldingZero(trx, table, holding.id);
      await writeQuantityEvent(trx, {
        table,
        rootId: holding.quantity_root_id || holding.id,
        type: EVENT_TYPES.ADJUST,
        actor,
        note: `Receipt reversal ${note.id}`,
        metadata: { receipt_note_id: note.id, receipt_line_id: output.receipt_line_id, reversal: true },
        lines: [{
          id: holding.id,
          unit: holding.quantity_unit || 'Nos',
          deltaAvailable: -qty,
          deltaTotal: -qty
        }]
      });
      if (output.resource_type === 'ASSET') {
        await writeAssetHistory(
          trx,
          holding.id,
          'RECEIPT_REVERSE',
          note.id,
          holding.id,
          actor,
          `Quantity reversed; identity preserved. Receipt ${note.id}`
        );
      }
    }
    const now = new Date().toISOString();
    await trx('receipt_note').where({ id: note.id }).update({
      status: 'REVERSED',
      reversed_by: actor,
      reversed_at: now,
      updated_at: now
    });
    await writeReceiptEvent(trx, {
      receiptNoteId: note.id,
      type: 'REVERSED',
      actor,
      note: trimText(args.reason) || 'Receipt reversed',
      metadata: { preservedIds: outputs.map((o) => o.resource_id) }
    });
    if (key) await storeIdempotency(trx, key, 'REVERSE', note.id);
    const row = await trx('receipt_note').where({ id: note.id }).first();
    return hydrate(trx, row);
  });
}

async function listHistory(id) {
  const hydrated = await getReceiptNote(id);
  return { receiptNoteId: hydrated.receiptNote.id, events: hydrated.events };
}

module.exports = {
  NOTE_STATUSES,
  CREATION_MODES,
  createReceiptNote,
  updateReceiptNote,
  getReceiptNote,
  listReceiptNotes,
  getPoBalance,
  postReceipt,
  cancelReceipt,
  reverseReceipt,
  listHistory,
  tablesReady,
  qtyNum,
  roundQty
};
