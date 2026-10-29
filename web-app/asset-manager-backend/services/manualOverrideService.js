/**
 * Superuser manual overrides (PHYSICAL_TALLY_AUTHORITY_ADR §5).
 *
 * Out-states and count changes must come from a DC dispatch, Retire, or Vendor Return.
 * Direct edits that bypass those are refused for everyone except superuser, and a
 * superuser must give a written reason that is stored as a MANUAL_OVERRIDE event.
 */

const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 1000;

const CONTROLLED_ASSET_STATUSES = new Set([
    'sold', 'scraped', 'scrapped', 'retired', 'lost',
    'demo', 'rental', 'in-repair', 'in repair',
    'out on demo', 'out on rental', 'out for repair',
    'out for internal use', 'in transit',
    'replaced', 'issued foc', 'returned to vendor'
]);

function normalizeStatus(status) {
    return String(status || '').trim().toLowerCase();
}

function isControlledAssetStatus(status) {
    const s = normalizeStatus(status);
    if (CONTROLLED_ASSET_STATUSES.has(s)) return true;
    // Custom DC dispatch reasons add their own out/exit statuses.
    return require('./dcReasonCatalog').controlledStatusSnapshot().has(s);
}

function quantitiesDiffer(a, b) {
    return Math.abs(Number(a || 0) - Number(b || 0)) > 1e-9;
}

function firstDefined(...vals) {
    for (const v of vals) {
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}

function incomingAssetQtyTotal(body) {
    if (!body) return undefined;
    return firstDefined(
        body.quantity_total,
        body.quantityTotal,
        body.QuantityTotal,
        body.qtyTotal,
        body.qty_total,
        body.QtyTotal
    );
}

function sessionRole(req) {
    return String(req?.user?.role || '').trim().toLowerCase();
}

function canConvertUnits(req) {
    const role = sessionRole(req);
    return role === 'superuser' || role === 'admin';
}

function readUnitConversion(body) {
    const raw = body && (body.quantity_unit_conversion || body.unitConversion || body.unit_conversion);
    if (!raw || typeof raw !== 'object') return null;
    const factor = Number(raw.factor ?? raw.conversion_factor);
    const mode = String(raw.mode || raw.conversion_mode || 'multiply').trim().toLowerCase();
    const fromQty = Number(raw.fromQty ?? raw.from_qty);
    const toQty = Number(raw.toQty ?? raw.to_qty);
    const fromUnit = String(raw.fromUnit ?? raw.from_unit ?? '').trim();
    const toUnit = String(raw.toUnit ?? raw.to_unit ?? '').trim();
    if (!(factor > 0) || !Number.isFinite(fromQty) || !Number.isFinite(toQty) || !fromUnit || !toUnit) return null;
    if (mode !== 'multiply' && mode !== 'divide') return null;
    return { factor, mode, fromQty, toQty, fromUnit, toUnit };
}

function expectedConvertedQty(fromQty, factor, mode) {
    return mode === 'divide' ? Number(fromQty) / Number(factor) : Number(fromQty) * Number(factor);
}

/**
 * A unit conversion restates the same stock (× or ÷ a factor) and is allowed for
 * admin and superuser. Typing a new total without this proof still needs superuser.
 */
function matchUnitConversion({ existingTotal, existingUnit, nextTotal, nextUnit, body }) {
    const conv = readUnitConversion(body);
    if (!conv) return null;
    const existingUnitNorm = String(existingUnit || '').trim().toLowerCase();
    const nextUnitNorm = String(nextUnit || '').trim().toLowerCase();
    if (!nextUnitNorm || nextUnitNorm === existingUnitNorm) return null;
    if (conv.fromUnit.toLowerCase() !== existingUnitNorm) return null;
    if (conv.toUnit.toLowerCase() !== nextUnitNorm) return null;
    if (quantitiesDiffer(conv.fromQty, existingTotal)) return null;
    const expected = expectedConvertedQty(existingTotal, conv.factor, conv.mode);
    if (quantitiesDiffer(expected, nextTotal) || quantitiesDiffer(conv.toQty, nextTotal)) return null;
    return conv;
}

function unitConversionHistoryDetails(conv) {
    const op = conv.mode === 'divide' ? '÷' : '×';
    return `${conv.fromQty} ${conv.fromUnit} → ${conv.toQty} ${conv.toUnit} (${op} ${conv.factor})`;
}

function overrideError(status, reasonCode, message, details) {
    const err = new Error(message);
    err.status = status;
    err.reasonCode = reasonCode;
    if (details) err.details = details;
    return err;
}

/**
 * Asset status / quantity changes in a PUT /api/assets/:id body that need an override.
 * Returns human-readable change lines; empty when the edit is ordinary.
 */
function detectAssetOverrideChanges(existing, body) {
    const changes = [];
    if (!existing || !body) return changes;

    const incomingStatus = body.Status;
    if (incomingStatus !== undefined && incomingStatus !== null && String(incomingStatus).trim() !== '') {
        const from = normalizeStatus(existing.status);
        const to = normalizeStatus(incomingStatus);
        if (from !== to && (isControlledAssetStatus(from) || isControlledAssetStatus(to))) {
            changes.push(`Status: ${existing.status || '—'} → ${String(incomingStatus).trim()}`);
        }
    }

    if (body.is_retired !== undefined && body.is_retired !== null
        && Number(body.is_retired ? 1 : 0) !== Number(existing.is_retired || 0)) {
        changes.push(`Retired flag: ${Number(existing.is_retired || 0)} → ${body.is_retired ? 1 : 0}`);
    }

    const wasTracked = Number(existing.is_quantity_tracked || 0) === 1;
    const turningOff = body.is_quantity_tracked !== undefined && !Number(body.is_quantity_tracked);
    const incomingTotal = incomingAssetQtyTotal(body);
    if (wasTracked && turningOff) {
        changes.push(`Quantity tracking turned off (total ${Number(existing.quantity_total || 0)})`);
    } else if (incomingTotal !== undefined && incomingTotal !== null && quantitiesDiffer(incomingTotal, existing.quantity_total)) {
        changes.push(`Quantity total: ${Number(existing.quantity_total || 0)} → ${Number(incomingTotal)}`);
    }

    return changes;
}

/** Inventory quantity changes made through PUT /api/inventory/items/:id. */
function detectInventoryOverrideChanges(existing, next) {
    const changes = [];
    if (!existing || Number(existing.is_quantity_tracked || 0) !== 1) return changes;
    if (!next.isQtyTracked) {
        changes.push(`Quantity tracking turned off (total ${Number(existing.quantity_total || 0)})`);
        return changes;
    }
    if (quantitiesDiffer(next.total, existing.quantity_total)) {
        changes.push(`Quantity total: ${Number(existing.quantity_total || 0)} → ${Number(next.total)}`);
    }
    if (quantitiesDiffer(next.available, existing.quantity_available)) {
        changes.push(`Quantity available: ${Number(existing.quantity_available || 0)} → ${Number(next.available)}`);
    }
    return changes;
}

/**
 * Enforce superuser + written reason. Returns the trimmed reason.
 * Reason is read from body.overrideReason or the x-override-reason header.
 */
function requireOverride(req, { summary, changes = [] } = {}) {
    const role = normalizeStatus(req.user?.role);
    const details = { changes };
    if (role !== 'superuser') {
        throw overrideError(
            403,
            'MANUAL_OVERRIDE_SUPERUSER_ONLY',
            `${summary} Only a superuser can make this change as a manual override.`,
            details
        );
    }
    const headerReason = typeof req.get === 'function' ? req.get('x-override-reason') : undefined;
    const reason = String(req.body?.overrideReason ?? headerReason ?? '').trim();
    if (reason.length < MIN_REASON_LENGTH) {
        throw overrideError(
            400,
            'MANUAL_OVERRIDE_REASON_REQUIRED',
            `${summary} Enter a manual override reason (at least ${MIN_REASON_LENGTH} characters).`,
            details
        );
    }
    return reason.slice(0, MAX_REASON_LENGTH);
}

/**
 * Controlled exits that any permitted role may perform (e.g. inventory CONSUME) still
 * need a written reason. Returns the trimmed reason.
 */
function requireReason(req, { summary } = {}) {
    const reason = String(req.body?.reason ?? req.body?.overrideReason ?? '').trim();
    if (reason.length < MIN_REASON_LENGTH) {
        throw overrideError(
            400,
            'MANUAL_OVERRIDE_REASON_REQUIRED',
            `${summary} Enter a reason (at least ${MIN_REASON_LENGTH} characters).`
        );
    }
    return reason.slice(0, MAX_REASON_LENGTH);
}

function sendOverrideError(res, err) {
    return res.status(err.status || 500).json({
        success: false,
        error: err.message,
        reasonCode: err.reasonCode,
        details: err.details
    });
}

function isOverrideError(err) {
    return Boolean(err && typeof err.reasonCode === 'string' && err.reasonCode.startsWith('MANUAL_OVERRIDE_'));
}

module.exports = {
    CONTROLLED_ASSET_STATUSES,
    isControlledAssetStatus,
    quantitiesDiffer,
    incomingAssetQtyTotal,
    canConvertUnits,
    matchUnitConversion,
    unitConversionHistoryDetails,
    detectAssetOverrideChanges,
    detectInventoryOverrideChanges,
    requireOverride,
    requireReason,
    sendOverrideError,
    isOverrideError
};
