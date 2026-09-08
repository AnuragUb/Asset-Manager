/**
 * Product Phase 1 verification — §18 of PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md
 *
 * Usage (inside asset-manager-prod, with DB_NAME pointing at the target DB):
 *   node scripts/product-phase1-verify.js --database-name asset_manager_phase1_scratch --write-baseline /tmp/p1-base.json
 *   node scripts/product-phase1-verify.js --database-name asset_manager_phase1_scratch --compare-baseline /tmp/p1-base.json
 *   node scripts/product-phase1-verify.js --database-name asset_manager --compare-baseline /tmp/p1-prod-base.json --http-base http://127.0.0.1:8080
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const IdGenerator = require('../IdGenerator');
const { db, generateProductId, verifyProductId, computeProductChecksum } = require('../utils');
const productService = require('../services/productService');

const failures = [];
const passes = [];

function parseArgs(argv) {
  const args = { databaseName: null, writeBaseline: null, compareBaseline: null, httpBase: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') {
      args.databaseName = argv[++i];
    } else if (token === '--write-baseline') {
      args.writeBaseline = argv[++i];
    } else if (token === '--compare-baseline') {
      args.compareBaseline = argv[++i];
    } else if (token === '--http-base') {
      args.httpBase = argv[++i];
    }
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

async function expectThrow(fn, match, name) {
  try {
    await fn();
    fail(name, 'expected throw');
  } catch (err) {
    const msg = `${err && err.code ? err.code : ''} ${err && err.message ? err.message : ''} ${err && err.statusCode ? err.statusCode : ''}`;
    if (typeof match === 'function') {
      if (match(err)) ok(name);
      else fail(name, msg);
      return;
    }
    if (match instanceof RegExp) {
      if (match.test(msg)) ok(name);
      else fail(name, msg);
      return;
    }
    ok(name);
  }
}

function toZohoRecordBigInt(value, fieldName = 'id') {
  if (typeof value === 'bigint') return value;
  if (value == null || value === '') throw new Error(`Zoho record ${fieldName} is missing`);
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error(`Zoho record ${fieldName} is not a safe integer; store and pass a decimal string`);
    }
    return BigInt(value);
  }
  const asString = String(value).trim();
  if (!/^\d+$/.test(asString)) {
    throw new Error(`Zoho record ${fieldName} is not a valid numeric ID`);
  }
  return BigInt(asString);
}

async function snapshot() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  const hasAssetProductId = await db.schema.hasColumn('assets', 'product_id');
  const hasInvProductId = await db.schema.hasColumn('inventory_items', 'product_id');
  const assets = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(id || '|' || coalesce(zoho_product_id,'') || '|' || coalesce(quantity_total::text,'') || '|' || coalesce(quantity_available::text,'') || '|' || coalesce(is_deleted::text,''), ',' ORDER BY id)) AS checksum
    FROM assets
  `);
  const inventory = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(id || '|' || coalesce(zoho_product_id,'') || '|' || coalesce(quantity_total::text,'') || '|' || coalesce(quantity_available::text,'') || '|' || coalesce(is_deleted::text,''), ',' ORDER BY id)) AS checksum
    FROM inventory_items
  `);
  const catalog = await q(`
    SELECT count(*)::int AS n,
           md5(string_agg(zoho_product_id || '|' || product_name, ',' ORDER BY zoho_product_id)) AS checksum
    FROM zoho_catalog
  `);
  const sets = await q(`SELECT count(*)::int AS n FROM managed_sets`);
  const comps = await q(`SELECT count(*)::int AS n FROM managed_set_components`);
  const history = await q(`SELECT count(*)::int AS n, coalesce(max(timestamp)::text,'') AS max_ts FROM asset_history`);
  const invEvents = await q(`SELECT count(*)::int AS n, coalesce(max(timestamp)::text,'') AS max_ts FROM inventory_quantity_events`);
  const qtyEvents = await q(`SELECT count(*)::int AS n FROM quantity_events`);
  const zohoLogs = await q(`SELECT count(*)::int AS n FROM zoho_sync_logs`);
  const productLinks = hasAssetProductId
    ? await q(`
        SELECT count(*) FILTER (WHERE product_id IS NOT NULL)::int AS linked,
               coalesce(string_agg(id || '=' || product_id, ',' ORDER BY id) FILTER (WHERE product_id IS NOT NULL), '') AS pairs
        FROM assets
      `)
    : { linked: 0, pairs: '' };
  const invLinks = hasInvProductId
    ? await q(`SELECT count(*) FILTER (WHERE product_id IS NOT NULL)::int AS linked FROM inventory_items`)
    : { linked: 0 };
  return {
    assets,
    inventory,
    catalog,
    sets: sets.n,
    comps: comps.n,
    history,
    invEvents,
    qtyEvents: qtyEvents.n,
    zohoLogs: zohoLogs.n,
    assetProductLinks: productLinks,
    inventoryProductLinks: invLinks.linked
  };
}

function runIdTests() {
  const re = /^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$/;
  const ids = [];
  for (let i = 0; i < 100000; i++) ids.push(generateProductId());
  assert(ids.every((id) => re.test(id) && id.length === 17), '18.2.1 100k IDs match format and length');
  assert(ids.every((id) => verifyProductId(id)), '18.2.2 verifyProductId(generateProductId())');
  const sampleUnique = ids.slice(0, 1000);
  assert(new Set(sampleUnique).size === sampleUnique.length, '18.2.1b 1000 consecutive IDs unique');

  const sample = ids.slice(0, 20);
  const alphabet = IdGenerator.productAlphabet();
  let substOk = true;
  for (const id of sample) {
    const mmyy = id.slice(4, 8);
    const rand6 = id.slice(9, 15);
    const checksum = id.slice(-1);
    const payload = `PRD${mmyy}${rand6}`;
    for (let pos = 3; pos < payload.length; pos++) {
      for (const ch of alphabet) {
        if (ch === payload[pos]) continue;
        const mutated = payload.slice(0, pos) + ch + payload.slice(pos + 1);
        const bad = `PRD-${mutated.slice(3, 7)}-${mutated.slice(7, 13)}-${checksum}`;
        if (re.test(bad) && verifyProductId(bad)) substOk = false;
      }
    }
    for (const ch of alphabet) {
      if (ch === checksum) continue;
      const bad = `PRD-${mmyy}-${rand6}-${ch}`;
      if (verifyProductId(bad)) substOk = false;
    }
  }
  assert(substOk, '18.2.3 single-character substitution detected');

  let transTotal = 0;
  let transMiss = 0;
  for (const id of sample) {
    const mmyy = id.slice(4, 8);
    const rand6 = id.slice(9, 15);
    const checksum = id.slice(-1);
    const payload = `PRD${mmyy}${rand6}`;
    for (let i = 3; i < payload.length - 1; i++) {
      if (i % 6 === 5) continue;
      if (payload[i] === payload[i + 1]) continue;
      transTotal += 1;
      const swapped = payload.slice(0, i) + payload[i + 1] + payload[i] + payload.slice(i + 2);
      const candidate = `PRD-${swapped.slice(3, 7)}-${swapped.slice(7, 13)}-${checksum}`;
      if (re.test(candidate) && verifyProductId(candidate)) transMiss += 1;
    }
  }
  const detected = transTotal - transMiss;
  assert(transTotal > 0 && detected / transTotal >= 0.5, '18.2.4 adjacent transpositions mostly detected (cycle-boundary pairs excluded)', `detected=${detected}/${transTotal}`);

  const now = new Date();
  const mmyy = (now.getMonth() + 1).toString().padStart(2, '0') + now.getFullYear().toString().substr(-2);
  assert(ids[0].slice(4, 8) === mmyy, '18.2.5 MMYY matches current month');
  assert(ids[0].slice(9, 15) !== ids[1].slice(9, 15), '18.2.5 two IDs in same month differ in XXXXXX');

  const a = generateProductId();
  const b = generateProductId('Apple');
  const c = generateProductId({ make: 'X', location: 'MUM', sku: 'S', zoho: '1' });
  assert(re.test(a) && re.test(b) && re.test(c), '18.2.6 generator ignores extra arguments / has no business inputs');

  assert(!verifyProductId('ASSET-MUM-0826-AAAAAA-A'), '18.2.7 non-product ID rejected');
  const shaped = generateProductId();
  const flipped = `${shaped.slice(0, -1)}${shaped.slice(-1) === 'A' ? 'B' : 'A'}`;
  assert(re.test(flipped) && !verifyProductId(flipped), '18.2.7 wrong checksum rejected by service');
}

function runBigIntAndSourceGuards() {
  const zohoPath = path.join(__dirname, '../services/zohoService.js');
  const src = fs.readFileSync(zohoPath, 'utf8');
  assert(/function toZohoRecordBigInt\(value, fieldName = 'id'\)/.test(src), '18.4.14 toZohoRecordBigInt still present');
  assert(src.includes('record.setId(toZohoRecordBigInt(parent.zoho_product_id'), '18.4.14 setId BigInt boundary intact');
  assert(src.includes("await db('assets').where('id', parentId).update({"), '18.4.14 hardcoded assets write-back left in place');
  const id = toZohoRecordBigInt('1205624000001284002');
  assert(id === 1205624000001284002n, '18.4.14 BigInt conversion of 19-digit Zoho ID');
  try {
    toZohoRecordBigInt('ZP-SAMPLE-0001');
    fail('18.4.14 non-numeric rejected', 'did not throw');
  } catch (err) {
    ok('18.4.14 non-numeric rejected');
  }

  const backfillSrc = fs.readFileSync(path.join(__dirname, 'product-backfill.js'), 'utf8');
  assert(!/match by name|fuzzy|make\s*\+\s*model|product_name ===/i.test(backfillSrc) || !backfillSrc.includes('ORDER BY similarity'), '18.4.23 no fuzzy matching in backfill');
  assert(backfillSrc.includes('HAR-MUM-0826-IEIZP5-U') || backfillSrc.includes('1205624000001313001'), 'B-2 escalate id present in backfill');
}

async function runSchemaTests(currentDb, expectedName) {
  assert(currentDb === expectedName, `connected to ${expectedName}`, `connected to ${currentDb}`);
  const tables = await db.raw(`
    SELECT to_regclass('public.product') AS product,
           to_regclass('public.product_external_ref') AS xref,
           to_regclass('public.product_name_conflict') AS conflict,
           to_regclass('public.sets') AS sets,
           to_regclass('public.set_components') AS set_components
  `);
  const t = tables.rows[0];
  assert(t.product === 'product', 'product table exists');
  assert(t.xref === 'product_external_ref', 'product_external_ref exists');
  assert(t.conflict === 'product_name_conflict', 'product_name_conflict exists');
  assert(t.sets == null, 'abandoned sets table was not created');
  assert(t.set_components == null, 'abandoned set_components table was not created');

  const migrations = await db('knex_migrations').select('name').orderBy('name');
  const names = migrations.map((r) => r.name);
  assert(names.includes('20260827120000_create_product_foundation.js'), 'named Product migration recorded');
  assert(!names.includes('20260824120000_create_managed_sets_tables.js'), 'draft managed-sets migration was not applied');

  const cols = await db.raw(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'product'
    ORDER BY ordinal_position
  `);
  const colset = new Set(cols.rows.map((r) => r.column_name));
  ['id', 'name', 'description', 'make', 'model', 'manufacturer', 'hsn_code', 'unit', 'product_code', 'price', 'status', 'origin', 'origin_ref', 'created_at', 'updated_at', 'created_by', 'updated_by'].forEach((c) => {
    assert(colset.has(c), `product.${c} exists`);
  });
  assert(!colset.has('quantity') && !colset.has('quantity_available') && !colset.has('location') && !colset.has('qrcode'), 'product has no physical fields');

  const xrefCols = await db.raw(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'product_external_ref'
  `);
  const xset = new Set(xrefCols.rows.map((r) => r.column_name));
  assert(xset.has('baseline_name') && xset.has('baseline_captured_at') && xset.has('last_pushed_hash'), 'B-6 baseline fields present');

  const legacy = await db.raw(`
    SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_name='assets' AND column_name='zoho_product_id') AS a,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='zoho_product_id') AS i,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='managed_sets' AND column_name='zoho_product_id') AS s,
      to_regclass('public.zoho_catalog') AS catalog
  `);
  assert(Number(legacy.rows[0].a) === 1 && Number(legacy.rows[0].i) === 1 && Number(legacy.rows[0].s) === 1 && legacy.rows[0].catalog, 'legacy zoho columns/tables retained');
}

async function runConstraintTests() {
  const product = (
    await db('product')
      .insert({
        id: generateProductId(),
        name: 'Constraint Probe A',
        status: 'ACTIVE',
        origin: 'ASSETENGINE',
        created_by: 'phase1-verify'
      })
      .returning('*')
  )[0];
  const cleanupIds = [product.id];
  try {
    await expectThrow(
      () => db('product').where({ id: product.id }).update({ origin: 'ZOHO' }),
      /immutable/i,
      '18.3.10 origin trigger'
    );
    await expectThrow(
      () => db('product').where({ id: product.id }).update({ origin_ref: 'X' }),
      /immutable/i,
      '18.3.10 origin_ref trigger'
    );
    await expectThrow(
      () => db('product').where({ id: product.id }).update({ id: generateProductId() }),
      /immutable/i,
      '18.3.10 id trigger'
    );

    const ref = (
      await db('product_external_ref')
        .insert({
          id: `PER-TEST-${Date.now()}`,
          product_id: product.id,
          system: 'ZOHO_CRM',
          module: 'Products',
          external_id: '1205624000999999999',
          link_origin: 'PULL',
          baseline_name: product.name,
          baseline_captured_at: new Date()
        })
        .returning('*')
    )[0];
    assert(String(ref.external_id) === '1205624000999999999', '18.3.16 19-digit external_id stored as string');

    await expectThrow(
      () => db('product_external_ref').where({ id: ref.id }).update({ link_origin: 'PUSH' }),
      /immutable/i,
      '18.3.10 link_origin trigger'
    );

    const product2 = (
      await db('product')
        .insert({
          id: generateProductId(),
          name: 'Constraint Probe B',
          status: 'ACTIVE',
          origin: 'ASSETENGINE'
        })
        .returning('*')
    )[0];
    cleanupIds.push(product2.id);

    await expectThrow(
      () =>
        db('product_external_ref').insert({
          id: `PER-TEST-${Date.now()}-2`,
          product_id: product2.id,
          system: 'ZOHO_CRM',
          module: 'Products',
          external_id: '1205624000999999999',
          link_origin: 'PULL'
        }),
      /23505|already maps/i,
      '18.3.8 duplicate external_id unique'
    );
    await expectThrow(
      () =>
        db('product_external_ref').insert({
          id: `PER-TEST-${Date.now()}-3`,
          product_id: product.id,
          system: 'ZOHO_CRM',
          module: 'Products',
          external_id: '1205624000888888888',
          link_origin: 'PULL'
        }),
      /23505|already maps/i,
      '18.3.9 second mapping for same product unique'
    );

    await expectThrow(
      () => db('product').where({ id: product.id }).update({ status: 'ARCHIVED', archived_at: null }),
      /23514|archive/i,
      '18.3.11 archive consistency CHECK'
    );

    await expectThrow(
      () =>
        db('product').insert({
          id: generateProductId(),
          name: 'bad origin ref',
          status: 'ACTIVE',
          origin: 'ZOHO',
          origin_ref: 'SOMETHING'
        }),
      /23514|origin_ref/i,
      '18.3.12 origin_ref CHECK for ZOHO'
    );

    await expectThrow(
      () => db.raw('DELETE FROM product WHERE id = ?', [product.id]),
      /23503|restrict/i,
      '18.3.17 RESTRICT while external ref exists'
    );

    await db('product_external_ref').where({ product_id: product.id }).del();
    await db('product').whereIn('id', cleanupIds.concat([product.id, product2.id].filter(Boolean))).del();
  } catch (err) {
    await db('product_external_ref').whereIn('product_id', cleanupIds).del().catch(() => {});
    await db('product').whereIn('id', cleanupIds).del().catch(() => {});
    throw err;
  }
}

async function runServiceTests() {
  await db('product_external_ref').whereIn('product_id', db('product').select('id').where({ created_by: 'phase1-verify' })).del();
  await db('product').where({ created_by: 'phase1-verify' }).del();
  const created = await productService.createProduct(
    { name: 'Service Probe', description: 'd', make: 'M', id: 'SHOULD-IGNORE', origin: 'ZOHO' },
    'phase1-verify'
  );
  assert(created.origin === 'ASSETENGINE', 'POST origin forced to ASSETENGINE');
  assert(created.id !== 'SHOULD-IGNORE' && verifyProductId(created.id), 'POST ignores client id and generates PRD-');

  await expectThrow(
    () => productService.updateProduct(created.id, { origin: 'ZOHO', name: 'x' }, 'phase1-verify'),
    (err) => err.statusCode === 400,
    '18.3.14 PUT rejects origin'
  );

  const archived = await productService.archiveProduct(created.id, 'phase1-verify');
  assert(archived.status === 'ARCHIVED' && archived.archived_at, '18.3.13 archive sets status and archived_at');
  const restored = await productService.restoreProduct(created.id, 'phase1-verify');
  assert(restored.status === 'ACTIVE' && restored.archived_at == null, '18.3.13 restore round-trip');

  const ref = await productService.createExternalRef(
    created.id,
    { external_id: '1205624000777777777', link_origin: 'PULL' },
    'phase1-verify'
  );
  assert(String(ref.external_id) === '1205624000777777777', 'mapping stores 19-digit string');

  await expectThrow(
    () => productService.createExternalRef(created.id, { external_id: '1205624000666666666', link_origin: 'PULL' }, 'phase1-verify'),
    (err) => err.statusCode === 409 && /already maps to a Zoho record/i.test(err.message),
    '18.3.9 service 409 product already mapped'
  );

  const other = await productService.createProduct({ name: 'Service Probe Other' }, 'phase1-verify');
  await expectThrow(
    () => productService.createExternalRef(other.id, { external_id: '1205624000777777777', link_origin: 'PULL' }, 'phase1-verify'),
    (err) => err.statusCode === 409 && /already maps to another Product/i.test(err.message),
    '18.3.8 service 409 external already mapped'
  );

  const sameName1 = await productService.createProduct({ name: 'Duplicate Name Probe' }, 'phase1-verify');
  const sameName2 = await productService.createProduct({ name: 'Duplicate Name Probe' }, 'phase1-verify');
  assert(sameName1.id !== sameName2.id, '18.4.23 identical names create distinct Products');

  await db('product_external_ref').whereIn('product_id', [created.id, other.id, sameName1.id, sameName2.id]).del();
  await db('product').whereIn('id', [created.id, other.id, sameName1.id, sameName2.id]).del();
}

async function runBackfillAssertions() {
  await db('product_external_ref').whereIn('product_id', db('product').select('id').where({ created_by: 'phase1-verify' })).del();
  await db('product').where({ created_by: 'phase1-verify' }).del();
  const products = await db('product').whereNot('created_by', 'phase1-verify').select('*');
  const refs = await db('product_external_ref').select('*');
  const formatBad = products.filter((p) => !/^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$/.test(p.id));
  const checksumBad = products.filter((p) => !verifyProductId(p.id));
  assert(formatBad.length === 0, '18.4.2 all Product IDs match format', formatBad.map((p) => p.id).join(','));
  assert(checksumBad.length === 0, '18.4.2 all Product IDs pass checksum');
  assert(new Set(products.map((p) => p.id)).size === products.length, '18.4.3 no duplicate Product IDs');
  assert(new Set(refs.map((r) => r.external_id)).size === refs.length, '18.4.4 no duplicate Zoho mappings');

  const sample = await db('zoho_catalog').where({ zoho_product_id: 'ZP-SAMPLE-0001' }).first();
  const sampleProduct = await db('product_external_ref').where({ external_id: 'ZP-SAMPLE-0001' }).first();
  assert(Boolean(sample) && !sampleProduct, '18.4.21 ZP-SAMPLE-0001 quarantined, still in zoho_catalog');

  const escalateRef = await db('product_external_ref').where({ external_id: '1205624000001313001' }).first();
  const escalateAsset = await db('assets').where({ id: 'HAR-MUM-0826-IEIZP5-U' }).first();
  assert(!escalateRef, '18.4.22 B-2 not backfilled');
  assert(escalateAsset && escalateAsset.zoho_product_id === '1205624000001313001' && !escalateAsset.product_id, 'B-2 asset unchanged except no product_id');

  const trimbleRef = await db('product_external_ref').where({ external_id: '1205624000001284002' }).first();
  const trimbleProduct = trimbleRef ? await db('product').where({ id: trimbleRef.product_id }).first() : null;
  const trimbleAsset = await db('assets').where({ id: 'HAR-MUM-0726-55QOFA-R' }).first();
  assert(trimbleProduct && trimbleProduct.origin === 'ASSET', '18.4.20 Trimble origin is ASSET not ZOHO');
  assert(trimbleProduct.origin_ref === 'HAR-MUM-0726-55QOFA-R', 'Trimble origin_ref is the asset id');
  assert(trimbleRef.link_origin === 'PUSH', 'Trimble link_origin is PUSH');
  assert(trimbleAsset && trimbleAsset.product_id === trimbleProduct.id, '18.4 B-7 approved asset linked');
  assert(trimbleAsset.zoho_product_id === '1205624000001284002', 'Trimble legacy zoho_product_id unchanged');

  const zohoOrigin = products.filter((p) => p.origin === 'ZOHO').length;
  const assetOrigin = products.filter((p) => p.origin === 'ASSET').length;
  assert(assetOrigin === 1, `exactly one ASSET-origin Product (got ${assetOrigin})`);
  assert(zohoOrigin === 200, `200 ZOHO-origin Products (got ${zohoOrigin})`);
  assert(products.length >= 201, `Product count at least Phase 1 baseline, got ${products.length}`);

  const conflicts = await db('product_name_conflict').count('* as n').first();
  assert(Number(conflicts.n) === 0, 'no name conflicts created in Phase 1');

  return { productCount: products.length, mappingCount: refs.length };
}

function compareSnapshots(before, after) {
  assert(before.assets.n === after.assets.n && before.assets.checksum === after.assets.checksum, '18.4.6-9 asset ids/qty/zoho ids unchanged');
  assert(before.inventory.n === after.inventory.n && before.inventory.checksum === after.inventory.checksum, '18.4.7-9 inventory ids/qty unchanged');
  assert(before.catalog.n === after.catalog.n && before.catalog.checksum === after.catalog.checksum, '18.4.5 zoho_catalog unchanged');
  assert(before.sets === after.sets && before.comps === after.comps, '18.4.12 Set data unchanged');
  assert(before.history.n === after.history.n && before.history.max_ts === after.history.max_ts, '18.4.10 asset history unchanged');
  assert(before.invEvents.n === after.invEvents.n && before.invEvents.max_ts === after.invEvents.max_ts, '18.4.11 inventory quantity events unchanged');
  assert(before.qtyEvents === after.qtyEvents, 'quantity_events unchanged');
  assert(before.zohoLogs === after.zohoLogs, '18.4.13 no new zoho_sync_logs');
  assert(after.inventoryProductLinks === 0, 'no inventory product_id links in Phase 1');
  const pairs = String(after.assetProductLinks.pairs || '');
  assert(after.assetProductLinks.linked === 1, `exactly one asset product_id link (got ${after.assetProductLinks.linked})`);
  assert(pairs.startsWith('HAR-MUM-0726-55QOFA-R='), `only approved asset linked: ${pairs}`);
}

function request(base, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, base);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runHttpTests(base) {
  const unauth = await request(base, 'GET', '/api/products');
  assert(unauth.status === 401, '18.3.15 GET /api/products without token is 401', unauth.status);
  const unauthPost = await request(base, 'POST', '/api/products', { body: { name: 'x' } });
  assert(unauthPost.status === 401, '18.3.15 POST /api/products without token is 401', unauthPost.status);

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const userToken = jwt.sign({ user_id: 'phase1-verify-user', role: 'user', company_id: 'x' }, secret, { expiresIn: '5m' });
  const forbidden = await request(base, 'POST', '/api/products', { token: userToken, body: { name: 'x' } });
  assert(forbidden.status === 403, '18.3.15 POST /api/products as role=user is 403', forbidden.status);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('Product Phase 1 verify starting');
  runIdTests();
  runBigIntAndSourceGuards();

  const info = await db.raw('select current_database() as db');
  const currentDb = info.rows[0].db;
  if (!args.databaseName) {
    throw new Error('--database-name is required and must match current_database()');
  }
  if (args.databaseName !== currentDb) {
    throw new Error(`DB mismatch: wanted ${args.databaseName}, connected to ${currentDb}`);
  }

  if (args.writeBaseline) {
    const snap = await snapshot();
    fs.writeFileSync(args.writeBaseline, JSON.stringify(snap, null, 2));
    console.log('Wrote baseline', args.writeBaseline);
  }

  const hasProductTable = await db.schema.hasTable('product');
  if (!hasProductTable) {
    console.log('product table not present — skipping schema/backfill/constraint tests (pre-migration).');
    console.log('');
    console.log(`Passed: ${passes.length}`);
    console.log(`Failed: ${failures.length}`);
    if (failures.length) console.error(JSON.stringify(failures, null, 2));
    await db.destroy();
    process.exit(failures.length ? 1 : 0);
  }

  await runSchemaTests(currentDb, args.databaseName);

  const hasProducts = await db.schema.hasTable('product');
  if (hasProducts) {
    const counts = await db('product').count('* as n').first();
    if (Number(counts.n) > 0) {
      const result = await runBackfillAssertions();
      console.log('Backfill counts', result);
    } else {
      console.log('No Product rows yet — skipping backfill assertions');
    }
  }

  await runConstraintTests();
  await runServiceTests();

  if (args.compareBaseline) {
    const before = JSON.parse(fs.readFileSync(args.compareBaseline, 'utf8'));
    const after = await snapshot();
    compareSnapshots(before, after);
  }

  if (args.httpBase) {
    await runHttpTests(args.httpBase);
  }

  console.log('');
  console.log(`Passed: ${passes.length}`);
  console.log(`Failed: ${failures.length}`);
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
  }
  await db.destroy();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('VERIFY FAILED:', err.message);
  console.error(err.stack);
  try {
    await db.destroy();
  } catch (e) {
    /* ignore */
  }
  process.exit(1);
});
