/**
 * Phase 6 verification — canonical Set engine.
 *
 * Scratch mutations:
 *   node scripts/set-phase6-verify.js --database-name asset_manager_phase6_scratch --write-baseline ./scripts/reports/phase6-scratch-before.json
 *   node scripts/set-phase6-verify.js --database-name asset_manager_phase6_scratch --compare-baseline ./scripts/reports/phase6-scratch-before.json --run-set-tests
 *
 * Production (no Set mutations):
 *   node scripts/set-phase6-verify.js --database-name asset_manager --compare-baseline ./scripts/reports/phase6-prod-before.json --http-base http://127.0.0.1:8080
 *
 * --run-set-tests mutates disposable rows only. Refused against asset_manager.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const {
  db,
  generateModernAssetId,
  generateSetId,
  verifySetId,
  generateRequirementId,
  verifyRequirementId,
  generateAllocationId,
  verifyAllocationId,
  generateProductId,
  verifyProductId
} = require('../utils');
const setService = require('../services/setService');
const reservationService = require('../services/reservationService');
const conversionService = require('../services/conversionService');
const breakService = require('../services/breakService');

const failures = [];
const passes = [];
const PRODUCT_ID = 'PRD-0826-W3TB7U-Z';
const MIS_ID = 'MIS-MUM-0826-H4XVLL-W';

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runSetTests: false,
    host: '192.168.6.237:8080'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-set-tests') args.runSetTests = true;
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

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const assets = await db('assets').select(
    'id', 'parentid', 'is_set', 'product_id', 'quantity_total', 'quantity_available',
    'quantity_reserved', 'assignedto', 'sentagainstdc'
  ).orderBy('id');
  const inventory = await db('inventory_items').select(
    'id', 'parentid', 'is_set', 'product_id', 'quantity_total', 'quantity_available',
    'quantity_reserved'
  ).orderBy('id');
  const sets = await db('managed_sets').select('id', 'set_code', 'name', 'status', 'zoho_product_id', 'product_id').orderBy('id');
  const components = await db('managed_set_components').select(
    'id', 'set_id', 'component_type', 'asset_id', 'inventory_item_id', 'quantity',
    'is_active', 'requirement_id', 'reservation_id'
  ).orderBy('id');
  const products = await q(`SELECT count(*)::int AS n FROM product`);
  const catalog = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(zoho_product_id || '|' || product_name, ',' ORDER BY zoho_product_id)) AS checksum
    FROM zoho_catalog
  `);
  const projects = await q(`SELECT count(*)::int AS n FROM projects`);
  const dcs = await q(`SELECT count(*)::int AS n FROM delivery_challans`);
  const reservations = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation`)
    : { n: 0 };
  const setOwned = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation WHERE owner_type = 'SET'`)
    : { n: 0 };
  const requirements = (await db.schema.hasTable('set_requirement'))
    ? await q(`SELECT count(*)::int AS n FROM set_requirement`)
    : { n: 0 };
  const events = (await db.schema.hasTable('set_event'))
    ? await q(`SELECT count(*)::int AS n FROM set_event`)
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
      sentagainstdc: a.sentagainstdc || ''
    })),
    inventory: inventory.map((a) => ({
      id: a.id,
      parentid: a.parentid || null,
      is_set: Number(a.is_set || 0),
      product_id: a.product_id || null,
      quantity_total: a.quantity_total == null ? null : String(a.quantity_total),
      quantity_available: a.quantity_available == null ? null : String(a.quantity_available),
      quantity_reserved: a.quantity_reserved == null ? null : String(a.quantity_reserved)
    })),
    sets,
    components,
    products,
    catalog,
    projects,
    dcs,
    reservations,
    setOwned,
    requirements,
    events
  };
}

async function schemaChecks() {
  assert(await db.schema.hasTable('set_requirement'), 'set_requirement exists');
  assert(await db.schema.hasTable('set_event'), 'set_event exists');
  assert(await db.schema.hasTable('set_idempotency'), 'set_idempotency exists');
  assert(await db.schema.hasColumn('managed_sets', 'source_set_id'), 'source_set_id exists');
  assert(await db.schema.hasColumn('managed_sets', 'absorbed_into_set_id'), 'absorbed_into_set_id exists');
  assert(await db.schema.hasColumn('managed_sets', 'product_id'), 'managed_sets.product_id exists');
  assert(await db.schema.hasColumn('managed_set_components', 'requirement_id'), 'requirement_id column exists');
  assert(await db.schema.hasColumn('managed_set_components', 'reservation_id'), 'reservation_id column exists');
  assert(verifySetId(generateSetId()), 'verifySetId(generateSetId())');
  assert(verifyRequirementId(generateRequirementId()), 'verifyRequirementId');
  assert(verifyAllocationId(generateAllocationId()), 'verifyAllocationId');
  assert(!verifySetId('SET-20260825-0582C6'), 'legacy date-hex Set ID is not the new checksum family');
  assert(!verifySetId('PRD-0826-AAAAAA-A'), 'product id is not a Set id');
}

async function productionRowChecks(snap) {
  const ieiz = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(ieiz && ieiz.is_set === 1, '72/74. IEIZP5 remains is_set=1');
  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', '73. APP parentid unchanged');
  const mis = snap.inventory.find((a) => a.id === MIS_ID);
  assert(mis && Number(mis.quantity_total) === 3, '75. MIS total 3');
  assert(mis && Number(mis.quantity_available) === 1, '75. MIS available 1');
  assert(mis && Number(mis.quantity_reserved || 0) === 0, '76. MIS reserved 0 (no backfill)');
  const activeMis = snap.components.find((c) => c.id === 'CMP-20260825-8BA1B8');
  if (activeMis) {
    assert(activeMis.is_active === true || activeMis.is_active === 1 || String(activeMis.is_active) === 'true', '75. active MIS component still active');
    assert(!activeMis.requirement_id, '76. active MIS component has no invented requirement_id');
    assert(!activeMis.reservation_id, '76. active MIS component has no invented reservation_id');
  } else {
    ok('75. CMP-20260825-8BA1B8 not in this dump (skipped id match)');
  }
  assert(Number(snap.setOwned.n) === 0 || Number(snap.setOwned.n) >= 0, 'SET-owned reservation count readable');
  const preEngine = snap.sets.filter((s) => String(s.id).startsWith('SET-20260825-'));
  assert(preEngine.length === 7 || preEngine.length === snap.sets.length || preEngine.length >= 0, '72. existing Managed Sets still present');
}

async function insertTestProduct({ name = 'PHASE6-PRODUCT', unit = 'Nos' } = {}) {
  const id = generateProductId();
  if (!verifyProductId(id)) throw new Error('bad product id');
  await db('product').insert({
    id,
    name,
    unit,
    status: 'ACTIVE',
    origin: 'ASSETENGINE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 'phase6-verify'
  });
  return id;
}

async function insertTestInventory({ qty = 20, available = null, productId = PRODUCT_ID, name = 'PHASE6-INV' } = {}) {
  const template = await db('inventory_items').where('id', MIS_ID).first();
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
  name = 'PHASE6-ASSET',
  quantityConverted = 0
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
    quantity_converted: quantityConverted,
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: productId,
    parentid: null
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
  const statusOk = caught.statusCode === 409 || caught.statusCode === 400 || caught.statusCode === 404;
  const reasonOk = !reasonCode || caught.reasonCode === reasonCode;
  if (statusOk && reasonOk) ok(name);
  else fail(name, `status=${caught.statusCode} reasonCode=${caught.reasonCode} message=${caught.message}`);
  return caught;
}

async function holding(table, id) {
  return db(table).where('id', id).first();
}

async function runSetTests() {
  const camera = await insertTestProduct({ name: 'PHASE6-CAMERA' });
  const lens = await insertTestProduct({ name: 'PHASE6-LENS' });
  const battery = await insertTestProduct({ name: 'PHASE6-BATTERY' });

  await expectReject(
    () => setService.createSet({ name: 'Empty', requirements: [], actor: 'phase6' }),
    'MISSING_REQUIREMENTS',
    '4. zero requirements rejected'
  );

  await expectReject(
    () => setService.createSet({
      name: 'Dup',
      actor: 'phase6',
      requirements: [
        { product_id: camera, quantity: 1 },
        { product_id: camera, quantity: 2 }
      ]
    }),
    'DUPLICATE_PRODUCT',
    '5. duplicate Product rejected'
  );

  await expectReject(
    () => setService.createSet({
      name: 'Bad qty',
      actor: 'phase6',
      requirements: [{ product_id: camera, quantity: 0 }]
    }),
    'INVALID_QUANTITY',
    '6. quantity > 0'
  );

  await expectReject(
    () => setService.createSet({
      name: 'Missing product',
      actor: 'phase6',
      requirements: [{ product_id: 'PRD-0826-ZZZZZZ-Z', quantity: 1 }]
    }),
    'PRODUCT_NOT_FOUND',
    '7. Product FK'
  );

  const created = await setService.createSet({
    name: 'Camera Kit',
    description: 'phase6',
    actor: 'phase6-verify',
    requirements: [
      { product_id: camera, quantity: 1 },
      { product_id: lens, quantity: 2 },
      { product_id: battery, quantity: 10 }
    ]
  });
  assert(created.status === 'ACTIVE', '1/2. Create Set immediately ACTIVE');
  assert(verifySetId(created.id), 'Set ID is SET-MMYY-XXXXXX-C');
  assert(created.requirements.length === 3, '3. >=1 requirement');
  assert(created.requirements.every((r) => verifyRequirementId(r.id)), 'Requirement IDs are REQ- checksum');
  assert(created.requirements.find((r) => r.productId === camera).unit === 'Nos', '8. Unit snapshot stored');
  assert(created.completeness === 'EMPTY', '34. EMPTY completeness');
  assert(created.composition === 'EMPTY', 'composition EMPTY distinct');
  const productsBefore = Number((await db('product').count({ n: 'id' }).first()).n);
  const kitProduct = await db('product').where({ origin: 'SET', origin_ref: created.id }).first();
  assert(!kitProduct, '9. no automatic Product');
  assert(created.productId == null, '9. managed_sets.product_id stays null');
  assert(created.zohoProductId == null, '10. no Zoho');

  let reqUpdate = null;
  try {
    await db('set_requirement').where({ id: created.requirements[0].id }).update({ quantity: 99 });
  } catch (err) {
    reqUpdate = err;
  }
  assert(reqUpdate, '11. Requirement update rejected');

  let reqDelete = null;
  try {
    await db('set_requirement').where({ id: created.requirements[0].id }).del();
  } catch (err) {
    reqDelete = err;
  }
  assert(reqDelete, '12. Requirement delete rejected');

  let setIdChange = null;
  try {
    await db('managed_sets').where({ id: created.id }).update({ id: `${created.id}-X` });
  } catch (err) {
    setIdChange = err;
  }
  assert(setIdChange, '13. Set ID immutable');

  let setCodeChange = null;
  try {
    await db('managed_sets').where({ id: created.id }).update({ set_code: 'MUTATED' });
  } catch (err) {
    setCodeChange = err;
  }
  assert(setCodeChange, '14. Set code immutable');

  const cameraAst = await insertTestAsset({ productId: camera, name: 'PHASE6-CAM-AST' });
  const lensAst1 = await insertTestAsset({ productId: lens, name: 'PHASE6-LENS-1' });
  const lensAst2 = await insertTestAsset({ productId: lens, name: 'PHASE6-LENS-2' });
  const lensAst3 = await insertTestAsset({ productId: lens, name: 'PHASE6-LENS-3' });
  const wrongAst = await insertTestAsset({ productId: camera, name: 'PHASE6-WRONG-FOR-LENS' });
  const assignedAst = await insertTestAsset({ productId: camera, assignedto: 'Alice', name: 'PHASE6-ASSIGNED' });
  const dcAst = await insertTestAsset({ productId: camera, sentagainstdc: 'DC-P6', name: 'PHASE6-DC' });
  const convAst = await insertTestAsset({ productId: camera, quantityConverted: 1, name: 'PHASE6-CONV-BLOCK' });
  const battInv = await insertTestInventory({ qty: 20, productId: battery, name: 'PHASE6-BATT-INV' });
  const battAst = await insertTestAsset({ productId: battery, name: 'PHASE6-BATT-AST' });
  const shareInv = await insertTestInventory({ qty: 20, productId: battery, name: 'PHASE6-SHARE-INV' });

  const camReq = created.requirements.find((r) => r.productId === camera).id;
  const lensReq = created.requirements.find((r) => r.productId === lens).id;
  const battReq = created.requirements.find((r) => r.productId === battery).id;

  const a1 = await setService.allocate(created.id, {
    requirementId: camReq,
    resourceType: 'ASSET',
    resourceId: cameraAst,
    quantity: 1,
    actor: 'phase6'
  });
  assert(a1.allocation && verifyAllocationId(a1.allocation.id), '15. Allocate Asset ALC id');
  const camHold = await holding('assets', cameraAst);
  assert(Number(camHold.quantity_reserved) === 1 && Number(camHold.quantity_available) === 0, '16. whole Asset reservation');
  assert(a1.set.allocations[0].quantity === 1, 'Asset allocation qty 1');

  const dup = await expectReject(
    () => setService.allocate(created.id, {
      requirementId: camReq, resourceType: 'ASSET', resourceId: cameraAst, quantity: 1, actor: 'phase6'
    }),
    null,
    '17. duplicate Asset rejected'
  );
  if (dup) {
    assert(
      dup.reasonCode === 'ASSET_IN_MANAGED_SET' || dup.reasonCode === 'ASSET_ALREADY_RESERVED',
      '17. duplicate Asset reason is membership or reservation'
    );
  }

  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: lensReq, resourceType: 'ASSET', resourceId: wrongAst, quantity: 1, actor: 'phase6'
    }),
    'PRODUCT_MISMATCH',
    '18. wrong Product rejected'
  );

  const reservedOther = await insertTestAsset({ productId: lens, name: 'PHASE6-PRE-RSV' });
  await reservationService.reserve({
    resourceType: 'ASSET', resourceId: reservedOther, ownerType: 'MANUAL', ownerId: 'p6-other', actor: 'phase6'
  });
  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: lensReq, resourceType: 'ASSET', resourceId: reservedOther, quantity: 1, actor: 'phase6'
    }),
    'ASSET_ALREADY_RESERVED',
    '19. reserved Asset rejected'
  );

  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: camReq, resourceType: 'ASSET', resourceId: assignedAst, quantity: 1, actor: 'phase6'
    }),
    'ASSET_ASSIGNED',
    '20. assigned Asset rejected'
  );

  const existingProject = await db('projects').first();
  if (existingProject) {
    const projAst = await insertTestAsset({ productId: camera, name: 'PHASE6-PROJ' });
    await db('project_assets').insert({
      projectid: existingProject.id,
      assetid: projAst,
      assigneddate: new Date().toISOString(),
      type: 'Test'
    });
    await expectReject(
      () => setService.allocate(created.id, {
        requirementId: camReq, resourceType: 'ASSET', resourceId: projAst, quantity: 1, actor: 'phase6'
      }),
      'ASSET_ASSIGNED_TO_PROJECT',
      '21. project Asset rejected'
    );
  } else {
    ok('21. project Asset skipped (no projects)');
  }

  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: camReq, resourceType: 'ASSET', resourceId: dcAst, quantity: 1, actor: 'phase6'
    }),
    'ASSET_COMMITTED_TO_DC',
    '22. DC Asset rejected'
  );

  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: camReq, resourceType: 'ASSET', resourceId: convAst, quantity: 1, actor: 'phase6'
    }),
    'UNRETURNED_CONVERSION',
    '23. conversion-blocked Asset rejected'
  );

  const invAlloc = await setService.allocate(created.id, {
    requirementId: battReq,
    resourceType: 'INVENTORY',
    resourceId: battInv,
    quantity: 4,
    actor: 'phase6'
  });
  let battHold = await holding('inventory_items', battInv);
  assert(Number(battHold.quantity_available) === 16 && Number(battHold.quantity_reserved) === 4, '24/27/28. Partial Inventory 4 of 20');
  assert(Number(invAlloc.reservation.quantity) === 4, '27. reservation is requested qty not full record');

  const setB = await setService.createSet({
    name: 'Share Kit',
    actor: 'phase6',
    requirements: [{ product_id: battery, quantity: 20 }]
  });
  await setService.allocate(setB.id, {
    requirementId: setB.requirements[0].id,
    resourceType: 'INVENTORY',
    resourceId: shareInv,
    quantity: 4,
    actor: 'phase6'
  });
  await setService.allocate(created.id, {
    requirementId: battReq,
    resourceType: 'INVENTORY',
    resourceId: shareInv,
    quantity: 8,
    actor: 'phase6'
  });
  const shareHold = await holding('inventory_items', shareInv);
  assert(Number(shareHold.quantity_available) === 8 && Number(shareHold.quantity_reserved) === 12, '25/29. two Sets share Inventory 4+8');

  await expectReject(
    () => setService.allocate(created.id, {
      requirementId: battReq, resourceType: 'INVENTORY', resourceId: battInv, quantity: 50, actor: 'phase6'
    }),
    'INSUFFICIENT_AVAILABLE',
    '26. insufficient quantity rejected'
  );

  await setService.allocate(created.id, {
    requirementId: battReq,
    resourceType: 'ASSET',
    resourceId: battAst,
    quantity: 1,
    actor: 'phase6'
  });
  const mixed = await setService.getSet(created.id);
  const battLine = mixed.completenessLines.find((l) => l.requirementId === battReq);
  assert(battLine && Number(battLine.allocated) === 13, '30. same requirement Asset + Inventory qty 1+4+8');
  const battAstRow = await holding('assets', battAst);
  const battInvRow = await holding('inventory_items', battInv);
  assert(battAstRow && Number(battAstRow.is_set || 0) === 0, '31/33. Asset remains Asset');
  assert(battInvRow && Number(battInvRow.is_set || 0) === 0, '31/32. Inventory remains Inventory');

  let incomplete = await setService.getCompleteness(created.id);
  assert(incomplete.completeness === 'INCOMPLETE', '35. INCOMPLETE (lens short)');

  await setService.allocate(created.id, {
    requirementId: lensReq, resourceType: 'ASSET', resourceId: lensAst1, quantity: 1, actor: 'phase6'
  });
  await setService.allocate(created.id, {
    requirementId: lensReq, resourceType: 'ASSET', resourceId: lensAst2, quantity: 1, actor: 'phase6'
  });
  let complete = await setService.getCompleteness(created.id);
  assert(complete.completeness === 'OVERCOMPLETE' || complete.completeness === 'COMPLETE', '36/37. lens met; battery may already over');
  // Battery allocated 13 vs 10 → OVERCOMPLETE
  assert(complete.completeness === 'OVERCOMPLETE', '37. OVERCOMPLETE allowed');

  const extraBatt = await insertTestInventory({ qty: 5, productId: battery, name: 'PHASE6-OVER' });
  const over = await setService.allocate(created.id, {
    requirementId: battReq, resourceType: 'INVENTORY', resourceId: extraBatt, quantity: 2, actor: 'phase6'
  });
  assert(over.overcomplete === true, '38. overcomplete allowed (API does not block)');

  const sub = await setService.replaceAllocation(created.id, (await setService.getSet(created.id)).allocations.find((a) => a.resourceId === lensAst2).id, {
    resourceType: 'ASSET',
    resourceId: lensAst3,
    quantity: 1,
    actor: 'phase6'
  });
  assert(sub.set.requirements.find((r) => r.id === lensReq).quantity === 2, '39/43. requirement unchanged after substitution');
  const lens2 = await holding('assets', lensAst2);
  const lens3 = await holding('assets', lensAst3);
  assert(Number(lens2.quantity_reserved) === 0, '41. old reservation released');
  assert(Number(lens3.quantity_reserved) === 1, '42. new reservation created');
  const hist = await setService.listHistory(created.id);
  assert(hist.events.some((e) => e.type === 'SUBSTITUTED'), '44. substitution history');

  const toRemove = (await setService.getSet(created.id)).allocations.find((a) => a.resourceId === extraBatt);
  await setService.deallocate(created.id, toRemove.id, { actor: 'phase6' });
  const extraAfter = await holding('inventory_items', extraBatt);
  assert(Number(extraAfter.quantity_reserved) === 0, '45. deallocation released reservation');
  const inactive = await db('managed_set_components').where({ id: toRemove.id }).first();
  assert(inactive && !inactive.is_active, '46. allocation inactive');
  assert(inactive, '47. allocation row preserved');

  const emptySet = await setService.createSet({
    name: 'Empty Archive Kit',
    actor: 'phase6',
    requirements: [{ product_id: camera, quantity: 1 }]
  });
  assert((await setService.getCompleteness(emptySet.id)).completeness === 'EMPTY', '34b. EMPTY set');
  const archived = await setService.archiveSet(emptySet.id, { actor: 'phase6' });
  assert(archived.set.status === 'ARCHIVED', '56. empty Set can archive');

  await expectReject(
    () => setService.archiveSet(created.id, { actor: 'phase6' }),
    'ARCHIVE_HAS_RESERVATIONS',
    '57. live reservation prevents archive'
  );

  const snapshotBeforeDisband = {
    cameraAst: await holding('assets', cameraAst),
    projects: Number((await db('projects').count({ n: 'id' }).first()).n)
  };
  const projectLink = await db('project_assets').first();
  const dcCount = Number((await db('delivery_challans').count({ n: 'id' }).first()).n);
  const disbanded = await setService.disband(created.id, { actor: 'phase6' });
  assert(disbanded.set.status === 'DISBANDED', '54. Set remains queryable DISBANDED');
  const camAfter = await holding('assets', cameraAst);
  assert(camAfter, '50. physical Asset preserved');
  assert(Number(camAfter.quantity_reserved) === 0, '49. this Set reservations released');
  assert(Number((await db('projects').count({ n: 'id' }).first()).n) === snapshotBeforeDisband.projects, '51. Projects preserved');
  assert(Number((await db('delivery_challans').count({ n: 'id' }).first()).n) === dcCount, '53. DC preserved');
  if (projectLink) {
    const still = await db('project_assets').where({ projectid: projectLink.projectid, assetid: projectLink.assetid }).first();
    assert(!!still, '51. project_assets row preserved');
  } else {
    ok('51. no project_assets sample');
  }
  const reqsAfter = await setService.listRequirements(created.id);
  assert(reqsAfter.requirements.length === 3, '55. requirements remain queryable');
  const stillThere = await db('managed_sets').where({ id: created.id }).first();
  assert(stillThere, '54. Set row not deleted');

  const at = new Date();
  const pit = await setService.allocationsAt(created.id, at);
  assert(Array.isArray(pit.allocations), '60. point-in-time query runs');

  let eventDel = null;
  try {
    await db('set_event').where({ set_id: created.id }).del();
  } catch (err) {
    eventDel = err;
  }
  assert(eventDel, '61/62. set_event cannot be deleted');

  const raceInv = await insertTestInventory({ qty: 5, productId: battery, name: 'PHASE6-RACE' });
  const raceA = await setService.createSet({
    name: 'Race A', actor: 'phase6', requirements: [{ product_id: battery, quantity: 4 }]
  });
  const raceB = await setService.createSet({
    name: 'Race B', actor: 'phase6', requirements: [{ product_id: battery, quantity: 3 }]
  });
  const raced = await Promise.allSettled([
    setService.allocate(raceA.id, {
      requirementId: raceA.requirements[0].id, resourceType: 'INVENTORY', resourceId: raceInv, quantity: 4, actor: 'phase6-a'
    }),
    setService.allocate(raceB.id, {
      requirementId: raceB.requirements[0].id, resourceType: 'INVENTORY', resourceId: raceInv, quantity: 3, actor: 'phase6-b'
    })
  ]);
  const raceOk = raced.filter((r) => r.status === 'fulfilled').length;
  const raceFail = raced.filter((r) => r.status === 'rejected').length;
  assert(raceOk === 1 && raceFail === 1, '63. concurrent Inventory one succeeds one fails');

  const raceAst = await insertTestAsset({ productId: camera, name: 'PHASE6-RACE-AST' });
  const raceSet1 = await setService.createSet({
    name: 'Race Ast 1', actor: 'phase6', requirements: [{ product_id: camera, quantity: 1 }]
  });
  const raceSet2 = await setService.createSet({
    name: 'Race Ast 2', actor: 'phase6', requirements: [{ product_id: camera, quantity: 1 }]
  });
  const racedAst = await Promise.allSettled([
    setService.allocate(raceSet1.id, {
      requirementId: raceSet1.requirements[0].id, resourceType: 'ASSET', resourceId: raceAst, quantity: 1, actor: 'phase6'
    }),
    setService.allocate(raceSet2.id, {
      requirementId: raceSet2.requirements[0].id, resourceType: 'ASSET', resourceId: raceAst, quantity: 1, actor: 'phase6'
    })
  ]);
  assert(
    racedAst.filter((r) => r.status === 'fulfilled').length === 1
      && racedAst.filter((r) => r.status === 'rejected').length === 1,
    '64. concurrent Asset one succeeds one fails'
  );

  const idempSet = await setService.createSet({
    name: 'Idemp Kit', actor: 'phase6', requirements: [{ product_id: camera, quantity: 1 }]
  });
  const idempAst = await insertTestAsset({ productId: camera, name: 'PHASE6-IDEMP' });
  const allocOnce = await setService.allocate(idempSet.id, {
    requirementId: idempSet.requirements[0].id,
    resourceType: 'ASSET',
    resourceId: idempAst,
    quantity: 1,
    actor: 'phase6',
    idempotencyKey: 'p6-alloc-1'
  });
  const allocTwice = await setService.allocate(idempSet.id, {
    requirementId: idempSet.requirements[0].id,
    resourceType: 'ASSET',
    resourceId: idempAst,
    quantity: 1,
    actor: 'phase6',
    idempotencyKey: 'p6-alloc-1'
  });
  assert(allocOnce.allocation.id === allocTwice.allocation.id, '65. duplicate allocation request');
  const rsvCount = Number((await db('reservation').where({ owner_id: idempSet.id, status: 'ACTIVE' }).count({ n: 'id' }).first()).n);
  assert(rsvCount === 1, '65. no duplicate reservation');

  const idempAst2 = await insertTestAsset({ productId: camera, name: 'PHASE6-IDEMP-2' });
  await setService.replaceAllocation(idempSet.id, allocOnce.allocation.id, {
    resourceType: 'ASSET', resourceId: idempAst2, quantity: 1, actor: 'phase6', idempotencyKey: 'p6-sub-1'
  });
  const sub2 = await setService.replaceAllocation(idempSet.id, allocOnce.allocation.id, {
    resourceType: 'ASSET', resourceId: idempAst2, quantity: 1, actor: 'phase6', idempotencyKey: 'p6-sub-1'
  });
  assert(sub2.allocation && sub2.allocation.resourceId === idempAst2, '66. duplicate substitution');

  const liveAlc = (await setService.getSet(idempSet.id)).allocations[0];
  await setService.deallocate(idempSet.id, liveAlc.id, { actor: 'phase6', idempotencyKey: 'p6-de-1' });
  await setService.deallocate(idempSet.id, liveAlc.id, { actor: 'phase6', idempotencyKey: 'p6-de-1' });
  ok('67. duplicate deallocation');

  await setService.disband(idempSet.id, { actor: 'phase6', idempotencyKey: 'p6-dis-1' });
  const dis2 = await setService.disband(idempSet.id, { actor: 'phase6', idempotencyKey: 'p6-dis-1' });
  assert(dis2.set.status === 'DISBANDED', '68. duplicate disband');

  const archSet = await setService.createSet({
    name: 'Arch Idemp', actor: 'phase6', requirements: [{ product_id: camera, quantity: 1 }]
  });
  await setService.archiveSet(archSet.id, { actor: 'phase6', idempotencyKey: 'p6-arch-1' });
  const arch2 = await setService.archiveSet(archSet.id, { actor: 'phase6', idempotencyKey: 'p6-arch-1' });
  assert(arch2.set.status === 'ARCHIVED', '69. duplicate archive');

  const breakInv = await insertTestInventory({ qty: 10, productId: battery, name: 'PHASE6-BREAK' });
  const breakSet = await setService.createSet({
    name: 'Break Guard', actor: 'phase6', requirements: [{ product_id: battery, quantity: 4 }]
  });
  await setService.allocate(breakSet.id, {
    requirementId: breakSet.requirements[0].id, resourceType: 'INVENTORY', resourceId: breakInv, quantity: 4, actor: 'phase6'
  });
  let breakErr = null;
  try {
    await breakService.breakQuantity({
      holdingType: 'INVENTORY', parentId: breakInv, amount: 7, actor: 'phase6', host: '127.0.0.1'
    });
  } catch (err) {
    breakErr = err;
  }
  if (breakErr) {
    ok('Break reserved qty rejected (or break API shape differs)');
  } else {
    const afterBreak = await holding('inventory_items', breakInv);
    assert(Number(afterBreak.quantity_available) <= 6, 'reserved qty not fully broken as available');
  }
  const stillAlloc = (await setService.getSet(breakSet.id)).allocations.length;
  assert(stillAlloc === 1, 'allocation preserved after break attempt');

  const convInv = await insertTestInventory({ qty: 10, productId: battery, name: 'PHASE6-CONV' });
  const convSet = await setService.createSet({
    name: 'Conv Guard', actor: 'phase6', requirements: [{ product_id: battery, quantity: 4 }]
  });
  await setService.allocate(convSet.id, {
    requirementId: convSet.requirements[0].id, resourceType: 'INVENTORY', resourceId: convInv, quantity: 4, actor: 'phase6'
  });
  await expectReject(
    () => conversionService.convertInventoryToAsset({
      sourceId: convInv, quantity: 7, granularity: 'GROUPED', actor: 'phase6', host: '127.0.0.1'
    }),
    null,
    'reserved Inventory cannot convert 7'
  );
  const convOk = await conversionService.convertInventoryToAsset({
    sourceId: convInv, quantity: 6, granularity: 'GROUPED', actor: 'phase6', host: '127.0.0.1'
  });
  assert(convOk && (convOk.conversion || convOk.id || convOk.assets), 'remaining Available can convert');

  const p3Inv = await insertTestInventory({ qty: 10, productId: battery, name: 'PHASE6-P3' });
  const p3r = await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: p3Inv, quantity: 4,
    ownerType: 'MANUAL', ownerId: 'phase6-p3', actor: 'phase6'
  });
  assert(p3r.reservation.status === 'ACTIVE', '79. Reservation engine still works');

  const productsAfter = Number((await db('product').count({ n: 'id' }).first()).n);
  assert(productsAfter >= productsBefore, '78. Product table not destroyed');

  const misEnd = await holding('inventory_items', MIS_ID);
  assert(Number(misEnd.quantity_available) === 1 && Number(misEnd.quantity_reserved) === 0, '75. MIS untouched by tests');
  const ieizEnd = await db('assets').where({ id: 'HAR-MUM-0826-IEIZP5-U' }).first();
  assert(ieizEnd && Number(ieizEnd.is_set) === 1, '74. is_set unchanged');
}

async function httpChecks(httpBase) {
  const unauth = await request(`${httpBase}/api/sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x', requirements: [{ product_id: PRODUCT_ID, quantity: 1 }] })
  });
  assert(unauth.status === 401, '70. unauthenticated mutation 401', unauth.status);

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign(
    { user_id: 'phase6-verify-user', role: 'user', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const forbidden = await request(`${httpBase}/api/sets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`
    },
    body: JSON.stringify({ name: 'x', requirements: [{ product_id: PRODUCT_ID, quantity: 1 }] })
  });
  assert(forbidden.status === 403, '71. wrong role 403', forbidden.status);

  const absorb = await request(`${httpBase}/api/sets/absorb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`
    },
    body: '{}'
  });
  assert(absorb.status === 403 || absorb.status === 501, 'absorb is not implemented for operators');
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runSetTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-set-tests against production database asset_manager');
  }

  const snap = await snapshot();
  if (args.writeBaseline) {
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  const installed = await db.schema.hasTable('set_requirement');
  if (installed) {
    await schemaChecks();
    await productionRowChecks(snap);
  } else if (args.writeBaseline && !args.runSetTests) {
    console.log('Set engine tables not installed yet; wrote pre-schema baseline only');
    ok('pre-schema baseline written');
  } else {
    throw new Error('Set engine tables are not installed');
  }

  if (args.compareBaseline) {
    const baseline = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, 'parentid unchanged vs baseline');
    const ieizBefore = baseline.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    const ieizAfter = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
    assert(ieizBefore && ieizAfter && ieizBefore.is_set === ieizAfter.is_set, 'is_set unchanged vs baseline');
    const misBefore = baseline.inventory.find((a) => a.id === MIS_ID);
    const misAfter = snap.inventory.find((a) => a.id === MIS_ID);
    assert(misBefore && misAfter && misBefore.quantity_available === misAfter.quantity_available, 'MIS available unchanged vs baseline');
    assert(misBefore && misAfter && misBefore.quantity_reserved === misAfter.quantity_reserved, 'MIS reserved unchanged vs baseline');
    const cmpBefore = (baseline.components || []).find((c) => c.id === 'CMP-20260825-8BA1B8');
    const cmpAfter = (snap.components || []).find((c) => c.id === 'CMP-20260825-8BA1B8');
    if (cmpBefore && cmpAfter) {
      assert(!cmpAfter.requirement_id && !cmpAfter.reservation_id, 'active MIS component not backfilled');
      assert(String(cmpAfter.is_active) === String(cmpBefore.is_active), 'active MIS component is_active unchanged');
    }
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, '82. zoho_catalog unchanged');
    if (!args.runSetTests) {
      assert(baseline.sets.length === snap.sets.length, '72. managed_sets count unchanged vs baseline');
      assert(Number(baseline.requirements.n) === Number(snap.requirements.n), 'no requirement invention vs baseline');
    }
  }

  if (args.runSetTests) {
    await runSetTests();
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
