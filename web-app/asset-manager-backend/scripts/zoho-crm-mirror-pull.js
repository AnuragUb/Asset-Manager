/**
 * Pull Zoho CRM Accounts / Contacts / Vendors into zoho_crm_db.
 *
 * Read-only against Zoho. Writes only to database zoho_crm_db.
 * Does not modify asset_manager.
 *
 * Usage (inside backend container):
 *   node scripts/zoho-crm-mirror-pull.js
 *   node scripts/zoho-crm-mirror-pull.js --modules accounts,contacts,vendors
 *
 * Requires OAuth scopes (see zohoService.ZOHO_OAUTH_SCOPES):
 *   ZohoCRM.modules.ALL
 *   ZohoCRM.settings.fields.READ
 *   ZohoCRM.settings.modules.READ
 * If Contacts/Vendors fail with OAUTH_SCOPE_MISMATCH, reauthorize Zoho
 * (Connect Zoho / prompt=consent) so modules.ALL is granted.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const knex = require('knex');
const knexConfig = require('../knexfile');
const zoho = require('../services/zohoService');

function parseArgs(argv) {
  const out = { modules: ['accounts', 'contacts', 'vendors'] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--modules' && argv[i + 1]) {
      out.modules = String(argv[++i])
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return out;
}

function crmDb() {
  const environment = process.env.NODE_ENV || 'development';
  const base = knexConfig[environment] || knexConfig.development;
  const connection = { ...(base.connection || {}) };
  connection.database = process.env.ZOHO_CRM_DB_NAME || 'zoho_crm_db';
  return knex({ ...base, connection });
}

async function upsertRows(db, table, rows) {
  const now = new Date();
  let upserted = 0;
  for (const row of rows) {
    const payload = {
      ...row,
      raw_json: row.raw_json ? JSON.stringify(row.raw_json) : null,
      last_synced_at: now,
      updated_at: now
    };
    const existing = await db(table).where({ zoho_id: row.zoho_id }).first();
    if (existing) {
      await db(table).where({ zoho_id: row.zoho_id }).update(payload);
    } else {
      await db(table).insert({ ...payload, created_at: now });
    }
    upserted += 1;
  }
  return upserted;
}

async function pullModule(db, name) {
  if (name === 'accounts') {
    const rows = await zoho.pullAccountsMirrorRows();
    const upserted = await upsertRows(db, 'zoho_accounts', rows);
    return { module: 'Accounts', fetched: rows.length, upserted };
  }
  if (name === 'contacts') {
    const rows = await zoho.pullContactsMirrorRows();
    const upserted = await upsertRows(db, 'zoho_contacts', rows);
    return { module: 'Contacts', fetched: rows.length, upserted };
  }
  if (name === 'vendors') {
    const rows = await zoho.pullVendorsMirrorRows();
    const upserted = await upsertRows(db, 'zoho_vendors', rows);
    return { module: 'Vendors', fetched: rows.length, upserted };
  }
  throw new Error(`Unknown module: ${name}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = crmDb();
  const results = [];
  try {
    console.log(JSON.stringify({
      ok: true,
      phase: 'start',
      database: db.client.config.connection.database,
      modules: args.modules
    }));
    for (const mod of args.modules) {
      try {
        const result = await pullModule(db, mod);
        results.push({ ok: true, ...result });
        console.log(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        const entry = {
          ok: false,
          module: mod,
          code: err.code || err.reasonCode || null,
          message: err.message || String(err)
        };
        results.push(entry);
        console.error(JSON.stringify(entry));
      }
    }
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({
      ok: failed.length === 0,
      phase: 'done',
      results
    }, null, 2));
    process.exit(failed.length ? 2 : 0);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    phase: 'fatal',
    code: err.code || null,
    message: err.message || String(err)
  }));
  process.exit(1);
});
