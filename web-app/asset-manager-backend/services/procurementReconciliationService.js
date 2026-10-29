/**
 * Commercial vs physical reconciliation after post-commit PO revision.
 *
 * Physical history (RN POSTED, Asset/Inventory) is never rewritten.
 * Operator resolves excess with RETURN_TO_VENDOR or RETAIN_IN_CINEOM.
 *
 * Idempotency: at most one non-CLOSED PREC per PO line. Repeated PO revisions
 * update commercial_quantity / difference on that row — they never stack open PRECs.
 */
const {
  db,
  generateProcurementReconciliationId,
  verifyProcurementReconciliationId
} = require('../utils');

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function qtyNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(v, precision = 6) {
  const p = Math.min(6, Math.max(0, parseInt(precision, 10) || 0));
  const n = qtyNum(v);
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function trimText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) throw httpError(`Non-canonical ${label} id: ${id}`, 500);
    if (!(await trx(table).where({ id }).first())) return id;
  }
  throw httpError(`Could not allocate ${label} ID`, 500);
}

async function writeEvent(trx, reconId, type, actor, note, metadata) {
  if (!(await trx.schema.hasTable('procurement_reconciliation_event'))) return;
  await trx('procurement_reconciliation_event').insert({
    procurement_reconciliation_id: reconId,
    type,
    actor: actor || null,
    timestamp: new Date().toISOString(),
    note: note || null,
    metadata_json: metadata ? JSON.stringify(metadata) : null
  });
}

function publicRecon(row) {
  if (!row) return null;
  const commercial = qtyNum(row.commercial_quantity);
  const received = qtyNum(row.physical_received_quantity);
  const returned = qtyNum(row.physically_returned_quantity);
  const retained = qtyNum(row.retained_quantity);
  const difference = roundQty(Math.max(0, received - commercial - returned - retained));
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    poFamilyId: row.po_family_id,
    poVersionId: row.po_version_id,
    procurementPoId: row.procurement_po_id,
    procurementPoLineId: row.procurement_po_line_id,
    productId: row.product_id,
    poNumber: row.po_number_snapshot,
    vendorName: row.vendor_name_snapshot,
    commercialQuantity: commercial,
    physicalReceivedQuantity: received,
    physicallyReturnedQuantity: returned,
    retainedQuantity: retained,
    differenceQuantity: difference,
    status: row.status,
    resolutionType: row.resolution_type,
    resolutionReason: row.resolution_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at
  };
}

async function schemaReady() {
  return db.schema.hasTable('procurement_reconciliation');
}

/** Active (non-CLOSED) reconciliation for a PO line — at most one by unique index. */
async function findActiveRecon(trx, poLineId) {
  return trx('procurement_reconciliation')
    .where({ procurement_po_line_id: poLineId })
    .whereNot('status', 'CLOSED')
    .forUpdate()
    .first();
}

/**
 * Open or refresh the single active reconciliation when ordered < accepted.
 * Repeated PO revisions update the same PREC — never stack open rows.
 */
async function syncLineReconciliation(trx, { po, line, actor }) {
  if (!(await trx.schema.hasTable('procurement_reconciliation'))) return null;
  const procurementService = require('./procurementService');
  const accepted = await procurementService.acceptedToDate(trx, line.id);
  const ordered = roundQty(line.ordered_qty);
  const active = await findActiveRecon(trx, line.id);
  const returned = active ? qtyNum(active.physically_returned_quantity) : 0;
  const retained = active ? qtyNum(active.retained_quantity) : 0;
  const difference = roundQty(Math.max(0, accepted - ordered - returned - retained));

  if (difference <= 1e-9) {
    if (active) {
      await trx('procurement_reconciliation').where({ id: active.id }).update({
        commercial_quantity: ordered,
        physical_received_quantity: accepted,
        difference_quantity: 0,
        status: 'CLOSED',
        resolution_type: active.resolution_type === 'NONE' ? 'NONE' : active.resolution_type,
        resolved_at: new Date().toISOString(),
        resolved_by: actor || active.resolved_by,
        updated_at: new Date().toISOString()
      });
      await writeEvent(
        trx,
        active.id,
        'COMMERCIAL_RECONCILIATION_RESOLVED',
        actor,
        'Auto-closed: commercial covers physical after returned/retained'
      );
    }
    return null;
  }

  if (active) {
    let nextStatus = active.status;
    if (String(active.status) === 'OPEN' || String(active.status) === 'RESOLUTION_SELECTED') {
      nextStatus = 'OPEN';
    }
    await trx('procurement_reconciliation').where({ id: active.id }).update({
      commercial_quantity: ordered,
      physical_received_quantity: accepted,
      difference_quantity: difference,
      product_id: line.product_id || active.product_id,
      po_number_snapshot: po.po_number || active.po_number_snapshot,
      vendor_name_snapshot: po.vendor_name_snapshot || po.vendor_name || active.vendor_name_snapshot,
      status: nextStatus,
      updated_at: new Date().toISOString()
    });
    return publicRecon(await trx('procurement_reconciliation').where({ id: active.id }).first());
  }

  const id = await uniquePrefixedId(
    trx,
    'procurement_reconciliation',
    generateProcurementReconciliationId,
    verifyProcurementReconciliationId,
    'Reconciliation'
  );
  await trx('procurement_reconciliation').insert({
    id,
    source_type: 'PROCUREMENT_PO_LINE',
    source_id: line.id,
    po_family_id: null,
    po_version_id: null,
    procurement_po_id: po.id,
    procurement_po_line_id: line.id,
    product_id: line.product_id || null,
    po_number_snapshot: po.po_number || null,
    vendor_name_snapshot: po.vendor_name_snapshot || po.vendor_name || null,
    commercial_quantity: ordered,
    physical_received_quantity: accepted,
    physically_returned_quantity: 0,
    retained_quantity: 0,
    difference_quantity: difference,
    status: 'OPEN',
    resolution_type: 'NONE',
    created_by: actor || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  await writeEvent(trx, id, 'COMMERCIAL_RECONCILIATION_OPENED', actor, `Excess ${difference}: received ${accepted} vs commercial ${ordered}`, {
    procurementPoId: po.id,
    procurementPoLineId: line.id,
    commercialQuantity: ordered,
    physicalReceivedQuantity: accepted,
    differenceQuantity: difference
  });
  return publicRecon(await trx('procurement_reconciliation').where({ id }).first());
}

async function syncPoReconciliations(poId, actor) {
  if (!(await schemaReady())) return { reconciliations: [] };
  const po = await db('procurement_po').where({ id: poId }).first();
  if (!po) return { reconciliations: [] };
  const lines = await db('procurement_po_line').where({ procurement_po_id: poId });
  const out = [];
  await db.transaction(async (trx) => {
    for (const line of lines) {
      const r = await syncLineReconciliation(trx, { po, line, actor });
      if (r) out.push(r);
    }
  });
  return { reconciliations: out };
}

async function listReconciliations(filters = {}) {
  if (!(await schemaReady())) return { reconciliations: [] };
  let q = db('procurement_reconciliation').orderBy('created_at', 'desc');
  if (filters.status) q = q.andWhere('status', String(filters.status).toUpperCase());
  if (filters.poId) q = q.andWhere('procurement_po_id', String(filters.poId));
  if (filters.poLineId) q = q.andWhere('procurement_po_line_id', String(filters.poLineId));
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const rows = await q.limit(limit);
  return { reconciliations: rows.map(publicRecon) };
}

async function getReconciliation(id) {
  if (!(await schemaReady())) throw httpError('Schema pending', 503, 'SCHEMA_PENDING');
  const row = await db('procurement_reconciliation').where({ id: String(id).trim() }).first();
  if (!row) throw httpError('Reconciliation not found', 404, 'NOT_FOUND');
  const events = await db('procurement_reconciliation_event')
    .where({ procurement_reconciliation_id: row.id })
    .orderBy('id', 'desc')
    .limit(100);
  let vendorReturns = [];
  if (await db.schema.hasTable('vendor_return')) {
    vendorReturns = await db('vendor_return')
      .where({ procurement_reconciliation_id: row.id })
      .orderBy('created_at', 'desc');
  }
  return {
    reconciliation: publicRecon(row),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      timestamp: e.timestamp,
      note: e.note,
      metadata: e.metadata_json
        ? (() => {
            try {
              return JSON.parse(e.metadata_json);
            } catch (_) {
              return e.metadata_json;
            }
          })()
        : null
    })),
    vendorReturns: vendorReturns.map((v) => ({
      id: v.id,
      status: v.status,
      returnReason: v.return_reason,
      createdAt: v.created_at,
      dispatchedAt: v.dispatched_at
    }))
  };
}

async function pendingVendorReturnQty(trx, reconId) {
  if (!(await trx.schema.hasTable('vendor_return_line'))) return 0;
  const rows = await trx('vendor_return_line as l')
    .join('vendor_return as v', 'v.id', 'l.vendor_return_id')
    .where('l.procurement_reconciliation_id', reconId)
    .whereIn('v.status', ['OPEN', 'READY'])
    .select('l.quantity');
  return rows.reduce((s, r) => s + qtyNum(r.quantity), 0);
}

async function retainInCineom(reconId, args = {}) {
  const actor = trimText(args.actor) || 'web';
  const qty = args.quantity != null ? roundQty(args.quantity) : null;
  const reason = trimText(args.reason) || 'Vendor will not accept return; retained in Cineom';

  return db.transaction(async (trx) => {
    const row = await trx('procurement_reconciliation').where({ id: reconId }).forUpdate().first();
    if (!row) throw httpError('Reconciliation not found', 404, 'NOT_FOUND');
    if (String(row.status) === 'CLOSED') {
      throw httpError('Reconciliation already CLOSED', 409, 'INVALID_STATUS');
    }
    const pending = await pendingVendorReturnQty(trx, row.id);
    const commercial = qtyNum(row.commercial_quantity);
    const received = qtyNum(row.physical_received_quantity);
    const returned = qtyNum(row.physically_returned_quantity);
    const alreadyRetained = qtyNum(row.retained_quantity);
    const openDiff = roundQty(Math.max(0, received - commercial - returned - alreadyRetained - pending));
    const retainQty = qty == null ? openDiff : qty;
    if (!(retainQty > 0)) throw httpError('Retain quantity must be > 0', 400, 'INVALID_QUANTITY');
    if (retainQty - openDiff > 1e-9) {
      throw httpError(
        `Retain ${retainQty} exceeds open difference ${openDiff}`,
        409,
        'OVER_RETAIN',
        { openDiff, retainQty, pendingVendorReturn: pending }
      );
    }
    const nextRetained = roundQty(alreadyRetained + retainQty);
    const nextDiff = roundQty(Math.max(0, received - commercial - returned - nextRetained));
    const now = new Date().toISOString();
    const closed = nextDiff <= 1e-9;
    await trx('procurement_reconciliation').where({ id: row.id }).update({
      retained_quantity: nextRetained,
      difference_quantity: nextDiff,
      status: closed ? 'CLOSED' : 'RETAINED',
      resolution_type: returned > 0 ? 'MIXED' : 'RETAIN_IN_CINEOM',
      resolution_reason: reason,
      resolved_by: closed ? actor : row.resolved_by,
      resolved_at: closed ? now : row.resolved_at,
      updated_at: now
    });
    await writeEvent(trx, row.id, 'COMMERCIAL_RECONCILIATION_RESOLVED', actor, `Retained ${retainQty} in Cineom`, {
      retainQty,
      nextRetained,
      nextDiff,
      closed
    });
    return publicRecon(await trx('procurement_reconciliation').where({ id: row.id }).first());
  });
}

async function applyVendorReturnDispatched(trx, reconId, qty, actor) {
  const row = await trx('procurement_reconciliation').where({ id: reconId }).forUpdate().first();
  if (!row) throw httpError('Reconciliation not found', 404, 'NOT_FOUND');
  if (String(row.status) === 'CLOSED') {
    throw httpError('Reconciliation already CLOSED', 409, 'INVALID_STATUS');
  }
  const commercial = qtyNum(row.commercial_quantity);
  const received = qtyNum(row.physical_received_quantity);
  const returned = qtyNum(row.physically_returned_quantity);
  const retained = qtyNum(row.retained_quantity);
  const openDiff = roundQty(Math.max(0, received - commercial - returned - retained));
  const q = roundQty(qty);
  if (q - openDiff > 1e-9) {
    throw httpError(`Vendor return ${q} exceeds open difference ${openDiff}`, 409, 'OVER_RETURN');
  }
  const nextReturned = roundQty(returned + q);
  const nextDiff = roundQty(Math.max(0, received - commercial - nextReturned - retained));
  const now = new Date().toISOString();
  const closed = nextDiff <= 1e-9;
  await trx('procurement_reconciliation').where({ id: row.id }).update({
    physically_returned_quantity: nextReturned,
    difference_quantity: nextDiff,
    status: closed ? 'CLOSED' : 'RETURNED_TO_VENDOR',
    resolution_type: retained > 0 ? 'MIXED' : 'RETURN_TO_VENDOR',
    resolved_by: closed ? actor : row.resolved_by,
    resolved_at: closed ? now : row.resolved_at,
    updated_at: now
  });
  await writeEvent(trx, row.id, 'COMMERCIAL_RECONCILIATION_RESOLVED', actor, `Vendor return dispatched ${q}`, {
    returnedQty: q,
    nextReturned,
    nextDiff,
    closed
  });
  return publicRecon(await trx('procurement_reconciliation').where({ id: row.id }).first());
}

async function markReturnPending(trx, reconId, actor) {
  const row = await trx('procurement_reconciliation').where({ id: reconId }).forUpdate().first();
  if (!row) return null;
  if (String(row.status) === 'CLOSED' && qtyNum(row.difference_quantity) <= 1e-9) {
    return publicRecon(row);
  }
  if (String(row.status) === 'RETURN_PENDING') {
    return publicRecon(row);
  }
  await trx('procurement_reconciliation').where({ id: reconId }).update({
    status: 'RETURN_PENDING',
    resolution_type: 'RETURN_TO_VENDOR',
    updated_at: new Date().toISOString()
  });
  await writeEvent(trx, reconId, 'RESOLUTION_SELECTED', actor, 'Return to vendor selected');
  return publicRecon(await trx('procurement_reconciliation').where({ id: reconId }).first());
}

module.exports = {
  schemaReady,
  publicRecon,
  syncLineReconciliation,
  syncPoReconciliations,
  listReconciliations,
  getReconciliation,
  retainInCineom,
  applyVendorReturnDispatched,
  markReturnPending,
  pendingVendorReturnQty,
  findActiveRecon
};
