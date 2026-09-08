/**
 * Phase 5 Stage 0 containment for legacy Split / Unsplit / Unassign.
 *
 * Classifies parentid vs quantity_* lineage. Never migrates parentid.
 * Never hard-deletes unless LEGACY_UNSPLIT_HARD_DELETE is explicitly true
 * AND the row is a non-protected LEGACY_SPLIT_LIKE child.
 */
const reservationService = require('./reservationService');
const conversionService = require('./conversionService');

const ID_RE = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{4}-[A-Z0-9]{6}-[A-Z0-9]$/;

const CLASSES = Object.freeze({
  CANONICAL_BREAK: 'CANONICAL_BREAK',
  LEGACY_SPLIT_LIKE: 'LEGACY_SPLIT_LIKE',
  SET_LIKE: 'SET_LIKE',
  LEGACY_SUBASSEMBLY: 'LEGACY_SUBASSEMBLY',
  AMBIGUOUS: 'AMBIGUOUS'
});

const PROTECTED_PARENTID_PAIRS = Object.freeze([
  {
    childId: 'APP-MUM-0526-MMKBX9-W',
    parentId: 'HAR-MUM-0726-55QOFA-R'
  }
]);

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function flags() {
  return {
    // Default FALSE. Must never default to enabling deletion.
    LEGACY_UNSPLIT_HARD_DELETE: envFlag('LEGACY_UNSPLIT_HARD_DELETE', false),
    // Default FALSE after Stage 1 UI cutover.
    LEGACY_QUANTITY_SPLIT_UI: envFlag('LEGACY_QUANTITY_SPLIT_UI', false)
  };
}

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function normId(value) {
  return String(value || '').trim();
}

function idsEqual(a, b) {
  const left = normId(a);
  const right = normId(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function flagOn(row, ...keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
  }
  return false;
}

function isProtectedParentidPair(childId, parentId) {
  return PROTECTED_PARENTID_PAIRS.some(
    (pair) => idsEqual(pair.childId, childId) && idsEqual(pair.parentId, parentId)
  );
}

function textOf(row, ...keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function identitiesDiffer(child, parent) {
  const cName = textOf(child, 'itemname', 'ItemName').toLowerCase();
  const pName = textOf(parent, 'itemname', 'ItemName').toLowerCase();
  const cType = textOf(child, 'type', 'Type').toLowerCase();
  const pType = textOf(parent, 'type', 'Type').toLowerCase();
  const cProd = textOf(child, 'product_id', 'ProductId').toLowerCase();
  const pProd = textOf(parent, 'product_id', 'ProductId').toLowerCase();
  if (cName && pName && cName !== pName) return true;
  if (cType && pType && cType !== pType) return true;
  if (cProd && pProd && cProd !== pProd) return true;
  return false;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function loadAsset(trx, id) {
  if (!id) return null;
  return trx('assets').whereRaw('LOWER(id) = LOWER(?)', [normId(id).toLowerCase()]).first();
}

async function hasSplitCreatedHistory(trx, assetId) {
  const row = await trx('asset_history')
    .whereRaw('LOWER(assetid) = LOWER(?)', [normId(assetId).toLowerCase()])
    .andWhere('action', 'SPLIT_CHILD_CREATED')
    .first();
  return Boolean(row);
}

function mapReservationError(err) {
  if (err && err.reasonCode === 'RESOURCE_HAS_ACTIVE_RESERVATION') {
    throw httpError(err.message, 409, 'ACTIVE_RESERVATION', err.details);
  }
  throw err;
}

async function assertNoActiveReservation(resourceType, resourceId, trx) {
  try {
    await reservationService.assertNoActiveReservations(resourceType, resourceId, trx);
  } catch (err) {
    mapReservationError(err);
  }
}

async function assertConversionLineageProtected(resourceType, resourceId, trx) {
  const table = String(resourceType).toUpperCase() === 'ASSET' ? 'assets' : 'inventory_items';
  const row = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [normId(resourceId).toLowerCase()]).first();
  if (!row) return;
  if (row.conversion_id || row.conversion_source_id || qtyNum(row.quantity_converted) > 0) {
    try {
      await conversionService.assertNoUnreturnedConversions(resourceType, resourceId, trx);
    } catch (err) {
      if (err && err.reasonCode === 'UNRETURNED_CONVERSION') throw err;
      throw err;
    }
    throw httpError(
      `${resourceType} ${resourceId} has conversion lineage and cannot be destroyed by legacy Split/Unsplit/Unassign`,
      409,
      'UNRETURNED_CONVERSION',
      {
        conversionId: row.conversion_id || null,
        conversionSourceId: row.conversion_source_id || null
      }
    );
  }
  await conversionService.assertNoUnreturnedConversions(resourceType, resourceId, trx);
}

async function assertQuantityMutationAllowed({ resourceType, resourceId, operation, trx }) {
  const type = String(resourceType || 'ASSET').toUpperCase();
  const id = normId(resourceId);
  await assertNoActiveReservation(type, id, trx);
  const table = type === 'ASSET' ? 'assets' : 'inventory_items';
  const row = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).first();
  if (row && qtyNum(row.quantity_reserved) > 0) {
    throw httpError(
      `${type} ${id} has reserved quantity ${row.quantity_reserved}; ${operation || 'this operation'} cannot consume reserved quantity`,
      409,
      'ACTIVE_RESERVATION',
      { quantityReserved: row.quantity_reserved }
    );
  }
  if (String(operation || '').toUpperCase() === 'SERIAL_SPLIT' && row && (row.conversion_id || row.conversion_source_id || qtyNum(row.quantity_converted) > 0)) {
    throw httpError(
      `${type} ${id} has conversion lineage; serial split is blocked`,
      409,
      'UNRETURNED_CONVERSION'
    );
  }
  await conversionService.assertNoUnreturnedConversions(type, id, trx);
}

function classifyRows(child, parent, { hasSplitHistory = false } = {}) {
  const childId = child && (child.id || child.ID);
  const qtyParent = child && (child.quantity_parent_id || child.QuantityParentId || null);
  const legacyParent = child && (child.parentid || child.ParentId || null);
  const parentId = parent && (parent.id || parent.ID);

  if (isProtectedParentidPair(childId, legacyParent || parentId)) {
    return {
      class: CLASSES.LEGACY_SUBASSEMBLY,
      reasonCode: 'PROTECTED_LEGACY_RELATIONSHIP',
      childId,
      parentId: legacyParent || parentId,
      message: `${childId} → ${legacyParent || parentId} is a protected legacy relationship and cannot be merged or deleted`
    };
  }

  if (qtyParent && legacyParent) {
    return {
      class: CLASSES.AMBIGUOUS,
      reasonCode: 'AMBIGUOUS_LINEAGE',
      childId,
      parentId: legacyParent,
      quantityParentId: qtyParent,
      message: `${childId} has both parentid and quantity_parent_id; escalate, do not guess`
    };
  }

  if (qtyParent && !legacyParent) {
    const canonicalId = ID_RE.test(String(childId || '').toUpperCase());
    if (!canonicalId) {
      return {
        class: CLASSES.AMBIGUOUS,
        reasonCode: 'AMBIGUOUS_LINEAGE',
        childId,
        quantityParentId: qtyParent,
        message: `${childId} has quantity_parent_id but a non-canonical id`
      };
    }
    return {
      class: CLASSES.CANONICAL_BREAK,
      reasonCode: 'CANONICAL_BREAK_CHILD',
      childId,
      parentId: qtyParent,
      quantityParentId: qtyParent,
      message: `${childId} is a canonical Break child`
    };
  }

  if (legacyParent && parent && flagOn(parent, 'is_set', 'IsSet')) {
    return {
      class: CLASSES.SET_LIKE,
      reasonCode: null,
      childId,
      parentId: legacyParent,
      message: `${childId} is a Set-like parentid member`
    };
  }

  const parentQty = parent && (
    flagOn(parent, 'is_quantity_tracked', 'IsQuantityTracked')
    || flagOn(parent, 'is_batch', 'IsBatch')
  );

  if (legacyParent && parent && parentQty) {
    if (identitiesDiffer(child, parent)) {
      return {
        class: CLASSES.LEGACY_SUBASSEMBLY,
        reasonCode: 'PROTECTED_LEGACY_RELATIONSHIP',
        childId,
        parentId: legacyParent,
        message: `${childId} is a distinct identity under ${legacyParent}; not Break lineage`
      };
    }
    if (hasSplitHistory || !child.qrcode || !child.product_id) {
      return {
        class: CLASSES.LEGACY_SPLIT_LIKE,
        reasonCode: 'LEGACY_SPLIT_CHILD',
        childId,
        parentId: legacyParent,
        message: `${childId} looks like a legacy quantity split child; hard-delete is disabled`
      };
    }
    return {
      class: CLASSES.AMBIGUOUS,
      reasonCode: 'AMBIGUOUS_LINEAGE',
      childId,
      parentId: legacyParent,
      message: `${childId} parentid relationship is ambiguous`
    };
  }

  if (legacyParent && parent && !parentQty) {
    return {
      class: CLASSES.SET_LIKE,
      reasonCode: null,
      childId,
      parentId: legacyParent,
      message: `${childId} parentid on a non-quantity parent; treat as Set-like`
    };
  }

  if (legacyParent && !parent) {
    return {
      class: CLASSES.AMBIGUOUS,
      reasonCode: 'AMBIGUOUS_LINEAGE',
      childId,
      parentId: legacyParent,
      message: `${childId} has parentid ${legacyParent} but parent was not found`
    };
  }

  return {
    class: CLASSES.AMBIGUOUS,
    reasonCode: 'AMBIGUOUS_LINEAGE',
    childId,
    parentId: legacyParent || qtyParent || null,
    message: `${childId} lineage could not be classified uniquely`
  };
}

async function classifyAsset(trx, child, { providedParentId = null } = {}) {
  const childId = child.id || child.ID;
  const legacyParent = providedParentId || child.parentid || child.ParentId || null;
  const qtyParent = child.quantity_parent_id || child.QuantityParentId || null;
  const parentId = qtyParent && !legacyParent ? qtyParent : legacyParent;
  const parent = parentId ? await loadAsset(trx, parentId) : null;
  const hasSplitHistory = await hasSplitCreatedHistory(trx, childId);
  return classifyRows(child, parent, { hasSplitHistory });
}

function rejectClassification(classified) {
  throw httpError(
    classified.message || 'Lineage operation rejected',
    409,
    classified.reasonCode || 'AMBIGUOUS_LINEAGE',
    {
      class: classified.class,
      childId: classified.childId || null,
      parentId: classified.parentId || null
    }
  );
}

async function planUnsplitAction(trx, child, { providedParentId = null } = {}) {
  const classified = await classifyAsset(trx, child, { providedParentId });
  const hardDelete = flags().LEGACY_UNSPLIT_HARD_DELETE;

  if (classified.class === CLASSES.CANONICAL_BREAK) {
    return { action: 'INACTIVATE', classified };
  }
  if (classified.class === CLASSES.SET_LIKE) {
    return { action: 'SET_CLEAR', classified };
  }
  if (classified.class === CLASSES.LEGACY_SPLIT_LIKE && hardDelete) {
    console.warn('[PHASE5] LEGACY_UNSPLIT_HARD_DELETE is true; allowing emergency delete for', classified.childId);
    return { action: 'LEGACY_DELETE', classified };
  }
  rejectClassification(classified);
  return null;
}

async function assertUnsplitGuards(trx, child) {
  const childId = child.id || child.ID;
  await assertNoActiveReservation('ASSET', childId, trx);
  if (child.conversion_id || child.conversion_source_id || qtyNum(child.quantity_converted) > 0) {
    await assertConversionLineageProtected('ASSET', childId, trx);
  } else {
    await conversionService.assertNoUnreturnedConversions('ASSET', childId, trx);
  }
}

module.exports = {
  CLASSES,
  PROTECTED_PARENTID_PAIRS,
  flags,
  httpError,
  idsEqual,
  isProtectedParentidPair,
  classifyRows,
  classifyAsset,
  planUnsplitAction,
  rejectClassification,
  assertQuantityMutationAllowed,
  assertNoActiveReservation,
  assertConversionLineageProtected,
  assertUnsplitGuards,
  loadAsset
};
