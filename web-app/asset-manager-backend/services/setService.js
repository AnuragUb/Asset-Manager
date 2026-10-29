/**
 * Phase 6 canonical Set engine.
 *
 * Coordinates Product requirements, physical allocation, reservationService, and history.
 * Does not implement reservation math, Break, conversion, or Zoho.
 * Does not call kitSetService for writes.
 */
const {
  db,
  generateSetId,
  verifySetId,
  generateRequirementId,
  verifyRequirementId,
  generateAllocationId,
  verifyAllocationId
} = require('../utils');
const reservationService = require('./reservationService');
const conversionService = require('./conversionService');
const productService = require('./productService');

const SET_STATUSES = Object.freeze(['ACTIVE', 'DISBANDED', 'ARCHIVED', 'ABSORBED']);
const RESOURCE_TYPES = Object.freeze(['ASSET', 'INVENTORY']);
const EVENT_TYPES = Object.freeze([
  'SET_CREATED',
  'REQUIREMENT_CREATED',
  'ALLOCATED',
  'DEALLOCATED',
  'SUBSTITUTED',
  'DISBANDED',
  'ARCHIVED',
  'COMMERCIALIZED',
  'PRODUCT_PUBLISHED'
]);

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function trimId(value, label) {
  const text = String(value || '').trim();
  if (!text) throw httpError(`${label} is required`, 400, 'MISSING_ID');
  return text;
}

function qtyNum(value) {
  return reservationService.qtyNum(value);
}

function roundQty(value, precision) {
  return reservationService.roundQty(value, precision);
}

function qtyEq(a, b, precision) {
  return reservationService.qtyEq(a, b, precision);
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

function mapPgError(err) {
  const message = String(err && err.message ? err.message : '');
  if (/immutable|cannot be deleted|append-only/i.test(message)) {
    return httpError(message, 409, 'IMMUTABLE');
  }
  if (err && err.code === '23505') {
    const constraint = String(err.constraint || err.detail || '');
    if (constraint.includes('set_code')) {
      return httpError('set_code must be unique', 409, 'DUPLICATE_SET_CODE');
    }
    if (constraint.includes('set_requirement_set_product')) {
      return httpError('Duplicate Product in the same Set is not allowed', 409, 'DUPLICATE_PRODUCT');
    }
    if (constraint.includes('asset_id_active')) {
      return httpError('Asset already belongs to another active Set allocation', 409, 'ASSET_IN_MANAGED_SET');
    }
    if (constraint.includes('set_inventory_active')) {
      return httpError('This inventory item already has an active allocation on this Set', 409, 'INVENTORY_ALREADY_ALLOCATED');
    }
    if (constraint.includes('set_idempotency')) {
      return err;
    }
    return httpError('Duplicate Set data', 409, 'DUPLICATE');
  }
  if (err && err.code === '23503') {
    return httpError('Referenced record not found', 404, 'NOT_FOUND');
  }
  if (err && err.code === '23514') {
    return httpError(err.message || 'Invalid Set data', 400, 'CONSTRAINT');
  }
  return err;
}

async function tablesReady(runner = db) {
  return (await runner.schema.hasTable('managed_sets'))
    && (await runner.schema.hasTable('set_requirement'))
    && (await runner.schema.hasTable('set_event'));
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Set engine tables are not installed', 503, 'NOT_INSTALLED');
  }
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) {
      throw httpError(`ID generator produced a non-canonical ${label} id: ${id}`, 500);
    }
    const existing = await trx(table).where({ id }).first();
    if (!existing) return id;
  }
  throw httpError(`Could not allocate a unique ${label} ID`, 500);
}

function idempotencyKeyOf(args) {
  const raw = args.idempotencyKey || args.idempotency_key;
  if (!raw) return null;
  const key = String(raw).trim().slice(0, 64);
  return key || null;
}

async function findIdempotency(runner, key) {
  if (!key) return null;
  const row = await runner('set_idempotency').where({ idempotency_key: key }).first();
  if (!row) return null;
  try {
    return JSON.parse(row.result_json);
  } catch (err) {
    return { raw: row.result_json };
  }
}

async function storeIdempotency(trx, key, operation, setId, result) {
  if (!key) return;
  await trx('set_idempotency').insert({
    idempotency_key: key,
    operation,
    set_id: setId,
    result_json: JSON.stringify(result),
    created_at: new Date().toISOString()
  });
}

async function writeSetEvent(trx, payload) {
  await trx('set_event').insert({
    set_id: payload.setId,
    type: payload.type,
    requirement_id: payload.requirementId || null,
    product_id: payload.productId || null,
    allocation_id: payload.allocationId || null,
    resource_type: payload.resourceType || null,
    resource_id: payload.resourceId || null,
    quantity: payload.quantity == null ? null : payload.quantity,
    reservation_id: payload.reservationId || null,
    actor: payload.actor || null,
    timestamp: new Date().toISOString(),
    note: payload.note || null,
    metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
  });
}

function computeComposition(activeAllocations) {
  const hasAsset = activeAllocations.some((c) => c.component_type === 'ASSET');
  const hasInv = activeAllocations.some((c) => c.component_type === 'INVENTORY');
  if (!hasAsset && !hasInv) return 'EMPTY';
  if (hasAsset && hasInv) return 'MIXED';
  if (hasAsset) return 'ASSET';
  return 'INVENTORY';
}

function computeCompleteness(requirements, activeAllocations) {
  const lines = (requirements || []).map((req) => {
    const allocated = (activeAllocations || [])
      .filter((a) => a.requirement_id === req.id && a.is_active)
      .reduce((sum, a) => sum + qtyNum(a.quantity), 0);
    const required = qtyNum(req.quantity);
    let state = 'MET';
    if (allocated + 1e-9 < required) state = 'SHORT';
    else if (allocated - required > 1e-9) state = 'OVER';
    return {
      requirementId: req.id,
      productId: req.product_id,
      required,
      allocated,
      unit: req.unit,
      state
    };
  });
  const anyAlloc = (activeAllocations || []).some((a) => a.is_active);
  if (!anyAlloc) {
    return { completeness: 'EMPTY', lines };
  }
  const anyShort = lines.some((l) => l.state === 'SHORT');
  const anyOver = lines.some((l) => l.state === 'OVER');
  if (anyShort) return { completeness: 'INCOMPLETE', lines };
  if (anyOver) return { completeness: 'OVERCOMPLETE', lines };
  return { completeness: 'COMPLETE', lines };
}

function wouldOvercomplete(lines, requirementId, extraQty) {
  const line = (lines || []).find((l) => l.requirementId === requirementId);
  if (!line) return false;
  return (line.allocated + qtyNum(extraQty)) - line.required > 1e-9;
}

function engineOf(requirementCount) {
  return Number(requirementCount) > 0 ? 'CANONICAL' : 'LEGACY_MANAGED';
}

function publicRequirement(row, product) {
  return {
    id: row.id,
    setId: row.set_id,
    productId: row.product_id,
    productName: product ? product.name : null,
    make: product ? product.make : null,
    model: product ? product.model : null,
    quantity: qtyNum(row.quantity),
    unit: row.unit,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    createdBy: row.created_by || null
  };
}

function publicAllocation(row, extra = {}) {
  return {
    id: row.id,
    setId: row.set_id,
    requirementId: row.requirement_id || null,
    reservationId: row.reservation_id || null,
    componentType: row.component_type,
    resourceType: row.component_type,
    resourceId: row.component_type === 'ASSET' ? row.asset_id : row.inventory_item_id,
    assetId: row.asset_id || null,
    inventoryItemId: row.inventory_item_id || null,
    quantity: qtyNum(row.quantity),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    releasedAt: row.released_at || null,
    releasedBy: row.released_by || null,
    label: extra.label || null,
    memberStatus: extra.memberStatus || null,
    productId: extra.productId || null
  };
}

function publicEvent(row) {
  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch (err) {
      metadata = { raw: row.metadata_json };
    }
  }
  return {
    id: row.id,
    setId: row.set_id,
    type: row.type,
    requirementId: row.requirement_id || null,
    productId: row.product_id || null,
    allocationId: row.allocation_id || null,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    quantity: row.quantity == null ? null : qtyNum(row.quantity),
    reservationId: row.reservation_id || null,
    actor: row.actor || null,
    timestamp: row.timestamp,
    note: row.note || null,
    metadata
  };
}

async function loadSet(runner, id) {
  const row = await runner('managed_sets').where({ id }).first()
    || await runner('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
  if (!row) throw httpError('Set not found', 404, 'NOT_FOUND');
  return row;
}

async function loadRequirements(runner, setId) {
  return runner('set_requirement').where({ set_id: setId }).orderBy('sort_order', 'asc').orderBy('created_at', 'asc');
}

async function loadAllocations(runner, setId, { activeOnly = true } = {}) {
  const q = runner('managed_set_components').where({ set_id: setId });
  if (activeOnly) q.andWhere({ is_active: true });
  return q.orderBy('sort_order', 'asc').orderBy('created_at', 'asc');
}

async function productMap(runner, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await runner('product').whereIn('id', unique);
  const map = {};
  for (const row of rows) map[row.id] = row;
  return map;
}

async function hydrateAllocation(runner, row) {
  const extra = { label: null, memberStatus: null, productId: null };
  if (row.component_type === 'ASSET' && row.asset_id) {
    const a = await runner('assets').whereRaw('LOWER(id) = LOWER(?)', [row.asset_id]).first();
    extra.label = a ? a.itemname : row.asset_id;
    extra.memberStatus = a ? a.status : null;
    extra.productId = a ? a.product_id : null;
  } else if (row.component_type === 'INVENTORY' && row.inventory_item_id) {
    const i = await runner('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [row.inventory_item_id]).first();
    extra.label = i ? i.itemname : row.inventory_item_id;
    extra.memberStatus = i ? i.status : null;
    extra.productId = i ? i.product_id : null;
  }
  return publicAllocation(row, extra);
}

function assertCanonical(setRow, requirements) {
  if (!requirements.length) {
    throw httpError(
      'This Managed Set has no requirement layer and is classified LEGACY / MANUAL REVIEW. Canonical Set mutations are refused.',
      409,
      'LEGACY_MANAGED_SET'
    );
  }
}

function assertActive(setRow) {
  if (String(setRow.status).toUpperCase() !== 'ACTIVE') {
    throw httpError(
      `Set ${setRow.id} is ${setRow.status} and cannot be mutated operationally`,
      409,
      'SET_NOT_ACTIVE'
    );
  }
}

async function formatSet(runner, setRow, { includeInactive = false } = {}) {
  const requirements = await loadRequirements(runner, setRow.id);
  const active = await loadAllocations(runner, setRow.id, { activeOnly: true });
  const products = await productMap(runner, requirements.map((r) => r.product_id));
  const { completeness, lines } = computeCompleteness(requirements, active);
  const allocations = [];
  for (const row of active) allocations.push(await hydrateAllocation(runner, row));
  const engine = engineOf(requirements.length);
  const payload = {
    id: setRow.id,
    setCode: setRow.set_code,
    name: setRow.name,
    description: setRow.description || null,
    status: setRow.status,
    sourceSetId: setRow.source_set_id || null,
    absorbedIntoSetId: setRow.absorbed_into_set_id || null,
    productId: setRow.product_id || null,
    zohoProductId: null,
    engine,
    reviewBucket: engine === 'LEGACY_MANAGED' ? 'MANUAL_REVIEW' : null,
    composition: computeComposition(active),
    completeness,
    completenessLines: lines,
    requirements: requirements.map((r) => publicRequirement(r, products[r.product_id])),
    allocations,
    createdBy: setRow.created_by || null,
    updatedBy: setRow.updated_by || null,
    createdAt: setRow.created_at,
    updatedAt: setRow.updated_at,
    archivedAt: setRow.archived_at || null
  };
  if (includeInactive) {
    const inactive = await runner('managed_set_components')
      .where({ set_id: setRow.id, is_active: false })
      .orderBy('updated_at', 'desc');
    payload.inactiveAllocations = [];
    for (const row of inactive) payload.inactiveAllocations.push(await hydrateAllocation(runner, row));
  }
  return payload;
}

async function getSet(id, opts = {}) {
  await requireTables();
  const row = await loadSet(db, id);
  return formatSet(db, row, opts);
}

async function listSets({ q, status, composition, completeness, engine } = {}) {
  await requireTables();
  let query = db('managed_sets').select('*').orderBy('updated_at', 'desc');
  const statusFilter = String(status || 'ACTIVE').toUpperCase();
  if (statusFilter && statusFilter !== 'ALL') query = query.where('status', statusFilter);
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function search() {
      this.whereILike('name', like).orWhereILike('set_code', like).orWhereILike('id', like);
    });
  }
  const rows = await query;
  const sets = [];
  for (const row of rows) {
    const formatted = await formatSet(db, row);
    if (composition && formatted.composition !== String(composition).toUpperCase()) continue;
    if (completeness && formatted.completeness !== String(completeness).toUpperCase()) continue;
    if (engine && formatted.engine !== String(engine).toUpperCase()) continue;
    sets.push(formatted);
  }
  return { sets };
}

async function listRequirements(setId) {
  await requireTables();
  const row = await loadSet(db, setId);
  const requirements = await loadRequirements(db, row.id);
  const products = await productMap(db, requirements.map((r) => r.product_id));
  return {
    setId: row.id,
    requirements: requirements.map((r) => publicRequirement(r, products[r.product_id]))
  };
}

async function getCompleteness(setId) {
  const set = await getSet(setId);
  return {
    setId: set.id,
    completeness: set.completeness,
    composition: set.composition,
    lines: set.completenessLines
  };
}

async function createSet(args = {}) {
  await requireTables();
  const name = String(args.name || '').trim();
  if (!name) throw httpError('name is required', 400, 'MISSING_NAME');
  const description = nonempty(args.description) ? String(args.description).trim() : null;
  const actor = args.actor || args.createdBy || null;
  const rawReqs = Array.isArray(args.requirements) ? args.requirements : [];
  if (!rawReqs.length) {
    throw httpError('A Set requires at least one Product requirement', 400, 'MISSING_REQUIREMENTS');
  }

  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < rawReqs.length; i += 1) {
    const item = rawReqs[i] || {};
    const productId = String(item.productId || item.product_id || '').trim();
    if (!productId) throw httpError('Each requirement needs a product_id', 400, 'PRODUCT_REQUIRED');
    if (seen.has(productId.toLowerCase())) {
      throw httpError(`Duplicate Product ${productId} in the same Set is not allowed`, 409, 'DUPLICATE_PRODUCT');
    }
    seen.add(productId.toLowerCase());
    const quantity = qtyNum(item.quantity);
    if (!(quantity > 0)) throw httpError('Requirement quantity must be greater than zero', 400, 'INVALID_QUANTITY');
    normalized.push({
      productId,
      quantity,
      sortOrder: Number.isFinite(Number(item.sortOrder ?? item.sort_order)) ? Number(item.sortOrder ?? item.sort_order) : i
    });
  }

  try {
    return await db.transaction(async (trx) => {
      const products = [];
      for (const req of normalized) {
        const product = await trx('product').where({ id: req.productId }).first();
        if (!product) throw httpError(`Product ${req.productId} not found`, 404, 'PRODUCT_NOT_FOUND');
        if (String(product.status).toUpperCase() === 'ARCHIVED') {
          throw httpError(`Product ${req.productId} is archived`, 409, 'PRODUCT_ARCHIVED');
        }
        if (String(product.origin).toUpperCase() === 'SET') {
          throw httpError(
            'A Set-derived Product cannot be a requirement of another Set',
            409,
            'SET_DERIVED_PRODUCT_NOT_A_REQUIREMENT'
          );
        }
        products.push(product);
      }

      const id = await uniquePrefixedId(trx, 'managed_sets', generateSetId, verifySetId, 'Set');
      const requestedCode = nonempty(args.setCode || args.set_code) ? String(args.setCode || args.set_code).trim() : id;
      const now = new Date().toISOString();
      await trx('managed_sets').insert({
        id,
        set_code: requestedCode,
        name,
        description,
        status: 'ACTIVE',
        zoho_product_id: null,
        product_id: null,
        source_set_id: null,
        absorbed_into_set_id: null,
        created_by: actor,
        updated_by: actor,
        created_at: now,
        updated_at: now,
        archived_at: null
      });

      await writeSetEvent(trx, {
        setId: id,
        type: 'SET_CREATED',
        actor,
        note: name,
        metadata: { set_code: requestedCode, requirement_count: normalized.length }
      });

      for (let i = 0; i < normalized.length; i += 1) {
        const req = normalized[i];
        const product = products[i];
        const unit = nonempty(product.unit) ? String(product.unit) : 'Nos';
        const reqId = await uniquePrefixedId(trx, 'set_requirement', generateRequirementId, verifyRequirementId, 'requirement');
        await trx('set_requirement').insert({
          id: reqId,
          set_id: id,
          product_id: product.id,
          quantity: req.quantity,
          unit,
          sort_order: req.sortOrder,
          created_at: now,
          created_by: actor
        });
        await writeSetEvent(trx, {
          setId: id,
          type: 'REQUIREMENT_CREATED',
          requirementId: reqId,
          productId: product.id,
          quantity: req.quantity,
          actor,
          metadata: { unit, sort_order: req.sortOrder }
        });
      }

      const created = await loadSet(trx, id);
      return formatSet(trx, created);
    });
  } catch (err) {
    throw mapPgError(err);
  }
}

async function updateSet(id, patch = {}, actor) {
  await requireTables();
  const existing = await loadSet(db, id);
  const requirements = await loadRequirements(db, existing.id);
  assertCanonical(existing, requirements);
  if (String(existing.status).toUpperCase() !== 'ACTIVE') {
    throw httpError(`Set ${existing.id} is ${existing.status} and cannot be edited`, 409, 'SET_FROZEN');
  }
  const update = { updated_at: new Date().toISOString(), updated_by: actor || existing.updated_by };
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name) throw httpError('name cannot be blank', 400, 'MISSING_NAME');
    update.name = name;
  }
  if (patch.description !== undefined) {
    update.description = nonempty(patch.description) ? String(patch.description).trim() : null;
  }
  if (patch.set_code != null || patch.setCode != null) {
    throw httpError('set_code is immutable after create', 409, 'IMMUTABLE');
  }
  if (patch.status != null || patch.requirements != null) {
    throw httpError('status and requirements cannot be edited this way', 409, 'IMMUTABLE');
  }
  try {
    await db('managed_sets').where({ id: existing.id }).update(update);
  } catch (err) {
    throw mapPgError(err);
  }
  return getSet(existing.id);
}

async function lockHoldingRow(trx, resourceType, resourceId) {
  const table = resourceType === 'ASSET' ? 'assets' : 'inventory_items';
  const row = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [resourceId]).forUpdate().first();
  if (!row) throw httpError(`${resourceType} ${resourceId} not found`, 404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function assertProductMatch(holding, requirement) {
  if (!nonempty(holding.product_id)) {
    throw httpError(
      `${holding.id} has no Product and cannot satisfy a Set requirement`,
      409,
      'PRODUCT_REQUIRED'
    );
  }
  if (String(holding.product_id) !== String(requirement.product_id)) {
    throw httpError(
      `Physical Product ${holding.product_id} does not match requirement Product ${requirement.product_id}`,
      409,
      'PRODUCT_MISMATCH'
    );
  }
}

async function allocate(setId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;

  const requirementId = trimId(args.requirementId || args.requirement_id, 'requirement_id');
  const resourceType = String(args.resourceType || args.resource_type || '').trim().toUpperCase();
  if (!RESOURCE_TYPES.includes(resourceType)) {
    throw httpError('resource_type must be ASSET or INVENTORY', 400, 'INVALID_TYPE');
  }
  const resourceId = trimId(args.resourceId || args.resource_id || args.asset_id || args.inventory_item_id, 'resource_id');
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;

      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const requirements = await loadRequirements(trx, setRow.id);
      assertCanonical(setRow, requirements);
      assertActive(setRow);

      const requirement = requirements.find((r) => r.id === requirementId);
      if (!requirement) {
        throw httpError('Requirement does not belong to this Set', 404, 'REQUIREMENT_NOT_FOUND');
      }

      const holding = await lockHoldingRow(trx, resourceType, resourceId);
      await assertProductMatch(holding, requirement);
      await conversionService.assertNoUnreturnedConversions(resourceType, holding.id, trx);

      let quantity;
      if (resourceType === 'ASSET') {
        if (args.quantity != null && args.quantity !== '' && Number(args.quantity) !== 1) {
          throw httpError('Asset allocation quantity must be exactly 1', 400, 'ASSET_QUANTITY_MUST_BE_ONE');
        }
        quantity = 1;
      } else {
        if (args.quantity == null || args.quantity === '') {
          throw httpError('quantity is required for Inventory allocation', 400, 'MISSING_QUANTITY');
        }
        quantity = qtyNum(args.quantity);
        if (!(quantity > 0)) throw httpError('Inventory quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      }

      const reserved = await reservationService.reserve({
        trx,
        resourceType,
        resourceId: holding.id,
        quantity: resourceType === 'ASSET' ? undefined : quantity,
        ownerType: 'SET',
        ownerId: setRow.id,
        actor,
        reason: reason || `Set allocation ${setRow.id}`,
        reasonCode: 'SET_ALLOCATE',
        idempotencyKey: key ? `set-alloc:${key}` : null
      });

      const allocationId = await uniquePrefixedId(
        trx,
        'managed_set_components',
        generateAllocationId,
        verifyAllocationId,
        'allocation'
      );
      const sortRow = await trx('managed_set_components').where({ set_id: setRow.id }).max('sort_order as m').first();
      const sortOrder = Number(sortRow && sortRow.m != null ? sortRow.m : -1) + 1;
      const now = new Date().toISOString();
      await trx('managed_set_components').insert({
        id: allocationId,
        set_id: setRow.id,
        component_type: resourceType,
        asset_id: resourceType === 'ASSET' ? holding.id : null,
        inventory_item_id: resourceType === 'INVENTORY' ? holding.id : null,
        quantity,
        sort_order: sortOrder,
        is_active: true,
        requirement_id: requirement.id,
        reservation_id: reserved.reservation.id,
        created_by: actor,
        created_at: now,
        updated_at: now,
        released_at: null,
        released_by: null
      });

      await trx('managed_sets').where({ id: setRow.id }).update({
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });

      const after = computeCompleteness(requirements, await loadAllocations(trx, setRow.id));
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'ALLOCATED',
        requirementId: requirement.id,
        productId: requirement.product_id,
        allocationId,
        resourceType,
        resourceId: holding.id,
        quantity,
        reservationId: reserved.reservation.id,
        actor,
        note: reason,
        metadata: { overcomplete_warning: after.completeness === 'OVERCOMPLETE' }
      });

      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = {
        set: formatted,
        allocation: formatted.allocations.find((a) => a.id === allocationId) || null,
        reservation: reserved.reservation,
        overcomplete: formatted.completeness === 'OVERCOMPLETE'
      };
      await storeIdempotency(trx, key, 'ALLOCATE', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function deactivateAllocation(trx, row, actor, now) {
  await trx('managed_set_components').where({ id: row.id }).update({
    is_active: false,
    released_at: now,
    released_by: actor || null,
    updated_at: now
  });
}

async function deallocate(setId, allocationId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;

  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;

      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const requirements = await loadRequirements(trx, setRow.id);
      assertCanonical(setRow, requirements);
      assertActive(setRow);

      const allocation = await trx('managed_set_components')
        .where({ id: allocationId, set_id: setRow.id })
        .forUpdate()
        .first();
      if (!allocation) throw httpError('Allocation not found', 404, 'NOT_FOUND');

      if (!allocation.is_active) {
        const formatted = await formatSet(trx, setRow);
        const result = { set: formatted, allocation: await hydrateAllocation(trx, allocation), alreadyInactive: true };
        await storeIdempotency(trx, key, 'DEALLOCATE', setRow.id, result);
        return result;
      }
      if (!allocation.reservation_id) {
        throw httpError('Allocation has no reservation and cannot be deallocated through the canonical engine', 409, 'LEGACY_ALLOCATION');
      }

      const resourceType = allocation.component_type;
      const resourceId = resourceType === 'ASSET' ? allocation.asset_id : allocation.inventory_item_id;
      await lockHoldingRow(trx, resourceType, resourceId);

      const reservation = await trx('reservation').where({ id: allocation.reservation_id }).forUpdate().first();
      if (!reservation) throw httpError('Reservation not found', 404, 'NOT_FOUND');
      if (reservation.owner_type !== 'SET' || String(reservation.owner_id) !== String(setRow.id)) {
        throw httpError('Reservation does not belong to this Set', 409, 'RESERVATION_OWNER_MISMATCH');
      }

      if (reservation.status === 'ACTIVE') {
        await reservationService.release({
          trx,
          id: reservation.id,
          actor,
          reason: reason || `Set deallocation ${setRow.id}`,
          reasonCode: 'SET_DEALLOCATE'
        });
      }

      const now = new Date().toISOString();
      await deactivateAllocation(trx, allocation, actor, now);
      await trx('managed_sets').where({ id: setRow.id }).update({
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'DEALLOCATED',
        requirementId: allocation.requirement_id,
        productId: requirements.find((r) => r.id === allocation.requirement_id)?.product_id || null,
        allocationId: allocation.id,
        resourceType,
        resourceId,
        quantity: qtyNum(allocation.quantity),
        reservationId: allocation.reservation_id,
        actor,
        note: reason
      });

      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = { set: formatted };
      await storeIdempotency(trx, key, 'DEALLOCATE', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function replaceAllocation(setId, allocationId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;

  const resourceType = String(args.resourceType || args.resource_type || '').trim().toUpperCase();
  if (!RESOURCE_TYPES.includes(resourceType)) {
    throw httpError('resource_type must be ASSET or INVENTORY', 400, 'INVALID_TYPE');
  }
  const resourceId = trimId(args.resourceId || args.resource_id || args.asset_id || args.inventory_item_id, 'resource_id');
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;

      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const requirements = await loadRequirements(trx, setRow.id);
      assertCanonical(setRow, requirements);
      assertActive(setRow);

      const oldRow = await trx('managed_set_components')
        .where({ id: allocationId, set_id: setRow.id })
        .forUpdate()
        .first();
      if (!oldRow || !oldRow.is_active) throw httpError('Active allocation not found', 404, 'NOT_FOUND');
      if (!oldRow.requirement_id || !oldRow.reservation_id) {
        throw httpError('Legacy allocation cannot be substituted', 409, 'LEGACY_ALLOCATION');
      }
      const requirement = requirements.find((r) => r.id === oldRow.requirement_id);
      if (!requirement) throw httpError('Requirement not found', 404, 'REQUIREMENT_NOT_FOUND');

      const oldResourceType = oldRow.component_type;
      const oldResourceId = oldResourceType === 'ASSET' ? oldRow.asset_id : oldRow.inventory_item_id;
      if (oldResourceType === resourceType && String(oldResourceId).toLowerCase() === String(resourceId).toLowerCase()) {
        throw httpError('Replacement resource must differ from the current allocation', 400, 'SAME_RESOURCE');
      }

      await lockHoldingRow(trx, oldResourceType, oldResourceId);
      const newHolding = await lockHoldingRow(trx, resourceType, resourceId);
      await assertProductMatch(newHolding, requirement);
      await conversionService.assertNoUnreturnedConversions(resourceType, newHolding.id, trx);

      let quantity;
      if (resourceType === 'ASSET') {
        if (args.quantity != null && args.quantity !== '' && Number(args.quantity) !== 1) {
          throw httpError('Asset allocation quantity must be exactly 1', 400, 'ASSET_QUANTITY_MUST_BE_ONE');
        }
        quantity = 1;
      } else {
        quantity = args.quantity == null || args.quantity === ''
          ? qtyNum(oldRow.quantity)
          : qtyNum(args.quantity);
        if (!(quantity > 0)) throw httpError('Inventory quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      }

      const newReserved = await reservationService.reserve({
        trx,
        resourceType,
        resourceId: newHolding.id,
        quantity: resourceType === 'ASSET' ? undefined : quantity,
        ownerType: 'SET',
        ownerId: setRow.id,
        actor,
        reason: reason || `Set substitution ${setRow.id}`,
        reasonCode: 'SET_SUBSTITUTE',
        idempotencyKey: key ? `set-sub-new:${key}` : null
      });

      const oldReservation = await trx('reservation').where({ id: oldRow.reservation_id }).forUpdate().first();
      if (oldReservation && oldReservation.status === 'ACTIVE') {
        if (oldReservation.owner_type !== 'SET' || String(oldReservation.owner_id) !== String(setRow.id)) {
          throw httpError('Old reservation does not belong to this Set', 409, 'RESERVATION_OWNER_MISMATCH');
        }
        await reservationService.release({
          trx,
          id: oldReservation.id,
          actor,
          reason: reason || `Set substitution release ${setRow.id}`,
          reasonCode: 'SET_SUBSTITUTE'
        });
      }

      const now = new Date().toISOString();
      await deactivateAllocation(trx, oldRow, actor, now);

      const newAllocationId = await uniquePrefixedId(
        trx,
        'managed_set_components',
        generateAllocationId,
        verifyAllocationId,
        'allocation'
      );
      const sortRow = await trx('managed_set_components').where({ set_id: setRow.id }).max('sort_order as m').first();
      await trx('managed_set_components').insert({
        id: newAllocationId,
        set_id: setRow.id,
        component_type: resourceType,
        asset_id: resourceType === 'ASSET' ? newHolding.id : null,
        inventory_item_id: resourceType === 'INVENTORY' ? newHolding.id : null,
        quantity,
        sort_order: Number(sortRow && sortRow.m != null ? sortRow.m : -1) + 1,
        is_active: true,
        requirement_id: requirement.id,
        reservation_id: newReserved.reservation.id,
        created_by: actor,
        created_at: now,
        updated_at: now
      });

      await trx('managed_sets').where({ id: setRow.id }).update({
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'SUBSTITUTED',
        requirementId: requirement.id,
        productId: requirement.product_id,
        allocationId: newAllocationId,
        resourceType,
        resourceId: newHolding.id,
        quantity,
        reservationId: newReserved.reservation.id,
        actor,
        note: reason,
        metadata: {
          replaced_allocation_id: oldRow.id,
          replaced_resource_type: oldResourceType,
          replaced_resource_id: oldResourceId,
          released_reservation_id: oldRow.reservation_id
        }
      });

      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = {
        set: formatted,
        allocation: formatted.allocations.find((a) => a.id === newAllocationId) || null,
        reservation: newReserved.reservation
      };
      await storeIdempotency(trx, key, 'SUBSTITUTE', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function releaseSetHoldings(trx, setRow, actor, reason, reasonCode) {
  const active = await trx('managed_set_components')
    .where({ set_id: setRow.id, is_active: true })
    .forUpdate();
  const now = new Date().toISOString();
  for (const row of active) {
    if (row.reservation_id) {
      const rsv = await trx('reservation').where({ id: row.reservation_id }).forUpdate().first();
      if (rsv && rsv.status === 'ACTIVE') {
        if (rsv.owner_type !== 'SET' || String(rsv.owner_id) !== String(setRow.id)) {
          throw httpError('Reservation does not belong to this Set', 409, 'RESERVATION_OWNER_MISMATCH');
        }
        const resourceType = row.component_type;
        const resourceId = resourceType === 'ASSET' ? row.asset_id : row.inventory_item_id;
        await lockHoldingRow(trx, resourceType, resourceId);
        await reservationService.release({
          trx,
          id: rsv.id,
          actor,
          reason: reason || `Set ${reasonCode || 'release'} ${setRow.id}`,
          reasonCode: reasonCode || 'SET_DISBAND'
        });
      }
    }
    await deactivateAllocation(trx, row, actor, now);
  }
  return { released: active.length, now };
}

async function disband(setId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;
      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const requirements = await loadRequirements(trx, setRow.id);
      assertCanonical(setRow, requirements);

      if (String(setRow.status).toUpperCase() === 'DISBANDED') {
        const formatted = await formatSet(trx, setRow);
        const result = { set: formatted, alreadyDisbanded: true };
        await storeIdempotency(trx, key, 'DISBAND', setRow.id, result);
        return result;
      }
      assertActive(setRow);

      const { released, now } = await releaseSetHoldings(
        trx,
        setRow,
        actor,
        reason || `Set disband ${setRow.id}`,
        'SET_DISBAND'
      );

      await trx('managed_sets').where({ id: setRow.id }).update({
        status: 'DISBANDED',
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'DISBANDED',
        actor,
        note: reason,
        metadata: { released_allocations: released }
      });
      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = { set: formatted };
      await storeIdempotency(trx, key, 'DISBAND', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function archiveSet(setId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;
  const actor = args.actor || null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;
      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const requirements = await loadRequirements(trx, setRow.id);
      assertCanonical(setRow, requirements);

      if (String(setRow.status).toUpperCase() === 'ARCHIVED') {
        const formatted = await formatSet(trx, setRow);
        const result = { set: formatted, alreadyArchived: true };
        await storeIdempotency(trx, key, 'ARCHIVE', setRow.id, result);
        return result;
      }
      assertActive(setRow);

      const activeRsv = await trx('reservation')
        .where({ owner_type: 'SET', owner_id: setRow.id, status: 'ACTIVE' });
      if (activeRsv.length) {
        throw httpError(
          'Disband the Set first. Active reservations prevent archiving.',
          409,
          'ARCHIVE_HAS_RESERVATIONS',
          { count: activeRsv.length }
        );
      }
      const activeAlloc = await trx('managed_set_components')
        .where({ set_id: setRow.id, is_active: true });
      if (activeAlloc.length) {
        throw httpError(
          'Disband the Set first. Active allocations prevent archiving.',
          409,
          'ARCHIVE_HAS_ALLOCATIONS'
        );
      }

      const now = new Date().toISOString();
      await trx('managed_sets').where({ id: setRow.id }).update({
        status: 'ARCHIVED',
        archived_at: now,
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'ARCHIVED',
        actor,
        note: args.reason || null
      });
      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = { set: formatted };
      await storeIdempotency(trx, key, 'ARCHIVE', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function deleteSet(setId, args = {}) {
  await requireTables();
  const key = idempotencyKeyOf(args);
  const existingKey = await findIdempotency(db, key);
  if (existingKey) return existingKey;
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;

  try {
    return await db.transaction(async (trx) => {
      const replay = await findIdempotency(trx, key);
      if (replay) return replay;
      const setRow = await trx('managed_sets').where({ id: setId }).forUpdate().first()
        || await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [setId]).forUpdate().first();
      if (!setRow) throw httpError('Set not found', 404, 'NOT_FOUND');
      const status = String(setRow.status).toUpperCase();
      if (status === 'ABSORBED') {
        throw httpError('An absorbed Set cannot be deleted.', 409, 'SET_ABSORBED');
      }
      if (status === 'ARCHIVED') {
        const formatted = await formatSet(trx, setRow);
        const result = { set: formatted, alreadyDeleted: true };
        await storeIdempotency(trx, key, 'ARCHIVE', setRow.id, result);
        return result;
      }

      const { released, now } = await releaseSetHoldings(
        trx,
        setRow,
        actor,
        reason || `Set delete ${setRow.id}`,
        'SET_DELETE'
      );
      await trx('managed_sets').where({ id: setRow.id }).update({
        status: 'ARCHIVED',
        archived_at: now,
        updated_at: now,
        updated_by: actor || setRow.updated_by
      });
      await writeSetEvent(trx, {
        setId: setRow.id,
        type: 'ARCHIVED',
        actor,
        note: reason || 'Deleted from Sets list',
        metadata: { via: 'DELETE', released_allocations: released }
      });
      const formatted = await formatSet(trx, await loadSet(trx, setRow.id));
      const result = { set: formatted };
      await storeIdempotency(trx, key, 'ARCHIVE', setRow.id, result);
      return result;
    });
  } catch (err) {
    if (key && err && err.code === '23505' && String(err.constraint || '').includes('set_idempotency')) {
      const replay = await findIdempotency(db, key);
      if (replay) return replay;
    }
    throw mapPgError(err);
  }
}

async function listHistory(setId) {
  await requireTables();
  const row = await loadSet(db, setId);
  const events = await db('set_event').where({ set_id: row.id }).orderBy('id', 'asc');
  return { setId: row.id, events: events.map(publicEvent) };
}

async function allocationsAt(setId, at) {
  await requireTables();
  const row = await loadSet(db, setId);
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) throw httpError('Invalid timestamp', 400, 'INVALID_TIMESTAMP');
  const rows = await db('managed_set_components')
    .where({ set_id: row.id })
    .andWhere('created_at', '<=', when.toISOString())
    .andWhere(function released() {
      this.whereNull('released_at').orWhere('released_at', '>', when.toISOString());
    });
  const out = [];
  for (const item of rows) out.push(await hydrateAllocation(db, item));
  return { setId: row.id, at: when.toISOString(), allocations: out };
}

function eligibilityReason(err) {
  return {
    eligible: false,
    reasonCode: err.reasonCode || 'INELIGIBLE',
    reason: err.message
  };
}

async function listEligibleAssets(setId, { requirementId, q, limit } = {}) {
  await requireTables();
  const setRow = await loadSet(db, setId);
  const requirements = await loadRequirements(db, setRow.id);
  assertCanonical(setRow, requirements);
  const requirement = requirements.find((r) => r.id === String(requirementId || '').trim());
  if (!requirement) throw httpError('requirement_id is required and must belong to this Set', 400, 'REQUIREMENT_NOT_FOUND');

  let query = db('assets')
    .where(function notDeleted() {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .andWhere('product_id', requirement.product_id)
    .select(
      'id', 'itemname', 'status', 'make', 'model', 'product_id',
      'assignedto', 'sentagainstdc', 'quantity_total', 'quantity_available', 'quantity_reserved',
      'lineage_status'
    );
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function search() {
      this.whereILike('itemname', like).orWhereILike('id', like);
    });
  }
  const rows = await query.orderBy('itemname', 'asc').limit(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  const eligible = [];
  const ineligible = [];
  for (const row of rows) {
    try {
      await reservationService.assertAssetEligible(db, row);
      await conversionService.assertNoUnreturnedConversions('ASSET', row.id, db);
      eligible.push({
        id: row.id,
        itemname: row.itemname,
        status: row.status,
        make: row.make,
        model: row.model,
        productId: row.product_id,
        quantityTotal: row.quantity_total,
        quantityAvailable: row.quantity_available,
        quantityReserved: row.quantity_reserved
      });
    } catch (err) {
      ineligible.push({ id: row.id, itemname: row.itemname, ...eligibilityReason(err) });
    }
  }
  return { requirementId: requirement.id, productId: requirement.product_id, eligible, ineligible };
}

async function listEligibleInventory(setId, { requirementId, q, limit } = {}) {
  await requireTables();
  const setRow = await loadSet(db, setId);
  const requirements = await loadRequirements(db, setRow.id);
  assertCanonical(setRow, requirements);
  const requirement = requirements.find((r) => r.id === String(requirementId || '').trim());
  if (!requirement) throw httpError('requirement_id is required and must belong to this Set', 400, 'REQUIREMENT_NOT_FOUND');

  let query = db('inventory_items')
    .where(function notDeleted() {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .andWhere('product_id', requirement.product_id)
    .select(
      'id', 'itemname', 'status', 'product_id', 'quantity_total', 'quantity_available',
      'quantity_reserved', 'quantity_unit', 'lineage_status', 'is_quantity_tracked'
    );
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function search() {
      this.whereILike('itemname', like).orWhereILike('id', like);
    });
  }
  const rows = await query.orderBy('itemname', 'asc').limit(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  const eligible = [];
  const ineligible = [];
  for (const row of rows) {
    try {
      reservationService.assertInventoryEligible(row);
      if (!(qtyNum(row.quantity_available) > 0)) {
        throw httpError(`INVENTORY ${row.id} has no available quantity`, 409, 'INSUFFICIENT_AVAILABLE');
      }
      eligible.push({
        id: row.id,
        itemname: row.itemname,
        status: row.status,
        productId: row.product_id,
        quantityTotal: row.quantity_total,
        quantityAvailable: row.quantity_available,
        quantityReserved: row.quantity_reserved,
        quantityUnit: row.quantity_unit
      });
    } catch (err) {
      ineligible.push({ id: row.id, itemname: row.itemname, ...eligibilityReason(err) });
    }
  }
  return { requirementId: requirement.id, productId: requirement.product_id, eligible, ineligible };
}

function notImplemented(operation) {
  return Promise.reject(httpError(
    `${operation} is not implemented in Phase 6`,
    501,
    'NOT_IMPLEMENTED'
  ));
}

async function previewCommercialize(setId) {
  await requireTables();
  const set = await getSet(setId);
  if (set.engine === 'LEGACY_MANAGED') {
    throw httpError('Legacy Managed Sets cannot be commercialized', 409, 'LEGACY_SET');
  }
  const requirementRows = await productService.loadSetRequirementRows(set.id);
  const description = productService.renderSetDescription(set.name, requirementRows);
  const fingerprint = productService.requirementFingerprint(requirementRows);
  let reuseCandidates = [];
  if (await db.schema.hasColumn('product', 'composition_hash')) {
    reuseCandidates = await db('product')
      .where({ origin: 'SET', status: 'ACTIVE', composition_hash: fingerprint })
      .select('id', 'name', 'origin', 'origin_ref', 'composition_hash');
  }
  return {
    setId: set.id,
    setName: set.name,
    existingProductId: set.productId || null,
    proposedName: set.name,
    description,
    fingerprint,
    requirements: requirementRows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      quantity: r.quantity,
      unit: r.unit,
      make: r.make,
      model: r.model
    })),
    reuseCandidates: reuseCandidates.map((p) => ({
      id: p.id,
      name: p.name,
      originRef: p.origin_ref
    })),
    productIdAllocatedOnConfirm: false
  };
}

async function commercializeSet(setId, input = {}, actor) {
  await requireTables();
  const preview = await previewCommercialize(setId);
  const setRow = await loadSet(db, setId);
  if (String(setRow.status).toUpperCase() !== 'ACTIVE' && String(setRow.status).toUpperCase() !== 'DISBANDED' && String(setRow.status).toUpperCase() !== 'ARCHIVED') {
    /* commercialization is metadata; allow ACTIVE primarily */
  }
  if (setRow.product_id) {
    const product = await productService.getProduct(setRow.product_id);
    return { idempotent: true, product, set: await getSet(setId) };
  }

  const reuseId = nonempty(input.reuseProductId || input.reuse_product_id)
    ? String(input.reuseProductId || input.reuse_product_id).trim()
    : null;
  const explicitReuse = (input.reuse === true || input.explicitReuse === true) && Boolean(reuseId);
  const proposedName = nonempty(input.name) ? String(input.name).trim() : preview.proposedName;

  const outcome = await db.transaction(async (trx) => {
    const locked = await trx('managed_sets').where({ id: setId }).forUpdate().first();
    if (!locked) throw httpError('Set not found', 404, 'NOT_FOUND');
    if (locked.product_id) {
      return { idempotent: true, reused: false, productId: locked.product_id };
    }

    let productRow;
    if (explicitReuse && reuseId) {
      const candidate = await trx('product').where({ id: reuseId }).first();
      if (!candidate) throw httpError('Reuse Product not found', 404, 'PRODUCT_NOT_FOUND');
      if (String(candidate.origin).toUpperCase() !== 'SET') {
        throw httpError('Reuse Product must have origin SET', 409, 'REUSE_NOT_SET_ORIGIN');
      }
      if (candidate.composition_hash && candidate.composition_hash !== preview.fingerprint) {
        throw httpError('Reuse Product composition does not match this Set', 409, 'REUSE_FINGERPRINT_MISMATCH');
      }
      if (!candidate.composition_hash) {
        const originReqs = await productService.loadSetRequirementRows(candidate.origin_ref, trx);
        if (productService.requirementFingerprint(originReqs) !== preview.fingerprint) {
          throw httpError('Reuse Product composition does not match this Set', 409, 'REUSE_FINGERPRINT_MISMATCH');
        }
      }
      productRow = candidate;
    } else {
      productRow = await productService.createSetOriginProduct({
        name: proposedName,
        description: preview.description,
        origin_ref: setId,
        composition_hash: preview.fingerprint
      }, actor, trx);
    }

    await trx('managed_sets').where({ id: setId }).update({
      product_id: productRow.id,
      updated_at: trx.fn.now(),
      updated_by: actor || null
    });
    await writeSetEvent(trx, {
      setId,
      type: 'COMMERCIALIZED',
      productId: productRow.id,
      actor,
      note: proposedName,
      metadata: {
        reuse: Boolean(explicitReuse && reuseId),
        fingerprint: preview.fingerprint,
        origin_ref: productRow.origin_ref
      }
    });
    return {
      idempotent: false,
      reused: Boolean(explicitReuse && reuseId),
      productId: productRow.id
    };
  });

  return {
    idempotent: outcome.idempotent,
    reused: outcome.reused,
    product: await productService.getProduct(outcome.productId),
    set: await getSet(setId)
  };
}

async function recordProductPublished(setId, productId, actor) {
  await requireTables();
  const setRow = await loadSet(db, setId);
  if (setRow.product_id && String(setRow.product_id) !== String(productId)) {
    throw httpError('Published Product does not match this Set', 409, 'PRODUCT_MISMATCH');
  }
  await writeSetEvent(db, {
    setId,
    type: 'PRODUCT_PUBLISHED',
    productId,
    actor,
    metadata: { product_id: productId }
  });
}

module.exports = {
  SET_STATUSES,
  EVENT_TYPES,
  tablesReady,
  listSets,
  getSet,
  createSet,
  updateSet,
  listRequirements,
  getCompleteness,
  allocate,
  deallocate,
  replaceAllocation,
  disband,
  archiveSet,
  deleteSet,
  listHistory,
  allocationsAt,
  listEligibleAssets,
  listEligibleInventory,
  computeCompleteness,
  computeComposition,
  previewCommercialize,
  commercializeSet,
  recordProductPublished,
  disassemble: () => notImplemented('DISASSEMBLE'),
  absorb: () => notImplemented('ABSORB')
};
