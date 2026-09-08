/**
 * Physical Intake verification.
 *
 * Scratch mutations:
 *   node scripts/physical-intake-verify.js --database-name asset_manager_physical_intake_scratch --run-tests
 *   node scripts/physical-intake-verify.js --database-name asset_manager_physical_intake_scratch --run-tests --run-phase-regression
 *
 * Production (no physical writes):
 *   node scripts/physical-intake-verify.js --database-name asset_manager --write-baseline ./scripts/reports/physical-intake-prod-before.json --http-base http://127.0.0.1:8080
 *   node scripts/physical-intake-verify.js --database-name asset_manager --compare-baseline ./scripts/reports/physical-intake-prod-before.json
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
const {
  db,
  generateProductId,
  verifyProductId,
  generatePhysicalIntakeId,
  verifyPhysicalIntakeId,
  generateProcurementPoId,
  generateProcurementPoLineId
} = require('../utils');
const physicalIntakeService = require('../services/physicalIntakeService');
const commercialProvenanceService = require('../services/commercialProvenanceService');
const procurementService = require('../services/procurementService');
const IdGenerator = require('../IdGenerator');

const failures = [];
const passes = [];
const HOST = '127.0.0.1:8080';
const ACTOR = 'physical-intake-verify';
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

function parseJson(text) {
  try { return JSON.parse(text); } catch (err) { return {}; }
}

async function currentDbName() {
  return (await db.raw('SELECT current_database() AS name')).rows[0].name;
}

async function countOrZero(sql) {
  try {
    const row = (await db.raw(sql)).rows[0];
    return Number(row && row.n != null ? row.n : 0);
  } catch (err) {
    return 0;
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
      physical_intake_id: row.physical_intake_id || null,
      receipt_line_id: row.receipt_line_id || null
    } : null;
  }
  return {
    db: await currentDbName(),
    at: new Date().toISOString(),
    protectedHoldings,
    counts: {
      assets: await countOrZero('SELECT COUNT(*)::int AS n FROM assets'),
      inventory: await countOrZero('SELECT COUNT(*)::int AS n FROM inventory_items'),
      products: await countOrZero('SELECT COUNT(*)::int AS n FROM product'),
      reservations: await countOrZero('SELECT COUNT(*)::int AS n FROM reservation'),
      conversions: await countOrZero("SELECT COUNT(*)::int AS n FROM conversion"),
      sets: await countOrZero('SELECT COUNT(*)::int AS n FROM managed_sets'),
      receipts: await countOrZero('SELECT COUNT(*)::int AS n FROM receipt_note'),
      pos: await countOrZero('SELECT COUNT(*)::int AS n FROM procurement_po'),
      intakes: await countOrZero('SELECT COUNT(*)::int AS n FROM physical_intake'),
      provenance: await countOrZero('SELECT COUNT(*)::int AS n FROM commercial_provenance'),
      dcs: await countOrZero('SELECT COUNT(*)::int AS n FROM dc')
    }
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
  const piSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/physical-intakes.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const dashSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/dashboard.js'), 'utf8');
  const invSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/inventory.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/index.html'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/main.js'), 'utf8');
  const opsSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/operations.js'), 'utf8');
  const prodSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/products.js'), 'utf8');
  const zohoSrc = fs.readFileSync(path.join(__dirname, '../services/zohoService.js'), 'utf8');
  const p0Src = fs.readFileSync(path.join(__dirname, '../scripts/p0-lifecycle-containment-verify.js'), 'utf8');

  assert(serverSrc.includes('PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED'), 'direct Asset/Inventory POST still contained');
  assert(/app\.post\('\/api\/physical-intakes', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), 'POST /api/physical-intakes JWT+roles');
  assert(/app\.post\('\/api\/physical-intakes\/link-po', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), 'POST /api/physical-intakes/link-po JWT+roles');
  assert(piSrc.includes('Purchase Order Status'), 'UI Purchase Order Status control');
  assert(piSrc.includes('PO Expected Later') && piSrc.includes('No PO Required') && piSrc.includes('Purchase Order Already Available'), 'UI PO status labels');
  assert(piSrc.includes('defaultPoStatusForType'), 'UI intake-type defaults');
  assert(!piSrc.includes('Expecting POs'), 'no Dashboard Expecting POs card in intake UI');
  assert(!opsSrc.includes("stageCard('Expecting POs'"), 'no Dashboard Expecting POs card');
  assert(/app\.post\('\/api\/assets', authenticateJWT, authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), 'POST /api/assets still JWT+roles contained');
  assert(indexSrc.includes('+ Physical Intake'), 'UI Physical Intake control');
  assert(indexSrc.includes('registered outside procurement') || indexSrc.includes('Register existing / non-procurement'), 'UI non-procurement copy');
  assert(indexSrc.includes('This stock came through procurement') || indexSrc.includes('came through procurement'), 'UI receipt distinction');
  assert(indexSrc.includes('physical-intakes-view'), 'physical-intakes-view present');
  assert(dashSrc.includes('physical-intakes-view'), 'dashboard opens Physical Intake');
  assert(invSrc.includes('physical-intakes-view') || invSrc.includes('nav-physical-intakes'), 'inventory opens Physical Intake');
  assert(indexSrc.includes('+ Physical Intake') && indexSrc.includes('btnAddAssetItem'), 'Add Asset control replaced with Physical Intake');
  assert(!indexSrc.includes('>Add Asset<'), 'Add Asset submit label removed');
  assert(indexSrc.includes('main.js?v=7.49'), 'index.html cache 7.49');
  assert(mainSrc.includes('physical-intakes.js?v=7.48'), 'main.js imports physical-intakes');
  assert(mainSrc.includes("operations.js?v=7.41"), 'main.js imports operations 7.41');
  assert(mainSrc.includes('products.js?v=7.46'), 'main.js imports products 7.46');
  assert(indexSrc.includes('id="zohoCatalogSearch"'), 'Products has Zoho catalog search');
  assert(indexSrc.includes('Search Zoho Product Catalog'), 'Zoho catalog search label');
  assert(indexSrc.includes('id="btnOpenZohoCatalog"'), 'Zoho catalog opens from toolbar button');
  assert(/id="zohoCatalogSection"[^>]*class="[^"]*\bhidden\b/.test(indexSrc), 'Zoho catalog section starts hidden');
  assert(zohoSrc.includes('GetRecordsParam.PER_PAGE') && zohoSrc.includes('getMoreRecords'), 'catalog pull paginates Zoho Products');
  assert(prodSrc.includes("api('/api/zoho/catalog')"), 'Products catalog reuses GET /api/zoho/catalog');
  assert(prodSrc.includes('No matching Zoho Reference Catalog records found.') || prodSrc.includes('No matching Zoho Products.'), 'Zoho catalog empty search copy');
  assert(prodSrc.includes('focusZohoCatalogInProducts') && prodSrc.includes('setCatalogPanelOpen(true)'), 'sidebar catalog opens the Products catalog panel');
  assert(dashSrc.includes('focusZohoCatalogInProducts'), 'sidebar catalog points at Products workspace');
  assert(!dashSrc.includes("currentInventorySidebar = { type: 'catalog' }"), 'sidebar catalog does not leave Inventory in catalog mode');
  assert(invSrc.includes('state.catalogMode = false') && invSrc.includes('state.consumedMode = false'), 'Inventory nav resets catalog mode');
  assert(opsSrc.includes("lifecycleApi('/api/assets?all=true')"), 'Dashboard Holdings reads /api/assets');
  assert(opsSrc.includes('stockHoldings('), 'Dashboard Holdings uses holdings helper');
  assert(!opsSrc.includes('(window.assets || []).length'), 'Dashboard Holdings does not use window.assets');
  assert(opsSrc.includes("stageCard('Holdings', stockCount"), 'Dashboard metric label is Holdings');
  assert(!opsSrc.includes("stageCard('Stock', stockCount"), 'Dashboard metric label is not Stock');
  assert(opsSrc.includes('productsCardHtml('), 'Dashboard Products card is the four-stat catalogue card');
  assert(opsSrc.includes("stageCard('PO Waitlist'"), 'Dashboard PO card is waitlist, not total PO count');
  assert(!opsSrc.includes("stageCard('Product', productRows.length"), 'Dashboard no longer uses Product count card');
  assert(!opsSrc.includes("stageCard('PO', poRows.length"), 'Dashboard no longer uses total PO count card');
  assert(opsSrc.includes("stageCard('Receiving', openRn.length"), 'Receiving card unchanged');
  assert(opsSrc.includes("stageCard('Reservation', resRows.length"), 'Reservation card unchanged');
  assert(opsSrc.includes("stageCard('Set', setRows.length"), 'Set card unchanged');
  assert(opsSrc.includes('gatherLifecycleFeed({ limit: 5 })'), 'Dashboard activity uses existing history feed');
  assert(opsSrc.includes('canOpenAppView('), 'Dashboard hides unauthorized modules instead of showing zero');
  assert(indexSrc.includes('id="nav-operations">Dashboard</a>'), 'Dashboard nav label');
  assert(!/id="nav-operations">Today</.test(indexSrc), 'Today is not the Dashboard nav label');
  assert(/id="nav-operations">Dashboard<\/a>[\s\S]*id="nav-products">Products<\/a>[\s\S]*id="nav-history">History<\/a>[\s\S]*id="nav-reservations">Reservations<\/a>[\s\S]*id="nav-purchase-orders">Purchase Orders<\/a>[\s\S]*id="nav-receipts">Receipt Notes<\/a>[\s\S]*id="nav-dc">Create DC<\/a>/.test(indexSrc), 'Logistics dropdown order');
  assert(p0Src.includes('PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED'), 'P0 harness still asserts containment');
  assert(verifyPhysicalIntakeId(generatePhysicalIntakeId()), 'INTAKE id verifies');
  assert(IdGenerator.verifyPhysicalIntakeId(IdGenerator.generatePhysicalIntakeId()), 'IdGenerator INTAKE checksum');
  assert(!verifyPhysicalIntakeId('APP-MUM-0526-MMKBX9-W'), 'physical ID is not an INTAKE id');
}

async function insertTestProduct(name) {
  const id = generateProductId();
  if (!verifyProductId(id)) throw new Error('bad product id');
  await db('product').insert({
    id,
    name,
    unit: 'Nos',
    make: 'Hardware',
    model: 'PI-TEST',
    status: 'ACTIVE',
    origin: 'ASSETENGINE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: ACTOR
  });
  return id;
}

async function insertTestPo({ productId, mapped = true, ordered = 10, status = 'APPROVED', lineStatus = 'OPEN' }) {
  const poId = generateProcurementPoId();
  const lineId = generateProcurementPoLineId();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db('procurement_po').insert({
    id: poId,
    source: 'ZOHO',
    classification: 'CANONICAL',
    zoho_po_id: `PI-PROV-${stamp}`,
    po_number: `PO-PI-${stamp}`,
    subject: 'Physical Intake provenance test',
    status,
    vendor_zoho_id: 'V-PI-TEST',
    vendor_name_snapshot: 'PI Test Vendor',
    created_by: ACTOR,
    updated_by: ACTOR,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  await db('procurement_po_line').insert({
    id: lineId,
    procurement_po_id: poId,
    zoho_line_id: `ZL-PI-${stamp}`,
    product_id: mapped ? productId : null,
    description: 'provenance test line',
    ordered_qty: ordered,
    unit: 'Nos',
    line_status: lineStatus,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return { poId, lineId };
}

async function runProvenanceTests({ productId, before, assetOut }) {
  const otherProductId = await insertTestProduct(`PI-PROV-OTHER-${Date.now()}`);

  const extDefault = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'EXTERNAL_ACQUISITION',
    productId,
    quantity: 1,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    source: { sourceDocument: 'EXT-DEFAULT' }
  });
  assert(extDefault.commercialProvenance && extDefault.commercialProvenance.state === 'AWAITING_PO', '1. External Acquisition default AWAITING_PO');
  assert((extDefault.events || []).some((e) => e.type === 'PO_EXPECTED'), '11. PO_EXPECTED event');

  const extOverride = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'EXTERNAL_ACQUISITION',
    productId,
    quantity: 1,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'NOT_REQUIRED',
    source: { sourceDocument: 'EXT-OVERRIDE' }
  });
  assert(extOverride.commercialProvenance && extOverride.commercialProvenance.state === 'NOT_REQUIRED', '2. External Acquisition override NOT_REQUIRED');

  const donationDefault = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'INVENTORY',
    intakeType: 'DONATION',
    productId,
    quantity: 3,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    source: { donor: 'Donor A' }
  });
  assert(donationDefault.commercialProvenance && donationDefault.commercialProvenance.state === 'NOT_REQUIRED', '3. Donation default NOT_REQUIRED');

  const donationOverride = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'INVENTORY',
    intakeType: 'DONATION',
    productId,
    quantity: 2,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'EXPECTED',
    expectedPoNumber: 'PO-NOTE-ONLY',
    expectedVendorRef: 'Vendor note',
    source: { donor: 'Donor B' }
  });
  assert(donationOverride.commercialProvenance && donationOverride.commercialProvenance.state === 'AWAITING_PO', '4. Donation override AWAITING_PO');
  assert(donationOverride.commercialProvenance.expectedPoNumber === 'PO-NOTE-ONLY', 'expected PO number is metadata');
  assert(!donationOverride.commercialProvenance.procurementPoId, 'expected PO number is not a PO relationship');

  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET',
      intakeType: 'OTHER_APPROVED',
      productId,
      quantity: 1,
      unit: 'Nos',
      actor: ACTOR,
      host: HOST,
      reason: 'Approved exception without PO status'
    }),
    'PO_STATUS_REQUIRED',
    '5. Other Approved blocked until PO status chosen'
  );

  const internal = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'INTERNAL_TRANSFER',
    productId,
    quantity: 1,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    source: { sourceLocation: 'Warehouse A' }
  });
  assert(internal.commercialProvenance && internal.commercialProvenance.state === 'NOT_REQUIRED', '6. Internal Transfer default NOT_REQUIRED');

  const mapped = await insertTestPo({ productId, mapped: true, ordered: 25 });
  const rnBeforeLink = await countOrZero('SELECT COUNT(*)::int AS n FROM receipt_note');
  const rsvBeforeLink = await countOrZero('SELECT COUNT(*)::int AS n FROM reservation');
  const dcBeforeLink = await countOrZero('SELECT COUNT(*)::int AS n FROM dc');
  const ledgerBefore = await procurementService.qtyLedger(db, mapped.lineId);
  const qtyBefore = procurementService.lineQuantities(25, ledgerBefore);

  const linkedKey = `pi-linked-${Date.now()}`;
  const already = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'DONATION',
    productId,
    quantity: 4,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'AVAILABLE',
    procurementPoId: mapped.poId,
    procurementPoLineId: mapped.lineId,
    source: { donor: 'Already available' },
    idempotencyKey: linkedKey
  });
  const alreadyOut = (already.outputs || [])[0] || already.created;
  assert(already.commercialProvenance && already.commercialProvenance.state === 'PO_LINKED', '7. PO Already Available → PO_LINKED');
  assert(already.commercialProvenance.procurementPoId === mapped.poId, '7. stores procurement_po_id');
  assert(already.commercialProvenance.procurementPoLineId === mapped.lineId, '7. stores procurement_po_line_id');
  assert((already.events || []).some((e) => e.type === 'PO_LINKED'), '11. PO_LINKED event at registration');
  const alreadyAsset = await db('assets').where({ id: alreadyOut.resourceId }).first();
  assert(alreadyAsset && !alreadyAsset.receipt_line_id, '14. linkage did not set receipt_line_id');
  assert(Number(alreadyAsset.quantity_total) === 4, '14. physical quantity unchanged by PO link at create');

  const replayLinked = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'DONATION',
    productId,
    quantity: 4,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'AVAILABLE',
    procurementPoId: mapped.poId,
    procurementPoLineId: mapped.lineId,
    source: { donor: 'Already available' },
    idempotencyKey: linkedKey
  });
  assert(replayLinked.id === already.id, '15. idempotent replay same linked intake');
  const linkedAssetCount = await db('assets').where({ physical_intake_id: already.id }).count('id as n').first();
  assert(Number(linkedAssetCount.n) === 1, '15. replay did not create a second holding');
  const provCount = await db('commercial_provenance').where({ resource_type: 'ASSET', resource_id: alreadyOut.resourceId }).count('id as n').first();
  assert(Number(provCount.n) === 1, '15. replay did not create a second provenance row');

  const awaiting = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'INVENTORY',
    intakeType: 'EXTERNAL_ACQUISITION',
    productId,
    quantity: 5,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'EXPECTED',
    source: { sourceDocument: 'AWAIT-LINK' }
  });
  assert(awaiting.commercialProvenance && awaiting.commercialProvenance.state === 'AWAITING_PO', '8. PO Expected Later → AWAITING_PO');
  const awaitOut = (awaiting.outputs || [])[0] || awaiting.created;
  const invBefore = await db('inventory_items').where({ id: awaitOut.resourceId }).first();

  const postLink = await commercialProvenanceService.linkPurchaseOrder({
    resourceType: 'INVENTORY',
    resourceId: awaitOut.resourceId,
    procurementPoId: mapped.poId,
    procurementPoLineId: mapped.lineId,
    actor: ACTOR
  });
  assert(postLink && postLink.state === 'PO_LINKED', '10. post-intake linkage → PO_LINKED');
  const invAfter = await db('inventory_items').where({ id: awaitOut.resourceId }).first();
  assert(Number(invAfter.quantity_total) === Number(invBefore.quantity_total), '14. linkage did not change physical quantity');
  assert(String(invAfter.receipt_line_id || '') === String(invBefore.receipt_line_id || ''), '14. linkage did not set receipt_line_id');

  const replayLink = await commercialProvenanceService.linkPurchaseOrder({
    resourceType: 'INVENTORY',
    resourceId: awaitOut.resourceId,
    procurementPoId: mapped.poId,
    procurementPoLineId: mapped.lineId,
    actor: ACTOR
  });
  assert(replayLink.state === 'PO_LINKED' && replayLink.replayed, '15. same-line link replay is idempotent');

  const otherPo = await insertTestPo({ productId, mapped: true, ordered: 8 });
  await expectError(
    () => commercialProvenanceService.linkPurchaseOrder({
      resourceType: 'INVENTORY',
      resourceId: awaitOut.resourceId,
      procurementPoId: otherPo.poId,
      procurementPoLineId: otherPo.lineId,
      actor: ACTOR
    }),
    'ALREADY_LINKED',
    '11. duplicate linkage fails closed'
  );
  const afterDup = await db('commercial_provenance').where({ resource_type: 'INVENTORY', resource_id: awaitOut.resourceId }).count('id as n').first();
  assert(Number(afterDup.n) === 1, '11. no duplicate provenance');
  const invDupCount = await db('inventory_items').where({ id: awaitOut.resourceId }).count('id as n').first();
  assert(Number(invDupCount.n) === 1, '11. no duplicate physical holding');

  const mismatchPo = await insertTestPo({ productId: otherProductId, mapped: true, ordered: 6 });
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET',
      intakeType: 'DONATION',
      productId,
      quantity: 1,
      unit: 'Nos',
      actor: ACTOR,
      host: HOST,
      commercialPoChoice: 'AVAILABLE',
      procurementPoId: mismatchPo.poId,
      procurementPoLineId: mismatchPo.lineId,
      source: { donor: 'mismatch' }
    }),
    'PRODUCT_MISMATCH',
    '12. product mismatch fails'
  );

  const unmapped = await insertTestPo({ productId, mapped: false, ordered: 6 });
  try {
    await physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET',
      intakeType: 'DONATION',
      productId,
      quantity: 1,
      unit: 'Nos',
      actor: ACTOR,
      host: HOST,
      commercialPoChoice: 'AVAILABLE',
      procurementPoId: unmapped.poId,
      procurementPoLineId: unmapped.lineId,
      source: { donor: 'unmapped' }
    });
    fail('13. unmapped PO product fails', 'expected error');
  } catch (err) {
    assert(err.reasonCode === 'PRODUCT_MAPPING_REQUIRED', '13. unmapped PO product fails', err.reasonCode);
    assert(String(err.message || '').includes('Map the PO line to an AssetEngine Product before linking this intake.'), '13. mapping message');
  }

  const ledgerAfter = await procurementService.qtyLedger(db, mapped.lineId);
  const qtyAfter = procurementService.lineQuantities(25, ledgerAfter);
  assert(qtyAfter.accepted === qtyBefore.accepted, '14. PO accepted qty unchanged');
  assert(qtyAfter.outstanding === qtyBefore.outstanding, '14. PO outstanding unchanged');
  const rnAfterLink = await countOrZero('SELECT COUNT(*)::int AS n FROM receipt_note');
  const rsvAfterLink = await countOrZero('SELECT COUNT(*)::int AS n FROM reservation');
  const dcAfterLink = await countOrZero('SELECT COUNT(*)::int AS n FROM dc');
  assert(rnAfterLink === rnBeforeLink, '14. linkage did not create a Receipt Note');
  assert(rsvAfterLink === rsvBeforeLink, '14. linkage did not alter reservation');
  assert(dcAfterLink === dcBeforeLink, '14. linkage did not alter DC');

  const noPo = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'OPENING_BALANCE',
    productId,
    quantity: 1,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST,
    commercialPoChoice: 'NOT_REQUIRED',
    reason: 'explicit no po'
  });
  assert(noPo.commercialProvenance && noPo.commercialProvenance.state === 'NOT_REQUIRED', '9. No PO Required → NOT_REQUIRED');

  const awaitingMismatch = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'EXTERNAL_ACQUISITION',
    productId,
    quantity: 1,
    unit: 'Nos',
    actor: ACTOR,
    host: HOST
  });
  const awaitMismatchOut = (awaitingMismatch.outputs || [])[0] || awaitingMismatch.created;
  await expectError(
    () => commercialProvenanceService.linkPurchaseOrder({
      resourceType: 'ASSET',
      resourceId: awaitMismatchOut.resourceId,
      procurementPoId: mismatchPo.poId,
      procurementPoLineId: mismatchPo.lineId,
      actor: ACTOR
    }),
    'PRODUCT_MISMATCH',
    '12. post-intake product mismatch fails'
  );
  await expectError(
    () => commercialProvenanceService.linkPurchaseOrder({
      resourceType: 'ASSET',
      resourceId: awaitMismatchOut.resourceId,
      procurementPoId: unmapped.poId,
      procurementPoLineId: unmapped.lineId,
      actor: ACTOR
    }),
    'PRODUCT_MAPPING_REQUIRED',
    '13. post-intake unmapped PO product fails'
  );

  assert(assetOut && assetOut.resourceId, 'protected original asset output still present');
  void before;
}

async function expectError(fn, reason, name) {
  try {
    await fn();
    fail(name, 'expected error');
  } catch (err) {
    assert(err.reasonCode === reason, name, `${err.reasonCode} ${err.message}`);
  }
}

async function runMutationTests(before) {
  const productId = await insertTestProduct(`PI-VERIFY-${Date.now()}`);
  const keyAsset = `pi-asset-${Date.now()}`;
  const assetIntake = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'OPENING_BALANCE',
    productId,
    quantity: 2,
    unit: 'Nos',
    location: 'Mumbai',
    reason: 'Opening balance register',
    source: { openingBalanceNote: 'Opening balance register', legacyReference: 'LEG-OB-1' },
    actor: ACTOR,
    host: HOST,
    idempotencyKey: keyAsset
  });
  const assetOut = (assetIntake.outputs || [])[0] || assetIntake.created;
  assert(assetIntake.id && assetIntake.id.startsWith('INTAKE-'), '1. Asset intake creates INTAKE id');
  assert(assetOut && assetOut.resourceType === 'ASSET', '1. Asset output type');
  assert(assetOut.resourceId && !String(assetOut.resourceId).startsWith('INTAKE-'), '21. physical identity is not INTAKE-');
  const assetRow = await db('assets').where({ id: assetOut.resourceId }).first();
  assert(assetRow && assetRow.product_id === productId, '14. Asset product_id');
  assert(assetRow && assetRow.qrcode, '13. Asset QR');
  assert(assetRow && Number(assetRow.quantity_total) === 2 && Number(assetRow.quantity_available) === 2, '22. Asset qty total=available');
  assert(Number(assetRow.quantity_reserved) === 0 && Number(assetRow.quantity_converted) === 0, '15/22. reserved and converted 0');
  assert(assetRow.parentid == null || assetRow.parentid === '', '19. no parentid');
  assert(Number(assetRow.is_set) === 0, '20. no is_set');
  assert(assetRow.physical_intake_id === assetIntake.id, '12. Asset physical_intake_id');
  assert(!assetRow.receipt_line_id, '18. Asset has no receipt_line_id');
  assert(assetIntake.commercialProvenance && assetIntake.commercialProvenance.state === 'NOT_REQUIRED', 'Opening Balance default No PO Required');

  const replayAsset = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'ASSET',
    intakeType: 'OPENING_BALANCE',
    productId,
    quantity: 2,
    unit: 'Nos',
    reason: 'Opening balance register',
    actor: ACTOR,
    host: HOST,
    idempotencyKey: keyAsset
  });
  assert(replayAsset.id === assetIntake.id, '9. idempotent replay same intake');
  const assetCount = await db('assets').where({ physical_intake_id: assetIntake.id }).count('id as n').first();
  assert(Number(assetCount.n) === 1, '10. duplicate submission did not create another Asset');

  const keyInv = `pi-inv-${Date.now()}`;
  const invIntake = await physicalIntakeService.createPhysicalIntake({
    holdingType: 'INVENTORY',
    intakeType: 'LEGACY_EXISTING_STOCK',
    productId,
    quantity: 7,
    unit: 'Nos',
    location: 'Mumbai',
    source: { legacyId: 'OLD-77', sourceSystem: 'Legacy Warehouse Register' },
    actor: ACTOR,
    host: HOST,
    idempotencyKey: keyInv
  });
  const invOut = (invIntake.outputs || [])[0] || invIntake.created;
  assert(invOut && invOut.resourceType === 'INVENTORY', '2. Inventory intake');
  const invRow = await db('inventory_items').where({ id: invOut.resourceId }).first();
  assert(invRow && Number(invRow.quantity_total) === 7 && invRow.qrcode, '2/13. Inventory qty and QR');
  assert(invRow.product_id === productId, '14. Inventory product_id');
  assert(Number(invRow.quantity_reserved) === 0 && Number(invRow.is_set) === 0, '15/20. Inventory no reserve/set');
  assert(invRow.physical_intake_id === invIntake.id, '12. Inventory provenance');
  assert(!invRow.receipt_line_id, '18. Inventory has no receipt_line_id');

  const history = await physicalIntakeService.listHistory(invIntake.id);
  const types = (history.events || []).map((e) => e.type);
  assert(types.includes('PHYSICAL_INTAKE_CREATED'), '11. PHYSICAL_INTAKE_CREATED');
  assert(types.includes('PHYSICAL_INTAKE_INVENTORY_CREATED'), '11. PHYSICAL_INTAKE_INVENTORY_CREATED');
  const assetHist = await physicalIntakeService.listHistory(assetIntake.id);
  assert((assetHist.events || []).some((e) => e.type === 'PHYSICAL_INTAKE_ASSET_CREATED'), '11. PHYSICAL_INTAKE_ASSET_CREATED');

  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', intakeType: 'OPENING_BALANCE', quantity: 1, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'PRODUCT_REQUIRED',
    '3. Product required'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', productId, quantity: 1, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_TYPE_REQUIRED',
    '4. intake type required'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', intakeType: 'OTHER_APPROVED', productId, quantity: 1, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_REASON_REQUIRED',
    '5. reason required for Other Approved'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'INVENTORY', intakeType: 'NON_PO_ACQUISITION', productId, quantity: 1, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_REASON_REQUIRED',
    '5. reason required for Non-PO'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', intakeType: 'OPENING_BALANCE', productId, quantity: 0, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_QUANTITY_INVALID',
    '6. zero quantity invalid'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', intakeType: 'OPENING_BALANCE', productId, quantity: -3, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_QUANTITY_INVALID',
    '6. negative quantity invalid'
  );
  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'ASSET', intakeType: 'INTERNAL_TRANSFER', productId, quantity: 1, unit: 'Nos', actor: ACTOR, host: HOST
    }),
    'INTAKE_REASON_REQUIRED',
    '12. Internal Transfer requires source location'
  );

  await expectError(
    () => physicalIntakeService.createPhysicalIntake({
      holdingType: 'INVENTORY',
      intakeType: 'DONATION',
      productId,
      quantity: 1,
      unit: 'Nos',
      actor: ACTOR,
      host: HOST,
      idempotencyKey: keyInv,
      reason: 'different payload'
    }),
    'INTAKE_IDEMPOTENCY_CONFLICT',
    '9. idempotency conflict on different payload'
  );

  const rsvAfter = await countOrZero('SELECT COUNT(*)::int AS n FROM reservation');
  assert(rsvAfter === before.counts.reservations, '15. no reservation created');
  const setAfter = await countOrZero('SELECT COUNT(*)::int AS n FROM managed_sets');
  assert(setAfter === before.counts.sets, '16. no Set created');
  const poAfter = await countOrZero('SELECT COUNT(*)::int AS n FROM procurement_po');
  const rnAfter = await countOrZero('SELECT COUNT(*)::int AS n FROM receipt_note');
  assert(poAfter === before.counts.pos, '17. no PO created');
  assert(rnAfter === before.counts.receipts, '18. no Receipt Note created');

  const qtyEvent = await db('quantity_events').where({ root_id: assetOut.resourceId }).orderBy('id', 'desc').first();
  assert(qtyEvent && qtyEvent.type === 'PHYSICAL_INTAKE', '11. quantity event PHYSICAL_INTAKE');

  await runProvenanceTests({ productId, before, assetOut });

  const after = await snapshot();
  for (const id of PROTECTED) {
    assert(
      JSON.stringify(before.protectedHoldings[id]) === JSON.stringify(after.protectedHoldings[id]),
      `protected ${id} unchanged`
    );
  }
}

async function httpChecks(base) {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const salesToken = jwt.sign({ user_id: 'pi-sales', role: 'sales', username: 'sales', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const userToken = jwt.sign({ user_id: 'pi-user', role: 'user', username: 'user', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const managerToken = jwt.sign({ user_id: 'pi-mgr', role: 'manager', username: 'logistics', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const json = { 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    holdingType: 'ASSET',
    intakeType: 'OPENING_BALANCE',
    productId: 'NO-SUCH-PRODUCT',
    quantity: 1,
    unit: 'Nos'
  });

  const unauthLink = await request(`${base}/api/physical-intakes/link-po`, { method: 'POST', headers: json, body: JSON.stringify({ resourceType: 'ASSET', resourceId: 'x' }) });
  assert(unauthLink.status === 401, '7. link-po unauthenticated 401', unauthLink.status);
  const unauth = await request(`${base}/api/physical-intakes`, { method: 'POST', headers: json, body });
  assert(unauth.status === 401, '7. unauthenticated 401', unauth.status);
  const salesLink = await request(`${base}/api/physical-intakes/link-po`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${salesToken}` }, body: JSON.stringify({ resourceType: 'ASSET', resourceId: 'x' }) });
  assert(salesLink.status === 403, '8. link-po Sales 403', salesLink.status);
  const sales = await request(`${base}/api/physical-intakes`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${salesToken}` }, body });
  assert(sales.status === 403, '8. Sales 403', sales.status);
  const user = await request(`${base}/api/physical-intakes`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${userToken}` }, body });
  assert(user.status === 403, '8. user 403', user.status);

  const mgrCreate = await request(`${base}/api/physical-intakes`, {
    method: 'POST',
    headers: { ...json, Authorization: `Bearer ${managerToken}` },
    body
  });
  const parsed = parseJson(mgrCreate.body);
  assert(mgrCreate.status === 409 && parsed.reasonCode === 'PRODUCT_REQUIRED', '3. HTTP Product required', `${mgrCreate.status} ${parsed.reasonCode}`);

  const contained = [
    ['direct Asset create contained', '/api/assets', { ItemName: 'nope', Category: 'IT', Type: 'Hardware' }, 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409],
    ['direct Inventory create contained', '/api/inventory/items', { ItemName: 'nope', FolderID: 'IF-INBOX', KindID: 'IK-MISC' }, 'PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED', 409]
  ];
  const mgrH = { ...json, Authorization: `Bearer ${managerToken}` };
  for (const [name, urlPath, payload, reason, status] of contained) {
    const res = await request(`${base}${urlPath}`, { method: 'POST', headers: mgrH, body: JSON.stringify(payload) });
    const p = parseJson(res.body);
    assert(res.status === status && p.reasonCode === reason, name, `${res.status} ${p.reasonCode}`);
  }
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
  assert(await db.schema.hasTable('physical_intake'), 'schema physical_intake');
  assert(await db.schema.hasTable('commercial_provenance'), 'schema commercial_provenance');
  assert(await db.schema.hasColumn('assets', 'physical_intake_id'), 'schema assets.physical_intake_id');
  assert(await db.schema.hasColumn('inventory_items', 'physical_intake_id'), 'schema inventory_items.physical_intake_id');

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    for (const id of PROTECTED) {
      assert(
        JSON.stringify(baseline.protectedHoldings[id]) === JSON.stringify(snap.protectedHoldings[id]),
        `protected ${id} unchanged vs baseline`
      );
    }
  }

  if (args.runTests) {
    await runMutationTests(snap);
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
      ['procurement-phase9-verify.js', ['--run-tests']],
      ['p0-lifecycle-containment-verify.js', ['--run-tests']],
      ['final-lifecycle-smoke.js', ['--run-tests']]
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  try { await db.destroy(); } catch (_err) { /* ignore */ }
});
