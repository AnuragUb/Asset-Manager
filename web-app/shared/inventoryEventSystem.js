/**
 * Domain event catalog — single source of truth for audit event types.
 * Filename kept as inventoryEventSystem.js (Issue 4); treat as shared Event System.
 * Inventory quantity store and domain_events / asset lifecycle all import from here.
 *
 * Dual load:
 * - Node:  require('../shared/inventoryEventSystem') from backend
 * - Browser: <script src="/shared/inventoryEventSystem.js"> then window.InventoryEventSystem
 *   or ESM re-export via /js/inventory-event-system.js
 *
 * Do not hardcode event type strings at call sites — use EVENT_TYPES.* only.
 * Lifecycle states (Active, Deleted, Consumed, …) live in lifecycleModel.js — not here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.InventoryEventSystem = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EVENT_TYPES = Object.freeze({
    INIT: 'INIT',
    ADJUST: 'ADJUST',
    STATUS_CHANGE: 'STATUS_CHANGE',
    BATCH_ENABLED: 'BATCH_ENABLED',
    BATCH_DISABLED: 'BATCH_DISABLED',
    DELETE: 'DELETE',
    RESTORE: 'RESTORE',
    CONSUME: 'CONSUME',
    RETURN: 'RETURN',
    // Reserved / future stock-movement types (defined so callers can extend without scattering strings)
    TRANSFER: 'TRANSFER',
    RESERVE: 'RESERVE',
    UNRESERVE: 'UNRESERVE',
    DISPOSE: 'DISPOSE',
    LOST: 'LOST',
    FOUND: 'FOUND',
    CHECKOUT: 'CHECKOUT',
    CHECKIN: 'CHECKIN',
    REPAIR: 'REPAIR',
    MAINTENANCE: 'MAINTENANCE',
    CALIBRATION: 'CALIBRATION',
    IMPORT: 'IMPORT',
    EXPORT: 'EXPORT',
    AUDIT_CORRECTION: 'AUDIT_CORRECTION',
    // Legacy asset qty-system names kept for compatibility mapping only
    ISSUE: 'ISSUE',
    SPLIT: 'SPLIT',
    RECEIVE: 'RECEIVE'
  });

  const ENTITY_TYPES = Object.freeze({
    INVENTORY_ITEM: 'inventory_item',
    ASSET: 'asset',
    PROJECT: 'project',
    PROCUREMENT: 'procurement',
    ZOHO: 'zoho'
  });

  /** User-facing labels — never show raw EVENT_TYPES values in UI. */
  const EVENT_DISPLAY_NAMES = Object.freeze({
    [EVENT_TYPES.INIT]: 'Quantity Tracking Initialized',
    [EVENT_TYPES.ADJUST]: 'Quantity Adjusted',
    [EVENT_TYPES.STATUS_CHANGE]: 'Status Changed',
    [EVENT_TYPES.BATCH_ENABLED]: 'Batch / Serial Number Tracking Enabled',
    [EVENT_TYPES.BATCH_DISABLED]: 'Batch / Serial Number Tracking Disabled',
    [EVENT_TYPES.DELETE]: 'Deleted',
    [EVENT_TYPES.RESTORE]: 'Restored',
    [EVENT_TYPES.CONSUME]: 'Quantity Consumed',
    [EVENT_TYPES.RETURN]: 'Quantity Returned',
    [EVENT_TYPES.TRANSFER]: 'Transferred',
    [EVENT_TYPES.RESERVE]: 'Reserved',
    [EVENT_TYPES.UNRESERVE]: 'Unreserved',
    [EVENT_TYPES.DISPOSE]: 'Disposed',
    [EVENT_TYPES.LOST]: 'Marked Lost',
    [EVENT_TYPES.FOUND]: 'Marked Found',
    [EVENT_TYPES.CHECKOUT]: 'Checked Out',
    [EVENT_TYPES.CHECKIN]: 'Checked In',
    [EVENT_TYPES.REPAIR]: 'Sent to Repair',
    [EVENT_TYPES.MAINTENANCE]: 'Maintenance',
    [EVENT_TYPES.CALIBRATION]: 'Calibration',
    [EVENT_TYPES.IMPORT]: 'Imported',
    [EVENT_TYPES.EXPORT]: 'Exported',
    [EVENT_TYPES.AUDIT_CORRECTION]: 'Audit Correction',
    [EVENT_TYPES.ISSUE]: 'Issued',
    [EVENT_TYPES.SPLIT]: 'Quantity Split',
    [EVENT_TYPES.RECEIVE]: 'Received'
  });

  /** Optional UI chrome (color / badge). Unknown types fall back safely. */
  const EVENT_UI = Object.freeze({
    [EVENT_TYPES.INIT]: { color: '#10b981', badge: 'badge-secondary', icon: '📦' },
    [EVENT_TYPES.ADJUST]: { color: '#f59e0b', badge: 'badge-info', icon: '🛠️' },
    [EVENT_TYPES.STATUS_CHANGE]: { color: '#3b82f6', badge: 'badge-info', icon: '🔄' },
    [EVENT_TYPES.BATCH_ENABLED]: { color: '#8b5cf6', badge: 'badge-info', icon: '🔢' },
    [EVENT_TYPES.BATCH_DISABLED]: { color: '#64748b', badge: 'badge-secondary', icon: '🔢' },
    [EVENT_TYPES.DELETE]: { color: '#ef4444', badge: 'badge-danger', icon: '🗑️' },
    [EVENT_TYPES.RESTORE]: { color: '#10b981', badge: 'badge-success', icon: '♻️' },
    [EVENT_TYPES.CONSUME]: { color: '#ef4444', badge: 'badge-danger', icon: '🔥' },
    [EVENT_TYPES.RETURN]: { color: '#10b981', badge: 'badge-success', icon: '↩️' },
    [EVENT_TYPES.DISPOSE]: { color: '#64748b', badge: 'badge-secondary', icon: '🗑️' },
    [EVENT_TYPES.LOST]: { color: '#f59e0b', badge: 'badge-warning', icon: '❓' },
    [EVENT_TYPES.FOUND]: { color: '#10b981', badge: 'badge-success', icon: '✅' },
    [EVENT_TYPES.ISSUE]: { color: '#3b82f6', badge: 'badge-warning', icon: '📤' },
    [EVENT_TYPES.SPLIT]: { color: '#8b5cf6', badge: 'badge-info', icon: '✂️' },
    [EVENT_TYPES.RECEIVE]: { color: '#10b981', badge: 'badge-success', icon: '📥' }
  });

  /** Older / alternate stored type strings → canonical EVENT_TYPES values. */
  const LEGACY_TYPE_ALIASES = Object.freeze({
    STATUS: EVENT_TYPES.STATUS_CHANGE,
    STATUSCHANGE: EVENT_TYPES.STATUS_CHANGE,
    BATCH_ENABLE: EVENT_TYPES.BATCH_ENABLED,
    BATCHENABLE: EVENT_TYPES.BATCH_ENABLED,
    BATCH_ON: EVENT_TYPES.BATCH_ENABLED,
    BATCH_DISABLE: EVENT_TYPES.BATCH_DISABLED,
    BATCHDISABLE: EVENT_TYPES.BATCH_DISABLED,
    BATCH_OFF: EVENT_TYPES.BATCH_DISABLED,
    SOFT_DELETE: EVENT_TYPES.DELETE,
    SOFTDELETE: EVENT_TYPES.DELETE,
    UNDELETE: EVENT_TYPES.RESTORE,
    QTY_ADJUST: EVENT_TYPES.ADJUST,
    QTY_INIT: EVENT_TYPES.INIT,
    QTY_CONSUME: EVENT_TYPES.CONSUME,
    BULK_RETURN_ON_DELETE: EVENT_TYPES.RETURN
  });

  function assertEventType(type) {
    const normalized = normalizeEventType(type);
    const known = Object.prototype.hasOwnProperty.call(EVENT_DISPLAY_NAMES, normalized)
      || Object.values(EVENT_TYPES).includes(normalized);
    if (!known) {
      // Allow forward-compat: unknown types pass through as uppercase tokens
      return String(type || '').trim().toUpperCase() || EVENT_TYPES.ADJUST;
    }
    return normalized;
  }

  function normalizeEventType(raw) {
    const key = String(raw || '').trim().toUpperCase();
    if (!key) return '';
    if (LEGACY_TYPE_ALIASES[key]) return LEGACY_TYPE_ALIASES[key];
    if (Object.prototype.hasOwnProperty.call(EVENT_DISPLAY_NAMES, key)) return key;
    if (Object.values(EVENT_TYPES).includes(key)) return key;
    return key;
  }

  function getEventDisplayName(rawType) {
    const type = normalizeEventType(rawType);
    if (EVENT_DISPLAY_NAMES[type]) return EVENT_DISPLAY_NAMES[type];
    // Humanize unknown future types without using the raw constant as-is when possible
    if (!type) return 'Event';
    return type
      .split('_')
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  function getEventUi(rawType) {
    const type = normalizeEventType(rawType);
    return EVENT_UI[type] || { color: '#0078d4', badge: 'badge-secondary', icon: '⚖️' };
  }

  /**
   * Build structured metadata stored in metadata_json.
   * Always includes entity_type / entity_id; previous/new when provided.
   */
  function buildEventMetadata({
    entityType,
    entityId,
    previousValue = null,
    newValue = null,
    extra = null
  } = {}) {
    const metadata = {
      schema_version: 1,
      entity_type: entityType || ENTITY_TYPES.INVENTORY_ITEM,
      entity_id: entityId != null ? String(entityId) : null
    };
    if (previousValue !== undefined && previousValue !== null) {
      metadata.previous_value = previousValue;
    }
    if (newValue !== undefined && newValue !== null) {
      metadata.new_value = newValue;
    }
    if (extra && typeof extra === 'object') {
      Object.assign(metadata, extra);
    }
    return metadata;
  }

  /**
   * Snapshot of inventory fields relevant to operational history.
   */
  function snapshotInventoryItem(row) {
    if (!row || typeof row !== 'object') return null;
    return {
      quantity_total: Number(row.quantity_total ?? row.QuantityTotal ?? 0),
      quantity_available: Number(row.quantity_available ?? row.QuantityAvailable ?? 0),
      is_quantity_tracked: Number(row.is_quantity_tracked ?? row.IsQuantityTracked ?? 0),
      is_batch: Number(row.is_batch ?? row.IsBatch ?? 0),
      status: String(row.status ?? row.Status ?? ''),
      is_deleted: Number(row.is_deleted ?? row.IsDeleted ?? 0)
    };
  }

  /**
   * Decide whether a PUT-style inventory update is a meaningful operational change.
   * Metadata-only edits (description, make, model, notes, name, …) → false.
   */
  function detectInventoryMeaningfulChanges({ existing, next }) {
    const prev = snapshotInventoryItem(existing) || {};
    const nxt = snapshotInventoryItem(next) || {};

    const qtyTrackedOn = prev.is_quantity_tracked !== 1 && nxt.is_quantity_tracked === 1;
    const qtyTrackedOff = prev.is_quantity_tracked === 1 && nxt.is_quantity_tracked !== 1;
    const totalChanged = prev.quantity_total !== nxt.quantity_total;
    const availableChanged = prev.quantity_available !== nxt.quantity_available;
    const statusChanged = String(prev.status || '').trim().toLowerCase() !== String(nxt.status || '').trim().toLowerCase();
    const batchEnabled = prev.is_batch !== 1 && nxt.is_batch === 1;
    const batchDisabled = prev.is_batch === 1 && nxt.is_batch !== 1;
    const deletedChanged = prev.is_deleted !== nxt.is_deleted;

    const meaningful =
      qtyTrackedOn ||
      qtyTrackedOff ||
      totalChanged ||
      availableChanged ||
      statusChanged ||
      batchEnabled ||
      batchDisabled ||
      deletedChanged;

    return {
      meaningful,
      qtyTrackedOn,
      qtyTrackedOff,
      totalChanged,
      availableChanged,
      statusChanged,
      batchEnabled,
      batchDisabled,
      deletedChanged,
      previousValue: prev,
      newValue: nxt
    };
  }

  /**
   * Pick a single primary event type for one save (anti-duplicate).
   * Precedence: INIT → DELETE → RESTORE → ADJUST → BATCH_* → STATUS_CHANGE
   */
  function resolvePrimaryInventoryEventType(changes) {
    if (!changes || !changes.meaningful) return null;
    if (changes.deletedChanged && changes.newValue && Number(changes.newValue.is_deleted) === 1) {
      return EVENT_TYPES.DELETE;
    }
    if (changes.deletedChanged && changes.newValue && Number(changes.newValue.is_deleted) !== 1) {
      return EVENT_TYPES.RESTORE;
    }
    if (changes.qtyTrackedOn) return EVENT_TYPES.INIT;
    if (changes.totalChanged || changes.availableChanged || changes.qtyTrackedOff) {
      return EVENT_TYPES.ADJUST;
    }
    if (changes.batchEnabled) return EVENT_TYPES.BATCH_ENABLED;
    if (changes.batchDisabled) return EVENT_TYPES.BATCH_DISABLED;
    if (changes.statusChanged) return EVENT_TYPES.STATUS_CHANGE;
    return null;
  }

  function defaultNoteForType(type) {
    switch (normalizeEventType(type)) {
      case EVENT_TYPES.INIT:
        return 'Initialized quantity tracking';
      case EVENT_TYPES.ADJUST:
        return 'Updated quantity';
      case EVENT_TYPES.STATUS_CHANGE:
        return 'Status changed';
      case EVENT_TYPES.BATCH_ENABLED:
        return 'Batch / serial tracking enabled';
      case EVENT_TYPES.BATCH_DISABLED:
        return 'Batch / serial tracking disabled';
      case EVENT_TYPES.DELETE:
        return 'Soft-deleted (moved to Recovery Center)';
      case EVENT_TYPES.RESTORE:
        return 'Restored from Recovery Center';
      case EVENT_TYPES.CONSUME:
        return 'Quantity consumed';
      case EVENT_TYPES.RETURN:
        return 'Quantity returned';
      default:
        return getEventDisplayName(type);
    }
  }

  /**
   * Domain-neutral event envelope for any entity store (domain_events, inventory qty, etc.).
   */
  function createEventEnvelope({
    type,
    entityType,
    entityId,
    actor = null,
    note = null,
    previousValue = null,
    newValue = null,
    extra = null,
    timestamp = null
  } = {}) {
    const canonicalType = assertEventType(type);
    return {
      type: canonicalType,
      display_name: getEventDisplayName(canonicalType),
      entity_type: entityType || ENTITY_TYPES.ASSET,
      entity_id: entityId != null ? String(entityId) : null,
      actor: actor || null,
      timestamp: timestamp || new Date().toISOString(),
      note: note || defaultNoteForType(canonicalType),
      metadata: buildEventMetadata({
        entityType: entityType || ENTITY_TYPES.ASSET,
        entityId,
        previousValue,
        newValue,
        extra
      })
    };
  }

  function snapshotAsset(row) {
    if (!row || typeof row !== 'object') return null;
    return {
      id: row.id || row.ID || null,
      itemname: row.itemname || row.ItemName || '',
      status: String(row.status ?? row.Status ?? ''),
      category: row.category || row.Category || row.type || row.Type || '',
      make: row.make || row.Make || '',
      model: row.model || row.Model || '',
      currentlocation: row.currentlocation || row.CurrentLocation || '',
      srno: row.srno || row.SrNo || null,
      parentid: row.parentid || row.ParentId || null,
      quantity_root_id: row.quantity_root_id || row.QuantityRootId || null,
      is_deleted: Number(row.is_deleted ?? row.IsDeleted ?? 0),
      deleted_at: row.deleted_at || row.DeletedAt || null,
      deleted_by: row.deleted_by || row.DeletedBy || null
    };
  }

  /**
   * Normalize a DB/API event row for clients: canonical type + display_name + ui hints.
   * Does not mutate stored rows; safe for legacy entries.
   */
  function presentEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return rawEvent;
    const typeRaw = rawEvent.type || rawEvent.Type || '';
    const type = normalizeEventType(typeRaw);
    const ui = getEventUi(type);

    let metadata = rawEvent.metadata || null;
    if (!metadata && (rawEvent.metadata_json || rawEvent.MetadataJSON)) {
      try {
        metadata = JSON.parse(rawEvent.metadata_json || rawEvent.MetadataJSON);
      } catch {
        metadata = null;
      }
    }

    return {
      ...rawEvent,
      type,
      type_raw: typeRaw,
      display_name: getEventDisplayName(type),
      displayName: getEventDisplayName(type),
      ui,
      metadata,
      actor: rawEvent.actor || rawEvent.Actor || null,
      timestamp: rawEvent.timestamp || rawEvent.Timestamp || null,
      note: rawEvent.note || rawEvent.Note || null,
      entity_type: (metadata && metadata.entity_type) || ENTITY_TYPES.INVENTORY_ITEM,
      entity_id: (metadata && metadata.entity_id) || rawEvent.root_id || rawEvent.rootId || null,
      previous_value: metadata ? metadata.previous_value : null,
      new_value: metadata ? metadata.new_value : null
    };
  }

  return {
    EVENT_TYPES,
    ENTITY_TYPES,
    EVENT_DISPLAY_NAMES,
    EVENT_UI,
    LEGACY_TYPE_ALIASES,
    assertEventType,
    normalizeEventType,
    getEventDisplayName,
    getEventUi,
    buildEventMetadata,
    snapshotInventoryItem,
    detectInventoryMeaningfulChanges,
    resolvePrimaryInventoryEventType,
    defaultNoteForType,
    presentEvent,
    createEventEnvelope,
    snapshotAsset
  };
});
