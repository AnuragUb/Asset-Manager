/**
 * Append-only Delivery Challan events for Lifecycle History.
 */
const { db } = require('../utils');

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
  const rows = await db('delivery_challan_event')
    .where({ delivery_challan_id: id })
    .orderBy('id', 'desc')
    .limit(200);
  return { deliveryChallanId: id, events: rows.map(publicDcEvent) };
}

async function listRecentEvents({ limit } = {}) {
  if (!(await db.schema.hasTable('delivery_challan_event'))) {
    return { events: [] };
  }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const rows = await db('delivery_challan_event as e')
    .leftJoin('delivery_challans as d', 'd.id', 'e.delivery_challan_id')
    .select('e.*', 'd.challanno')
    .orderBy('e.timestamp', 'desc')
    .orderBy('e.id', 'desc')
    .limit(cap);
  return { events: rows.map(publicDcEvent) };
}

module.exports = {
  writeDcEvent,
  listHistory,
  listRecentEvents
};
