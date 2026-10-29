/**
 * Verify the configurable DC dispatch reason catalog (migration 20260928180000).
 *
 * Everything runs inside ONE outer transaction that is always rolled back:
 * utils.db is swapped for the transaction before the services are required, so
 * their own db.transaction() calls become savepoints. Nothing persists.
 *
 * Usage (inside the app container): node scripts/dc-reason-catalog-verify.js
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
    const catalog = require('../services/dcReasonCatalog');
    const dcs = require('../services/dcDispositionService');
    const ret = require('../services/dcReturnInwardService');
    const tally = require('../services/tallyReportService');
    const override = require('../services/manualOverrideService');
    const retire = require('../services/assetRetireService');

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
      .limit(2);
    if (assets.length < 2) throw new Error(`Need 2 free In Store assets, found ${assets.length}`);
    const inv = await trx('inventory_items')
      .whereRaw('COALESCE(is_deleted,0) = 0 AND COALESCE(is_quantity_tracked,0) = 1')
      .where('quantity_available', '>=', 2)
      .orderBy('quantity_available', 'desc')
      .first();
    if (!inv) throw new Error('Need an inventory item with >= 2 available');
    const [a1, a2] = assets;
    console.log('assets', a1.id, a2.id, '| inventory', inv.id, 'avail', inv.quantity_available);
    const touchedProducts = [...new Set([a1.product_id, a2.product_id, inv.product_id].map((p) => p || '__none__'))];
    const mismatchBefore = {};
    for (const pid of touchedProducts) mismatchBefore[pid] = (await tally.getProductTally(pid)).totals.mismatch;

    // 1. Catalog seeded with the 9 built-in reasons
    const seeded = await catalog.list();
    check('Catalog lists 9 active built-in reasons', seeded.length === 9 && seeded.every((r) => r.isSystem), seeded.map((r) => r.code).join(','));

    // 2. Validation guards
    await expectError('Reserved asset status refused', () => catalog.create({ label: 'Verify Bad', behaviour: 'RETURNABLE', assetStatus: 'In Store' }), 'REASON_ASSET_STATUS_RESERVED');
    await expectError('Unknown behaviour refused', () => catalog.create({ label: 'Verify Bad 2', behaviour: 'LEGACY', assetStatus: 'Out X' }), 'REASON_BEHAVIOUR_INVALID');
    await expectError('Duplicate label refused', () => catalog.create({ label: 'demo', behaviour: 'RETURNABLE', assetStatus: 'Out X' }), 'REASON_LABEL_TAKEN');
    await expectError('Built-in behaviour locked', () => catalog.update('DEMO', { behaviour: 'OTHER_EXIT' }), 'REASON_SYSTEM_LOCKED');
    await expectError('Built-in asset status locked', () => catalog.update('DEMO', { assetStatus: 'Out Somewhere' }), 'REASON_SYSTEM_LOCKED');

    // 3. Custom returnable reason
    const exhibition = await catalog.create({ label: 'Verify Exhibition', behaviour: 'RETURNABLE', assetStatus: 'Out for Verify Exhibition' }, 'verify');
    check('Custom returnable created', exhibition.code === 'VERIFY_EXHIBITION' && exhibition.dispositionStatus === 'OUT_VERIFY_EXHIBITION' && exhibition.returnable,
      JSON.stringify({ code: exhibition.code, disp: exhibition.dispositionStatus }));
    check('Custom status becomes override-controlled', override.isControlledAssetStatus('out for verify exhibition'));

    const stamp = String(Date.now()).slice(-6);
    const mkDc = async (suffix, reason, items) => {
      const id = `DC-RC-${suffix}-${stamp}`;
      await trx('delivery_challans').insert({
        id,
        challanno: `RC/${suffix}/${stamp}`,
        customername: 'Reason catalog verify',
        deliverydate: new Date().toISOString().slice(0, 10),
        assetids: JSON.stringify(items.filter((i) => i.resourceType === 'ASSET').map((i) => i.assetId)),
        status: 'DRAFT',
        lifecycle_status: 'DRAFT',
        dispatch_reason: null,
        qrcode: '',
        createdby: 'verify',
        timestamp: new Date().toISOString(),
        payloadjson: JSON.stringify({ account: { accountName: 'Verify' }, meta: {}, items })
      });
      return id;
    };
    const assetItem = (a) => ({ assetId: a.id, resourceType: 'ASSET', qty: 1, srNo: a.srno || null, productId: a.product_id || null });
    const holding = async (productId, id) => {
      const d = await tally.getProductTally(productId || '__none__');
      return d.holdings.find((h) => String(h.id).toLowerCase() === String(id).toLowerCase());
    };

    const dcA = await mkDc('EX', null, [assetItem(a1)]);
    await dcs.markReady(dcA, 'verify', { dispatchReason: exhibition.code });
    await dcs.dispatch(dcA, 'verify');
    let row = await trx('assets').where({ id: a1.id }).first();
    check('Custom returnable sets its asset status', row.status === 'Out for Verify Exhibition', row.status);
    const line = await trx('dc_disposition_line').where({ delivery_challan_id: dcA }).first();
    check('Disposition line carries custom status', line.disposition_status === 'OUT_VERIFY_EXHIBITION', line.disposition_status);
    let h = await holding(a1.product_id, a1.id);
    check('Custom returnable counted Out on DC', h && h.outOnDc === 1 && h.onHand > 0, JSON.stringify({ outOnDc: h?.outOnDc, onHand: h?.onHand }));
    await expectError('Retire blocked while out on custom reason', () => retire.retireAsset({ assetId: a1.id, reason: 'SCRAPPED', actor: 'verify' }), 'ASSET_OUT_ON_DC');

    await expectError('Behaviour locked once used', () => catalog.update(exhibition.code, { behaviour: 'OTHER_EXIT' }), 'REASON_IN_USE');
    await expectError('Asset status locked once used', () => catalog.update(exhibition.code, { assetStatus: 'Out Elsewhere' }), 'REASON_IN_USE');
    const renamed = await catalog.update(exhibition.code, { label: 'Verify Trade Show' }, 'verify');
    check('Used reason can still be renamed', renamed.label === 'Verify Trade Show' && renamed.inUse > 0, `${renamed.label} inUse=${renamed.inUse}`);

    await ret.createReturnLog({ dcId: dcA, returnReason: 'OTHER', returnedByParty: 'Verify party', receivedByUser: 'verify', vendorInvoiceNo: 'VERIFY-INV', actor: 'verify' });
    const logRow = await trx('dc_return_log').where({ delivery_challan_id: dcA }).orderBy('created_at', 'desc').first();
    const note = await trx('receipt_note').where({ id: logRow.receipt_note_id }).first();
    await ret.applyPhysicalReturnOnPost(trx, note, 'verify');
    row = await trx('assets').where({ id: a1.id }).first();
    h = await holding(a1.product_id, a1.id);
    check('Return Inward restores custom-returnable asset', row.status === a1.status && h.outOnDc === 0, `${row.status} outOnDc=${h?.outOnDc}`);

    // 4. Custom exit reason (asset + inventory)
    const donation = await catalog.create({ label: 'Verify Donation', behaviour: 'OTHER_EXIT', assetStatus: 'Donated' }, 'verify');
    check('Custom exit created', donation.exit && donation.dispositionStatus === 'EXIT_VERIFY_DONATION', donation.dispositionStatus);
    const invBefore = await holding(inv.product_id, inv.id);
    const dcB = await mkDc('DN', null, [assetItem(a2), { assetId: inv.id, resourceType: 'INVENTORY', qty: 1, productId: inv.product_id || null }]);
    await dcs.markReady(dcB, 'verify', { dispatchReason: donation.code });
    await dcs.dispatch(dcB, 'verify');
    row = await trx('assets').where({ id: a2.id }).first();
    check('Custom exit sets status + exited', row.status === 'Donated' && Number(row.is_retired) === 1, `${row.status} retired=${row.is_retired}`);
    h = await holding(a2.product_id, a2.id);
    check('Custom exit asset counted as Other DC exit', h && h.dcOtherExit > 0 && h.onHand === 0, JSON.stringify({ dcOtherExit: h?.dcOtherExit, onHand: h?.onHand }));
    const invAfter = await trx('inventory_items').where({ id: inv.id }).first();
    check('Custom exit reduces inventory by 1', Number(invAfter.quantity_total) === Number(inv.quantity_total) - 1, `${inv.quantity_total} → ${invAfter.quantity_total}`);
    const ev = await trx('inventory_quantity_events').where({ type: 'DC_VERIFY_DONATION_EXIT' }).first();
    check('Custom exit writes DC_VERIFY_DONATION_EXIT event', !!ev);
    const invH = await holding(inv.product_id, inv.id);
    check('Custom exit inventory counted as Other DC exit', invH.dcOtherExit === invBefore.dcOtherExit + 1, `${invBefore.dcOtherExit} → ${invH.dcOtherExit}`);
    await expectError('Custom exit DC cannot be returned', () => ret.createReturnLog({
      dcId: dcB, returnReason: 'OTHER', returnedByParty: 'x', receivedByUser: 'y', vendorInvoiceNo: 'VERIFY-INV', actor: 'verify'
    }), 'SALE_NO_RETURN');

    // 5. Deactivation
    await catalog.update(exhibition.code, { isActive: false }, 'verify');
    await expectError('Inactive reason cannot be chosen', () => catalog.requireUsable(exhibition.code), 'INVALID_DISPATCH_REASON');
    check('Inactive reason hidden from DC list', !(await catalog.list()).some((r) => r.code === exhibition.code));
    check('Inactive reason still resolvable for history', !!(await catalog.requireKnown(exhibition.code)));

    // 6. Tally balance
    for (const pid of touchedProducts) {
      const after = (await tally.getProductTally(pid)).totals.mismatch;
      check(`Tally mismatch unchanged (${pid})`, after === mismatchBefore[pid], `${mismatchBefore[pid]} → ${after}`);
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
  console.error('VERIFY ERROR', err.reasonCode || '', err.message, err.stack);
  process.exit(1);
});
