/**
 * Verify Product bulk import + Product matcher (productService.bulkCreateProducts / matchProducts).
 *
 * Scratch only:
 *   DB_NAME=asset_manager_procurement_reconciliation_scratch node scripts/product-bulk-import-verify.js
 *
 * Refuses to run against asset_manager.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { db, generateProductId } = require('../utils');
const productService = require('../services/productService');

const ACTOR = 'product-bulk-verify';
const stamp = Date.now().toString(36).toUpperCase();
const tag = `BV${stamp}`;
let failures = 0;

function check(label, cond, detail) {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
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

async function seed(name, extra = {}) {
  const id = generateProductId();
  await db('product').insert({
    id,
    name,
    status: 'ACTIVE',
    origin: 'ASSETENGINE',
    created_by: ACTOR,
    updated_by: ACTOR,
    ...extra
  });
  return id;
}

async function countTagged() {
  const row = await db('product').where('name', 'like', `${tag}%`).count({ n: '*' }).first();
  return Number(row.n);
}

async function main() {
  const dbName = (await db.raw('SELECT current_database() AS n')).rows[0].n;
  if (dbName === 'asset_manager') {
    throw new Error('Refusing to run against asset_manager');
  }
  console.log(`DB ${dbName} · tag ${tag}`);

  const seedA = await seed(`${tag} Camera`, { make: 'Sony', model: 'X1', product_code: `${tag}-CODE` });
  await seed(`${tag} Tripod`, { make: 'Manfrotto', model: 'T1' });
  await seed(`${tag} Tripod`, { make: 'Benro', model: 'T2' });

  // Matcher
  const match = await productService.matchProducts([
    { product_id: seedA },
    { product_code: `${tag.toLowerCase()}-code` },
    { name: `  ${tag}   camera `, make: 'SONY', model: 'x1' },
    { name: `${tag} Camera` },
    { name: `${tag} Tripod` },
    { name: `${tag} Nothing` },
    { product_id: 'PRD-DOES-NOT-EXIST' }
  ]);
  check('match by ID', match[0].status === 'MATCHED' && match[0].matchedBy === 'ID' && match[0].productId === seedA);
  check('match by product code (case-insensitive)', match[1].status === 'MATCHED' && match[1].matchedBy === 'PRODUCT_CODE');
  check('match by name+make+model (normalised)', match[2].status === 'MATCHED' && match[2].matchedBy === 'NAME_MAKE_MODEL');
  check('match by unique name', match[3].status === 'MATCHED' && match[3].matchedBy === 'NAME');
  check('ambiguous name returns candidates', match[4].status === 'AMBIGUOUS' && match[4].candidates.length === 2);
  check('unmatched name', match[5].status === 'UNMATCHED' && match[5].productId === null);
  check('unknown ID is unmatched with note', match[6].status === 'UNMATCHED' && Boolean(match[6].note));

  // Dry run classification
  const rows = [
    { rowNumber: 2, name: `${tag} Monitor`, make: 'LG', model: 'M27', unit: 'Nos', price: '15000' },
    { rowNumber: 3, name: `${tag} Camera`, make: 'Sony', model: 'X1' },
    { rowNumber: 4, name: `${tag} Other`, product_code: `${tag}-CODE` },
    { rowNumber: 5, name: '', make: 'NoName' },
    { rowNumber: 6, name: `${tag} Bad Price`, price: 'abc' },
    { rowNumber: 7, name: `${tag} Monitor`, make: 'lg', model: 'm27' }
  ];
  const before = await countTagged();
  const dry = await productService.bulkCreateProducts(rows, ACTOR, { dryRun: true });
  const byRow = new Map(dry.rows.map((r) => [r.row, r]));
  check('dry run writes nothing', (await countTagged()) === before);
  check('row 2 VALID', byRow.get(2).status === 'VALID');
  check('row 3 DUPLICATE of existing (name/make/model)', byRow.get(3).status === 'DUPLICATE' && byRow.get(3).match.productId === seedA);
  check('row 4 DUPLICATE of existing (product code)', byRow.get(4).status === 'DUPLICATE');
  check('row 5 ERROR (name required)', byRow.get(5).status === 'ERROR');
  check('row 6 ERROR (price numeric)', byRow.get(6).status === 'ERROR');
  check('row 7 DUPLICATE in file of row 2', byRow.get(7).status === 'DUPLICATE' && /row 2/.test(byRow.get(7).warnings.join(' ')));
  check('summary counts', dry.summary.valid === 1 && dry.summary.duplicate === 3 && dry.summary.error === 2, JSON.stringify(dry.summary));

  // Commit guards (all-or-nothing)
  const errCommit = await expectError(
    'commit with ERROR row is rejected',
    () => productService.bulkCreateProducts([rows[0], rows[3]], ACTOR),
    'BULK_VALIDATION_FAILED'
  );
  check('rejected commit returns per-row details', Boolean(errCommit && errCommit.details && errCommit.details.rows));
  check('rejected commit created nothing', (await countTagged()) === before);
  await expectError(
    'commit with unconfirmed DUPLICATE is rejected',
    () => productService.bulkCreateProducts([rows[0], rows[1]], ACTOR),
    'BULK_VALIDATION_FAILED'
  );
  check('still nothing created', (await countTagged()) === before);

  // Successful commit (valid + confirmed duplicate)
  const ok = await productService.bulkCreateProducts(
    [rows[0], { ...rows[1], allowDuplicate: true }],
    ACTOR
  );
  check('commit creates 2 Products', ok.created.length === 2 && (await countTagged()) === before + 2);
  const created = await db('product').whereIn('id', ok.created.map((c) => c.product.id));
  check('created Products are ACTIVE standalone', created.every((p) => p.status === 'ACTIVE' && p.origin === 'ASSETENGINE' && p.created_by === ACTOR));
  const monitor = created.find((p) => p.name === `${tag} Monitor`);
  check('fields persisted', monitor && monitor.make === 'LG' && monitor.unit === 'Nos' && Number(monitor.price) === 15000);

  const again = await productService.bulkCreateProducts([rows[0]], ACTOR, { dryRun: true });
  check('re-import of created row is now DUPLICATE', again.rows[0].status === 'DUPLICATE');

  // Single create unchanged
  const single = await productService.createProduct({ name: `${tag} Single`, make: 'X' }, ACTOR);
  check('single createProduct still works', single && single.id && single.origin === 'ASSETENGINE');
  await expectError('single createProduct still requires name', () => productService.createProduct({ name: ' ' }, ACTOR));

  // Limits
  await expectError('empty rows rejected', () => productService.bulkCreateProducts([], ACTOR, { dryRun: true }), 'BULK_ROWS_REQUIRED');
  const tooMany = Array.from({ length: productService.BULK_PRODUCT_LIMIT + 1 }, (_, i) => ({ name: `${tag} N${i}` }));
  await expectError('over-limit rejected', () => productService.bulkCreateProducts(tooMany, ACTOR, { dryRun: true }), 'BULK_TOO_MANY_ROWS');

  try {
    await db('product').where('name', 'like', `${tag}%`).del();
  } catch (err) {
    console.log(`note: cleanup skipped (${err.message})`);
  }

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
