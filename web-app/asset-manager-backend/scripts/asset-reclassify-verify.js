/**
 * Asset → Inventory reclassification verification (PHYSICAL_TALLY_AUTHORITY_ADR §11).
 * Everything runs inside one transaction that is always rolled back.
 *
 *   node scripts/asset-reclassify-verify.js <parentAssetId> [serialAssetId]
 *
 * parentAssetId: a free, in-store, quantity-tracked Break parent (total >= 1) whose
 * only active Break child is also free (e.g. after one Break). If it has no child yet
 * and total >= 2, one Break is done inside the transaction.
 */
const utils = require('../utils');

const realDb = utils.db;
const results = [];
const check = (label, ok, extra) => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};
const num = (v) => Number(v || 0);

async function expectError(label, fn, reasonCode) {
  try {
    await fn();
    check(label, false, 'no error');
  } catch (err) {
    check(label, err.reasonCode === reasonCode, `${err.reasonCode}: ${err.message}`);
  }
}

(async () => {
  const [qtyAssetId, serialAssetId] = process.argv.slice(2);
  if (!qtyAssetId) throw new Error('usage: asset-reclassify-verify.js <quantityAssetId> [serialAssetId]');
  const trx = await realDb.transaction();
  try {
    utils.db = trx;
    const conversion = require('../services/conversionService');
    const breakService = require('../services/breakService');
    const tally = require('../services/tallyReportService');
    const host = 'localhost:8080';
    const kind = await trx('inventory_kinds').whereNotNull('folderid')
      .where(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).first();
    const base = { actor: 'verify', host, trx, kindId: kind.id };

    const asset = await trx('assets').where({ id: qtyAssetId }).first();
    const productId = asset.product_id;
    const before = await tally.getProductTally(productId);
    const beforeMismatch = (await tally.getProductTally(productId, { type: 'ASSET' })).totals.mismatch
      + (await tally.getProductTally(productId, { type: 'INVENTORY' })).totals.mismatch;

    await expectError('NEW without an inventory Kind refused', () => conversion.reclassifyAssetToInventory({
      ...base, kindId: '', assetId: qtyAssetId, target: 'NEW', reason: 'verification run (rolled back)'
    }), 'RECLASSIFY_KIND_REQUIRED');

    await expectError('short reason refused', () => conversion.reclassifyAssetToInventory({
      ...base, assetId: qtyAssetId, target: 'NEW', reason: 'short'
    }), 'RECLASSIFY_REASON_REQUIRED');

    const activeChildren = await trx('assets')
      .where({ quantity_parent_id: qtyAssetId })
      .andWhere(function active() { this.whereNull('lineage_status').orWhere('lineage_status', 'ACTIVE'); })
      .select('id', 'quantity_total');
    let childId;
    let childQty;
    if (activeChildren.length === 1) {
      childId = activeChildren[0].id;
      childQty = num(activeChildren[0].quantity_total);
    } else if (!activeChildren.length) {
      const broken = await breakService.breakQuantity({
        holdingType: 'ASSET', parentId: qtyAssetId, mode: 'BREAK', amount: 1, actor: 'verify', host, trx
      });
      childId = broken.children[0].id;
      childQty = 1;
    } else {
      throw new Error(`${qtyAssetId} has ${activeChildren.length} active children; pick a parent with at most one`);
    }
    const parentQty = num((await trx('assets').where({ id: qtyAssetId }).first()).quantity_total);
    const moved = childQty + parentQty;
    console.log(`parent ${qtyAssetId} (${parentQty}) + child ${childId} (${childQty})`);

    await expectError('parent with active Break child refused', () => conversion.reclassifyAssetToInventory({
      ...base, assetId: qtyAssetId, target: 'NEW', reason: 'verification run (rolled back)'
    }), 'ASSET_HAS_ACTIVE_CHILDREN');

    const first = await conversion.reclassifyAssetToInventory({
      ...base, assetId: childId, target: 'NEW', reason: 'verification run (rolled back)'
    });
    const invId = first.destination.id;
    const inv = await trx('inventory_items').where({ id: invId }).first();
    const child = await trx('assets').where({ id: childId }).first();
    check('NEW: inventory item created with the child quantity',
      num(inv.quantity_total) === childQty && num(inv.quantity_available) === childQty && num(inv.quantity_original) === childQty
        && inv.product_id === productId && inv.conversion_source_id === childId && inv.conversion_id === first.conversion.id
        && inv.kindid === kind.id && inv.folderid === kind.folderid,
      `${invId} total ${inv.quantity_total}`);
    check('NEW: asset closed and linked', child.lineage_status === 'INACTIVE' && num(child.quantity_converted) === childQty
      && num(child.quantity_available) === 0);
    check('NEW: conversion recorded as RECLASSIFIED',
      first.conversion.status === 'RECLASSIFIED' && first.conversion.reasonCode === 'RECLASSIFY_NEW'
        && first.lines.length === 2 && first.events[0].type === 'RECLASSIFY_ASSET_TO_INVENTORY');
    const hist = await trx('asset_history').where({ assetid: childId, action: 'RECLASSIFIED_TO_INVENTORY' }).first();
    check('NEW: asset history entry written', Boolean(hist), hist && hist.details);

    await expectError('closed asset cannot be reclassified again', () => conversion.reclassifyAssetToInventory({
      ...base, assetId: childId, target: 'NEW', reason: 'verification run (rolled back)'
    }), 'ASSET_INACTIVE');

    const opts = await conversion.reclassifyOptions(qtyAssetId);
    check('options: parent now allowed and lists the new item as a target',
      opts.blockers.length === 0 && opts.targets.some((t) => t.id === invId),
      `blockers ${opts.blockers.length}, targets ${opts.targets.map((t) => t.id).join(',')}`);

    const second = await conversion.reclassifyAssetToInventory({
      ...base, assetId: qtyAssetId, target: 'EXISTING', inventoryId: invId, reason: 'verification run (rolled back)'
    });
    const inv2 = await trx('inventory_items').where({ id: invId }).first();
    check('EXISTING: quantity added to the chosen item',
      num(inv2.quantity_total) === moved && num(inv2.quantity_available) === moved && num(inv2.quantity_original) === moved
        && second.conversion.reasonCode === 'RECLASSIFY_EXISTING',
      `total ${inv2.quantity_total}, original ${inv2.quantity_original}`);
    await breakService.assertConservation(trx, 'assets', asset.quantity_root_id || asset.id, 0);
    check('asset tree conservation holds', true);

    const after = await tally.getProductTally(productId);
    const t0 = before.totals;
    const t1 = after.totals;
    check('tally: product on hand unchanged, now inventory',
      t1.onHand === t0.onHand && t1.onHandInventory === t0.onHandInventory + moved && t1.onHandAssets === t0.onHandAssets - moved,
      `onHand ${t0.onHand}→${t1.onHand}, assets ${t0.onHandAssets}→${t1.onHandAssets}, inventory ${t0.onHandInventory}→${t1.onHandInventory}`);
    check('tally: no new mismatch, converted in = converted out',
      t1.mismatch === t0.mismatch && t1.convertedIn - t0.convertedIn === moved && t1.convertedOut - t0.convertedOut === moved,
      `mismatch ${t0.mismatch}→${t1.mismatch}`);
    const assetsOnly = await tally.getProductTally(productId, { type: 'ASSET' });
    const invOnly = await tally.getProductTally(productId, { type: 'INVENTORY' });
    check('tally: Inventory-only view balances; per-type mismatch unchanged',
      invOnly.totals.mismatch === 0 && assetsOnly.totals.mismatch + invOnly.totals.mismatch === beforeMismatch,
      `asset ${assetsOnly.totals.mismatch}, inventory ${invOnly.totals.mismatch}, before ${beforeMismatch}`);
    const newRow = after.holdings.find((h) => h.id === invId);
    check('tally: new item labelled Reclassified, not opening stock',
      newRow && newRow.source === 'RECLASSIFIED' && newRow.inOpening === 0);

    if (serialAssetId) {
      const s = await trx('assets').where({ id: serialAssetId }).first();
      const serialsBefore = await trx('serial_identity').where({ resource_type: 'ASSET', resource_id: s.id, status: 'ACTIVE' });
      await expectError('EXISTING target of another product refused', () => conversion.reclassifyAssetToInventory({
        ...base, assetId: serialAssetId, target: 'EXISTING', inventoryId: invId, reason: 'verification run (rolled back)'
      }), 'RECLASSIFY_TARGET_INVALID');
      const r = await conversion.reclassifyAssetToInventory({
        ...base, assetId: serialAssetId, target: 'NEW', reason: 'verification run (rolled back)'
      });
      const sInv = await trx('inventory_items').where({ id: r.destination.id }).first();
      const moved = await trx('serial_identity').where({ resource_type: 'INVENTORY', resource_id: sInv.id, status: 'ACTIVE' });
      check('serial asset: serial kept on the new inventory item',
        sInv.srno === s.srno && moved.length === serialsBefore.length && r.serialsMoved === serialsBefore.length,
        `serial rows moved ${r.serialsMoved}, srno copied ${sInv.srno === s.srno}`);
    }
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
