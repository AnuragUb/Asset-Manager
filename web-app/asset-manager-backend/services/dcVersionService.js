/**
 * Append-only document versions for a Delivery Challan.
 * lifecycle_status is the stage the DC was in when the version was saved.
 */
const { db } = require('../utils');

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function snapshotFromRow(row) {
  return {
    id: row.id,
    challanNo: row.challanno,
    customerName: row.customername || '',
    deliveryDate: row.deliverydate || '',
    assetIds: parseJson(row.assetids, []),
    status: row.status || null,
    lifecycleStatus: row.lifecycle_status || null,
    dispatchReason: row.dispatch_reason || null,
    transferDestination: row.transfer_destination || null,
    payload: parseJson(row.payloadjson, {})
  };
}

function publicVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    deliveryChallanId: row.delivery_challan_id,
    versionNo: row.version_no,
    lifecycleStatus: row.lifecycle_status,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.created_at,
    snapshot: parseJson(row.snapshot_json, null)
  };
}

async function tableReady(runner) {
  return (runner || db).schema.hasTable('delivery_challan_version');
}

async function recordFromRow(runner, row, { reason, actor, lifecycleStatus } = {}) {
  const trx = runner || db;
  if (!(await tableReady(trx)) || !row) return null;
  const why = String(reason || '').trim();
  if (!why) {
    const err = new Error('A reason is required for a DC version');
    err.statusCode = 400;
    err.reasonCode = 'VERSION_REASON_REQUIRED';
    throw err;
  }
  const maxRow = await trx('delivery_challan_version')
    .where({ delivery_challan_id: row.id })
    .max({ n: 'version_no' })
    .first();
  const versionNo = Number(maxRow && maxRow.n) + 1 || 1;
  const stage = String(lifecycleStatus || row.lifecycle_status || 'DRAFT').toUpperCase();
  const createdAt = new Date().toISOString();
  const snapshotJson = JSON.stringify(snapshotFromRow(row));
  await trx('delivery_challan_version').insert({
    delivery_challan_id: row.id,
    version_no: versionNo,
    lifecycle_status: stage,
    reason: why.slice(0, 2000),
    actor: actor || null,
    created_at: createdAt,
    snapshot_json: snapshotJson
  });
  return publicVersion({
    delivery_challan_id: row.id,
    version_no: versionNo,
    lifecycle_status: stage,
    reason: why.slice(0, 2000),
    actor: actor || null,
    created_at: createdAt,
    snapshot_json: snapshotJson
  });
}

async function listVersions(deliveryChallanId) {
  const id = String(deliveryChallanId || '').trim();
  if (!id) {
    const err = new Error('deliveryChallanId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!(await tableReady(db))) return { deliveryChallanId: id, versions: [] };
  const rows = await db('delivery_challan_version')
    .where({ delivery_challan_id: id })
    .orderBy('version_no', 'desc');
  const versions = rows.map(publicVersion);
  const dc = await db('delivery_challans').where({ id }).first();
  const life = String(dc && dc.lifecycle_status || '').toUpperCase();
  const hasPosted = versions.some((version) => String(version.lifecycleStatus || '').toUpperCase() === 'DISPATCHED');
  if (dc && life === 'DISPATCHED' && !hasPosted) {
    const latestNo = versions.reduce((max, version) => Math.max(max, Number(version.versionNo) || 0), 0);
    versions.unshift(publicVersion({
      id: null,
      delivery_challan_id: id,
      version_no: latestNo + 1,
      lifecycle_status: 'DISPATCHED',
      reason: 'Posted',
      actor: dc.dispatched_by || null,
      created_at: dc.dispatched_at || null,
      snapshot_json: JSON.stringify(snapshotFromRow(dc))
    }));
  }
  return { deliveryChallanId: id, versions };
}

module.exports = {
  tableReady,
  recordFromRow,
  listVersions,
  publicVersion
};
