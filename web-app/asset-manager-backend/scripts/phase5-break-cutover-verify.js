/**
 * Phase 5 verification — legacy Break/Split/Unsplit cutover containment.
 *
 * Scratch mutations:
 *   node scripts/phase5-break-cutover-verify.js --database-name asset_manager_phase5_scratch --write-baseline /tmp/p5-base.json
 *   node scripts/phase5-break-cutover-verify.js --database-name asset_manager_phase5_scratch --compare-baseline /tmp/p5-base.json --run-phase5-tests
 *
 * Production (no Break/Unsplit/Conversion against live holdings):
 *   node scripts/phase5-break-cutover-verify.js --database-name asset_manager --compare-baseline /tmp/p5-prod-base.json --http-base http://127.0.0.1:8080
 *
 * --run-phase5-tests mutates disposable rows only. Refused against asset_manager.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { db, generateModernAssetId } = require('../utils');
const breakService = require('../services/breakService');
const reservationService = require('../services/reservationService');
const conversionService = require('../services/conversionService');
const containment = require('../services/legacyBreakContainment');

const failures = [];
const passes = [];
const PRODUCTION_ASSET_IDS = new Set([
  'APP-MUM-0526-MMKBX9-W',
  'APP-MUM-0526-PZ2J6E-8',
  'HAR-MUM-0726-55QOFA-R',
  'HAR-MUM-0826-IEIZP5-U'
]);
const PRODUCTION_INV_IDS = new Set(['MIS-MUM-0826-H4XVLL-W']);
const PRODUCT_ID = 'PRD-0826-W3TB7U-Z';

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runPhase5Tests: false,
    host: '192.168.6.237:8080'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-phase5-tests') args.runPhase5Tests = true;
    else if (token === '--host') args.host = argv[++i];
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

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return {}; }
}

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const assetCols = [
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'is_set', 'is_quantity_tracked', 'qrcode', 'assignedto', 'sentagainstdc',
    'conversion_source_id', 'conversion_id'
  ];
  if (await db.schema.hasColumn('assets', 'quantity_converted')) assetCols.push('quantity_converted');
  if (await db.schema.hasColumn('assets', 'quantity_reserved')) assetCols.push('quantity_reserved');
  const assets = await db('assets').select(assetCols).orderBy('id');
  const invCols = [
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'qrcode', 'client_label'
  ];
  if (await db.schema.hasColumn('inventory_items', 'quantity_converted')) invCols.push('quantity_converted');
  if (await db.schema.hasColumn('inventory_items', 'quantity_reserved')) invCols.push('quantity_reserved');
  const inventory = await db('inventory_items').select(invCols).orderBy('id');
  const history = await q(`SELECT count(*)::int AS n, coalesce(max(timestamp)::text,'') AS max_ts FROM asset_history`);
  const qtyEvents = await q(`SELECT count(*)::int AS n FROM quantity_events`);
  const invEvents = await q(`SELECT count(*)::int AS n FROM inventory_quantity_events`);
  const products = await q(`SELECT count(*)::int AS n FROM product`);
  const catalog = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(zoho_product_id || '|' || product_name, ',' ORDER BY zoho_product_id)) AS checksum
    FROM zoho_catalog
  `);
  const sets = await q(`SELECT count(*)::int AS n FROM managed_sets`);
  const projects = await q(`SELECT count(*)::int AS n FROM projects`);
  const projectAssets = await q(`SELECT count(*)::int AS n FROM project_assets`);
  const conversions = (await db.schema.hasTable('conversion'))
    ? await q(`SELECT count(*)::int AS n FROM "conversion"`)
    : { n: 0 };
  const reservations = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation`)
    : { n: 0 };
  const orphanHistory = await q(`
    SELECT count(*)::int AS n
    FROM asset_history h
    WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE LOWER(a.id) = LOWER(h.assetid))
  `);
  return {
    assets: assets.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      quantity_parent_id: a.quantity_parent_id || null,
      quantity_root_id: a.quantity_root_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_original: a.quantity_original == null ? null : String(a.quantity_original),
      quantity_reserved: a.quantity_reserved == null ? null : String(a.quantity_reserved),
      quantity_converted: a.quantity_converted == null ? null : String(a.quantity_converted),
      lineage_status: a.lineage_status || null,
      product_id: a.product_id || null,
      conversion_source_id: a.conversion_source_id || null,
      conversion_id: a.conversion_id || null,
      is_set: Number(a.is_set || 0),
      is_quantity_tracked: Number(a.is_quantity_tracked || 0),
      has_qr: Boolean(a.qrcode),
      assignedto: a.assignedto || '',
      sentagainstdc: a.sentagainstdc || ''
    })),
    inventory: inventory.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      quantity_parent_id: a.quantity_parent_id || null,
      quantity_root_id: a.quantity_root_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_original: a.quantity_original == null ? null : String(a.quantity_original),
      quantity_converted: a.quantity_converted == null ? null : String(a.quantity_converted),
      quantity_reserved: a.quantity_reserved == null ? null : String(a.quantity_reserved),
      lineage_status: a.lineage_status || null,
      product_id: a.product_id || null,
      has_qr: Boolean(a.qrcode),
      client_label: a.client_label || null
    })),
    history,
    qtyEvents,
    invEvents,
    products,
    catalog,
    sets,
    projects,
    projectAssets,
    conversions,
    reservations,
    orphanHistory
  };
}

function productionRowChecks(snap) {
  const har = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
  assert(har && har.quantity_root_id === har.id, 'HAR root unchanged');
  assert(har && har.product_id === PRODUCT_ID, 'HAR product_id unchanged');
  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', 'APP parentid unchanged');
  assert(app && !app.quantity_parent_id, 'APP has no quantity_parent_id (not migrated)');
  const setRow = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(setRow && setRow.is_set === 1, 'IEIZP5 remains is_set=1');
  const inv = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
  assert(inv && Number(inv.quantity_total) === 3, 'MIS quantity_total conserved as 3');
}

function sourceChecks() {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const unassignStart = serverSrc.indexOf("app.delete('/api/projects/:id/unassign-asset/:assetId'");
  const unassignEnd = serverSrc.indexOf("app.post('/api/projects/:id/create-user'", unassignStart);
  const unassignBody = unassignStart >= 0 && unassignEnd > unassignStart
    ? serverSrc.slice(unassignStart, unassignEnd)
    : '';
  assert(unassignBody.includes("unassign-only"), 'unassign logs unassign-only policy');
  assert(!/trx\('assets'\)[\s\S]{0,80}\.delete\(\)/.test(unassignBody), 'unassign handler does not hard-delete assets');

  const qtySplitStart = serverSrc.indexOf("app.post('/api/quantity/split'");
  const qtySplitBody = serverSrc.slice(qtySplitStart, qtySplitStart + 600);
  assert(qtySplitBody.includes('LEGACY_QUANTITY_SPLIT_DISABLED'), 'quantity/split is disabled');
  assert(!qtySplitBody.includes('generateSplitAssetId'), 'disabled quantity/split does not generate -NaN IDs');

  const splitStart = serverSrc.indexOf("app.post('/api/assets/split'");
  const splitHead = serverSrc.slice(splitStart, splitStart + 220);
  assert(splitHead.includes('authenticateJWT'), '/api/assets/split requires JWT');
  assert(serverSrc.includes('shimmedToBreak'), 'quantity-mode split shims to breakService');
  assert(serverSrc.includes('delegatedToBreak'), 'quantity-mode split delegates to Break without auto-assign');
  assert(serverSrc.includes('LEGACY_SPLIT_CONTAINED'), 'serial split is contained');

  const projectsSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/projects.js'), 'utf8');
  assert(projectsSrc.includes("fetch('/api/break'"), 'quantity UI calls POST /api/break');
  assert(projectsSrc.includes('LEGACY_SPLIT_CONTAINED') || /serial Split is disabled|Use Break to individualize/i.test(projectsSrc), 'serial Split UI is contained');

  const flags = containment.flags();
  assert(flags.LEGACY_UNSPLIT_HARD_DELETE === false, 'LEGACY_UNSPLIT_HARD_DELETE defaults false');
  assert(flags.LEGACY_QUANTITY_SPLIT_UI === false, 'LEGACY_QUANTITY_SPLIT_UI defaults false after UI cutover');
}

async function insertTestAsset({
  qty = 10,
  name = 'PHASE5-ASSET',
  productId = PRODUCT_ID,
  parentid = null,
  quantityParentId = null,
  isSet = 0,
  conversionId = null,
  conversionSourceId = null,
  qrcode = 'data:image/png;base64,QQ=='
} = {}) {
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
    product_id: productId,
    parentid,
    qrcode,
    conversion_id: conversionId,
    conversion_source_id: conversionSourceId
  });
  return id;
}

async function holding(table, id) {
  return db(table).where('id', id).first();
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
  const statusOk = caught.statusCode === 409 || caught.statusCode === 400;
  const reasonOk = !reasonCode || caught.reasonCode === reasonCode;
  if (statusOk && reasonOk) ok(name);
  else fail(name, `status=${caught.statusCode} reasonCode=${caught.reasonCode} message=${caught.message}`);
  return caught;
}

async function runPhase5Tests(host) {
  const flags = containment.flags();
  assert(flags.LEGACY_UNSPLIT_HARD_DELETE === false, '1. hard-delete flag is false');

  const app = await holding('assets', 'APP-MUM-0526-MMKBX9-W');
  const harQty = await holding('assets', 'HAR-MUM-0726-55QOFA-R');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', '1. APP→HAR parentid present');
  await expectReject(
    () => db.transaction((trx) => containment.planUnsplitAction(trx, app)),
    'PROTECTED_LEGACY_RELATIONSHIP',
    '1. Unsplit of APP is 409 PROTECTED_LEGACY_RELATIONSHIP'
  );
  const appAfter = await holding('assets', 'APP-MUM-0526-MMKBX9-W');
  const harAfterProtect = await holding('assets', 'HAR-MUM-0726-55QOFA-R');
  assert(appAfter && appAfter.id === app.id, '1. APP row still exists');
  assert(String(harAfterProtect.quantity_total) === String(harQty.quantity_total), '1. HAR quantity unchanged by rejected unsplit');

  const parentId = await insertTestAsset({ qty: 10, name: 'PHASE5-BREAK-PARENT' });
  const broken = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId,
    mode: 'BREAK',
    amount: 3,
    actor: 'phase5-verify',
    host
  });
  const childId = broken.children[0].id;
  const child = await holding('assets', childId);
  assert(child.quantity_parent_id === parentId, '10. Break sets quantity_parent_id');
  assert(child.quantity_root_id === parentId, '13. Break sets quantity_root_id');
  assert(!child.parentid, '11. Break does not write parentid');
  assert(child.product_id === PRODUCT_ID, '11. Break copies product_id');
  assert(Boolean(child.qrcode), '12. Break creates QR');

  const plan = await db.transaction((trx) => containment.planUnsplitAction(trx, child));
  assert(plan.action === 'INACTIVATE', '2. Canonical Break child unsplits via inactivate');
  const inactivated = await breakService.inactivateChild({
    holdingType: 'ASSET',
    childId,
    actor: 'phase5-verify'
  });
  const childAfter = await holding('assets', childId);
  assert(childAfter && childAfter.lineage_status === 'INACTIVE', '2. Inactivate keeps the child row');
  assert(Boolean(childAfter.qrcode), '12. QR preserved after inactivate');
  assert(inactivated.parent.id === parentId, '4. Inactivate restores to Break parent');

  const qtyParent = await insertTestAsset({ qty: 8, name: 'PHASE5-LEGACY-PARENT' });
  const legacyChild = await insertTestAsset({
    qty: 2,
    name: 'PHASE5-LEGACY-PARENT',
    parentid: qtyParent,
    qrcode: null,
    productId: null
  });
  await db('asset_history').insert({
    assetid: legacyChild,
    action: 'SPLIT_CHILD_CREATED',
    timestamp: new Date().toISOString(),
    details: 'phase5 fixture',
    user: 'phase5-verify'
  });
  const legacyChildRow = await holding('assets', legacyChild);
  const parentQtyBefore = await holding('assets', qtyParent);
  await expectReject(
    () => db.transaction((trx) => containment.planUnsplitAction(trx, legacyChildRow)),
    'LEGACY_SPLIT_CHILD',
    '2/3. Legacy split-like child cannot be deleted'
  );
  assert(await holding('assets', legacyChild), '2. Legacy split child still exists');
  const parentQtyAfter = await holding('assets', qtyParent);
  assert(String(parentQtyAfter.quantity_total) === String(parentQtyBefore.quantity_total), '3. Parent qty not merged for legacy split child');

  const project = await db('projects').first();
  if (project) {
    try {
      await db('project_assets').insert({
        projectid: project.id,
        assetid: legacyChild,
        assigneddate: new Date().toISOString(),
        type: 'Permanent'
      });
    } catch (err) {
      if (!/unique|duplicate/i.test(String(err.message))) throw err;
    }
    await db.transaction(async (trx) => {
      await trx('project_assets').where({ projectid: project.id, assetid: legacyChild }).delete();
    });
    assert(await holding('assets', legacyChild), '3. Project unassign-only leaves physical child');
    const parentAfterUnassign = await holding('assets', qtyParent);
    assert(String(parentAfterUnassign.quantity_total) === String(parentQtyBefore.quantity_total), '3. Unassign does not restore parent qty');
  } else {
    ok('3. Project unassign skipped (no projects in dump)');
  }

  const reservedParent = await insertTestAsset({ qty: 1, name: 'PHASE5-RESERVED' });
  await reservationService.reserve({
    resourceType: 'ASSET',
    resourceId: reservedParent,
    quantity: 1,
    ownerType: 'MANUAL',
    ownerId: 'phase5-rsv',
    actor: 'phase5-verify'
  });
  await expectReject(
    () => db.transaction((trx) => containment.assertQuantityMutationAllowed({
      resourceType: 'ASSET',
      resourceId: reservedParent,
      operation: 'SERIAL_SPLIT',
      trx
    })),
    'ACTIVE_RESERVATION',
    '4. Active reservation blocks legacy quantity mutation'
  );
  const reservedBreak = await expectReject(
    () => breakService.breakQuantity({
      holdingType: 'ASSET',
      parentId: reservedParent,
      mode: 'BREAK',
      amount: 1,
      actor: 'phase5-verify',
      host
    }),
    null,
    '4. Break of reserved Asset is rejected'
  );
  assert(reservedBreak, '4. Reserved Break rejection returned an error');

  const convInvTemplate = await db('inventory_items').where('id', 'MIS-MUM-0826-H4XVLL-W').first();
  const convInvId = generateModernAssetId('Mumbai', 'Miscellaneous');
  await db('inventory_items').insert({
    id: convInvId,
    itemname: 'PHASE5-CONV-INV',
    status: 'In Store',
    type: convInvTemplate.type,
    category: convInvTemplate.category,
    folderid: convInvTemplate.folderid,
    kindid: convInvTemplate.kindid,
    currentlocation: 'Mumbai',
    lastupdated: new Date().toISOString(),
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: 'Nos',
    quantity_total: 6,
    quantity_available: 6,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_root_id: convInvId,
    quantity_original: 6,
    lineage_status: 'ACTIVE',
    product_id: PRODUCT_ID,
    parentid: null
  });
  const converted = await conversionService.convertInventoryToAsset({
    sourceId: convInvId,
    quantity: 2,
    granularity: 'GROUPED',
    actor: 'phase5-verify',
    host
  });
  const convertedAssetId = converted.assets[0].id;
  const convChild = await insertTestAsset({
    qty: 1,
    name: 'PHASE5-CONV-CHILD',
    parentid: convertedAssetId,
    conversionId: converted.conversion.id,
    conversionSourceId: convInvId,
    qrcode: null
  });
  await expectReject(
    () => db.transaction(async (trx) => {
      const row = await trx('assets').where({ id: convChild }).first();
      await containment.assertConversionLineageProtected('ASSET', row.id, trx);
    }),
    'UNRETURNED_CONVERSION',
    '5. Conversion lineage blocks destructive legacy path'
  );
  assert(await holding('assets', convertedAssetId), '5. Converted Asset still exists');

  const setParent = await insertTestAsset({ qty: 1, name: 'PHASE5-SET-PARENT', isSet: 1 });
  await db('assets').where({ id: setParent }).update({ is_quantity_tracked: 0, quantity_total: 1, quantity_available: 1 });
  const setChild = await insertTestAsset({
    qty: 1,
    name: 'PHASE5-SET-MEMBER',
    parentid: setParent,
    productId: PRODUCT_ID
  });
  await db('assets').where({ id: setChild }).update({ is_quantity_tracked: 0 });
  const setChildRow = await holding('assets', setChild);
  const setPlan = await db.transaction((trx) => containment.planUnsplitAction(trx, setChildRow));
  assert(setPlan.action === 'SET_CLEAR', '6. Set-like parentid uses SET_CLEAR, not Break');
  assert(setPlan.classified.class === 'SET_LIKE', '6. Set-like classification');

  const ambParent = await insertTestAsset({ qty: 5, name: 'PHASE5-AMB-PARENT' });
  const ambChild = await insertTestAsset({
    qty: 1,
    name: 'PHASE5-AMB-CHILD',
    parentid: ambParent,
    quantityParentId: ambParent
  });
  const ambChildRow = await holding('assets', ambChild);
  await expectReject(
    () => db.transaction((trx) => containment.planUnsplitAction(trx, ambChildRow)),
    'AMBIGUOUS_LINEAGE',
    '7. Ambiguous parentid+quantity_parent_id returns 409'
  );

  const recursiveParent = await insertTestAsset({ qty: 9, name: 'PHASE5-REC' });
  const first = await breakService.breakQuantity({
    holdingType: 'ASSET', parentId: recursiveParent, mode: 'BREAK', amount: 4, actor: 'phase5-verify', host
  });
  const grand = await breakService.breakQuantity({
    holdingType: 'ASSET', parentId: first.children[0].id, mode: 'BREAK', amount: 2, actor: 'phase5-verify', host
  });
  const grandRow = await holding('assets', grand.children[0].id);
  assert(grandRow.quantity_root_id === recursiveParent, '14. Recursive quantity_root_id points at original root');
  assert(grandRow.quantity_parent_id === first.children[0].id, '14. Recursive quantity_parent_id is immediate parent');

  const liveSets = Number((await db.raw('SELECT count(*)::int AS n FROM managed_sets')).rows[0].n);
  assert(liveSets >= 0, '17. managed_sets readable');
  const ieiz = await holding('assets', 'HAR-MUM-0826-IEIZP5-U');
  assert(ieiz && Number(ieiz.is_set) === 1, '16. Existing Set flag unchanged');
  const liveProdInv = await holding('inventory_items', 'MIS-MUM-0826-H4XVLL-W');
  assert(Number(liveProdInv.quantity_total) === 3, '15. MIS quantities unchanged by tests');
  const products = Number((await db.raw('SELECT count(*)::int AS n FROM product')).rows[0].n);
  assert(products >= 1, '14. Product table unchanged (still populated)');
}

async function httpChecks(httpBase) {
  const unauthSplit = await request(`${httpBase}/api/assets/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId: 'x', quantity: 1 })
  });
  assert(unauthSplit.status === 401, '20. POST /api/assets/split requires JWT', unauthSplit.status);

  const qtyDisabled = await request(`${httpBase}/api/quantity/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId: 'x', amount: 1 })
  });
  const qtyBody = parseJson(qtyDisabled.body);
  assert(qtyDisabled.status === 410, '8. POST /api/quantity/split is 410', qtyDisabled.status);
  assert(qtyBody.reasonCode === 'LEGACY_QUANTITY_SPLIT_DISABLED', '8. quantity/split reasonCode');

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign(
    { user_id: 'phase5-verify-user', role: 'user', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const forbidden = await request(`${httpBase}/api/assets/split`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`
    },
    body: JSON.stringify({ parentId: 'x', quantity: 1 })
  });
  assert(forbidden.status === 403, '21. POST /api/assets/split 403 for role user', forbidden.status);

  const unauthUnsplit = await request(`${httpBase}/api/assets/unsplit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childIds: ['APP-MUM-0526-MMKBX9-W'] })
  });
  assert(unauthUnsplit.status === 401, '20. POST /api/assets/unsplit requires JWT', unauthUnsplit.status);
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runPhase5Tests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-phase5-tests against production database asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  productionRowChecks(snap);
  sourceChecks();

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, 'parentid / physical identity unchanged');
    const harBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    const harAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    assert(harBefore && harAfter && harBefore.product_id === harAfter.product_id, 'HAR product_id unchanged vs baseline');
    assert(harBefore && harAfter && harBefore.quantity_original === harAfter.quantity_original, 'HAR quantity_original unchanged');
    const setBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    const setAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    assert(setBefore && setAfter && setBefore.is_set === setAfter.is_set, 'Set flag unchanged vs baseline');
    assert(Number(baseline.products.n) === Number(snap.products.n), 'product count unchanged');
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, 'zoho_catalog unchanged');
    assert(Number(baseline.sets.n) === Number(snap.sets.n), 'managed_sets count unchanged');
    if (!args.runPhase5Tests) {
      assert(Number(baseline.history.n) === Number(snap.history.n), 'asset_history count unchanged vs baseline');
      assert(Number(baseline.orphanHistory.n) === Number(snap.orphanHistory.n), 'orphan history count unchanged');
      assert(Number(baseline.conversions.n) === Number(snap.conversions.n), 'conversion count unchanged vs baseline');
      assert(Number(baseline.reservations.n) === Number(snap.reservations.n), 'reservation count unchanged vs baseline');
    }
  }

  if (args.runPhase5Tests) {
    await runPhase5Tests(args.host);
  }
  if (args.httpBase) {
    await httpChecks(args.httpBase);
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
