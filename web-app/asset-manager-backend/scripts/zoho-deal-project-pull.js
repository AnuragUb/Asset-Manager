/**
 * Pull Zoho Deal Projects into public.zoho_deal_projects.
 *
 *   node scripts/zoho-deal-project-pull.js
 */
const { db } = require('../utils');
const { syncDealProjectsFromZoho } = require('../services/zohoDealProjectService');

async function main() {
  const result = await syncDealProjectsFromZoho();
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
