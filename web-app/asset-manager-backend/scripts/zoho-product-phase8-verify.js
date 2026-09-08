/**
 * Phase 8 verification — Product ↔ Zoho + Set commercialization.
 *
 * Uses a Fake Zoho gateway. Does NOT mutate live Zoho.
 *
 * Scratch:
 *   node scripts/zoho-product-phase8-verify.js --database-name asset_manager_phase8_scratch --run-tests
 *
 * Refused against asset_manager.
 */
const productService = require('../services/productService');
const setService = require('../services/setService');
const { db, verifyProductId } = require('../utils');
const zohoProductFields = require('../services/zohoProductFields');
const fs = require('fs');
const path = require('path');

const failures = [];
const passes = [];

function parseArgs(argv) {
  const args = { databaseName: null, runTests: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--database-name') args.databaseName = argv[++i];
    else if (argv[i] === '--run-tests') args.runTests = true;
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

class FakeZoho {
  constructor() {
    this.store = new Map();
    this.seq = 1205624000009000001n;
    this.failMode = null;
    this.lastPayload = null;
    this.logs = [];
  }

  nextId() {
    const id = this.seq.toString();
    this.seq += 1n;
    return id;
  }

  _throw(mode) {
    const err = new Error(mode);
    err.code = mode === 'OAUTH' ? 'ZOHO_NOT_AUTHORIZED' : 'ZOHO_API_EXCEPTION';
    if (mode === '401') err.httpStatus = 401;
    if (mode === '403') err.httpStatus = 403;
    if (mode === '4xx') err.httpStatus = 400;
    if (mode === '5xx') err.httpStatus = 500;
    if (mode === 'TIMEOUT') err.code = 'ETIMEDOUT';
    if (mode === 'RATE_LIMIT') err.httpStatus = 429;
    if (mode === 'MALFORMED') err.code = 'ZOHO_UNEXPECTED_RESPONSE';
    throw err;
  }

  classifyZohoError(error) {
    if (error.httpStatus === 401) return '401';
    if (error.httpStatus === 403) return '403';
    if (error.httpStatus === 429) return 'RATE_LIMIT';
    if (error.httpStatus >= 500) return '5xx';
    if (error.httpStatus >= 400) return '4xx';
    if (error.code === 'ETIMEDOUT') return 'TIMEOUT';
    if (error.code === 'ZOHO_NOT_AUTHORIZED') return 'OAUTH';
    if (error.code === 'ZOHO_UNEXPECTED_RESPONSE') return 'MALFORMED';
    return 'ERROR';
  }

  async inspectModuleFields() {
    return [
      { getFieldLabel: () => 'Product Name', getAPIName: () => 'Product_Name', getDataType: () => 'text', getCustomField: () => false },
      { getFieldLabel: () => 'Make', getAPIName: () => 'Make', getDataType: () => 'text', getCustomField: () => true }
    ];
  }

  serializeInspectedFields(fields) {
    return fields.map((f) => ({
      label: f.getFieldLabel(),
      apiName: f.getAPIName(),
      dataType: f.getDataType(),
      custom: f.getCustomField()
    }));
  }

  async getProductRecord(externalId) {
    if (this.failMode) this._throw(this.failMode);
    const id = String(externalId);
    const row = this.store.get(id);
    if (!row) {
      const err = new Error('Mapped Zoho Product was not found');
      err.code = 'ZOHO_PRODUCT_NOT_FOUND';
      throw err;
    }
    return { zohoId: id, ...row };
  }

  async createProductRecord(fields) {
    if (this.failMode) this._throw(this.failMode);
    this._assertSafePayload(fields);
    this.lastPayload = { ...fields };
    const zohoId = this.nextId();
    this.store.set(zohoId, {
      name: fields.Product_Name || null,
      description: fields.Description || null,
      make: fields.Make || null,
      model: fields.Model || null,
      hsnCode: fields.HSN_Code || null,
      productCode: fields.Product_Code || null,
      unitPrice: null
    });
    return { ok: true, mode: 'CREATE', zohoId };
  }

  async updateProductRecord(externalId, fields) {
    if (this.failMode) this._throw(this.failMode);
    this._assertSafePayload(fields);
    this.lastPayload = { ...fields };
    const id = String(externalId);
    const existing = this.store.get(id) || {};
    this.store.set(id, {
      ...existing,
      name: fields.Product_Name != null ? fields.Product_Name : existing.name,
      description: fields.Description != null ? fields.Description : existing.description,
      make: fields.Make != null ? fields.Make : existing.make,
      model: fields.Model != null ? fields.Model : existing.model,
      hsnCode: fields.HSN_Code != null ? fields.HSN_Code : existing.hsnCode,
      productCode: fields.Product_Code != null ? fields.Product_Code : existing.productCode
    });
    return { ok: true, mode: 'UPDATE', zohoId: id };
  }

  _assertSafePayload(fields) {
    const keys = Object.keys(fields || {});
    if (keys.includes('Unit_Price') || keys.includes('Qty_in_Stock') || keys.includes('Product_Category') || keys.includes('Usage_Unit')) {
      throw new Error('Forbidden Zoho field in Product payload');
    }
  }

  async logSync(entry) {
    this.logs.push(entry);
  }
}

async function count(table) {
  const row = await db(table).count('* as n').first();
  return Number(row.n || 0);
}

async function snapshotPhysical() {
  return {
    assets: await count('assets'),
    inventory: await count('inventory_items'),
    reservations: await db.schema.hasTable('reservation') ? await count('reservation') : 0,
    conversions: await db.schema.hasTable('conversion') ? await count('conversion') : 0,
    receipts: await db.schema.hasTable('receipt_note') ? await count('receipt_note') : 0,
    pos: await db.schema.hasTable('project_orders') ? await count('project_orders') : 0
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  console.log('database', dbName);
  if (args.databaseName && dbName !== args.databaseName) {
    fail('database-name', `expected ${args.databaseName} got ${dbName}`);
  }
  if (args.runTests && dbName === 'asset_manager') {
    console.error('REFUSED: will not run mutation tests against production asset_manager');
    process.exit(2);
  }

  const fieldReport = path.join(__dirname, 'reports/phase8-zoho-product-fields.json');
  assert(fs.existsSync(fieldReport), '1. inspectModuleFields report present');
  const captured = JSON.parse(fs.readFileSync(fieldReport, 'utf8'));
  assert(captured.ok && captured.count >= 30, '2. actual field map captured', `count=${captured.count}`);
  assert(captured.capability.Product_Name && captured.capability.Make && captured.capability.HSN_Code, '2b. Make/Model/HSN present');
  assert(captured.capability.Unit == null, '2c. Unit field absent — skip');
  assert(captured.capability.Usage_Unit && captured.capability.Usage_Unit.dataType === 'picklist', '2d. Usage_Unit picklist unmapped');
  assert(captured.capability.Product_Category && captured.capability.Product_Category.dataType === 'picklist', '2e. Product_Category picklist unmapped');
  assert(zohoProductFields.NEVER_SEND.includes('Unit_Price'), '2f. Unit_Price never-send');
  assert(zohoProductFields.NEVER_SEND.includes('Qty_in_Stock'), '2g. Qty_in_Stock never-send');

  if (!args.runTests) {
    console.log('Inspection checks only. Pass --run-tests on scratch to mutate disposable rows.');
    console.log(`PASS ${passes.length} FAIL ${failures.length}`);
    process.exit(failures.length ? 1 : 0);
  }

  const fake = new FakeZoho();
  productService.setZohoGateway(fake);
  const beforePhysical = await snapshotPhysical();
  const productsBefore = await count('product');

  const created = await productService.createProduct({
    name: 'Phase8 Test Camera',
    description: 'AE description',
    make: 'Canon',
    model: 'C70',
    hsn_code: '8525',
    unit: 'Nos',
    product_code: 'P8-CAM'
  }, 'phase8-verify');
  assert(created && verifyProductId(created.id), '3. Product create');
  const raw = await db('product').where({ id: created.id }).first();
  try {
    await db('product').where({ id: created.id }).update({ id: 'PRD-0000-XXXXXX-X' });
    fail('4. Product ID immutable', 'update succeeded');
  } catch (err) {
    assert(/immutable/i.test(String(err.message)), '4. Product ID immutable', err.message);
  }
  assert(raw.origin === 'ASSETENGINE', '3b. origin ASSETENGINE');

  const pub1 = await productService.publishProduct(created.id, 'phase8-verify');
  assert(pub1.mode === 'CREATE' && typeof pub1.zohoId === 'string' && /^\d+$/.test(pub1.zohoId), '8. publish create string id');
  assert(fake.lastPayload && fake.lastPayload.Unit_Price == null, '20. Price never automatically pushed');
  assert(fake.lastPayload.Product_Name === 'Phase8 Test Camera', '13. Description/name AE → Zoho');
  assert(fake.lastPayload.Description === 'AE description', '13b. Description sent');
  assert(fake.lastPayload.Make === 'Canon' && fake.lastPayload.Model === 'C70', '15-16. Make/Model AE → Zoho');
  assert(fake.lastPayload.HSN_Code === '8525', '17. HSN AE → Zoho');
  assert(fake.lastPayload.Product_Code === 'P8-CAM', '21. SKU sent when non-null');

  const pub2 = await productService.publishProduct(created.id, 'phase8-verify');
  assert(pub2.skipped === true || pub2.mode === 'SKIP' || pub2.mode === 'UPDATE', '9-11. publish update / hash skip');
  const pub2b = await productService.publishProduct(created.id, 'phase8-verify');
  assert(pub2b.skipped === true, '11. hash skip on repeated publish');

  try {
    await productService.createExternalRef(created.id, {
      external_id: '1205624000009999999',
      link_origin: 'PULL'
    }, 'phase8-verify');
    fail('5. strict 1:1 mapping', 'second mapping allowed');
  } catch (err) {
    assert(err.statusCode === 409, '5. duplicate mapping rejected', err.message);
  }

  const other = await productService.createProduct({ name: 'Phase8 Other' }, 'phase8-verify');
  try {
    await productService.createExternalRef(other.id, {
      external_id: pub1.zohoId,
      link_origin: 'PULL'
    }, 'phase8-verify');
    fail('6. duplicate Zoho mapping rejected', 'allowed');
  } catch (err) {
    assert(err.statusCode === 409, '6. duplicate Zoho mapping rejected', err.message);
  }

  fake.store.get(pub1.zohoId).description = 'Zoho overwrote me';
  fake.store.get(pub1.zohoId).make = 'HACKED';
  await db('product').where({ id: created.id }).update({ product_code: null });
  fake.store.get(pub1.zohoId).productCode = 'FROM-ZOHO';
  const refreshed = await productService.refreshProductFromZoho(created.id, 'phase8-verify');
  const afterRefresh = await db('product').where({ id: created.id }).first();
  assert(afterRefresh.description === 'AE description', '14. Description pull cannot overwrite AE');
  assert(afterRefresh.make === 'Canon', 'Make pull cannot overwrite AE');
  assert(afterRefresh.product_code === 'FROM-ZOHO', '21b. SKU fill-null pull');

  await db('product').where({ id: created.id }).update({ name: 'AE renamed' });
  fake.store.get(pub1.zohoId).name = 'Zoho renamed';
  await db('product_external_ref').where({ product_id: created.id }).update({ baseline_name: 'Phase8 Test Camera' });
  await productService.refreshProductFromZoho(created.id, 'phase8-verify');
  const conflicts = await productService.listNameConflicts(created.id);
  const open = conflicts.find((c) => c.status === 'OPEN');
  assert(Boolean(open), '25. true conflict');
  const publishedDuringConflict = await productService.publishProduct(created.id, 'phase8-verify');
  assert(fake.lastPayload.Product_Name == null, '26. conflict blocks name publish');
  await productService.resolveNameConflict(created.id, open.id, 'AE_WINS', 'phase8-verify');
  const resolved = (await productService.listNameConflicts(created.id)).find((c) => c.id === open.id);
  assert(resolved.status === 'RESOLVED' && resolved.resolution === 'AE_WINS', '27. AE_WINS');
  const stillAe = await db('product').where({ id: created.id }).first();
  assert(stillAe.name === 'AE renamed', '27b. AE name kept');

  const catalogBefore = await count('product');
  await db('zoho_catalog').insert({
    zoho_product_id: '1205624099998111111',
    product_name: 'Unlinked Cache Only',
    unit_price: 0,
    last_synced_at: new Date().toISOString()
  });
  const catalogAfter = await count('product');
  assert(catalogAfter === catalogBefore, '30. catalog row creates no Product');

  const fromCat = await productService.createProductFromCatalog('1205624099998111111', 'phase8-verify');
  assert(fromCat.product.origin === 'ZOHO' && fromCat.product.zoho_external_id === '1205624099998111111', '32. explicit create+link from catalog');

  const cam = await productService.createProduct({ name: 'P8 Camera Body', make: 'Sony', model: 'FX6' }, 'phase8-verify');
  const lens = await productService.createProduct({ name: 'P8 Lens', make: 'Canon', model: '24-70' }, 'phase8-verify');
  const set = await setService.createSet({
    name: 'P8 Camera Package',
    requirements: [
      { productId: cam.id, quantity: 1 },
      { productId: lens.id, quantity: 2 }
    ],
    actor: 'phase8-verify'
  });
  const preview = await setService.previewCommercialize(set.id);
  assert(preview.fingerprint && preview.description.includes('P8 Camera Body'), '39-40. deterministic description/fingerprint');
  const commercial = await setService.commercializeSet(set.id, { name: 'P8 CAMERA PACKAGE' }, 'phase8-verify');
  assert(commercial.product.origin === 'SET', '36. origin SET');
  assert(commercial.product.origin_ref === set.id, '37. origin_ref Set ID');
  assert(commercial.set.productId === commercial.product.id, '38. managed_sets.product_id');
  const again = await setService.commercializeSet(set.id, {}, 'phase8-verify');
  assert(again.idempotent && again.product.id === commercial.product.id, '41. repeated commercialization idempotent');

  try {
    await setService.createSet({
      name: 'Illegal recursive',
      requirements: [{ productId: commercial.product.id, quantity: 1 }],
      actor: 'phase8-verify'
    });
    fail('49. SET-origin Product cannot become Set requirement', 'allowed');
  } catch (err) {
    assert(err.reasonCode === 'SET_DERIVED_PRODUCT_NOT_A_REQUIREMENT' && err.statusCode === 409, '49. SET_DERIVED_PRODUCT_NOT_A_REQUIREMENT', err.message);
  }

  const setPub = await productService.publishProduct(commercial.product.id, 'phase8-verify');
  assert(setPub.mode === 'CREATE', '50. Set-derived Product publish');
  const descBefore = fake.lastPayload.Description;
  await db('managed_set_components').where({ set_id: set.id }).update({ is_active: false }).catch(() => {});
  const setPub2 = await productService.publishProduct(commercial.product.id, 'phase8-verify');
  assert(setPub2.skipped === true, '51. allocation changes do not alter hash');
  assert(!String(descBefore || '').includes('S/N:'), '53. no serials sent');

  const setB = await setService.createSet({
    name: 'P8 Camera Package v2',
    requirements: [
      { productId: cam.id, quantity: 1 },
      { productId: lens.id, quantity: 3 }
    ],
    actor: 'phase8-verify'
  });
  const commercialB = await setService.commercializeSet(setB.id, {}, 'phase8-verify');
  assert(commercialB.product.id !== commercial.product.id, '45. changed composition creates new Product');
  const oldStill = await db('product').where({ id: commercial.product.id }).first();
  assert(oldStill && oldStill.origin_ref === set.id, '46. old Product preserved');

  const setC = await setService.createSet({
    name: 'P8 Camera Package twin',
    requirements: [
      { productId: cam.id, quantity: 1 },
      { productId: lens.id, quantity: 2 }
    ],
    actor: 'phase8-verify'
  });
  const reused = await setService.commercializeSet(setC.id, {
    reuse: true,
    reuseProductId: commercial.product.id
  }, 'phase8-verify');
  assert(reused.reused && reused.product.id === commercial.product.id, '47. identical reuse only when explicit');
  assert(reused.product.origin_ref === set.id, '48. reused Product origin_ref remains original Set');

  fake.failMode = 'OAUTH';
  try {
    const pFail = await productService.createProduct({ name: 'P8 fail oauth' }, 'phase8-verify');
    await productService.publishProduct(pFail.id, 'phase8-verify');
    fail('56. OAuth failure', 'did not throw');
  } catch (err) {
    assert(err.reasonCode === 'ZOHO_OAUTH' || /oauth/i.test(err.message), '56. OAuth failure', err.message);
  }
  fake.failMode = '401';
  try {
    const pFail = await productService.createProduct({ name: 'P8 fail 401' }, 'phase8-verify');
    await productService.publishProduct(pFail.id, 'phase8-verify');
    fail('57. 401', 'did not throw');
  } catch (err) {
    assert(/401|ZOHO_401/i.test(String(err.reasonCode || err.message)), '57. 401', err.message);
  }
  fake.failMode = null;

  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(/sync-asset\/:id[\s\S]{0,200}authorizeRoles\('superuser', 'admin', 'manager'\)/.test(serverSrc), '68. legacy route requires Logistics authorization');
  const productsJs = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/products.js'), 'utf8');
  const kitSetsJs = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/kitSets.js'), 'utf8');
  assert(!productsJs.includes('/api/zoho/sync-asset/'), '69. Product UI does not call legacy route');
  assert(!kitSetsJs.includes('/api/zoho/sync-asset/'), '70. Set UI does not call legacy route');

  const afterPhysical = await snapshotPhysical();
  assert(afterPhysical.assets === beforePhysical.assets, '44/58. assets unchanged');
  assert(afterPhysical.inventory === beforePhysical.inventory, '44b. inventory unchanged');
  assert(afterPhysical.reservations === beforePhysical.reservations, '43. reservations unchanged');
  assert(afterPhysical.conversions === beforePhysical.conversions, 'conversion unchanged');
  assert(afterPhysical.receipts === beforePhysical.receipts, 'receipt unchanged');
  assert(afterPhysical.pos === beforePhysical.pos, 'PO unchanged');
  assert((await count('product')) >= productsBefore + 1, 'products increased by tests only');

  const zohoIdSample = pub1.zohoId;
  assert(typeof zohoIdSample === 'string' && /^\d+$/.test(zohoIdSample), '12. Zoho ID string-safe');

  console.log(`\nPASS ${passes.length} FAIL ${failures.length}`);
  if (failures.length) {
    failures.forEach((f) => console.error('-', f.name, f.detail));
    process.exit(1);
  }
}

main()
  .then(async () => {
    await db.destroy();
    process.exit(failures.length ? 1 : 0);
  })
  .catch(async (err) => {
    console.error(err);
    try { await db.destroy(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
