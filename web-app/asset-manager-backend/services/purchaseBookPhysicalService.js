/**
 * Purchase Book ↔ physical holding (+ optional serial notation) allocation.
 * Serial rows are addressed by (resource_type, resource_id, sort_order) — no SER- ids.
 */
const { db } = require('../utils');
const serialIdentityService = require('./serialIdentityService');

async function writePhysicalBookEvent(trx, payload) {
  if (!(await trx.schema.hasTable('purchase_book_event'))) return null;
  await trx('purchase_book_event').insert({
    purchase_book_id: payload.purchaseBookId,
    purchase_book_line_id: payload.purchaseBookLineId || null,
    type: payload.type,
    actor: payload.actor || null,
    timestamp: new Date().toISOString(),
    note: payload.note || null,
    metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
  });
}

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function trimText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function actorOf(args) {
  return trimText(args && (args.actor || args.username || args.user)) || 'web';
}

function qtyNum(value) {
  if (value == null || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw httpError('qtyAllocated must be > 0', 400, 'INVALID_QTY');
  return n;
}

function normalizeResourceType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (t !== 'ASSET' && t !== 'INVENTORY') {
    throw httpError('resourceType must be ASSET or INVENTORY', 400, 'INVALID_RESOURCE_TYPE');
  }
  return t;
}

async function requireTable(runner = db) {
  if (!(await runner.schema.hasTable('purchase_book_physical'))) {
    throw httpError('purchase_book_physical is not migrated yet', 503, 'NOT_MIGRATED');
  }
}

function publicPhysical(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseBookId: row.purchase_book_id,
    purchaseBookLineId: row.purchase_book_line_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    serialSortOrder: row.serial_sort_order == null ? null : Number(row.serial_sort_order),
    qtyAllocated: Number(row.qty_allocated),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

async function loadHoldingLabel(runner, resourceType, resourceId) {
  if (resourceType === 'ASSET') {
    const row = await runner('assets')
      .whereRaw('LOWER(id) = LOWER(?)', [resourceId])
      .select('id', 'itemname', 'product_id', 'srno')
      .first();
    if (!row) throw httpError(`Asset not found: ${resourceId}`, 404, 'HOLDING_NOT_FOUND');
    return {
      resourceId: row.id,
      label: row.itemname || row.id,
      productId: row.product_id || null
    };
  }
  const row = await runner('inventory_items')
    .whereRaw('LOWER(id) = LOWER(?)', [resourceId])
    .select('id', 'itemname', 'product_id', 'srno')
    .first();
  if (!row) throw httpError(`Inventory not found: ${resourceId}`, 404, 'HOLDING_NOT_FOUND');
  return {
    resourceId: row.id,
    label: row.itemname || row.id,
    productId: row.product_id || null
  };
}

async function resolveSerialValue(runner, resourceType, resourceId, serialSortOrder) {
  if (serialSortOrder == null) return null;
  if (!(await runner.schema.hasTable('serial_identity'))) return null;
  const row = await runner('serial_identity')
    .where({
      resource_type: resourceType,
      resource_id: resourceId,
      sort_order: Number(serialSortOrder),
      status: 'ACTIVE'
    })
    .first();
  if (!row) {
    throw httpError(
      `Active serial notation not found for ${resourceType}/${resourceId}#${serialSortOrder}`,
      404,
      'SERIAL_NOT_FOUND'
    );
  }
  return row.serial_value;
}

async function listForBook(purchaseBookId) {
  await requireTable();
  const bookId = trimText(purchaseBookId);
  if (!bookId) throw httpError('purchaseBookId is required', 400);
  const rows = await db('purchase_book_physical')
    .where({ purchase_book_id: bookId, status: 'ACTIVE' })
    .orderBy('id');
  const out = [];
  for (const row of rows) {
    let serialValue = null;
    let label = row.resource_id;
    try {
      const holding = await loadHoldingLabel(db, row.resource_type, row.resource_id);
      label = holding.label;
      serialValue = await resolveSerialValue(db, row.resource_type, row.resource_id, row.serial_sort_order);
    } catch (_) { /* keep ids */ }
    out.push(publicPhysical(row, { label, serialValue }));
  }
  return { physicals: out };
}

async function listForBookLines(runner, bookLineIds) {
  if (!(await runner.schema.hasTable('purchase_book_physical'))) return new Map();
  const ids = [...new Set((bookLineIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await runner('purchase_book_physical')
    .whereIn('purchase_book_line_id', ids)
    .where({ status: 'ACTIVE' })
    .orderBy('id');
  const map = new Map();
  for (const row of rows) {
    let serialValue = null;
    let label = row.resource_id;
    try {
      const holding = await loadHoldingLabel(runner, row.resource_type, row.resource_id);
      label = holding.label;
      serialValue = await resolveSerialValue(
        runner,
        row.resource_type,
        row.resource_id,
        row.serial_sort_order
      );
    } catch (_) { /* keep */ }
    const list = map.get(row.purchase_book_line_id) || [];
    list.push(publicPhysical(row, { label, serialValue }));
    map.set(row.purchase_book_line_id, list);
  }
  return map;
}

/**
 * Allocate a holding (and optional serial notation) to a book line.
 */
async function allocate(args = {}) {
  await requireTable();
  const bookLineId = trimText(args.purchaseBookLineId || args.bookLineId);
  const resourceType = normalizeResourceType(args.resourceType);
  const resourceIdIn = trimText(args.resourceId);
  const actor = actorOf(args);
  if (!bookLineId) throw httpError('purchaseBookLineId is required', 400);
  if (!resourceIdIn) throw httpError('resourceId is required', 400);

  const serialSortOrder = args.serialSortOrder == null || args.serialSortOrder === ''
    ? null
    : Number(args.serialSortOrder);
  if (serialSortOrder != null && !Number.isFinite(serialSortOrder)) {
    throw httpError('serialSortOrder must be a number', 400);
  }
  const qtyAllocated = qtyNum(args.qtyAllocated ?? args.qty ?? 1);

  return db.transaction(async (trx) => {
    const line = await trx('purchase_book_line').where({ id: bookLineId }).forUpdate().first();
    if (!line) throw httpError('Purchase Book line not found', 404, 'BOOK_LINE_NOT_FOUND');
    const book = await trx('purchase_book').where({ id: line.purchase_book_id }).forUpdate().first();
    if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
    if (book.status === 'VOID') {
      throw httpError('Cannot allocate physical to a VOID book', 409, 'BOOK_VOID');
    }

    const holding = await loadHoldingLabel(trx, resourceType, resourceIdIn);
    if (line.product_id && holding.productId && line.product_id !== holding.productId) {
      throw httpError(
        'Holding product_id does not match book line product',
        409,
        'PRODUCT_MISMATCH',
        { lineProductId: line.product_id, holdingProductId: holding.productId }
      );
    }

    let serialValue = null;
    if (serialSortOrder != null) {
      serialValue = await resolveSerialValue(trx, resourceType, holding.resourceId, serialSortOrder);
    }

    // Prevent double-booking same serial across ACTIVE book physicals
    if (serialSortOrder != null) {
      const clash = await trx('purchase_book_physical')
        .where({
          status: 'ACTIVE',
          resource_type: resourceType,
          resource_id: holding.resourceId,
          serial_sort_order: serialSortOrder
        })
        .whereNot({ purchase_book_line_id: bookLineId })
        .first();
      if (clash) {
        throw httpError(
          'This serial is already allocated on another Purchase Book line',
          409,
          'SERIAL_ALREADY_ALLOCATED',
          { purchaseBookLineId: clash.purchase_book_line_id }
        );
      }
    }

    const now = new Date().toISOString();
    const existing = await trx('purchase_book_physical')
      .where({
        purchase_book_line_id: bookLineId,
        resource_type: resourceType,
        resource_id: holding.resourceId,
        status: 'ACTIVE'
      })
      .modify((q) => {
        if (serialSortOrder == null) q.whereNull('serial_sort_order');
        else q.where({ serial_sort_order: serialSortOrder });
      })
      .first();

    if (existing) {
      await trx('purchase_book_physical').where({ id: existing.id }).update({
        qty_allocated: qtyAllocated,
        updated_at: now
      });
      const row = await trx('purchase_book_physical').where({ id: existing.id }).first();
      return { physical: publicPhysical(row, { label: holding.label, serialValue }) };
    }

    await trx('purchase_book_physical').insert({
      purchase_book_id: book.id,
      purchase_book_line_id: bookLineId,
      resource_type: resourceType,
      resource_id: holding.resourceId,
      serial_sort_order: serialSortOrder,
      qty_allocated: qtyAllocated,
      status: 'ACTIVE',
      created_by: actor,
      created_at: now,
      updated_at: now
    });

    const row = await trx('purchase_book_physical')
      .where({
        purchase_book_line_id: bookLineId,
        resource_type: resourceType,
        resource_id: holding.resourceId,
        status: 'ACTIVE'
      })
      .modify((q) => {
        if (serialSortOrder == null) q.whereNull('serial_sort_order');
        else q.where({ serial_sort_order: serialSortOrder });
      })
      .orderBy('id', 'desc')
      .first();

    try {
      await writePhysicalBookEvent(trx, {
        purchaseBookId: book.id,
        purchaseBookLineId: bookLineId,
        type: 'PHYSICAL_ALLOCATED',
        actor,
        note: serialValue
          ? `Allocated SN ${serialValue} on ${resourceType} ${holding.resourceId}`
          : `Allocated ${resourceType} ${holding.resourceId}`,
        metadata: {
          resourceType,
          resourceId: holding.resourceId,
          serialSortOrder,
          serialValue,
          qtyAllocated
        }
      });
    } catch (_) { /* event table may be missing */ }

    return { physical: publicPhysical(row, { label: holding.label, serialValue }) };
  });
}

async function release(physicalId, args = {}) {
  await requireTable();
  const id = Number(physicalId);
  if (!Number.isFinite(id)) throw httpError('Invalid physical allocation id', 400);
  const actor = actorOf(args);
  const now = new Date().toISOString();
  return db.transaction(async (trx) => {
    const existing = await trx('purchase_book_physical').where({ id, status: 'ACTIVE' }).forUpdate().first();
    if (!existing) throw httpError('Active physical allocation not found', 404, 'NOT_FOUND');
    await trx('purchase_book_physical').where({ id }).update({ status: 'RELEASED', updated_at: now });
    try {
      await writePhysicalBookEvent(trx, {
        purchaseBookId: existing.purchase_book_id,
        purchaseBookLineId: existing.purchase_book_line_id,
        type: 'PHYSICAL_RELEASED',
        actor,
        note: `Released ${existing.resource_type} ${existing.resource_id}`,
        metadata: {
          physicalId: id,
          resourceType: existing.resource_type,
          resourceId: existing.resource_id,
          serialSortOrder: existing.serial_sort_order
        }
      });
    } catch (_) { /* optional */ }
    return { released: true, id, actor };
  });
}

/**
 * Candidate holdings for a product (for PB allocate UI).
 */
async function searchHoldingsForProduct(productId, { q, limit = 40 } = {}) {
  const pid = trimText(productId);
  if (!pid) throw httpError('productId is required', 400);
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const term = trimText(q);
  const out = [];

  let assetsQ = db('assets')
    .where({ product_id: pid })
    .where(function () {
      this.whereNull('is_retired').orWhere('is_retired', 0);
    })
    .select('id', 'itemname', 'product_id', 'status')
    .limit(lim);
  if (term) {
    const like = `%${term}%`;
    assetsQ = assetsQ.andWhere(function () {
      this.whereILike('id', like).orWhereILike('itemname', like);
    });
  }
  const assets = await assetsQ;
  for (const a of assets) {
    let serials = [];
    try {
      const r = await serialIdentityService.listForHolding('ASSET', a.id);
      serials = (r.serials || []).map((s) => ({
        sortOrder: s.sortOrder,
        serialValue: s.serialValue
      }));
    } catch (_) { /* table missing */ }
    out.push({
      resourceType: 'ASSET',
      resourceId: a.id,
      label: a.itemname || a.id,
      status: a.status,
      serials
    });
  }

  if (await db.schema.hasTable('inventory_items')) {
    let invQ = db('inventory_items')
      .where({ product_id: pid })
      .select('id', 'itemname', 'product_id', 'status')
      .limit(lim);
    if (term) {
      const like = `%${term}%`;
      invQ = invQ.andWhere(function () {
        this.whereILike('id', like).orWhereILike('itemname', like);
      });
    }
    const inv = await invQ;
    for (const i of inv) {
      let serials = [];
      try {
        const r = await serialIdentityService.listForHolding('INVENTORY', i.id);
        serials = (r.serials || []).map((s) => ({
          sortOrder: s.sortOrder,
          serialValue: s.serialValue
        }));
      } catch (_) { /* ignore */ }
      out.push({
        resourceType: 'INVENTORY',
        resourceId: i.id,
        label: i.itemname || i.id,
        status: i.status,
        serials
      });
    }
  }

  return { holdings: out.slice(0, lim) };
}

module.exports = {
  listForBook,
  listForBookLines,
  allocate,
  release,
  searchHoldingsForProduct,
  publicPhysical
};
