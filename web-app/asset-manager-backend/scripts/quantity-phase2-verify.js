/**
 * Phase 2 verification — quantity conservation, Break, identity, QR, Product copy.
 *
 * Usage (inside asset-manager-prod, DB_NAME pointing at the target DB):
 *   node scripts/quantity-phase2-verify.js --database-name asset_manager_phase2_scratch --write-baseline /tmp/p2-base.json
 *   node scripts/quantity-phase2-verify.js --database-name asset_manager_phase2_scratch --compare-baseline /tmp/p2-base.json --run-break-tests
 *   node scripts/quantity-phase2-verify.js --database-name asset_manager --compare-baseline /tmp/p2-prod-base.json --http-base http://127.0.0.1:8080
 *
 * --run-break-tests mutates disposable rows only. Never pass it against production.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { db, generateModernAssetId } = require('../utils');
const breakService = require('../services/breakService');

const failures = [];
const passes = [];
const PRODUCTION_ASSET_IDS = new Set([
  'APP-MUM-0526-MMKBX9-W',
  'APP-MUM-0526-PZ2J6E-8',
  'HAR-MUM-0726-55QOFA-R',
  'HAR-MUM-0826-IEIZP5-U'
]);
const PRODUCTION_INV_IDS = new Set(['MIS-MUM-0826-H4XVLL-W']);

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runBreakTests: false,
    host: '192.168.6.237:8080'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-break-tests') args.runBreakTests = true;
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

async function colType(table, column) {
  const row = await db.raw(
    `
      SELECT data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = ? AND column_name = ?
    `,
    [table, column]
  );
  return row.rows[0] || null;
}

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const assets = await db('assets').select(
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'is_set', 'is_quantity_tracked', 'qrcode'
  ).orderBy('id');
  const inventory = await db('inventory_items').select(
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'qrcode', 'client_label'
  ).orderBy('id');
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
  const marking = await q(`SELECT count(*)::int AS n FROM physical_marking`);
  return {
    assets: assets.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      quantity_parent_id: a.quantity_parent_id || null,
      quantity_root_id: a.quantity_root_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_original: a.quantity_original == null ? null : String(a.quantity_original),
      lineage_status: a.lineage_status || null,
      product_id: a.product_id || null,
      is_set: Number(a.is_set || 0),
      is_quantity_tracked: Number(a.is_quantity_tracked || 0),
      has_qr: Boolean(a.qrcode)
    })),
    inventory: inventory.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      quantity_parent_id: a.quantity_parent_id || null,
      quantity_root_id: a.quantity_root_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_original: a.quantity_original == null ? null : String(a.quantity_original),
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
    marking
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
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function schemaChecks() {
  for (const [table, col] of [
    ['assets', 'quantity_total'],
    ['assets', 'quantity_available'],
    ['assets', 'quantity_original'],
    ['inventory_items', 'quantity_total'],
    ['inventory_items', 'quantity_available'],
    ['inventory_items', 'quantity_original']
  ]) {
    const t = await colType(table, col);
    assert(t && t.data_type === 'numeric' && Number(t.numeric_scale) === 6, `${table}.${col} is numeric(18,6)`, JSON.stringify(t));
  }
  assert(await db.schema.hasColumn('assets', 'lineage_status'), 'assets.lineage_status exists');
  assert(await db.schema.hasColumn('inventory_items', 'lineage_status'), 'inventory_items.lineage_status exists');
  assert(await db.schema.hasColumn('inventory_items', 'qrcode'), 'inventory_items.qrcode exists');
  assert(await db.schema.hasColumn('inventory_items', 'noqr'), 'inventory_items.noqr exists');
  assert(await db.schema.hasColumn('inventory_items', 'client_label'), 'inventory_items.client_label exists');
  assert(await db.schema.hasTable('physical_marking'), 'physical_marking exists');
  const reservedNow = await db.schema.hasColumn('assets', 'quantity_reserved');
  const convertedNow = await db.schema.hasColumn('assets', 'quantity_converted');
  if (reservedNow) ok('quantity_reserved exists (Phase 3+)');
  else ok('no quantity_reserved on assets (Phase 2-only schema)');
  if (convertedNow) ok('quantity_converted exists (Phase 4+)');
  else ok('no quantity_converted on assets (pre-Phase 4 schema)');
}

async function productionRowChecks(snap) {
  const har = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
  assert(har && har.quantity_root_id === har.id, 'B-8 repaired HAR-MUM-0726-55QOFA-R root');
  assert(har && har.quantity_original != null, 'B-8 set HAR quantity_original');
  assert(har && har.product_id === 'PRD-0826-W3TB7U-Z', 'HAR product_id unchanged');

  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', 'B-1 parentid left untouched');
  assert(app && !app.quantity_parent_id, 'APP child is not quantity-lineage');

  const setRow = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(setRow && setRow.is_set === 1, 'IEIZP5 remains is_set=1');
  assert(setRow && setRow.quantity_root_id === setRow.id, 'IEIZP5 root is self, not reinterpreted');
  assert(setRow && !setRow.product_id, 'IEIZP5 still has no Product');

  const inv = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
  assert(inv && inv.has_qr, 'B-4 aggregated inventory has one QR');
  assert(inv && Number(inv.quantity_total) === 3, 'MIS quantity_total conserved as 3');
  assert(inv && !inv.quantity_parent_id, 'MIS has no per-unit children');

  const marking = Number(snap.marking.n);
  assert(marking === 0, 'physical_marking has no migrated serials', marking);
}

async function insertTestAsset() {
  const id = generateModernAssetId('Mumbai', 'Hardware');
  await db('assets').insert({
    id,
    itemname: 'PHASE2-BREAK-TEST',
    status: 'In Store',
    type: 'Hardware',
    category: 'Test',
    currentlocation: 'Mumbai',
    lastupdated: new Date().toISOString(),
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: 'Nos',
    quantity_total: 10,
    quantity_available: 10,
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: 10,
    lineage_status: 'ACTIVE',
    product_id: 'PRD-0826-W3TB7U-Z',
    parentid: null
  });
  return id;
}

async function insertTestInventory() {
  const template = await db('inventory_items').where('id', 'MIS-MUM-0826-H4XVLL-W').first();
  if (!template) throw new Error('Cannot copy folder/kind from MIS template');
  const id = generateModernAssetId('Mumbai', 'Miscellaneous');
  await db('inventory_items').insert({
    id,
    itemname: 'PHASE2-INV-BREAK-TEST',
    status: 'In Store',
    type: template.type,
    category: template.category,
    folderid: template.folderid,
    kindid: template.kindid,
    currentlocation: 'Mumbai',
    lastupdated: new Date().toISOString(),
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: 'Nos',
    quantity_total: 10,
    quantity_available: 10,
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: 10,
    lineage_status: 'ACTIVE',
    product_id: null,
    parentid: null
  });
  return id;
}

async function runBreakTests(host) {
  const assetRoot = await insertTestAsset();
  const first = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId: assetRoot,
    mode: 'BREAK',
    amount: 3,
    children: [{ quantity: 1 }, { quantity: 2 }],
    actor: 'phase2-verify',
    host
  });
  assert(first.children.length === 2, 'Break created two children');
  assert(breakService.qtyEq(first.parent.quantity_total, 7, 0), 'Parent total is 7 after Break 3');
  assert(breakService.qtyEq(first.parent.quantity_available, 7, 0), 'Parent available is 7 after Break 3');
  assert(first.children.every((c) => breakService.ID_RE.test(c.id)), 'Child IDs use generateModernAssetId');
  assert(first.children.every((c) => !String(c.id).startsWith(`${assetRoot}-`)), 'Child IDs are not parent-suffix');
  assert(first.children.every((c) => c.product_id === 'PRD-0826-W3TB7U-Z'), 'product_id copied to asset children');
  assert(first.parent.parentid == null, 'Break did not write parentid');

  const childOfTwo = first.children.find((c) => Number(c.quantity_total) === 2);
  const recursive = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId: childOfTwo.id,
    mode: 'BREAK',
    amount: 1,
    actor: 'phase2-verify',
    host
  });
  assert(recursive.children.length === 1, 'Recursive Break created one grandchild');
  assert(recursive.children[0].quantity_root_id === assetRoot, 'Grandchild keeps original root id');
  const afterRecurse = await db('assets').where('id', assetRoot).first();
  assert(breakService.qtyEq(afterRecurse.quantity_original, 10, 0), 'Root quantity_original unchanged by recursive Break');

  let overBreakFailed = false;
  try {
    await breakService.breakQuantity({
      holdingType: 'ASSET',
      parentId: assetRoot,
      mode: 'BREAK',
      amount: 99,
      actor: 'phase2-verify',
      host
    });
  } catch (err) {
    overBreakFailed = /exceeds parent available/i.test(err.message);
  }
  assert(overBreakFailed, 'Child cannot exceed parent available');

  const leftoverParent = await db('assets').where('id', assetRoot).first();
  const make = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId: assetRoot,
    mode: 'MAKE_INDIVIDUAL',
    amount: Number(leftoverParent.quantity_available),
    actor: 'phase2-verify',
    host
  });
  assert(make.children.length === Number(leftoverParent.quantity_available), 'Make Individual created qty-1 children');
  assert(make.children.every((c) => Number(c.quantity_total) === 1), 'Make Individual children are qty 1');
  assert(make.children.every((c) => c.qrcode === true), 'Each Make Individual child has a QR');

  const inactivateTarget = first.children.find((c) => Number(c.quantity_total) === 1);
  const beforeParent = await db('assets').where('id', assetRoot).first();
  const inactivated = await breakService.inactivateChild({
    holdingType: 'ASSET',
    childId: inactivateTarget.id,
    actor: 'phase2-verify'
  });
  assert(inactivated.child.lineage_status === 'INACTIVE', 'Inactivated child is INACTIVE');
  assert(inactivated.child.qrcode === true, 'Inactivated child keeps QR');
  const stillThere = await db('assets').where('id', inactivateTarget.id).first();
  assert(stillThere, 'Inactivated child remains queryable');
  assert(breakService.qtyEq(inactivated.parent.quantity_available, Number(beforeParent.quantity_available) + 1, 0), 'Parent available restored on inactivate');

  const invRoot = await insertTestInventory();
  const invBreak = await breakService.breakQuantity({
    holdingType: 'INVENTORY',
    parentId: invRoot,
    mode: 'BREAK',
    amount: 4,
    actor: 'phase2-verify',
    host
  });
  assert(invBreak.children.length === 1, 'Inventory Break created one child');
  assert(breakService.ID_RE.test(invBreak.children[0].id), 'Inventory child uses generateModernAssetId');

  const liveProdAssets = await db('assets').whereIn('id', [...PRODUCTION_ASSET_IDS]);
  assert(liveProdAssets.length === 4, 'Production asset IDs still present after scratch tests');
  const liveProdInv = await db('inventory_items').whereIn('id', [...PRODUCTION_INV_IDS]);
  assert(liveProdInv.length === 1, 'Production inventory ID still present after scratch tests');
}

async function httpChecks(httpBase) {
  const unauth = await request(`${httpBase}/api/break`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdingType: 'ASSET', parentId: 'x', amount: 1 })
  });
  assert(unauth.status === 401, 'POST /api/break requires JWT', unauth.status);
  const unauth2 = await request(`${httpBase}/api/break/inactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdingType: 'ASSET', childId: 'x' })
  });
  assert(unauth2.status === 401, 'POST /api/break/inactivate requires JWT', unauth2.status);
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runBreakTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-break-tests against production database asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  await schemaChecks();
  await productionRowChecks(snap);

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const harBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    const harAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    assert(harBefore && harAfter && harBefore.quantity_total === harAfter.quantity_total, 'HAR quantity_total unchanged by type conversion');
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, 'parentid checksum unchanged');
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, 'zoho_catalog unchanged');
    assert(Number(baseline.products.n) === Number(snap.products.n), 'product count unchanged');
    assert(Number(baseline.sets.n) === Number(snap.sets.n), 'managed_sets count unchanged');
    if (!args.runBreakTests) {
      assert(Number(baseline.history.n) === Number(snap.history.n), 'asset_history count unchanged without Break tests');
    }
  }

  if (args.runBreakTests) {
    await runBreakTests(args.host);
  }
  if (args.httpBase) {
    await httpChecks(args.httpBase);
  }

  console.log(JSON.stringify({
    database: dbName,
    passed: passes.length,
    failed: failures.length,
    failures
  }, null, 2));
  if (failures.length) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
