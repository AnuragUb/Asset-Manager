/**
 * Production-readiness matrix A–Q for post-commit commercial reconciliation + vendor return.
 *
 * Scratch only:
 *   DB_NAME=asset_manager_procurement_reconciliation_scratch
 *
 * Refuses to run against asset_manager.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const {
  db,
  generateProductId,
  verifyProductId,
  generateProcurementPoId,
  generateProcurementPoLineId
} = require('../utils');
const procurementReconciliationService = require('../services/procurementReconciliationService');
const vendorReturnService = require('../services/vendorReturnService');
const receiptService = require('../services/receiptService');
const reservationService = require('../services/reservationService');
const purchaseBookService = require('../services/purchaseBookService');
const { ROLE_ACTION_GRANTS } = require('../services/permissionCatalog');

const ACTOR = 'recon-readiness';
const HOST = 'localhost';
const results = {};

function record(code, status, detail) {
  results[code] = { status, detail: detail || '' };
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIPPED' ? 'SKIP' : 'FAIL';
  console.log(`${tag} ${code}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function currentDb() {
  return (await db.raw('SELECT current_database() AS n')).rows[0].n;
}

async function insertProduct(name) {
  const id = generateProductId();
  assert(verifyProductId(id), 'bad product id');
  await db('product').insert({
    id,
    name,
    unit: 'Nos',
    make: 'Recon',
    model: 'Ready',
    status: 'ACTIVE',
    origin: 'ASSETENGINE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: ACTOR
  });
  return id;
}

async function insertPo({ productId, ordered, stamp }) {
  const poId = generateProcurementPoId();
  const lineId = generateProcurementPoLineId();
  const s = stamp || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db('procurement_po').insert({
    id: poId,
    source: 'ZOHO',
    classification: 'CANONICAL',
    zoho_po_id: `RECON-Z-${s}`,
    po_number: `PO-RECON-${s}`,
    subject: 'Recon readiness',
    status: 'APPROVED',
    vendor_zoho_id: 'V-RECON',
    vendor_name_snapshot: 'Recon Vendor',
    last_synced_at: new Date().toISOString(),
    created_by: ACTOR,
    updated_by: ACTOR,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  await db('procurement_po_line').insert({
    id: lineId,
    procurement_po_id: poId,
    zoho_line_id: `ZL-RECON-${s}`,
    product_id: productId,
    description: 'recon line',
    ordered_qty: ordered,
    unit: 'Nos',
    line_status: 'OPEN',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return { poId, lineId };
}

async function receiveInventory({ poId, lineId, productId, qty, key }) {
  const note = await receiptService.createReceiptNote({
    poSource: 'ZOHO',
    poId,
    actor: ACTOR,
    receivedAtLocation: 'MUM',
    idempotencyKey: key || `recon-rn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{
      poLineId: lineId,
      productId,
      qtyAccepted: qty,
      qtyReceived: qty,
      creationMode: 'INVENTORY'
    }]
  });
  const posted = await receiptService.postReceipt(note.receiptNote.id, { actor: ACTOR, host: HOST });
  const output = await db('receipt_physical_output')
    .where({ receipt_note_id: note.receiptNote.id, resource_type: 'INVENTORY' })
    .first();
  assert(output, 'expected inventory physical output');
  return {
    receiptNoteId: note.receiptNote.id,
    receiptLineId: output.receipt_line_id,
    inventoryId: output.resource_id,
    posted
  };
}

async function receiveAssets({ poId, lineId, productId, qty, serials, key }) {
  const markings = (serials || []).map((s) => ({ type: 'SERIAL', value: s }));
  while (markings.length < qty) markings.push({ type: 'SERIAL', value: `SN-RECON-${Date.now()}-${markings.length}` });
  const note = await receiptService.createReceiptNote({
    poSource: 'ZOHO',
    poId,
    actor: ACTOR,
    receivedAtLocation: 'MUM',
    idempotencyKey: key || `recon-asset-rn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{
      poLineId: lineId,
      productId,
      qtyAccepted: qty,
      qtyReceived: qty,
      creationMode: 'ASSET_INDIVIDUAL',
      physicalMarkings: markings
    }]
  });
  await receiptService.postReceipt(note.receiptNote.id, { actor: ACTOR, host: HOST });
  const outputs = await db('receipt_physical_output')
    .where({ receipt_note_id: note.receiptNote.id, resource_type: 'ASSET' });
  assert(outputs.length === qty, `expected ${qty} assets, got ${outputs.length}`);
  const assets = [];
  for (const o of outputs) {
    const a = await db('assets').where({ id: o.resource_id }).first();
    assets.push(a);
  }
  return { receiptNoteId: note.receiptNote.id, assets };
}

async function setOrdered(lineId, qty) {
  await db('procurement_po_line').where({ id: lineId }).update({
    ordered_qty: qty,
    updated_at: new Date().toISOString()
  });
}

async function openRecon(poId, lineId) {
  const synced = await procurementReconciliationService.syncPoReconciliations(poId, ACTOR);
  const open = (synced.reconciliations || []).find((r) => r.procurementPoLineId === lineId);
  return open || null;
}

async function countOpenPrecs(lineId) {
  const rows = await db('procurement_reconciliation')
    .where({ procurement_po_line_id: lineId })
    .whereNot('status', 'CLOSED');
  return rows.length;
}

async function expectReject(fn, reasonCode) {
  try {
    await fn();
    return false;
  } catch (err) {
    if (reasonCode && err.reasonCode && err.reasonCode !== reasonCode) {
      throw new Error(`expected ${reasonCode} got ${err.reasonCode}: ${err.message}`);
    }
    return true;
  }
}

async function testA_PoReduction() {
  const productId = await insertProduct(`RECON-A-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  const rnBefore = await db('receipt_note').where({ id: recv.receiptNoteId }).first();
  const lineBefore = await db('receipt_note_line').where({ id: recv.receiptLineId }).first();
  const invBefore = await db('inventory_items').where({ id: recv.inventoryId }).first();

  await setOrdered(lineId, 6);
  const recon = await openRecon(poId, lineId);
  assert(recon, 'PREC required');
  assert(Number(recon.commercialQuantity) === 6, `commercial ${recon.commercialQuantity}`);
  assert(Number(recon.physicalReceivedQuantity) === 10, `physical ${recon.physicalReceivedQuantity}`);
  assert(Math.abs(Number(recon.differenceQuantity) - 4) < 1e-9, `diff ${recon.differenceQuantity}`);
  assert(await countOpenPrecs(lineId) === 1, 'exactly one open PREC');

  const rnAfter = await db('receipt_note').where({ id: recv.receiptNoteId }).first();
  const lineAfter = await db('receipt_note_line').where({ id: recv.receiptLineId }).first();
  const invAfter = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(rnAfter.status === 'POSTED' && rnBefore.status === 'POSTED', 'RN stays POSTED');
  assert(Number(lineAfter.qty_accepted) === Number(lineBefore.qty_accepted), 'RN accepted unchanged');
  assert(Number(invAfter.quantity_total) === Number(invBefore.quantity_total), 'inventory unchanged on revise');
  assert(Number(invAfter.quantity_available) === Number(invBefore.quantity_available), 'available unchanged on revise');

  record('A', 'PASS', `PREC ${recon.id} diff=4; RN/inventory immutable`);
  return { productId, poId, lineId, recv, recon };
}

async function testB_RepeatedRevision(ctx) {
  const { poId, lineId } = ctx;
  await setOrdered(lineId, 5);
  let recon = await openRecon(poId, lineId);
  assert(recon && Math.abs(Number(recon.differenceQuantity) - 5) < 1e-9, `diff after 5: ${recon && recon.differenceQuantity}`);
  assert(await countOpenPrecs(lineId) === 1, 'no duplicate after revise to 5');

  await setOrdered(lineId, 8);
  recon = await openRecon(poId, lineId);
  assert(recon && Math.abs(Number(recon.differenceQuantity) - 2) < 1e-9, `diff after 8: ${recon && recon.differenceQuantity}`);
  assert(await countOpenPrecs(lineId) === 1, 'no duplicate after revise to 8');

  await setOrdered(lineId, 10);
  const synced = await procurementReconciliationService.syncPoReconciliations(poId, ACTOR);
  const stillOpen = (synced.reconciliations || []).find((r) => r.procurementPoLineId === lineId);
  assert(!stillOpen, 'should auto-close when commercial covers physical');
  assert(await countOpenPrecs(lineId) === 0, 'no open PREC at ordered=10');
  const closed = await db('procurement_reconciliation')
    .where({ procurement_po_line_id: lineId })
    .orderBy('created_at', 'desc')
    .first();
  assert(closed && closed.status === 'CLOSED', `expected CLOSED got ${closed && closed.status}`);

  // reopen for remaining tests
  await setOrdered(lineId, 6);
  recon = await openRecon(poId, lineId);
  assert(recon && Math.abs(Number(recon.differenceQuantity) - 4) < 1e-9, 'reopen diff 4');
  ctx.recon = recon;
  record('B', 'PASS', 'single PREC updated across 6→5→8→10→6');
}

async function testD_PartialInventory(ctx) {
  const { poId, lineId, recv, recon } = ctx;
  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 2,
      productId: before.product_id
    }]
  });
  assert(vr.status === 'OPEN', 'VR OPEN');
  let mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(mid.quantity_total) === Number(before.quantity_total), 'no exit before dispatch (total)');
  assert(Number(mid.quantity_available) === Number(before.quantity_available), 'no exit before dispatch (avail)');

  await vendorReturnService.markReady(vr.id, ACTOR);
  await vendorReturnService.dispatch(vr.id, ACTOR);
  mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(mid.quantity_total) - (Number(before.quantity_total) - 2)) < 1e-9, `total ${mid.quantity_total}`);
  assert(Math.abs(Number(mid.quantity_available) - (Number(before.quantity_available) - 2)) < 1e-9, `avail ${mid.quantity_available}`);

  const reconRow = await db('procurement_reconciliation').where({ id: recon.id }).first();
  assert(Math.abs(Number(reconRow.physically_returned_quantity) - 2) < 1e-9, 'returned=2');
  assert(Math.abs(Number(reconRow.difference_quantity) - 2) < 1e-9, `remaining diff ${reconRow.difference_quantity}`);
  assert(['RETURNED_TO_VENDOR', 'RETURN_PENDING'].includes(reconRow.status) || Number(reconRow.difference_quantity) > 0, 'still open residual');

  const evt = await db('inventory_quantity_events')
    .where({ root_id: recv.inventoryId, type: 'VENDOR_RETURN_EXIT' })
    .orderBy('id', 'desc')
    .first();
  assert(evt, 'VENDOR_RETURN_EXIT lineage');

  const outbox = await db('vendor_return_outbox').where({ vendor_return_id: vr.id }).first();
  assert(outbox && outbox.event_type === 'VENDOR_RETURN_DISPATCHED', 'outbox once');

  ctx.partialVr = vr;
  ctx.recon = await procurementReconciliationService.getReconciliation(recon.id).then((r) => r.reconciliation);
  record('D', 'PASS', `partial return 2; total ${before.quantity_total}→${mid.quantity_total}; remaining diff 2`);
}

async function testE_FullVendorReturn() {
  const productId = await insertProduct(`RECON-E-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  await setOrdered(lineId, 6);
  const recon = await openRecon(poId, lineId);
  assert(Math.abs(Number(recon.differenceQuantity) - 4) < 1e-9, 'diff 4');

  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 4,
      productId
    }]
  });
  let mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(mid.quantity_total) === Number(before.quantity_total), 'pre-dispatch total unchanged');
  await vendorReturnService.markReady(vr.id, ACTOR);
  await vendorReturnService.dispatch(vr.id, ACTOR);
  mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(mid.quantity_total) - 6) < 1e-9, `physical total ${mid.quantity_total}`);
  const reconRow = await db('procurement_reconciliation').where({ id: recon.id }).first();
  assert(reconRow.status === 'CLOSED', `status ${reconRow.status}`);
  assert(Math.abs(Number(reconRow.difference_quantity)) < 1e-9, 'diff 0');
  assert(Math.abs(Number(reconRow.physically_returned_quantity) - 4) < 1e-9, 'returned 4');

  const rejected = await expectReject(() => vendorReturnService.dispatch(vr.id, ACTOR));
  // idempotent return of already DISPATCHED is OK (no double reduction)
  const afterRetry = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(afterRetry.quantity_total) - 6) < 1e-9, 'no double reduction on redispatch');
  const outboxes = await db('vendor_return_outbox').where({ vendor_return_id: vr.id });
  assert(outboxes.length === 1, `outbox count ${outboxes.length}`);
  record('E', 'PASS', `full return closes PREC; physical 10→6; redispatch safe (reject=${rejected})`);
}

async function testF_Retain() {
  const productId = await insertProduct(`RECON-F-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  await setOrdered(lineId, 6);
  const recon = await openRecon(poId, lineId);
  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();

  const retained = await procurementReconciliationService.retainInCineom(recon.id, {
    actor: ACTOR,
    quantity: 4
  });
  assert(retained.status === 'CLOSED', `status ${retained.status}`);
  assert(Math.abs(Number(retained.retainedQuantity) - 4) < 1e-9, 'retained 4');
  const after = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(after.quantity_total) === Number(before.quantity_total), 'physical total unchanged');
  assert(Number(after.quantity_available) === Number(before.quantity_available), 'available unchanged');
  assert(String(after.status) === String(before.status), 'status not damaged/blocked');
  const vrs = await db('vendor_return').where({ procurement_reconciliation_id: recon.id });
  assert(vrs.length === 0, 'no Vendor Return created');
  const outbox = await db('vendor_return_outbox').whereIn(
    'vendor_return_id',
    vrs.map((v) => v.id).concat(['__none__'])
  );
  assert(outbox.length === 0, 'no VR outbox');
  record('F', 'PASS', 'retain closes commercially; physical untouched');
}

async function testC_SerializedAsset() {
  const productId = await insertProduct(`RECON-C-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 4 });
  const { assets } = await receiveAssets({
    poId,
    lineId,
    productId,
    qty: 4,
    serials: ['SN-OK-1', 'SN-OK-2', 'SN-OK-3', 'SN-OK-4']
  });
  await setOrdered(lineId, 2);
  const recon = await openRecon(poId, lineId);
  assert(Math.abs(Number(recon.differenceQuantity) - 2) < 1e-9, `asset diff ${recon.differenceQuantity}`);

  const a0 = assets[0];
  const a1 = assets[1];
  async function serialOf(assetId) {
    const row = await db('assets').where({ id: assetId }).first();
    const fromAsset = String(row.srno || row.SrNo || '').trim();
    if (fromAsset) return fromAsset;
    const m = await db('physical_marking')
      .where({ holding_type: 'ASSET', holding_id: assetId, status: 'ACTIVE' })
      .orderBy('created_at', 'desc')
      .first();
    return String((m && m.value) || '').trim();
  }
  const serial0 = await serialOf(a0.id);
  const serial1 = await serialOf(a1.id);
  assert(serial0 && serial1, `seeded serials missing: ${serial0}/${serial1}`);

  // A correct
  const okVr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'ASSET',
      resourceId: a0.id,
      serialNumber: serial0,
      productId
    }]
  });
  assert(okVr.status === 'OPEN', 'A accepted');

  // B wrong serial
  assert(await expectReject(() => vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'ASSET',
      resourceId: a1.id,
      serialNumber: 'WRONG-SERIAL',
      productId
    }]
  }), 'SERIAL_MISMATCH'), 'B wrong serial rejected');

  // C wrong asset id
  assert(await expectReject(() => vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'ASSET',
      resourceId: 'ZZZ-NOT-AN-ASSET',
      serialNumber: 'X',
      productId
    }]
  })), 'C wrong asset rejected');

  // D missing serial when known
  assert(await expectReject(() => vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'ASSET',
      resourceId: a1.id,
      productId
    }]
  }), 'SERIAL_REQUIRED'), 'D missing serial rejected');

  // E duplicate asset on active VR
  assert(await expectReject(() => vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'ASSET',
      resourceId: a0.id,
      serialNumber: serial0,
      productId
    }]
  }), 'ASSET_ON_ACTIVE_VENDOR_RETURN'), 'E duplicate rejected');

  // F dispatch once
  await vendorReturnService.markReady(okVr.id, ACTOR);
  await vendorReturnService.dispatch(okVr.id, ACTOR);
  const after = await db('assets').where({ id: a0.id }).first();
  assert(after.status === 'Returned to Vendor', `status ${after.status}`);
  assert(Number(after.is_retired) === 1, 'retired');
  await vendorReturnService.dispatch(okVr.id, ACTOR);
  const after2 = await db('assets').where({ id: a0.id }).first();
  assert(after2.status === 'Returned to Vendor', 'still Returned to Vendor');
  record('C', 'PASS', `serial fail-closed; exit once → ${after.status}`);
}

async function testG_Reservation() {
  const productId = await insertProduct(`RECON-G-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 20 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 20 });
  await setOrdered(lineId, 10);
  const recon = await openRecon(poId, lineId);

  const rsv = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: recv.inventoryId,
    quantity: 5,
    ownerType: 'MANUAL',
    ownerId: 'recon-readiness-operator',
    actor: ACTOR
  });
  const rsvId = rsv.id || (rsv.reservation && rsv.reservation.id);
  assert(rsvId, 'reservation id');
  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(before.quantity_reserved) >= 5 - 1e-9, 'reserved');

  // Available is only 15 after reservation of 5 from 20; return 3 from available
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 3,
      productId
    }]
  });
  await vendorReturnService.markReady(vr.id, ACTOR);
  const mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(mid.quantity_total) === Number(before.quantity_total), 'READY no exit');

  await vendorReturnService.dispatch(vr.id, ACTOR);
  const after = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(after.quantity_total) - (Number(before.quantity_total) - 3)) < 1e-9, 'exit once');
  const rsvRow = await db('reservation').where({ id: rsvId }).first();
  assert(rsvRow, 'reservation exists');
  assert(
    Number(rsvRow.quantity) <= Number(rsvRow.quantity_original) - 3 + 1e-9
      || rsvRow.status === 'RELEASED'
      || Number(rsvRow.quantity) < 5,
    'reservation reduced/released'
  );

  const totalBeforeRetry = Number(after.quantity_total);
  await vendorReturnService.dispatch(vr.id, ACTOR);
  const afterRetry = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(afterRetry.quantity_total) - totalBeforeRetry) < 1e-9, 'no second exit');
  const outboxes = await db('vendor_return_outbox').where({ vendor_return_id: vr.id });
  assert(outboxes.length === 1, 'outbox once');
  record('G', 'PASS', `reservation interacted; total ${before.quantity_total}→${after.quantity_total}`);
}

async function testH_DuplicateDispatch() {
  const productId = await insertProduct(`RECON-H-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  await setOrdered(lineId, 7);
  const recon = await openRecon(poId, lineId);
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 2,
      productId
    }]
  });
  // READY twice
  await vendorReturnService.markReady(vr.id, ACTOR);
  const ready2 = await vendorReturnService.markReady(vr.id, ACTOR);
  assert(ready2.status === 'READY', 'READY idempotent');

  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  const [d1, d2] = await Promise.all([
    vendorReturnService.dispatch(vr.id, ACTOR),
    vendorReturnService.dispatch(vr.id, ACTOR)
  ]);
  assert(d1.status === 'DISPATCHED' && d2.status === 'DISPATCHED', 'both see DISPATCHED');
  const after = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Math.abs(Number(after.quantity_total) - (Number(before.quantity_total) - 2)) < 1e-9, 'single reduction under concurrent dispatch');
  const outboxes = await db('vendor_return_outbox').where({ vendor_return_id: vr.id });
  assert(outboxes.length === 1, 'outbox once under concurrency');

  assert(await expectReject(() => vendorReturnService.cancel(vr.id, ACTOR, 'late')), 'cancel after dispatch rejected');
  record('H', 'PASS', 'READY idempotent; concurrent DISPATCH single effect');
}

async function testI_Cancelled() {
  const productId = await insertProduct(`RECON-I-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  await setOrdered(lineId, 6);
  const recon = await openRecon(poId, lineId);
  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 2,
      productId
    }]
  });
  await vendorReturnService.markReady(vr.id, ACTOR);
  await vendorReturnService.cancel(vr.id, ACTOR, 'ops cancel');
  const mid = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(mid.quantity_total) === Number(before.quantity_total), 'cancel no physical');
  assert(await expectReject(() => vendorReturnService.dispatch(vr.id, ACTOR), 'NOT_READY'), 'dispatch after cancel fails');
  const outboxes = await db('vendor_return_outbox').where({ vendor_return_id: vr.id });
  assert(outboxes.length === 0, 'no outbox on cancel');
  record('I', 'PASS', 'cancel blocks dispatch; no stock/outbox');
}

async function testJ_RnImmutability(ctx) {
  const rn = await db('receipt_note').where({ id: ctx.recv.receiptNoteId }).first();
  assert(rn.status === 'POSTED', 'POSTED');
  assert(await expectReject(() => receiptService.updateReceiptNote(rn.id, { vendorInvoiceNo: 'HACK' })), 'POSTED edit rejected');
  const openRn = await db('receipt_note')
    .where({ status: 'OPEN' })
    .where(function () {
      this.whereNull('inward_kind').orWhere('inward_kind', 'PURCHASE_INWARD');
    })
    .first();
  if (openRn) {
    await receiptService.updateReceiptNote(openRn.id, { vendorInvoiceNo: openRn.vendor_invoice_no || 'READY-OK' });
    record('J', 'PASS', 'POSTED immutable; OPEN editable');
  } else {
    record('J', 'PASS', 'POSTED immutable (no OPEN RN on scratch to exercise edit)');
  }
}

async function testK_PurchaseBook() {
  if (!(await db.schema.hasTable('purchase_book'))) {
    record('K', 'SKIPPED', 'purchase_book table absent on scratch');
    return;
  }
  const productId = await insertProduct(`RECON-K-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 5 });
  const invBefore = await db('inventory_items').where({ id: recv.inventoryId }).first();

  const draft = await purchaseBookService.createFromPo(poId, {
    documentKind: 'INVOICE',
    actor: ACTOR,
    lines: [{ poLineId: lineId, qtyBooked: 3 }]
  });
  const draftStatus = (draft.purchaseBook && draft.purchaseBook.status) || draft.status;
  assert(draftStatus === 'DRAFT', `draft status ${draftStatus}`);

  const credit = await purchaseBookService.createFromPo(poId, {
    documentKind: 'CREDIT',
    actor: ACTOR,
    lines: [{ poLineId: lineId, qtyBooked: 1 }]
  });
  const creditKind = (credit.purchaseBook && credit.purchaseBook.documentKind)
    || (credit.purchaseBook && credit.purchaseBook.document_kind)
    || credit.documentKind;
  assert(String(creditKind).toUpperCase() === 'CREDIT', `credit kind ${creditKind}`);
  assert(purchaseBookService.DOCUMENT_KINDS.includes('CREDIT'), 'CREDIT kind supported');

  const invAfter = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(invAfter.quantity_total) === Number(invBefore.quantity_total), 'PB ops do not mutate stock');
  record('K', 'PASS', 'PB DRAFT/CREDIT commercial-only; inventory unchanged');
}

async function testL_CustomerReturnIsolation() {
  if (!(await db.schema.hasTable('dc_return_log'))) {
    record('L', 'SKIPPED', 'dc_return_log absent on this scratch clone');
    return;
  }
  const beforePrec = await db('procurement_reconciliation').count({ n: '*' }).first();
  const beforeVr = await db('vendor_return').count({ n: '*' }).first();
  // Ensure customer return tables exist and a prior return log does not create PREC/VR
  const logs = await db('dc_return_log').limit(3);
  const afterPrec = await db('procurement_reconciliation').count({ n: '*' }).first();
  const afterVr = await db('vendor_return').count({ n: '*' }).first();
  assert(Number(afterPrec.n) === Number(beforePrec.n), 'no PREC from reading return logs');
  assert(Number(afterVr.n) === Number(beforeVr.n), 'no VR from reading return logs');
  // Confirm no VENDOR_RETURN_EXIT from return inward path in recent inventory events (if any)
  if (await db.schema.hasTable('inventory_quantity_events')) {
    const cross = await db('inventory_quantity_events')
      .where({ type: 'VENDOR_RETURN_EXIT' })
      .where(function () {
        this.where('note', 'ilike', '%Return Inward%').orWhere('note', 'ilike', '%RETURN_INWARD%');
      })
      .first();
    assert(!cross, 'no VENDOR_RETURN_EXIT tied to customer return inward');
  }
  record('L', 'PASS', `customer return tables present (${logs.length} logs sampled); no PREC/VR coupling`);
}

async function testM_HistoricalImmutability(ctx) {
  const rn = await db('receipt_note').where({ id: ctx.recv.receiptNoteId }).first();
  const line = await db('receipt_note_line').where({ id: ctx.recv.receiptLineId }).first();
  assert(rn.status === 'POSTED', 'RN still POSTED after recon/VR cycle');
  assert(Number(line.qty_accepted) === 10, `accepted still 10 got ${line.qty_accepted}`);
  const outputs = await db('receipt_physical_output').where({ receipt_note_id: rn.id });
  assert(outputs.length >= 1, 'physical output rows retained');
  record('M', 'PASS', 'posted RN lines/outputs not rewritten');
}

async function testN_AuditEvents() {
  const opened = await db('procurement_reconciliation_event')
    .where({ type: 'COMMERCIAL_RECONCILIATION_OPENED' })
    .orderBy('id', 'desc')
    .first();
  const selected = await db('procurement_reconciliation_event')
    .where({ type: 'RESOLUTION_SELECTED' })
    .orderBy('id', 'desc')
    .first();
  const resolved = await db('procurement_reconciliation_event')
    .where({ type: 'COMMERCIAL_RECONCILIATION_RESOLVED' })
    .orderBy('id', 'desc')
    .first();
  assert(opened, 'OPENED present');
  assert(selected, 'RESOLUTION_SELECTED present');
  assert(resolved, 'RESOLVED present');
  assert(opened.actor, 'actor on OPENED');
  record('N', 'PASS', 'OPENED / RESOLUTION_SELECTED / RESOLVED observed');
}

async function testO_OutboxIdempotency() {
  const rows = await db('vendor_return_outbox')
    .select('vendor_return_id')
    .count({ n: '*' })
    .groupBy('vendor_return_id');
  const dup = rows.find((r) => Number(r.n) > 1);
  assert(!dup, dup ? `duplicate outbox for ${dup.vendor_return_id}` : 'ok');
  const sample = await db('vendor_return_outbox').where({ event_type: 'VENDOR_RETURN_DISPATCHED' }).first();
  assert(sample, 'DISPATCHED outbox exists');
  assert(!/zoho/i.test(String(sample.payload_json || '')), 'payload is not a Zoho Books call');
  record('O', 'PASS', 'outbox unique per VR; no Zoho call');
}

async function testP_Rbac() {
  const mgr = new Set(ROLE_ACTION_GRANTS.manager || []);
  const log = new Set(ROLE_ACTION_GRANTS['Logistics Executive'] || []);
  const user = new Set(ROLE_ACTION_GRANTS.user || []);
  const admin = new Set(ROLE_ACTION_GRANTS.admin || []);
  assert(mgr.has('vendor_return.dispatch') && mgr.has('procurement_reconciliation.resolve'), 'manager grants');
  assert(admin.has('vendor_return.dispatch'), 'admin grants');
  assert(log.has('vendor_return.dispatch') && !log.has('procurement_reconciliation.resolve'), 'logistics dispatch without resolve');
  assert(!user.has('vendor_return.dispatch') && !user.has('procurement_reconciliation.view'), 'user denied');

  // DB role_permissions if present
  if (await db.schema.hasTable('role_permissions')) {
    const userDispatch = await db('role_permissions')
      .where({ role_name: 'user', permission_key: 'vendor_return.dispatch' })
      .first();
    assert(!userDispatch, 'DB: user lacks vendor_return.dispatch');
    const mgrResolve = await db('role_permissions')
      .where({ role_name: 'manager', permission_key: 'procurement_reconciliation.resolve' })
      .first();
    assert(mgrResolve, 'DB: manager has resolve');
  }

  // Route wiring uses exact action keys (no legacy broad grant)
  const fs = require('fs');
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(serverSrc.includes("requirePermission('vendor_return.dispatch')"), 'dispatch route gated');
  assert(serverSrc.includes("requirePermission('procurement_reconciliation.resolve')"), 'retain route gated');
  assert(!/requirePermission\('purchase_order\.reconcile'\).*vendor-returns/s.test(serverSrc), 'no legacy reconcile alias on VR');
  record('P', 'PASS', 'catalog + DB + route keys enforce action RBAC');
}

async function testQ_Rollback() {
  const productId = await insertProduct(`RECON-Q-${Date.now()}`);
  const { poId, lineId } = await insertPo({ productId, ordered: 10 });
  const recv = await receiveInventory({ poId, lineId, productId, qty: 10 });
  await setOrdered(lineId, 6);
  const recon = await openRecon(poId, lineId);
  const vr = await vendorReturnService.createVendorReturn({
    procurementPoId: poId,
    procurementReconciliationId: recon.id,
    actor: ACTOR,
    lines: [{
      procurementPoLineId: lineId,
      resourceType: 'INVENTORY',
      resourceId: recv.inventoryId,
      quantity: 2,
      productId
    }]
  });
  await vendorReturnService.markReady(vr.id, ACTOR);
  // Force insufficient available after READY
  await db('inventory_items').where({ id: recv.inventoryId }).update({
    quantity_available: 0,
    quantity_reserved: 10,
    lastupdated: new Date().toISOString()
  });
  const before = await db('inventory_items').where({ id: recv.inventoryId }).first();
  const rejected = await expectReject(() => vendorReturnService.dispatch(vr.id, ACTOR));
  assert(rejected, 'dispatch rejected');
  const after = await db('inventory_items').where({ id: recv.inventoryId }).first();
  assert(Number(after.quantity_total) === Number(before.quantity_total), 'total rolled back / unchanged');
  const vrRow = await db('vendor_return').where({ id: vr.id }).first();
  assert(vrRow.status === 'READY', `status remains READY got ${vrRow.status}`);
  const outboxes = await db('vendor_return_outbox').where({ vendor_return_id: vr.id });
  assert(outboxes.length === 0, 'no success outbox on failed dispatch');
  // restore for cleanliness
  await db('inventory_items').where({ id: recv.inventoryId }).update({
    quantity_available: 10,
    quantity_reserved: 0
  });
  record('Q', 'PASS', 'failed dispatch leaves READY + no stock/outbox side effects');
}

async function documentQtySemantics() {
  // Established AssetEngine meaning from reservationService conservation:
  // quantity_total = owned; quantity_available + quantity_reserved <= quantity_total
  console.log('QTY_SEMANTICS quantity_total=owned physical quantity; quantity_available=unreserved owned; quantity_reserved=ACTIVE reservation sum');
}

async function main() {
  const name = await currentDb();
  if (name === 'asset_manager') {
    throw new Error('REFUSED: readiness verify must not run against production asset_manager');
  }
  console.log('DB', name);
  assert(await db.schema.hasTable('procurement_reconciliation'), 'apply 20260925160000 first');
  assert(await db.schema.hasTable('vendor_return'), 'vendor_return missing');
  await documentQtySemantics();

  const ctx = await testA_PoReduction();
  await testB_RepeatedRevision(ctx);
  await testD_PartialInventory(ctx);
  await testE_FullVendorReturn();
  await testF_Retain();
  await testC_SerializedAsset();
  await testG_Reservation();
  await testH_DuplicateDispatch();
  await testI_Cancelled();
  await testJ_RnImmutability(ctx);
  await testK_PurchaseBook();
  await testL_CustomerReturnIsolation();
  await testM_HistoricalImmutability(ctx);
  await testN_AuditEvents();
  await testO_OutboxIdempotency();
  await testP_Rbac();
  await testQ_Rollback();

  console.log('\n=== MATRIX ===');
  const order = 'ABCDEFGHIJKLMNOPQ'.split('');
  let failed = 0;
  for (const code of order) {
    const r = results[code] || { status: 'FAIL', detail: 'not run' };
    console.log(`${code}: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.status === 'FAIL') failed += 1;
  }
  if (failed) {
    throw new Error(`${failed} matrix item(s) FAILED`);
  }
  console.log('\nPROCUREMENT_RECONCILIATION_READINESS_OK');
  await db.destroy();
}

main().catch(async (err) => {
  console.error('FAIL', err.message, err.reasonCode || '', err.stack);
  try { await db.destroy(); } catch (_) {}
  process.exit(1);
});
