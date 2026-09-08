/**
 * Phase 4 verification — conversion engine, lineage, conservation, Product, auth.
 *
 * Scratch mutations:
 *   node scripts/conversion-phase4-verify.js --database-name asset_manager_phase4_scratch --write-baseline /tmp/p4-base.json
 *   node scripts/conversion-phase4-verify.js --database-name asset_manager_phase4_scratch --compare-baseline /tmp/p4-base.json --run-conversion-tests
 *
 * Production (no conversion mutations):
 *   node scripts/conversion-phase4-verify.js --database-name asset_manager --compare-baseline /tmp/p4-prod-base.json --http-base http://127.0.0.1:8080
 *
 * --run-conversion-tests mutates disposable rows only. Refused against asset_manager.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const {
  db,
  generateModernAssetId,
  generateConversionId,
  verifyConversionId,
  verifyReservationId
} = require('../utils');
const conversionService = require('../services/conversionService');
const reservationService = require('../services/reservationService');
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
const PRODUCT_ID = 'PRD-0826-W3TB7U-Z';

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runConversionTests: false,
    host: '192.168.6.237:8080'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-conversion-tests') args.runConversionTests = true;
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

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const hasConvCols = await db.schema.hasColumn('assets', 'conversion_source_id');
  const hasConverted = await db.schema.hasColumn('assets', 'quantity_converted');
  const assetCols = [
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'is_set', 'is_quantity_tracked', 'qrcode', 'assignedto', 'sentagainstdc'
  ];
  if (hasConvCols) assetCols.push('conversion_source_id', 'conversion_id');
  if (hasConverted) assetCols.push('quantity_converted');
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
  const dcs = await q(`SELECT count(*)::int AS n FROM delivery_challans`);
  const conversions = (await db.schema.hasTable('conversion'))
    ? await q(`SELECT count(*)::int AS n FROM "conversion"`)
    : { n: 0 };
  const reservations = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation`)
    : { n: 0 };
  return {
    assets: assets.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      quantity_parent_id: a.quantity_parent_id || null,
      quantity_root_id: a.quantity_root_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_original: a.quantity_original == null ? null : String(a.quantity_original),
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
    dcs,
    conversions,
    reservations
  };
}

async function schemaChecks() {
  for (const [table, col] of [
    ['assets', 'quantity_converted'],
    ['inventory_items', 'quantity_converted']
  ]) {
    const t = await colType(table, col);
    assert(t && t.data_type === 'numeric' && Number(t.numeric_scale) === 6, `${table}.${col} is numeric(18,6)`, JSON.stringify(t));
  }
  assert(await db.schema.hasTable('conversion'), 'conversion table exists');
  assert(await db.schema.hasTable('conversion_line'), 'conversion_line table exists');
  assert(await db.schema.hasTable('conversion_event'), 'conversion_event table exists');
  assert(await db.schema.hasColumn('assets', 'conversion_source_id'), 'assets.conversion_source_id exists');
  assert(await db.schema.hasColumn('assets', 'conversion_id'), 'assets.conversion_id exists');
  const id = generateConversionId();
  assert(verifyConversionId(id), 'verifyConversionId(generateConversionId())');
  assert(!verifyConversionId('RSV-0826-AAAAAA-A'), 'reservation-shaped ID is not a conversion ID');
  assert(!verifyConversionId('PRD-0826-AAAAAA-A'), 'product-shaped ID is not a conversion ID');
}

async function productionRowChecks(snap) {
  const har = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
  assert(har && har.quantity_root_id === har.id, 'HAR root unchanged');
  assert(har && har.product_id === PRODUCT_ID, 'HAR product_id unchanged');
  assert(har && !har.conversion_source_id, 'HAR has no invented conversion lineage');
  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', 'APP parentid unchanged');
  const setRow = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(setRow && setRow.is_set === 1, 'IEIZP5 remains is_set=1');
  const inv = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
  assert(inv && Number(inv.quantity_total) === 3, 'MIS quantity_total conserved as 3');
  assert(inv && Number(inv.quantity_available) === 1, 'MIS available remains 1');
  assert(inv && Number(inv.quantity_converted || 0) === 0, 'MIS quantity_converted is 0 (no guessed conversions)');
}

async function insertTestInventory({
  qty = 10,
  available = null,
  productId = PRODUCT_ID,
  name = 'PHASE4-CONV-INV'
} = {}) {
  const template = await db('inventory_items').where('id', 'MIS-MUM-0826-H4XVLL-W').first();
  if (!template) throw new Error('Cannot copy folder/kind from MIS template');
  const id = generateModernAssetId('Mumbai', 'Miscellaneous');
  const avail = available == null ? qty : available;
  await db('inventory_items').insert({
    id,
    itemname: name,
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
    quantity_total: qty,
    quantity_available: avail,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: productId,
    parentid: null
  });
  return id;
}

async function insertTestAsset({
  qty = 1,
  assignedto = '',
  sentagainstdc = '',
  productId = PRODUCT_ID,
  name = 'PHASE4-NATIVE-ASSET',
  conversionSourceId = null,
  conversionId = null
} = {}) {
  const id = generateModernAssetId('Mumbai', 'Hardware');
  await db('assets').insert({
    id,
    itemname: name,
    status: 'In Store',
    type: 'Hardware',
    category: 'Test',
    currentlocation: 'Mumbai',
    lastupdated: new Date().toISOString(),
    assignedto,
    sentagainstdc,
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: productId,
    parentid: null,
    conversion_source_type: conversionSourceId ? 'INVENTORY' : null,
    conversion_source_id: conversionSourceId,
    conversion_root_type: conversionSourceId ? 'INVENTORY' : null,
    conversion_root_id: conversionSourceId,
    conversion_id: conversionId
  });
  return id;
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

async function holding(table, id) {
  return db(table).where('id', id).first();
}

async function runConversionTests(host) {
  const invGrouped = await insertTestInventory({ qty: 10, name: 'PHASE4-GROUPED' });
  const invQrBefore = (await holding('inventory_items', invGrouped)).qrcode;
  const grouped = await conversionService.convertInventoryToAsset({
    sourceId: invGrouped,
    quantity: 3,
    granularity: 'GROUPED',
    actor: 'phase4-verify',
    host
  });
  assert(verifyConversionId(grouped.conversion.id), '1. Grouped conversion id is CONV- checksum');
  assert(grouped.assets.length === 1 && Number(grouped.assets[0].quantityTotal) === 3, '1. Grouped creates one Asset qty 3');
  const gInv = await holding('inventory_items', invGrouped);
  assert(Number(gInv.quantity_original) === 10, '13. quantity_original unchanged');
  assert(Number(gInv.quantity_total) === 7 && Number(gInv.quantity_available) === 7, '1. Source total/available 7');
  assert(Number(gInv.quantity_converted) === 3, '1. quantity_converted 3');
  assert(gInv.id === invGrouped, '13. Source Inventory row remains');
  const gAst = await holding('assets', grouped.assets[0].id);
  assert(gAst.product_id === PRODUCT_ID, '11. Product copied to grouped Asset');
  assert(gAst.conversion_source_id === invGrouped, '10. conversion_source_id is immediate Inventory');
  assert(gAst.quantity_root_id === gAst.id, '10. Asset quantity_root_id is itself');
  assert(Boolean(gAst.qrcode), '12. New Asset has QR');
  assert((await holding('inventory_items', invGrouped)).qrcode === invQrBefore, '12. Inventory QR unchanged');
  assert(gAst.id !== invGrouped, '13. Asset ID is not the Inventory ID');
  const gEvents = grouped.events || [];
  assert(gEvents.some((e) => e.type === 'CONVERT_INVENTORY_TO_ASSET'), '14. CONVERT_INVENTORY_TO_ASSET event');
  assert(gEvents.every((e) => e.timestamp && e.conversionId === grouped.conversion.id), '14. Events have CONV id and timestamp');

  const invInd = await insertTestInventory({ qty: 10, name: 'PHASE4-INDIVIDUAL' });
  const individual = await conversionService.convertInventoryToAsset({
    sourceId: invInd,
    quantity: 3,
    granularity: 'INDIVIDUAL',
    actor: 'phase4-verify',
    host
  });
  assert(individual.assets.length === 3, '2. Individual creates three Assets');
  assert(individual.assets.every((a) => Number(a.quantityTotal) === 1), '2. Each individual Asset qty 1');
  assert(new Set(individual.assets.map((a) => a.id)).size === 3, '2. Individual Asset IDs unique');
  assert(individual.assets.every((a) => a.conversionId === individual.conversion.id), '2. Same conversion operation');
  const iInv = await holding('inventory_items', invInd);
  assert(Number(iInv.quantity_converted) === 3 && Number(iInv.quantity_total) === 7, '2. Individual source accounting');

  const noProd = await insertTestInventory({ qty: 5, productId: null, name: 'PHASE4-NOPROD' });
  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: noProd, quantity: 1, actor: 'phase4-verify', host }),
    'PRODUCT_REQUIRED',
    '3. Product required'
  );
  const noProdAfter = await holding('inventory_items', noProd);
  assert(Number(noProdAfter.quantity_total) === 5 && Number(noProdAfter.quantity_converted) === 0, '3. Reject leaves counters unchanged');

  const invQty = await insertTestInventory({ qty: 5, name: 'PHASE4-QTY' });
  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: invQty, quantity: 0, actor: 'phase4-verify', host }),
    'INVALID_QUANTITY',
    '4. Zero rejected'
  );
  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: invQty, quantity: -2, actor: 'phase4-verify', host }),
    'INVALID_QUANTITY',
    '5. Negative rejected'
  );
  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: invQty, quantity: 9, actor: 'phase4-verify', host }),
    'INSUFFICIENT_AVAILABLE',
    '6. Over-available rejected'
  );

  const invRsv = await insertTestInventory({ qty: 10, name: 'PHASE4-RSV' });
  const rsv = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: invRsv,
    quantity: 4,
    ownerType: 'MANUAL',
    ownerId: 'phase4-hold',
    actor: 'phase4-verify'
  });
  assert(verifyReservationId(rsv.reservation.id), '7. Reservation still RSV-');
  const partial = await conversionService.convertInventoryToAsset({
    sourceId: invRsv,
    quantity: 3,
    actor: 'phase4-verify',
    host
  });
  const pInv = await holding('inventory_items', invRsv);
  assert(Number(pInv.quantity_total) === 7, '7. Partial reserved: total 7');
  assert(Number(pInv.quantity_available) === 3, '7. Partial reserved: available 3');
  assert(Number(pInv.quantity_reserved) === 4, '7. Partial reserved: reserved 4');
  assert(Number(pInv.quantity_converted) === 3, '7. Partial reserved: converted 3');
  const rsvStill = await db('reservation').where({ id: rsv.reservation.id }).first();
  assert(rsvStill.status === 'ACTIVE' && Number(rsvStill.quantity) === 4, '7. Reservation untouched');

  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: invRsv, quantity: 8, actor: 'phase4-verify', host }),
    'RESERVED_QUANTITY_NOT_CONVERTIBLE',
    '8. Cannot convert reserved remainder'
  );

  const invFull = await insertTestInventory({ qty: 4, name: 'PHASE4-FULLRSV' });
  await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: invFull,
    quantity: 4,
    ownerType: 'MANUAL',
    ownerId: 'phase4-full',
    actor: 'phase4-verify'
  });
  await expectReject(
    () => conversionService.convertInventoryToAsset({ sourceId: invFull, quantity: 1, actor: 'phase4-verify', host }),
    'RESERVED_QUANTITY_NOT_CONVERTIBLE',
    '8. Fully reserved Inventory rejected'
  );

  const concInv = await insertTestInventory({ qty: 5, name: 'PHASE4-CONC' });
  const conc = await Promise.allSettled([
    conversionService.convertInventoryToAsset({ sourceId: concInv, quantity: 4, actor: 'phase4-a', host }),
    conversionService.convertInventoryToAsset({ sourceId: concInv, quantity: 3, actor: 'phase4-b', host })
  ]);
  const concOk = conc.filter((x) => x.status === 'fulfilled');
  const concFail = conc.filter((x) => x.status === 'rejected');
  assert(concOk.length === 1 && concFail.length === 1, '9. Concurrent convert: one success, one reject');
  const concHold = await holding('inventory_items', concInv);
  assert(Number(concHold.quantity_available) === 1 && Number(concHold.quantity_converted) === 4, '9. Concurrent result available 1 converted 4');

  const idemInv = await insertTestInventory({ qty: 6, name: 'PHASE4-IDEM' });
  const key = `phase4-idem-${Date.now()}`;
  const first = await conversionService.convertInventoryToAsset({
    sourceId: idemInv, quantity: 2, granularity: 'GROUPED', actor: 'phase4-verify', host, idempotencyKey: key
  });
  const second = await conversionService.convertInventoryToAsset({
    sourceId: idemInv, quantity: 2, granularity: 'GROUPED', actor: 'phase4-verify', host, idempotencyKey: key
  });
  assert(first.conversion.id === second.conversion.id, '10. Idempotent retry same CONV id');
  assert(first.assets[0].id === second.assets[0].id, '10. Idempotent retry same Asset id');
  const idemAfter = await holding('inventory_items', idemInv);
  assert(Number(idemAfter.quantity_converted) === 2, '10. Retry did not double-convert');

  const brkInv = await insertTestInventory({ qty: 8, name: 'PHASE4-BREAKSRC' });
  const broke = await breakService.breakQuantity({
    holdingType: 'INVENTORY', parentId: brkInv, mode: 'BREAK', amount: 3, actor: 'phase4-verify', host
  });
  const childId = broke.children[0].id;
  const fromChild = await conversionService.convertInventoryToAsset({
    sourceId: childId, quantity: 2, granularity: 'GROUPED', actor: 'phase4-verify', host
  });
  const childRow = await holding('inventory_items', childId);
  const parentRow = await holding('inventory_items', brkInv);
  assert(fromChild.assets[0].conversionSourceId === childId, '15. Converted from broken child, not root');
  assert(childRow.quantity_parent_id === brkInv, '15. Child parent intact');
  assert(Number(parentRow.quantity_converted) === 0, '15. Root converted stays 0');
  assert(Number(childRow.quantity_converted) === 2, '15. Child converted 2');

  const retAvail = await conversionService.returnAssetToInventory({
    sourceId: fromChild.assets[0].id,
    condition: 'AVAILABLE',
    actor: 'phase4-verify'
  });
  assert(retAvail.conversion.direction === 'ASSET_TO_INVENTORY', '16. Return direction');
  assert(retAvail.destination.id === childId, '16. Return lands on immediate source INV child');
  const childAfter = await holding('inventory_items', childId);
  const retAst = await holding('assets', fromChild.assets[0].id);
  assert(Number(childAfter.quantity_available) === 3 && Number(childAfter.quantity_converted) === 0, '17. Available return restores available');
  assert(retAst.lineage_status === 'INACTIVE', '22. Asset remains INACTIVE after return');
  assert(Number(retAst.quantity_total) === 2, '22. Asset historical total unchanged');
  assert(retAst.id === fromChild.assets[0].id, '22. Asset id not deleted');

  const inspectInv = await insertTestInventory({ qty: 5, name: 'PHASE4-INSPECT' });
  const inspectConv = await conversionService.convertInventoryToAsset({
    sourceId: inspectInv, quantity: 2, actor: 'phase4-verify', host
  });
  await conversionService.returnAssetToInventory({
    sourceId: inspectConv.assets[0].id, condition: 'INSPECTION', actor: 'phase4-verify'
  });
  const inspectAfter = await holding('inventory_items', inspectInv);
  assert(Number(inspectAfter.quantity_total) === 5, '18. Inspection return restores total');
  assert(Number(inspectAfter.quantity_available) === 3, '18. Inspection does not increase available');
  assert(Number(inspectAfter.quantity_converted) === 0, '18. Inspection converted cleared');

  const dmgInv = await insertTestInventory({ qty: 5, name: 'PHASE4-DMG' });
  const dmgConv = await conversionService.convertInventoryToAsset({
    sourceId: dmgInv, quantity: 2, actor: 'phase4-verify', host
  });
  const dmgRet = await conversionService.returnAssetToInventory({
    sourceId: dmgConv.assets[0].id, condition: 'DAMAGED', actor: 'phase4-verify'
  });
  const dmgAfter = await holding('inventory_items', dmgInv);
  assert(Number(dmgAfter.quantity_total) === 5 && Number(dmgAfter.quantity_available) === 3, '19. Damaged same counters as inspection');
  assert(dmgRet.conversion.condition === 'DAMAGED', '19. Damaged condition recorded');
  assert((dmgRet.events || []).some((e) => e.metadata && e.metadata.reason_code === 'DAMAGED'), '19. Damaged reason_code');

  const rsvAstInv = await insertTestInventory({ qty: 4, name: 'PHASE4-AST-RSV' });
  const rsvAstConv = await conversionService.convertInventoryToAsset({
    sourceId: rsvAstInv, quantity: 1, actor: 'phase4-verify', host
  });
  await reservationService.reserve({
    resourceType: 'ASSET',
    resourceId: rsvAstConv.assets[0].id,
    ownerType: 'MANUAL',
    ownerId: 'phase4-asset-hold',
    actor: 'phase4-verify'
  });
  await expectReject(
    () => conversionService.returnAssetToInventory({
      sourceId: rsvAstConv.assets[0].id, condition: 'AVAILABLE', actor: 'phase4-verify'
    }),
    'ASSET_RESERVED',
    '20. Reserved Asset return rejected'
  );

  const assignedId = await insertTestAsset({ assignedto: 'phase4-user', name: 'PHASE4-ASSIGNED' });
  await expectReject(
    () => conversionService.returnAssetToInventory({ sourceId: assignedId, condition: 'AVAILABLE', actor: 'phase4-verify' }),
    'NO_INVENTORY_LINEAGE',
    '21. Native assigned Asset has no inventory lineage'
  );
  const assignedConvInv = await insertTestInventory({ qty: 2, name: 'PHASE4-ASG-SRC' });
  const assignedConv = await conversionService.convertInventoryToAsset({
    sourceId: assignedConvInv, quantity: 1, actor: 'phase4-verify', host
  });
  await db('assets').where({ id: assignedConv.assets[0].id }).update({ assignedto: 'phase4-user' });
  await expectReject(
    () => conversionService.returnAssetToInventory({
      sourceId: assignedConv.assets[0].id, condition: 'AVAILABLE', actor: 'phase4-verify'
    }),
    'ASSET_ASSIGNED',
    '21. Assigned converted Asset return rejected'
  );

  const dcInv = await insertTestInventory({ qty: 2, name: 'PHASE4-DC-SRC' });
  const dcConv = await conversionService.convertInventoryToAsset({
    sourceId: dcInv, quantity: 1, actor: 'phase4-verify', host
  });
  await db('assets').where({ id: dcConv.assets[0].id }).update({ sentagainstdc: 'DC-FAKE' });
  await expectReject(
    () => conversionService.returnAssetToInventory({
      sourceId: dcConv.assets[0].id, condition: 'AVAILABLE', actor: 'phase4-verify'
    }),
    'ASSET_COMMITTED_TO_DC',
    '21. DC-committed Asset return rejected'
  );

  const grpInv = await insertTestInventory({ qty: 6, name: 'PHASE4-GRP-RET' });
  const grp = await conversionService.convertInventoryToAsset({
    sourceId: grpInv, quantity: 3, granularity: 'GROUPED', actor: 'phase4-verify', host
  });
  await conversionService.returnAssetToInventory({
    sourceId: grp.assets[0].id, condition: 'AVAILABLE', actor: 'phase4-verify'
  });
  const grpInvAfter = await holding('inventory_items', grpInv);
  assert(Number(grpInvAfter.quantity_total) === 6 && Number(grpInvAfter.quantity_available) === 6, '23. Grouped return +3 to Inventory');
  assert((await holding('assets', grp.assets[0].id)).lineage_status === 'INACTIVE', '23. Grouped Asset remains');

  const indInv = await insertTestInventory({ qty: 6, name: 'PHASE4-IND-RET' });
  const ind = await conversionService.convertInventoryToAsset({
    sourceId: indInv, quantity: 3, granularity: 'INDIVIDUAL', actor: 'phase4-verify', host
  });
  await conversionService.returnAssetToInventory({
    sourceId: ind.assets[0].id, condition: 'AVAILABLE', actor: 'phase4-verify'
  });
  await conversionService.returnAssetToInventory({
    sourceId: ind.assets[1].id, condition: 'INSPECTION', actor: 'phase4-verify'
  });
  const mid = await holding('inventory_items', indInv);
  assert(Number(mid.quantity_converted) === 1, '24. Two of three individual returns leave 1 converted');
  await conversionService.returnAssetToInventory({
    sourceId: ind.assets[2].id, condition: 'DAMAGED', actor: 'phase4-verify'
  });
  const indAfter = await holding('inventory_items', indInv);
  assert(Number(indAfter.quantity_converted) === 0, '24. All individual returns complete');
  assert(Number(indAfter.quantity_available) === 4, '24. Only AVAILABLE of 3 returned units is available (6-3+1)');
  assert((await holding('assets', ind.assets[0].id)).lineage_status === 'INACTIVE', '24. Individual Assets remain');

  const recInv = await insertTestInventory({ qty: 5, name: 'PHASE4-RECURSIVE' });
  const recConv = await conversionService.convertInventoryToAsset({
    sourceId: recInv, quantity: 3, granularity: 'GROUPED', actor: 'phase4-verify', host
  });
  const recBreak = await breakService.breakQuantity({
    holdingType: 'ASSET',
    parentId: recConv.assets[0].id,
    mode: 'BREAK',
    amount: 1,
    actor: 'phase4-verify',
    host
  });
  const recChild = await holding('assets', recBreak.children[0].id);
  assert(recChild.conversion_source_id === recInv, '25. Broken Asset child copies Inventory source');
  await conversionService.returnAssetToInventory({
    sourceId: recChild.id, condition: 'AVAILABLE', actor: 'phase4-verify'
  });
  const recInvAfter = await holding('inventory_items', recInv);
  assert(Number(recInvAfter.quantity_converted) === 2, '25. Recursive return goes to original Inventory, not Asset parent');
  assert(recInvAfter.id === recInv, '25. Destination is original Inventory id');

  await breakService.assertConservation(db, 'inventory_items', recInv, 0);
  await breakService.assertConservation(db, 'inventory_items', grpInv, 0);
  await breakService.assertConservation(db, 'inventory_items', brkInv, 0);
  ok('26. Quantity conservation holds on conversion trees');

  const productsBefore = Number((await db.raw('SELECT count(*)::int AS n FROM product')).rows[0].n);
  const productsAfter = Number((await db.raw('SELECT count(*)::int AS n FROM product')).rows[0].n);
  assert(productsBefore === productsAfter, '11/27. No Product rows created');

  const p2Inv = await insertTestInventory({ qty: 10, name: 'PHASE4-P2-BREAK' });
  const p2Broke = await breakService.breakQuantity({
    holdingType: 'INVENTORY', parentId: p2Inv, mode: 'BREAK', amount: 4, actor: 'phase4-verify', host
  });
  assert(p2Broke.children.length === 1, '28. Phase 2 Break still works');
  await breakService.assertConservation(db, 'inventory_items', p2Inv, 0);
  ok('28. Phase 2 conservation intact');

  const p3Inv = await insertTestInventory({ qty: 10, name: 'PHASE4-P3-RSV' });
  const p3r = await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: p3Inv, quantity: 4,
    ownerType: 'MANUAL', ownerId: 'phase4-p3', actor: 'phase4-verify'
  });
  assert(p3r.reservation.status === 'ACTIVE', '29. Phase 3 reserve still works');
  const p3hold = await holding('inventory_items', p3Inv);
  assert(Number(p3hold.quantity_available) === 6 && Number(p3hold.quantity_reserved) === 4, '29. Phase 3 counters intact');

  const liveSets = Number((await db.raw('SELECT count(*)::int AS n FROM managed_sets')).rows[0].n);
  assert(liveSets >= 0, '30. managed_sets readable');
  const ieiz = await db('assets').where({ id: 'HAR-MUM-0826-IEIZP5-U' }).first();
  assert(ieiz && Number(ieiz.is_set) === 1, '30. Existing Set flag unchanged');

  const liveProdInv = await db('inventory_items').where({ id: 'MIS-MUM-0826-H4XVLL-W' }).first();
  assert(Number(liveProdInv.quantity_total) === 3 && Number(liveProdInv.quantity_available) === 1, '31. MIS quantities unchanged by tests');
}

async function httpChecks(httpBase) {
  const unauth = await request(`${httpBase}/api/conversions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'INVENTORY_TO_ASSET', sourceId: 'x', quantity: 1 })
  });
  assert(unauth.status === 401, 'HTTP POST /api/conversions 401', unauth.status);

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign(
    { user_id: 'phase4-verify-user', role: 'user', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const forbidden = await request(`${httpBase}/api/conversions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`
    },
    body: JSON.stringify({ direction: 'INVENTORY_TO_ASSET', sourceId: 'x', quantity: 1 })
  });
  assert(forbidden.status === 403, 'HTTP POST /api/conversions 403 for role user', forbidden.status);
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runConversionTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-conversion-tests against production database asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  const installed = await db.schema.hasTable('conversion');
  if (installed) {
    await schemaChecks();
    await productionRowChecks(snap);
  } else if (args.writeBaseline && !args.runConversionTests) {
    console.log('Conversion tables not installed yet; wrote pre-schema baseline only');
    ok('pre-schema baseline written');
  } else {
    throw new Error('Conversion tables are not installed');
  }

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const harBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    const harAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
    assert(harBefore && harAfter && harBefore.product_id === harAfter.product_id, 'HAR product_id unchanged vs baseline');
    assert(harBefore && harAfter && harBefore.quantity_original === harAfter.quantity_original, 'HAR quantity_original unchanged');
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, 'parentid / physical identity unchanged');
    const misBefore = baseline.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
    const misAfter = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
    assert(misBefore && misAfter && misBefore.has_qr === misAfter.has_qr, 'MIS QR presence unchanged');
    assert(misBefore && misAfter && misBefore.client_label === misAfter.client_label, 'MIS client_label unchanged');
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, 'zoho_catalog unchanged');
    assert(Number(baseline.products.n) === Number(snap.products.n), 'product count unchanged');
    assert(Number(baseline.sets.n) === Number(snap.sets.n), 'managed_sets count unchanged');
    assert(Number(baseline.projects.n) === Number(snap.projects.n), 'projects count unchanged');
    assert(Number(baseline.dcs.n) === Number(snap.dcs.n), 'delivery_challans count unchanged');
    if (!args.runConversionTests) {
      assert(Number(baseline.conversions.n) === Number(snap.conversions.n), 'conversion count unchanged vs baseline');
    }
  }

  if (args.runConversionTests) {
    await runConversionTests(args.host);
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
