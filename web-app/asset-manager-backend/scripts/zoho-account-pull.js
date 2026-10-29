/**
 * Pull Zoho CRM Accounts into public.zoho_account on the app database.
 *
 *   node scripts/zoho-account-pull.js
 */
const { db } = require('../utils');
const { syncAccountsFromZoho } = require('../services/zohoAccountService');

async function main() {
  const result = await syncAccountsFromZoho();
  console.log(JSON.stringify({ ok: true, ...result }));
  await db.destroy();
}

main().catch(async (err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.reasonCode || err.code || null,
    message: err.message || String(err)
  }));
  try { await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
