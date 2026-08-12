/**
 * Platform Lifecycle Model — single source of truth for lifecycle states.
 *
 * Architecture:
 *   Lifecycle State Registry  →  Operational status aliases  →  Flags (is_deleted / is_retired)
 *                                        ↓
 *                              Event System / Recovery Center / Movements
 *
 * Do NOT invent ad-hoc status strings in new modules — import from here.
 * Filename: lifecycleModel.js (shared, dual-load like inventoryEventSystem).
 *
 * Sprint 1 Issue 7: consolidate definitions + document transitions.
 * Does not rewrite every call site; gradual adoption.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LifecycleModel = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Canonical platform lifecycle codes (stable identifiers for config / APIs).
   * Display labels are separate — never treat the code as UI copy.
   */
  const LIFECYCLE_STATES = Object.freeze({
    ACTIVE: 'ACTIVE',
    RETIRED: 'RETIRED',
    DELETED: 'DELETED',
    CONSUMED: 'CONSUMED',
    RESERVED: 'RESERVED',
    CHECKED_OUT: 'CHECKED_OUT',
    CHECKED_IN: 'CHECKED_IN',
    MAINTENANCE: 'MAINTENANCE',
    REPAIR: 'REPAIR',
    ARCHIVED: 'ARCHIVED',
    DISPOSED: 'DISPOSED'
  });

  /** User-facing labels for canonical states. */
  const LIFECYCLE_DISPLAY_NAMES = Object.freeze({
    [LIFECYCLE_STATES.ACTIVE]: 'Active',
    [LIFECYCLE_STATES.RETIRED]: 'Retired',
    [LIFECYCLE_STATES.DELETED]: 'Deleted',
    [LIFECYCLE_STATES.CONSUMED]: 'Consumed',
    [LIFECYCLE_STATES.RESERVED]: 'Reserved',
    [LIFECYCLE_STATES.CHECKED_OUT]: 'Checked Out',
    [LIFECYCLE_STATES.CHECKED_IN]: 'Checked In',
    [LIFECYCLE_STATES.MAINTENANCE]: 'Maintenance',
    [LIFECYCLE_STATES.REPAIR]: 'Repair',
    [LIFECYCLE_STATES.ARCHIVED]: 'Archived',
    [LIFECYCLE_STATES.DISPOSED]: 'Disposed'
  });

  /**
   * Purpose / semantics for each canonical state (documentation + tooling).
   */
  const LIFECYCLE_PURPOSE = Object.freeze({
    [LIFECYCLE_STATES.ACTIVE]: 'Entity is in normal operational use or available stock.',
    [LIFECYCLE_STATES.RETIRED]: 'Entity left active service (sold, scraped, or explicitly retired) but is retained for history.',
    [LIFECYCLE_STATES.DELETED]: 'Soft-deleted; hidden from normal lists; recoverable via Recovery Center until hard purge.',
    [LIFECYCLE_STATES.CONSUMED]: 'Quantity or item fully consumed; retained via status model (no separate entity).',
    [LIFECYCLE_STATES.RESERVED]: 'Held for a future assignment (future module).',
    [LIFECYCLE_STATES.CHECKED_OUT]: 'Issued to a user / site (future module).',
    [LIFECYCLE_STATES.CHECKED_IN]: 'Returned from checkout (future module).',
    [LIFECYCLE_STATES.MAINTENANCE]: 'Planned maintenance (future module).',
    [LIFECYCLE_STATES.REPAIR]: 'Under repair (future module).',
    [LIFECYCLE_STATES.ARCHIVED]: 'Long-term retention without active operations (future module).',
    [LIFECYCLE_STATES.DISPOSED]: 'Permanently disposed (future module; distinct from soft-delete).'
  });

  /**
   * Operational status strings currently stored in assets.status / inventory_items.status.
   * These are aliases under the Active / Retired / Consumed umbrella — not parallel taxonomies.
   */
  const OPERATIONAL_STATUS = Object.freeze({
    IN_STORE: 'In Store',
    IN_USE: 'In Use',
    IN_PROJECT: 'In Project',
    PROJECT: 'Project',
    UNDER_INSPECTION: 'Under Inspection',
    OWNED: 'Owned',
    DEMO: 'Demo',
    RENTAL: 'Rental',
    STAND_BY: 'Stand By',
    IN_REPAIR: 'In-Repair',
    SOLD: 'Sold',
    SCRAPED: 'Scraped',
    CONSUMED: 'Consumed',
    // Soft-delete is flag-based; label used in Recovery Center rows
    SOFT_DELETED: 'Deleted'
  });

  /** Map lowercase operational / legacy labels → canonical lifecycle code. */
  const OPERATIONAL_TO_LIFECYCLE = Object.freeze({
    'in store': LIFECYCLE_STATES.ACTIVE,
    'in use': LIFECYCLE_STATES.ACTIVE,
    'in-use': LIFECYCLE_STATES.ACTIVE,
    'in project': LIFECYCLE_STATES.ACTIVE,
    project: LIFECYCLE_STATES.ACTIVE,
    'under inspection': LIFECYCLE_STATES.ACTIVE,
    owned: LIFECYCLE_STATES.ACTIVE,
    demo: LIFECYCLE_STATES.ACTIVE,
    rental: LIFECYCLE_STATES.ACTIVE,
    'stand by': LIFECYCLE_STATES.ACTIVE,
    standby: LIFECYCLE_STATES.ACTIVE,
    'in-repair': LIFECYCLE_STATES.REPAIR,
    'in repair': LIFECYCLE_STATES.REPAIR,
    repair: LIFECYCLE_STATES.REPAIR,
    maintenance: LIFECYCLE_STATES.MAINTENANCE,
    sold: LIFECYCLE_STATES.RETIRED,
    scraped: LIFECYCLE_STATES.RETIRED,
    retired: LIFECYCLE_STATES.RETIRED,
    consumed: LIFECYCLE_STATES.CONSUMED,
    deleted: LIFECYCLE_STATES.DELETED,
    'soft deleted': LIFECYCLE_STATES.DELETED,
    reserved: LIFECYCLE_STATES.RESERVED,
    'checked out': LIFECYCLE_STATES.CHECKED_OUT,
    'checked in': LIFECYCLE_STATES.CHECKED_IN,
    archived: LIFECYCLE_STATES.ARCHIVED,
    disposed: LIFECYCLE_STATES.DISPOSED
  });

  /**
   * Valid directed transitions (canonical → canonical[]).
   * Operational moves within ACTIVE (In Store ↔ Project) are always allowed.
   * Future modules extend this map — do not scatter transition rules.
   */
  const LIFECYCLE_TRANSITIONS = Object.freeze({
    [LIFECYCLE_STATES.ACTIVE]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.RETIRED,
      LIFECYCLE_STATES.DELETED,
      LIFECYCLE_STATES.CONSUMED,
      LIFECYCLE_STATES.RESERVED,
      LIFECYCLE_STATES.CHECKED_OUT,
      LIFECYCLE_STATES.MAINTENANCE,
      LIFECYCLE_STATES.REPAIR,
      LIFECYCLE_STATES.ARCHIVED,
      LIFECYCLE_STATES.DISPOSED
    ]),
    [LIFECYCLE_STATES.RESERVED]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.CHECKED_OUT,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.CHECKED_OUT]: Object.freeze([
      LIFECYCLE_STATES.CHECKED_IN,
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.MAINTENANCE,
      LIFECYCLE_STATES.REPAIR,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.CHECKED_IN]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.CHECKED_OUT,
      LIFECYCLE_STATES.MAINTENANCE,
      LIFECYCLE_STATES.REPAIR,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.MAINTENANCE]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.REPAIR,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.REPAIR]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.MAINTENANCE,
      LIFECYCLE_STATES.RETIRED,
      LIFECYCLE_STATES.DISPOSED,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.RETIRED]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.ARCHIVED,
      LIFECYCLE_STATES.DISPOSED,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.CONSUMED]: Object.freeze([
      // RETURN movement may re-open later; no automatic reverse this sprint
    ]),
    [LIFECYCLE_STATES.DELETED]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE // restore via Recovery Center
    ]),
    [LIFECYCLE_STATES.ARCHIVED]: Object.freeze([
      LIFECYCLE_STATES.ACTIVE,
      LIFECYCLE_STATES.DELETED
    ]),
    [LIFECYCLE_STATES.DISPOSED]: Object.freeze([
      // Terminal for product purposes (hard outcome ≠ soft-delete)
    ])
  });

  const FLAG_COLUMNS = Object.freeze({
    deleted: 'is_deleted',
    retired: 'is_retired'
  });

  function normalizeLifecycleCode(code) {
    if (!code) return null;
    const upper = String(code).trim().toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (LIFECYCLE_STATES[upper]) return LIFECYCLE_STATES[upper];
    const fromDisplay = Object.entries(LIFECYCLE_DISPLAY_NAMES)
      .find(([, label]) => String(label).toLowerCase() === String(code).trim().toLowerCase());
    return fromDisplay ? fromDisplay[0] : null;
  }

  function getLifecycleDisplayName(code) {
    const canonical = normalizeLifecycleCode(code) || String(code || '').trim();
    return LIFECYCLE_DISPLAY_NAMES[canonical] || String(code || '');
  }

  function getLifecyclePurpose(code) {
    const canonical = normalizeLifecycleCode(code);
    return (canonical && LIFECYCLE_PURPOSE[canonical]) || '';
  }

  /**
   * Resolve platform lifecycle from row flags + operational status string.
   * Priority: deleted flag → retired flag / sold|scraped → consumed → operational map → ACTIVE.
   */
  function resolveLifecycle(row = {}) {
    const deleted = Number(row.is_deleted ?? row.IsDeleted ?? 0) === 1;
    if (deleted) return LIFECYCLE_STATES.DELETED;

    const retiredFlag = Number(row.is_retired ?? row.IsRetired ?? 0) === 1;
    const statusRaw = String(row.status ?? row.Status ?? '').trim();
    const statusKey = statusRaw.toLowerCase();

    if (retiredFlag || statusKey === 'sold' || statusKey === 'scraped' || statusKey === 'retired') {
      return LIFECYCLE_STATES.RETIRED;
    }
    if (statusKey === 'consumed') return LIFECYCLE_STATES.CONSUMED;

    if (statusKey && OPERATIONAL_TO_LIFECYCLE[statusKey]) {
      return OPERATIONAL_TO_LIFECYCLE[statusKey];
    }
    return LIFECYCLE_STATES.ACTIVE;
  }

  function isDeleted(row) {
    return resolveLifecycle(row) === LIFECYCLE_STATES.DELETED;
  }

  function isRetired(row) {
    return resolveLifecycle(row) === LIFECYCLE_STATES.RETIRED;
  }

  function isConsumed(rowOrStatus) {
    if (rowOrStatus && typeof rowOrStatus === 'object') {
      return resolveLifecycle(rowOrStatus) === LIFECYCLE_STATES.CONSUMED;
    }
    return String(rowOrStatus || '').trim().toLowerCase() === OPERATIONAL_STATUS.CONSUMED.toLowerCase();
  }

  function isActive(row) {
    return resolveLifecycle(row) === LIFECYCLE_STATES.ACTIVE;
  }

  function canTransition(fromCode, toCode) {
    const from = normalizeLifecycleCode(fromCode);
    const to = normalizeLifecycleCode(toCode);
    if (!from || !to) return false;
    const allowed = LIFECYCLE_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  function assertTransition(fromCode, toCode) {
    if (!canTransition(fromCode, toCode)) {
      const err = new Error(
        `Invalid lifecycle transition: ${getLifecycleDisplayName(fromCode)} → ${getLifecycleDisplayName(toCode)}`
      );
      err.status = 400;
      err.code = 'INVALID_LIFECYCLE_TRANSITION';
      throw err;
    }
    return true;
  }

  function listLifecycleStates() {
    return Object.values(LIFECYCLE_STATES).map((code) => ({
      code,
      label: LIFECYCLE_DISPLAY_NAMES[code],
      purpose: LIFECYCLE_PURPOSE[code],
      transitions: [...(LIFECYCLE_TRANSITIONS[code] || [])]
    }));
  }

  return {
    LIFECYCLE_STATES,
    LIFECYCLE_DISPLAY_NAMES,
    LIFECYCLE_PURPOSE,
    LIFECYCLE_TRANSITIONS,
    OPERATIONAL_STATUS,
    OPERATIONAL_TO_LIFECYCLE,
    FLAG_COLUMNS,
    normalizeLifecycleCode,
    getLifecycleDisplayName,
    getLifecyclePurpose,
    resolveLifecycle,
    isDeleted,
    isRetired,
    isConsumed,
    isActive,
    canTransition,
    assertTransition,
    listLifecycleStates
  };
});
