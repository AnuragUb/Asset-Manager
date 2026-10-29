/**
 * Scratch verification: DC Return Inward + Return Log lifecycle.
 *   DB_NAME=asset_manager_dc_return_scratch node scripts/dc-return-inward-verify.js
 */
const { db } = require('../utils');
const dcDispositionService = require('../services/dcDispositionService');
const dcReturnInwardService = require('../services/dcReturnInwardService');
const receiptService = require('../services/receiptService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function restoreAsset(id, status) {
  await db('assets').where({ id }).update({
    status: status || 'In Store',
    sentagainstdc: null,
    is_retired: 0,
    lastupdated: new Date().toISOString()
  });
}

async function pickAssets(n) {
  await db('assets')
    .whereIn('status', ['Out on Demo', 'Out on Rental', 'Out for Repair', 'Sold'])
    .update({ status: 'In Store', sentagainstdc: null, is_retired: 0, lastupdated: new Date().toISOString() });
  return db('assets')
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .where(function () {
      this.whereNull('is_retired').orWhere('is_retired', 0);
    })
    .where(function () {
      this.whereNull('sentagainstdc').orWhere('sentagainstdc', '');
    })
    .whereNotIn('status', ['Sold', 'Scraped', 'Consumed', 'Project'])
    .orderBy('lastupdated', 'desc')
    .limit(n);
}

async function insertDraftDc({ id, challanNo, assetIds, reason, customer }) {
  await db('delivery_challans').insert({
    id,
    challanno: challanNo,
    customername: customer || 'Return Verify',
    deliverydate: new Date().toISOString().slice(0, 10),
    assetids: JSON.stringify(assetIds),
    status: 'DRAFT',
    lifecycle_status: 'DRAFT',
    dispatch_reason: reason,
    qrcode: '',
    createdby: 'verify',
    timestamp: new Date().toISOString(),
    payloadjson: JSON.stringify({
      account: { accountName: customer || 'Return Verify' },
      meta: { referenceNo: 'RET-VERIFY', dispatchReason: reason },
      lines: assetIds.map((aid) => ({
        assetId: aid,
        description: aid,
        qty: 1,
        resourceType: 'ASSET'
      }))
    })
  });
}

async function main() {
  assert(await db.schema.hasTable('dc_return_log'), 'dc_return_log missing — apply 20260925140000 first');

  const assets = await pickAssets(4);
  assert(assets.length >= 4, `Need 4 eligible assets, got ${assets.length}`);
  console.log('ASSETS', assets.map((a) => a.id).join(', '));

  const a0 = assets[0];
  const id1 = `DC-RET-FULL-${Date.now()}`;
  await insertDraftDc({ id: id1, challanNo: `RF/${String(Date.now()).slice(-4)}`, assetIds: [a0.id], reason: 'DEMO' });
  await dcDispositionService.markReady(id1, 'verify');
  await dcDispositionService.dispatch(id1, 'verify');
  let asset = await db('assets').where({ id: a0.id }).first();
  assert(asset.status === 'Out on Demo', `expected Out on Demo, got ${asset.status}`);

  const created = await dcReturnInwardService.createReturnLog({
    dcId: id1,
    returnReason: 'DEMO_COMPLETED',
    returnedByParty: 'EDCIL',
    vendorInvoiceNo: 'VERIFY-INV',
    receivedByUser: 'Swapnil',
    actor: 'verify-recorder',
    notes: 'full return test'
  });
  assert(created.returnLog.id.startsWith('RET-'), `bad RET id ${created.returnLog.id}`);
  asset = await db('assets').where({ id: a0.id }).first();
  assert(asset.status === 'Out on Demo', 'OPEN must not restore asset');

  await receiptService.postReceipt(created.receiptNoteId, { actor: 'verify-recorder', host: 'localhost' });
  asset = await db('assets').where({ id: a0.id }).first();
  assert(asset.status !== 'Out on Demo', `asset should be restored, got ${asset.status}`);
  assert(!asset.sentagainstdc, 'sentagainstdc should clear');
  assert((await dcReturnInwardService.getReturnPosition(id1)).position === 'FULLY_RETURNED', 'FULLY_RETURNED');
  assert((await db('dc_return_log').where({ id: created.returnLog.id }).first()).status === 'POSTED', 'log POSTED');
  assert((await db('dc_return_inward_outbox').where({ receipt_note_id: created.receiptNoteId }).first())?.event_type === 'RETURN_INWARD_POSTED', 'outbox');
  assert(created.returnLog.returnedByParty === 'EDCIL' && created.returnLog.receivedByUser === 'Swapnil' && created.returnLog.createdBy === 'verify-recorder', 'party fields');
  console.log('OK FULL ASSET RETURN', created.returnLog.id);

  const batch = assets.slice(1, 4);
  const id2 = `DC-RET-PART-${Date.now()}`;
  await insertDraftDc({ id: id2, challanNo: `RP/${String(Date.now()).slice(-4)}`, assetIds: batch.map((a) => a.id), reason: 'RENTAL' });
  await dcDispositionService.markReady(id2, 'verify');
  await dcDispositionService.dispatch(id2, 'verify');
  const disp = await db('dc_disposition_line').where({ delivery_challan_id: id2 });
  assert(disp.length === 3, 'expected 3 disposition lines');

  const ret1 = await dcReturnInwardService.createReturnLog({
    dcId: id2,
    returnReason: 'RENTAL_COMPLETED',
    returnedByParty: 'Client A',
    vendorInvoiceNo: 'VERIFY-INV',
    receivedByUser: 'Ops1',
    actor: 'verify',
    autoAll: false,
    lines: [
      { dispositionLineId: disp[0].id, quantity: 1, serialNumber: disp[0].serial_snapshot },
      { dispositionLineId: disp[1].id, quantity: 1, serialNumber: disp[1].serial_snapshot }
    ]
  });
  await receiptService.postReceipt(ret1.receiptNoteId, { actor: 'verify', host: 'localhost' });
  let pos = await dcReturnInwardService.getReturnPosition(id2);
  assert(pos.position === 'PARTIALLY_RETURNED', `PARTIAL got ${pos.position}`);
  assert(pos.returnedAssets === 2 && pos.stillOutAssets === 1, '2 returned / 1 still out');

  const ret2 = await dcReturnInwardService.createReturnLog({
    dcId: id2,
    returnReason: 'CUSTOMER_RETURN',
    returnedByParty: 'Client A',
    vendorInvoiceNo: 'VERIFY-INV',
    receivedByUser: 'Ops2',
    actor: 'verify',
    autoAll: false,
    lines: [{ dispositionLineId: disp[2].id, quantity: 1, serialNumber: disp[2].serial_snapshot }]
  });
  assert(ret2.receiptNoteId !== ret1.receiptNoteId, 'separate RNs');
  await receiptService.postReceipt(ret2.receiptNoteId, { actor: 'verify', host: 'localhost' });
  assert((await dcReturnInwardService.getReturnPosition(id2)).position === 'FULLY_RETURNED', 'FULLY after #2');
  console.log('OK PARTIAL + MULTIPLE');

  await restoreAsset(a0.id, 'In Store');
  const id3 = `DC-RET-SN-${Date.now()}`;
  await insertDraftDc({ id: id3, challanNo: `RS/${String(Date.now()).slice(-4)}`, assetIds: [a0.id], reason: 'DEMO' });
  await dcDispositionService.markReady(id3, 'verify');
  await dcDispositionService.dispatch(id3, 'verify');
  const d3 = await db('dc_disposition_line').where({ delivery_challan_id: id3 }).first();
  const assetRow = await db('assets').where({ id: a0.id }).first();
  const knownSerial = d3.serial_snapshot || assetRow.srno || assetRow.SrNo || null;
  if (knownSerial) {
    let rejected = false;
    try {
      await dcReturnInwardService.createReturnLog({
        dcId: id3,
        returnReason: 'DEMO_COMPLETED',
        returnedByParty: 'X',
        vendorInvoiceNo: 'VERIFY-INV',
        receivedByUser: 'Y',
        actor: 'verify',
        autoAll: false,
        lines: [{ dispositionLineId: d3.id, serialNumber: 'WRONG-SERIAL-999' }]
      });
    } catch (err) {
      rejected = err.reasonCode === 'SERIAL_MISMATCH' || /Serial mismatch/i.test(err.message);
    }
    assert(rejected, 'wrong serial must reject');
    console.log('OK SERIAL VALIDATION');
  } else {
    console.log('SKIP SERIAL VALIDATION (asset has no serial)');
  }

  const okRet = await dcReturnInwardService.createReturnLog({
    dcId: id3,
    returnReason: 'DEMO_COMPLETED',
    returnedByParty: 'X',
    vendorInvoiceNo: 'VERIFY-INV',
    receivedByUser: 'Y',
    actor: 'verify',
    autoAll: false,
    lines: [{
      dispositionLineId: d3.id,
      quantity: 1,
      serialNumber: knownSerial || undefined
    }]
  });
  await receiptService.postReceipt(okRet.receiptNoteId, { actor: 'verify', host: 'localhost' });
  let dupRejected = false;
  try {
    await dcReturnInwardService.createReturnLog({
      dcId: id3,
      returnReason: 'DEMO_COMPLETED',
      returnedByParty: 'X',
      vendorInvoiceNo: 'VERIFY-INV',
      receivedByUser: 'Y',
      actor: 'verify'
    });
  } catch (err) {
    dupRejected = true;
  }
  assert(dupRejected, 'duplicate return must reject');
  console.log('OK DUPLICATE ASSET RETURN');

  await restoreAsset(a0.id, 'In Store');
  const idSale = `DC-RET-SALE-${Date.now()}`;
  await insertDraftDc({ id: idSale, challanNo: `RX/${String(Date.now()).slice(-4)}`, assetIds: [a0.id], reason: 'SALE' });
  await dcDispositionService.markReady(idSale, 'verify');
  await dcDispositionService.dispatch(idSale, 'verify');
  let saleRejected = false;
  try {
    await dcReturnInwardService.createReturnLog({
      dcId: idSale,
      returnReason: 'CUSTOMER_RETURN',
      returnedByParty: 'Buyer',
      vendorInvoiceNo: 'VERIFY-INV',
      receivedByUser: 'Ops',
      actor: 'verify'
    });
  } catch (err) {
    saleRejected = err.reasonCode === 'SALE_NO_RETURN';
  }
  assert(saleRejected, 'SALE return must reject');
  console.log('OK SALE RETURN REJECT');
  await restoreAsset(a0.id, 'In Store');

  await restoreAsset(assets[1].id, 'In Store');
  const idC = `DC-RET-CAN-${Date.now()}`;
  await insertDraftDc({ id: idC, challanNo: `RC/${String(Date.now()).slice(-4)}`, assetIds: [assets[1].id], reason: 'REPAIR' });
  await dcDispositionService.markReady(idC, 'verify');
  await dcDispositionService.dispatch(idC, 'verify');
  const openRet = await dcReturnInwardService.createReturnLog({
    dcId: idC,
    returnReason: 'REPAIR_COMPLETED',
    returnedByParty: 'Vendor',
    vendorInvoiceNo: 'VERIFY-INV',
    receivedByUser: 'Tech',
    actor: 'verify'
  });
  await receiptService.cancelReceipt(openRet.receiptNoteId, { actor: 'verify' });
  assert((await db('assets').where({ id: assets[1].id }).first()).status === 'Out for Repair', 'cancel must not restore');
  assert((await db('dc_return_log').where({ id: openRet.returnLog.id }).first()).status === 'CANCELLED', 'log cancelled');
  console.log('OK RN CANCEL NO PHYSICAL');
  await restoreAsset(assets[1].id, 'In Store');

  console.log('\nALL DC RETURN INWARD CHECKS PASSED');
  await db.destroy();
}

main().catch(async (err) => {
  console.error('FAIL', err.message, err.reasonCode || '', err.stack);
  try { await db.destroy(); } catch (_) { /* ignore */ }
  process.exit(1);
});
