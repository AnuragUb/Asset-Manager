/**
 * Verify extended DC dispatch reasons end to end (migration 20260928160000).
 *
 * Runs every scenario inside ONE outer transaction that is always rolled back:
 * utils.db is swapped for the transaction before the services are required, so
 * their own db.transaction() calls become savepoints. Nothing persists.
 *
 * Usage (inside the app container): node scripts/dc-extended-reasons-verify.js
 */
const utils = require('../utils');

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function expectError(label, fn, code) {
  try {
    await fn();
    check(label, false, 'no error thrown');
  } catch (err) {
    check(label, err.reasonCode === code, `${err.reasonCode || ''} ${err.message}`);
  }
}

async function main() {
  const rootDb = utils.db;
  const trx = await rootDb.transaction();
  utils.db = trx;
  try {
    const dcs = require('../services/dcDispositionService');
    const ret = require('../services/dcReturnInwardService');
    const tally = require('../services/tallyReportService');

    const assets = await trx('assets')
      .whereRaw("LOWER(COALESCE(status,'')) = 'in store'")
      .whereRaw('COALESCE(is_deleted,0) = 0 AND COALESCE(is_retired,0) = 0 AND COALESCE(is_set,0) = 0')
      .whereRaw("COALESCE(lineage_status,'ACTIVE') = 'ACTIVE'")
      .whereNotExists(function () {
        this.select(1).from('reservation')
          .whereRaw('LOWER(reservation.resource_id) = LOWER(assets.id)')
          .where({ 'reservation.status': 'ACTIVE' });
      })
      .orderByRaw('COALESCE(is_quantity_tracked,0) ASC')
      .limit(3);
    if (assets.length < 3) throw new Error(`Need 3 free In Store assets, found ${assets.length}`);
    const inv = await trx('inventory_items')
      .whereRaw('COALESCE(is_deleted,0) = 0 AND COALESCE(is_quantity_tracked,0) = 1')
      .where('quantity_available', '>=', 2)
      .orderBy('quantity_available', 'desc')
      .first();
    if (!inv) throw new Error('Need an inventory item with >= 2 available');
    console.log('assets', assets.map((a) => a.id).join(', '), '| inventory', inv.id, 'avail', inv.quantity_available);
    const touchedProducts = [...new Set([...assets.map((a) => a.product_id), inv.product_id].map((p) => p || '__none__'))];
    const mismatchBefore = {};
    for (const pid of touchedProducts) mismatchBefore[pid] = (await tally.getProductTally(pid)).totals.mismatch;

    const stamp = String(Date.now()).slice(-6);
    const mkDc = async (suffix, reason, items, extra = {}) => {
      const id = `DC-XR-${suffix}-${stamp}`;
      await trx('delivery_challans').insert({
        id,
        challanno: `XR/${suffix}/${stamp}`,
        customername: 'Extended reasons verify',
        deliverydate: new Date().toISOString().slice(0, 10),
        assetids: JSON.stringify(items.filter((i) => i.resourceType === 'ASSET').map((i) => i.assetId)),
        status: 'DRAFT',
        lifecycle_status: 'DRAFT',
        dispatch_reason: reason,
        qrcode: '',
        createdby: 'verify',
        timestamp: new Date().toISOString(),
        payloadjson: JSON.stringify({ account: { accountName: 'Verify' }, meta: { dispatchReason: reason }, items }),
        ...extra
      });
      return id;
    };
    const assetItem = (a) => ({ assetId: a.id, resourceType: 'ASSET', qty: 1, srNo: a.srno || null, productId: a.product_id || null });
    const holding = async (productId, id) => {
      const d = await tally.getProductTally(productId || '__none__');
      return d.holdings.find((h) => String(h.id).toLowerCase() === String(id).toLowerCase());
    };
    const postReturn = async (dcId, reason) => {
      const log = await ret.createReturnLog({
        dcId, returnReason: reason, returnedByParty: 'Verify party', receivedByUser: 'verify', vendorInvoiceNo: 'VERIFY-INV', actor: 'verify'
      });
      const logRow = await trx('dc_return_log').where({ delivery_challan_id: dcId }).orderBy('created_at', 'desc').first();
      const note = await trx('receipt_note').where({ id: logRow.receipt_note_id }).first();
      return { log, post: await ret.applyPhysicalReturnOnPost(trx, note, 'verify') };
    };

    // A. INTERNAL_USE asset: returnable, Out on DC, restored on return
    const [a1, a2, a3] = assets;
    const dcA = await mkDc('IU', 'INTERNAL_USE', [assetItem(a1)]);
    await dcs.markReady(dcA, 'verify');
    await dcs.dispatch(dcA, 'verify');
    let row = await trx('assets').where({ id: a1.id }).first();
    check('INTERNAL_USE sets asset status', row.status === 'Out for Internal Use', row.status);
    let h = await holding(a1.product_id, a1.id);
    check('INTERNAL_USE counts Out on DC, still on hand', h && h.outOnDc === 1 && h.onHand > 0, JSON.stringify({ outOnDc: h?.outOnDc, onHand: h?.onHand }));
    await postReturn(dcA, 'INTERNAL_USE_COMPLETED');
    row = await trx('assets').where({ id: a1.id }).first();
    h = await holding(a1.product_id, a1.id);
    check('INTERNAL_USE return restores status', row.status === a1.status, row.status);
    check('INTERNAL_USE return clears Out on DC', h && h.outOnDc === 0, String(h?.outOnDc));

    // B. STOCK_TRANSFER asset: destination required, In Transit, location moves on receipt
    const dcB = await mkDc('ST', 'STOCK_TRANSFER', [assetItem(a2)]);
    await expectError('STOCK_TRANSFER READY without destination refused', () => dcs.markReady(dcB, 'verify'), 'TRANSFER_DESTINATION_REQUIRED');
    await dcs.markReady(dcB, 'verify', { transferDestination: 'Verify Branch X' });
    await dcs.dispatch(dcB, 'verify');
    row = await trx('assets').where({ id: a2.id }).first();
    check('STOCK_TRANSFER sets In Transit', row.status === 'In Transit', row.status);
    const { post } = await postReturn(dcB, 'TRANSFER_RECEIVED');
    row = await trx('assets').where({ id: a2.id }).first();
    check('TRANSFER_RECEIVED moves asset location', row.currentlocation === 'Verify Branch X' && row.previouslocation === (a2.currentlocation || null),
      `${a2.currentlocation} → ${row.currentlocation} (prev ${row.previouslocation})`);
    check('TRANSFER_RECEIVED restores status', row.status === a2.status, row.status);
    check('Location move recorded on the return', !!post.restored?.[0]?.locationMove, JSON.stringify(post.restored?.[0]?.locationMove));

    // C. FOC asset: exit, grouped under Other DC exit, not returnable
    const dcC = await mkDc('FOC', 'FOC', [assetItem(a3)]);
    await dcs.markReady(dcC, 'verify');
    await dcs.dispatch(dcC, 'verify');
    row = await trx('assets').where({ id: a3.id }).first();
    check('FOC sets Issued FOC + exited', row.status === 'Issued FOC' && Number(row.is_retired) === 1, `${row.status} retired=${row.is_retired}`);
    h = await holding(a3.product_id, a3.id);
    check('FOC counted as Other DC exit', h && h.dcOtherExit > 0 && h.onHand === 0, JSON.stringify({ dcOtherExit: h?.dcOtherExit, onHand: h?.onHand }));
    await expectError('FOC DC cannot be returned', () => ret.createReturnLog({
      dcId: dcC, returnReason: 'OTHER', returnedByParty: 'x', receivedByUser: 'y', actor: 'verify'
    }), 'SALE_NO_RETURN');

    // D. VENDOR_RETURN inventory (qty 1): ownership exit counted as Vendor Return
    const invItem = { assetId: inv.id, resourceType: 'INVENTORY', qty: 1, productId: inv.product_id || null };
    const before = await holding(inv.product_id, inv.id);
    const dcD = await mkDc('VR', 'VENDOR_RETURN', [invItem]);
    await dcs.markReady(dcD, 'verify');
    await dcs.dispatch(dcD, 'verify');
    const invAfter = await trx('inventory_items').where({ id: inv.id }).first();
    check('VENDOR_RETURN reduces inventory total by 1', Number(invAfter.quantity_total) === Number(inv.quantity_total) - 1, `${inv.quantity_total} → ${invAfter.quantity_total}`);
    const ev = await trx('inventory_quantity_events').where({ type: 'DC_VENDOR_RETURN_EXIT' }).orderBy('id', 'desc').first();
    check('VENDOR_RETURN writes DC_VENDOR_RETURN_EXIT event', !!ev);
    const afterD = await holding(inv.product_id, inv.id);
    check('VENDOR_RETURN counted in Vendor Rtn', afterD.vendorReturn === before.vendorReturn + 1, `${before.vendorReturn} → ${afterD.vendorReturn}`);

    // E. STOCK_TRANSFER partial inventory: location stays, skip recorded
    const dcE = await mkDc('STI', 'STOCK_TRANSFER', [invItem], { transfer_destination: 'Verify Branch Y' });
    await dcs.markReady(dcE, 'verify');
    await dcs.dispatch(dcE, 'verify');
    const midE = await holding(inv.product_id, inv.id);
    check('Inventory transfer counts Out on DC', midE.outOnDc === before.outOnDc + 1, String(midE.outOnDc));
    const postE = await postReturn(dcE, 'TRANSFER_RECEIVED');
    const invE = await trx('inventory_items').where({ id: inv.id }).first();
    const move = postE.post.restored?.[0]?.locationMove;
    check('Partial inventory transfer keeps location', invE.currentlocation === inv.currentlocation && move?.skipped === 'PARTIAL_QUANTITY_TRANSFER',
      JSON.stringify(move));

    // F. Tally still balances for touched products
    for (const pid of touchedProducts) {
      const after = (await tally.getProductTally(pid)).totals.mismatch;
      check(`Tally mismatch unchanged by DC flows (${pid})`, after === mismatchBefore[pid], `${mismatchBefore[pid]} → ${after}`);
    }
  } finally {
    await trx.rollback().catch(() => {});
    utils.db = rootDb;
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed — all changes rolled back`);
  await rootDb.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('VERIFY ERROR', err.reasonCode || '', err.message);
  process.exit(1);
});
