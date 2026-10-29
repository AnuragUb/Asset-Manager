/**
 * Verify bulk Physical Intake (physicalIntakeService.createPhysicalIntakesBulk).
 *
 * Scratch only:
 *   DB_NAME=asset_manager_procurement_reconciliation_scratch node scripts/physical-intake-bulk-verify.js
 *
 * Refuses to run against asset_manager.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db, generateProductId } = require('../utils');
const physicalIntakeService = require('../services/physicalIntakeService');

const ACTOR = 'pi-bulk-verify';
const HOST = 'localhost:8080';
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

function check(label, cond, detail) {
  if (cond) console.log(`PASS ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectError(label, fn, reasonCode) {
  try {
    await fn();
    check(label, false, 'expected an error');
    return null;
  } catch (err) {
    check(label, !reasonCode || err.reasonCode === reasonCode, `got ${err.reasonCode || err.message}`);
    return err;
  }
}

async function countIntakes() {
  const row = await db('physical_intake').count({ n: '*' }).first();
  return Number(row.n);
}

async function seedProduct(name) {
  const id = generateProductId();
  await db('product').insert({ id, name, unit: 'Nos', status: 'ACTIVE', origin: 'ASSETENGINE', created_by: ACTOR, updated_by: ACTOR });
  return id;
}

async function main() {
  const dbName = (await db.raw('SELECT current_database() AS n')).rows[0].n;
  if (dbName === 'asset_manager') throw new Error('Refusing to run against asset_manager');
  console.log(`DB ${dbName} · stamp ${stamp}`);

  const productA = await seedProduct(`PIB-${stamp}-A`);
  const productB = await seedProduct(`PIB-${stamp}-B`);
  const invKind = await db('inventory_kinds')
    .whereNotNull('folderid')
    .where(function () { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
    .first();
  const assetFolder = await db('asset_folders').first();
  if (!invKind || !assetFolder) throw new Error('Scratch DB needs at least one inventory kind and one asset folder');

  const invHeader = {
    holdingType: 'INVENTORY',
    intakeType: 'OPENING_BALANCE',
    source: { note: 'bulk verify', legacyReference: `LEG-${stamp}` },
    location: 'Mumbai'
  };
  const invRow = (rowNumber, productId, quantity) => ({
    rowNumber, productId, quantity, unit: 'Nos', folderId: invKind.folderid, kindId: invKind.id
  });

  // Dry run
  const before = await countIntakes();
  const dry = await physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader,
    rows: [invRow(2, productA, 5), invRow(3, 'PRD-NOT-REAL', 1), invRow(4, productB, 0)],
    actor: ACTOR,
    host: HOST,
    dryRun: true
  });
  const byRow = new Map(dry.rows.map((r) => [r.row, r]));
  check('dry run writes nothing', (await countIntakes()) === before);
  check('valid row is VALID with product echo', byRow.get(2).status === 'VALID' && byRow.get(2).product.id === productA);
  check('unknown Product is ERROR PRODUCT_REQUIRED', byRow.get(3).status === 'ERROR' && byRow.get(3).reasonCode === 'PRODUCT_REQUIRED');
  check('zero quantity is ERROR', byRow.get(4).status === 'ERROR' && byRow.get(4).reasonCode === 'INTAKE_QUANTITY_INVALID');

  // Commit guards
  await expectError('commit with ERROR row rejected', () => physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [invRow(2, productA, 5), invRow(3, 'PRD-NOT-REAL', 1)], actor: ACTOR, host: HOST, batchKey: `bk-${stamp}-x`
  }), 'BULK_VALIDATION_FAILED');
  check('rejected commit wrote nothing', (await countIntakes()) === before);

  await expectError('commit without batch key rejected', () => physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [invRow(2, productA, 5)], actor: ACTOR, host: HOST
  }), 'BULK_KEY_REQUIRED');

  const poLink = await physicalIntakeService.createPhysicalIntakesBulk({
    header: { ...invHeader, commercialPoChoice: 'AVAILABLE' }, rows: [invRow(2, productA, 1)], actor: ACTOR, host: HOST, dryRun: true
  });
  check('PO line linking refused in bulk', poLink.rows[0].reasonCode === 'BULK_PO_LINK_UNSUPPORTED');

  const noReason = await physicalIntakeService.createPhysicalIntakesBulk({
    header: { ...invHeader, intakeType: 'NON_PO_ACQUISITION', source: {} }, rows: [invRow(2, productA, 1)], actor: ACTOR, host: HOST, dryRun: true
  });
  check('reason-required type still enforced per row', noReason.rows[0].reasonCode === 'INTAKE_REASON_REQUIRED');

  const badKind = await physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [{ ...invRow(2, productA, 1), kindId: 'NO-SUCH-KIND' }], actor: ACTOR, host: HOST, dryRun: true
  });
  check('unknown inventory kind is ERROR', badKind.rows[0].reasonCode === 'INTAKE_KIND_REQUIRED');

  const headerProduct = await physicalIntakeService.createPhysicalIntakesBulk({
    header: { ...invHeader, productId: productB, quantity: 99 }, rows: [invRow(2, productA, 2)], actor: ACTOR, host: HOST, dryRun: true
  });
  check('row Product/qty win over stray header fields', headerProduct.rows[0].product.id === productA && headerProduct.rows[0].quantity === 2);

  // Successful commit (inventory)
  const batchKey = `bk-${stamp}`;
  const ok = await physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [invRow(2, productA, 5), invRow(3, productB, 2.5)], actor: ACTOR, host: HOST, batchKey
  });
  check('commit registers 2 intakes', ok.intakes.length === 2 && (await countIntakes()) === before + 2);
  const holdings = await db('inventory_items').whereIn('id', ok.intakes.map((i) => i.resourceId));
  check('inventory holdings created with Product + qty', holdings.length === 2
    && holdings.some((h) => h.product_id === productA && Number(h.quantity_total) === 5)
    && holdings.some((h) => h.product_id === productB && Number(h.quantity_total) === 2.5));
  const prov = await db('commercial_provenance').whereIn('physical_intake_id', ok.intakes.map((i) => i.id));
  check('each holding is AWAITING_PO', prov.length === 2 && prov.every((p) => p.state === 'AWAITING_PO'));
  const intakeRows = await db('physical_intake').whereIn('id', ok.intakes.map((i) => i.id));
  check('intake rows carry per-row idempotency keys', intakeRows.every((r) => String(r.idempotency_key).startsWith(`${batchKey}:`)));

  // Replay + conflict
  const replay = await physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [invRow(2, productA, 5), invRow(3, productB, 2.5)], actor: ACTOR, host: HOST, batchKey
  });
  check('resubmitted batch replays (no new rows)', (await countIntakes()) === before + 2
    && replay.intakes.every((i) => i.replayed)
    && replay.intakes.map((i) => i.id).join() === ok.intakes.map((i) => i.id).join());
  await expectError('same batch key with different data conflicts', () => physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [invRow(2, productA, 7)], actor: ACTOR, host: HOST, batchKey
  }), 'INTAKE_IDEMPOTENCY_CONFLICT');
  check('conflict wrote nothing', (await countIntakes()) === before + 2);

  // Asset bulk
  const assetOk = await physicalIntakeService.createPhysicalIntakesBulk({
    header: { holdingType: 'ASSET', intakeType: 'LEGACY_EXISTING_STOCK', source: { sourceSystem: 'Excel' } },
    rows: [
      { rowNumber: 2, productId: productA, quantity: 1, folderId: assetFolder.id, kindId: 'Camera', type: 'Camera', category: 'IT' },
      { rowNumber: 3, productId: productB, quantity: 1, folderId: assetFolder.id, kindId: 'Camera', type: 'Camera', category: 'IT' }
    ],
    actor: ACTOR,
    host: HOST,
    batchKey: `bka-${stamp}`
  });
  const assets = await db('assets').whereIn('id', assetOk.intakes.map((i) => i.resourceId));
  check('asset bulk creates 2 Assets linked to Products', assets.length === 2 && assets.every((a) => a.product_id && a.physical_intake_id && a.qrcode));

  // Single intake unchanged
  const single = await physicalIntakeService.createPhysicalIntake({
    ...invHeader, productId: productA, quantity: 1, unit: 'Nos', folderId: invKind.folderid, kindId: invKind.id, actor: ACTOR, host: HOST
  });
  check('single createPhysicalIntake still works', single && single.id && single.commercialProvenance && single.commercialProvenance.state === 'AWAITING_PO');

  // Limits
  await expectError('empty rows rejected', () => physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: [], actor: ACTOR, host: HOST, dryRun: true
  }), 'BULK_ROWS_REQUIRED');
  const tooMany = Array.from({ length: physicalIntakeService.BULK_INTAKE_LIMIT + 1 }, (_, i) => invRow(i + 2, productA, 1));
  await expectError('over-limit rejected', () => physicalIntakeService.createPhysicalIntakesBulk({
    header: invHeader, rows: tooMany, actor: ACTOR, host: HOST, dryRun: true
  }), 'BULK_TOO_MANY_ROWS');

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
}

main()
  .catch((err) => {
    failures += 1;
    console.error('FATAL', err);
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
