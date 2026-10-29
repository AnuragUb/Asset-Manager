/**
 * Verify DCs are refused for holdings without quantity (serial number optional).
 * Runs in ONE rolled-back transaction; nothing persists.
 *
 * Usage (inside the app container): node scripts/dc-quantity-guard-verify.js
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
    const free = () => trx('assets')
      .whereRaw("LOWER(COALESCE(status,'')) = 'in store'")
      .whereRaw('COALESCE(is_deleted,0) = 0 AND COALESCE(is_retired,0) = 0 AND COALESCE(is_set,0) = 0')
      .whereNotExists(function () {
        this.select(1).from('reservation')
          .whereRaw('LOWER(reservation.resource_id) = LOWER(assets.id)')
          .where({ 'reservation.status': 'ACTIVE' });
      });
    const noSerial = await free().whereRaw("COALESCE(TRIM(srno),'') = ''").where('quantity_total', '>', 0).first();
    const others = await free().whereNot('id', noSerial?.id || '').limit(2);
    if (!noSerial || others.length < 2) throw new Error('Need 3 free assets (one without serial)');
    const [zeroAsset, nullAsset] = others;
    const inv = await trx('inventory_items').whereRaw('COALESCE(is_deleted,0) = 0').where('quantity_available', '>=', 1).first();

    await trx('assets').where({ id: zeroAsset.id }).update({ quantity_total: 0, quantity_available: 0 });
    await trx('assets').where({ id: nullAsset.id }).update({ quantity_total: null, quantity_available: null });

    const stamp = String(Date.now()).slice(-6);
    let n = 0;
    const mkDc = async (items) => {
      n += 1;
      const id = `DC-QG-${n}-${stamp}`;
      await trx('delivery_challans').insert({
        id, challanno: `QG/${n}/${stamp}`, customername: 'Qty guard verify',
        deliverydate: new Date().toISOString().slice(0, 10),
        assetids: JSON.stringify(items.map((i) => i.assetId)), status: 'DRAFT', lifecycle_status: 'DRAFT',
        dispatch_reason: 'DEMO', qrcode: '', createdby: 'verify', timestamp: new Date().toISOString(),
        payloadjson: JSON.stringify({ account: { accountName: 'Verify' }, meta: {}, items })
      });
      return id;
    };
    const item = (a, type = 'ASSET', qty = 1) => ({ assetId: a.id, resourceType: type, qty });

    await expectError('Asset with quantity 0 refused at READY', async () => dcs.markReady(await mkDc([item(zeroAsset)]), 'verify'), 'DC_HOLDING_NO_QUANTITY');
    await expectError('Asset with no quantity (NULL) refused at READY', async () => dcs.markReady(await mkDc([item(nullAsset)]), 'verify'), 'DC_HOLDING_NO_QUANTITY');
    await expectError('Draft guard refuses zero-quantity asset', () => dcs.assertLinesHaveQuantity(trx, [{ resourceType: 'ASSET', resourceId: zeroAsset.id, quantity: 1 }], { checkAvailable: true }), 'DC_HOLDING_NO_QUANTITY');
    if (inv) {
      await expectError('Inventory over-quantity refused at draft', () => dcs.assertLinesHaveQuantity(trx, [{ resourceType: 'INVENTORY', resourceId: inv.id, quantity: Number(inv.quantity_available) + 1 }], { checkAvailable: true }), 'DC_HOLDING_NO_QUANTITY');
      await dcs.assertLinesHaveQuantity(trx, [{ resourceType: 'ASSET', resourceId: inv.id, quantity: 1 }], { checkAvailable: true });
      check('Inventory id passed as asset id resolves via fallback', true);
    }
    const qtyAsset = await free().where('id', noSerial.id).first();
    const assetAvail = Number(qtyAsset.quantity_available);
    if (Number.isFinite(assetAvail) && assetAvail > 0) {
      await expectError(
        'Asset over-quantity refused at draft',
        () => dcs.assertLinesHaveQuantity(trx, [{ resourceType: 'ASSET', resourceId: qtyAsset.id, quantity: assetAvail + 10 }], { checkAvailable: true }),
        'DC_HOLDING_NO_QUANTITY'
      );
    }

    const okDc = await mkDc([item(noSerial)]);
    await dcs.markReady(okDc, 'verify');
    await dcs.dispatch(okDc, 'verify');
    const after = await trx('assets').where({ id: noSerial.id }).first();
    check('Asset without serial but with quantity dispatches', after.status === 'Out on Demo', `${noSerial.id} srno="${noSerial.srno || ''}" → ${after.status}`);

    // Quantity removed after READY is still caught at dispatch
    const lateDc = await mkDc([item(others[0])]);
    await trx('assets').where({ id: others[0].id }).update({ quantity_total: 1, quantity_available: 1 });
    await dcs.markReady(lateDc, 'verify');
    await trx('assets').where({ id: others[0].id }).update({ quantity_total: 0 });
    await expectError('Quantity zeroed after READY refused at dispatch', () => dcs.dispatch(lateDc, 'verify'), 'DC_HOLDING_NO_QUANTITY');
  } finally {
    await trx.rollback().catch(() => {});
    utils.db = rootDb;
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed — all changes rolled back`);
  await rootDb.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('VERIFY ERROR', err.reasonCode || '', err.message);
  process.exit(1);
});
