/**
 * Pull Zoho CRM Accounts into utility.zoho_account.
 * Read-only against Zoho. Does not link Purchase Orders.
 */
const { db } = require('../utils');
const zohoService = require('./zohoService');

const MERGE_COLUMNS = [
  'account_name',
  'phone',
  'fax',
  'website',
  'account_type',
  'industry',
  'rating',
  'owner_zoho_id',
  'owner_name',
  'billing_address',
  'billing_street',
  'billing_city',
  'billing_state',
  'billing_code',
  'billing_country',
  'billing_flat',
  'shipping_address',
  'shipping_street',
  'shipping_city',
  'shipping_state',
  'shipping_code',
  'shipping_country',
  'shipping_flat',
  'description',
  'last_activity_time',
  'raw_json',
  'last_synced_at',
  'missing_at',
  'updated_at'
];

function rowPayload(row, now) {
  return {
    zoho_id: row.zoho_id,
    account_name: row.account_name || null,
    phone: row.phone || null,
    fax: row.fax || null,
    website: row.website || null,
    account_type: row.account_type || null,
    industry: row.industry || null,
    rating: row.rating || null,
    owner_zoho_id: row.owner_zoho_id || null,
    owner_name: row.owner_name || null,
    billing_address: row.billing_address || null,
    billing_street: row.billing_street || null,
    billing_city: row.billing_city || null,
    billing_state: row.billing_state || null,
    billing_code: row.billing_code || null,
    billing_country: row.billing_country || null,
    billing_flat: row.billing_flat || null,
    shipping_address: row.shipping_address || null,
    shipping_street: row.shipping_street || null,
    shipping_city: row.shipping_city || null,
    shipping_state: row.shipping_state || null,
    shipping_code: row.shipping_code || null,
    shipping_country: row.shipping_country || null,
    shipping_flat: row.shipping_flat || null,
    description: row.description || null,
    last_activity_time: row.last_activity_time || null,
    raw_json: row.raw_json || null,
    last_synced_at: now,
    missing_at: null,
    updated_at: now,
    created_at: now
  };
}

async function syncAccountsFromZoho() {
  if (!(await db.schema.hasTable('zoho_account'))) {
    const err = new Error('zoho_account is not migrated');
    err.statusCode = 503;
    err.reasonCode = 'SCHEMA_PENDING';
    throw err;
  }
  const rows = await zohoService.pullAccountsMirrorRows();
  const now = new Date();
  const seen = [];
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((row) => rowPayload(row, now));
    seen.push(...chunk.map((row) => row.zoho_id));
    await db('zoho_account')
      .insert(chunk)
      .onConflict('zoho_id')
      .merge(MERGE_COLUMNS);
  }

  // 50 pages × 200 is the pull ceiling. A full page count may be truncated,
  // so do not mark the rest of the table missing in that case.
  const truncated = rows.length >= 50 * 200;
  let markedMissing = 0;
  if (!truncated && seen.length) {
    markedMissing = await db('zoho_account')
      .whereNull('missing_at')
      .whereNotIn('zoho_id', seen)
      .update({ missing_at: now, updated_at: now });
  }

  return {
    fetched: rows.length,
    upserted: seen.length,
    markedMissing,
    truncated
  };
}

module.exports = {
  syncAccountsFromZoho
};
