/**
 * Pull Zoho Deal Projects (CRM module Deals) into utility.zoho_deal_projects.
 * Read-only against Zoho. Does not write Purchase Orders.
 */
const { db } = require('../utils');
const zohoService = require('./zohoService');

function dealProjects() {
  return db('zoho_deal_projects');
}

const MERGE_COLUMNS = [
  'deal_name',
  'project_id',
  'account_zoho_id',
  'account_name',
  'contact_zoho_id',
  'contact_name',
  'stage',
  'deal_type',
  'amount',
  'closing_date',
  'pipeline',
  'owner_zoho_id',
  'owner_name',
  'description',
  'last_activity_time',
  'zoho_modified_at',
  'raw_json',
  'last_synced_at',
  'missing_at',
  'updated_at'
];

function rowPayload(row, now) {
  return {
    zoho_id: row.zoho_id,
    deal_name: row.deal_name || null,
    project_id: row.project_id || null,
    account_zoho_id: row.account_zoho_id || null,
    account_name: row.account_name || null,
    contact_zoho_id: row.contact_zoho_id || null,
    contact_name: row.contact_name || null,
    stage: row.stage || null,
    deal_type: row.deal_type || null,
    amount: row.amount,
    closing_date: row.closing_date || null,
    pipeline: row.pipeline || null,
    owner_zoho_id: row.owner_zoho_id || null,
    owner_name: row.owner_name || null,
    description: row.description || null,
    last_activity_time: row.last_activity_time || null,
    zoho_modified_at: row.zoho_modified_at || null,
    raw_json: row.raw_json || null,
    last_synced_at: now,
    missing_at: null,
    updated_at: now,
    created_at: now
  };
}

async function syncDealProjectsFromZoho() {
  const ready = await db.raw(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'utility'
      AND table_name = 'zoho_deal_projects'
      AND column_name = 'zoho_id'
  `);
  if (!ready.rows.length) {
    const err = new Error('zoho_deal_projects is not migrated');
    err.statusCode = 503;
    err.reasonCode = 'SCHEMA_PENDING';
    throw err;
  }
  const rows = await zohoService.pullDealProjectRows();
  const now = new Date();
  const seen = [];
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((row) => rowPayload(row, now));
    seen.push(...chunk.map((row) => row.zoho_id));
    await dealProjects()
      .insert(chunk)
      .onConflict('zoho_id')
      .merge(MERGE_COLUMNS);
  }

  const truncated = rows.length >= 50 * 200;
  let markedMissing = 0;
  if (!truncated && seen.length) {
    markedMissing = await dealProjects()
      .whereNull('missing_at')
      .whereNotIn('zoho_id', seen)
      .update({ missing_at: now, updated_at: now });
  }

  return {
    fetched: rows.length,
    upserted: seen.length,
    withAccount: rows.filter((row) => row.account_zoho_id).length,
    markedMissing,
    truncated
  };
}

module.exports = {
  syncDealProjectsFromZoho
};
