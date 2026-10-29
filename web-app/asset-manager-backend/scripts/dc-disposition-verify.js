/**
 * Scratch verification for DC dispatch disposition lifecycle.
 * Run: node scripts/dc-disposition-verify.js
 * Expects DB with migration 20260925120000 applied.
 */
const { db } = require('../utils');
const dcDispositionService = require('../services/dcDispositionService');
const reservationService = require('../services/reservationService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function pickAsset() {
  const row = await db('assets')
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .where(function () {
      this.whereNull('is_retired').orWhere('is_retired', 0);
    })
    .where(function () {
      this.whereNull('sentagainstdc').orWhere('sentagainstdc', '');
    })
    .whereNotIn('status', ['Sold', 'Scraped', 'Consumed', 'Project', 'Out on Demo', 'Out on Rental', 'Out for Repair'])
    .orderBy('lastupdated', 'desc')
    .first();
  return row;
}

async function main() {
  const asset = await pickAsset();
  assert(asset, 'No eligible asset for DEMO test');
  console.log('ASSET', asset.id, asset.status);

  const id = `DC-TEST-${Date.now()}`;
  const challanNo = `99/${String(Date.now()).slice(-4)}`;
  await db('delivery_challans').insert({
    id,
    challanno: challanNo,
    customername: 'Disposition Verify',
    deliverydate: new Date().toISOString().slice(0, 10),
    assetids: JSON.stringify([asset.id]),
    status: 'DRAFT',
    lifecycle_status: 'DRAFT',
    dispatch_reason: 'DEMO',
    qrcode: '',
    createdby: 'verify',
    timestamp: new Date().toISOString(),
    payloadjson: JSON.stringify({
      meta: { dispatchReason: 'DEMO' },
      items: [{ assetId: asset.id, resourceType: 'ASSET', qty: 1, description: asset.itemname || asset.id, srNo: asset.srno || '' }]
    })
  });

  // READY
  const ready = await dcDispositionService.markReady(id, 'verify');
  assert(ready.lifecycleStatus === 'READY', 'expected READY');
  const resv = await db('reservation').where({ owner_type: 'DC', owner_id: id, status: 'ACTIVE' }).first();
  assert(resv, 'expected ACTIVE reservation after READY');
  console.log('READY_OK', resv.id);

  // DISPATCH DEMO
  const dispatched = await dcDispositionService.dispatch(id, 'verify');
  assert(dispatched.lifecycleStatus === 'DISPATCHED', 'expected DISPATCHED');
  assert(dispatched.dispatchReason === 'DEMO', 'expected DEMO');
  const after = await db('assets').where({ id: asset.id }).first();
  assert(String(after.status) === 'Out on Demo', `expected Out on Demo got ${after.status}`);
  assert(String(after.sentagainstdc || '') === challanNo, 'sentagainstdc should be challan');
  console.log('DISPATCH_DEMO_OK', after.status);

  // Duplicate dispatch blocked
  let dupBlocked = false;
  try {
    await dcDispositionService.dispatch(id, 'verify');
  } catch (err) {
    dupBlocked = err.reasonCode === 'DUPLICATE_DISPATCH';
  }
  assert(dupBlocked, 'duplicate dispatch should fail');
  console.log('DUP_BLOCK_OK');

  // Reason immutable
  let reasonBlocked = false;
  try {
    await dcDispositionService.setDispatchReason(id, 'SALE', 'verify');
  } catch (err) {
    reasonBlocked = err.reasonCode === 'REASON_IMMUTABLE';
  }
  assert(reasonBlocked, 'reason change after dispatch should fail');
  console.log('REASON_IMMUTABLE_OK');

  // Reservation blocked while Out on Demo
  let reserveBlocked = false;
  try {
    await reservationService.reserve({
      resourceType: 'ASSET',
      resourceId: asset.id,
      ownerType: 'MANUAL',
      ownerId: 'verify-user',
      actor: 'verify'
    });
  } catch (err) {
    reserveBlocked = err.reasonCode === 'ASSET_STATUS_COMMITTED' || err.reasonCode === 'ASSET_COMMITTED_TO_DC';
  }
  assert(reserveBlocked, 'reservation should be blocked while Out on Demo');
  console.log('RESERVE_BLOCK_OK');

  // Outbox
  const outbox = await db('dc_dispatch_outbox').where({ delivery_challan_id: id }).first();
  assert(outbox && outbox.event_type === 'DC_DISPATCHED', 'outbox DC_DISPATCHED missing');
  console.log('OUTBOX_OK');

  // Event
  const ev = await db('delivery_challan_event').where({ delivery_challan_id: id, type: 'DISPATCHED' }).first();
  assert(ev, 'DISPATCHED event missing');
  console.log('EVENT_OK');

  // RETURN
  const returned = await dcDispositionService.returnFromDispatch(id, 'verify');
  assert(returned.returnedLineIds?.length >= 1, 'expected returned lines');
  const restored = await db('assets').where({ id: asset.id }).first();
  assert(!restored.sentagainstdc, 'sentagainstdc cleared on return');
  assert(String(restored.status) !== 'Out on Demo', 'status restored from Out on Demo');
  console.log('RETURN_OK', restored.status);

  // SALE no return
  const idSale = `DC-SALE-${Date.now()}`;
  let asset2 = await pickAsset();
  if (!asset2 || asset2.id === asset.id) {
    // After return, the same asset is eligible again — reuse for SALE path
    asset2 = await db('assets').where({ id: asset.id }).first();
  }
  assert(asset2, 'need an asset for SALE');
  await db('delivery_challans').insert({
    id: idSale,
    challanno: `98/${String(Date.now()).slice(-4)}`,
    customername: 'Sale Verify',
    deliverydate: new Date().toISOString().slice(0, 10),
    assetids: JSON.stringify([asset2.id]),
    status: 'DRAFT',
    lifecycle_status: 'DRAFT',
    dispatch_reason: 'SALE',
    qrcode: '',
    createdby: 'verify',
    timestamp: new Date().toISOString(),
    payloadjson: JSON.stringify({
      meta: { dispatchReason: 'SALE' },
      items: [{ assetId: asset2.id, resourceType: 'ASSET', qty: 1, description: asset2.itemname || asset2.id }]
    })
  });
  await dcDispositionService.markReady(idSale, 'verify');
  await dcDispositionService.dispatch(idSale, 'verify');
  const sold = await db('assets').where({ id: asset2.id }).first();
  assert(String(sold.status) === 'Sold' && Number(sold.is_retired) === 1, 'SALE should set Sold+retired');
  let saleReturnBlocked = false;
  try {
    await dcDispositionService.returnFromDispatch(idSale, 'verify');
  } catch (err) {
    saleReturnBlocked = err.reasonCode === 'SALE_NO_RETURN';
  }
  assert(saleReturnBlocked, 'SALE return must be rejected');
  console.log('SALE_OK');

  // Restore SALE test asset so scratch remains usable
  await db('assets').where({ id: asset2.id }).update({
    status: 'In Store',
    is_retired: 0,
    sentagainstdc: null,
    sale_details: null,
    lastupdated: new Date().toISOString()
  });
  console.log('SALE_ASSET_RESTORED');

  console.log('DC_DISPOSITION_VERIFY_OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('DC_DISPOSITION_VERIFY_FAIL', err);
  process.exit(1);
});
