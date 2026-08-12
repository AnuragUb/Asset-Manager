/**
 * Recovery Center — platform soft-delete / restore service.
 *
 * Architecture:
 *   Entity Registry  →  Recovery Strategy  →  (future) Permission Layer
 *
 * Phase 1: Assets enabled. Other types registered as stubs until enabled.
 * Do not hardcode event type strings — use shared EVENT_TYPES.
 */
const inventoryEventSystem = require('../../shared/inventoryEventSystem');
const lifecycleModel = require('../../shared/lifecycleModel');
const {
  EVENT_TYPES,
  ENTITY_TYPES,
  createEventEnvelope,
  snapshotAsset,
  defaultNoteForType
} = inventoryEventSystem;

const {
  LIFECYCLE_STATES,
  getLifecycleDisplayName,
  resolveLifecycle
} = lifecycleModel;

/** @type {Map<string, object>} entity definitions */
const registry = new Map();

/** @type {Map<string, object>} Recovery Strategy per entity type */
const strategies = new Map();

/**
 * Optional global permission resolver.
 * Default: entity-level role list (not “everyone can restore”).
 * Future RBAC: setPermissionResolver(async ({ user, entityType, action, item }) => boolean)
 */
let permissionResolver = null;

function setPermissionResolver(fn) {
  permissionResolver = typeof fn === 'function' ? fn : null;
}

/**
 * Create a Recovery Strategy object.
 * @param {{ restore: Function, canRestore?: Function, name?: string }} spec
 */
function createRecoveryStrategy(spec = {}) {
  if (typeof spec.restore !== 'function') {
    throw new Error('Recovery Strategy requires a restore(id, ctx) function');
  }
  return Object.freeze({
    name: spec.name || 'unnamed',
    restore: spec.restore,
    canRestore: typeof spec.canRestore === 'function' ? spec.canRestore : null
  });
}

/**
 * Register (or replace) the Recovery Strategy for an entity type.
 */
function registerRecoveryStrategy(entityType, strategy) {
  const type = String(entityType || '');
  if (!type) throw new Error('entityType is required');
  const resolved = typeof strategy.restore === 'function'
    ? createRecoveryStrategy(strategy)
    : strategy;
  if (!resolved || typeof resolved.restore !== 'function') {
    throw new Error('Invalid Recovery Strategy');
  }
  strategies.set(type, resolved);

  const existing = registry.get(type);
  if (existing) {
    registry.set(type, Object.freeze({
      ...existing,
      strategy: resolved,
      restore: (id, ctx) => resolved.restore(id, ctx)
    }));
  }
  return type;
}

function getRecoveryStrategy(entityType) {
  return strategies.get(String(entityType || '')) || null;
}

function registerEntityType(definition) {
  if (!definition || !definition.type) {
    throw new Error('Recovery Center entity requires type');
  }
  const type = String(definition.type);
  const permissions = {
    // Future RBAC keys (not enforced yet beyond role allow-list)
    restorePermission: definition.permissions?.restorePermission || `recovery.${type}.restore`,
    viewPermission: definition.permissions?.viewPermission || `recovery.${type}.view`,
    // Interim role allow-list until RBAC is wired (entity-scoped — not global “any user”)
    restoreRoles: definition.permissions?.restoreRoles
      || definition.restoreRoles
      || ['superuser', 'admin', 'manager'],
    ...((definition.permissions && typeof definition.permissions === 'object') ? definition.permissions : {})
  };

  const strategy = definition.strategy
    || (typeof definition.restore === 'function'
      ? createRecoveryStrategy({ name: `${type}.restore`, restore: definition.restore })
      : strategies.get(type)
      || null);

  const entry = Object.freeze({
    ...definition,
    type,
    permissions,
    strategy: strategy || null,
    restore: strategy
      ? (id, ctx) => strategy.restore(id, ctx)
      : (typeof definition.restore === 'function' ? definition.restore : null)
  });

  registry.set(type, entry);
  if (strategy) strategies.set(type, strategy);
  return type;
}

function getEntityType(type) {
  return registry.get(String(type || '')) || null;
}

function listEntityTypes({ includeDisabled = false } = {}) {
  return [...registry.values()]
    .filter((e) => includeDisabled || e.enabled)
    .map((e) => ({
      type: e.type,
      label: e.label,
      enabled: !!e.enabled,
      supportsPermanentDelete: false,
      hasStrategy: !!(e.strategy || typeof e.restore === 'function'),
      permissions: {
        restorePermission: e.permissions?.restorePermission,
        viewPermission: e.permissions?.viewPermission,
        restoreRoles: e.permissions?.restoreRoles || []
      }
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/**
 * Entity-level authorization hook (foundation only — not full RBAC).
 * Returns true if restore is allowed for this user/entity.
 */
async function canRestoreEntity(user, entityType, item = null) {
  const def = getEntityType(entityType);
  if (!def || !def.enabled) return false;

  if (permissionResolver) {
    return !!(await permissionResolver({
      user,
      entityType,
      action: 'restore',
      item,
      entity: def
    }));
  }

  const strategy = getRecoveryStrategy(entityType) || def.strategy;
  if (strategy && typeof strategy.canRestore === 'function') {
    return !!(await strategy.canRestore(user, item, def));
  }

  const roles = def.permissions?.restoreRoles || [];
  if (!roles.length) {
    // No roles configured → deny by default (do not assume every user can restore)
    return false;
  }
  const role = String(user?.role || '').toLowerCase();
  return roles.map((r) => String(r).toLowerCase()).includes(role);
}

async function assertCanRestore(user, entityType, item = null) {
  const allowed = await canRestoreEntity(user, entityType, item);
  if (!allowed) {
    const err = new Error(`Not authorized to restore ${entityType} entities`);
    err.status = 403;
    throw err;
  }
}

function normalizeDeletedRow(entityDef, row) {
  const id = row[entityDef.idColumn] ?? row.id ?? row.ID;
  const name = row[entityDef.nameColumn] ?? row.itemname ?? row.ItemName ?? id;
  const location = entityDef.locationColumn
    ? (row[entityDef.locationColumn] ?? row.currentlocation ?? row.CurrentLocation ?? '')
    : '';
  const deletedAt = row[entityDef.deletedAtColumn || 'deleted_at'] ?? row.deleted_at ?? null;
  const deletedBy = row[entityDef.deletedByColumn || 'deleted_by'] ?? row.deleted_by ?? null;
  const reason = entityDef.reasonColumn ? (row[entityDef.reasonColumn] || null) : (row.deletion_reason || null);

  return {
    entity_type: entityDef.type,
    entity_type_label: entityDef.label,
    entity_id: String(id),
    name: String(name || id),
    original_location: String(location || ''),
    deleted_at: deletedAt,
    deleted_by: deletedBy,
    reason: reason || null,
    status: getLifecycleDisplayName(LIFECYCLE_STATES.DELETED),
    lifecycle_state: LIFECYCLE_STATES.DELETED,
    can_restore: true,
    can_permanent_delete: false,
    details_url: entityDef.detailsUrl ? entityDef.detailsUrl(id) : null,
    raw: row
  };
}

/**
 * Factory for simple table-backed soft-delete entities (is_deleted flag).
 */
function createTableAdapter(opts) {
  return {
    type: opts.type,
    label: opts.label,
    enabled: opts.enabled !== false,
    restoreRoles: opts.restoreRoles,
    permissions: opts.permissions,
    idColumn: opts.idColumn || 'id',
    nameColumn: opts.nameColumn || 'itemname',
    locationColumn: opts.locationColumn || null,
    deletedFlag: opts.deletedFlag || 'is_deleted',
    deletedAtColumn: opts.deletedAtColumn || 'deleted_at',
    deletedByColumn: opts.deletedByColumn || 'deleted_by',
    reasonColumn: opts.reasonColumn || null,
    table: opts.table,
    detailsUrl: opts.detailsUrl || null,
    async list(db, filters = {}) {
      if (!opts.table || !(await db.schema.hasTable(opts.table))) return [];
      let q = db(opts.table).where(opts.deletedFlag || 'is_deleted', 1);
      if (filters.deletedBy) {
        q = q.andWhereRaw(`LOWER(COALESCE(${opts.deletedByColumn || 'deleted_by'}, '')) = ?`, [
          String(filters.deletedBy).toLowerCase()
        ]);
      }
      if (filters.deletedFrom) {
        q = q.andWhere(opts.deletedAtColumn || 'deleted_at', '>=', filters.deletedFrom);
      }
      if (filters.deletedTo) {
        q = q.andWhere(opts.deletedAtColumn || 'deleted_at', '<=', filters.deletedTo);
      }
      if (filters.q) {
        const like = `%${String(filters.q).toLowerCase()}%`;
        q = q.andWhere(function () {
          this.whereRaw(`LOWER(CAST(${opts.idColumn || 'id'} AS TEXT)) LIKE ?`, [like]);
          if (opts.nameColumn) {
            this.orWhereRaw(`LOWER(COALESCE(${opts.nameColumn}, '')) LIKE ?`, [like]);
          }
          if (opts.locationColumn) {
            this.orWhereRaw(`LOWER(COALESCE(${opts.locationColumn}, '')) LIKE ?`, [like]);
          }
          this.orWhereRaw(`LOWER(COALESCE(${opts.deletedByColumn || 'deleted_by'}, '')) LIKE ?`, [like]);
        });
      }
      const sortCol = filters.sort === 'name'
        ? (opts.nameColumn || 'id')
        : (opts.deletedAtColumn || 'deleted_at');
      const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
      q = q.orderBy(sortCol, sortDir);
      const rows = await q;
      return rows.map((row) => normalizeDeletedRow(this, row));
    },
    async count(db) {
      if (!opts.table || !(await db.schema.hasTable(opts.table))) return 0;
      const row = await db(opts.table)
        .where(opts.deletedFlag || 'is_deleted', 1)
        .count('* as c')
        .first();
      return Number(row?.c ?? row?.count ?? 0);
    },
    async restore() {
      throw new Error(`Restore strategy not registered for ${opts.type}`);
    }
  };
}

function registerBuiltinEntityTypes() {
  registerEntityType({
    ...createTableAdapter({
      type: ENTITY_TYPES.ASSET,
      label: 'Assets',
      table: 'assets',
      enabled: true,
      idColumn: 'id',
      nameColumn: 'itemname',
      locationColumn: 'currentlocation',
      detailsUrl: (id) => `/asset/${encodeURIComponent(id)}`,
      permissions: {
        restorePermission: 'recovery.asset.restore',
        viewPermission: 'recovery.asset.view',
        restoreRoles: ['superuser', 'admin', 'manager']
      }
    }),
    restore: null
  });

  const stubs = [
    { type: ENTITY_TYPES.INVENTORY_ITEM, label: 'Inventory', table: 'inventory_items', nameColumn: 'itemname', locationColumn: 'currentlocation' },
    { type: ENTITY_TYPES.PROJECT, label: 'Projects', table: 'projects', nameColumn: 'name', locationColumn: null },
    { type: 'employee', label: 'Employees', table: 'employees', nameColumn: 'name' },
    { type: 'customer', label: 'Customers', table: null },
    { type: 'company', label: 'Companies', table: 'companies', nameColumn: 'name' },
    { type: 'manufacturer', label: 'Manufacturers', table: null },
    { type: 'model', label: 'Models', table: null },
    { type: 'category', label: 'Categories', table: 'asset_kinds', nameColumn: 'name' },
    { type: 'location', label: 'Locations', table: null },
    { type: 'template', label: 'Templates', table: null },
    { type: 'component', label: 'Components', table: 'components', nameColumn: 'itemname' },
    { type: 'box_kit', label: 'Boxes / Kits', table: null }
  ];

  for (const stub of stubs) {
    if (registry.has(stub.type)) continue;
    registerEntityType({
      ...createTableAdapter({
        type: stub.type,
        label: stub.label,
        table: stub.table,
        enabled: false,
        nameColumn: stub.nameColumn || 'name',
        locationColumn: stub.locationColumn || null,
        permissions: {
          restorePermission: `recovery.${stub.type}.restore`,
          viewPermission: `recovery.${stub.type}.view`,
          restoreRoles: ['superuser', 'admin', 'manager']
        }
      }),
      strategy: createRecoveryStrategy({
        name: `${stub.type}.stub`,
        restore: async () => {
          throw new Error(`${stub.label} recovery is not enabled yet`);
        }
      })
    });
  }
}

registerBuiltinEntityTypes();

/**
 * Wire Asset restore (avoids circular require with server.js).
 * Prefer registerRecoveryStrategy going forward.
 */
function setAssetRestoreHandler(fn) {
  registerRecoveryStrategy(ENTITY_TYPES.ASSET, createRecoveryStrategy({
    name: 'asset.restore',
    restore: fn
  }));
}

async function listDeletedItems(db, filters = {}) {
  const types = filters.entityType
    ? [getEntityType(filters.entityType)].filter(Boolean)
    : listEntityTypes({ includeDisabled: false }).map((t) => getEntityType(t.type)).filter(Boolean);

  const chunks = [];
  for (const def of types) {
    if (!def || !def.enabled || typeof def.list !== 'function') continue;
    const rows = await def.list(db, filters);
    chunks.push(...rows);
  }

  chunks.sort((a, b) => {
    const da = a.deleted_at || '';
    const dbv = b.deleted_at || '';
    if (filters.sort === 'name') {
      return String(a.name).localeCompare(String(b.name)) * (filters.sortDir === 'asc' ? 1 : -1);
    }
    return String(dbv).localeCompare(String(da)) * (filters.sortDir === 'asc' ? -1 : 1);
  });

  return chunks;
}

/**
 * Badge / summary — totals across all enabled entity types.
 * Future entity types auto-contribute when enabled + count() implemented.
 */
async function getRecoverableSummary(db) {
  const byEntityType = {};
  let total = 0;
  for (const meta of listEntityTypes({ includeDisabled: false })) {
    const def = getEntityType(meta.type);
    if (!def || !def.enabled) continue;
    let n = 0;
    if (typeof def.count === 'function') {
      n = await def.count(db);
    } else if (typeof def.list === 'function') {
      n = (await def.list(db, {})).length;
    }
    byEntityType[meta.type] = n;
    total += n;
  }
  return { total, byEntityType };
}

async function restoreEntity(db, entityType, entityId, ctx = {}) {
  const def = getEntityType(entityType);
  if (!def) {
    const err = new Error(`Unknown entity type: ${entityType}`);
    err.status = 400;
    throw err;
  }
  if (!def.enabled) {
    const err = new Error(`${def.label} is not enabled in Recovery Center yet`);
    err.status = 501;
    throw err;
  }

  await assertCanRestore(ctx.user, entityType, { entity_id: entityId });

  const strategy = getRecoveryStrategy(entityType) || def.strategy;
  const restoreFn = strategy?.restore || def.restore;
  if (typeof restoreFn !== 'function') {
    const err = new Error(`No Recovery Strategy registered for ${entityType}`);
    err.status = 501;
    throw err;
  }

  return restoreFn(entityId, {
    ...ctx,
    db,
    entityType,
    entity: def,
    strategy,
    EVENT_TYPES,
    ENTITY_TYPES,
    createEventEnvelope,
    snapshotAsset,
    defaultNoteForType
  });
}

module.exports = {
  EVENT_TYPES,
  ENTITY_TYPES,
  registerEntityType,
  getEntityType,
  listEntityTypes,
  listDeletedItems,
  getRecoverableSummary,
  restoreEntity,
  createRecoveryStrategy,
  registerRecoveryStrategy,
  getRecoveryStrategy,
  setAssetRestoreHandler,
  setPermissionResolver,
  canRestoreEntity,
  assertCanRestore,
  normalizeDeletedRow,
  createTableAdapter,
  LIFECYCLE_STATES,
  resolveLifecycle
};
