/**
 * Manufacturer serials as notations under a holding (ADR-SERIAL-IDENTITY-001, rekeyed).
 * PK: (resource_type, resource_id, sort_order). No generated SER- ids.
 * Legacy assets.srno / inventory_items.srno remain mirrors.
 */
const path = require('path');
const fs = require('fs');
const { db } = require('../utils');
const encryptionService = require('./encryptionService');

const RESOURCE_TYPES = Object.freeze(['ASSET', 'INVENTORY']);
const STATUSES = Object.freeze(['ACTIVE', 'RETIRED', 'LOST', 'CONSUMED']);
const SOURCES = Object.freeze(['MIGRATED_SRNO', 'MANUAL', 'RECEIPT', 'INTAKE']);

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

function normalizeResourceType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (!RESOURCE_TYPES.includes(t)) {
    throw httpError('resourceType must be ASSET or INVENTORY', 400, 'INVALID_RESOURCE_TYPE');
  }
  return t;
}

function parseSerialTokens(raw) {
  if (raw == null) return [];
  let text = String(raw);
  try {
    const decrypted = encryptionService.universalDecrypt(text);
    if (decrypted != null && String(decrypted).trim() !== '') text = String(decrypted);
  } catch (_) { /* keep raw */ }
  const seen = new Set();
  const out = [];
  for (const part of text.split(/[\n,;]+/)) {
    const token = part.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

async function requireTable(runner = db) {
  if (!(await runner.schema.hasTable('serial_identity'))) {
    throw httpError('serial_identity table is not migrated yet', 503, 'NOT_MIGRATED');
  }
}

function tableFor(resourceType) {
  return resourceType === 'ASSET' ? 'assets' : 'inventory_items';
}

async function loadHolding(runner, resourceType, resourceId) {
  const id = trimText(resourceId);
  if (!id) throw httpError('resourceId is required', 400);
  const row = await runner(tableFor(resourceType))
    .whereRaw('LOWER(id) = LOWER(?)', [id])
    .first();
  if (!row) throw httpError(`${resourceType} not found: ${id}`, 404, 'HOLDING_NOT_FOUND');
  return row;
}

function publicSerial(row) {
  if (!row) return null;
  return {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    productId: row.product_id || null,
    serialValue: row.serial_value,
    status: row.status,
    sortOrder: row.sort_order,
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listForHolding(resourceType, resourceId, { includeInactive = false } = {}) {
  await requireTable();
  const type = normalizeResourceType(resourceType);
  const id = trimText(resourceId);
  if (!id) throw httpError('resourceId is required', 400);
  let q = db('serial_identity')
    .where({ resource_type: type })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [id])
    .orderBy('sort_order');
  if (!includeInactive) q = q.where({ status: 'ACTIVE' });
  const rows = await q;
  return { serials: rows.map(publicSerial) };
}

async function findBySerialValue(qText, { limit = 50 } = {}) {
  await requireTable();
  const q = trimText(qText);
  if (!q || q.length < 2) return { serials: [] };
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await db('serial_identity')
    .where({ status: 'ACTIVE' })
    .whereRaw('lower(serial_value) LIKE ?', [`%${q.toLowerCase()}%`])
    .orderBy('serial_value')
    .limit(lim);
  return { serials: rows.map(publicSerial) };
}

async function syncMirrorToHolding(trx, resourceType, resourceId) {
  await requireTable(trx);
  const type = normalizeResourceType(resourceType);
  const holding = await loadHolding(trx, type, resourceId);
  const active = await trx('serial_identity')
    .where({
      resource_type: type,
      resource_id: holding.id,
      status: 'ACTIVE'
    })
    .orderBy('sort_order');
  const joined = active.map((r) => r.serial_value).join(', ');
  if (type === 'ASSET') {
    const encrypted = joined ? encryptionService.encryptDeterministic(joined) : '';
    await trx('assets').where({ id: holding.id }).update({
      srno: encrypted || null,
      serialno: encrypted || null
    });
  } else {
    await trx('inventory_items').where({ id: holding.id }).update({
      srno: joined || null
    });
  }
  return joined;
}

async function assertUniqueActive(trx, { productId, resourceType, resourceId, serialValue, excludeSortOrder }) {
  const valueKey = serialValue.toLowerCase();
  if (productId) {
    let q = trx('serial_identity')
      .where({ status: 'ACTIVE', product_id: productId })
      .whereRaw('lower(serial_value) = ?', [valueKey]);
    if (excludeSortOrder != null) {
      q = q.whereNot(function () {
        this.where({ resource_type: resourceType, resource_id: resourceId, sort_order: excludeSortOrder });
      });
    }
    const hit = await q.first();
    if (hit) {
      throw httpError(
        `Active serial already exists for this product: ${serialValue}`,
        409,
        'SERIAL_PRODUCT_CONFLICT',
        {
          resourceType: hit.resource_type,
          resourceId: hit.resource_id,
          sortOrder: hit.sort_order
        }
      );
    }
  }
  let hq = trx('serial_identity')
    .where({ status: 'ACTIVE', resource_type: resourceType, resource_id: resourceId })
    .whereRaw('lower(serial_value) = ?', [valueKey]);
  if (excludeSortOrder != null) hq = hq.whereNot({ sort_order: excludeSortOrder });
  const holdingHit = await hq.first();
  if (holdingHit) {
    throw httpError(
      `Active serial already exists on this holding: ${serialValue}`,
      409,
      'SERIAL_HOLDING_CONFLICT',
      { sortOrder: holdingHit.sort_order }
    );
  }
}

async function nextSortOrder(trx, resourceType, resourceId) {
  const maxSort = await trx('serial_identity')
    .where({ resource_type: resourceType, resource_id: resourceId })
    .max('sort_order as m')
    .first();
  return Number((maxSort && maxSort.m) != null ? maxSort.m : -1) + 1;
}

async function addSerial(args = {}) {
  await requireTable();
  const type = normalizeResourceType(args.resourceType);
  const serialValue = trimText(args.serialValue || args.serial || args.srno);
  if (!serialValue) throw httpError('serialValue is required', 400, 'INVALID_SERIAL');
  const source = trimText(args.source) || 'MANUAL';
  if (!SOURCES.includes(source)) throw httpError('Invalid source', 400, 'INVALID_SOURCE');
  const actor = actorOf(args);

  return db.transaction(async (trx) => {
    const holding = await loadHolding(trx, type, args.resourceId);
    const productId = trimText(args.productId) || holding.product_id || null;
    await assertUniqueActive(trx, {
      productId,
      resourceType: type,
      resourceId: holding.id,
      serialValue
    });
    const sortOrder = args.sortOrder != null
      ? Number(args.sortOrder)
      : await nextSortOrder(trx, type, holding.id);
    const now = new Date().toISOString();
    await trx('serial_identity').insert({
      resource_type: type,
      resource_id: holding.id,
      product_id: productId,
      serial_value: serialValue,
      status: 'ACTIVE',
      sort_order: sortOrder,
      source,
      created_by: actor,
      created_at: now,
      updated_at: now
    });
    await syncMirrorToHolding(trx, type, holding.id);
    const row = await trx('serial_identity')
      .where({ resource_type: type, resource_id: holding.id, sort_order: sortOrder })
      .first();
    return { serial: publicSerial(row) };
  });
}

async function retireSerial(args = {}) {
  await requireTable();
  const type = normalizeResourceType(args.resourceType);
  const resourceId = trimText(args.resourceId);
  const sortOrder = Number(args.sortOrder);
  if (!resourceId || !Number.isFinite(sortOrder)) {
    throw httpError('resourceType, resourceId, and sortOrder are required', 400);
  }
  const status = trimText(args.status) || 'RETIRED';
  if (!['RETIRED', 'LOST', 'CONSUMED'].includes(status)) {
    throw httpError('status must be RETIRED, LOST, or CONSUMED', 400, 'INVALID_STATUS');
  }
  return db.transaction(async (trx) => {
    const holding = await loadHolding(trx, type, resourceId);
    const row = await trx('serial_identity')
      .where({
        resource_type: type,
        resource_id: holding.id,
        sort_order: sortOrder
      })
      .forUpdate()
      .first();
    if (!row) throw httpError('Serial not found', 404, 'NOT_FOUND');
    if (row.status !== 'ACTIVE') return { serial: publicSerial(row) };
    const now = new Date().toISOString();
    await trx('serial_identity')
      .where({
        resource_type: type,
        resource_id: holding.id,
        sort_order: sortOrder
      })
      .update({ status, updated_at: now });
    await syncMirrorToHolding(trx, type, holding.id);
    const updated = await trx('serial_identity')
      .where({ resource_type: type, resource_id: holding.id, sort_order: sortOrder })
      .first();
    return { serial: publicSerial(updated) };
  });
}

/**
 * Replace ACTIVE serials for a holding from textarea / comma list.
 * Creates one row per token with contiguous sort_order 0..n-1.
 */
async function replaceSerialsFromText(resourceType, resourceId, rawSrno, args = {}) {
  await requireTable();
  const type = normalizeResourceType(resourceType);
  const tokens = parseSerialTokens(rawSrno);
  const source = trimText(args.source) || 'MANUAL';
  const actor = actorOf(args);

  return db.transaction(async (trx) => {
    const holding = await loadHolding(trx, type, resourceId);
    const productId = holding.product_id || null;
    const now = new Date().toISOString();

    // Retire all current ACTIVE rows for this holding
    await trx('serial_identity')
      .where({ resource_type: type, resource_id: holding.id, status: 'ACTIVE' })
      .update({ status: 'RETIRED', updated_at: now });

    // Clear sort_order space: move retired rows to high negative slots temporarily
    const retired = await trx('serial_identity')
      .where({ resource_type: type, resource_id: holding.id })
      .orderBy('sort_order');
    let neg = -1000;
    for (const r of retired) {
      await trx('serial_identity')
        .where({
          resource_type: type,
          resource_id: holding.id,
          sort_order: r.sort_order,
          serial_value: r.serial_value
        })
        .update({ sort_order: neg });
      neg -= 1;
    }

    let sort = 0;
    for (const token of tokens) {
      await assertUniqueActive(trx, {
        productId,
        resourceType: type,
        resourceId: holding.id,
        serialValue: token
      });
      // Reactivate matching retired row if same value exists, else insert
      const prior = await trx('serial_identity')
        .where({ resource_type: type, resource_id: holding.id })
        .whereRaw('lower(serial_value) = ?', [token.toLowerCase()])
        .orderBy('sort_order', 'desc')
        .first();
      if (prior) {
        await trx('serial_identity')
          .where({
            resource_type: type,
            resource_id: holding.id,
            sort_order: prior.sort_order,
            serial_value: prior.serial_value
          })
          .update({
            status: 'ACTIVE',
            sort_order: sort,
            product_id: productId,
            updated_at: now
          });
      } else {
        await trx('serial_identity').insert({
          resource_type: type,
          resource_id: holding.id,
          product_id: productId,
          serial_value: token,
          status: 'ACTIVE',
          sort_order: sort,
          source,
          created_by: actor,
          created_at: now,
          updated_at: now
        });
      }
      sort += 1;
    }

    await syncMirrorToHolding(trx, type, holding.id);
    const rows = await trx('serial_identity')
      .where({ resource_type: type, resource_id: holding.id, status: 'ACTIVE' })
      .orderBy('sort_order');
    return { serials: rows.map(publicSerial) };
  });
}

async function backfillFromLegacySrno({ reportPath } = {}) {
  await requireTable();
  const report = {
    startedAt: new Date().toISOString(),
    assetsScanned: 0,
    inventoryScanned: 0,
    inserted: 0,
    skippedEmpty: 0,
    skippedConflict: 0,
    conflicts: [],
    errors: []
  };

  async function migrateHolding(type, row) {
    const tokens = parseSerialTokens(row.srno || row.serialno || '');
    if (!tokens.length) {
      report.skippedEmpty += 1;
      return;
    }
    try {
      const result = await replaceSerialsFromText(type, row.id, tokens.join(', '), {
        source: 'MIGRATED_SRNO',
        actor: 'backfill'
      });
      report.inserted += (result.serials || []).length;
    } catch (err) {
      report.errors.push({ resourceType: type, resourceId: row.id, message: err.message });
    }
  }

  const assets = await db('assets')
    .where(function () {
      this.whereNotNull('srno').orWhereNotNull('serialno');
    })
    .select('id', 'srno', 'serialno', 'product_id');
  report.assetsScanned = assets.length;
  for (const row of assets) await migrateHolding('ASSET', row);

  if (await db.schema.hasTable('inventory_items')) {
    const inventory = await db('inventory_items')
      .whereNotNull('srno')
      .select('id', 'srno', 'product_id');
    report.inventoryScanned = inventory.length;
    for (const row of inventory) await migrateHolding('INVENTORY', row);
  }

  report.finishedAt = new Date().toISOString();
  const out = reportPath
    || path.join(__dirname, '..', 'scripts', 'reports', `serial-identity-backfill-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  report.reportPath = out;
  return report;
}

module.exports = {
  listForHolding,
  findBySerialValue,
  addSerial,
  retireSerial,
  replaceSerialsFromText,
  syncMirrorToHolding,
  parseSerialTokens,
  backfillFromLegacySrno,
  RESOURCE_TYPES,
  STATUSES,
  SOURCES
};
