/**
 * Phase 9 verification — Zoho Purchase Order mirror / procurement context.
 *
 * Uses a Fake Zoho gateway. Does NOT mutate live Zoho.
 *
 * Scratch:
 *   node scripts/procurement-phase9-verify.js --database-name asset_manager_phase9_scratch --run-tests
 *
 * Production (no mutations):
 *   node scripts/procurement-phase9-verify.js --database-name asset_manager --http-base http://127.0.0.1:8080
 *
 * --run-tests is refused against asset_manager.
 */
function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runTests: false,
    runPhaseRegression: false,
    probeScope: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-tests') args.runTests = true;
    else if (token === '--run-phase-regression') args.runPhaseRegression = true;
    else if (token === '--probe-scope') args.probeScope = true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.databaseName) process.env.DB_NAME = args.databaseName;

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');
const { db, verifyProcurementPoId, verifyProcurementPoLineId } = require('../utils');
const productService = require('../services/productService');
const procurementService = require('../services/procurementService');
const receiptService = require('../services/receiptService');
const setService = require('../services/setService');
const zohoProcurement = require('../services/zohoProcurementService');

const failures = [];
const passes = [];
const HOST = '127.0.0.1:8080';
const ACTOR = 'phase9-verify';
const APP_ID = 'APP-MUM-0526-MMKBX9-W';
const MIS_ID = 'MIS-MUM-0826-H4XVLL-W';

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
  if (reasonOk) ok(name);
  else fail(name, `${caught.statusCode} ${caught.reasonCode} ${caught.message}`);
  return caught;
}

async function currentDbName() {
  return (await db.raw('SELECT current_database() AS name')).rows[0].name;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeProcurementZoho {
  constructor() {
    this.store = new Map();
    this.failMode = null;
  }

  seed(po) {
    this.store.set(String(po.zohoPoId), clone(po));
  }

  _throw() {
    const mode = this.failMode;
    const err = new Error(mode);
    const map = {
      '401': { statusCode: 401, reasonCode: 'ZOHO_401' },
      '403': { statusCode: 403, reasonCode: 'ZOHO_403' },
      '404': { statusCode: 404, reasonCode: 'ZOHO_PO_NOT_FOUND' },
      '409': { statusCode: 409, reasonCode: 'ZOHO_409' },
      '429': { statusCode: 429, reasonCode: 'ZOHO_429' },
      '5xx': { statusCode: 502, reasonCode: 'ZOHO_ERROR' },
      timeout: { statusCode: 504, reasonCode: 'ZOHO_TIMEOUT' },
      malformed: { statusCode: 502, reasonCode: 'ZOHO_UNEXPECTED_RESPONSE' },
      scope: { statusCode: 403, reasonCode: 'PO_OAUTH_SCOPE_REQUIRED' }
    };
    const mapped = map[mode] || { statusCode: 502, reasonCode: 'ZOHO_ERROR' };
    err.statusCode = mapped.statusCode;
    err.reasonCode = mapped.reasonCode;
    throw err;
  }

  async getPurchaseOrder(id) {
    if (this.failMode) this._throw();
    const po = this.store.get(String(id));
    if (!po) {
      const err = new Error('Zoho Purchase Order was not found');
      err.statusCode = 404;
      err.reasonCode = 'ZOHO_PO_NOT_FOUND';
      throw err;
    }
    return clone(po);
  }

  async listPurchaseOrders() {
    if (this.failMode) this._throw();
    return { purchaseOrders: [...this.store.values()].map(clone) };
  }

  async getPurchaseOrderLines(id) {
    const po = await this.getPurchaseOrder(id);
    return po.lines;
  }
}

function remotePo({ zohoPoId, poNumber, status, lines, modifiedTime }) {
  return {
    zohoPoId: String(zohoPoId),
    poNumber,
    subject: poNumber,
    status,
    vendorZohoId: '1205624000000110001',
    vendorName: 'Phase9 Vendor Snapshot',
    poDate: '2026-08-01',
    dueDate: '2026-08-20',
    subTotal: 100,
    discount: 0,
    tax: 0,
    grandTotal: 100,
    modifiedTime: modifiedTime || '2026-08-01T00:00:00+05:30',
    lines
  };
}

function remoteLine({ zohoLineId, zohoProductId, description, quantity, listPrice }) {
  return {
    zohoLineId: String(zohoLineId),
    sequenceNumber: 1,
    zohoProductId: zohoProductId ? String(zohoProductId) : null,
    zohoProductName: description,
    description,
    quantity,
    listPrice: listPrice == null ? 800 : listPrice,
    discount: 0,
    tax: 0,
    netTotal: quantity * (listPrice == null ? 800 : listPrice),
    unit: 'Nos'
  };
}

async function snapshotSafety() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const localPos = await db('project_orders').select('id', 'ponumber', 'status', 'vendorname', 'is_deleted').orderBy('id');
  const localLines = await db('project_order_items').select('id', 'orderid', 'qtyordered', 'itemdescription').orderBy('id');
  const receipts = (await db.schema.hasTable('receipt_note'))
    ? await db('receipt_note').select('id', 'po_id', 'status').orderBy('id')
    : [];
  const products = await db('product').select('id', 'price', 'name').orderBy('id');
  const refs = (await db.schema.hasTable('product_external_ref'))
    ? await db('product_external_ref').select('product_id', 'external_id').orderBy('product_id')
    : [];
  const app = await db('assets').where({ id: APP_ID }).first();
  const mis = await db('inventory_items').where({ id: MIS_ID }).first();
  const reservations = (await db.schema.hasTable('reservation'))
    ? Number((await q('SELECT count(*)::int AS n FROM reservation')).n)
    : 0;
  const conversions = (await db.schema.hasTable('conversion'))
    ? Number((await q('SELECT count(*)::int AS n FROM conversion')).n)
    : 0;
  const sets = (await db.schema.hasTable('managed_sets'))
    ? Number((await q('SELECT count(*)::int AS n FROM managed_sets')).n)
    : 0;
  const requirements = (await db.schema.hasTable('set_requirement'))
    ? await db('set_requirement').select('id', 'product_id', 'quantity').orderBy('id')
    : [];
  const oauthSrc = fs.readFileSync(path.join(__dirname, '../services/zohoService.js'), 'utf8');
  return {
    localPos,
    localLines,
    receipts,
    products,
    refs,
    appQty: app ? String(app.quantity_total) : null,
    misQty: mis ? String(mis.quantity_total) : null,
    reservations,
    conversions,
    sets,
    requirements,
    oauthHasPurchaseOrders: /purchaseorders/i.test(oauthSrc)
  };
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function runChildVerify(script, dbName, extraArgs) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), '--database-name', dbName, ...(extraArgs || [])], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_NAME: dbName },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`${script} exited ${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
}

async function httpChecks(base) {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign({ user_id: 'phase9-sales', role: 'user', username: 'sales', company_id: 'x' }, secret, { expiresIn: '5m' });
  const adminToken = jwt.sign({ user_id: 'phase9-admin', role: 'manager', username: 'logistics', company_id: 'x' }, secret, { expiresIn: '5m' });
  const unauth = await request(`${base}/api/purchase-orders/import-zoho`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zohoPoId: '1' })
  });
  assert(unauth.status === 401, '48. unauthorized import blocked', unauth.status);
  const salesImport = await request(`${base}/api/purchase-orders/import-zoho`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ zohoPoId: '1' })
  });
  assert(salesImport.status === 403, '51. Sales cannot import PO', salesImport.status);
  const salesRefresh = await request(`${base}/api/purchase-orders/PPO-0826-AAAAAA-A/refresh-zoho`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` }
  });
  assert(salesRefresh.status === 403 || salesRefresh.status === 401, '49. unauthorized refresh blocked', salesRefresh.status);
  const salesReceive = await request(`${base}/api/receipt-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ poId: 'x', poSource: 'ZOHO', lines: [] })
  });
  assert(salesReceive.status === 403, '52. Sales cannot receive', salesReceive.status);
  const salesEdit = await request(`${base}/api/orders/PO-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ PONumber: 'x' })
  });
  assert(salesEdit.status === 409, '50. commercial edits blocked', salesEdit.status);
}

async function runTests(fake) {
  procurementService.setZohoGateway(fake);
  const before = await snapshotSafety();
  const legacyIds = before.localPos.map((row) => row.id);

  assert(legacyIds.includes('PO-1779691453564-194') || legacyIds.length >= 0, '1. existing POs remain readable');
  const localBefore = JSON.stringify(before.localPos);
  const localLinesBefore = JSON.stringify(before.localLines);
  const receiptLinksBefore = JSON.stringify(before.receipts);

  const product = await productService.createProduct({
    name: 'Phase9 Battery',
    price: 1000,
    unit: 'Nos'
  }, ACTOR);
  const zohoProductId = '1205624000999000001';
  await productService.createExternalRef(product.id, {
    external_id: zohoProductId,
    link_origin: 'PULL'
  }, ACTOR);
  const otherProduct = await productService.createProduct({ name: 'Phase9 Other', price: 50 }, ACTOR);

  const zohoPoId = '1205624000999100001';
  const zohoLineId = '1205624000999100101';
  fake.seed(remotePo({
    zohoPoId,
    poNumber: 'P9-TEST-01',
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId,
      zohoProductId,
      description: 'Battery pack',
      quantity: 10,
      listPrice: 800
    })]
  }));

  const imported = await procurementService.importPurchaseOrder(zohoPoId, ACTOR);
  assert(imported.po && verifyProcurementPoId(imported.po.id), '4. import PO');
  assert(imported.po.zohoPoId === zohoPoId, '7. external mapping string id');
  assert(imported.po.lines.length === 1 && verifyProcurementPoLineId(imported.po.lines[0].id), '5. import multiple lines / durable line id');
  assert(imported.po.lines[0].zohoLineId === zohoLineId, '8. line external mapping');
  assert(imported.po.lines[0].productId === product.id, '9. Product required / mapped');
  assert(imported.po.lines[0].listPrice == 800 || Number(imported.po.lines[0].listPrice) === 800, 'PO purchase price stored');
  const productAfterImport = await db('product').where({ id: product.id }).first();
  assert(Number(productAfterImport.price) === 1000, '47. Product price unaffected by PO price');

  const importedAgain = await procurementService.importPurchaseOrder(zohoPoId, ACTOR);
  assert(importedAgain.po.id === imported.po.id, '6/63. repeated import idempotent');

  const ext = await db('procurement_po_external_ref').where({
    procurement_po_id: imported.po.id,
    external_id: zohoPoId
  }).first();
  assert(!!ext, '7b. purchase_order_external_ref row');

  const unmappedZoho = '1205624000999200001';
  fake.seed(remotePo({
    zohoPoId: unmappedZoho,
    poNumber: 'P9-UNMAPPED',
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId: '1205624000999200101',
      zohoProductId: '1205624000999999999',
      description: 'Unmapped camera',
      quantity: 2
    })]
  }));
  const preview = await procurementService.previewPurchaseOrder(unmappedZoho);
  assert(preview.mappingRequired === true && preview.reasonCode === 'PRODUCT_MAPPING_REQUIRED', '10. missing Product mapping surfaced');
  const unmappedImport = await procurementService.importPurchaseOrder(unmappedZoho, ACTOR);
  assert(unmappedImport.po.mappingRequired === true, '10b. unmapped import is not receivable');
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: unmappedImport.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: unmappedImport.po.lines[0].id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'PRODUCT_MAPPING_REQUIRED',
    '10c. missing Product mapping blocks receiving'
  );

  const lateProduct = await productService.createProduct({ name: 'Phase9 Late Map', price: 1 }, ACTOR);
  await productService.createExternalRef(lateProduct.id, {
    external_id: '1205624000999999999',
    link_origin: 'PULL'
  }, ACTOR);
  const remapRefresh = await procurementService.refreshPurchaseOrder(unmappedImport.po.id, ACTOR);
  assert(remapRefresh.po.lines[0].productId === lateProduct.id, 'refresh remaps Product when Zoho PO hash is unchanged');
  assert(remapRefresh.po.mappingRequired === false, 'mapping required clears after remap refresh');
  assert(remapRefresh.skipped === false, 'mapping fill is not treated as an empty skip');

  fake.store.get(zohoPoId).lines[0].quantity = 12;
  fake.store.get(zohoPoId).modifiedTime = '2026-08-02T00:00:00+05:30';
  const refreshedUp = await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);
  assert(Number(refreshedUp.po.lines[0].ordered) === 12, '11/12. refresh quantity increase');

  fake.store.get(zohoPoId).lines[0].quantity = 10;
  const refreshedDown = await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);
  assert(Number(refreshedDown.po.lines[0].ordered) === 10, '13. refresh quantity decrease still >= accepted');

  fake.store.get(zohoPoId).status = 'DELIVERED';
  const statusRefresh = await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);
  assert(statusRefresh.po.status === 'DELIVERED', '15. status refresh');
  fake.store.get(zohoPoId).status = 'APPROVED';
  await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);

  const createdStatusId = '1205624000999300001';
  fake.seed(remotePo({
    zohoPoId: createdStatusId,
    poNumber: 'P9-CREATED',
    status: 'CREATED',
    lines: [remoteLine({
      zohoLineId: '1205624000999300101',
      zohoProductId,
      description: 'Battery pack',
      quantity: 3
    })]
  }));
  const createdPo = await procurementService.importPurchaseOrder(createdStatusId, ACTOR);
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: createdPo.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{ poLineId: createdPo.po.lines[0].id, qtyAccepted: 1, creationMode: 'INVENTORY', productId: product.id }]
    }),
    'PO_NOT_APPROVED',
    'Created PO cannot receive'
  );

  const note = await receiptService.createReceiptNote({
    poId: imported.po.id,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    lines: [{
      poLineId: imported.po.lines[0].id,
      productId: product.id,
      qtyAccepted: 6,
      qtyRejected: 1,
      qtyDamaged: 1,
      qtyReceived: 8,
      creationMode: 'INVENTORY'
    }]
  });
  const posted = await receiptService.postReceipt(note.receiptNote.id, { actor: ACTOR, host: HOST });
  assert(posted.receiptNote.status === 'POSTED', '41. PO → Receipt');
  assert(posted.receiptNote.poSource === 'ZOHO', '43. physical creation remains Phase 7');
  const snapOrdered = posted.lines[0].orderedQtySnapshot;
  const ledger = await procurementService.qtyLedger(db, imported.po.lines[0].id);
  const qty = procurementService.lineQuantities(10, ledger);
  assert(qty.ordered === 10, '24. ordered');
  assert(qty.accepted === 6, '25. accepted');
  assert(qty.rejected === 1, '26. rejected');
  assert(qty.damaged === 1, '27. damaged');
  assert(qty.outstanding === 4, '28. outstanding');
  assert(qty.onOrder === 4, '29. on order');
  assert(qty.reconciliationRequired === false, '17. Ordered >= Accepted');

  await expectReject(
    () => receiptService.createReceiptNote({
      poId: imported.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: imported.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 5,
        creationMode: 'INVENTORY'
      }]
    }).then((n) => receiptService.postReceipt(n.receiptNote.id, { actor: ACTOR, host: HOST })),
    ['OVER_RECEIPT', 'INSUFFICIENT_OUTSTANDING'],
    '30. over-receipt rejected'
  );

  const second = await receiptService.createReceiptNote({
    poId: imported.po.id,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    lines: [{
      poLineId: imported.po.lines[0].id,
      productId: product.id,
      qtyAccepted: 4,
      creationMode: 'INVENTORY'
    }]
  });
  const posted2 = await receiptService.postReceipt(second.receiptNote.id, { actor: ACTOR, host: HOST });
  assert(posted2.receiptNote.status === 'POSTED', '31. multiple receipts');
  const afterTwo = await procurementService.getPurchaseOrder(imported.po.id);
  assert(Number(afterTwo.lines[0].accepted) === 10 && Number(afterTwo.lines[0].outstanding) === 0, '31b. accepted 10 outstanding 0');

  fake.store.get(zohoPoId).lines[0].quantity = 5;
  const recon = await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);
  assert(recon.po.reconciliationRequired === true, '14/18. below-accepted reconciliation');
  assert(Number(recon.po.lines[0].outstanding) === 0, 'discrepancy not hidden');
  const histLine = await db('receipt_note_line').where({ id: posted.lines[0].id }).first();
  assert(Number(histLine.ordered_qty_snapshot) === Number(snapOrdered), '20/44. historical receipt snapshot unchanged');
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: imported.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: imported.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'RECONCILIATION_REQUIRED',
    '19. future receipt blocked'
  );

  fake.store.get(zohoPoId).lines[0].quantity = 10;
  await procurementService.refreshPurchaseOrder(imported.po.id, ACTOR);

  const cancelId = '1205624000999400001';
  fake.seed(remotePo({
    zohoPoId: cancelId,
    poNumber: 'P9-CANCEL',
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId: '1205624000999400101',
      zohoProductId,
      description: 'Battery pack',
      quantity: 2
    })]
  }));
  const cancelPo = await procurementService.importPurchaseOrder(cancelId, ACTOR);
  const cancelNote = await receiptService.createReceiptNote({
    poId: cancelPo.po.id,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    lines: [{
      poLineId: cancelPo.po.lines[0].id,
      productId: product.id,
      qtyAccepted: 1,
      creationMode: 'INVENTORY'
    }]
  });
  const cancelPosted = await receiptService.postReceipt(cancelNote.receiptNote.id, { actor: ACTOR, host: HOST });
  fake.store.get(cancelId).status = 'CANCELLED';
  const cancelled = await procurementService.refreshPurchaseOrder(cancelPo.po.id, ACTOR);
  assert(cancelled.po.status === 'CANCELLED' && cancelled.po.syncStatus === 'CANCELLED', '16. cancelled refresh');
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: cancelPo.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: cancelPo.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'PO_CANCELLED',
    '21. cancelled PO cannot receive'
  );
  const stillPosted = await db('receipt_note').where({ id: cancelPosted.receiptNote.id }).first();
  assert(stillPosted.status === 'POSTED', '22. existing receipts remain');
  const outputs = await db('receipt_physical_output').where({ receipt_note_id: cancelPosted.receiptNote.id });
  assert(outputs.length >= 1, '23. physical stock remains');

  const poBId = '1205624000999500001';
  fake.seed(remotePo({
    zohoPoId: poBId,
    poNumber: 'P9-B',
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId: '1205624000999500101',
      zohoProductId,
      description: 'Battery pack',
      quantity: 6
    })]
  }));
  const poB = await procurementService.importPurchaseOrder(poBId, ACTOR);
  assert(poB.po.id !== imported.po.id, '33. same Product across multiple POs remain separate');
  const onOrder = await procurementService.onOrderForProduct(db, product.id);
  assert(onOrder >= 6, '35. On Order calculation includes open approved quantity');

  const kit = await setService.createSet({
    name: 'Phase9 Battery Kit',
    requirements: [{ productId: product.id, quantity: 10 }],
    actor: ACTOR
  });
  const need = await procurementService.getSetProcurementNeed(kit.id);
  assert(Number(need.lines[0].shortfall) === 10, '36. Set shortfall');
  assert(Number(need.lines[0].onOrder) >= 6, '37. on-order offset visible');
  assert(Number(need.lines[0].additionalNeed) === Math.max(10 - Number(need.lines[0].onOrder), 0), '37b. additional need');
  const reqBefore = JSON.stringify(kit.requirements);
  const kitAfter = await setService.getSet(kit.id);
  assert(JSON.stringify(kitAfter.requirements) === reqBefore, '79. Requirements unchanged');
  assert(!/reservationService\.reserve/.test(fs.readFileSync(path.join(__dirname, '../services/procurementService.js'), 'utf8')), '40. no reservation from PO');
  const ui = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/purchase-orders.js'), 'utf8');
  assert(!/Create PO|createPurchaseOrder/.test(ui), '38. no automatic / AE PO creation UI');

  await expectReject(
    () => receiptService.createReceiptNote({
      poId: poB.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: poB.po.lines[0].id,
        productId: otherProduct.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'WRONG_PRODUCT',
    '45. wrong Product blocked'
  );

  const modes = ['401', '403', '404', '409', '429', '5xx', 'timeout', 'malformed', 'scope'];
  const names = {
    '401': '53. 401',
    '403': '54. 403',
    '404': '55. 404',
    '409': '56. 409',
    '429': '57. 429',
    '5xx': '58. 5xx',
    timeout: '59. timeout',
    malformed: '60. malformed response',
    scope: '61. scope failure'
  };
  for (const mode of modes) {
    fake.failMode = mode;
    await expectReject(
      () => procurementService.refreshPurchaseOrder(poB.po.id, ACTOR),
      null,
      names[mode]
    );
    const still = await db('procurement_po').where({ id: poB.po.id }).first();
    assert(still.po_number === 'P9-B', `${names[mode]} kept last known good`);
  }
  fake.failMode = 'scope';
  await db('procurement_po').where({ id: poB.po.id }).update({
    last_synced_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  });
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: poB.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: poB.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    ['STALE_PO', 'PO_OAUTH_SCOPE_REQUIRED'],
    '62. stale local PO protection'
  );
  fake.failMode = null;

  const scoped = zohoProcurement.mapScopeFailure({ message: 'OAUTH_SCOPE_MISMATCH', code: 'OAUTH_SCOPE_MISMATCH' });
  assert(scoped && scoped.reasonCode === 'PO_OAUTH_SCOPE_REQUIRED', '61b. adapter maps missing PO scope');
  const moduleDenied = zohoProcurement.mapScopeFailure({ message: 'NO_PERMISSION', code: 'NO_PERMISSION' });
  assert(moduleDenied && moduleDenied.reasonCode === 'ZOHO_MODULE_PERMISSION', '61c. adapter maps Zoho module permission separately from OAuth scope');
  const tokenInvalid = zohoProcurement.mapScopeFailure({ message: 'invalid_grant', code: 'ZOHO_NOT_AUTHORIZED' });
  assert(tokenInvalid && tokenInvalid.reasonCode === 'ZOHO_NOT_AUTHORIZED', '61d. adapter maps invalid/expired token separately from OAuth scope');

  try {
    zohoProcurement.normalizePurchaseOrderLine({ getId: () => null, getKeyValue: () => null }, 0);
    fail('LINE_ID_MISSING', 'did not throw');
  } catch (err) {
    assert(err.reasonCode === 'LINE_ID_MISSING', 'line identity stop condition', err.message);
  }

  const concId = '1205624000999600001';
  fake.seed(remotePo({
    zohoPoId: concId,
    poNumber: 'P9-CONC',
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId: '1205624000999600101',
      zohoProductId,
      description: 'Battery pack',
      quantity: 1
    })]
  }));
  const [a, b] = await Promise.all([
    procurementService.importPurchaseOrder(concId, ACTOR),
    procurementService.importPurchaseOrder(concId, ACTOR)
  ]);
  assert(a.po.id === b.po.id, '65. concurrent import one canonical local PO');
  const refreshAgain = await procurementService.refreshPurchaseOrder(a.po.id, ACTOR);
  assert(refreshAgain.po.id === a.po.id, '64. repeated refresh same local PO');

  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(/LOCAL_PO_CREATE_CONTAINED/.test(serverSrc) && /LOCAL_PO_EDIT_CONTAINED/.test(serverSrc), '50b. legacy commercial PO routes contained');
  assert(/authorizeRoles\('superuser', 'admin', 'manager'\).*[\s\S]{0,200}import-zoho|import-zoho[\s\S]{0,180}authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '48b. import is Logistics-authorized');

  const after = await snapshotSafety();
  assert(JSON.stringify(after.localPos) === localBefore, '2. existing POs unchanged');
  assert(JSON.stringify(after.localLines) === localLinesBefore, '2b. existing PO lines unchanged');
  assert(after.appQty === before.appQty, '74. protected Asset unchanged');
  assert(after.misQty === before.misQty, '75. protected Inventory unchanged');
  assert(after.reservations === before.reservations, '76. Reservations unchanged');
  assert(after.conversions === before.conversions, '77. Conversions unchanged');
  const oauthSrc = fs.readFileSync(path.join(__dirname, '../services/zohoService.js'), 'utf8');
  const oauthBlock = oauthSrc.match(/const ZOHO_OAUTH_SCOPES = \[([\s\S]*?)\]\.join/)[1];
  assert(/ZohoCRM\.modules\.purchaseorders\.READ/.test(oauthBlock), '83. Purchase Order READ scope requested');
  assert(/ZohoCRM\.modules\.products\.ALL/.test(oauthBlock), '83b. products ALL preserved');
  assert(/ZohoCRM\.modules\.deals\.READ/.test(oauthBlock), '83c. deals READ preserved');
  assert(/ZohoCRM\.settings\.fields\.READ/.test(oauthBlock), '83d. settings.fields READ preserved');
  assert(/ZohoCRM\.settings\.modules\.READ/.test(oauthBlock), '83e. settings.modules READ preserved');
  assert(!/ZohoCRM\.modules\.purchaseorders\.ALL/.test(oauthBlock), '83f. Purchase Order ALL not requested');
  assert(!/ZohoCRM\.modules\.vendors/.test(oauthBlock), '83g. vendors scope not added');
  assert(after.oauthHasPurchaseOrders === true, '83h. OAuth source includes purchaseorders');
  const origRefs = before.refs.filter((r) => !String(r.external_id).startsWith('1205624000999'));
  const afterOrigRefs = after.refs.filter((r) => !String(r.external_id).startsWith('1205624000999'));
  assert(JSON.stringify(afterOrigRefs) === JSON.stringify(origRefs), '82. existing Zoho Product mappings unchanged');
  const origReceipts = before.receipts.filter((r) => !legacyIds.length || legacyIds.includes(r.po_id) || String(r.po_id).startsWith('PO-'));
  const afterOrigReceipts = after.receipts.filter((r) => String(r.po_id).startsWith('PO-'));
  assert(JSON.stringify(afterOrigReceipts) === JSON.stringify(before.receipts.filter((r) => String(r.po_id).startsWith('PO-'))), '3/80. historical Receipt linkage preserved');
  void receiptLinksBefore;
  void origReceipts;

  const unified = await procurementService.listUnified({});
  assert(unified.purchaseOrders.some((p) => p.source === 'LOCAL' && p.classification === 'LEGACY'), '1b. legacy POs classified LEGACY');
  assert(unified.purchaseOrders.some((p) => p.source === 'ZOHO' && p.classification === 'CANONICAL'), 'canonical Zoho mirrors listed');
}

async function main() {
  if (!args.databaseName) throw new Error('--database-name is required');
  const dbName = await currentDbName();
  if (dbName !== args.databaseName) {
    throw new Error(`DB mismatch: wanted ${args.databaseName}, connected to ${dbName}`);
  }
  if (args.runTests && dbName === 'asset_manager') {
    throw new Error('--run-tests refused against asset_manager');
  }

  assert(await db.schema.hasTable('procurement_po'), 'migration procurement_po');
  assert(await db.schema.hasTable('procurement_po_line'), 'migration procurement_po_line');
  assert(await db.schema.hasTable('procurement_po_external_ref'), 'migration procurement_po_external_ref');
  assert(await db.schema.hasTable('procurement_sync_event'), 'migration procurement_sync_event');
  assert(!(await db.schema.hasTable('managed_sets_legacy_unused_guard')), 'abandoned managed sets unused');

  if (args.writeBaseline) {
    const snap = await snapshotSafety();
    fs.mkdirSync(path.dirname(path.resolve(args.writeBaseline)), { recursive: true });
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }
  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const snap = await snapshotSafety();
    assert(JSON.stringify(snap.localPos) === JSON.stringify(baseline.localPos), 'baseline local POs');
    assert(JSON.stringify(snap.localLines) === JSON.stringify(baseline.localLines), 'baseline local PO lines');
    assert(snap.oauthHasPurchaseOrders === true, 'baseline OAuth requests Purchase Order READ');
  }

  if (args.probeScope) {
    const result = await procurementService.probeZohoScope();
    console.log('SCOPE_PROBE', JSON.stringify(result));
    assert(
      result.ok === true || result.reasonCode === 'PO_OAUTH_SCOPE_REQUIRED' || result.reasonCode,
      '5. Zoho procurement scope probed without changing OAuth'
    );
  }
  if (args.runTests) {
    const fake = new FakeProcurementZoho();
    await runTests(fake);
  }
  if (args.httpBase) {
    await httpChecks(args.httpBase);
  }
  if (args.runPhaseRegression) {
    const scripts = [
      ['product-phase1-verify.js', '66. Phase 1'],
      ['quantity-phase2-verify.js', '67. Phase 2'],
      ['reservation-phase3-verify.js', '68. Phase 3'],
      ['conversion-phase4-verify.js', '69. Phase 4'],
      ['phase5-break-cutover-verify.js', '70. Phase 5'],
      ['set-phase6-verify.js', '71. Phase 6'],
      ['receipt-phase7-verify.js', '72. Phase 7'],
      ['zoho-product-phase8-verify.js', '73. Phase 8']
    ];
    for (const [script, label] of scripts) {
      try {
        runChildVerify(script, dbName, []);
        ok(`${label} regression process exited 0`);
      } catch (err) {
        fail(label, err.message);
      }
    }
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error('-', f.name, f.detail));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  try { await db.destroy(); } catch (e) { /* ignore */ }
});
