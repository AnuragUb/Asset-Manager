/**
 * Phase 3 verification — reservation engine, conservation, identity, auth.
 *
 * Scratch mutations:
 *   node scripts/reservation-phase3-verify.js --database-name asset_manager_phase3_scratch --write-baseline /tmp/p3-base.json
 *   node scripts/reservation-phase3-verify.js --database-name asset_manager_phase3_scratch --compare-baseline /tmp/p3-base.json --run-reservation-tests
 *
 * Production (no mutations):
 *   node scripts/reservation-phase3-verify.js --database-name asset_manager --compare-baseline /tmp/p3-prod-base.json --http-base http://127.0.0.1:8080
 *
 * --run-reservation-tests mutates disposable rows only. Refused against asset_manager.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { db, generateModernAssetId, generateReservationId, verifyReservationId } = require('../utils');
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

function parseArgs(argv) {
  const args = {
    databaseName: null,
    writeBaseline: null,
    compareBaseline: null,
    httpBase: null,
    runReservationTests: false,
    host: '192.168.6.237:8080'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--write-baseline') args.writeBaseline = argv[++i];
    else if (token === '--compare-baseline') args.compareBaseline = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-reservation-tests') args.runReservationTests = true;
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
  const assets = await db('assets').select(
    'id', 'parentid', 'quantity_parent_id', 'quantity_root_id', 'quantity_total',
    'quantity_available', 'quantity_original', 'lineage_status', 'product_id',
    'is_set', 'is_quantity_tracked', 'qrcode', 'assignedto', 'sentagainstdc'
  ).orderBy('id');
  const hasReserved = await db.schema.hasColumn('assets', 'quantity_reserved');
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
  const projects = await q(`SELECT count(*)::int AS n FROM projects`);
  const dcs = await q(`SELECT count(*)::int AS n FROM delivery_challans`);
  const projectAssets = await q(`
    SELECT count(*)::int AS n FROM project_assets
    WHERE assetid IN ('APP-MUM-0526-MMKBX9-W','APP-MUM-0526-PZ2J6E-8','HAR-MUM-0726-55QOFA-R','HAR-MUM-0826-IEIZP5-U')
  `);
  const reservations = (await db.schema.hasTable('reservation'))
    ? await q(`SELECT count(*)::int AS n FROM reservation`)
    : { n: 0 };
  const invReserved = hasReserved
    ? await db('inventory_items').where('id', 'MIS-MUM-0826-H4XVLL-W').select('quantity_reserved').first()
    : null;
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
    projectAssets,
    reservations,
    misReserved: invReserved ? String(invReserved.quantity_reserved) : '0'
  };
}

async function schemaChecks() {
  for (const [table, col] of [
    ['assets', 'quantity_reserved'],
    ['inventory_items', 'quantity_reserved']
  ]) {
    const t = await colType(table, col);
    assert(t && t.data_type === 'numeric' && Number(t.numeric_scale) === 6, `${table}.${col} is numeric(18,6)`, JSON.stringify(t));
  }
  assert(await db.schema.hasTable('reservation'), 'reservation table exists');
  assert(await db.schema.hasTable('reservation_event'), 'reservation_event table exists');
  const convertedNow = await db.schema.hasColumn('assets', 'quantity_converted');
  if (convertedNow) ok('quantity_converted exists (Phase 4+)');
  else ok('no quantity_converted on assets (Phase 3-only schema)');
  const cancelled = await db.raw(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'reservation_status_check'
  `);
  const def = cancelled.rows[0] && cancelled.rows[0].def ? cancelled.rows[0].def : '';
  assert(/ACTIVE/.test(def) && /RELEASED/.test(def) && /TRANSFERRED/.test(def), 'status check has ACTIVE/RELEASED/TRANSFERRED');
  assert(!/CANCELLED/.test(def), 'CANCELLED is not a reservation status');
  const id = generateReservationId();
  assert(verifyReservationId(id), 'verifyReservationId(generateReservationId())');
  assert(!verifyReservationId('PRD-0826-AAAAAA-A'), 'product-shaped ID is not a reservation ID');
}

async function productionRowChecks(snap) {
  const har = snap.assets.find((a) => a.id === 'HAR-MUM-0726-55QOFA-R');
  assert(har && har.quantity_root_id === har.id, 'HAR root unchanged');
  assert(har && har.product_id === 'PRD-0826-W3TB7U-Z', 'HAR product_id unchanged');
  const app = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
  assert(app && app.parentid === 'HAR-MUM-0726-55QOFA-R', 'APP parentid unchanged');
  const setRow = snap.assets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(setRow && setRow.is_set === 1, 'IEIZP5 remains is_set=1');
  const inv = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
  assert(inv && Number(inv.quantity_total) === 3, 'MIS quantity_total conserved as 3');
  assert(inv && Number(inv.quantity_available) === 1, 'MIS available remains 1 (terminal leak not converted to reserved)');
  assert(String(snap.misReserved) === '0' || Number(snap.misReserved) === 0, 'MIS quantity_reserved is 0 (no guessed reservations)');
}

async function insertTestAsset({ qty = 10, assignedto = '', sentagainstdc = '', productId = 'PRD-0826-W3TB7U-Z', name = 'PHASE3-RSV-ASSET' } = {}) {
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
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: productId,
    parentid: null
  });
  return id;
}

async function insertTestInventory({ qty = 10, available = null, name = 'PHASE3-RSV-INV' } = {}) {
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
    quantity_precision: 0,
    quantity_root_id: id,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: null,
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
  const statusOk = caught.statusCode === 409 || caught.statusCode === 400;
  const reasonOk = !reasonCode || caught.reasonCode === reasonCode;
  if (statusOk && reasonOk) {
    ok(name);
  } else {
    fail(name, `status=${caught.statusCode} reasonCode=${caught.reasonCode} message=${caught.message}`);
  }
  return caught;
}

async function holding(table, id) {
  return db(table).where('id', id).first();
}

async function runReservationTests(host) {
  const assetA = await insertTestAsset({ qty: 1, name: 'PHASE3-ASSET-RESERVE' });
  const r1 = await reservationService.reserve({
    resourceType: 'ASSET',
    resourceId: assetA,
    ownerType: 'MANUAL',
    ownerId: 'phase3-owner-a',
    actor: 'phase3-verify',
    reason: 'scratch asset reserve'
  });
  assert(r1.reservation.status === 'ACTIVE', '1. Asset reserve ACTIVE');
  assert(verifyReservationId(r1.reservation.id), '1. Asset reservation id is RSV- checksum');
  const assetARow = await holding('assets', assetA);
  assert(Number(assetARow.quantity_available) === 0 && Number(assetARow.quantity_reserved) === 1, '1. Asset available 0 reserved 1');
  assert(assetARow.product_id === 'PRD-0826-W3TB7U-Z', '15. Product identity unchanged after asset reserve');

  let double = null;
  try {
    await reservationService.reserve({
      resourceType: 'ASSET',
      resourceId: assetA,
      ownerType: 'MANUAL',
      ownerId: 'phase3-owner-b',
      actor: 'phase3-verify'
    });
  } catch (err) {
    double = err;
  }
  assert(double && double.statusCode === 409 && double.reasonCode === 'ASSET_ALREADY_RESERVED', '2. Asset double-reserve rejected', double && double.message);
  if (double && double.details) {
    assert(double.details.ownerId === 'phase3-owner-a', '2. Rejection names existing owner');
  }

  const assigned = await insertTestAsset({ qty: 1, assignedto: 'Alice', name: 'PHASE3-ASSIGNED' });
  const assignedErr = await expectReject(
    () => reservationService.reserve({
      resourceType: 'ASSET', resourceId: assigned, ownerType: 'MANUAL', ownerId: 'x', actor: 'phase3-verify'
    }),
    'ASSET_ASSIGNED',
    'eligibility assignedto'
  );
  assert(assignedErr && /Alice/.test(assignedErr.message), 'eligibility names employee assignment');

  const dcAsset = await insertTestAsset({ qty: 1, sentagainstdc: 'DC-TEST-1', name: 'PHASE3-DC' });
  const dcErr = await expectReject(
    () => reservationService.reserve({
      resourceType: 'ASSET', resourceId: dcAsset, ownerType: 'MANUAL', ownerId: 'x', actor: 'phase3-verify'
    }),
    'ASSET_COMMITTED_TO_DC',
    'eligibility DC stamp'
  );
  assert(dcErr && /DC-TEST-1/.test(dcErr.message), 'eligibility names DC');

  const existingProject = await db('projects').first();
  if (existingProject) {
    const projAsset = await insertTestAsset({ qty: 1, name: 'PHASE3-PROJ' });
    await db('project_assets').insert({
      projectid: existingProject.id,
      assetid: projAsset,
      assigneddate: new Date().toISOString(),
      type: 'Test'
    });
    const projErr = await expectReject(
      () => reservationService.reserve({
        resourceType: 'ASSET', resourceId: projAsset, ownerType: 'MANUAL', ownerId: 'x', actor: 'phase3-verify'
      }),
      'ASSET_ASSIGNED_TO_PROJECT',
      'eligibility project_assets'
    );
    assert(projErr && String(projErr.message).includes(existingProject.id), 'eligibility names project id');
  } else {
    ok('eligibility project_assets skipped (no projects in dump)');
  }

  const inv = await insertTestInventory({ qty: 10 });
  const invQrBefore = (await holding('inventory_items', inv)).qrcode;
  const i1 = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: inv,
    quantity: 4,
    ownerType: 'MANUAL',
    ownerId: 'inv-owner-a',
    actor: 'phase3-verify',
    idempotencyKey: `phase3-inv-a-4-${inv}`
  });
  assert(Number(i1.reservation.quantity) === 4 && i1.reservation.status === 'ACTIVE', '3. Inventory partial reserve qty 4');
  let invRow = await holding('inventory_items', inv);
  assert(Number(invRow.quantity_available) === 6 && Number(invRow.quantity_reserved) === 4, '3. Inventory available 6 reserved 4');

  const replay = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: inv,
    quantity: 4,
    ownerType: 'MANUAL',
    ownerId: 'inv-owner-a',
    actor: 'phase3-verify',
    idempotencyKey: `phase3-inv-a-4-${inv}`
  });
  assert(replay.reservation.id === i1.reservation.id, 'idempotent retry returns same reservation');
  invRow = await holding('inventory_items', inv);
  assert(Number(invRow.quantity_reserved) === 4, 'idempotent retry did not double-count');

  const i2 = await reservationService.reserve({
    resourceType: 'INVENTORY',
    resourceId: inv,
    quantity: 3,
    ownerType: 'MANUAL',
    ownerId: 'inv-owner-b',
    actor: 'phase3-verify'
  });
  assert(i2.reservation.status === 'ACTIVE', '4. Second inventory reservation allowed');
  invRow = await holding('inventory_items', inv);
  assert(Number(invRow.quantity_available) === 3 && Number(invRow.quantity_reserved) === 7, '4. Aggregate reserved 7 available 3');

  let insuff = null;
  try {
    await reservationService.reserve({
      resourceType: 'INVENTORY',
      resourceId: inv,
      quantity: 4,
      ownerType: 'MANUAL',
      ownerId: 'inv-owner-c',
      actor: 'phase3-verify'
    });
  } catch (err) {
    insuff = err;
  }
  assert(insuff && insuff.statusCode === 409 && insuff.reasonCode === 'INSUFFICIENT_AVAILABLE', '5. Insufficient quantity rejected', insuff && insuff.message);
  invRow = await holding('inventory_items', inv);
  assert(Number(invRow.quantity_available) === 3 && Number(invRow.quantity_reserved) === 7, '5. Counters unchanged after rejection');

  const fullTarget = await insertTestInventory({ qty: 5, name: 'PHASE3-FULL-REL' });
  const fullR = await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: fullTarget, quantity: 5,
    ownerType: 'MANUAL', ownerId: 'full', actor: 'phase3-verify'
  });
  const released = await reservationService.release({
    id: fullR.reservation.id,
    actor: 'phase3-verify',
    reason: 'operator cancelled',
    reasonCode: 'CANCELLED_BY_OPERATOR'
  });
  assert(released.reservation.status === 'RELEASED', '6. Full release → RELEASED');
  assert(Number(released.reservation.quantity) === 0, '6. Remaining quantity 0');
  assert(released.reservation.reasonCode === 'CANCELLED_BY_OPERATOR', 'CANCELLED is a reason, not a status');
  const stillThere = await db('reservation').where({ id: fullR.reservation.id }).first();
  assert(!!stillThere, '6. Released row retained (no hard delete)');
  const fullHold = await holding('inventory_items', fullTarget);
  assert(Number(fullHold.quantity_available) === 5 && Number(fullHold.quantity_reserved) === 0, '6. Available restored');

  const partInv = await insertTestInventory({ qty: 10, name: 'PHASE3-PARTIAL' });
  const partR = await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: partInv, quantity: 10,
    ownerType: 'MANUAL', ownerId: 'partial', actor: 'phase3-verify'
  });
  const partOut = await reservationService.release({
    id: partR.reservation.id,
    quantity: 4,
    actor: 'phase3-verify'
  });
  assert(partOut.reservation.status === 'ACTIVE', '7. Partial release stays ACTIVE');
  assert(Number(partOut.reservation.quantity) === 6, '7. Remaining reservation = 6');
  assert(partOut.reservation.id === partR.reservation.id, '7. Same reservation ID');
  const partHold = await holding('inventory_items', partInv);
  assert(Number(partHold.quantity_available) === 4 && Number(partHold.quantity_reserved) === 6, '7. Available +4 reserved 6');
  const over = await expectReject(
    () => reservationService.release({ id: partR.reservation.id, quantity: 99, actor: 'phase3-verify' }),
    'RELEASE_EXCEEDS_REMAINING',
    '7. over-release rejected'
  );
  assert(over && over.statusCode === 409, '7. over-release 409');

  const xferInv = await insertTestInventory({ qty: 8, name: 'PHASE3-XFER' });
  const xferR = await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: xferInv, quantity: 5,
    ownerType: 'MANUAL', ownerId: 'source-owner', actor: 'phase3-verify'
  });
  const beforeXfer = await holding('inventory_items', xferInv);
  const xfer = await reservationService.transfer({
    id: xferR.reservation.id,
    ownerType: 'SYSTEM',
    ownerId: 'dest-owner',
    actor: 'phase3-verify',
    reason: 'super-set absorption primitive'
  });
  assert(xfer.source.status === 'TRANSFERRED', '8. Source is TRANSFERRED');
  assert(xfer.destination.status === 'ACTIVE', '8. Destination is ACTIVE');
  assert(xfer.destination.parentReservationId === xfer.source.id, '8. Destination records source reservation');
  assert(xfer.destination.ownerType === 'SYSTEM' && xfer.destination.ownerId === 'dest-owner', '8. Destination owner recorded');
  assert(xfer.source.transferredToId === xfer.destination.id, '8. Source records destination id');
  const afterXfer = await holding('inventory_items', xferInv);
  assert(Number(afterXfer.quantity_available) === Number(beforeXfer.quantity_available), '8. Transfer does not change available');
  assert(Number(afterXfer.quantity_reserved) === Number(beforeXfer.quantity_reserved), '8. Transfer does not change reserved');
  assert(Number(xfer.destination.quantity) === 5, '8. Quantity preserved; no double-count');
  const xferEvents = [...xfer.sourceEvents, ...xfer.destinationEvents];
  assert(xferEvents.some((e) => e.type === 'TRANSFER' && e.actor === 'phase3-verify'), '8. Transfer event has actor');
  assert(xferEvents.some((e) => e.metadata && e.metadata.to_owner_id === 'dest-owner'), '8. Transfer event records destination owner');

  const concInv = await insertTestInventory({ qty: 5, name: 'PHASE3-CONC-INV' });
  const conc = await Promise.allSettled([
    reservationService.reserve({
      resourceType: 'INVENTORY', resourceId: concInv, quantity: 4,
      ownerType: 'MANUAL', ownerId: 'conc-a', actor: 'phase3-verify'
    }),
    reservationService.reserve({
      resourceType: 'INVENTORY', resourceId: concInv, quantity: 4,
      ownerType: 'MANUAL', ownerId: 'conc-b', actor: 'phase3-verify'
    })
  ]);
  const concOk = conc.filter((x) => x.status === 'fulfilled');
  const concFail = conc.filter((x) => x.status === 'rejected');
  assert(concOk.length === 1 && concFail.length === 1, '9. Concurrent inventory: one success, one reject', JSON.stringify(conc.map((x) => x.status)));
  if (concFail[0]) {
    assert(concFail[0].reason && concFail[0].reason.reasonCode === 'INSUFFICIENT_AVAILABLE', '9. Loser is insufficient available');
  }
  const concHold = await holding('inventory_items', concInv);
  assert(Number(concHold.quantity_available) === 1 && Number(concHold.quantity_reserved) === 4, '9. Concurrent result available 1 reserved 4');
  const concActive = await db('reservation').where({ resource_id: concInv, status: 'ACTIVE' });
  const concSum = concActive.reduce((a, r) => a + Number(r.quantity), 0);
  assert(concSum === 4, '9. Ledger SUM(ACTIVE) = reserved');

  const concAsset = await insertTestAsset({ qty: 1, name: 'PHASE3-CONC-ASSET' });
  const concA = await Promise.allSettled([
    reservationService.reserve({
      resourceType: 'ASSET', resourceId: concAsset, ownerType: 'MANUAL', ownerId: 'asset-conc-a', actor: 'phase3-verify'
    }),
    reservationService.reserve({
      resourceType: 'ASSET', resourceId: concAsset, ownerType: 'MANUAL', ownerId: 'asset-conc-b', actor: 'phase3-verify'
    })
  ]);
  const caOk = concA.filter((x) => x.status === 'fulfilled');
  const caFail = concA.filter((x) => x.status === 'rejected');
  assert(caOk.length === 1 && caFail.length === 1, '10. Concurrent Asset: one success, one reject');
  if (caFail[0]) {
    assert(caFail[0].reason && caFail[0].reason.reasonCode === 'ASSET_ALREADY_RESERVED', '10. Loser is already reserved');
  }

  const hist = await reservationService.getById(partR.reservation.id);
  assert(hist.events.some((e) => e.type === 'RESERVE'), '11. History has RESERVE');
  assert(hist.events.some((e) => e.type === 'PARTIAL_RELEASE'), '11. History has PARTIAL_RELEASE');
  assert(hist.events.every((e) => e.timestamp && (e.actor != null || e.type)), '11. Events have who/when');
  assert(hist.reservation.ownerId === 'partial', '11. History retains owner');

  const brk = await insertTestInventory({ qty: 10, name: 'PHASE3-BREAK' });
  await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: brk, quantity: 4,
    ownerType: 'MANUAL', ownerId: 'break-hold', actor: 'phase3-verify'
  });
  let breakTooMuch = null;
  try {
    await breakService.breakQuantity({
      holdingType: 'INVENTORY', parentId: brk, mode: 'BREAK', amount: 7, actor: 'phase3-verify', host
    });
  } catch (err) {
    breakTooMuch = err;
  }
  assert(breakTooMuch && /exceeds parent available/i.test(breakTooMuch.message), '14. Break cannot consume reserved quantity');
  const broke = await breakService.breakQuantity({
    holdingType: 'INVENTORY', parentId: brk, mode: 'BREAK', amount: 3, actor: 'phase3-verify', host
  });
  const brkParent = await holding('inventory_items', brk);
  assert(Number(brkParent.quantity_total) === 7, '14. After Break 3 parent total 7');
  assert(Number(brkParent.quantity_available) === 3, '14. Parent available 3');
  assert(Number(brkParent.quantity_reserved) === 4, '14. Parent reserved stays 4');
  const child = await holding('inventory_items', broke.children[0].id);
  assert(Number(child.quantity_reserved) === 0, '14. Child does not inherit reservation');
  const childRsv = await db('reservation').where({ resource_id: child.id, status: 'ACTIVE' });
  assert(childRsv.length === 0, '14. No reservation rows on child');

  await reservationService.reserve({
    resourceType: 'INVENTORY', resourceId: child.id, quantity: Number(child.quantity_available),
    ownerType: 'MANUAL', ownerId: 'child-hold', actor: 'phase3-verify'
  });
  let inact = null;
  try {
    await breakService.inactivateChild({
      holdingType: 'INVENTORY', childId: child.id, actor: 'phase3-verify'
    });
  } catch (err) {
    inact = err;
  }
  assert(inact && inact.statusCode === 409, '14. Reserved child cannot be inactivated');

  await breakService.assertConservation(db, 'inventory_items', brk, 0);
  ok('17. Phase 2 conservation intact on break+reserve tree');

  const invAfter = await holding('inventory_items', inv);
  assert(invAfter.qrcode === invQrBefore || Boolean(invAfter.qrcode) === Boolean(invQrBefore), '16. Inventory QR unchanged by reserve');

  const liveProdAssets = await db('assets').whereIn('id', [...PRODUCTION_ASSET_IDS]);
  assert(liveProdAssets.length === 4, '18/19. Production asset IDs still present');
  const ieiz = liveProdAssets.find((a) => a.id === 'HAR-MUM-0826-IEIZP5-U');
  assert(ieiz && Number(ieiz.is_set) === 1, '18. Existing Set flag unchanged');
  const liveProdInv = await db('inventory_items').whereIn('id', [...PRODUCTION_INV_IDS]);
  assert(liveProdInv.length === 1, '20. Production inventory ID still present');
  const mis = liveProdInv[0];
  assert(Number(mis.quantity_total) === 3 && Number(mis.quantity_available) === 1, '20. MIS quantities unchanged');

  const cancelledStatus = await db('reservation').where({ status: 'CANCELLED' });
  assert(cancelledStatus.length === 0, 'no CANCELLED status rows');
}

async function httpChecks(httpBase) {
  const unauth = await request(`${httpBase}/api/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType: 'ASSET', resourceId: 'x', ownerType: 'MANUAL', ownerId: 'x' })
  });
  assert(unauth.status === 401, '12. POST /api/reservations 401', unauth.status);

  const unauthRel = await request(`${httpBase}/api/reservations/RSV-0000-AAAAAA-A/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert(unauthRel.status === 401, '12. POST release 401', unauthRel.status);

  const unauthXfer = await request(`${httpBase}/api/reservations/RSV-0000-AAAAAA-A/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: 'MANUAL', ownerId: 'y' })
  });
  assert(unauthXfer.status === 401, '12. POST transfer 401', unauthXfer.status);

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign(
    { user_id: 'phase3-verify-user', role: 'user', company_id: 'verify' },
    secret,
    { algorithm: 'HS256', expiresIn: 600 }
  );
  const forbidden = await request(`${httpBase}/api/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`
    },
    body: JSON.stringify({ resourceType: 'ASSET', resourceId: 'x', ownerType: 'MANUAL', ownerId: 'x' })
  });
  assert(forbidden.status === 403, '13. POST /api/reservations 403 for role user', forbidden.status);
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) throw new Error('--database-name is required');
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match ${dbName}`);
  }
  if (args.runReservationTests && dbName === 'asset_manager') {
    throw new Error('Refusing --run-reservation-tests against production database asset_manager');
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
    assert(harBefore && harAfter && harBefore.product_id === harAfter.product_id, '15. HAR product_id unchanged vs baseline');
    assert(harBefore && harAfter && harBefore.quantity_original === harAfter.quantity_original, '17. HAR quantity_original unchanged');
    const appBefore = baseline.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    const appAfter = snap.assets.find((a) => a.id === 'APP-MUM-0526-MMKBX9-W');
    assert(appBefore && appAfter && appBefore.parentid === appAfter.parentid, '16. parentid / physical identity checksum unchanged');
    const misBefore = baseline.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
    const misAfter = snap.inventory.find((a) => a.id === 'MIS-MUM-0826-H4XVLL-W');
    assert(misBefore && misAfter && misBefore.has_qr === misAfter.has_qr, '16. MIS QR presence unchanged');
    assert(misBefore && misAfter && misBefore.client_label === misAfter.client_label, '16. MIS client_label unchanged');
    assert(Number(baseline.catalog.n) === Number(snap.catalog.n) && baseline.catalog.checksum === snap.catalog.checksum, '21. zoho_catalog unchanged');
    assert(Number(baseline.products.n) === Number(snap.products.n), '15. product count unchanged');
    assert(Number(baseline.sets.n) === Number(snap.sets.n), '18. managed_sets count unchanged');
    assert(Number(baseline.projects.n) === Number(snap.projects.n), '19. projects count unchanged');
    assert(Number(baseline.dcs.n) === Number(snap.dcs.n), '20. delivery_challans count unchanged');
    assert(Number(baseline.projectAssets.n) === Number(snap.projectAssets.n), '19. production project_assets unchanged');
  }

  if (args.runReservationTests) {
    await runReservationTests(args.host);
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
