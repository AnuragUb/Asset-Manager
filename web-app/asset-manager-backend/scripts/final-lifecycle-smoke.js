/**
 * Final pre-BRD core lifecycle smoke test (Phases 1–9).
 *
 * Production read-only:
 *   node scripts/final-lifecycle-smoke.js --database-name asset_manager --write-baseline ./scripts/reports/final-smoke-prod-before.json --http-base http://127.0.0.1:8080
 *
 * Scratch mutations (refused against asset_manager):
 *   node scripts/final-lifecycle-smoke.js --database-name asset_manager_final_smoke_scratch --run-tests
 *
 * Production compare after scratch:
 *   node scripts/final-lifecycle-smoke.js --database-name asset_manager --compare-baseline ./scripts/reports/final-smoke-prod-before.json
 *
 * Does not change OAuth, tokens, .env, or call live Zoho PO APIs.
 */
function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runTests: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-tests') args.runTests = true;
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
const { db, verifyProductId, verifyProcurementPoId, verifyProcurementPoLineId } = require('../utils');
const productService = require('../services/productService');
const procurementService = require('../services/procurementService');
const receiptService = require('../services/receiptService');
const reservationService = require('../services/reservationService');
const setService = require('../services/setService');
const conversionService = require('../services/conversionService');
const breakService = require('../services/breakService');

const failures = [];
const passes = [];
const HOST = '127.0.0.1:8080';
const ACTOR = 'final-smoke';
const PROTECTED = [
  'APP-MUM-0526-MMKBX9-W',
  'HAR-MUM-0726-55QOFA-R',
  'HAR-MUM-0826-IEIZP5-U',
  'MIS-MUM-0826-H4XVLL-W'
];

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

function num(value) {
  return Number(value || 0);
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
  const reasonOk = !reasonCode
    || caught.reasonCode === reasonCode
    || (Array.isArray(reasonCode) && reasonCode.includes(caught.reasonCode));
  const statusOk = caught.statusCode === 409 || caught.statusCode === 400 || caught.statusCode === 401 || caught.statusCode === 403;
  if (statusOk && reasonOk) ok(name);
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

  async getPurchaseOrder(id) {
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
    vendorName: 'Final Smoke Vendor',
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

async function countOrZero(sql) {
  try {
    const row = (await db.raw(sql)).rows[0];
    return Number(row && row.n != null ? row.n : 0);
  } catch (err) {
    return 0;
  }
}

async function checksumOrNull(sql) {
  try {
    const row = (await db.raw(sql)).rows[0];
    return row && row.checksum ? String(row.checksum) : null;
  } catch (err) {
    return null;
  }
}

async function snapshot() {
  const q = async (sql) => {
    try {
      return (await db.raw(sql)).rows[0] || {};
    } catch (err) {
      return {};
    }
  };
  const protectedHoldings = {};
  for (const id of PROTECTED) {
    const asset = await db('assets').where({ id }).first();
    const inv = await db('inventory_items').where({ id }).first();
    const row = asset || inv;
    protectedHoldings[id] = row ? {
      table: asset ? 'assets' : 'inventory_items',
      parentid: row.parentid || null,
      is_set: Number(row.is_set || 0),
      product_id: row.product_id || null,
      quantity_total: row.quantity_total == null ? null : String(row.quantity_total),
      quantity_available: row.quantity_available == null ? null : String(row.quantity_available),
      quantity_reserved: row.quantity_reserved == null ? null : String(row.quantity_reserved),
      receipt_line_id: row.receipt_line_id || null
    } : null;
  }
  const oauthSrc = fs.readFileSync(path.join(__dirname, '../services/zohoService.js'), 'utf8');
  return {
    database: await currentDbName(),
    capturedAt: new Date().toISOString(),
    counts: {
      products: await countOrZero('SELECT count(*)::int AS n FROM product'),
      productMappings: await countOrZero('SELECT count(*)::int AS n FROM product_external_ref'),
      zohoCatalog: await countOrZero('SELECT count(*)::int AS n FROM zoho_catalog'),
      assets: await countOrZero('SELECT count(*)::int AS n FROM assets'),
      inventory: await countOrZero('SELECT count(*)::int AS n FROM inventory_items'),
      reservations: await countOrZero('SELECT count(*)::int AS n FROM reservation'),
      conversions: await countOrZero('SELECT count(*)::int AS n FROM conversion'),
      sets: await countOrZero('SELECT count(*)::int AS n FROM managed_sets'),
      setRequirements: await countOrZero('SELECT count(*)::int AS n FROM set_requirement'),
      setAllocations: await countOrZero('SELECT count(*)::int AS n FROM managed_set_components'),
      receipts: await countOrZero('SELECT count(*)::int AS n FROM receipt_note'),
      receiptLines: await countOrZero('SELECT count(*)::int AS n FROM receipt_note_line'),
      localPos: await countOrZero('SELECT count(*)::int AS n FROM project_orders'),
      localPoLines: await countOrZero('SELECT count(*)::int AS n FROM project_order_items'),
      procurementPos: await countOrZero('SELECT count(*)::int AS n FROM procurement_po'),
      procurementLines: await countOrZero('SELECT count(*)::int AS n FROM procurement_po_line'),
      procurementMappings: await countOrZero('SELECT count(*)::int AS n FROM procurement_po_external_ref'),
      procurementEvents: await countOrZero('SELECT count(*)::int AS n FROM procurement_sync_event'),
      assetHistory: await countOrZero('SELECT count(*)::int AS n FROM asset_history'),
      quantityEvents: await countOrZero('SELECT count(*)::int AS n FROM quantity_events'),
      inventoryQuantityEvents: await countOrZero('SELECT count(*)::int AS n FROM inventory_quantity_events'),
      reservationEvents: await countOrZero('SELECT count(*)::int AS n FROM reservation_event'),
      conversionEvents: await countOrZero('SELECT count(*)::int AS n FROM conversion_event'),
      setEvents: await countOrZero('SELECT count(*)::int AS n FROM set_event'),
      receiptEvents: await countOrZero('SELECT count(*)::int AS n FROM receipt_event')
    },
    checksums: {
      assets: await checksumOrNull(`SELECT md5(string_agg(id||'|'||COALESCE(parentid,'')||'|'||COALESCE(product_id,'')||'|'||COALESCE(quantity_total::text,'')||'|'||COALESCE(quantity_available::text,'')||'|'||COALESCE(quantity_reserved::text,'')||'|'||COALESCE(is_set::text,'0'), ',' ORDER BY id)) AS checksum FROM assets`),
      inventory: await checksumOrNull(`SELECT md5(string_agg(id||'|'||COALESCE(parentid,'')||'|'||COALESCE(product_id,'')||'|'||COALESCE(quantity_total::text,'')||'|'||COALESCE(quantity_available::text,'')||'|'||COALESCE(quantity_reserved::text,''), ',' ORDER BY id)) AS checksum FROM inventory_items`),
      productMappings: await checksumOrNull(`SELECT md5(string_agg(product_id||'|'||external_id, ',' ORDER BY product_id, external_id)) AS checksum FROM product_external_ref`),
      reservations: await checksumOrNull(`SELECT md5(string_agg(id||'|'||status||'|'||resource_id||'|'||quantity::text, ',' ORDER BY id)) AS checksum FROM reservation`),
      conversions: await checksumOrNull(`SELECT md5(string_agg(id||'|'||status||'|'||source_id||'|'||quantity::text, ',' ORDER BY id)) AS checksum FROM conversion`),
      sets: await checksumOrNull(`SELECT md5(string_agg(id||'|'||status||'|'||COALESCE(product_id,''), ',' ORDER BY id)) AS checksum FROM managed_sets`),
      receipts: await checksumOrNull(`SELECT md5(string_agg(id||'|'||status||'|'||COALESCE(po_id,''), ',' ORDER BY id)) AS checksum FROM receipt_note`),
      localPos: await checksumOrNull(`SELECT md5(string_agg(id||'|'||COALESCE(ponumber,'')||'|'||COALESCE(status,'')||'|'||COALESCE(is_deleted::text,'0'), ',' ORDER BY id)) AS checksum FROM project_orders`)
    },
    protectedHoldings,
    localPos: await db('project_orders').select('id', 'ponumber', 'status', 'vendorname', 'is_deleted').orderBy('id'),
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

function diffSnapshot(before, after) {
  const changed = [];
  for (const key of Object.keys(before.checksums || {})) {
    if (String(before.checksums[key]) !== String(after.checksums[key])) changed.push(`checksum:${key}`);
  }
  for (const key of Object.keys(before.counts || {})) {
    if (Number(before.counts[key]) !== Number(after.counts[key])) changed.push(`count:${key}:${before.counts[key]}->${after.counts[key]}`);
  }
  for (const id of PROTECTED) {
    if (JSON.stringify(before.protectedHoldings[id]) !== JSON.stringify(after.protectedHoldings[id])) {
      changed.push(`protected:${id}`);
    }
  }
  if (JSON.stringify(before.localPos) !== JSON.stringify(after.localPos)) changed.push('localPos');
  return changed;
}

async function invRow(id) {
  return db('inventory_items').where({ id }).first();
}

async function assetRow(id) {
  return db('assets').where({ id }).first();
}

async function seedMappedProduct(fakeZohoProductId, name) {
  const product = await productService.createProduct({ name, price: 1000, unit: 'Nos' }, ACTOR);
  await productService.createExternalRef(product.id, {
    external_id: fakeZohoProductId,
    link_origin: 'PULL'
  }, ACTOR);
  return product;
}

async function importApproved(fake, { zohoPoId, poNumber, zohoLineId, zohoProductId, quantity, description }) {
  fake.seed(remotePo({
    zohoPoId,
    poNumber,
    status: 'APPROVED',
    lines: [remoteLine({
      zohoLineId,
      zohoProductId,
      description: description || 'Smoke battery',
      quantity
    })]
  }));
  return procurementService.importPurchaseOrder(zohoPoId, ACTOR);
}

async function postAcceptedInventory({ poId, poLineId, productId, accepted, damaged = 0, rejected = 0, idempotencyKey }) {
  const note = await receiptService.createReceiptNote({
    poId,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    idempotencyKey,
    lines: [{
      poLineId,
      productId,
      qtyAccepted: accepted,
      qtyDamaged: damaged,
      qtyRejected: rejected,
      creationMode: 'INVENTORY'
    }]
  });
  return receiptService.postReceipt(note.receiptNote.id, {
    actor: ACTOR,
    host: HOST,
    idempotencyKey
  });
}

async function httpChecks(base) {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const salesToken = jwt.sign(
    { user_id: 'final-smoke-sales', role: 'sales', username: 'sales', company_id: 'x' },
    secret,
    { expiresIn: '5m' }
  );
  const userToken = jwt.sign(
    { user_id: 'final-smoke-user', role: 'user', username: 'user', company_id: 'x' },
    secret,
    { expiresIn: '5m' }
  );
  const json = { 'Content-Type': 'application/json' };
  const salesH = { ...json, Authorization: `Bearer ${salesToken}` };
  const userH = { ...json, Authorization: `Bearer ${userToken}` };

  const unauthGets = [
    ['T unauthenticated products 401', `${base}/api/products`],
    ['T unauthenticated receipts 401', `${base}/api/receipt-notes`],
    ['T unauthenticated reservations 401', `${base}/api/reservations`],
    ['T unauthenticated sets 401', `${base}/api/sets`],
    ['T unauthenticated POs 401', `${base}/api/procurement/pos`]
  ];
  for (const [name, url] of unauthGets) {
    const res = await request(url, { method: 'GET' });
    assert(res.status === 401, name, res.status);
  }

  const salesPreview = await request(`${base}/api/purchase-orders/preview-zoho?zohoPoId=1`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert(salesPreview.status === 403, 'T sales cannot preview/import PO 403', salesPreview.status);
  const salesScope = await request(`${base}/api/procurement/scope`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert(salesScope.status === 403, 'T sales cannot refresh/scope PO 403', salesScope.status);

  const unauthReceive = await request(`${base}/api/receipt-notes`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ poId: 'x', poSource: 'ZOHO', lines: [] })
  });
  assert(unauthReceive.status === 401, 'T unauthenticated receive 401', unauthReceive.status);

  const unauthReserve = await request(`${base}/api/reservations`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ resourceType: 'INVENTORY', resourceId: 'x', quantity: 1 })
  });
  assert(unauthReserve.status === 401, 'T unauthenticated reserve 401', unauthReserve.status);

  const checks = [
    ['T sales cannot receive 403', `${base}/api/receipt-notes`, { poId: 'x', poSource: 'ZOHO', lines: [] }],
    ['T sales cannot reserve 403', `${base}/api/reservations`, { resourceType: 'INVENTORY', resourceId: 'x', quantity: 1, ownerType: 'MANUAL', ownerId: 'x' }],
    ['T sales cannot allocate Set 403', `${base}/api/sets/SET-X/allocations`, { requirementId: 'x', resourceType: 'INVENTORY', resourceId: 'x', quantity: 1 }],
    ['T sales cannot commercialize Set 403', `${base}/api/sets/SET-X/commercialize`, {}],
    ['T sales cannot manage Product 403', `${base}/api/products/PRD-X`, { name: 'nope' }, 'PUT'],
    ['T sales cannot import PO 403', `${base}/api/purchase-orders/import-zoho`, { zohoPoId: '1' }],
    ['T sales cannot refresh PO 403', `${base}/api/purchase-orders/PPO-0826-AAAAAA-A/refresh-zoho`, {}]
  ];
  for (const [name, url, body, method] of checks) {
    const res = await request(url, {
      method: method || 'POST',
      headers: salesH,
      body: JSON.stringify(body)
    });
    assert(res.status === 403, name, res.status);
  }
  const userReceive = await request(`${base}/api/receipt-notes`, {
    method: 'POST',
    headers: userH,
    body: JSON.stringify({ poId: 'x', poSource: 'ZOHO', lines: [] })
  });
  assert(userReceive.status === 403, 'T wrong role user cannot receive 403', userReceive.status);
}

async function runTests() {
  const fake = new FakeProcurementZoho();
  procurementService.setZohoGateway(fake);
  const beforeScratchSafety = await snapshot();
  const zohoProductId = '1205624000888000001';

  const existingActive = await db('product').where({ status: 'ACTIVE' }).first();
  assert(!!existingActive && existingActive.id, 'A existing ACTIVE Product readable', existingActive && existingActive.id);

  const product = await seedMappedProduct(zohoProductId, 'Final Smoke Battery');
  assert(verifyProductId(product.id) && String(product.status).toUpperCase() === 'ACTIVE', 'A scratch Product ACTIVE', product.id);

  const imported = await importApproved(fake, {
    zohoPoId: '1205624000888100001',
    poNumber: 'FS-MAIN-10',
    zohoLineId: '1205624000888100101',
    zohoProductId,
    quantity: 10
  });
  const po = imported.po;
  const poLine = po.lines[0];
  assert(!!po && verifyProcurementPoId(po.id), 'B PO exists', po && po.id);
  assert(!!poLine && verifyProcurementPoLineId(poLine.id), 'B PO line exists', poLine && poLine.id);
  assert(poLine.productId === product.id, 'B PO line Product mapped', poLine.productId);
  assert(num(poLine.ordered) === 10, 'B ordered quantity 10', poLine.ordered);

  const posted = await postAcceptedInventory({
    poId: po.id,
    poLineId: poLine.id,
    productId: product.id,
    accepted: 7,
    damaged: 1,
    rejected: 0
  });
  const line = posted.lines[0];
  assert(posted.receiptNote.status === 'POSTED', 'C receipt posted');
  assert(num(line.qtyReceived) === 8 && num(line.qtyAccepted) === 7 && num(line.qtyDamaged) === 1 && num(line.qtyRejected) === 0, 'C received = accepted + damaged + rejected');
  const ledger = await procurementService.qtyLedger(db, poLine.id);
  const qty = procurementService.lineQuantities(10, ledger);
  assert(qty.ordered === 10 && qty.accepted === 7 && qty.damaged === 1 && qty.rejected === 0 && qty.outstanding === 3, 'C outstanding 3', JSON.stringify(qty));

  const outputs = posted.outputs.filter((o) => o.resourceType === 'INVENTORY');
  assert(outputs.length === 1, 'D one Inventory row from accepted qty', outputs.length);
  const invId = outputs[0].resourceId;
  const inv = await invRow(invId);
  assert(num(inv.quantity_total) === 7 && num(inv.quantity_available) === 7 && num(inv.quantity_reserved) === 0, 'D inventory 7/7/0', JSON.stringify({ t: inv.quantity_total, a: inv.quantity_available, r: inv.quantity_reserved }));
  assert(!!inv.qrcode, 'D one QR on inventory');
  assert(inv.product_id === product.id, 'D Product ID preserved');
  assert(inv.receipt_line_id === line.id, 'D receipt lineage preserved');
  const invCountForLine = Number((await db('inventory_items').where({ receipt_line_id: line.id }).count('id as n'))[0].n);
  assert(invCountForLine === 1, 'D did not create seven Inventory rows', invCountForLine);

  const reserved = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 4,
    ownerType: 'MANUAL',
    ownerId: 'final-smoke-manual',
    actor: ACTOR,
    reason: 'Test E'
  });
  const afterE = await invRow(invId);
  assert(num(afterE.quantity_total) === 7 && num(afterE.quantity_available) === 3 && num(afterE.quantity_reserved) === 4, 'E reserve 4 leaves total 7 available 3 reserved 4');
  const invRowsAfterE = Number((await db('inventory_items').where({ receipt_line_id: line.id }).count('id as n'))[0].n);
  assert(invRowsAfterE === 1, 'E did not create another Inventory record');
  await reservationService.release({ id: reserved.reservation.id, actor: ACTOR, reason: 'Release manual reserve before SET allocation' });
  const afterRelease = await invRow(invId);
  assert(num(afterRelease.quantity_available) === 7 && num(afterRelease.quantity_reserved) === 0, 'E manual reservation released so SET can allocate from available');

  const setRow = await setService.createSet({
    name: 'Final Smoke Disposable Set',
    actor: ACTOR,
    requirements: [{ productId: product.id, quantity: 4 }]
  });
  assert(setRow.status === 'ACTIVE', 'F Set ACTIVE');
  assert(setRow.requirements.length === 1 && num(setRow.requirements[0].quantity) === 4, 'F immutable requirement 4');
  assert(setRow.completeness === 'EMPTY' && setRow.allocations.length === 0, 'F created from requirements not physical allocation');
  const previewEmpty = await setService.previewCommercialize(setRow.id);
  assert(!!previewEmpty.description, 'J preview description exists before allocation');

  const alloc = await setService.allocate(setRow.id, {
    requirementId: setRow.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 4,
    actor: ACTOR
  });
  const afterG = await invRow(invId);
  const setG = await setService.getSet(setRow.id);
  assert(num(alloc.allocation.quantity) === 4 && alloc.allocation.isActive !== false, 'G allocation 4');
  assert(alloc.reservation.ownerType === 'SET' && alloc.reservation.ownerId === setRow.id, 'G reservation owner SET');
  assert(num(afterG.quantity_total) === 7 && num(afterG.quantity_reserved) === 4 && num(afterG.quantity_available) === 3, 'G inventory reserved consistent');
  assert(setG.completeness === 'COMPLETE', 'G completeness COMPLETE');
  assert(setG.composition === 'INVENTORY', 'G composition INVENTORY');
  assert(!(await assetRow(invId)), 'G allocation did not convert Inventory into Asset');

  const deallocated = await setService.deallocate(setRow.id, alloc.allocation.id, { actor: ACTOR, reason: 'Test H' });
  const afterHInv = await invRow(invId);
  const setH = await setService.getSet(setRow.id, { includeInactive: true });
  assert(setH.inactiveAllocations && setH.inactiveAllocations.some((a) => a.id === alloc.allocation.id && a.isActive === false), 'H allocation inactive, history kept');
  assert(num(afterHInv.quantity_available) === 7 && num(afterHInv.quantity_reserved) === 0, 'H reservation released, available restored');
  assert(setH.status === 'ACTIVE' && setH.completeness === 'EMPTY', 'H Set ACTIVE completeness EMPTY');
  assert(num(setH.requirements[0].quantity) === 4, 'H requirement remains 4');
  const histH = await setService.listHistory(setRow.id);
  assert(Array.isArray(histH) ? histH.length >= 2 : (histH.events || histH.history || []).length >= 2, 'H allocation history retained');

  const realloc = await setService.allocate(setRow.id, {
    requirementId: setRow.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 4,
    actor: ACTOR
  });
  const setI = await setService.getSet(setRow.id);
  const afterI = await invRow(invId);
  assert(realloc.allocation && realloc.allocation.isActive !== false, 'I allocation active');
  assert(setI.completeness === 'COMPLETE', 'I Set COMPLETE');
  assert(realloc.reservation && realloc.reservation.status === 'ACTIVE' && realloc.reservation.ownerType === 'SET', 'I reservation recreated');
  assert(num(afterI.quantity_reserved) === 4 && num(afterI.quantity_available) === 3, 'I reserved restored');

  const previewAfterAlloc = await setService.previewCommercialize(setRow.id);
  assert(previewEmpty.description === previewAfterAlloc.description, 'J physical allocation has zero effect on Product description');
  const commercial = await setService.commercializeSet(setRow.id, {}, ACTOR);
  assert(commercial.product.origin === 'SET' && commercial.product.origin_ref === setRow.id, 'J origin SET origin_ref Set ID');
  assert(String(commercial.product.description || '') === String(previewEmpty.description || ''), 'J description from immutable requirements');
  const invAfterJ = await invRow(invId);
  assert(num(invAfterJ.quantity_total) === 7 && num(invAfterJ.quantity_reserved) === 4, 'J did not modify physical records');

  const historyAnswers = {
    notAccepted: 'Ordered 10, accepted 7. The 3 units not accepted remain commercially outstanding. Of the 8 physically received, 1 was damaged and did not become stock; 2 were not received on this note.',
    available: num(invAfterJ.quantity_available),
    reserved: num(invAfterJ.quantity_reserved),
    setUsingReserved: setRow.id,
    productId: product.id,
    chain: {
      poId: po.id,
      poLineId: poLine.id,
      receiptNoteId: posted.receiptNote.id,
      receiptLineId: line.id,
      inventoryId: invId,
      reservationId: realloc.reservation.id,
      allocationId: realloc.allocation.id
    }
  };
  assert(historyAnswers.available === 3 && historyAnswers.reserved === 4, 'U quantity currently available=3 reserved=4');
  const histSet = await setService.listHistory(setRow.id);
  const histEvents = Array.isArray(histSet) ? histSet : (histSet.events || histSet.history || []);
  assert(histEvents.length >= 1, 'U Set history reconstructable');
  const rnEvents = await db('receipt_event').where({ receipt_note_id: posted.receiptNote.id });
  assert(rnEvents.length >= 1, 'U Receipt history reconstructable');
  console.log('HISTORY_ANSWERS', JSON.stringify(historyAnswers));

  const overNoteCountBefore = Number((await db('receipt_note').count('id as n'))[0].n);
  const invCountBeforeK = Number((await db('inventory_items').count('id as n'))[0].n);
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: poLine.id,
        productId: product.id,
        qtyAccepted: 4,
        creationMode: 'INVENTORY'
      }]
    }),
    ['OVER_RECEIPT', 'INSUFFICIENT_OUTSTANDING'],
    'K over-receipt rejected'
  );
  const overNoteCountAfter = Number((await db('receipt_note').count('id as n'))[0].n);
  const invCountAfterK = Number((await db('inventory_items').count('id as n'))[0].n);
  assert(overNoteCountAfter === overNoteCountBefore && invCountAfterK === invCountBeforeK, 'K no receipt posted and no physical stock created');

  const cancelImport = await importApproved(fake, {
    zohoPoId: '1205624000888200001',
    poNumber: 'FS-CANCEL',
    zohoLineId: '1205624000888200101',
    zohoProductId,
    quantity: 4
  });
  await db('procurement_po').where({ id: cancelImport.po.id }).update({
    status: 'CANCELLED',
    last_synced_at: new Date().toISOString()
  });
  const invBeforeL = Number((await db('inventory_items').count('id as n'))[0].n);
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: cancelImport.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: cancelImport.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'PO_CANCELLED',
    'L cancelled PO blocks receipt'
  );
  const invAfterL = Number((await db('inventory_items').count('id as n'))[0].n);
  assert(invAfterL === invBeforeL, 'L no physical mutation on cancelled PO');

  const revImport = await importApproved(fake, {
    zohoPoId: '1205624000888300001',
    poNumber: 'FS-REV',
    zohoLineId: '1205624000888300101',
    zohoProductId,
    quantity: 10
  });
  const revPosted = await postAcceptedInventory({
    poId: revImport.po.id,
    poLineId: revImport.po.lines[0].id,
    productId: product.id,
    accepted: 6
  });
  const revInvId = revPosted.outputs[0].resourceId;
  const revInvBefore = await invRow(revInvId);
  fake.store.get('1205624000888300001').lines[0].quantity = 12;
  fake.store.get('1205624000888300001').modifiedTime = '2026-08-02T00:00:00+05:30';
  const revUp = await procurementService.refreshPurchaseOrder(revImport.po.id, ACTOR);
  assert(num(revUp.po.lines[0].ordered) === 12 && num(revUp.po.lines[0].accepted) === 6 && num(revUp.po.lines[0].outstanding) === 6, 'M ordered 12 accepted 6 outstanding 6');
  fake.store.get('1205624000888300001').lines[0].quantity = 5;
  fake.store.get('1205624000888300001').modifiedTime = '2026-08-03T00:00:00+05:30';
  const revDown = await procurementService.refreshPurchaseOrder(revImport.po.id, ACTOR);
  assert(revDown.po.reconciliationRequired === true, 'M RECONCILIATION_REQUIRED when ordered 5 < accepted 6');
  const histLine = await db('receipt_note_line').where({ id: revPosted.lines[0].id }).first();
  assert(num(histLine.ordered_qty_snapshot) === 10, 'M historical Receipt snapshot unchanged');
  const revInvAfter = await invRow(revInvId);
  assert(String(revInvAfter.quantity_total) === String(revInvBefore.quantity_total), 'M physical stock unchanged');
  await expectReject(
    () => receiptService.createReceiptNote({
      poId: revImport.po.id,
      poSource: 'ZOHO',
      actor: ACTOR,
      lines: [{
        poLineId: revImport.po.lines[0].id,
        productId: product.id,
        qtyAccepted: 1,
        creationMode: 'INVENTORY'
      }]
    }),
    'RECONCILIATION_REQUIRED',
    'M further receiving blocked'
  );

  const nImport = await importApproved(fake, {
    zohoPoId: '1205624000888400001',
    poNumber: 'FS-REVSAFE',
    zohoLineId: '1205624000888400101',
    zohoProductId,
    quantity: 5
  });
  const nPosted = await postAcceptedInventory({
    poId: nImport.po.id,
    poLineId: nImport.po.lines[0].id,
    productId: product.id,
    accepted: 3
  });
  const nInv = nPosted.outputs[0].resourceId;
  await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: nInv,
    quantity: 2,
    ownerType: 'MANUAL',
    ownerId: 'final-smoke-n',
    actor: ACTOR
  });
  const nEventsBefore = Number((await db('receipt_event').where({ receipt_note_id: nPosted.receiptNote.id }).count('id as n'))[0].n);
  await expectReject(
    () => receiptService.reverseReceipt(nPosted.receiptNote.id, { actor: ACTOR }),
    'NOT_REVERSIBLE',
    'N reversal rejected while reserved'
  );
  const nNote = await db('receipt_note').where({ id: nPosted.receiptNote.id }).first();
  const nEventsAfter = Number((await db('receipt_event').where({ receipt_note_id: nPosted.receiptNote.id }).count('id as n'))[0].n);
  assert(nNote.status === 'POSTED' && nEventsAfter === nEventsBefore, 'N no silent deletion / history destruction');

  const breakBefore = await invRow(invId);
  await expectReject(
    () => breakService.breakQuantity({
      holdingType: 'INVENTORY',
      parentId: invId,
      mode: 'BREAK',
      amount: 5,
      actor: ACTOR,
      host: HOST
    }),
    null,
    'O break more than available rejected'
  );
  const breakAfter = await invRow(invId);
  assert(
    num(breakAfter.quantity_total) === num(breakBefore.quantity_total)
      && num(breakAfter.quantity_available) === num(breakBefore.quantity_available)
      && num(breakAfter.quantity_reserved) === num(breakBefore.quantity_reserved),
    'O reserved quantity cannot be consumed; conservation holds'
  );

  const converted = await conversionService.convertInventoryToAsset({
    sourceId: invId,
    quantity: 1,
    granularity: 'INDIVIDUAL',
    actor: ACTOR,
    host: HOST,
    reason: 'Test P lineage'
  });
  const pAssetId = converted.assets[0].id;
  await reservationService.reserve({
    resourceType: 'ASSET',
    resourceId: pAssetId,
    ownerType: 'MANUAL',
    ownerId: 'final-smoke-p',
    actor: ACTOR
  });
  const pInvBefore = await invRow(invId);
  await expectReject(
    () => conversionService.returnAssetToInventory({
      sourceId: pAssetId,
      condition: 'AVAILABLE',
      actor: ACTOR
    }),
    'ASSET_RESERVED',
    'P Asset to Inventory blocked while reserved'
  );
  const pInvAfter = await invRow(invId);
  const pAssetAfter = await assetRow(pAssetId);
  assert(String(pInvAfter.quantity_total) === String(pInvBefore.quantity_total) && pAssetAfter, 'P no physical mutation');

  const mixImport = await importApproved(fake, {
    zohoPoId: '1205624000888500001',
    poNumber: 'FS-MIX',
    zohoLineId: '1205624000888500101',
    zohoProductId,
    quantity: 10
  });
  const mixInvPosted = await postAcceptedInventory({
    poId: mixImport.po.id,
    poLineId: mixImport.po.lines[0].id,
    productId: product.id,
    accepted: 8
  });
  const mixAssetNote = await receiptService.createReceiptNote({
    poId: mixImport.po.id,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    lines: [{
      poLineId: mixImport.po.lines[0].id,
      productId: product.id,
      qtyAccepted: 2,
      creationMode: 'ASSET_INDIVIDUAL'
    }]
  });
  const mixAssetPosted = await receiptService.postReceipt(mixAssetNote.receiptNote.id, { actor: ACTOR, host: HOST });
  const mixInvId = mixInvPosted.outputs[0].resourceId;
  const mixAssets = mixAssetPosted.outputs.filter((o) => o.resourceType === 'ASSET');
  assert(mixAssets.length === 2, 'Q two Assets from receipt ASSET_INDIVIDUAL (not conversion)');
  const mixSet = await setService.createSet({
    name: 'Final Smoke Mixed Set',
    actor: ACTOR,
    requirements: [{ productId: product.id, quantity: 10 }]
  });
  const mixConvBefore = Number((await db('conversion').count('id as n'))[0].n);
  await setService.allocate(mixSet.id, {
    requirementId: mixSet.requirements[0].id,
    resourceType: 'ASSET',
    resourceId: mixAssets[0].resourceId,
    quantity: 1,
    actor: ACTOR
  });
  await setService.allocate(mixSet.id, {
    requirementId: mixSet.requirements[0].id,
    resourceType: 'ASSET',
    resourceId: mixAssets[1].resourceId,
    quantity: 1,
    actor: ACTOR
  });
  await setService.allocate(mixSet.id, {
    requirementId: mixSet.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: mixInvId,
    quantity: 8,
    actor: ACTOR
  });
  const mixAfter = await setService.getSet(mixSet.id);
  const mixInvAfter = await invRow(mixInvId);
  const mixA0 = await assetRow(mixAssets[0].resourceId);
  const mixA1 = await assetRow(mixAssets[1].resourceId);
  const mixConvAfter = Number((await db('conversion').count('id as n'))[0].n);
  assert(mixAfter.completeness === 'COMPLETE', 'Q Set COMPLETE');
  assert(mixAfter.composition === 'MIXED', 'Q composition MIXED');
  assert(mixA0 && mixA1 && !(await assetRow(mixInvId)), 'Q Asset remains Asset, Inventory remains Inventory');
  assert(num(mixInvAfter.quantity_total) === 8 && num(mixInvAfter.quantity_converted || 0) === 0, 'Q no conversion of Inventory');
  assert(mixConvAfter === mixConvBefore, 'Q allocation did not create conversions');
  assert(!mixA0.assignedto && !mixA1.assignedto, 'Q no assignment');

  const overImport = await importApproved(fake, {
    zohoPoId: '1205624000888600001',
    poNumber: 'FS-OVER',
    zohoLineId: '1205624000888600101',
    zohoProductId,
    quantity: 12
  });
  const overPosted = await postAcceptedInventory({
    poId: overImport.po.id,
    poLineId: overImport.po.lines[0].id,
    productId: product.id,
    accepted: 12
  });
  const overInv = overPosted.outputs[0].resourceId;
  const overSet = await setService.createSet({
    name: 'Final Smoke Overcomplete Set',
    actor: ACTOR,
    requirements: [{ productId: product.id, quantity: 10 }]
  });
  const overAlloc = await setService.allocate(overSet.id, {
    requirementId: overSet.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: overInv,
    quantity: 12,
    actor: ACTOR
  });
  const overAfter = await setService.getSet(overSet.id);
  assert(overAfter.completeness === 'OVERCOMPLETE', 'R OVERCOMPLETE allowed');
  assert(overAlloc.overcomplete === true, 'R API warns but does not reject');
  assert(num(overAfter.requirements[0].quantity) === 10, 'R requirement remains 10');

  const sImport = await importApproved(fake, {
    zohoPoId: '1205624000888700001',
    poNumber: 'FS-IDEM',
    zohoLineId: '1205624000888700101',
    zohoProductId,
    quantity: 5
  });
  const sKey = 'final-smoke-idem-receipt';
  const sPosted1 = await postAcceptedInventory({
    poId: sImport.po.id,
    poLineId: sImport.po.lines[0].id,
    productId: product.id,
    accepted: 2,
    idempotencyKey: sKey
  });
  const sPosted2 = await postAcceptedInventory({
    poId: sImport.po.id,
    poLineId: sImport.po.lines[0].id,
    productId: product.id,
    accepted: 2,
    idempotencyKey: sKey
  });
  assert(sPosted1.receiptNote.id === sPosted2.receiptNote.id, 'S receipt POST idempotent');
  const sInv = sPosted1.outputs[0].resourceId;
  const sInvCount = Number((await db('inventory_items').where({ receipt_line_id: sPosted1.lines[0].id }).count('id as n'))[0].n);
  assert(sInvCount === 1, 'S no duplicate physical rows');
  const sRsv1 = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: sInv,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: 'final-smoke-s',
    actor: ACTOR,
    idempotencyKey: 'final-smoke-idem-rsv'
  });
  const sRsv2 = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: sInv,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: 'final-smoke-s',
    actor: ACTOR,
    idempotencyKey: 'final-smoke-idem-rsv'
  });
  assert(sRsv1.reservation.id === sRsv2.reservation.id, 'S reservation idempotent');
  await reservationService.release({ id: sRsv1.reservation.id, actor: ACTOR });
  const sSet = await setService.createSet({
    name: 'Final Smoke Idem Set',
    actor: ACTOR,
    requirements: [{ productId: product.id, quantity: 1 }]
  });
  const sAlloc1 = await setService.allocate(sSet.id, {
    requirementId: sSet.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: sInv,
    quantity: 1,
    actor: ACTOR,
    idempotencyKey: 'final-smoke-idem-alloc'
  });
  const sAlloc2 = await setService.allocate(sSet.id, {
    requirementId: sSet.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: sInv,
    quantity: 1,
    actor: ACTOR,
    idempotencyKey: 'final-smoke-idem-alloc'
  });
  assert(sAlloc1.allocation.id === sAlloc2.allocation.id, 'S allocation idempotent');
  const sCom1 = await setService.commercializeSet(sSet.id, {}, ACTOR);
  const sCom2 = await setService.commercializeSet(sSet.id, {}, ACTOR);
  assert(sCom1.product.id === sCom2.product.id && sCom2.idempotent === true, 'S commercialize idempotent no duplicate Product');

  for (const id of PROTECTED) {
    const before = beforeScratchSafety.protectedHoldings[id];
    const afterSnap = await snapshot();
    assert(JSON.stringify(before) === JSON.stringify(afterSnap.protectedHoldings[id]), `scratch did not mutate protected ${id}`);
  }
  assert(JSON.stringify(beforeScratchSafety.localPos) === JSON.stringify((await snapshot()).localPos), 'scratch did not mutate historical local POs');
}

async function main() {
  if (!args.databaseName) throw new Error('--database-name is required');
  const dbName = await currentDbName();
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-tests against production database asset_manager');
  }

  const snap = await snapshot();
  console.log('SNAPSHOT', JSON.stringify({ database: snap.database, counts: snap.counts, checksums: snap.checksums, oauthHasPurchaseOrders: snap.oauthHasPurchaseOrders }, null, 2));
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }
  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const changed = diffSnapshot(baseline, snap);
    assert(changed.length === 0, 'production snapshot unchanged vs baseline', changed.join(', ') || 'ok');
    console.log('PRODUCTION_CHANGED', changed.length);
    console.log('PRODUCTION_CHANGED_DETAIL', JSON.stringify(changed));
  }
  if (args.runTests) {
    await runTests();
  }
  if (args.httpBase) {
    await httpChecks(args.httpBase);
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
