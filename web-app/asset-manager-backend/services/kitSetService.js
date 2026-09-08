const crypto = require('crypto');
const { db } = require('../utils');

/**
 * Legacy Managed Set compatibility.
 * Canonical Set writes live in setService.js.
 * POST/PUT/component/archive/restore routes on /api/managed-sets return 410.
 */

function newId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function mapPgError(err) {
  if (err && err.code === '23505') {
    if (String(err.constraint || err.detail || '').includes('asset_id_active')) {
      return httpError('Asset already belongs to another active Managed Set', 409);
    }
    if (String(err.constraint || '').includes('set_inventory_active')) {
      return httpError('This inventory item is already an active component of this Set', 409);
    }
    if (String(err.constraint || '').includes('set_code')) {
      return httpError('set_code must be unique', 409);
    }
    return httpError('Duplicate membership or set code', 409);
  }
  if (err && err.code === '23503') {
    return httpError('Referenced record not found', 404);
  }
  if (err && err.code === '23514') {
    return httpError(err.message || 'Invalid component data', 400);
  }
  return err;
}

function computeComposition(activeComponents) {
  const hasAsset = activeComponents.some((c) => c.component_type === 'ASSET');
  const hasInv = activeComponents.some((c) => c.component_type === 'INVENTORY');
  if (!hasAsset && !hasInv) return 'EMPTY';
  if (hasAsset && hasInv) return 'MIXED';
  if (hasAsset) return 'ASSET';
  return 'INVENTORY';
}

function publicManagedSet(row) {
  if (!row) return null;
  return {
    id: row.id,
    setCode: row.set_code,
    name: row.name
  };
}

async function tablesReady() {
  return db.schema.hasTable('managed_sets');
}

async function requireTables() {
  if (!(await tablesReady())) {
    throw httpError('Managed Sets tables are not installed', 503);
  }
}

async function activeComponents(setId) {
  return db('managed_set_components')
    .where({ set_id: setId, is_active: true })
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc');
}

async function hydrateComponent(row) {
  const out = { ...row, label: null };
  if (row.component_type === 'ASSET' && row.asset_id) {
    const a = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [row.asset_id]).first();
    out.label = a ? a.itemname : row.asset_id;
    out.member_status = a ? a.status : null;
    out.member_deleted = a ? Number(a.is_deleted) === 1 : true;
  } else if (row.component_type === 'INVENTORY' && row.inventory_item_id) {
    const i = await db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [row.inventory_item_id]).first();
    out.label = i ? i.itemname : row.inventory_item_id;
    out.member_status = i ? i.status : null;
    out.member_deleted = i ? Number(i.is_deleted) === 1 : true;
  }
  return out;
}

async function formatSet(setRow, { includeInactive = false } = {}) {
  const active = await activeComponents(setRow.id);
  const hydratedActive = [];
  for (const c of active) hydratedActive.push(await hydrateComponent(c));
  const payload = {
    ...setRow,
    composition: computeComposition(active),
    source: 'managed',
    components: hydratedActive,
    component_count: hydratedActive.length
  };
  if (includeInactive) {
    const inactive = await db('managed_set_components')
      .where({ set_id: setRow.id, is_active: false })
      .orderBy('updated_at', 'desc');
    payload.inactive_components = [];
    for (const c of inactive) payload.inactive_components.push(await hydrateComponent(c));
  }
  return payload;
}

async function getActiveMembershipMap(kind, ids) {
  const map = {};
  if (!ids.length || !(await tablesReady())) return map;
  const col = kind === 'ASSET' ? 'c.asset_id' : 'c.inventory_item_id';
  const rows = await db('managed_set_components as c')
    .join('managed_sets as s', 's.id', 'c.set_id')
    .where('c.is_active', true)
    .where('c.component_type', kind)
    .whereIn(db.raw(`LOWER(${col})`), ids.map((id) => String(id).toLowerCase()))
    .select('c.asset_id', 'c.inventory_item_id', 's.id as set_id', 's.set_code', 's.name', 's.status');
  for (const r of rows) {
    const key = kind === 'ASSET' ? r.asset_id : r.inventory_item_id;
    if (key) map[String(key).toLowerCase()] = publicManagedSet({ id: r.set_id, set_code: r.set_code, name: r.name });
  }
  return map;
}

async function attachManagedSetToAssets(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const ids = list.map((a) => a.ID || a.id).filter(Boolean);
  const map = await getActiveMembershipMap('ASSET', ids);
  return list.map((a) => {
    const id = String(a.ID || a.id || '').toLowerCase();
    return { ...a, managedSet: map[id] || null };
  });
}

async function attachManagedSetToInventory(items) {
  const list = Array.isArray(items) ? items : [];
  const ids = list.map((i) => i.ID || i.id).filter(Boolean);
  const map = await getActiveMembershipMap('INVENTORY', ids);
  return list.map((i) => {
    const id = String(i.ID || i.id || '').toLowerCase();
    return { ...i, managedSet: map[id] || null };
  });
}

async function listSets({ q, composition, status } = {}) {
  await requireTables();
  let query = db('managed_sets').select('*').orderBy('updated_at', 'desc');
  if (status) query = query.where('status', String(status).toUpperCase());
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function () {
      this.whereILike('name', like).orWhereILike('set_code', like);
    });
  }
  const rows = await query;
  const managed = [];
  for (const row of rows) {
    const formatted = await formatSet(row);
    if (composition && formatted.composition !== String(composition).toUpperCase()) continue;
    managed.push(formatted);
  }

  let legacy = [];
  try {
    legacy = await db('assets')
      .where('is_set', 1)
      .andWhere(function () {
        this.where('is_deleted', 0).orWhereNull('is_deleted');
      })
      .select('id', 'itemname', 'zoho_product_id', 'status', 'lastupdated', 'itemdescription');
  } catch (_) {
    legacy = [];
  }

  const legacyMapped = legacy.map((a) => ({
    id: `legacy:${a.id}`,
    set_code: a.id,
    name: a.itemname,
    composition: 'ASSET',
    status: 'ACTIVE',
    source: 'legacy_asset',
    legacy_asset_id: a.id,
    component_count: null,
    updated_at: a.lastupdated
  }));

  let combined = managed.concat(legacyMapped);
  if (q) {
    const needle = String(q).toLowerCase();
    combined = combined.filter((s) =>
      String(s.name || '').toLowerCase().includes(needle) ||
      String(s.set_code || '').toLowerCase().includes(needle)
    );
  }
  return combined;
}

async function getSet(id) {
  if (String(id).startsWith('legacy:')) {
    const assetId = String(id).slice('legacy:'.length);
    const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId]).first();
    if (!asset) throw httpError('Legacy set not found', 404);
    const children = await db('assets').whereRaw('LOWER(parentid) = LOWER(?)', [assetId]).select('id', 'itemname');
    return {
      id: `legacy:${asset.id}`,
      set_code: asset.id,
      name: asset.itemname,
      description: asset.itemdescription,
      composition: 'ASSET',
      status: 'ACTIVE',
      source: 'legacy_asset',
      legacy_asset_id: asset.id,
      components: children.map((c) => ({
        id: `legacy-comp:${c.id}`,
        component_type: 'ASSET',
        asset_id: c.id,
        quantity: 1,
        label: c.itemname,
        is_active: true,
        read_only: true
      })),
      component_count: children.length
    };
  }

  await requireTables();
  const setRow = await db('managed_sets').where('id', id).first();
  if (!setRow) throw httpError('Set not found', 404);
  return formatSet(setRow, { includeInactive: false });
}

async function createSet({ name, description, setCode, createdBy, updatedBy }) {
  await requireTables();
  if (!name || !String(name).trim()) throw httpError('name is required', 400);
  const id = newId('SET');
  const code = String(setCode || id).trim();
  if (!code) throw httpError('set_code is required', 400);
  const row = {
    id,
    set_code: code,
    name: String(name).trim(),
    description: description != null && String(description).trim() ? String(description).trim() : null,
    status: 'ACTIVE',
    zoho_product_id: null,
    created_by: createdBy || null,
    updated_by: updatedBy || createdBy || null,
    created_at: new Date(),
    updated_at: new Date(),
    archived_at: null
  };
  try {
    await db('managed_sets').insert(row);
  } catch (err) {
    throw mapPgError(err);
  }
  return getSet(id);
}

async function updateSet(id, patch, actor) {
  if (String(id).startsWith('legacy:')) {
    throw httpError('Legacy asset Sets must be edited with Make Set / Break Set', 409);
  }
  await requireTables();
  const existing = await db('managed_sets').where('id', id).first();
  if (!existing) throw httpError('Set not found', 404);
  if (existing.status === 'ARCHIVED') throw httpError('Archived set cannot be edited', 409);
  const update = { updated_at: new Date(), updated_by: actor || existing.updated_by };
  if (patch.name != null) update.name = String(patch.name).trim();
  if (patch.description !== undefined) {
    update.description = patch.description == null || String(patch.description).trim() === ''
      ? null
      : String(patch.description).trim();
  }
  if (patch.set_code != null) update.set_code = String(patch.set_code).trim();
  try {
    await db('managed_sets').where('id', id).update(update);
  } catch (err) {
    throw mapPgError(err);
  }
  return getSet(id);
}

async function assertMutableSet(setId) {
  if (String(setId).startsWith('legacy:')) {
    throw httpError('Cannot modify a legacy Set via this API', 409);
  }
  await requireTables();
  const setRow = await db('managed_sets').where('id', setId).first();
  if (!setRow) throw httpError('Set not found', 404);
  if (setRow.status === 'ARCHIVED') throw httpError('Cannot modify an archived Set', 409);
  return setRow;
}

async function nextSortOrder(setId) {
  const row = await db('managed_set_components').where({ set_id: setId }).max('sort_order as m').first();
  return Number(row && row.m != null ? row.m : -1) + 1;
}

async function addComponent(setId, body, actor) {
  const setRow = await assertMutableSet(setId);
  const type = String(body.component_type || '').toUpperCase();
  const quantity = Number(body.quantity);

  if (type === 'ASSET') {
    const assetId = String(body.asset_id || '').trim();
    if (!assetId) throw httpError('asset_id is required', 400);
    if (!Number.isFinite(quantity) || quantity !== 1) {
      throw httpError('Asset components must have quantity 1', 400);
    }
    const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
    if (!asset) throw httpError('Asset not found', 404);
    if (Number(asset.is_deleted) === 1) throw httpError('Asset is not available', 409);

    const taken = await db('managed_set_components')
      .where({ is_active: true, component_type: 'ASSET' })
      .whereRaw('LOWER(asset_id) = LOWER(?)', [asset.id.toLowerCase()])
      .first();
    if (taken && taken.set_id !== setId) {
      throw httpError(`Asset already belongs to another active Managed Set (${taken.set_id})`, 409);
    }
    if (taken && taken.set_id === setId) {
      throw httpError('Asset is already an active component of this Set', 409);
    }

    const inactive = await db('managed_set_components')
      .where({ set_id: setId, component_type: 'ASSET', is_active: false })
      .whereRaw('LOWER(asset_id) = LOWER(?)', [asset.id.toLowerCase()])
      .first();
    try {
      if (inactive) {
        await db('managed_set_components').where('id', inactive.id).update({
          is_active: true,
          quantity: 1,
          sort_order: await nextSortOrder(setId),
          updated_at: new Date()
        });
      } else {
        await db('managed_set_components').insert({
          id: newId('CMP'),
          set_id: setId,
          component_type: 'ASSET',
          asset_id: asset.id,
          inventory_item_id: null,
          quantity: 1,
          sort_order: await nextSortOrder(setId),
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    } catch (err) {
      throw mapPgError(err);
    }
  } else if (type === 'INVENTORY') {
    if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
      throw httpError('Inventory quantity must be an integer >= 1', 400);
    }
    const invId = String(body.inventory_item_id || '').trim();
    if (!invId) throw httpError('inventory_item_id is required', 400);
    const item = await db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [invId.toLowerCase()]).first();
    if (!item) throw httpError('Inventory item not found', 404);
    if (Number(item.is_deleted) === 1) throw httpError('Inventory item is not available', 409);

    const activeSame = await db('managed_set_components')
      .where({ set_id: setId, is_active: true, component_type: 'INVENTORY' })
      .whereRaw('LOWER(inventory_item_id) = LOWER(?)', [item.id.toLowerCase()])
      .first();
    const inactiveSame = await db('managed_set_components')
      .where({ set_id: setId, is_active: false, component_type: 'INVENTORY' })
      .whereRaw('LOWER(inventory_item_id) = LOWER(?)', [item.id.toLowerCase()])
      .first();
    try {
      if (activeSame) {
        await db('managed_set_components').where('id', activeSame.id).update({
          quantity,
          updated_at: new Date()
        });
      } else if (inactiveSame) {
        await db('managed_set_components').where('id', inactiveSame.id).update({
          is_active: true,
          quantity,
          sort_order: await nextSortOrder(setId),
          updated_at: new Date()
        });
      } else {
        await db('managed_set_components').insert({
          id: newId('CMP'),
          set_id: setId,
          component_type: 'INVENTORY',
          asset_id: null,
          inventory_item_id: item.id,
          quantity,
          sort_order: await nextSortOrder(setId),
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    } catch (err) {
      throw mapPgError(err);
    }
  } else {
    throw httpError('component_type must be ASSET or INVENTORY', 400);
  }

  await db('managed_sets').where('id', setId).update({
    updated_at: new Date(),
    updated_by: actor || setRow.updated_by
  });
  return getSet(setId);
}

async function removeComponent(setId, componentId, actor) {
  await assertMutableSet(setId);
  const row = await db('managed_set_components').where({ id: componentId, set_id: setId }).first();
  if (!row) throw httpError('Component not found', 404);
  if (!row.is_active) throw httpError('Component is already inactive', 409);
  await db('managed_set_components').where('id', componentId).update({
    is_active: false,
    updated_at: new Date()
  });
  await db('managed_sets').where('id', setId).update({
    updated_at: new Date(),
    updated_by: actor || null
  });
  return getSet(setId);
}

async function archiveSet(id, actor) {
  if (String(id).startsWith('legacy:')) {
    throw httpError('Archive legacy Sets via asset Recovery Center', 409);
  }
  await requireTables();
  const existing = await db('managed_sets').where('id', id).first();
  if (!existing) throw httpError('Set not found', 404);
  if (existing.status === 'ARCHIVED') throw httpError('Set is already archived', 409);
  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('managed_set_components')
      .where({ set_id: id, is_active: true })
      .update({ is_active: false, updated_at: now });
    await trx('managed_sets').where('id', id).update({
      status: 'ARCHIVED',
      archived_at: now,
      updated_at: now,
      updated_by: actor || existing.updated_by
    });
  });
  return getSet(id);
}

async function restoreSet(id, actor) {
  if (String(id).startsWith('legacy:')) {
    throw httpError('Restore legacy Sets via Recovery Center', 409);
  }
  await requireTables();
  const existing = await db('managed_sets').where('id', id).first();
  if (!existing) throw httpError('Set not found', 404);
  await db('managed_sets').where('id', id).update({
    status: 'ACTIVE',
    archived_at: null,
    updated_at: new Date(),
    updated_by: actor || existing.updated_by
  });
  return getSet(id);
}

function clampLimit(limit, fallback, max) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

async function listEligibleAssets({ q, limit } = {}) {
  await requireTables();
  const taken = await db('managed_set_components')
    .where({ is_active: true, component_type: 'ASSET' })
    .select('asset_id');
  const takenIds = taken.map((r) => String(r.asset_id).toLowerCase());
  let query = db('assets')
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .select('id', 'itemname', 'status', 'make', 'model');
  if (takenIds.length) {
    query = query.whereRaw(
      `LOWER(id) NOT IN (${takenIds.map(() => '?').join(',')})`,
      takenIds
    );
  }
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function () {
      this.whereILike('itemname', like).orWhereILike('id', like);
    });
  }
  const rows = await query.orderBy('itemname', 'asc').limit(clampLimit(limit, 200, 200));
  return rows;
}

async function listEligibleInventory({ q, limit } = {}) {
  await requireTables();
  let query = db('inventory_items')
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .select('id', 'itemname', 'status', 'quantity_total', 'quantity_available', 'quantity_unit', 'zoho_product_id');
  if (q) {
    const like = `%${q}%`;
    query = query.andWhere(function () {
      this.whereILike('itemname', like).orWhereILike('id', like);
    });
  }
  const rows = await query.orderBy('itemname', 'asc').limit(clampLimit(limit, 25, 100));
  return attachManagedSetToInventory(rows);
}

module.exports = {
  listSets,
  getSet,
  createSet,
  updateSet,
  addComponent,
  removeComponent,
  archiveSet,
  restoreSet,
  attachManagedSetToAssets,
  attachManagedSetToInventory,
  listEligibleAssets,
  listEligibleInventory
};
