/**
 * Recovery Center — platform soft-delete / restore registry.
 *
 * Entity adapters register here so the UI and APIs stay entity-agnostic.
 * Phase 1: Assets enabled. Other types are registered as stubs (not listed until enabled).
 *
 * Do not hardcode event type strings — use shared EVENT_TYPES.
 */
const inventoryEventSystem = require('../../shared/inventoryEventSystem');
const {
  EVENT_TYPES,
  ENTITY_TYPES,
  createEventEnvelope,
  snapshotAsset,
  defaultNoteForType
} = inventoryEventSystem;

/** @type {Map<string, object>} */
const registry = new Map();

function registerEntityType(definition) {
  if (!definition || !definition.type) {
    throw new Error('Recovery Center entity requires type');
  }
  registry.set(String(definition.type), Object.freeze({ ...definition }));
  return definition.type;
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
      restoreRoles: e.restoreRoles || ['superuser', 'admin', 'manager']
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
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
    status: 'Soft Deleted',
    can_restore: true,
    can_permanent_delete: false,
    details_url: entityDef.detailsUrl ? entityDef.detailsUrl(id) : null,
    raw: row
  };
}

/**
 * Factory for simple table-backed soft-delete entities (is_deleted flag).
 * Complex restore (assets) overrides restore().
 */
function createTableAdapter(opts) {
  return {
    type: opts.type,
    label: opts.label,
    enabled: opts.enabled !== false,
    restoreRoles: opts.restoreRoles || ['superuser', 'admin', 'manager'],
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
    async restore() {
      throw new Error(`Restore not implemented for ${opts.type}`);
    }
  };
}

function registerBuiltinEntityTypes() {
  // --- Phase 1 enabled ---
  registerEntityType({
    ...createTableAdapter({
      type: ENTITY_TYPES.ASSET,
      label: 'Assets',
      table: 'assets',
      enabled: true,
      idColumn: 'id',
      nameColumn: 'itemname',
      locationColumn: 'currentlocation',
      detailsUrl: (id) => `/asset/${encodeURIComponent(id)}`
    }),
    // restore injected later via setAssetRestoreHandler to avoid circular deps with server.js
    restore: null
  });

  // --- Future stubs (architecture only; not listed while disabled) ---
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
        locationColumn: stub.locationColumn || null
      }),
      restore: async () => {
        throw new Error(`${stub.label} recovery is not enabled yet`);
      }
    });
  }
}

registerBuiltinEntityTypes();

let assetRestoreHandler = null;

function setAssetRestoreHandler(fn) {
  assetRestoreHandler = fn;
  const existing = registry.get(ENTITY_TYPES.ASSET);
  if (existing) {
    registry.set(ENTITY_TYPES.ASSET, Object.freeze({
      ...existing,
      restore: async (id, ctx) => assetRestoreHandler(id, ctx)
    }));
  }
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

async function restoreEntity(db, entityType, entityId, ctx) {
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
  if (typeof def.restore !== 'function') {
    const err = new Error(`No restore strategy registered for ${entityType}`);
    err.status = 501;
    throw err;
  }
  return def.restore(entityId, { ...ctx, db, EVENT_TYPES, ENTITY_TYPES, createEventEnvelope, snapshotAsset, defaultNoteForType });
}

module.exports = {
  EVENT_TYPES,
  ENTITY_TYPES,
  registerEntityType,
  getEntityType,
  listEntityTypes,
  listDeletedItems,
  restoreEntity,
  setAssetRestoreHandler,
  normalizeDeletedRow,
  createTableAdapter
};
