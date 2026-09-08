/**
 * Phase 7 verification — Receipt Note / GRN.
 *
 * Scratch mutations:
 *   node scripts/receipt-phase7-verify.js --database-name asset_manager_phase7_scratch --write-baseline ./scripts/reports/phase7-scratch-before.json
 *   node scripts/receipt-phase7-verify.js --database-name asset_manager_phase7_scratch --compare-baseline ./scripts/reports/phase7-scratch-before.json --run-receipt-tests
 *
 * Production (no Receipt mutations):
 *   node scripts/receipt-phase7-verify.js --database-name asset_manager --compare-baseline ./scripts/reports/phase7-prod-before.json --http-base http://127.0.0.1:8080
 *
 * --run-receipt-tests mutates disposable rows only. Refused against asset_manager.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');
const path = require('path');
const {
  db,
  generateReceiptNoteId,
  verifyReceiptNoteId,
  generateReceiptLineId,
  verifyReceiptLineId,
  generateProductId,
  verifyProductId
} = require('../utils');
const receiptService = require('../services/receiptService');
const receiptProjectionService = require('../services/receiptProjectionService');
const reservationService = require('../services/reservationService');
const setService = require('../services/setService');

const failures = [];
const passes = [];
const MIS_ID = 'MIS-MUM-0826-H4XVLL-W';
const HOST = '127.0.0.1:8080';

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runReceiptTests: false,
    runPhaseRegression: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-receipt-tests') args.runReceiptTests = true;
    else if (token === '--run-phase-regression') args.runPhaseRegression = true;
  }
  return args;
}

function ok(name) {
  passes.push(name);
  console.log('PASS', name);
}

function fail(name, detail) {
  failures.push({ name, detail: String(detail || '') });
  console.error('FAIL', name, detail);
}

function assert(cond, name, detail) {
  if (cond) ok(name);
  else fail(name, detail || 'assertion failed');
}

async function currentDbName() {
  return (await db.raw('SELECT current_database() AS name')).rows[0].name;
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function expectReject(fn, reasonCode, name) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (!caught) {
    fail(name, 'expected rejection');
    return null;
  }
  const reasonOk = !reasonCode || caught.reasonCode === reasonCode
    || (Array.isArray(reasonCode) && reasonCode.includes(caught.reasonCode));
  const statusOk = caught.statusCode === 409 || caught.statusCode === 400 || caught.statusCode === 404 || caught.statusCode === 501;
  if (statusOk && reasonOk) ok(name);
  else fail(name, `${caught.statusCode} ${caught.reasonCode} ${caught.message}`);
  return caught;
}

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const assets = await db('assets').select(
    'id', 'parentid', 'is_set', 'product_id', 'quantity_total', 'quantity_available',
    'quantity_reserved', 'assignedto', 'sentagainstdc', 'linked_po_item_id', 'receipt_line_id'
  ).orderBy('id');
  const inventory = await db('inventory_items').select(
    'id', 'parentid', 'is_set', 'product_id', 'quantity_total', 'quantity_available',
    'quantity_reserved', 'receipt_line_id'
  ).orderBy('id');
  const pos = await db('project_orders').select('id', 'ponumber', 'vendorname', 'status', 'is_deleted').orderBy('id');
  const poLines = await db('project_order_items').select('id', 'orderid', 'itemdescription', 'qtyordered', 'status', 'assetid').orderBy('id');
  const temps = (await db.schema.hasTable('temporary_assets'))
    ? await q(`SELECT count(*)::int AS n FROM temporary_assets`)
    : { n: 0 };
  const products = await q(`SELECT count(*)::int AS n FROM product`);
  const catalog = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(zoho_product_id || '|' || product_name, ',' ORDER BY zoho_product_id)) AS checksum
    FROM zoho_catalog
  `);
  const reservations = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation`)
    : { n: 0 };
  const conversions = (await db.schema.hasTable('conversion'))
    ? await q(`SELECT count(*)::int AS n FROM conversion`)
    : { n: 0 };
  const sets = (await db.schema.hasTable('managed_sets'))
    ? await q(`SELECT count(*)::int AS n FROM managed_sets`)
    : { n: 0 };
  const receipts = (await db.schema.hasTable('receipt_note'))
    ? await q(`SELECT count(*)::int AS n FROM receipt_note`)
    : { n: 0 };
  const receiptLines = (await db.schema.hasTable('receipt_note_line'))
    ? await q(`SELECT count(*)::int AS n FROM receipt_note_line`)
    : { n: 0 };
  const outputs = (await db.schema.hasTable('receipt_physical_output'))
    ? await q(`SELECT count(*)::int AS n FROM receipt_physical_output`)
    : { n: 0 };
  const events = (await db.schema.hasTable('receipt_event'))
    ? await q(`SELECT count(*)::int AS n FROM receipt_event`)
    : { n: 0 };
  const outbox = (await db.schema.hasTable('receipt_projection_outbox'))
    ? await q(`SELECT count(*)::int AS n FROM receipt_projection_outbox`)
    : { n: 0 };
  return {
    assets: assets.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      is_set: Number(a.is_set || 0),
      product_id: a.product_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_reserved: a.quantity_reserved == null ? null : String(a.quantity_reserved),
      assignedto: a.assignedto || '',
      sentagainstdc: a.sentagainstdc || '',
      linked_po_item_id: a.linked_po_item_id || null,
      receipt_line_id: a.receipt_line_id || null
    })),
    inventory: inventory.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      is_set: Number(a.is_set || 0),
      product_id: a.product_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_reserved: a.quantity_reserved == null ? null : String(a.quantity_reserved),
      receipt_line_id: a.receipt_line_id || null
    })),
    pos,
    poLines,
    temps,
    products,
    catalog,
    reservations,
    conversions,
    sets,
    receipts,
    receiptLines,
    outputs,
    events,
    outbox
  };
}

async function schemaChecks() {
  assert(await db.schema.hasTable('receipt_note'), 'receipt_note exists');
  assert(await db.schema.hasTable('receipt_note_line'), 'receipt_note_line exists');
  assert(await db.schema.hasTable('receipt_physical_output'), 'receipt_physical_output exists');
  assert(await db.schema.hasTable('receipt_event'), 'receipt_event exists');
  assert(await db.schema.hasTable('receipt_projection_outbox'), 'receipt_projection_outbox exists');
  assert(await db.schema.hasTable('receipt_idempotency'), 'receipt_idempotency exists');
  assert(await db.schema.hasColumn('assets', 'receipt_line_id'), 'assets.receipt_line_id exists');
  assert(await db.schema.hasColumn('inventory_items', 'receipt_line_id'), 'inventory_items.receipt_line_id exists');
  assert(verifyReceiptNoteId(generateReceiptNoteId()), 'verifyReceiptNoteId');
  assert(verifyReceiptLineId(generateReceiptLineId()), 'verifyReceiptLineId');
  assert(!verifyReceiptNoteId('PO-1779691453564-194'), 'PO timestamp id is not an RN id');
  assert(!verifyReceiptNoteId('TEMP-1'), 'TEMP id is not an RN id');
}

async function productionRowChecks(snap) {
  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', 'APP parentid unchanged');
  assert(app && !app.receipt_line_id, 'APP has no invented receipt_line_id');
  const har = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
  assert(!!har, 'HAR present');
  const ieiz = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(ieiz && ieiz.is_set === 1, 'IEIZP5 is_set=1');
  const mis = snap.inventory.find((a) => a.id === MIS_ID);
  assert(mis && Number(mis.quantity_total) === 3, 'MIS total 3');
  assert(mis && Number(mis.quantity_available) === 1, 'MIS available 1');
  assert(Number(snap.temps.n) === 0, 'temporary_assets still 0');
  assert(snap.pos.length >= 2, 'local POs still present');
}

async function insertTestProduct(name = 'PHASE7-PRODUCT') {
  const id = generateProductId();
  if (!verifyProductId(id)) throw new Error('bad product id');
  await db('product').insert({
    id,
    name,
    unit: 'Nos',
    status: 'ACTIVE',
    origin: 'ASSETENGINE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 'phase7-verify'
  });
  return id;
}

async function insertTestPo(lineSpecs) {
  const project = await db('projects').first();
  if (!project) throw new Error('No project exists to hang a test PO on');
  const id = `PO-${Date.now()}-${Math.floor(Math.random() * 900) + 100}`;
  await db('project_orders').insert({
    id,
    projectid: project.id,
    ponumber: `P7-${Date.now()}`,
    vendorname: 'Phase7 Vendor',
    status: 'Active',
    is_deleted: 0,
    timestamp: new Date().toISOString()
  });
  const lines = [];
  for (let i = 0; i < lineSpecs.length; i += 1) {
    const spec = lineSpecs[i];
    const inserted = await db('project_order_items').insert({
      orderid: id,
      srno: i + 1,
      itemdescription: spec.description,
      qtyordered: spec.qty,
      uom: 'Nos',
      status: 'Pending',
      timestamp: new Date().toISOString()
    }).returning('id');
    const lineId = Array.isArray(inserted) ? (inserted[0].id ?? inserted[0]) : inserted.id;
    lines.push({ id: String(lineId), ...spec });
  }
  return { id, lines };
}

async function runReceiptTests() {
  const productsBefore = Number((await db('product').count({ n: 'id' }).first()).n);
  const tempsBefore = Number((await db('temporary_assets').count({ n: 'id' }).first()).n);
  const appBefore = await db('assets').where({ id: 'APP-MUM-0526-MMKBX9-W' }).first();
  const misBefore = await db('inventory_items').where({ id: MIS_ID }).first();

  const productId = await insertTestProduct('PHASE7-CAM');
  const po = await insertTestPo([
    { description: 'Test Camera', qty: 10 },
    { description: 'Test Lens', qty: 2 }
  ]);

  const open = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    receivedAtLocation: 'Mumbai',
    lines: [{
      poLineId: po.lines[0].id,
      productId,
      qtyReceived: 4,
      qtyAccepted: 4,
      qtyRejected: 0,
      qtyDamaged: 0,
      creationMode: 'INVENTORY'
    }],
    idempotencyKey: 'p7-create-1'
  });
  assert(open.receiptNote.status === 'OPEN', '1. create OPEN Receipt');
  assert(verifyReceiptNoteId(open.receiptNote.id), 'Receipt Note ID format');
  assert(open.lines.length === 1 && verifyReceiptLineId(open.lines[0].id), 'Receipt line ID format');

  const replayCreate = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [{ poLineId: po.lines[0].id, productId, qtyAccepted: 4, qtyReceived: 4, creationMode: 'INVENTORY' }],
    idempotencyKey: 'p7-create-1'
  });
  assert(replayCreate.receiptNote.id === open.receiptNote.id, '32. idempotent CREATE');

  const multi = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [
      { poLineId: po.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' },
      { poLineId: po.lines[1].id, productId, qtyAccepted: 2, qtyReceived: 2, creationMode: 'INVENTORY' }
    ]
  });
  assert(multi.lines.length === 2, '2. multi-line Receipt');
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: po.id,
      poSource: 'ZOHO',
      actor: 'phase7',
      lines: [{ poLineId: po.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
    }),
    ['PO_SOURCE_NOT_CONFIGURED', 'NOT_FOUND', 'ZOHO_PO_NOT_FOUND'],
    '3. one PO header / LOCAL only'
  );

  const noProduct = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [{ poLineId: po.lines[0].id, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  await expectReject(
    () => receiptService.postReceipt(noProduct.receiptNote.id, { actor: 'phase7', host: HOST }),
    'PRODUCT_REQUIRED',
    '4. Product required at POST'
  );

  const posted1 = await receiptService.postReceipt(open.receiptNote.id, { actor: 'phase7', host: HOST, idempotencyKey: 'p7-post-1' });
  assert(posted1.receiptNote.status === 'POSTED', '5a. first partial POSTED');
  assert(posted1.outputs.length === 1 && posted1.outputs[0].resourceType === 'INVENTORY', '17. Inventory creation');
  assert(Number(posted1.outputs[0].quantity) === 4, '24. inventory quantity 4');
  const inv = await db('inventory_items').where({ id: posted1.outputs[0].resourceId }).first();
  assert(inv && inv.product_id === productId, '18/25. Product propagated');
  assert(Number(inv.quantity_reserved) === 0, '28. no automatic reservation');
  assert(inv.receipt_line_id === open.lines[0].id, '20. receipt lineage on inventory');
  assert(!inv.linked_po_item_id, 'no linked_po_item_id on Receipt inventory');
  assert(inv.qrcode, '19. Inventory has one QR');
  const outbox = posted1.projection;
  assert(outbox && outbox.status === 'SKIPPED' && outbox.skip_reason === 'ADAPTER_NOT_CONFIGURED', '34. projection SKIPPED adapter NONE');

  const replayPost = await receiptService.postReceipt(open.receiptNote.id, { actor: 'phase7', host: HOST, idempotencyKey: 'p7-post-1' });
  assert(replayPost.receiptNote.id === open.receiptNote.id && replayPost.outputs.length === posted1.outputs.length, '33. idempotent POST');

  await expectReject(
    () => receiptService.updateReceiptNote(open.receiptNote.id, { vendorInvoiceNo: 'x' }),
    'RECEIPT_IMMUTABLE',
    '29. posted immutability'
  );

  const second = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [{
      poLineId: po.lines[0].id,
      productId,
      qtyReceived: 4,
      qtyAccepted: 3,
      qtyRejected: 0,
      qtyDamaged: 1,
      creationMode: 'INVENTORY'
    }]
  });
  const posted2 = await receiptService.postReceipt(second.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(posted2.receiptNote.status === 'POSTED', '5. multiple partial receipts');
  assert(Number(posted2.outputs[0].quantity) === 3, '11. damaged not created as stock');
  const balance = await receiptService.getPoBalance(po.id);
  const cam = balance.lines.find((l) => String(l.poLineId) === String(po.lines[0].id));
  assert(cam.acceptedToDate === 7 && cam.outstanding === 3, '10/13. outstanding = ordered - accepted (10-7=3)');

  const complete = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [{ poLineId: po.lines[0].id, productId, qtyAccepted: 3, qtyReceived: 3, creationMode: 'INVENTORY' }]
  });
  const postedComplete = await receiptService.postReceipt(complete.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(postedComplete.receiptNote.status === 'POSTED', '6. exact completion');
  const bal2 = await receiptService.getPoBalance(po.id);
  const cam2 = bal2.lines.find((l) => String(l.poLineId) === String(po.lines[0].id));
  assert(cam2.outstanding === 0, 'exact completion outstanding 0');

  await expectReject(
    () => receiptService.createReceiptNote({
      poId: po.id,
      actor: 'phase7',
      lines: [{ poLineId: po.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
    }).then((n) => receiptService.postReceipt(n.receiptNote.id, { actor: 'phase7', host: HOST })),
    ['OVER_RECEIPT', 'INSUFFICIENT_OUTSTANDING'],
    '8. over-receipt rejected'
  );

  const underPo = await insertTestPo([{ description: 'Under', qty: 5 }]);
  const under = await receiptService.createReceiptNote({
    poId: underPo.id,
    actor: 'phase7',
    lines: [{ poLineId: underPo.lines[0].id, productId, qtyAccepted: 2, qtyReceived: 2, creationMode: 'INVENTORY' }]
  });
  await receiptService.postReceipt(under.receiptNote.id, { actor: 'phase7', host: HOST });
  const underBal = await receiptService.getPoBalance(underPo.id);
  assert(underBal.lines[0].outstanding === 3, '7. under-receipt outstanding 3');

  const rejPo = await insertTestPo([{ description: 'Reject', qty: 4 }]);
  const rej = await receiptService.createReceiptNote({
    poId: rejPo.id,
    actor: 'phase7',
    lines: [{
      poLineId: rejPo.lines[0].id,
      productId,
      qtyReceived: 4,
      qtyAccepted: 0,
      qtyRejected: 4,
      qtyDamaged: 0
    }]
  });
  const rejPosted = await receiptService.postReceipt(rej.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(rejPosted.outputs.length === 0, '12. rejected creates no physical stock');
  const rejBal = await receiptService.getPoBalance(rejPo.id);
  assert(rejBal.lines[0].outstanding === 4, 'rejected does not fill PO');

  const stalePo = await insertTestPo([{ description: 'Stale', qty: 10 }]);
  const staleOpen = await receiptService.createReceiptNote({
    poId: stalePo.id,
    actor: 'phase7',
    lines: [{ poLineId: stalePo.lines[0].id, productId, qtyAccepted: 8, qtyReceived: 8, creationMode: 'INVENTORY' }]
  });
  await db('project_order_items').where({ id: stalePo.lines[0].id }).update({ qtyordered: 5 });
  await expectReject(
    () => receiptService.postReceipt(staleOpen.receiptNote.id, { actor: 'phase7', host: HOST }),
    ['STALE_PO', 'OVER_RECEIPT', 'INSUFFICIENT_OUTSTANDING'],
    '12/13. stale / reduced PO rejected'
  );

  const groupedPo = await insertTestPo([{ description: 'Grouped', qty: 6 }]);
  const grouped = await receiptService.createReceiptNote({
    poId: groupedPo.id,
    actor: 'phase7',
    lines: [{ poLineId: groupedPo.lines[0].id, productId, qtyAccepted: 6, qtyReceived: 6, creationMode: 'ASSET_GROUPED' }]
  });
  const groupedPosted = await receiptService.postReceipt(grouped.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(groupedPosted.outputs.length === 1 && groupedPosted.outputs[0].resourceType === 'ASSET', '15. grouped Asset');
  const gAsset = await db('assets').where({ id: groupedPosted.outputs[0].resourceId }).first();
  assert(Number(gAsset.quantity_total) === 6 && gAsset.qrcode, 'grouped Asset qty 6 one QR');
  assert(gAsset.receipt_line_id === grouped.lines[0].id, 'grouped receipt lineage');
  const hist = await db('asset_history').where({ assetid: gAsset.id });
  assert(hist.some((h) => h.action === 'RECEIPT_POST'), '23. Asset history RECEIPT_POST');

  const indPo = await insertTestPo([{ description: 'Individual', qty: 3 }]);
  const ind = await receiptService.createReceiptNote({
    poId: indPo.id,
    actor: 'phase7',
    lines: [{ poLineId: indPo.lines[0].id, productId, qtyAccepted: 3, qtyReceived: 3, creationMode: 'ASSET_INDIVIDUAL' }]
  });
  const indPosted = await receiptService.postReceipt(ind.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(indPosted.outputs.length === 3, '16. individual Assets ×3');
  const qrCount = indPosted.outputs.filter((o) => o.resourceType === 'ASSET').length;
  assert(qrCount === 3, '19. individual QR count 3');

  const rsv = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: inv.id,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: 'phase7-later',
    actor: 'phase7'
  });
  assert(rsv.reservation.status === 'ACTIVE', '29. later reservation possible');
  await reservationService.release({ id: rsv.reservation.id, actor: 'phase7' });

  const set = await setService.createSet({
    name: 'Phase7 Receipt Set',
    requirements: [{ product_id: productId, quantity: 1, unit: 'Nos' }],
    actor: 'phase7'
  });
  const reqId = set.requirements[0].id;
  const alloc = await setService.allocate(set.id, {
    requirementId: reqId,
    resourceType: 'INVENTORY',
    resourceId: inv.id,
    quantity: 1,
    actor: 'phase7'
  });
  assert(alloc && alloc.allocation && alloc.allocation.id, '27. later Set allocation possible');
  await setService.deallocate(set.id, alloc.allocation.id, { actor: 'phase7' });

  const cancelOpen = await receiptService.createReceiptNote({
    poId: po.id,
    actor: 'phase7',
    lines: [{ poLineId: po.lines[1].id, productId, qtyAccepted: 0, qtyReceived: 0 }]
  });
  const cancelled = await receiptService.cancelReceipt(cancelOpen.receiptNote.id, { actor: 'phase7' });
  assert(cancelled.receiptNote.status === 'CANCELLED', '28. cancel OPEN');
  await expectReject(
    () => receiptService.postReceipt(cancelled.receiptNote.id, { actor: 'phase7', host: HOST }),
    'INVALID_STATUS',
    'cancelled cannot post'
  );

  const revPo = await insertTestPo([{ description: 'Reverse me', qty: 2 }]);
  const revOpen = await receiptService.createReceiptNote({
    poId: revPo.id,
    actor: 'phase7',
    lines: [{ poLineId: revPo.lines[0].id, productId, qtyAccepted: 2, qtyReceived: 2, creationMode: 'INVENTORY' }]
  });
  const revPosted = await receiptService.postReceipt(revOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  const reversed = await receiptService.reverseReceipt(revPosted.receiptNote.id, { actor: 'phase7' });
  assert(reversed.receiptNote.status === 'REVERSED', '30. reversal');
  const revInv = await db('inventory_items').where({ id: revPosted.outputs[0].resourceId }).first();
  assert(revInv && Number(revInv.quantity_total) === 0 && String(revInv.lineage_status) === 'INACTIVE', 'reversal zeros qty, preserves id');

  const blockPo = await insertTestPo([{ description: 'Block reverse', qty: 2 }]);
  const blockOpen = await receiptService.createReceiptNote({
    poId: blockPo.id,
    actor: 'phase7',
    lines: [{ poLineId: blockPo.lines[0].id, productId, qtyAccepted: 2, qtyReceived: 2, creationMode: 'INVENTORY' }]
  });
  const blockPosted = await receiptService.postReceipt(blockOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: blockPosted.outputs[0].resourceId,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: 'phase7-block',
    actor: 'phase7'
  });
  await expectReject(
    () => receiptService.reverseReceipt(blockPosted.receiptNote.id, { actor: 'phase7' }),
    'NOT_REVERSIBLE',
    '31. reversal blocked after reservation'
  );

  const concPo = await insertTestPo([{ description: 'Concurrent', qty: 5 }]);
  const concA = await receiptService.createReceiptNote({
    poId: concPo.id,
    actor: 'A',
    lines: [{ poLineId: concPo.lines[0].id, productId, qtyAccepted: 4, qtyReceived: 4, creationMode: 'INVENTORY' }]
  });
  const concB = await receiptService.createReceiptNote({
    poId: concPo.id,
    actor: 'B',
    lines: [{ poLineId: concPo.lines[0].id, productId, qtyAccepted: 3, qtyReceived: 3, creationMode: 'INVENTORY' }]
  });
  const conc = await Promise.allSettled([
    receiptService.postReceipt(concA.receiptNote.id, { actor: 'A', host: HOST }),
    receiptService.postReceipt(concB.receiptNote.id, { actor: 'B', host: HOST })
  ]);
  const won = conc.filter((r) => r.status === 'fulfilled');
  const lost = conc.filter((r) => r.status === 'rejected');
  assert(won.length === 1 && lost.length === 1, '14. concurrent one success');
  assert(
    lost[0].reason && ['OVER_RECEIPT', 'INSUFFICIENT_OUTSTANDING'].includes(lost[0].reason.reasonCode),
    '14. concurrent 409',
    lost[0].reason && lost[0].reason.reasonCode
  );

  const qtyEvents = await db('inventory_quantity_events').where({ root_id: inv.id });
  assert(qtyEvents.some((e) => e.type === 'RECEIVE'), '22. quantity RECEIVE event');
  const events = posted1.events.map((e) => e.type);
  assert(events.includes('NOTE_OPENED') && events.includes('POSTED') && events.includes('PROJECTION_ENQUEUED'), '21. receipt events');

  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      const err = new Error('oauth failure');
      err.statusCode = 401;
      throw err;
    }
  });
  const fakePo = await insertTestPo([{ description: 'Fake adapter', qty: 1 }]);
  const fakeOpen = await receiptService.createReceiptNote({
    poId: fakePo.id,
    actor: 'phase7',
    lines: [{ poLineId: fakePo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  const fakePosted = await receiptService.postReceipt(fakeOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(fakePosted.receiptNote.status === 'POSTED', '35. physical post succeeds on adapter 401');
  assert(['FAILED', 'RETRY'].includes(String(fakePosted.projection?.status || fakePosted.receiptNote.projectionStatus)), '36. projection FAILED/RETRY on 401');

  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      const err = new Error('timeout');
      err.reasonCode = 'TIMEOUT';
      throw err;
    }
  });
  const tPo = await insertTestPo([{ description: 'Timeout', qty: 1 }]);
  const tOpen = await receiptService.createReceiptNote({
    poId: tPo.id,
    actor: 'phase7',
    lines: [{ poLineId: tPo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  const tPosted = await receiptService.postReceipt(tOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(['RETRY', 'FAILED'].includes(String(tPosted.projection?.status || tPosted.receiptNote.projectionStatus)), '35. timeout → RETRY/FAILED');

  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      const err = new Error('bad request');
      err.statusCode = 400;
      throw err;
    }
  });
  const xPo = await insertTestPo([{ description: '4xx', qty: 1 }]);
  const xOpen = await receiptService.createReceiptNote({
    poId: xPo.id,
    actor: 'phase7',
    lines: [{ poLineId: xPo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  const xPosted = await receiptService.postReceipt(xOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(String(xPosted.projection?.status || xPosted.receiptNote.projectionStatus) === 'FAILED', '37. 4xx FAILED no retry');

  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      const err = new Error('server');
      err.statusCode = 500;
      throw err;
    }
  });
  const sPo = await insertTestPo([{ description: '5xx', qty: 1 }]);
  const sOpen = await receiptService.createReceiptNote({
    poId: sPo.id,
    actor: 'phase7',
    lines: [{ poLineId: sPo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  const sPosted = await receiptService.postReceipt(sOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(String(sPosted.projection?.status || sPosted.receiptNote.projectionStatus) === 'RETRY', '38. 5xx RETRY');

  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      const err = new Error('slow down');
      err.statusCode = 429;
      throw err;
    }
  });
  const rPo = await insertTestPo([{ description: '429', qty: 1 }]);
  const rOpen = await receiptService.createReceiptNote({
    poId: rPo.id,
    actor: 'phase7',
    lines: [{ poLineId: rPo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  const rPosted = await receiptService.postReceipt(rOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  assert(String(rPosted.projection?.status || rPosted.receiptNote.projectionStatus) === 'RETRY', '39. 429 RETRY');

  let attempts = 0;
  receiptProjectionService.setAdapterForTests({
    async createReceipt() {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('temp 500');
        err.statusCode = 500;
        throw err;
      }
      return { remoteId: 'ZOHO-RECEIVE-TEST-1' };
    }
  });
  const retryPo = await insertTestPo([{ description: 'Retry then send', qty: 1 }]);
  const retryOpen = await receiptService.createReceiptNote({
    poId: retryPo.id,
    actor: 'phase7',
    lines: [{ poLineId: retryPo.lines[0].id, productId, qtyAccepted: 1, qtyReceived: 1, creationMode: 'INVENTORY' }]
  });
  await receiptService.postReceipt(retryOpen.receiptNote.id, { actor: 'phase7', host: HOST });
  const retried = await receiptProjectionService.attempt(retryOpen.receiptNote.id, { actor: 'phase7' });
  assert(retried.sent && retried.outbox.zoho_receipt_id === 'ZOHO-RECEIVE-TEST-1', '40. projection retry then SENT');
  const replayProj = await receiptProjectionService.attempt(retryOpen.receiptNote.id, { actor: 'phase7' });
  assert(replayProj.replayed && replayProj.outbox.zoho_receipt_id === 'ZOHO-RECEIVE-TEST-1', '41. projection idempotent replay');
  receiptProjectionService.setAdapterForTests(null);

  const productsAfter = Number((await db('product').count({ n: 'id' }).first()).n);
  assert(productsAfter >= productsBefore, '20. no automatic Product destruction; count did not drop');
  const tempsAfter = Number((await db('temporary_assets').count({ n: 'id' }).first()).n);
  assert(tempsAfter === tempsBefore, '45. temporary_assets untouched');
  const appAfter = await db('assets').where({ id: 'APP-MUM-0526-MMKBX9-W' }).first();
  assert(appAfter.parentid === appBefore.parentid, '47. APP unchanged');
  const misAfter = await db('inventory_items').where({ id: MIS_ID }).first();
  assert(Number(misAfter.quantity_available) === Number(misBefore.quantity_available), '48. MIS unchanged');
}

async function httpChecks(httpBase) {
  const unauth = await request(`${httpBase}/api/receipt-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poId: 'x' })
  });
  assert(unauth.status === 401, '42/49. unauthenticated mutation 401', unauth.status);

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign(
    { user_id: 'phase7-verify-user', role: 'user', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const forbidden = await request(`${httpBase}/api/receipt-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ poId: 'x' })
  });
  assert(forbidden.status === 403, '43/50/51. Sales/user blocked 403', forbidden.status);

  const salesToken = jwt.sign(
    { user_id: 'phase7-sales', role: 'sales', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const sales = await request(`${httpBase}/api/receipt-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({ poId: 'x' })
  });
  assert(sales.status === 403, '44. Sales blocked 403', sales.status);
}

function runChildVerify(script, dbName, extra) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), '--database-name', dbName, ...(extra || [])], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed: ${(result.stderr || result.stdout || '').slice(-2000)}`);
  }
  return result.stdout;
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runReceiptTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-receipt-tests against production database asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  const installed = await db.schema.hasTable('receipt_note');
  if (installed) {
    await schemaChecks();
    await productionRowChecks(snap);
  } else if (args.writeBaseline && !args.runReceiptTests) {
    console.log('Receipt tables not installed yet; wrote pre-schema baseline only');
    ok('pre-schema baseline written');
  } else {
    throw new Error('Receipt Note tables are not installed');
  }

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, 'APP parentid vs baseline');
    assert(appBefore && appAfter && !appAfter.receipt_line_id, 'APP receipt_line_id still null');
    const ieizBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    const ieizAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    assert(ieizBefore && ieizAfter && ieizBefore.is_set === ieizAfter.is_set, 'IEIZP5 is_set vs baseline');
    const misBefore = baseline.inventory.find((a) => a.id === MIS_ID);
    const misAfter = snap.inventory.find((a) => a.id === MIS_ID);
    assert(misBefore && misAfter && misBefore.quantity_available === misAfter.quantity_available, 'MIS available vs baseline');
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, 'zoho_catalog unchanged');
    assert(Number(baseline.temps.n) === Number(snap.temps.n), 'temporary_assets count vs baseline');
    if (!args.runReceiptTests) {
      assert(Number(baseline.receipts.n) === Number(snap.receipts.n), 'no Receipt Notes invented vs baseline');
      assert(Number(baseline.outputs.n) === Number(snap.outputs.n), 'no physical outputs invented vs baseline');
    }
  }

  if (args.runReceiptTests) {
    await runReceiptTests();
  }
  if (args.httpBase) {
    await httpChecks(args.httpBase);
  }
  if (args.runPhaseRegression) {
    try {
      runChildVerify('product-phase1-verify.js', dbName, []);
      ok('51. Phase 1 regression process exited 0');
    } catch (err) { fail('51. Phase 1 regression', err.message); }
    try {
      runChildVerify('quantity-phase2-verify.js', dbName, []);
      ok('52. Phase 2 regression process exited 0');
    } catch (err) { fail('52. Phase 2 regression', err.message); }
    try {
      runChildVerify('reservation-phase3-verify.js', dbName, []);
      ok('53. Phase 3 regression process exited 0');
    } catch (err) { fail('53. Phase 3 regression', err.message); }
    try {
      runChildVerify('conversion-phase4-verify.js', dbName, []);
      ok('54. Phase 4 regression process exited 0');
    } catch (err) { fail('54. Phase 4 regression', err.message); }
    try {
      runChildVerify('phase5-break-cutover-verify.js', dbName, []);
      ok('55. Phase 5 regression process exited 0');
    } catch (err) { fail('55. Phase 5 regression', err.message); }
    try {
      runChildVerify('set-phase6-verify.js', dbName, []);
      ok('56. Phase 6 regression process exited 0');
    } catch (err) { fail('56. Phase 6 regression', err.message); }
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error('-', f.name, f.detail));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  try { await db.destroy(); } catch (e) { /* ignore */ }
});
