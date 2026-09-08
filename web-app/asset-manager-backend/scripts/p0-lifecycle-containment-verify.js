/**
 * P0 lifecycle containment verification.
 *
 * Scratch mutations:
 *   node scripts/p0-lifecycle-containment-verify.js --database-name asset_manager_p0_containment_scratch --run-tests
 *   node scripts/p0-lifecycle-containment-verify.js --database-name asset_manager_p0_containment_scratch --run-tests --run-phase-regression
 *
 * Production (no physical writes):
 *   node scripts/p0-lifecycle-containment-verify.js --database-name asset_manager --write-baseline ./scripts/reports/p0-prod-before.json --http-base http://127.0.0.1:8080
 *   node scripts/p0-lifecycle-containment-verify.js --database-name asset_manager --compare-baseline ./scripts/reports/p0-prod-before.json
 *
 * --run-tests / --run-phase-regression are refused against asset_manager.
 */
function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runTests: false,
    runPhaseRegression: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-tests') args.runTests = true;
    else if (token === '--run-phase-regression') args.runPhaseRegression = true;
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
const { db, generateModernAssetId } = require('../utils');
const productService = require('../services/productService');
const procurementService = require('../services/procurementService');
const receiptService = require('../services/receiptService');
const reservationService = require('../services/reservationService');
const setService = require('../services/setService');
const conversionService = require('../services/conversionService');
const breakService = require('../services/breakService');
const containment = require('../services/legacyBreakContainment');

const failures = [];
const passes = [];
const HOST = '127.0.0.1:8080';
const ACTOR = 'p0-containment';
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

function parseJson(text) {
  try { return JSON.parse(text); } catch (err) { return {}; }
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
      zoho_product_id: row.zoho_product_id || null,
      receipt_line_id: row.receipt_line_id || null
    } : null;
  }
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
      localPos: await countOrZero('SELECT count(*)::int AS n FROM project_orders'),
      procurementPos: await countOrZero('SELECT count(*)::int AS n FROM procurement_po'),
      assetHistory: await countOrZero('SELECT count(*)::int AS n FROM asset_history')
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
    protectedHoldings
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

function sourceChecks() {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const dashSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/dashboard.js'), 'utf8');
  const invSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/inventory.js'), 'utf8');
  const projSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/projects.js'), 'utf8');
  const assetViewSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/asset-view.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/index.html'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/main.js'), 'utf8');

  assert(serverSrc.includes('PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED'), '1. Asset/Inventory POST contained');
  assert(serverSrc.includes('LEGACY_SET_OPERATION_DISABLED'), '4. Make Set contained');
  assert(serverSrc.includes('LEGACY_SPLIT_CONTAINED'), '6. serial Split contained');
  assert(serverSrc.includes('delegatedToBreak'), '5. quantity Split delegates to Break');
  assert(serverSrc.includes('LEGACY_PHYSICAL_CREATE_CONTAINED'), '8. Make Permanent contained');
  assert(serverSrc.includes('LEGACY_ASSET_ZOHO_PUSH_CONTAINED'), '9. Asset→Zoho contained');
  assert(containment.flags().LEGACY_UNSPLIT_HARD_DELETE === false, '7. LEGACY_UNSPLIT_HARD_DELETE remains OFF');
  assert(/app\.post\('\/api\/assets', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '12. POST /api/assets JWT+roles');
  assert(/app\.post\('\/api\/assets\/make-set', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '12. POST /api/assets/make-set JWT+roles');
  assert(/app\.post\('\/api\/temporary-assets\/:id\/make-permanent', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '12. make-permanent JWT+roles');
  assert(/app\.post\('\/api\/assets\/bulk', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '12. bulk JWT+roles');

  const splitStart = serverSrc.indexOf("app.post('/api/assets/split'");
  const serialContain = serverSrc.indexOf('LEGACY_SPLIT_CONTAINED', splitStart);
  const qtyBlock = serverSrc.slice(splitStart, serialContain > splitStart ? serialContain : splitStart + 1800);
  assert(qtyBlock.includes('breakService.breakQuantity'), '5. quantity split calls breakService');
  assert(!qtyBlock.includes('if (autoAssign)'), '5. quantity split does not auto-assign');
  assert(!qtyBlock.includes('project_assets'), '5. quantity split does not write project_assets');

  assert(!invSrc.includes('btnCreateInventoryFromCatalog'), '3. catalog Create Inventory control removed');
  assert(invSrc.includes('btnCreateProductFromCatalog'), '3. catalog Create Product retained');
  assert(invSrc.includes('physical-intakes-view') || invSrc.includes('nav-physical-intakes'), '13. inventory UI opens Physical Intake');
  assert(indexSrc.includes('registered outside procurement') || indexSrc.includes('came through procurement'), '13. Receipt vs Physical Intake distinction retained');
  assert(dashSrc.includes('Sets are assembled through Set Requirements and Allocation.'), '4. Make Set UI contained');
  assert(/Legacy serial Split is disabled/i.test(dashSrc) && /Use Break to individualize/i.test(projSrc), '6. serial Split UI contained');
  assert(dashSrc.includes('Temporary assets cannot be promoted to stock'), '8. Make Permanent UI contained');
  assert(!assetViewSrc.includes('id="btnSyncToZoho"'), '9. Asset view no longer renders Push to Zoho button');
  assert(assetViewSrc.includes('Products are published from the Product workspace.'), '9. Asset view guides to Product publish');
  assert(indexSrc.includes('main.js?v=7.37'), '19. index.html cache 7.37');
  assert(mainSrc.includes("dashboard.js?v=7.37") && mainSrc.includes("inventory.js?v=7.31") && mainSrc.includes("projects.js?v=7.26"), '19. main.js imports');
  assert(dashSrc.includes('focusZohoCatalogInProducts'), '19. sidebar Zoho catalog opens Products workspace');
  assert(indexSrc.includes('id="nav-operations">Dashboard</a>'), '19. Dashboard nav label');
  assert(/id="nav-operations">Dashboard<\/a>[\s\S]*id="nav-products">Products<\/a>[\s\S]*id="nav-history">History<\/a>[\s\S]*id="nav-reservations">Reservations<\/a>[\s\S]*id="nav-purchase-orders">Purchase Orders<\/a>[\s\S]*id="nav-receipts">Receipt Notes<\/a>[\s\S]*id="nav-dc">Create DC<\/a>/.test(indexSrc), '19. Logistics dropdown order');
}

async function insertTestAsset({ qty = 10, name = 'P0-ASSET', parentid = null, quantityParentId = null, isSet = 0 } = {}) {
  const id = generateModernAssetId('Mumbai', 'Hardware');
  const root = quantityParentId || id;
  await db('assets').insert({
    id,
    itemname: name,
    status: 'In Store',
    type: 'Hardware',
    category: 'Test',
    currentlocation: 'Mumbai',
    lastupdated: new Date().toISOString(),
    is_quantity_tracked: 1,
    is_set: isSet,
    is_batch: 0,
    quantity_unit: 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_root_id: root,
    quantity_parent_id: quantityParentId,
    quantity_original: quantityParentId ? null : qty,
    lineage_status: 'ACTIVE',
    parentid,
    qrcode: 'data:image/png;base64,QQ=='
  });
  return id;
}

async function runCanonicalEngineTests() {
  const fake = new FakeProcurementZoho();
  procurementService.setZohoGateway(fake);
  const protectedBefore = await snapshot();

  const stamp = Date.now().toString().slice(-8);
  const product = await productService.createProduct({ name: `P0 Containment Cell ${stamp}`, price: 100, unit: 'Nos' }, ACTOR);
  const zohoProductId = `12056240${stamp}1`;
  await productService.createExternalRef(product.id, { external_id: zohoProductId, link_origin: 'PULL' }, ACTOR);

  fake.seed({
    zohoPoId: `12056240${stamp}2`,
    poNumber: `P0-PO-${stamp}`,
    subject: 'P0-PO-1',
    status: 'APPROVED',
    vendorZohoId: '1205624000000110001',
    vendorName: 'P0 Vendor',
    poDate: '2026-08-01',
    dueDate: '2026-08-20',
    subTotal: 100,
    discount: 0,
    tax: 0,
    grandTotal: 100,
    modifiedTime: '2026-08-01T00:00:00+05:30',
    lines: [{
      zohoLineId: `12056240${stamp}3`,
      sequenceNumber: 1,
      zohoProductId,
      zohoProductName: 'P0 Containment Cell',
      description: 'P0 Containment Cell',
      quantity: 10,
      listPrice: 100,
      discount: 0,
      tax: 0,
      netTotal: 1000,
      unit: 'Nos'
    }]
  });
  const imported = await procurementService.importPurchaseOrder(`12056240${stamp}2`, ACTOR);
  const poLine = imported.po.lines[0];
  const key = `p0-containment-receipt-${stamp}`;
  const note = await receiptService.createReceiptNote({
    poId: imported.po.id,
    poSource: 'ZOHO',
    actor: ACTOR,
    receivedAtLocation: 'Mumbai',
    idempotencyKey: key,
    lines: [{
      poLineId: poLine.id,
      productId: product.id,
      qtyAccepted: 6,
      qtyDamaged: 0,
      qtyRejected: 0,
      creationMode: 'INVENTORY'
    }]
  });
  const posted = await receiptService.postReceipt(note.receiptNote.id, { actor: ACTOR, host: HOST, idempotencyKey: key });
  const postedAgain = await receiptService.postReceipt(note.receiptNote.id, { actor: ACTOR, host: HOST, idempotencyKey: key });
  assert(posted.receiptNote.status === 'POSTED', '12. Receipt still creates physical stock');
  assert(posted.receiptNote.id === postedAgain.receiptNote.id, '17. Receipt post idempotent');
  const invId = posted.outputs[0].resourceId;
  const inv = await db('inventory_items').where({ id: invId }).first();
  assert(inv && num(inv.quantity_total) === 6 && inv.product_id === product.id, '12. Receipt Inventory qty+product', JSON.stringify(inv && { qty: inv.quantity_total, product: inv.product_id }));
  assert(!!inv.qrcode, '19. Receipt Inventory has QR');
  const historyN = Number((await db('asset_history').where({ assetid: invId }).count('id as n'))[0].n);
  const receiptEvents = Number((await db('receipt_event').where({ receipt_note_id: posted.receiptNote.id }).count('id as n'))[0].n);
  assert(historyN >= 1 || receiptEvents >= 1, '18. Receipt wrote history');

  const broken = await breakService.breakQuantity({
    holdingType: 'INVENTORY',
    parentId: invId,
    mode: 'BREAK',
    amount: 2,
    actor: ACTOR,
    host: HOST
  });
  assert(broken.children && broken.children.length === 1, '13. Break still works');
  const parentAfterBreak = await db('inventory_items').where({ id: invId }).first();
  const child = await db('inventory_items').where({ id: broken.children[0].id }).first();
  assert(num(parentAfterBreak.quantity_total) + num(child.quantity_total) === 6, '19. Break conserves quantity');
  assert(child.product_id === product.id && child.quantity_parent_id === invId, '13. Break copies product + lineage');

  const converted = await conversionService.convertInventoryToAsset({
    sourceId: invId,
    quantity: 1,
    granularity: 'INDIVIDUAL',
    actor: ACTOR,
    host: HOST
  });
  assert(converted.assets && converted.assets[0], '14. Conversion still works');
  const destAssetId = converted.assets[0].id;
  const destAsset = await db('assets').where({ id: destAssetId }).first();
  assert(destAsset && destAsset.product_id === product.id, '14. Conversion copies product_id');

  await conversionService.returnAssetToInventory({
    sourceId: destAssetId,
    condition: 'AVAILABLE',
    actor: ACTOR
  });

  const rsv = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: `p0-rsv-${stamp}`,
    actor: ACTOR,
    idempotencyKey: `p0-rsv-${stamp}`
  });
  const rsv2 = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: `p0-rsv-${stamp}`,
    actor: ACTOR,
    idempotencyKey: `p0-rsv-${stamp}`
  });
  assert(rsv.reservation.id === rsv2.reservation.id, '15. Reservation still works + idempotent');
  await reservationService.release({ id: rsv.reservation.id, actor: ACTOR });

  const set = await setService.createSet({
    name: `P0 Containment Set ${stamp}`,
    actor: ACTOR,
    requirements: [{ productId: product.id, quantity: 1 }]
  });
  const alloc = await setService.allocate(set.id, {
    requirementId: set.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 1,
    actor: ACTOR,
    idempotencyKey: `p0-alloc-${stamp}`
  });
  const alloc2 = await setService.allocate(set.id, {
    requirementId: set.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: invId,
    quantity: 1,
    actor: ACTOR,
    idempotencyKey: `p0-alloc-${stamp}`
  });
  assert(alloc.allocation.id === alloc2.allocation.id, '16. Set allocation still works + idempotent');

  const breakParent = await insertTestAsset({ qty: 8, name: 'P0-BREAK-PARENT' });
  const qtyBefore = await db('assets').where({ id: breakParent }).first();
  const made = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId: breakParent,
    mode: 'MAKE_INDIVIDUAL',
    amount: 2,
    actor: ACTOR,
    host: HOST
  });
  assert(made.children.length === 2, '7. Make Individual via breakService');
  assert(made.children.every((c) => num(c.quantity_total) === 1), '7. Individualize children qty 1');
  const parentAfter = await db('assets').where({ id: breakParent }).first();
  assert(num(qtyBefore.quantity_total) === num(parentAfter.quantity_total) + 2, '19. Individualize conserves parent qty');

  const childRow = await db('assets').where({ id: made.children[0].id }).first();
  const plan = await db.transaction((trx) => containment.planUnsplitAction(trx, childRow));
  assert(plan.action === 'INACTIVATE', '7. Canonical Break child unsplits via INACTIVATE');
  const inactivated = await breakService.inactivateChild({
    holdingType: 'ASSET',
    childId: made.children[0].id,
    actor: ACTOR
  });
  assert(inactivated && inactivated.child, '7. Unsplit inactivate does not delete');
  const stillThere = await db('assets').where({ id: made.children[0].id }).first();
  assert(!!stillThere && String(stillThere.lineage_status || '').toUpperCase() !== 'ACTIVE', '7. child remains, not hard-deleted');

  const ambParent = await insertTestAsset({ qty: 4, name: 'P0-AMB-PARENT' });
  const ambChild = await insertTestAsset({
    qty: 1,
    name: 'P0-AMB-CHILD',
    parentid: ambParent,
    quantityParentId: ambParent
  });
  const ambRow = await db('assets').where({ id: ambChild }).first();
  let ambCaught = null;
  try {
    await db.transaction((trx) => containment.planUnsplitAction(trx, ambRow));
  } catch (err) {
    ambCaught = err;
  }
  assert(ambCaught && ambCaught.statusCode === 409, '7. Ambiguous lineage 409', ambCaught && ambCaught.reasonCode);

  const setLikeParent = await insertTestAsset({ qty: 1, name: 'P0-SET-PARENT', isSet: 1 });
  const setLikeChild = await insertTestAsset({ qty: 1, name: 'P0-SET-CHILD', parentid: setLikeParent });
  const setLikeRow = await db('assets').where({ id: setLikeChild }).first();
  const setPlan = await db.transaction((trx) => containment.planUnsplitAction(trx, setLikeRow));
  assert(setPlan.action === 'SET_CLEAR', '7. Legacy Set-like parentid uses SET_CLEAR');

  const after = await snapshot();
  for (const id of PROTECTED) {
    assert(
      JSON.stringify(protectedBefore.protectedHoldings[id]) === JSON.stringify(after.protectedHoldings[id]),
      `20. protected ${id} unchanged`
    );
  }
}

async function httpChecks(base) {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const salesToken = jwt.sign({ user_id: 'p0-sales', role: 'sales', username: 'sales', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const userToken = jwt.sign({ user_id: 'p0-user', role: 'user', username: 'user', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const managerToken = jwt.sign({ user_id: 'p0-mgr', role: 'manager', username: 'logistics', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const json = { 'Content-Type': 'application/json' };
  const salesH = { ...json, Authorization: `Bearer ${salesToken}` };
  const userH = { ...json, Authorization: `Bearer ${userToken}` };
  const mgrH = { ...json, Authorization: `Bearer ${managerToken}` };

  const contained = [
    ['1. POST /api/assets', '/api/assets', { ItemName: 'nope', Category: 'IT', Type: 'Hardware' }, 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409],
    ['2. POST /api/inventory/items', '/api/inventory/items', { ItemName: 'nope', FolderID: 'IF-INBOX', KindID: 'IK-MISC' }, 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409],
    ['3. catalog inventory create', '/api/inventory/items', { ItemName: 'nope', FolderID: 'IF-INBOX', KindID: 'IK-MISC', ZohoProductId: '1' }, 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409],
    ['4. POST /api/assets/make-set', '/api/assets/make-set', { parentAssetId: 'x', childAssetIds: ['y'] }, 'LEGACY_SET_OPERATION_DISABLED', 409],
    ['8. make-permanent', '/api/temporary-assets/TEMP-NOPE/make-permanent', {}, 'LEGACY_PHYSICAL_CREATE_CONTAINED', 409],
    ['9. sync-asset', '/api/zoho/sync-asset/APP-MUM-0526-MMKBX9-W', {}, 'LEGACY_ASSET_ZOHO_PUSH_CONTAINED', 410],
    ['bulk create', '/api/assets/bulk', [{ ItemName: 'nope', Category: 'IT' }], 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409]
  ];

  for (const [name, urlPath, body, reason, status] of contained) {
    const unauth = await request(`${base}${urlPath}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert(unauth.status === 401, `${name} unauth 401`, unauth.status);
    const sales = await request(`${base}${urlPath}`, { method: 'POST', headers: salesH, body: JSON.stringify(body) });
    assert(sales.status === 403, `${name} sales 403`, sales.status);
    const user = await request(`${base}${urlPath}`, { method: 'POST', headers: userH, body: JSON.stringify(body) });
    assert(user.status === 403, `${name} user 403`, user.status);
    const mgr = await request(`${base}${urlPath}`, { method: 'POST', headers: mgrH, body: JSON.stringify(body) });
    const parsed = parseJson(mgr.body);
    assert(mgr.status === status, `${name} logistics ${status}`, mgr.status);
    assert(parsed.reasonCode === reason, `${name} reasonCode`, parsed.reasonCode);
    assert(typeof parsed.error === 'string' && parsed.error.length > 0 && !/something went wrong/i.test(parsed.error), `${name} human message`, parsed.error);
  }

  const serialSplit = await request(`${base}/api/assets/split`, {
    method: 'POST',
    headers: mgrH,
    body: JSON.stringify({ parentId: 'NO-SUCH-ASSET', serials: ['SN1'] })
  });
  const serialBody = parseJson(serialSplit.body);
  assert(
    serialSplit.status === 404 || (serialSplit.status === 410 && serialBody.reasonCode === 'LEGACY_SPLIT_CONTAINED'),
    '6. serial split contained or missing parent',
    `${serialSplit.status} ${serialBody.reasonCode}`
  );

  const salesSplit = await request(`${base}/api/assets/split`, {
    method: 'POST',
    headers: salesH,
    body: JSON.stringify({ parentId: 'NO-SUCH-ASSET', serials: ['SN1'] })
  });
  assert(salesSplit.status === 403, '10. Sales 403 on split', salesSplit.status);

  const unauthUnsplit = await request(`${base}/api/assets/unsplit`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ childIds: ['APP-MUM-0526-MMKBX9-W'] })
  });
  assert(unauthUnsplit.status === 401, '7. unsplit unauth 401', unauthUnsplit.status);
  const salesUnsplit = await request(`${base}/api/assets/unsplit`, {
    method: 'POST',
    headers: salesH,
    body: JSON.stringify({ childIds: ['APP-MUM-0526-MMKBX9-W'] })
  });
  assert(salesUnsplit.status === 403, '10. Sales 403 on unsplit', salesUnsplit.status);
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
  return result;
}

async function main() {
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if ((args.runTests || args.runPhaseRegression) && dbName === 'asset_manager') {
    throw new Error('--run-tests / --run-phase-regression refused against asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.mkdirSync(path.dirname(args.writeBaseline), { recursive: true });
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  sourceChecks();

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    for (const id of PROTECTED) {
      assert(
        JSON.stringify(baseline.protectedHoldings[id]) === JSON.stringify(snap.protectedHoldings[id]),
        `20. protected ${id} unchanged vs baseline`
      );
    }
    if (!args.runTests) {
      for (const key of Object.keys(baseline.checksums || {})) {
        assert(String(baseline.checksums[key]) === String(snap.checksums[key]), `prod checksum ${key} unchanged`);
      }
    }
  }

  if (args.runTests) {
    await runCanonicalEngineTests();
  }

  if (args.httpBase) {
    await httpChecks(args.httpBase);
  }

  if (args.runPhaseRegression) {
    const kids = [
      ['product-phase1-verify.js', []],
      ['quantity-phase2-verify.js', ['--run-break-tests']],
      ['reservation-phase3-verify.js', ['--run-reservation-tests']],
      ['conversion-phase4-verify.js', ['--run-conversion-tests']],
      ['phase5-break-cutover-verify.js', ['--run-phase5-tests']],
      ['set-phase6-verify.js', ['--run-set-tests']],
      ['receipt-phase7-verify.js', ['--run-receipt-tests']],
      ['zoho-product-phase8-verify.js', ['--run-tests']],
      ['procurement-phase9-verify.js', ['--run-tests']]
    ];
    for (const [script, extra] of kids) {
      try {
        runChildVerify(script, dbName, extra);
        ok(`phase-regression ${script}`);
      } catch (err) {
        fail(`phase-regression ${script}`, err.message);
      }
    }
  }

  console.log(`\nPASS ${passes.length} FAIL ${failures.length}`);
  if (failures.length) {
    failures.forEach((f) => console.error('-', f.name, f.detail));
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    try { await db.destroy(); } catch (e) { /* ignore */ }
  });
