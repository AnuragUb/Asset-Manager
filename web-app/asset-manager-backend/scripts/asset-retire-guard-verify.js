/**
 * Asset Retire guard verification: closed (INACTIVE lineage) assets are refused.
 * Everything runs inside one transaction that is always rolled back.
 *
 *   node scripts/asset-retire-guard-verify.js [freeAssetId]
 *
 * freeAssetId: an active asset that can currently be retired. When omitted, the first
 * in-store asset that retires cleanly (savepoint) is used.
 */
const utils = require('../utils');

const realDb = utils.db;
const results = [];
const check = (label, ok, extra) => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function retireOutcome(retire, trx, assetId) {
  await trx.raw('SAVEPOINT retire_probe');
  try {
    await retire.retireAsset({ assetId, reason: 'SCRAPPED', note: 'verification run (rolled back)', actor: 'verify' });
    return { ok: true };
  } catch (err) {
    return { ok: false, reasonCode: err.reasonCode, message: err.message };
  } finally {
    await trx.raw('ROLLBACK TO SAVEPOINT retire_probe');
  }
}

(async () => {
  const [argId] = process.argv.slice(2);
  const trx = await realDb.transaction();
  try {
    utils.db = trx;
    const retire = require('../services/assetRetireService');

    let assetId = argId;
    if (!assetId) {
      const candidates = await trx('assets')
        .where(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
        .andWhere(function notRetired() { this.where('is_retired', 0).orWhereNull('is_retired'); })
        .andWhere(function active() { this.whereNull('lineage_status').orWhere('lineage_status', 'ACTIVE'); })
        .whereRaw("LOWER(COALESCE(status, '')) = 'in store'")
        .orderBy('id')
        .limit(25)
        .pluck('id');
      for (const id of candidates) {
        if ((await retireOutcome(retire, trx, id)).ok) { assetId = id; break; }
      }
      if (!assetId) throw new Error('No retirable in-store asset found; pass one as an argument');
    }

    const control = await retireOutcome(retire, trx, assetId);
    check('active asset can be retired (control)', control.ok, control.ok ? assetId : `${control.reasonCode}: ${control.message}`);

    await trx('assets').where({ id: assetId }).update({ lineage_status: 'INACTIVE' });
    const closed = await retireOutcome(retire, trx, assetId);
    check('closed (INACTIVE) asset refused with ASSET_INACTIVE', !closed.ok && closed.reasonCode === 'ASSET_INACTIVE',
      closed.ok ? 'retired' : `${closed.reasonCode}: ${closed.message}`);

    const row = await trx('assets').where({ id: assetId }).first('status', 'is_retired');
    check('closed asset left untouched', Number(row.is_retired || 0) === 0 && String(row.status).toLowerCase() !== 'retired',
      `status ${row.status}, is_retired ${row.is_retired}`);
  } finally {
    await trx.rollback();
    utils.db = realDb;
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed (rolled back)`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
