const crypto = require('crypto');
const { db, generateProductId, verifyProductId } = require('../utils');

const ORIGINS = ['ZOHO', 'ASSETENGINE', 'ASSET', 'INVENTORY', 'SET'];
const STATUSES = ['ACTIVE', 'ARCHIVED'];
const LINK_ORIGINS = ['PULL', 'PUSH'];
const UPDATE_FIELDS = [
  'name',
  'description',
  'make',
  'model',
  'manufacturer',
  'hsn_code',
  'unit',
  'product_code',
  'price'
];
const FORBIDDEN_UPDATE_FIELDS = [
  'id',
  'origin',
  'origin_ref',
  'status',
  'archived_at',
  'created_at',
  'created_by'
];

function newRefId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PER-${stamp}-${rand}`;
}

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function mapPgError(err) {
  if (err && err.code === '23505') {
    const constraint = String(err.constraint || err.detail || '');
    if (constraint.includes('product_external_ref_external_unique')) {
      return httpError('That Zoho record already maps to another Product', 409);
    }
    if (constraint.includes('product_external_ref_product_unique')) {
      return httpError('This Product already maps to a Zoho record', 409);
    }
    if (constraint.includes('product_pkey') || constraint.includes('product_id')) {
      return httpError('Product ID collision', 409);
    }
    return httpError('Duplicate Product mapping', 409);
  }
  if (err && err.code === '23503') {
    return httpError('Referenced record not found', 404);
  }
  if (err && err.code === '23514') {
    return httpError(err.message || 'Invalid Product data', 400);
  }
  if (err && /is immutable/i.test(String(err.message || ''))) {
    return httpError(err.message, 400);
  }
  return err;
}

function blankToNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function asPrice(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw httpError('price must be numeric', 400);
  }
  return n;
}

function asExternalIdString(value) {
  if (value == null) {
    throw httpError('external_id is required', 400);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw httpError('external_id must be sent as a decimal string', 400);
    }
    return String(value);
  }
  const text = String(value).trim();
  if (!text) {
    throw httpError('external_id is required', 400);
  }
  return text;
}

function publicProduct(row, ref, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    make: row.make,
    model: row.model,
    manufacturer: row.manufacturer,
    hsn_code: row.hsn_code,
    unit: row.unit,
    product_code: row.product_code,
    price: row.price,
    status: row.status,
    origin: row.origin,
    origin_ref: row.origin_ref,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    composition_hash: row.composition_hash || null,
    zoho_external_id: ref && ref.external_id != null ? String(ref.external_id) : null,
    zoho_link_origin: ref && ref.link_origin ? ref.link_origin : null,
    zoho_system: ref && ref.system ? ref.system : null,
    zoho_module: ref && ref.module ? ref.module : null,
    sync_status: extras.syncStatus || deriveSyncStatus(ref, extras.openConflict),
    open_conflict: extras.openConflict || null,
    zoho_last_error: ref && ref.last_error ? ref.last_error : null
  };
}

function deriveSyncStatus(ref, openConflict) {
  if (openConflict) return 'CONFLICT';
  if (!ref || ref.external_id == null || String(ref.external_id).trim() === '') return 'UNLINKED';
  const errAt = ref.last_error_at ? new Date(ref.last_error_at).getTime() : 0;
  const pushed = ref.last_pushed_at ? new Date(ref.last_pushed_at).getTime() : 0;
  const pulled = ref.last_pulled_at ? new Date(ref.last_pulled_at).getTime() : 0;
  const lastOk = Math.max(pushed, pulled);
  if (ref.last_error && errAt && errAt > lastOk) return 'FAILED';
  if (!pushed && !pulled) return 'LINKED';
  return 'SYNCED';
}

function publicExternalRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    product_id: row.product_id,
    system: row.system,
    module: row.module,
    external_id: String(row.external_id),
    link_origin: row.link_origin,
    baseline_name: row.baseline_name,
    baseline_captured_at: row.baseline_captured_at,
    last_pushed_hash: row.last_pushed_hash,
    last_pulled_at: row.last_pulled_at,
    last_pushed_at: row.last_pushed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function tablesReady() {
  return db.schema.hasTable('product');
}

async function requireTables() {
  if (!(await tablesReady())) {
    throw httpError('Product tables are not installed', 503);
  }
}

async function zohoRefFor(productId, runner = db) {
  return runner('product_external_ref')
    .where({
      product_id: productId,
      system: 'ZOHO_CRM',
      module: 'Products'
    })
    .first();
}

async function insertProductWithRetry(payload, runner) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateProductId();
    if (!verifyProductId(id)) {
      lastErr = httpError('Generated Product ID failed checksum verification', 500);
      continue;
    }
    try {
      const rows = await runner('product').insert({ ...payload, id }).returning('*');
      return rows[0];
    } catch (err) {
      lastErr = err;
      if (err && err.code === '23505') {
        const constraint = String(err.constraint || '');
        if (constraint.includes('product_pkey') || /Key \(id\)/.test(String(err.detail || ''))) {
          continue;
        }
      }
      throw mapPgError(err);
    }
  }
  throw mapPgError(lastErr || httpError('Unable to allocate a unique Product ID', 500));
}

async function listProducts({ q, status, origin, limit, offset } = {}) {
  await requireTables();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const skip = Math.max(parseInt(offset, 10) || 0, 0);

  const applyFilters = (builder) => {
    if (status) {
      if (!STATUSES.includes(String(status).toUpperCase())) {
        throw httpError('status must be ACTIVE or ARCHIVED', 400);
      }
      builder.andWhere('p.status', String(status).toUpperCase());
    }
    if (origin) {
      if (!ORIGINS.includes(String(origin).toUpperCase())) {
        throw httpError('Invalid origin', 400);
      }
      builder.andWhere('p.origin', String(origin).toUpperCase());
    }
    const term = blankToNull(q);
    if (term) {
      const like = `%${term}%`;
      builder.andWhere((inner) => {
        inner
          .whereILike('p.name', like)
          .orWhereILike('p.id', like)
          .orWhereILike('p.make', like)
          .orWhereILike('p.model', like)
          .orWhereILike('p.product_code', like)
          .orWhereILike('r.external_id', like);
      });
    }
  };

  const base = () =>
    db('product as p').leftJoin('product_external_ref as r', function joinZoho() {
      this.on('r.product_id', '=', 'p.id')
        .andOn('r.system', '=', db.raw('?', ['ZOHO_CRM']))
        .andOn('r.module', '=', db.raw('?', ['Products']));
    });

  const countQuery = base().countDistinct('p.id as count');
  applyFilters(countQuery);
  const countRow = await countQuery.first();
  const total = Number(countRow && countRow.count ? countRow.count : 0);

  const rowsQuery = base()
    .select(
      'p.*',
      'r.external_id as zoho_external_id_col',
      'r.link_origin as zoho_link_origin_col',
      'r.system as zoho_system_col',
      'r.module as zoho_module_col',
      'r.last_pushed_at as zoho_last_pushed_at_col',
      'r.last_pulled_at as zoho_last_pulled_at_col',
      'r.last_error as zoho_last_error_col',
      'r.last_error_at as zoho_last_error_at_col'
    )
    .orderBy('p.created_at', 'desc')
    .orderBy('p.id', 'asc')
    .limit(cap)
    .offset(skip);
  applyFilters(rowsQuery);
  const rows = await rowsQuery;

  return {
    total,
    limit: cap,
    offset: skip,
    products: rows.map((row) =>
      publicProduct(row, {
        external_id: row.zoho_external_id_col,
        link_origin: row.zoho_link_origin_col,
        system: row.zoho_system_col,
        module: row.zoho_module_col,
        last_pushed_at: row.zoho_last_pushed_at_col,
        last_pulled_at: row.zoho_last_pulled_at_col,
        last_error: row.zoho_last_error_col,
        last_error_at: row.zoho_last_error_at_col
      })
    )
  };
}

async function getProduct(id) {
  await requireTables();
  const row = await db('product').where({ id }).first();
  if (!row) throw httpError('Product not found', 404);
  const ref = await zohoRefFor(id);
  const openConflict = await openNameConflict(id);
  return publicProduct(row, ref, { openConflict });
}

async function createProduct(input, actor) {
  await requireTables();
  const name = blankToNull(input && input.name);
  if (!name) throw httpError('name is required', 400);

  const origin = 'ASSETENGINE';
  const payload = {
    name,
    description: blankToNull(input && input.description),
    make: blankToNull(input && input.make),
    model: blankToNull(input && input.model),
    manufacturer: blankToNull(input && input.manufacturer),
    hsn_code: blankToNull(input && input.hsn_code),
    unit: blankToNull(input && input.unit),
    product_code: blankToNull(input && input.product_code),
    price: asPrice(input && input.price),
    status: 'ACTIVE',
    origin,
    origin_ref: null,
    archived_at: null,
    created_by: actor || null,
    updated_by: actor || null
  };

  try {
    const row = await insertProductWithRetry(payload, db);
    return publicProduct(row, null);
  } catch (err) {
    throw mapPgError(err);
  }
}

async function updateProduct(id, input, actor) {
  await requireTables();
  const existing = await db('product').where({ id }).first();
  if (!existing) throw httpError('Product not found', 404);

  const body = input && typeof input === 'object' ? input : {};
  for (const key of FORBIDDEN_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw httpError(`${key} cannot be updated on this endpoint`, 400);
    }
  }

  const patch = { updated_at: db.fn.now(), updated_by: actor || null };
  let touched = false;
  for (const field of UPDATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    touched = true;
    if (field === 'name') {
      const name = blankToNull(body.name);
      if (!name) throw httpError('name is required', 400);
      patch.name = name;
    } else if (field === 'price') {
      patch.price = asPrice(body.price);
    } else {
      patch[field] = blankToNull(body[field]);
    }
  }
  if (!touched) throw httpError('No updatable fields supplied', 400);

  try {
    const rows = await db('product').where({ id }).update(patch).returning('*');
    const ref = await zohoRefFor(id);
    return publicProduct(rows[0], ref);
  } catch (err) {
    throw mapPgError(err);
  }
}

async function archiveProduct(id, actor) {
  await requireTables();
  const existing = await db('product').where({ id }).first();
  if (!existing) throw httpError('Product not found', 404);
  if (existing.status === 'ARCHIVED') return publicProduct(existing, await zohoRefFor(id));
  try {
    const rows = await db('product')
      .where({ id })
      .update({
        status: 'ARCHIVED',
        archived_at: db.fn.now(),
        updated_at: db.fn.now(),
        updated_by: actor || null
      })
      .returning('*');
    return publicProduct(rows[0], await zohoRefFor(id));
  } catch (err) {
    throw mapPgError(err);
  }
}

async function restoreProduct(id, actor) {
  await requireTables();
  const existing = await db('product').where({ id }).first();
  if (!existing) throw httpError('Product not found', 404);
  if (existing.status === 'ACTIVE') return publicProduct(existing, await zohoRefFor(id));
  try {
    const rows = await db('product')
      .where({ id })
      .update({
        status: 'ACTIVE',
        archived_at: null,
        updated_at: db.fn.now(),
        updated_by: actor || null
      })
      .returning('*');
    return publicProduct(rows[0], await zohoRefFor(id));
  } catch (err) {
    throw mapPgError(err);
  }
}

async function listExternalRefs(productId) {
  await requireTables();
  const existing = await db('product').where({ id: productId }).first();
  if (!existing) throw httpError('Product not found', 404);
  const rows = await db('product_external_ref').where({ product_id: productId }).orderBy('created_at', 'asc');
  return rows.map(publicExternalRef);
}

async function createExternalRef(productId, input, actor) {
  await requireTables();
  const existing = await db('product').where({ id: productId }).first();
  if (!existing) throw httpError('Product not found', 404);

  const system = blankToNull(input && input.system) || 'ZOHO_CRM';
  const moduleName = blankToNull(input && input.module) || 'Products';
  const linkOrigin = blankToNull(input && input.link_origin);
  if (!LINK_ORIGINS.includes(linkOrigin)) {
    throw httpError('link_origin must be PULL or PUSH', 400);
  }
  const externalId = asExternalIdString(input && input.external_id);

  const alreadyProduct = await db('product_external_ref')
    .where({ product_id: productId, system, module: moduleName })
    .first();
  if (alreadyProduct) {
    throw httpError('This Product already maps to a Zoho record', 409);
  }
  const alreadyExternal = await db('product_external_ref')
    .where({ system, module: moduleName, external_id: externalId })
    .first();
  if (alreadyExternal) {
    throw httpError('That Zoho record already maps to another Product', 409);
  }

  const now = new Date();
  const payload = {
    id: newRefId(),
    product_id: productId,
    system,
    module: moduleName,
    external_id: externalId,
    link_origin: linkOrigin,
    baseline_name: blankToNull(input && input.baseline_name) || existing.name,
    baseline_captured_at: now,
    last_pushed_hash: null,
    last_pulled_at: linkOrigin === 'PULL' ? now : null,
    last_pushed_at: linkOrigin === 'PUSH' ? now : null
  };

  try {
    const rows = await db('product_external_ref').insert(payload).returning('*');
    await db('product').where({ id: productId }).update({
      updated_at: db.fn.now(),
      updated_by: actor || null
    });
    return publicExternalRef(rows[0]);
  } catch (err) {
    throw mapPgError(err);
  }
}

function mutationsEnabled() {
  return String(process.env.PHASE8_MUTATIONS || '1') !== '0';
}

function requireMutations() {
  if (!mutationsEnabled()) {
    throw httpError('Phase 8 Product/Zoho mutations are disabled', 503, 'PHASE8_DISABLED');
  }
}

let zohoGateway = null;

function setZohoGateway(gateway) {
  zohoGateway = gateway;
}

function zoho() {
  return zohoGateway || require('./zohoService');
}

function newConflictId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PNC-${stamp}-${rand}`;
}

function namesEqual(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

function canonicalRequirements(rows) {
  return (rows || [])
    .map((row) => ({
      product_id: String(row.product_id || row.productId || ''),
      quantity: String(row.quantity),
      unit: String(row.unit || '')
    }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id) || a.unit.localeCompare(b.unit));
}

function requirementFingerprint(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRequirements(rows))).digest('hex');
}

function renderSetDescription(setName, requirementRows) {
  const header = String(setName || 'SET').trim().toUpperCase();
  const lines = [...(requirementRows || [])].sort((a, b) => {
    const sa = Number(a.sort_order != null ? a.sort_order : a.sortOrder) || 0;
    const sb = Number(b.sort_order != null ? b.sort_order : b.sortOrder) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.product_id || '').localeCompare(String(b.product_id || ''));
  });
  const body = lines.map((row) => {
    const name = row.product_name || row.productName || row.product_id;
    const qty = row.quantity;
    const unit = row.unit ? ` ${row.unit}` : '';
    const mm = [row.make, row.model].filter((v) => v != null && String(v).trim() !== '').join(' / ');
    const desc = row.description && String(row.description).trim() ? String(row.description).trim() : '';
    let line = `${name} × ${qty}${unit}`;
    if (mm) line += ` — ${mm}`;
    if (desc) line += ` — ${desc}`;
    return line;
  });
  return [header, ...body].join('\n');
}

function compositionCanonical(product, requirementRows) {
  if (String(product.origin) === 'SET') {
    return JSON.stringify({
      fingerprint: requirementFingerprint(requirementRows),
      description: String(product.description || ''),
      requirements: (requirementRows || []).map((row) => ({
        product_id: String(row.product_id),
        quantity: String(row.quantity),
        unit: String(row.unit || ''),
        name: String(row.product_name || row.productName || ''),
        make: String(row.make || ''),
        model: String(row.model || ''),
        description: String(row.description || '')
      }))
    });
  }
  return '';
}

function publishHash(product, { includeName, requirementRows } = {}) {
  const body = {
    name: includeName ? String(product.name || '') : '',
    description: String(product.description || ''),
    make: String(product.make || ''),
    model: String(product.model || ''),
    hsn_code: String(product.hsn_code || ''),
    product_code: String(product.product_code || ''),
    composition: compositionCanonical(product, requirementRows || [])
  };
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function zohoWriteFields(product, { includeName }) {
  const fields = {
    Description: product.description || ''
  };
  if (includeName) fields.Product_Name = product.name;
  if (product.make) fields.Make = product.make;
  if (product.model) fields.Model = product.model;
  if (product.hsn_code) fields.HSN_Code = product.hsn_code;
  if (product.product_code) fields.Product_Code = product.product_code;
  return fields;
}

async function openNameConflict(productId, runner = db) {
  const hasTable = await runner.schema.hasTable('product_name_conflict');
  if (!hasTable) return null;
  const row = await runner('product_name_conflict')
    .where({ product_id: productId, status: 'OPEN' })
    .first();
  if (!row) return null;
  return {
    id: row.id,
    product_id: row.product_id,
    external_ref_id: row.external_ref_id,
    baseline_name: row.baseline_name,
    ae_name: row.ae_name,
    zoho_name: row.zoho_name,
    status: row.status,
    resolution: row.resolution || null,
    detected_at: row.detected_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    final_value: row.final_value
  };
}

function compareName(baseline, aeName, zohoName) {
  const B = String(baseline || '').trim();
  const A = String(aeName || '').trim();
  const Z = String(zohoName || '').trim();
  if (namesEqual(A, B) && namesEqual(Z, B)) return { action: 'NOOP' };
  if (!namesEqual(A, B) && namesEqual(Z, B)) return { action: 'AE_WINS', baseline: A };
  if (namesEqual(A, B) && !namesEqual(Z, B)) return { action: 'ZOHO_WINS', baseline: Z };
  if (!namesEqual(A, B) && !namesEqual(Z, B) && namesEqual(A, Z)) return { action: 'CONVERGE', baseline: A };
  return { action: 'NAME_CONFLICT', aeName: A, zohoName: Z, baseline: B };
}

async function loadSetRequirementRows(setId, runner = db) {
  const requirements = await runner('set_requirement').where({ set_id: setId }).orderBy('sort_order', 'asc');
  const ids = requirements.map((r) => r.product_id);
  const products = ids.length
    ? await runner('product').whereIn('id', ids)
    : [];
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  return requirements.map((r) => {
    const product = byId[r.product_id] || {};
    return {
      id: r.id,
      product_id: r.product_id,
      quantity: r.quantity,
      unit: r.unit,
      sort_order: r.sort_order,
      product_name: product.name || r.product_id,
      make: product.make || null,
      model: product.model || null,
      description: product.description || null
    };
  });
}

async function upsertCatalogFromZoho(zohoProduct) {
  if (!zohoProduct || !zohoProduct.zohoId) return;
  const zohoProductId = String(zohoProduct.zohoId);
  const catalogData = {
    product_name: zohoProduct.name || 'Unnamed Product',
    unit_price: zohoProduct.unitPrice == null || zohoProduct.unitPrice === '' ? 0 : Number(zohoProduct.unitPrice) || 0,
    description: zohoProduct.description || null,
    sku: zohoProduct.productCode || null,
    make: zohoProduct.make || null,
    model: zohoProduct.model || null,
    hsn_code: zohoProduct.hsnCode || null,
    last_synced_at: new Date().toISOString()
  };
  const existing = await db('zoho_catalog').where('zoho_product_id', zohoProductId).first();
  if (existing) {
    await db('zoho_catalog').where('zoho_product_id', zohoProductId).update(catalogData);
  } else {
    await db('zoho_catalog').insert({ ...catalogData, zoho_product_id: zohoProductId });
  }
}

async function recordPublishFailure(productId, err) {
  const ref = await zohoRefFor(productId);
  if (!ref) return;
  try {
    await db('product_external_ref').where({ id: ref.id }).update({
      last_error: String(err && err.message ? err.message : err).slice(0, 2000),
      last_error_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  } catch (_) {
    /* ignore */
  }
}

async function clearPublishError(refId) {
  if (!refId) return;
  if (!(await db.schema.hasColumn('product_external_ref', 'last_error'))) return;
  await db('product_external_ref').where({ id: refId }).update({
    last_error: null,
    last_error_at: null,
    updated_at: db.fn.now()
  });
}

async function insertMappingAfterCreate(product, zohoId, actor) {
  const now = new Date();
  const payload = {
    id: newRefId(),
    product_id: product.id,
    system: 'ZOHO_CRM',
    module: 'Products',
    external_id: String(zohoId),
    link_origin: 'PUSH',
    baseline_name: product.name,
    baseline_captured_at: now,
    last_pushed_hash: null,
    last_pulled_at: null,
    last_pushed_at: now
  };
  try {
    const rows = await db('product_external_ref').insert(payload).returning('*');
    return { ref: rows[0], orphan: false };
  } catch (err) {
    const mapped = mapPgError(err);
    const alreadyProduct = await zohoRefFor(product.id);
    if (alreadyProduct) {
      return { ref: alreadyProduct, orphan: true, orphanZohoId: String(zohoId), concurrent: true };
    }
    const alreadyExternal = await db('product_external_ref')
      .where({ system: 'ZOHO_CRM', module: 'Products', external_id: String(zohoId) })
      .first();
    if (alreadyExternal) {
      throw httpError(
        'Zoho Product ID is already mapped to another AssetEngine Product. The newly created Zoho Product was not attached.',
        409,
        'ORPHAN_ZOHO_PRODUCT',
        { zohoId: String(zohoId), ownerProductId: alreadyExternal.product_id }
      );
    }
    throw mapped;
  }
}

async function publishProduct(productId, actor) {
  await requireTables();
  requireMutations();
  const product = await db('product').where({ id: productId }).first();
  if (!product) throw httpError('Product not found', 404);
  if (String(product.status).toUpperCase() !== 'ACTIVE') {
    throw httpError('Only ACTIVE Products can be published', 409, 'PRODUCT_NOT_ACTIVE');
  }

  let requirementRows = [];
  if (String(product.origin) === 'SET' && product.origin_ref) {
    requirementRows = await loadSetRequirementRows(product.origin_ref);
  }

  let ref = await zohoRefFor(productId);
  let openConflict = await openNameConflict(productId);
  let includeName = !openConflict;

  if (ref) {
    try {
      const remote = await zoho().getProductRecord(String(ref.external_id));
      const decision = compareName(ref.baseline_name, product.name, remote.name);
      if (decision.action === 'NAME_CONFLICT' && !openConflict) {
        await db('product_name_conflict').insert({
          id: newConflictId(),
          product_id: product.id,
          external_ref_id: ref.id,
          baseline_name: ref.baseline_name,
          ae_name: product.name,
          zoho_name: remote.name,
          status: 'OPEN',
          detected_at: new Date()
        });
        includeName = false;
        openConflict = await openNameConflict(productId);
      }
      if (decision.action === 'ZOHO_WINS' && !openConflict) {
        await db('product').where({ id: product.id }).update({
          name: remote.name,
          updated_at: db.fn.now(),
          updated_by: actor || null
        });
        product.name = remote.name;
        await db('product_external_ref').where({ id: ref.id }).update({
          baseline_name: remote.name,
          baseline_captured_at: db.fn.now(),
          updated_at: db.fn.now()
        });
        ref.baseline_name = remote.name;
      }
      if (decision.action === 'AE_WINS' || decision.action === 'CONVERGE') {
        await db('product_external_ref').where({ id: ref.id }).update({
          baseline_name: decision.baseline,
          baseline_captured_at: db.fn.now(),
          updated_at: db.fn.now()
        });
      }
    } catch (err) {
      if (err && err.reasonCode === 'NAME_CONFLICT') throw err;
      if (err && err.code === 'ZOHO_PRODUCT_NOT_FOUND') {
        throw httpError(
          'External mapping points to a Zoho Product that no longer exists',
          409,
          'MAPPING_INCONSISTENT',
          { zohoId: String(ref.external_id) }
        );
      }
      throw err;
    }
  }

  const hash = publishHash(product, { includeName: includeName && !openConflict, requirementRows });
  if (ref && ref.last_pushed_hash && ref.last_pushed_hash === hash) {
    return {
      skipped: true,
      reason: 'UNCHANGED_HASH',
      mode: 'SKIP',
      zohoId: String(ref.external_id),
      product: await getProduct(product.id)
    };
  }

  const fields = zohoWriteFields(product, { includeName: includeName && !openConflict });
  let result;
  try {
    if (ref) {
      result = await zoho().updateProductRecord(String(ref.external_id), fields);
      await zoho().logSync({
        module: 'Products',
        operation: 'PUSH_PRODUCT_UPDATE',
        status: 'SUCCESS',
        localId: product.id,
        zohoId: result.zohoId,
        payload: fields,
        response: result
      });
      await db('product_external_ref').where({ id: ref.id }).update({
        last_pushed_hash: hash,
        last_pushed_at: db.fn.now(),
        last_error: null,
        last_error_at: null,
        updated_at: db.fn.now()
      });
      if (includeName && !openConflict) {
        await db('product_external_ref').where({ id: ref.id }).update({
          baseline_name: product.name,
          baseline_captured_at: db.fn.now()
        });
      }
    } else {
      result = await zoho().createProductRecord(fields);
      const mapped = await insertMappingAfterCreate(product, result.zohoId, actor);
      if (mapped.concurrent && mapped.ref) {
        result = await zoho().updateProductRecord(String(mapped.ref.external_id), fields);
        await zoho().logSync({
          module: 'Products',
          operation: 'PUSH_PRODUCT_UPDATE',
          status: 'SUCCESS',
          localId: product.id,
          zohoId: result.zohoId,
          payload: { ...fields, concurrent: true, orphanZohoId: mapped.orphanZohoId },
          response: result
        });
        ref = mapped.ref;
      } else {
        ref = mapped.ref;
        await zoho().logSync({
          module: 'Products',
          operation: 'PUSH_PRODUCT_CREATE',
          status: 'SUCCESS',
          localId: product.id,
          zohoId: String(result.zohoId),
          payload: fields,
          response: result
        });
      }
      await db('product_external_ref').where({ id: ref.id }).update({
        last_pushed_hash: hash,
        last_pushed_at: db.fn.now(),
        last_error: null,
        last_error_at: null,
        baseline_name: product.name,
        baseline_captured_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      if (mapped && mapped.orphan) {
        await zoho().logSync({
          module: 'Products',
          operation: 'ORPHAN_ZOHO_PRODUCT',
          status: 'ERROR',
          localId: product.id,
          zohoId: mapped.orphanZohoId,
          errorMessage: 'Concurrent publish created an extra Zoho Product that was not attached'
        });
      }
    }
  } catch (err) {
    await zoho().logSync({
      module: 'Products',
      operation: ref ? 'PUBLISH_PRODUCT_ERROR' : 'PUBLISH_PRODUCT_ERROR',
      status: 'ERROR',
      localId: product.id,
      payload: fields,
      errorMessage: err.message
    });
    await recordPublishFailure(product.id, err);
    const classified = zoho().classifyZohoError ? zoho().classifyZohoError(err) : 'ERROR';
    if (classified === 'OAUTH') {
      throw httpError(err.message || 'Zoho OAuth failure', 502, 'ZOHO_OAUTH');
    }
    err.statusCode = err.statusCode || 502;
    err.reasonCode = err.reasonCode || `ZOHO_${classified}`;
    throw err;
  }

  if (String(product.origin) === 'SET' && product.origin_ref) {
    const setService = require('./setService');
    if (typeof setService.recordProductPublished === 'function') {
      await setService.recordProductPublished(product.origin_ref, product.id, actor);
    }
  }

  return {
    skipped: false,
    mode: result.mode,
    zohoId: String(result.zohoId),
    product: await getProduct(product.id)
  };
}

async function refreshProductFromZoho(productId, actor) {
  await requireTables();
  requireMutations();
  const product = await db('product').where({ id: productId }).first();
  if (!product) throw httpError('Product not found', 404);
  const ref = await zohoRefFor(productId);
  if (!ref) throw httpError('Product is not linked to a Zoho Product', 409, 'UNLINKED');

  let remote;
  try {
    remote = await zoho().getProductRecord(String(ref.external_id));
  } catch (err) {
    if (err && err.code === 'ZOHO_PRODUCT_NOT_FOUND') {
      throw httpError(
        'External mapping points to a Zoho Product that no longer exists',
        409,
        'MAPPING_INCONSISTENT',
        { zohoId: String(ref.external_id) }
      );
    }
    throw err;
  }

  await upsertCatalogFromZoho(remote);
  await zoho().logSync({
    module: 'Products',
    operation: 'PULL_PRODUCT_REFRESH',
    status: 'SUCCESS',
    localId: product.id,
    zohoId: remote.zohoId
  });

  const openConflict = await openNameConflict(productId);
  const patch = {
    updated_at: db.fn.now(),
    updated_by: actor || null
  };
  let nameChanged = false;
  if (!openConflict) {
    const decision = compareName(ref.baseline_name, product.name, remote.name);
    if (decision.action === 'NAME_CONFLICT') {
      await db('product_name_conflict').insert({
        id: newConflictId(),
        product_id: product.id,
        external_ref_id: ref.id,
        baseline_name: ref.baseline_name,
        ae_name: product.name,
        zoho_name: remote.name,
        status: 'OPEN',
        detected_at: new Date()
      });
    } else if (decision.action === 'ZOHO_WINS') {
      patch.name = remote.name;
      nameChanged = true;
      await db('product_external_ref').where({ id: ref.id }).update({
        baseline_name: remote.name,
        baseline_captured_at: db.fn.now()
      });
    } else if (decision.action === 'AE_WINS' || decision.action === 'CONVERGE' || decision.action === 'NOOP') {
      if (decision.baseline) {
        await db('product_external_ref').where({ id: ref.id }).update({
          baseline_name: decision.baseline || product.name,
          baseline_captured_at: db.fn.now()
        });
      }
    }
  }

  if (!product.product_code && remote.productCode) {
    patch.product_code = remote.productCode;
  }

  await db('product').where({ id: product.id }).update(patch);
  await db('product_external_ref').where({ id: ref.id }).update({
    last_pulled_at: db.fn.now(),
    last_error: null,
    last_error_at: null,
    updated_at: db.fn.now()
  });

  return {
    nameChanged,
    zohoId: String(remote.zohoId),
    product: await getProduct(product.id)
  };
}

async function listNameConflicts(productId) {
  await requireTables();
  const existing = await db('product').where({ id: productId }).first();
  if (!existing) throw httpError('Product not found', 404);
  const rows = await db('product_name_conflict').where({ product_id: productId }).orderBy('detected_at', 'desc');
  return rows.map((row) => ({
    id: row.id,
    product_id: row.product_id,
    external_ref_id: row.external_ref_id,
    baseline_name: row.baseline_name,
    ae_name: row.ae_name,
    zoho_name: row.zoho_name,
    status: row.status,
    resolution: row.resolution || null,
    detected_at: row.detected_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    final_value: row.final_value
  }));
}

async function resolveNameConflict(productId, conflictId, resolution, actor) {
  await requireTables();
  requireMutations();
  const choice = String(resolution || '').toUpperCase();
  if (choice !== 'AE_WINS' && choice !== 'ZOHO_WINS') {
    throw httpError('resolution must be AE_WINS or ZOHO_WINS', 400, 'INVALID_RESOLUTION');
  }
  const product = await db('product').where({ id: productId }).first();
  if (!product) throw httpError('Product not found', 404);
  const conflict = await db('product_name_conflict').where({ id: conflictId, product_id: productId }).first();
  if (!conflict) throw httpError('Conflict not found', 404);
  if (conflict.status === 'RESOLVED') {
    return { conflict: (await listNameConflicts(productId)).find((c) => c.id === conflictId), product: await getProduct(productId) };
  }
  const finalValue = choice === 'AE_WINS' ? conflict.ae_name : conflict.zoho_name;
  if (choice === 'ZOHO_WINS') {
    await db('product').where({ id: productId }).update({
      name: finalValue,
      updated_at: db.fn.now(),
      updated_by: actor || null
    });
  }
  const ref = await zohoRefFor(productId);
  if (ref) {
    await db('product_external_ref').where({ id: ref.id }).update({
      baseline_name: finalValue,
      baseline_captured_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  }
  const patch = {
    status: 'RESOLVED',
    resolution: choice,
    resolved_at: db.fn.now(),
    resolved_by: actor || null,
    final_value: finalValue
  };
  await db('product_name_conflict').where({ id: conflictId }).update(patch);
  return {
    conflict: (await listNameConflicts(productId)).find((c) => c.id === conflictId),
    product: await getProduct(productId)
  };
}

async function createProductFromCatalog(zohoProductId, actor) {
  await requireTables();
  requireMutations();
  const externalId = asExternalIdString(zohoProductId);
  const existingMap = await db('product_external_ref')
    .where({ system: 'ZOHO_CRM', module: 'Products', external_id: externalId })
    .first();
  if (existingMap) {
    throw httpError('That Zoho record already maps to another Product', 409, 'DUPLICATE_MAPPING');
  }
  const catalog = await db('zoho_catalog').where({ zoho_product_id: externalId }).first();
  if (!catalog) throw httpError('Zoho catalog row not found. Pull the catalog first.', 404, 'CATALOG_NOT_FOUND');

  const payload = {
    name: catalog.product_name || 'Unnamed Product',
    description: catalog.description || null,
    make: catalog.make || null,
    model: catalog.model || null,
    manufacturer: null,
    hsn_code: catalog.hsn_code || null,
    unit: null,
    product_code: catalog.sku || null,
    price: null,
    status: 'ACTIVE',
    origin: 'ZOHO',
    origin_ref: null,
    archived_at: null,
    created_by: actor || null,
    updated_by: actor || null
  };
  const row = await insertProductWithRetry(payload, db);
  const ref = await createExternalRef(row.id, {
    system: 'ZOHO_CRM',
    module: 'Products',
    external_id: externalId,
    link_origin: 'PULL',
    baseline_name: row.name
  }, actor);
  return { product: await getProduct(row.id), ref };
}

async function listUnlinkedCatalog() {
  await requireTables();
  const catalog = await db('zoho_catalog').orderBy('product_name', 'asc');
  const mapped = await db('product_external_ref')
    .where({ system: 'ZOHO_CRM', module: 'Products' })
    .select('external_id');
  const mappedIds = new Set(mapped.map((r) => String(r.external_id)));
  return catalog
    .filter((row) => !mappedIds.has(String(row.zoho_product_id)))
    .map((row) => ({
      zoho_product_id: String(row.zoho_product_id),
      product_name: row.product_name,
      make: row.make,
      model: row.model,
      sku: row.sku,
      hsn_code: row.hsn_code
    }));
}

async function listLegacyAssetZohoReport() {
  const assets = await db('assets')
    .whereNotNull('zoho_product_id')
    .whereRaw("btrim(zoho_product_id) <> ''")
    .select('id', 'itemname', 'zoho_product_id', 'product_id');
  const refs = await db('product_external_ref')
    .where({ system: 'ZOHO_CRM', module: 'Products' })
    .select('external_id', 'product_id');
  const byExt = new Map(refs.map((r) => [String(r.external_id), r.product_id]));
  return assets
    .filter((a) => !byExt.has(String(a.zoho_product_id)))
    .map((a) => ({
      asset_id: a.id,
      itemname: a.itemname,
      zoho_product_id: String(a.zoho_product_id),
      product_id: a.product_id || null
    }));
}

async function inspectProductFields() {
  const fields = await zoho().inspectModuleFields('Products');
  const serialized = zoho().serializeInspectedFields
    ? zoho().serializeInspectedFields(fields)
    : (fields || []).map((f) => ({
      label: f.getFieldLabel && f.getFieldLabel(),
      apiName: f.getAPIName && f.getAPIName()
    }));
  return {
    inspectedAt: require('./zohoProductFields').INSPECTED_AT,
    writeFields: require('./zohoProductFields').WRITE_FIELDS,
    neverSend: require('./zohoProductFields').NEVER_SEND,
    presentButUnmapped: require('./zohoProductFields').PRESENT_BUT_UNMAPPED,
    fields: serialized
  };
}

async function createSetOriginProduct(input, actor, runner = db) {
  await requireTables();
  const name = blankToNull(input && input.name);
  if (!name) throw httpError('name is required', 400);
  const originRef = blankToNull(input && input.origin_ref);
  if (!originRef) throw httpError('origin_ref is required for SET provenance', 400);
  const payload = {
    name,
    description: blankToNull(input && input.description),
    make: null,
    model: null,
    manufacturer: null,
    hsn_code: null,
    unit: null,
    product_code: null,
    price: null,
    status: 'ACTIVE',
    origin: 'SET',
    origin_ref: originRef,
    archived_at: null,
    created_by: actor || null,
    updated_by: actor || null
  };
  if (await runner.schema.hasColumn('product', 'composition_hash')) {
    payload.composition_hash = blankToNull(input && input.composition_hash);
  }
  return insertProductWithRetry(payload, runner);
}

module.exports = {
  tablesReady,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
  listExternalRefs,
  createExternalRef,
  publicProduct,
  UPDATE_FIELDS,
  FORBIDDEN_UPDATE_FIELDS,
  setZohoGateway,
  publishProduct,
  refreshProductFromZoho,
  listNameConflicts,
  resolveNameConflict,
  compareName,
  publishHash,
  requirementFingerprint,
  renderSetDescription,
  loadSetRequirementRows,
  createProductFromCatalog,
  listUnlinkedCatalog,
  listLegacyAssetZohoReport,
  inspectProductFields,
  insertProductWithRetry,
  createSetOriginProduct,
  deriveSyncStatus
};
