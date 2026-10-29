/**
 * Append-only Delivery Challan events for Lifecycle History.
 */
const { db } = require('../utils');

async function writeHoldingHistory(runner, payload) {
  const trx = runner || db;
  const resourceType = String(payload.resourceType || 'ASSET').toUpperCase();
  const resourceId = String(payload.resourceId || '').trim();
  if (!resourceId) return null;
  const actor = payload.actor || 'web';
  const details = [holdingLabel(resourceType, resourceId), payload.details].filter(Boolean).join(' · ');
  if (resourceType === 'ASSET') {
    if (!(await trx.schema.hasTable('asset_history'))) return null;
    await trx('asset_history').insert({
      assetid: resourceId,
      action: payload.action,
      oldvalue: payload.oldValue == null ? null : String(payload.oldValue),
      newvalue: payload.newValue == null ? null : String(payload.newValue),
      user: actor,
      timestamp: new Date().toISOString(),
      details
    });
    return resourceId;
  }
  if (!(await trx.schema.hasTable('inventory_quantity_events'))) return null;
  await trx('inventory_quantity_events').insert({
    root_id: resourceId,
    type: payload.action,
    actor,
    timestamp: new Date().toISOString(),
    note: details,
    metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
  });
  return resourceId;
}

async function writeDcEvent(runner, payload) {
  const trx = runner || db;
  if (!(await trx.schema.hasTable('delivery_challan_event'))) return null;
  const inserted = await trx('delivery_challan_event')
    .insert({
      delivery_challan_id: payload.deliveryChallanId,
      type: payload.type,
      actor: payload.actor || null,
      timestamp: new Date().toISOString(),
      note: payload.note || null,
      metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
    })
    .returning('id');
  return Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
}

function holdingLabel(type, id) {
  const rid = String(id || '').trim();
  if (!rid) return '';
  const kind = String(type || '').toUpperCase();
  if (kind === 'ASSET' || kind === 'INVENTORY') return `${kind} ${rid}`;
  return rid;
}

function pushHolding(labels, type, id) {
  const label = holdingLabel(type, id);
  if (label && !labels.includes(label)) labels.push(label);
}

function parseIdList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function holdingsFrom(metadata, assetIds) {
  const labels = [];
  const meta = metadata || {};
  (meta.lines || []).forEach((line) => pushHolding(labels, line.resourceType, line.resourceId));
  (meta.holdings || []).forEach((line) => pushHolding(labels, line.resourceType, line.resourceId || line.id));
  (meta.added || []).forEach((line) => pushHolding(labels, line.resourceType, line.resourceId));
  (meta.removed || []).forEach((line) => pushHolding(labels, line.resourceType, line.resourceId));
  (meta.restored || []).forEach((line) => pushHolding(labels, line.resourceType, line.resourceId));
  (meta.assets || []).forEach((id) => pushHolding(labels, 'ASSET', id));
  (meta.inventory || []).forEach((id) => pushHolding(labels, 'INVENTORY', id));
  if (!labels.length) {
    parseIdList(assetIds).forEach((id) => pushHolding(labels, '', id));
  }
  return labels;
}

function publicDcEvent(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata_json) {
    try { metadata = JSON.parse(row.metadata_json); } catch (_) { metadata = row.metadata_json; }
  }
  return {
    id: row.id,
    deliveryChallanId: row.delivery_challan_id,
    type: row.type,
    actor: row.actor,
    timestamp: row.timestamp,
    note: row.note,
    metadata,
    holdings: holdingsFrom(metadata, row.assetids),
    challanNo: row.challanno || row.challan_no || null
  };
}

async function listHistory(deliveryChallanId) {
  const id = String(deliveryChallanId || '').trim();
  if (!id) {
    const err = new Error('deliveryChallanId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!(await db.schema.hasTable('delivery_challan_event'))) {
    return { deliveryChallanId: id, events: [] };
  }
  const dc = await db('delivery_challans').where({ id }).first('assetids');
  const rows = await db('delivery_challan_event')
    .where({ delivery_challan_id: id })
    .orderBy('id', 'desc')
    .limit(200);
  return {
    deliveryChallanId: id,
    events: rows.map((row) => publicDcEvent({ ...row, assetids: row.assetids || dc?.assetids }))
  };
}

async function listRecentEvents({ limit } = {}) {
  if (!(await db.schema.hasTable('delivery_challan_event'))) {
    return { events: [] };
  }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const rows = await db('delivery_challan_event as e')
    .leftJoin('delivery_challans as d', 'd.id', 'e.delivery_challan_id')
    .select('e.*', 'd.challanno', 'd.assetids')
    .orderBy('e.timestamp', 'desc')
    .orderBy('e.id', 'desc')
    .limit(cap);
  return { events: rows.map(publicDcEvent) };
}

module.exports = {
  writeDcEvent,
  writeHoldingHistory,
  listHistory,
  listRecentEvents
};
