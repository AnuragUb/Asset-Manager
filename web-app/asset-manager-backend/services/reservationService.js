/**
 * Phase 3 generic reservation engine.
 *
 * Owner is (owner_type, owner_id) — never set_id.
 * Does not import kitSetService, zohoService, DC helpers, or project assign.
 */
const { db, generateReservationId, verifyReservationId } = require('../utils');

const RESOURCE_TYPES = Object.freeze(['ASSET', 'INVENTORY']);
const OWNER_TYPES = Object.freeze(['SET', 'PROJECT', 'DC', 'MANUAL', 'SYSTEM']);
const STATUSES = Object.freeze(['ACTIVE', 'RELEASED', 'TRANSFERRED']);
const HOLDING = {
  ASSET: { table: 'assets', label: 'ASSET' },
  INVENTORY: { table: 'inventory_items', label: 'INVENTORY' }
};
const BLOCKED_ASSET_STATUSES = new Set([
  'assigned',
  'project',
  'sold',
  'scraped',
  'consumed',
  'deleted'
]);

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError('Invalid quantity value', 400, 'INVALID_QUANTITY');
  return n;
}

function declaredPrecision(row) {
  const raw = row && row.quantity_precision;
  const n = raw == null || raw === '' ? 0 : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(6, n);
}

function roundQty(value, precision) {
  const p = declaredPrecision({ quantity_precision: precision });
  const n = qtyNum(value);
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function qtyEq(a, b, precision) {
  return roundQty(a, precision) === roundQty(b, precision);
}

function normType(value, allowed, label) {
  const key = String(value || '').trim().toUpperCase();
  if (!allowed.includes(key)) {
    throw httpError(`${label} must be one of ${allowed.join(', ')}`, 400, 'INVALID_TYPE');
  }
  return key;
}

function trimId(value, label) {
  const text = String(value || '').trim();
  if (!text) throw httpError(`${label} is required`, 400, 'MISSING_ID');
  return text;
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

async function tablesReady(runner = db) {
  return runner.schema.hasTable('reservation');
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Reservation tables are not installed', 503, 'NOT_INSTALLED');
  }
}

async function uniqueReservationId(trx) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateReservationId();
    if (!verifyReservationId(id)) {
      throw httpError(`ID generator produced a non-canonical reservation id: ${id}`, 500);
    }
    const existing = await trx('reservation').where({ id }).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique reservation ID', 500);
}

function publicReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    quantity: row.quantity,
    quantityOriginal: row.quantity_original,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    status: row.status,
    reason: row.reason || null,
    reasonCode: row.reason_code || null,
    reference: row.reference || null,
    idempotencyKey: row.idempotency_key || null,
    parentReservationId: row.parent_reservation_id || null,
    transferredToId: row.transferred_to_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    releasedBy: row.released_by || null,
    releasedAt: row.released_at || null,
    updatedAt: row.updated_at
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
    reservationId: row.reservation_id,
    type: row.type,
    quantity: row.quantity,
    actor: row.actor || null,
    timestamp: row.timestamp,
    note: row.note || null,
    metadata
  };
}

async function writeReservationEvent(trx, { reservationId, type, quantity, actor, note, metadata }) {
  await trx('reservation_event').insert({
    reservation_id: reservationId,
    type,
    quantity,
    actor: actor || null,
    timestamp: new Date().toISOString(),
    note: note || null,
    metadata_json: metadata ? JSON.stringify(metadata) : null
  });
}

async function writeQuantityEvent(trx, { table, rootId, type, actor, note, metadata, lines }) {
  const now = new Date().toISOString();
  const isAsset = table === 'assets';
  const eventTable = isAsset ? 'quantity_events' : 'inventory_quantity_events';
  const lineTable = isAsset ? 'quantity_event_lines' : 'inventory_quantity_event_lines';
  if (!(await trx.schema.hasTable(eventTable))) return null;
  const inserted = await trx(eventTable)
    .insert({
      root_id: rootId,
      type,
      actor: actor || null,
      timestamp: now,
      note: note || null,
      metadata_json: metadata ? JSON.stringify(metadata) : null
    })
    .returning('id');
  const eventId = Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
  if (eventId && Array.isArray(lines) && lines.length && (await trx.schema.hasTable(lineTable))) {
    await trx(lineTable).insert(
      lines.map((line) => (isAsset
        ? {
            event_id: eventId,
            asset_id: line.id,
            unit: line.unit || null,
            delta_available: line.deltaAvailable,
            delta_total: line.deltaTotal
          }
        : {
            event_id: eventId,
            item_id: line.id,
            unit: line.unit || null,
            delta_available: line.deltaAvailable,
            delta_total: line.deltaTotal
          }))
    );
  }
  return eventId;
}

function isQuantityTracked(row) {
  return Number(row && row.is_quantity_tracked) === 1;
}

async function lockHolding(trx, resourceType, resourceId) {
  const cfg = HOLDING[resourceType];
  const row = await trx(cfg.table)
    .whereRaw('LOWER(id) = LOWER(?)', [resourceId])
    .forUpdate()
    .first();
  if (!row) throw httpError(`${resourceType} ${resourceId} not found`, 404, 'RESOURCE_NOT_FOUND');
  return { table: cfg.table, row };
}

async function assertOwnerExists(trx, ownerType, ownerId) {
  if (ownerType === 'MANUAL' || ownerType === 'SYSTEM') return;
  if (ownerType === 'SET' && (await trx.schema.hasTable('managed_sets'))) {
    const row = await trx('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [ownerId]).first();
    if (!row) throw httpError(`SET owner ${ownerId} not found`, 404, 'OWNER_NOT_FOUND');
    return;
  }
  if (ownerType === 'PROJECT' && (await trx.schema.hasTable('projects'))) {
    const row = await trx('projects').whereRaw('LOWER(id) = LOWER(?)', [ownerId]).first();
    if (!row) throw httpError(`PROJECT owner ${ownerId} not found`, 404, 'OWNER_NOT_FOUND');
    return;
  }
  if (ownerType === 'DC' && (await trx.schema.hasTable('delivery_challans'))) {
    const row = await trx('delivery_challans').whereRaw('LOWER(id) = LOWER(?)', [ownerId]).first();
    if (!row) throw httpError(`DC owner ${ownerId} not found`, 404, 'OWNER_NOT_FOUND');
  }
}

async function assertAssetEligible(trx, row) {
  if (Number(row.is_deleted) === 1) {
    throw httpError(
      `ASSET ${row.id} is deleted and cannot be reserved`,
      409,
      'ASSET_DELETED'
    );
  }
  if (Number(row.is_retired) === 1) {
    throw httpError(
      `ASSET ${row.id} is retired and cannot be reserved`,
      409,
      'ASSET_RETIRED'
    );
  }
  if (String(row.lineage_status || 'ACTIVE').toUpperCase() === 'INACTIVE') {
    throw httpError(
      `ASSET ${row.id} is inactive and cannot be reserved`,
      409,
      'ASSET_INACTIVE'
    );
  }
  const status = String(row.status || '').trim().toLowerCase();
  if (BLOCKED_ASSET_STATUSES.has(status)) {
    throw httpError(
      `ASSET ${row.id} has operational status '${row.status}' and cannot receive a conflicting reservation`,
      409,
      'ASSET_STATUS_COMMITTED'
    );
  }
  if (nonempty(row.assignedto)) {
    throw httpError(
      `ASSET ${row.id} is already assigned to '${String(row.assignedto).trim()}'`,
      409,
      'ASSET_ASSIGNED'
    );
  }
  if (nonempty(row.sentagainstdc)) {
    throw httpError(
      `ASSET ${row.id} is already committed against DC '${String(row.sentagainstdc).trim()}'`,
      409,
      'ASSET_COMMITTED_TO_DC'
    );
  }
  if (await trx.schema.hasTable('project_assets')) {
    const projectLink = await trx('project_assets as pa')
      .join('projects as p', 'pa.projectid', 'p.id')
      .whereRaw('LOWER(pa.assetid) = LOWER(?)', [row.id])
      .select('pa.projectid as project_id', 'p.projectname as project_name')
      .first();
    if (projectLink) {
      throw httpError(
        `ASSET ${row.id} is already assigned to project ${projectLink.project_id} (${projectLink.project_name || ''})`,
        409,
        'ASSET_ASSIGNED_TO_PROJECT',
        { projectId: projectLink.project_id, projectName: projectLink.project_name || null }
      );
    }
  }
  if (await trx.schema.hasTable('managed_set_components')) {
    const setLink = await trx('managed_set_components')
      .where({ is_active: true, component_type: 'ASSET' })
      .whereRaw('LOWER(asset_id) = LOWER(?)', [row.id])
      .first();
    if (setLink) {
      throw httpError(
        `ASSET ${row.id} is already an active component of Managed Set ${setLink.set_id}`,
        409,
        'ASSET_IN_MANAGED_SET',
        { setId: setLink.set_id }
      );
    }
  }
}

async function assertInventoryEligible(row) {
  if (Number(row.is_deleted) === 1) {
    throw httpError(
      `INVENTORY ${row.id} is deleted and cannot be reserved`,
      409,
      'INVENTORY_DELETED'
    );
  }
  if (String(row.lineage_status || 'ACTIVE').toUpperCase() === 'INACTIVE') {
    throw httpError(
      `INVENTORY ${row.id} is inactive and cannot be reserved`,
      409,
      'INVENTORY_INACTIVE'
    );
  }
  if (!isQuantityTracked(row)) {
    throw httpError(
      `INVENTORY ${row.id} is not quantity-tracked`,
      400,
      'NOT_QUANTITY_TRACKED'
    );
  }
}

async function applyHoldingDelta(trx, table, id, deltaAvailable, deltaReserved, precision) {
  const p = declaredPrecision({ quantity_precision: precision });
  const result = await trx.raw(
    `
      UPDATE ${table}
      SET quantity_available = ROUND((COALESCE(quantity_available, 0)::numeric + ?::numeric), ?),
          quantity_reserved = ROUND((COALESCE(quantity_reserved, 0)::numeric + ?::numeric), ?),
          quantity_updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(id) = LOWER(?)
        AND ROUND((COALESCE(quantity_available, 0)::numeric + ?::numeric), ?) >= 0
        AND ROUND((COALESCE(quantity_reserved, 0)::numeric + ?::numeric), ?) >= 0
      RETURNING id, quantity_total, quantity_available, quantity_reserved
    `,
    [
      deltaAvailable, p,
      deltaReserved, p,
      id,
      deltaAvailable, p,
      deltaReserved, p
    ]
  );
  const row = result.rows && result.rows[0];
  if (!row) {
    throw httpError(
      'Quantity update rejected (available/reserved would become negative or row missing)',
      409,
      'QUANTITY_CONFLICT'
    );
  }
  const total = qtyNum(row.quantity_total);
  const available = qtyNum(row.quantity_available);
  const reserved = qtyNum(row.quantity_reserved);
  if (available + reserved - total > 1e-9) {
    throw httpError(
      `Quantity bounds failed for ${id}: available ${available} + reserved ${reserved} > total ${total}`,
      500,
      'CONSERVATION_FAILED'
    );
  }
  return row;
}

async function assertLedgerMatchesCounter(trx, resourceType, resourceId, precision) {
  const cfg = HOLDING[resourceType];
  const holding = await trx(cfg.table).whereRaw('LOWER(id) = LOWER(?)', [resourceId]).first();
  const sumRow = await trx('reservation')
    .where({ resource_type: resourceType, status: 'ACTIVE' })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [resourceId])
    .sum({ total: 'quantity' })
    .first();
  const ledger = qtyNum(sumRow && sumRow.total);
  const reserved = qtyNum(holding && holding.quantity_reserved);
  if (!qtyEq(ledger, reserved, precision)) {
    throw httpError(
      `Reservation ledger mismatch on ${resourceType} ${resourceId}: SUM(ACTIVE)=${ledger} reserved=${reserved}`,
      500,
      'LEDGER_MISMATCH'
    );
  }
}

async function findByIdempotencyKey(runner, key) {
  if (!key) return null;
  return runner('reservation').where({ idempotency_key: key }).first();
}

function isUniqueViolation(err, name) {
  if (!err || String(err.code) !== '23505') return false;
  const hay = `${err.constraint || ''} ${err.message || ''}`;
  return hay.includes(name);
}

async function hydrate(runner, row) {
  const events = await runner('reservation_event')
    .where({ reservation_id: row.id })
    .orderBy('id');
  return {
    reservation: publicReservation(row),
    events: events.map(publicEvent)
  };
}

async function reserve(args = {}) {
  await requireTables();
  const resourceType = normType(args.resourceType || args.resource_type, RESOURCE_TYPES, 'resourceType');
  const resourceId = trimId(args.resourceId || args.resource_id, 'resourceId');
  const ownerType = normType(args.ownerType || args.owner_type, OWNER_TYPES, 'ownerType');
  const ownerId = trimId(args.ownerId || args.owner_id, 'ownerId');
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;
  const reasonCode = args.reasonCode || args.reason_code
    ? String(args.reasonCode || args.reason_code).trim().slice(0, 32)
    : null;
  const reference = args.reference ? String(args.reference).slice(0, 255) : null;
  const idempotencyKey = args.idempotencyKey || args.idempotency_key
    ? String(args.idempotencyKey || args.idempotency_key).trim().slice(0, 64)
    : null;

  const existingKey = await findByIdempotencyKey(db, idempotencyKey);
  if (existingKey) return hydrate(db, existingKey);

  const run = async (trx) => {
    const replay = await findByIdempotencyKey(trx, idempotencyKey);
    if (replay) return hydrate(trx, replay);

    await assertOwnerExists(trx, ownerType, ownerId);
    const { table, row } = await lockHolding(trx, resourceType, resourceId);
    const replayAfterLock = await findByIdempotencyKey(trx, idempotencyKey);
    if (replayAfterLock) return hydrate(trx, replayAfterLock);

    const precision = declaredPrecision(row);
    const tracked = isQuantityTracked(row);

    if (resourceType === 'ASSET') {
      await assertAssetEligible(trx, row);
      const existing = await trx('reservation')
        .where({ resource_type: 'ASSET', status: 'ACTIVE' })
        .whereRaw('LOWER(resource_id) = LOWER(?)', [row.id])
        .first();
      if (existing) {
        throw httpError(
          `ASSET ${row.id} already reserved by ${existing.owner_type} ${existing.owner_id} (${existing.id})`,
          409,
          'ASSET_ALREADY_RESERVED',
          {
            existingReservationId: existing.id,
            ownerType: existing.owner_type,
            ownerId: existing.owner_id
          }
        );
      }
    } else {
      await assertInventoryEligible(row);
    }

    let quantity;
    if (resourceType === 'ASSET') {
      const whole = tracked ? roundQty(row.quantity_total, precision) : 1;
      if (!(whole > 0)) {
        throw httpError(`ASSET ${row.id} has no reservable quantity`, 409, 'NOTHING_TO_RESERVE');
      }
      if (args.quantity != null && args.quantity !== '') {
        quantity = roundQty(args.quantity, precision);
        if (!qtyEq(quantity, whole, precision)) {
          throw httpError(
            `ASSET reservations are whole-record only (requested ${quantity}, holding ${whole})`,
            400,
            'ASSET_PARTIAL_NOT_ALLOWED'
          );
        }
      } else {
        quantity = whole;
      }
      if (tracked) {
        const available = roundQty(row.quantity_available, precision);
        if (quantity - available > 1e-9) {
          throw httpError(
            `ASSET ${row.id} is not fully available (available ${available} / required ${quantity})`,
            409,
            'INSUFFICIENT_AVAILABLE'
          );
        }
      }
    } else {
      if (args.quantity == null || args.quantity === '') {
        throw httpError('quantity is required for INVENTORY reservations', 400, 'MISSING_QUANTITY');
      }
      quantity = roundQty(args.quantity, precision);
      if (!(quantity > 0)) {
        throw httpError('Reservation quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      }
      const available = roundQty(row.quantity_available, precision);
      if (quantity - available > 1e-9) {
        throw httpError(
          `INVENTORY ${row.id} has insufficient available quantity (requested ${quantity}, available ${available})`,
          409,
          'INSUFFICIENT_AVAILABLE'
        );
      }
    }

    if (tracked) {
      await applyHoldingDelta(trx, table, row.id, -quantity, quantity, precision);
    }

    const id = await uniqueReservationId(trx);
    const now = new Date().toISOString();
    try {
      await trx('reservation').insert({
        id,
        resource_type: resourceType,
        resource_id: row.id,
        quantity,
        quantity_original: quantity,
        owner_type: ownerType,
        owner_id: ownerId,
        status: 'ACTIVE',
        reason,
        reason_code: reasonCode,
        reference,
        idempotency_key: idempotencyKey,
        created_by: actor,
        created_at: now,
        updated_at: now
      });
    } catch (err) {
      if (isUniqueViolation(err, 'reservation_one_active_asset')) {
        const held = await trx('reservation')
          .where({ resource_type: 'ASSET', status: 'ACTIVE' })
          .whereRaw('LOWER(resource_id) = LOWER(?)', [row.id])
          .first();
        throw httpError(
          `ASSET ${row.id} already reserved by ${held ? `${held.owner_type} ${held.owner_id} (${held.id})` : 'another owner'}`,
          409,
          'ASSET_ALREADY_RESERVED',
          held
            ? { existingReservationId: held.id, ownerType: held.owner_type, ownerId: held.owner_id }
            : undefined
        );
      }
      if (isUniqueViolation(err, 'reservation_idempotency_key_unique')) {
        throw err;
      }
      throw err;
    }

    await writeReservationEvent(trx, {
      reservationId: id,
      type: 'RESERVE',
      quantity,
      actor,
      note: reason,
      metadata: {
        resource_type: resourceType,
        resource_id: row.id,
        owner_type: ownerType,
        owner_id: ownerId,
        reason_code: reasonCode,
        reference
      }
    });

    if (tracked) {
      await writeQuantityEvent(trx, {
        table,
        rootId: row.quantity_root_id || row.id,
        type: 'RESERVE',
        actor,
        note: `Reserved ${quantity} on ${row.id} for ${ownerType} ${ownerId}`,
        metadata: { reservation_id: id, owner_type: ownerType, owner_id: ownerId },
        lines: [{
          id: row.id,
          unit: row.quantity_unit,
          deltaAvailable: -quantity,
          deltaTotal: 0
        }]
      });
      await assertLedgerMatchesCounter(trx, resourceType, row.id, precision);
    }

    const created = await trx('reservation').where({ id }).first();
    return hydrate(trx, created);
  };

  try {
    if (args.trx) return await run(args.trx);
    return await db.transaction(run);
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err, 'reservation_idempotency_key_unique')) {
      const existing = await findByIdempotencyKey(db, idempotencyKey);
      if (existing) return hydrate(db, existing);
    }
    throw err;
  }
}

async function release(args = {}) {
  await requireTables();
  const id = trimId(args.id, 'id');
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;
  const reasonCode = args.reasonCode || args.reason_code
    ? String(args.reasonCode || args.reason_code).trim().slice(0, 32)
    : null;

  const run = async (trx) => {
    const current = await trx('reservation').where({ id }).first();
    if (!current) throw httpError(`Reservation ${id} not found`, 404, 'NOT_FOUND');
    if (current.status !== 'ACTIVE') {
      throw httpError(
        `Reservation ${id} is ${current.status} and cannot be released`,
        409,
        'NOT_ACTIVE'
      );
    }

    const { table, row } = await lockHolding(trx, current.resource_type, current.resource_id);
    const locked = await trx('reservation').where({ id }).forUpdate().first();
    if (!locked || locked.status !== 'ACTIVE') {
      throw httpError(`Reservation ${id} is not ACTIVE`, 409, 'NOT_ACTIVE');
    }

    const precision = declaredPrecision(row);
    const remaining = roundQty(locked.quantity, precision);
    let quantity;
    if (args.quantity == null || args.quantity === '') {
      quantity = remaining;
    } else {
      quantity = roundQty(args.quantity, precision);
    }
    if (!(quantity > 0)) {
      throw httpError('Release quantity must be greater than zero', 400, 'INVALID_QUANTITY');
    }
    if (quantity - remaining > 1e-9) {
      throw httpError(
        `Release ${quantity} exceeds remaining reservation ${remaining} on ${id}`,
        409,
        'RELEASE_EXCEEDS_REMAINING'
      );
    }
    if (locked.resource_type === 'ASSET' && !qtyEq(quantity, remaining, precision)) {
      throw httpError(
        'Asset reservations cannot be partially released',
        400,
        'ASSET_PARTIAL_NOT_ALLOWED'
      );
    }

    const tracked = isQuantityTracked(row);
    if (tracked) {
      await applyHoldingDelta(trx, table, row.id, quantity, -quantity, precision);
    }

    const nextRemaining = roundQty(remaining - quantity, precision);
    const now = new Date().toISOString();
    const full = qtyEq(nextRemaining, 0, precision);
    const nextStatus = full ? 'RELEASED' : 'ACTIVE';
    const update = {
      quantity: nextRemaining,
      status: nextStatus,
      updated_at: now
    };
    if (reason != null) update.reason = reason;
    if (reasonCode) update.reason_code = reasonCode;
    if (full) {
      update.released_by = actor;
      update.released_at = now;
    }
    await trx('reservation').where({ id }).update(update);

    await writeReservationEvent(trx, {
      reservationId: id,
      type: full ? 'RELEASE' : 'PARTIAL_RELEASE',
      quantity,
      actor,
      note: reason,
      metadata: {
        previous_quantity: remaining,
        remaining: nextRemaining,
        reason_code: reasonCode || locked.reason_code,
        owner_type: locked.owner_type,
        owner_id: locked.owner_id
      }
    });

    if (tracked) {
      await writeQuantityEvent(trx, {
        table,
        rootId: row.quantity_root_id || row.id,
        type: 'UNRESERVE',
        actor,
        note: `Released ${quantity} from ${id} on ${row.id}`,
        metadata: { reservation_id: id, remaining: nextRemaining },
        lines: [{
          id: row.id,
          unit: row.quantity_unit,
          deltaAvailable: quantity,
          deltaTotal: 0
        }]
      });
      await assertLedgerMatchesCounter(trx, locked.resource_type, row.id, precision);
    }

    const updated = await trx('reservation').where({ id }).first();
    return hydrate(trx, updated);
  };

  if (args.trx) return run(args.trx);
  return db.transaction(run);
}

async function transfer(args = {}) {
  await requireTables();
  const id = trimId(args.id, 'id');
  const ownerType = normType(args.ownerType || args.owner_type, OWNER_TYPES, 'ownerType');
  const ownerId = trimId(args.ownerId || args.owner_id, 'ownerId');
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;
  const reasonCode = args.reasonCode || args.reason_code
    ? String(args.reasonCode || args.reason_code).trim().slice(0, 32)
    : null;

  const run = async (trx) => {
    const current = await trx('reservation').where({ id }).first();
    if (!current) throw httpError(`Reservation ${id} not found`, 404, 'NOT_FOUND');
    if (current.status !== 'ACTIVE') {
      throw httpError(
        `Reservation ${id} is ${current.status} and cannot be transferred`,
        409,
        'NOT_ACTIVE'
      );
    }
    if (current.owner_type === ownerType && String(current.owner_id) === ownerId) {
      throw httpError('Transfer destination owner must differ from the source owner', 400, 'SAME_OWNER');
    }

    await assertOwnerExists(trx, ownerType, ownerId);
    const { row } = await lockHolding(trx, current.resource_type, current.resource_id);
    const locked = await trx('reservation').where({ id }).forUpdate().first();
    if (!locked || locked.status !== 'ACTIVE') {
      throw httpError(`Reservation ${id} is not ACTIVE`, 409, 'NOT_ACTIVE');
    }

    const precision = declaredPrecision(row);
    const quantity = roundQty(locked.quantity, precision);
    const newId = await uniqueReservationId(trx);
    const now = new Date().toISOString();

    await trx('reservation').where({ id: locked.id }).update({
      status: 'TRANSFERRED',
      transferred_to_id: newId,
      updated_at: now
    });

    await trx('reservation').insert({
      id: newId,
      resource_type: locked.resource_type,
      resource_id: locked.resource_id,
      quantity,
      quantity_original: quantity,
      owner_type: ownerType,
      owner_id: ownerId,
      status: 'ACTIVE',
      reason: reason || locked.reason,
      reason_code: reasonCode || locked.reason_code,
      reference: locked.reference,
      parent_reservation_id: locked.id,
      created_by: actor,
      created_at: now,
      updated_at: now
    });

    await writeReservationEvent(trx, {
      reservationId: locked.id,
      type: 'TRANSFER',
      quantity,
      actor,
      note: reason,
      metadata: {
        source_reservation_id: locked.id,
        destination_reservation_id: newId,
        from_owner_type: locked.owner_type,
        from_owner_id: locked.owner_id,
        to_owner_type: ownerType,
        to_owner_id: ownerId
      }
    });
    await writeReservationEvent(trx, {
      reservationId: newId,
      type: 'RESERVE',
      quantity,
      actor,
      note: reason || `Transferred from ${locked.id}`,
      metadata: {
        transfer: true,
        source_reservation_id: locked.id,
        from_owner_type: locked.owner_type,
        from_owner_id: locked.owner_id,
        to_owner_type: ownerType,
        to_owner_id: ownerId
      }
    });

    if (isQuantityTracked(row)) {
      await assertLedgerMatchesCounter(trx, locked.resource_type, row.id, precision);
    }

    const source = await trx('reservation').where({ id: locked.id }).first();
    const dest = await trx('reservation').where({ id: newId }).first();
    const sourceHydrated = await hydrate(trx, source);
    const destHydrated = await hydrate(trx, dest);
    return {
      source: sourceHydrated.reservation,
      sourceEvents: sourceHydrated.events,
      destination: destHydrated.reservation,
      destinationEvents: destHydrated.events
    };
  };

  if (args.trx) return run(args.trx);
  return db.transaction(run);
}

async function getById(id) {
  await requireTables();
  const row = await db('reservation').where({ id: trimId(id, 'id') }).first();
  if (!row) throw httpError(`Reservation ${id} not found`, 404, 'NOT_FOUND');
  return hydrate(db, row);
}

async function list(filters = {}) {
  await requireTables();
  let q = db('reservation').orderBy('created_at', 'desc');
  if (filters.resourceType || filters.resource_type) {
    q = q.andWhere('resource_type', String(filters.resourceType || filters.resource_type).toUpperCase());
  }
  if (filters.resourceId || filters.resource_id) {
    q = q.andWhereRaw('LOWER(resource_id) = LOWER(?)', [filters.resourceId || filters.resource_id]);
  }
  if (filters.ownerType || filters.owner_type) {
    q = q.andWhere('owner_type', String(filters.ownerType || filters.owner_type).toUpperCase());
  }
  if (filters.ownerId || filters.owner_id) {
    q = q.andWhereRaw('LOWER(owner_id) = LOWER(?)', [filters.ownerId || filters.owner_id]);
  }
  if (filters.status) {
    q = q.andWhere('status', String(filters.status).toUpperCase());
  }
  const limit = Math.min(500, Math.max(1, parseInt(filters.limit, 10) || 100));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
  const rows = await q.limit(limit).offset(offset);
  return { reservations: rows.map(publicReservation), limit, offset };
}

async function listForResource(resourceType, resourceId) {
  await requireTables();
  const type = normType(resourceType, RESOURCE_TYPES, 'resourceType');
  const id = trimId(resourceId, 'resourceId');
  const rows = await db('reservation')
    .where('resource_type', type)
    .whereRaw('LOWER(resource_id) = LOWER(?)', [id])
    .orderBy('created_at', 'desc');
  const events = rows.length
    ? await db('reservation_event').whereIn('reservation_id', rows.map((r) => r.id)).orderBy('id')
    : [];
  const byRes = new Map();
  for (const ev of events) {
    if (!byRes.has(ev.reservation_id)) byRes.set(ev.reservation_id, []);
    byRes.get(ev.reservation_id).push(publicEvent(ev));
  }
  return {
    resourceType: type,
    resourceId: id,
    reservations: rows.map((row) => ({
      ...publicReservation(row),
      events: byRes.get(row.id) || []
    }))
  };
}

async function assertNoActiveReservations(resourceType, resourceId, trx) {
  if (!(await tablesReady(trx || db))) return;
  const type = normType(resourceType, RESOURCE_TYPES, 'resourceType');
  const id = trimId(resourceId, 'resourceId');
  const runner = trx || db;
  const active = await runner('reservation')
    .where({ resource_type: type, status: 'ACTIVE' })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [id])
    .first();
  if (active) {
    throw httpError(
      `${type} ${id} has ACTIVE reservation ${active.id} (${active.owner_type} ${active.owner_id}); cannot inactivate or consume reserved quantity`,
      409,
      'RESOURCE_HAS_ACTIVE_RESERVATION',
      { reservationId: active.id, ownerType: active.owner_type, ownerId: active.owner_id }
    );
  }
}

module.exports = {
  RESOURCE_TYPES,
  OWNER_TYPES,
  STATUSES,
  reserve,
  release,
  transfer,
  getById,
  list,
  listForResource,
  assertNoActiveReservations,
  assertAssetEligible,
  assertInventoryEligible,
  tablesReady,
  qtyNum,
  roundQty,
  qtyEq
};
