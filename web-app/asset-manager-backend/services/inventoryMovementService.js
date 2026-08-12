/**
 * Inventory Movement System — platform foundation for stock movements.
 *
 * Architecture:
 *   Movement Type Registry  →  Movement Handler  →  Shared Event System
 *
 * Sprint 1 Issue 6: only CONSUME is enabled.
 * Future types (RECEIVE, ADJUST, TRANSFER, …) register here without redesign.
 *
 * Uses existing inventory_items.status model (e.g. "Consumed") — no separate entity table.
 * History is written via inventory_quantity_events + EVENT_TYPES (not a parallel log).
 */
const inventoryEventSystem = require('../../shared/inventoryEventSystem');
const {
  EVENT_TYPES,
  ENTITY_TYPES,
  snapshotInventoryItem,
  presentEvent,
  getEventDisplayName,
  defaultNoteForType,
  normalizeEventType,
  assertEventType
} = inventoryEventSystem;

/**
 * Movement Type registry — configuration, not hardcoded consume branches at call sites.
 * `eventType` maps to shared EVENT_TYPES so history stays unified.
 */
const MOVEMENT_TYPES = Object.freeze({
  RECEIVE: Object.freeze({
    code: 'RECEIVE',
    label: 'Receive',
    eventType: EVENT_TYPES.RECEIVE,
    enabled: false,
    resultStatus: null
  }),
  ADJUST: Object.freeze({
    code: 'ADJUST',
    label: 'Adjust',
    eventType: EVENT_TYPES.ADJUST,
    enabled: false,
    resultStatus: null
  }),
  TRANSFER: Object.freeze({
    code: 'TRANSFER',
    label: 'Transfer',
    eventType: EVENT_TYPES.TRANSFER,
    enabled: false,
    resultStatus: null
  }),
  CONSUME: Object.freeze({
    code: 'CONSUME',
    label: 'Consume',
    eventType: EVENT_TYPES.CONSUME,
    enabled: true,
    resultStatus: 'Consumed',
    requiresAmount: true,
    reducesAvailable: true,
    reducesTotal: true
  }),
  RETURN: Object.freeze({
    code: 'RETURN',
    label: 'Return',
    eventType: EVENT_TYPES.RETURN,
    enabled: false,
    resultStatus: null
  }),
  RESERVE: Object.freeze({
    code: 'RESERVE',
    label: 'Reserve',
    eventType: EVENT_TYPES.RESERVE,
    enabled: false,
    resultStatus: null
  }),
  UNRESERVE: Object.freeze({
    code: 'UNRESERVE',
    label: 'Unreserve',
    eventType: EVENT_TYPES.UNRESERVE,
    enabled: false,
    resultStatus: null
  }),
  DISPOSE: Object.freeze({
    code: 'DISPOSE',
    label: 'Dispose',
    eventType: EVENT_TYPES.DISPOSE,
    enabled: false,
    resultStatus: null
  }),
  LOST: Object.freeze({
    code: 'LOST',
    label: 'Lost',
    eventType: EVENT_TYPES.LOST,
    enabled: false,
    resultStatus: null
  }),
  FOUND: Object.freeze({
    code: 'FOUND',
    label: 'Found',
    eventType: EVENT_TYPES.FOUND,
    enabled: false,
    resultStatus: null
  })
});

const CONSUMED_STATUS = 'Consumed';

function listMovementTypes({ includeDisabled = true } = {}) {
  return Object.values(MOVEMENT_TYPES)
    .filter((m) => includeDisabled || m.enabled)
    .map((m) => ({
      code: m.code,
      label: m.label,
      eventType: m.eventType,
      enabled: !!m.enabled,
      resultStatus: m.resultStatus || null,
      requiresAmount: !!m.requiresAmount
    }));
}

function getMovementType(code) {
  const key = String(code || '').trim().toUpperCase();
  return MOVEMENT_TYPES[key] || null;
}

function isConsumedStatus(status) {
  return String(status || '').trim().toLowerCase() === CONSUMED_STATUS.toLowerCase();
}

function presentMovement(rawEvent, movementDef = null) {
  const presented = presentEvent(rawEvent);
  const type = normalizeEventType(presented.type);
  const def = movementDef || getMovementType(type) || Object.values(MOVEMENT_TYPES).find((m) => m.eventType === type);
  const prev = presented.previous_value || {};
  const next = presented.new_value || {};
  return {
    movement_type: def?.code || type,
    movement_label: def?.label || getEventDisplayName(type),
    event_type: type,
    display_name: presented.display_name || getEventDisplayName(type),
    timestamp: presented.timestamp,
    user: presented.actor || null,
    entity_type: presented.entity_type || ENTITY_TYPES.INVENTORY_ITEM,
    entity_id: presented.entity_id || null,
    previous_quantity: {
      total: Number(prev.quantity_total ?? 0),
      available: Number(prev.quantity_available ?? 0)
    },
    new_quantity: {
      total: Number(next.quantity_total ?? 0),
      available: Number(next.quantity_available ?? 0)
    },
    notes: presented.note || null,
    status_previous: prev.status || null,
    status_new: next.status || null,
    raw: presented
  };
}

/**
 * Apply a registered movement. Only enabled types execute.
 * Handlers are selected by registry config — avoid call-site "if consumed" branching.
 */
async function applyMovement(db, input = {}, deps = {}) {
  const def = getMovementType(input.type || input.movementType);
  if (!def) {
    const err = new Error(`Unknown movement type: ${input.type || input.movementType}`);
    err.status = 400;
    throw err;
  }
  if (!def.enabled) {
    const err = new Error(`Movement type ${def.code} is not enabled yet`);
    err.status = 501;
    throw err;
  }

  if (def.code === MOVEMENT_TYPES.CONSUME.code) {
    return applyConsumeMovement(db, input, deps, def);
  }

  const err = new Error(`No handler registered for movement ${def.code}`);
  err.status = 501;
  throw err;
}

async function applyConsumeMovement(db, input, deps, def) {
  const itemId = String(input.itemId || input.entityId || input.id || '').trim();
  const amountRaw = input.amount ?? input.quantity ?? input.Amount;
  const note = input.note != null ? String(input.note) : null;
  const actor = input.actor || deps.actor || 'web';

  if (!itemId) {
    const err = new Error('itemId is required');
    err.status = 400;
    throw err;
  }

  const item = await db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [itemId]).first();
  if (!item) {
    const err = new Error(`Inventory item ${itemId} not found`);
    err.status = 404;
    throw err;
  }
  if (Number(item.is_deleted || 0) === 1) {
    const err = new Error('Cannot consume a deleted inventory item');
    err.status = 400;
    throw err;
  }
  if (isConsumedStatus(item.status)) {
    const err = new Error('Item is already Consumed');
    err.status = 400;
    throw err;
  }

  const isQtyTracked = Number(item.is_quantity_tracked || 0) === 1
    || item.quantity_root_id
    || item.quantity_total != null;

  const prevSnap = snapshotInventoryItem(item);
  const prevAvailable = Number(item.quantity_available || 0);
  const prevTotal = Number(item.quantity_total || 0);

  let amount;
  if (isQtyTracked) {
    amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      const err = new Error('amount must be > 0');
      err.status = 400;
      throw err;
    }
    if (amount > prevAvailable + 1e-9) {
      const err = new Error(`Insufficient available quantity (available: ${prevAvailable})`);
      err.status = 400;
      throw err;
    }
  } else {
    // Non-tracked item: consume the whole unit via status model
    amount = 1;
  }

  let nextAvailable = prevAvailable;
  let nextTotal = prevTotal;
  let nextStatus = String(item.status || 'In Store');

  if (isQtyTracked) {
    nextAvailable = Math.max(0, prevAvailable - amount);
    nextTotal = Math.max(0, prevTotal - amount);
    // Existing status model: fully depleted → Consumed; partial remain In Store (or prior status)
    nextStatus = nextAvailable <= 1e-9 ? def.resultStatus : nextStatus;
    if (nextAvailable <= 1e-9) nextAvailable = 0;
  } else {
    nextStatus = def.resultStatus;
    nextAvailable = 0;
    nextTotal = 0;
  }

  const now = new Date().toISOString();
  const nextRow = {
    ...item,
    quantity_available: nextAvailable,
    quantity_total: nextTotal,
    status: nextStatus,
    quantity_updated_at: now,
    lastupdated: now
  };
  const nextSnap = snapshotInventoryItem(nextRow);

  const rootId = item.quantity_root_id || item.id;
  const unit = item.quantity_unit || 'Nos';

  const run = async (trx) => {
    await trx('inventory_items')
      .whereRaw('LOWER(id) = LOWER(?)', [itemId])
      .update({
        quantity_available: nextAvailable,
        quantity_total: isQtyTracked ? nextTotal : item.quantity_total,
        status: nextStatus,
        quantity_updated_at: now,
        lastupdated: now
      });

    let eventId = null;
    if (typeof deps.recordInventoryQuantityEvent === 'function') {
      eventId = await deps.recordInventoryQuantityEvent({
        rootId,
        type: assertEventType(def.eventType),
        actor,
        note: note || defaultNoteForType(def.eventType),
        entityType: ENTITY_TYPES.INVENTORY_ITEM,
        entityId: itemId,
        previousValue: prevSnap,
        newValue: nextSnap,
        metadata: {
          movement_type: def.code,
          amount,
          unit
        },
        lines: isQtyTracked
          ? [{ itemId, unit, deltaAvailable: -amount, deltaTotal: -amount }]
          : [{ itemId, unit, deltaAvailable: 0, deltaTotal: 0 }],
        trx
      });
    }

    if (typeof deps.appendAudit === 'function') {
      await deps.appendAudit({
        Action: `INV_MOVE_${def.code}`,
        User: actor,
        AssetId: itemId,
        Severity: 'INFO',
        Details: `${def.label} ${amount} ${unit} on ${itemId}`
      });
    }

    return {
      success: true,
      movement_type: def.code,
      itemId,
      amount,
      previous_quantity: { total: prevTotal, available: prevAvailable },
      new_quantity: { total: nextTotal, available: nextAvailable },
      status: nextStatus,
      eventId
    };
  };

  if (deps.trx) return run(deps.trx);
  return db.transaction(run);
}

async function listConsumedItems(db, filters = {}) {
  let q = db('inventory_items')
    .whereRaw('LOWER(COALESCE(status, \'\')) = ?', [CONSUMED_STATUS.toLowerCase()])
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    });

  if (filters.q) {
    const like = `%${String(filters.q).toLowerCase()}%`;
    q = q.andWhere(function () {
      this.whereRaw('LOWER(CAST(id AS TEXT)) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(itemname, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(currentlocation, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(make, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(model, \'\')) LIKE ?', [like]);
    });
  }
  if (filters.location) {
    q = q.andWhereRaw('LOWER(COALESCE(currentlocation, \'\')) = ?', [String(filters.location).toLowerCase()]);
  }
  if (filters.folderId) {
    q = q.andWhere('folderid', filters.folderId);
  }
  if (filters.kindId) {
    q = q.andWhere('kindid', filters.kindId);
  }

  const sort = String(filters.sort || 'lastupdated').toLowerCase();
  const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sortCol = sort === 'name' ? 'itemname' : (sort === 'available' ? 'quantity_available' : 'lastupdated');
  q = q.orderBy(sortCol, sortDir);

  return q;
}

/**
 * Movement history from shared quantity events (movement types only).
 */
async function listMovements(db, filters = {}) {
  const enabledCodes = listMovementTypes({ includeDisabled: true }).map((m) => m.code);
  const typeFilter = filters.movementType
    ? [String(filters.movementType).toUpperCase()]
    : enabledCodes;

  let q = db('inventory_quantity_events')
    .whereIn('type', typeFilter)
    .orderBy('timestamp', 'desc')
    .limit(Math.min(Number(filters.limit) || 500, 2000));

  if (filters.entityId) {
    const eid = String(filters.entityId);
    q = q.andWhere(function () {
      this.where('root_id', eid)
        .orWhereRaw('LOWER(COALESCE(metadata_json, \'\')) LIKE ?', [`%${eid.toLowerCase()}%`]);
    });
  }
  if (filters.actor || filters.user) {
    q = q.andWhereRaw('LOWER(COALESCE(actor, \'\')) = ?', [String(filters.actor || filters.user).toLowerCase()]);
  }
  if (filters.from) {
    q = q.andWhere('timestamp', '>=', filters.from);
  }
  if (filters.to) {
    q = q.andWhere('timestamp', '<=', filters.to);
  }
  if (filters.q) {
    const like = `%${String(filters.q).toLowerCase()}%`;
    q = q.andWhere(function () {
      this.whereRaw('LOWER(COALESCE(note, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(actor, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(root_id, \'\')) LIKE ?', [like])
        .orWhereRaw('LOWER(COALESCE(metadata_json, \'\')) LIKE ?', [like]);
    });
  }

  const rows = await q;
  return rows.map((row) => presentMovement(row));
}

module.exports = {
  MOVEMENT_TYPES,
  CONSUMED_STATUS,
  EVENT_TYPES,
  ENTITY_TYPES,
  listMovementTypes,
  getMovementType,
  isConsumedStatus,
  applyMovement,
  listConsumedItems,
  listMovements,
  presentMovement
};
