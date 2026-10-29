/**
 * Delivery Challan physical disposition lifecycle.
 *
 * DC is an outbound logistics transaction — NOT a stock ledger.
 * Physical mutations occur only on DISPATCH via existing Asset / Inventory /
 * Reservation / quantity-event primitives.
 *
 * Lifecycle: DRAFT → READY → DISPATCHED (or VOID before dispatch)
 * Dispatch reasons come from the dc_dispatch_reason catalog (services/dcReasonCatalog.js).
 * Each reason's behaviour decides the physical effect:
 *   returnable (closed by Return Inward), optionally with a transfer destination
 *   ownership exit (sale / other / vendor return)
 */
const crypto = require('crypto');
const { db } = require('../utils');
const reservationService = require('./reservationService');
const deliveryChallanEventService = require('./deliveryChallanEventService');
const dcVersionService = require('./dcVersionService');
const purchaseBookService = require('./purchaseBookService');
const reasonCatalog = require('./dcReasonCatalog');

/** Reasons with a destination (Stock Transfer and custom transfer reasons) need one; others clear it. */
function resolveTransferDestination(reasonDef, raw, existing) {
  if (!reasonDef || !reasonDef.requiresDestination) return null;
  const dest = trimText(raw) || trimText(existing);
  if (!dest) {
    throw httpError(`Destination location is required for a ${reasonDef.label} DC`, 400, 'TRANSFER_DESTINATION_REQUIRED');
  }
  return dest.slice(0, 255);
}

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function trimText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function parsePayload(row) {
  if (!row || !row.payloadjson) return {};
  try {
    return typeof row.payloadjson === 'string' ? JSON.parse(row.payloadjson) : row.payloadjson;
  } catch (_) {
    return {};
  }
}

function parseAssetIds(row) {
  if (!row || row.assetids == null) return [];
  try {
    const raw = typeof row.assetids === 'string' ? JSON.parse(row.assetids) : row.assetids;
    return Array.isArray(raw) ? raw.map((id) => String(id)) : [];
  } catch (_) {
    return [];
  }
}

function extractLines(row) {
  const payload = parsePayload(row);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lines = [];
  for (const item of items) {
    const resourceId = trimText(item.assetId || item.resourceId || item.id);
    if (!resourceId) continue;
    // Presentation-only PO/book lines without physical holding are skipped
    if (item.isPoLine || item.isPurchaseBookLine) {
      const hasPhys = trimText(item.physicalResourceId || item.holdingId);
      if (!hasPhys && !trimText(item.assetId)) continue;
    }
    const resourceType = String(item.resourceType || 'ASSET').toUpperCase() === 'INVENTORY'
      ? 'INVENTORY'
      : 'ASSET';
    const qty = Number(item.qty != null ? item.qty : item.quantity != null ? item.quantity : 1);
    lines.push({
      resourceType,
      resourceId: trimText(item.physicalResourceId || item.holdingId || resourceId),
      productId: trimText(item.productId || item.product_id),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      serialSnapshot: trimText(item.srNo || item.serialNumber || item.serial),
      displayName: trimText(item.description || item.name)
    });
  }
  // Fallback: assetids column when payload items empty
  if (!lines.length) {
    for (const id of parseAssetIds(row)) {
      lines.push({
        resourceType: 'ASSET',
        resourceId: id,
        productId: null,
        quantity: 1,
        serialSnapshot: null,
        displayName: null
      });
    }
  }
  return lines;
}

function isPhysicalDc(row) {
  return extractLines(row).length > 0;
}

/**
 * Every physical DC line must point at a holding that actually has quantity.
 * A serial number is optional; an owned quantity (quantity_total > 0) is not.
 * With checkAvailable (draft / READY) the unreserved quantity must also cover the line;
 * at dispatch the stock is already reserved by this DC, so only ownership is checked.
 */
async function assertLinesHaveQuantity(runner, lines, { checkAvailable = false } = {}) {
  const problems = [];
  for (const line of lines) {
    const find = (table) => runner(table)
      .whereRaw('LOWER(id) = LOWER(?)', [line.resourceId])
      .first('id', 'itemname', 'quantity_total', 'quantity_available', 'is_quantity_tracked');
    // Legacy assetids lists can mix asset and inventory ids, so fall back to the other table.
    const [primary, secondary] = line.resourceType === 'INVENTORY' ? ['inventory_items', 'assets'] : ['assets', 'inventory_items'];
    const h = (await find(primary)) || (await find(secondary));
    if (!h) {
      problems.push({ resourceId: line.resourceId, problem: 'NOT_FOUND' });
      continue;
    }
    const total = h.quantity_total == null ? null : Number(h.quantity_total);
    const available = h.quantity_available == null ? null : Number(h.quantity_available);
    const requested = Number(line.quantity);
    const tracked = Number(h.is_quantity_tracked) === 1 || (available != null && available > 1);
    const need = tracked || line.resourceType === 'INVENTORY'
      ? (Number.isFinite(requested) && requested > 0 ? requested : 1)
      : 0;
    const label = `${h.itemname || h.id} (${h.id})`;
    if (!(total > 0)) {
      problems.push({ resourceId: h.id, problem: 'NO_QUANTITY', message: `${label} has no quantity` });
    } else if (checkAvailable && !(available > 0)) {
      problems.push({ resourceId: h.id, problem: 'NO_AVAILABLE_QUANTITY', message: `${label} has no available quantity` });
    } else if (checkAvailable && need > available + 1e-9) {
      problems.push({ resourceId: h.id, problem: 'INSUFFICIENT_QUANTITY', message: `${label} has ${available} available, DC needs ${need}` });
    }
  }
  if (problems.length) {
    const msg = problems.map((p) => p.message || `${p.resourceId} not found`).join('; ');
    throw httpError(`Cannot put these on a DC: ${msg}`, 409, 'DC_HOLDING_NO_QUANTITY', { problems });
  }
}

function publicDc(row, extras = {}) {
  if (!row) return null;
  const payload = parsePayload(row);
  return {
    id: row.id,
    challanNo: row.challanno,
    customerName: row.customername,
    deliveryDate: row.deliverydate,
    status: row.status,
    lifecycleStatus: row.lifecycle_status || null,
    dispatchReason: row.dispatch_reason || null,
    transferDestination: row.transfer_destination || null,
    readyAt: row.ready_at || null,
    readyBy: row.ready_by || null,
    dispatchedAt: row.dispatched_at || null,
    dispatchedBy: row.dispatched_by || null,
    returnedAt: row.returned_at || null,
    returnedBy: row.returned_by || null,
    voidedAt: row.voided_at || null,
    voidedBy: row.voided_by || null,
    createdBy: row.createdby,
    timestamp: row.timestamp,
    payload,
    lines: extractLines(row),
    ...extras
  };
}

async function getDcRow(runner, id) {
  const row = await runner('delivery_challans').where({ id: String(id).trim() }).first();
  if (!row) throw httpError(`Delivery Challan ${id} not found`, 404, 'NOT_FOUND');
  return row;
}

async function destinationPatch(trx, reasonDef, rawDestination, existing) {
  const dest = resolveTransferDestination(reasonDef, rawDestination, existing);
  if (!(await trx.schema.hasColumn('delivery_challans', 'transfer_destination'))) {
    if (dest) throw httpError('Stock Transfer requires migration 20260928160000', 409, 'MIGRATION_REQUIRED');
    return {};
  }
  return { transfer_destination: dest };
}

async function setDispatchReason(dcId, dispatchReason, actor, { transferDestination } = {}) {
  const reasonDef = await reasonCatalog.requireUsable(dispatchReason);
  const reason = reasonDef.code;
  return db.transaction(async (trx) => {
    const row = await trx('delivery_challans').where({ id: dcId }).forUpdate().first();
    if (!row) throw httpError(`Delivery Challan ${dcId} not found`, 404, 'NOT_FOUND');
    const life = String(row.lifecycle_status || '').toUpperCase();
    if (life === 'DISPATCHED') {
      throw httpError('Dispatch Reason is immutable after DISPATCHED', 409, 'REASON_IMMUTABLE');
    }
    if (life === 'VOID' || row.voided_at) {
      throw httpError('Cannot set Dispatch Reason on a voided DC', 409, 'DC_VOID');
    }
    if (life === 'LEGACY') {
      throw httpError('Legacy DCs cannot receive a new Dispatch Reason', 409, 'LEGACY_DC');
    }
    const destPatch = await destinationPatch(trx, reasonDef, transferDestination, row.transfer_destination);
    await trx('delivery_challans').where({ id: dcId }).update({
      dispatch_reason: reason,
      status: row.status,
      ...destPatch
    });
    await deliveryChallanEventService.writeDcEvent(trx, {
      deliveryChallanId: dcId,
      type: 'UPDATED',
      actor: actor || null,
      note: `Dispatch reason set to ${reason}${destPatch.transfer_destination ? ` → ${destPatch.transfer_destination}` : ''}`,
      metadata: { dispatchReason: reason, transferDestination: destPatch.transfer_destination || null }
    });
    return publicDc(await trx('delivery_challans').where({ id: dcId }).first());
  });
}

async function markReady(dcId, actor, { dispatchReason, transferDestination } = {}) {
  return db.transaction(async (trx) => {
    const row = await trx('delivery_challans').where({ id: dcId }).forUpdate().first();
    if (!row) throw httpError(`Delivery Challan ${dcId} not found`, 404, 'NOT_FOUND');
    const life = String(row.lifecycle_status || '').toUpperCase();
    if (life === 'READY') return publicDc(row);
    if (life === 'DISPATCHED') throw httpError('DC already DISPATCHED', 409, 'ALREADY_DISPATCHED');
    if (life === 'VOID' || row.voided_at) throw httpError('DC is VOID', 409, 'DC_VOID');
    if (life === 'LEGACY') throw httpError('Legacy DC cannot enter READY', 409, 'LEGACY_DC');
    if (life && life !== 'DRAFT') {
      throw httpError(`DC must be DRAFT to become READY (was ${life})`, 409, 'INVALID_STATUS');
    }

    let reason = row.dispatch_reason;
    let reasonDef = null;
    if (dispatchReason) {
      reasonDef = await reasonCatalog.requireUsable(dispatchReason, trx);
      reason = reasonDef.code;
    }
    if (isPhysicalDc(row)) {
      if (!reason || reason === 'LEGACY_UNSPECIFIED') {
        throw httpError('Dispatch Reason is required before READY for physical DCs', 400, 'DISPATCH_REASON_REQUIRED');
      }
    }
    if (!reasonDef && reason && reason !== 'LEGACY_UNSPECIFIED') {
      reasonDef = await reasonCatalog.requireKnown(reason, trx);
    }
    const destPatch = reasonDef
      ? await destinationPatch(trx, reasonDef, transferDestination, row.transfer_destination)
      : {};

    const lines = extractLines(row);
    await assertLinesHaveQuantity(trx, lines, { checkAvailable: true });
    const reservationIds = [];
    for (const line of lines) {
      const idem = `dc-ready-${dcId}-${line.resourceType}-${line.resourceId}`.slice(0, 64);
      const result = await reservationService.reserve({
        trx,
        resourceType: line.resourceType,
        resourceId: line.resourceId,
        ownerType: 'DC',
        ownerId: dcId,
        quantity: line.resourceType === 'INVENTORY' ? line.quantity : undefined,
        actor: actor || null,
        reason: `DC ${row.challanno} READY`,
        reasonCode: 'DC_READY',
        reference: row.challanno,
        idempotencyKey: idem
      });
      reservationIds.push(result.reservation?.id || result.id);
    }

    const now = new Date().toISOString();
    await trx('delivery_challans').where({ id: dcId }).update({
      lifecycle_status: 'READY',
      status: 'READY',
      dispatch_reason: reason || row.dispatch_reason || null,
      ready_at: now,
      ready_by: actor || null,
      ...destPatch
    });

    await deliveryChallanEventService.writeDcEvent(trx, {
      deliveryChallanId: dcId,
      type: 'READY',
      actor: actor || null,
      note: `DC marked READY${reason ? ` (${reason})` : ''}${destPatch.transfer_destination ? ` → ${destPatch.transfer_destination}` : ''}. Holdings: ${lines.map((line) => `${line.resourceType} ${line.resourceId}`).join(', ') || 'none'}`,
      metadata: {
        dispatchReason: reason || null,
        transferDestination: destPatch.transfer_destination || null,
        reservationIds,
        holdings: lines.map((line) => ({ resourceType: line.resourceType, resourceId: line.resourceId }))
      }
    });

    return publicDc(await trx('delivery_challans').where({ id: dcId }).first(), { reservationIds });
  });
}

function newDispositionLineId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DCL-${stamp}-${rand}`;
}

async function applyAssetDisposition(trx, line, reasonDef, challanNo, actor, dcId) {
  const reason = reasonDef.code;
  const asset = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [line.resourceId]).forUpdate().first();
  if (!asset) throw httpError(`Asset ${line.resourceId} not found`, 404, 'ASSET_NOT_FOUND');
  if (Number(asset.is_retired) === 1 || String(asset.status || '').toLowerCase() === 'sold') {
    throw httpError(`Asset ${line.resourceId} is already sold/retired`, 409, 'ASSET_ALREADY_SOLD');
  }
  const priorStatus = asset.status;
  const patch = {
    status: reasonDef.assetStatus,
    sentagainstdc: challanNo,
    lastupdated: new Date().toISOString()
  };
  if (reasonDef.exit) {
    patch.is_retired = 1;
    patch.sale_details = JSON.stringify({
      source: 'DC_DISPATCH',
      exitReason: reason,
      deliveryChallanId: dcId,
      challanNo,
      dispatchedAt: new Date().toISOString(),
      actor: actor || null
    });
  }
  await trx('assets').where({ id: asset.id }).update(patch);

  // Release DC reservation (status blocks further reserve)
  const active = await trx('reservation')
    .where({ resource_type: 'ASSET', status: 'ACTIVE', owner_type: 'DC', owner_id: dcId })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
    .first();
  let reservationId = active ? active.id : null;
  if (active) {
    await reservationService.release({
      trx,
      id: active.id,
      actor: actor || null,
      reason: `DC ${challanNo} DISPATCHED ${reason}`
    });
  }

  // Returnable dispatch keeps ownership, but the quantity is no longer free to issue.
  if (reasonDef.returnable && Number(asset.is_quantity_tracked) === 1) {
    const fresh = await trx('assets').where({ id: asset.id }).forUpdate().first();
    const available = Number(fresh && fresh.quantity_available || 0);
    const take = Math.min(available, Math.max(Number(line.quantity) || 1, 1));
    if (take > 0) {
      await trx('assets').where({ id: asset.id }).update({
        quantity_available: available - take,
        lastupdated: new Date().toISOString()
      });
    }
  }

  await deliveryChallanEventService.writeHoldingHistory(trx, {
    resourceType: 'ASSET',
    resourceId: asset.id,
    action: 'DC_DISPATCHED',
    oldValue: priorStatus,
    newValue: reasonDef.assetStatus,
    actor,
    details: `Dispatched on DC ${challanNo} (${reason})`
  });

  return {
    priorStatus,
    reservationId,
    dispositionStatus: reasonDef.dispositionStatus,
    serialSnapshot: line.serialSnapshot || asset.srno || null
  };
}

async function applyInventoryDisposition(trx, line, reasonDef, challanNo, actor, dcId) {
  const reason = reasonDef.code;
  const inv = await trx('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [line.resourceId]).forUpdate().first();
  if (!inv) throw httpError(`Inventory ${line.resourceId} not found`, 404, 'INVENTORY_NOT_FOUND');

  const qty = Number(line.quantity);
  if (!(qty > 0)) throw httpError('Inventory dispatch quantity must be > 0', 400, 'INVALID_QUANTITY');

  const active = await trx('reservation')
    .where({ resource_type: 'INVENTORY', status: 'ACTIVE', owner_type: 'DC', owner_id: dcId })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [inv.id])
    .first();

  if (reasonDef.returnable) {
    // Keep reservation as non-available owned external custody until return.
    if (!active) {
      throw httpError(
        `Inventory ${inv.id} has no active DC reservation for temporary disposition`,
        409,
        'RESERVATION_REQUIRED'
      );
    }
    await deliveryChallanEventService.writeHoldingHistory(trx, {
      resourceType: 'INVENTORY',
      resourceId: inv.id,
      action: 'DC_DISPATCHED',
      oldValue: inv.status || null,
      newValue: reasonDef.dispositionStatus,
      actor,
      details: `Dispatched on DC ${challanNo} (${reason}), quantity ${qty}`,
      metadata: { deliveryChallanId: dcId, challanNo, dispatchReason: reason, quantity: qty }
    });
    return {
      priorStatus: inv.status || null,
      reservationId: active.id,
      dispositionStatus: reasonDef.dispositionStatus,
      serialSnapshot: null
    };
  }

  // Ownership exit: release reservation then reduce owned total+available
  if (active) {
    await reservationService.release({
      trx,
      id: active.id,
      quantity: qty,
      actor: actor || null,
      reason: `DC ${challanNo} ${reason} release before ownership exit`
    });
  }

  const refreshed = await trx('inventory_items').where({ id: inv.id }).forUpdate().first();
  const available = Number(refreshed.quantity_available || 0);
  const total = Number(refreshed.quantity_total || 0);
  if (qty > available + 1e-9) {
    throw httpError(
      `${reason} quantity ${qty} exceeds available ${available} on ${inv.id}`,
      409,
      'INSUFFICIENT_QUANTITY'
    );
  }
  if (qty > total + 1e-9) {
    throw httpError(
      `${reason} quantity ${qty} exceeds owned total ${total} on ${inv.id}`,
      409,
      'INSUFFICIENT_OWNED_QUANTITY'
    );
  }

  const nextAvail = available - qty;
  const nextTotal = total - qty;
  await trx('inventory_items').where({ id: inv.id }).update({
    quantity_available: nextAvail,
    quantity_total: nextTotal,
    status: nextTotal <= 0 ? 'Consumed' : refreshed.status,
    lastupdated: new Date().toISOString()
  });

  if (await trx.schema.hasTable('inventory_quantity_events')) {
    const inserted = await trx('inventory_quantity_events')
      .insert({
        root_id: refreshed.quantity_root_id || inv.id,
        type: `DC_${reason}_EXIT`,
        actor: actor || null,
        timestamp: new Date().toISOString(),
        note: `Ownership exit (${reason}) via DC ${challanNo}`,
        metadata_json: JSON.stringify({ deliveryChallanId: dcId, challanNo, dispatchReason: reason })
      })
      .returning('id');
    const eventId = Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
    if (eventId && (await trx.schema.hasTable('inventory_quantity_event_lines'))) {
      await trx('inventory_quantity_event_lines').insert({
        event_id: eventId,
        item_id: inv.id,
        unit: refreshed.quantity_unit || 'Nos',
        delta_available: -qty,
        delta_total: -qty
      });
    }
  }

  await deliveryChallanEventService.writeHoldingHistory(trx, {
    resourceType: 'INVENTORY',
    resourceId: inv.id,
    action: 'DC_DISPATCHED',
    oldValue: inv.status || null,
    newValue: nextTotal <= 0 ? 'Consumed' : (inv.status || null),
    actor,
    details: `Dispatched on DC ${challanNo} (${reason}), quantity ${qty} exited`,
    metadata: { deliveryChallanId: dcId, challanNo, dispatchReason: reason, quantity: qty }
  });

  return {
    priorStatus: inv.status || null,
    reservationId: active ? active.id : null,
    dispositionStatus: reasonDef.dispositionStatus,
    serialSnapshot: null
  };
}

async function enqueueDispatchOutbox(trx, row, reasonDef, lines, actor) {
  const reason = reasonDef ? reasonDef.code : null;
  if (!(await trx.schema.hasTable('dc_dispatch_outbox'))) return null;
  const payload = {
    eventType: 'DC_DISPATCHED',
    dcId: row.id,
    dcLegalNumber: row.challanno,
    dispatchReason: reason,
    dispatchTimestamp: new Date().toISOString(),
    actor: actor || null,
    account: parsePayload(row).account || null,
    projectReference: parsePayload(row).meta?.referenceNo || null,
    lines: lines.map((l) => ({
      resourceType: l.resourceType,
      resourceId: l.resourceId,
      productId: l.productId,
      quantity: l.quantity,
      serialSnapshot: l.serialSnapshot,
      dispositionStatus: l.dispositionStatus
    }))
  };
  const idem = `dc-dispatch-${row.id}`;
  const existing = await trx('dc_dispatch_outbox').where({ idempotency_key: idem }).first();
  if (existing) return existing.id;
  const inserted = await trx('dc_dispatch_outbox')
    .insert({
      delivery_challan_id: row.id,
      event_type: 'DC_DISPATCHED',
      status: 'PENDING',
      idempotency_key: idem,
      payload_json: JSON.stringify(payload),
      attempt_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .returning('id');
  return Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
}

async function dispatch(dcId, actor, { dispatchReason } = {}) {
  return db.transaction(async (trx) => {
    const row = await trx('delivery_challans').where({ id: dcId }).forUpdate().first();
    if (!row) throw httpError(`Delivery Challan ${dcId} not found`, 404, 'NOT_FOUND');
    const life = String(row.lifecycle_status || '').toUpperCase();
    if (life === 'DISPATCHED') {
      throw httpError('DC already DISPATCHED', 409, 'DUPLICATE_DISPATCH');
    }
    if (life === 'VOID' || row.voided_at) throw httpError('Cannot dispatch a VOID DC', 409, 'DC_VOID');
    if (life === 'LEGACY') throw httpError('Legacy DC cannot be dispatched via new lifecycle', 409, 'LEGACY_DC');
    if (life !== 'READY') {
      throw httpError('DC must be READY before DISPATCH', 409, 'NOT_READY');
    }

    let reason = row.dispatch_reason;
    if (dispatchReason) reason = (await reasonCatalog.requireKnown(dispatchReason, trx)).code;
    const lines = extractLines(row);
    if (lines.length) {
      if (!reason || reason === 'LEGACY_UNSPECIFIED') {
        throw httpError('Dispatch Reason is required to dispatch a physical DC', 400, 'DISPATCH_REASON_REQUIRED');
      }
    } else {
      // Non-physical document: allow dispatch without reason
      reason = reason && reason !== 'LEGACY_UNSPECIFIED' ? reason : null;
    }

    if (reason && row.dispatch_reason && row.dispatch_reason !== reason) {
      throw httpError('Dispatch Reason cannot change at dispatch time', 409, 'REASON_MISMATCH');
    }
    const reasonDef = reason ? await reasonCatalog.requireKnown(reason, trx) : null;
    resolveTransferDestination(reasonDef, null, row.transfer_destination);
    await assertLinesHaveQuantity(trx, lines);

    const dispositionLines = [];
    for (const line of lines) {
      let effect;
      if (line.resourceType === 'ASSET') {
        effect = await applyAssetDisposition(trx, line, reasonDef, row.challanno, actor, dcId);
      } else {
        effect = await applyInventoryDisposition(trx, line, reasonDef, row.challanno, actor, dcId);
      }
      const lineId = newDispositionLineId();
      await trx('dc_disposition_line').insert({
        id: lineId,
        delivery_challan_id: dcId,
        resource_type: line.resourceType,
        resource_id: line.resourceId,
        product_id: line.productId,
        quantity: line.quantity,
        dispatch_reason: reason,
        disposition_status: effect.dispositionStatus,
        prior_asset_status: effect.priorStatus,
        reservation_id: effect.reservationId,
        serial_snapshot: effect.serialSnapshot,
        dispatched_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      dispositionLines.push({
        id: lineId,
        ...line,
        dispositionStatus: effect.dispositionStatus,
        priorStatus: effect.priorStatus
      });
    }

    const now = new Date().toISOString();
    await trx('delivery_challans').where({ id: dcId }).update({
      lifecycle_status: 'DISPATCHED',
      status: 'DISPATCHED',
      dispatch_reason: reason,
      dispatched_at: now,
      dispatched_by: actor || null
    });

    const postedRow = await trx('delivery_challans').where({ id: dcId }).first();
    await dcVersionService.recordFromRow(trx, postedRow, {
      reason: 'Posted',
      actor: actor || null,
      lifecycleStatus: 'DISPATCHED'
    });

    await deliveryChallanEventService.writeDcEvent(trx, {
      deliveryChallanId: dcId,
      type: 'DISPATCHED',
      actor: actor || null,
      note: `DC DISPATCHED reason=${reason || 'NONE'}. Holdings: ${dispositionLines.map((l) => `${l.resourceType} ${l.resourceId}`).join(', ') || 'none'}`,
      metadata: {
        dispatchReason: reason,
        holdings: dispositionLines.map((l) => ({ resourceType: l.resourceType, resourceId: l.resourceId })),
        lines: dispositionLines.map((l) => ({
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          quantity: l.quantity,
          dispositionStatus: l.dispositionStatus,
          serialSnapshot: l.serialSnapshot || null
        }))
      }
    });

    await enqueueDispatchOutbox(trx, row, reasonDef, dispositionLines, actor);

    return publicDc(await trx('delivery_challans').where({ id: dcId }).first(), {
      dispositionLines
    });
  });
}

async function returnFromDispatch(dcId, actor, args = {}) {
  // Immediate restore deprecated — route through Return Log + RETURN_INWARD RN
  const dcReturnInwardService = require('./dcReturnInwardService');
  return dcReturnInwardService.returnFromDispatch(dcId, actor, args);
}

/**
 * Save a new document version of a DRAFT or READY challan.
 * The version records the reason and the stage the DC was already in.
 * A READY challan releases its reservations and books them again for the new lines.
 */
async function reviseOpenDc(dcId, actor, input = {}) {
  const reason = trimText(input.reason);
  if (!reason) throw httpError('Enter a reason for this version', 400, 'VERSION_REASON_REQUIRED');
  if (!(await dcVersionService.tableReady(db))) {
    throw httpError('DC versioning is not migrated yet', 503, 'SCHEMA_PENDING');
  }

  let reasonDef = null;
  let normalizedDispatchReason = null;
  if (input.dispatchReason != null && String(input.dispatchReason).trim() !== '') {
    reasonDef = await reasonCatalog.requireUsable(input.dispatchReason);
    normalizedDispatchReason = reasonDef.code;
  }
  const normalizedTransfer = reasonDef && reasonDef.requiresDestination
    ? trimText(input.transferDestination)
    : trimText(input.transferDestination);

  return db.transaction(async (trx) => {
    const key = String(dcId || '').trim();
    let row = await trx('delivery_challans').where({ id: key }).forUpdate().first();
    if (!row) row = await trx('delivery_challans').where({ challanno: key }).forUpdate().first();
    if (!row) throw httpError('Delivery Challan not found', 404, 'NOT_FOUND');

    const id = row.id;
    const life = String(row.lifecycle_status || '').toUpperCase();
    if (life === 'DISPATCHED') throw httpError('A posted DC cannot be changed in the builder', 409, 'ALREADY_DISPATCHED');
    if (life === 'VOID' || row.voided_at) throw httpError('A voided DC cannot be changed', 409, 'DC_VOID');
    if (life === 'LEGACY') throw httpError('A legacy DC cannot be changed in the builder', 409, 'LEGACY_DC');
    if (life !== 'DRAFT' && life !== 'READY') {
      throw httpError(`Only a drafted or stock-reserved DC can be changed (was ${life || 'unknown'})`, 409, 'INVALID_STATUS');
    }

    const finalPayload = input.payload && typeof input.payload === 'object'
      ? JSON.parse(JSON.stringify(input.payload))
      : parsePayload(row);
    if (!finalPayload.meta) finalPayload.meta = {};
    finalPayload.meta.deliveryNoteNo = row.challanno;
    const reasonToStore = normalizedDispatchReason || row.dispatch_reason || null;
    if (reasonToStore) {
      finalPayload.meta.dispatchReason = reasonToStore;
      if (reasonDef) finalPayload.meta.dispatchReasonLabel = reasonDef.label;
    }

    let destPatch = {};
    if (reasonDef) {
      destPatch = await destinationPatch(trx, reasonDef, normalizedTransfer, row.transfer_destination);
    }
    if (destPatch.transfer_destination) {
      finalPayload.meta.transferDestination = destPatch.transfer_destination;
    }

    const assetIds = Array.isArray(input.assetIds) ? input.assetIds.map((value) => String(value)) : parseAssetIds(row);
    const lineRow = { payloadjson: finalPayload, assetids: JSON.stringify(assetIds) };
    if (life === 'READY' && isPhysicalDc(lineRow) && !reasonToStore) {
      throw httpError('Dispatch Reason is required on a stock-reserved DC', 400, 'DISPATCH_REASON_REQUIRED');
    }

    if (life === 'READY' && (await trx.schema.hasTable('reservation'))) {
      const active = await trx('reservation').where({ owner_type: 'DC', owner_id: id, status: 'ACTIVE' });
      for (const reservation of active) {
        await reservationService.release({
          trx,
          id: reservation.id,
          actor: actor || null,
          reason: `DC ${row.challanno} revised`
        });
      }
    }

    let bookConsumptions = Array.isArray(input.bookConsumptions) ? input.bookConsumptions.slice() : [];
    if (await trx.schema.hasTable('purchase_book_dc_consumption')) {
      await purchaseBookService.releaseDcBookConsumption(trx, id, { actor: actor || null });
    }
    const auto = await purchaseBookService.planAutoBookConsumptions(
      trx,
      Array.isArray(finalPayload.items) ? finalPayload.items : [],
      bookConsumptions
    );
    if (auto.length) bookConsumptions.push(...auto);
    if (bookConsumptions.length) finalPayload.meta.purchaseBookConsumptions = bookConsumptions;

    await assertLinesHaveQuantity(trx, extractLines({ payloadjson: finalPayload, assetids: lineRow.assetids }), { checkAvailable: true });

    if (life === 'READY') {
      const lines = extractLines({ payloadjson: finalPayload, assetids: lineRow.assetids });
      for (const line of lines) {
        const idem = `dcrev-${crypto.randomBytes(6).toString('hex')}-${line.resourceType}-${line.resourceId}`.slice(0, 64);
        await reservationService.reserve({
          trx,
          resourceType: line.resourceType,
          resourceId: line.resourceId,
          ownerType: 'DC',
          ownerId: id,
          quantity: line.resourceType === 'INVENTORY' ? line.quantity : undefined,
          actor: actor || null,
          reason: `DC ${row.challanno} revised while reserved`,
          reasonCode: 'DC_READY',
          reference: row.challanno,
          idempotencyKey: idem
        });
      }
    }

    if (bookConsumptions.length) {
      await purchaseBookService.recordDcBookConsumption(trx, id, bookConsumptions, { actor: actor || null });
    }

    const priorCount = await trx('delivery_challan_version').where({ delivery_challan_id: id }).first();
    if (!priorCount) {
      await dcVersionService.recordFromRow(trx, row, {
        reason: 'State before the first recorded edit',
        actor: actor || row.createdby || null,
        lifecycleStatus: life
      });
    }

    await trx('delivery_challans').where({ id }).update({
      customername: trimText(input.customerName) || row.customername || '',
      deliverydate: input.deliveryDate != null ? String(input.deliveryDate) : (row.deliverydate || ''),
      assetids: JSON.stringify(assetIds),
      payloadjson: JSON.stringify(finalPayload),
      dispatch_reason: reasonToStore,
      ...destPatch
    });

    const saved = await trx('delivery_challans').where({ id }).first();
    const version = await dcVersionService.recordFromRow(trx, saved, {
      reason,
      actor: actor || null,
      lifecycleStatus: life
    });

    const lineKey = (line) => `${line.resourceType}:${String(line.resourceId || '').toLowerCase()}`;
    const priorKeys = new Set(extractLines(row).map(lineKey));
    const nextLines = extractLines({ payloadjson: finalPayload, assetids: JSON.stringify(assetIds) });
    const added = nextLines.filter((line) => line.resourceId && !priorKeys.has(lineKey(line)));
    const nextKeys = new Set(nextLines.map(lineKey));
    const removed = extractLines(row).filter((line) => line.resourceId && !nextKeys.has(lineKey(line)));
    for (const line of added) {
      await deliveryChallanEventService.writeHoldingHistory(trx, {
        resourceType: line.resourceType,
        resourceId: line.resourceId,
        action: 'DC_ADDED',
        oldValue: null,
        newValue: row.challanno,
        actor,
        details: `Added to Delivery Challan ${row.challanno}`
      });
    }
    for (const line of removed) {
      await deliveryChallanEventService.writeHoldingHistory(trx, {
        resourceType: line.resourceType,
        resourceId: line.resourceId,
        action: 'DC_REMOVED',
        oldValue: row.challanno,
        newValue: null,
        actor,
        details: `Removed from Delivery Challan ${row.challanno} before dispatch`
      });
    }
    const addedNote = added.length
      ? ` Added ${added.map((line) => `${line.resourceType} ${line.resourceId}`).join(', ')}.`
      : '';
    const removedNote = removed.length
      ? ` Removed ${removed.map((line) => `${line.resourceType} ${line.resourceId}`).join(', ')}.`
      : '';

    await deliveryChallanEventService.writeDcEvent(trx, {
      deliveryChallanId: id,
      type: 'UPDATED',
      actor: actor || null,
      note: `Version ${version.versionNo} saved while ${life}: ${reason}.${addedNote}${removedNote}`,
      metadata: {
        versionNo: version.versionNo,
        lifecycleStatus: life,
        reason,
        added: added.map((line) => ({ resourceType: line.resourceType, resourceId: line.resourceId })),
        removed: removed.map((line) => ({ resourceType: line.resourceType, resourceId: line.resourceId }))
      }
    });

    return { dc: publicDc(saved), version };
  });
}

async function voidChallan(dcKey, { actor, reason } = {}) {
  const key = String(dcKey || '').trim();
  const who = actor || 'web';
  const why = reason ? String(reason).trim() : '';
  const result = await db.transaction(async (trx) => {
    let row = await trx('delivery_challans').where({ id: key }).forUpdate().first();
    if (!row) row = await trx('delivery_challans').where({ challanno: key }).forUpdate().first();
    if (!row) throw httpError('Delivery Challan not found', 404, 'NOT_FOUND');
    if (row.voided_at) return { id: row.id, challanNo: row.challanno, alreadyVoided: true };
    const life = String(row.lifecycle_status || '').toUpperCase();
    if (life === 'DISPATCHED') {
      throw httpError('DISPATCHED DCs cannot be voided; use return for DEMO/RENTAL/REPAIR', 409, 'ALREADY_DISPATCHED');
    }
    if (await trx.schema.hasTable('reservation')) {
      const active = await trx('reservation').where({ owner_type: 'DC', owner_id: row.id, status: 'ACTIVE' });
      for (const resv of active) {
        await reservationService.release({
          trx,
          id: resv.id,
          actor: who,
          reason: `DC ${row.challanno} voided`
        });
      }
    }
    const now = new Date().toISOString();
    await trx('delivery_challans').where({ id: row.id }).update({
      status: 'VOID',
      lifecycle_status: 'VOID',
      voided_at: now,
      voided_by: who
    });
    await purchaseBookService.releaseDcBookConsumption(trx, row.id, { actor: who });
    if (why) {
      try {
        const payload = row.payloadjson
          ? (typeof row.payloadjson === 'string' ? JSON.parse(row.payloadjson) : row.payloadjson)
          : {};
        if (!payload.meta) payload.meta = {};
        payload.meta.voidReason = why;
        payload.meta.voidedAt = now;
        payload.meta.voidedBy = who;
        await trx('delivery_challans').where({ id: row.id }).update({
          payloadjson: JSON.stringify(payload)
        });
      } catch (_) { /* keep the void if the payload cannot be patched */ }
    }
    return { id: row.id, challanNo: row.challanno, alreadyVoided: false };
  });
  await deliveryChallanEventService.writeDcEvent(db, {
    deliveryChallanId: result.id,
    type: 'VOIDED',
    actor: who,
    note: why ? `Voided: ${why}` : 'Voided',
    metadata: { challanNo: result.challanNo, alreadyVoided: !!result.alreadyVoided }
  }).catch((err) => console.error('[dc-event]', err.message));
  return result;
}

async function listDispositionLines(dcId) {
  if (!(await db.schema.hasTable('dc_disposition_line'))) return [];
  return db('dc_disposition_line').where({ delivery_challan_id: dcId }).orderBy('created_at', 'asc');
}

module.exports = {
  publicDc,
  extractLines,
  isPhysicalDc,
  assertLinesHaveQuantity,
  setDispatchReason,
  markReady,
  reviseOpenDc,
  dispatch,
  voidChallan,
  returnFromDispatch,
  listDispositionLines,
  getDcRow
};
