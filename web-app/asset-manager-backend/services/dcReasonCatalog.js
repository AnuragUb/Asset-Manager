/**
 * DC dispatch reason catalog (PHYSICAL_TALLY_AUTHORITY_ADR §9).
 *
 * A reason's label and asset status are configurable; its behaviour is one of a fixed set
 * so dispatch, Return Inward and the Stock Tally know how to count it. Behaviour (and the
 * asset status) are frozen once a reason has been used on any DC.
 *
 * Falls back to the built-in reasons when migration 20260928180000 has not run.
 */
const { db } = require('../utils');

const BEHAVIOURS = Object.freeze({
  RETURNABLE: { returnable: true, exit: false, destination: false, label: 'Returnable', tally: 'Out on DC' },
  RETURNABLE_DESTINATION: { returnable: true, exit: false, destination: true, label: 'Returnable + destination (transfer)', tally: 'Out on DC' },
  SALE_EXIT: { returnable: false, exit: true, destination: false, label: 'Sale exit', tally: 'Out · DC Sale' },
  OTHER_EXIT: { returnable: false, exit: true, destination: false, label: 'Other exit', tally: 'Out · Other DC exit' },
  VENDOR_EXIT: { returnable: false, exit: true, destination: false, label: 'Vendor return exit', tally: 'Out · Vendor Rtn' },
  LEGACY: { returnable: false, exit: false, destination: false, label: 'Legacy', tally: '—' }
});
const SELECTABLE_BEHAVIOURS = Object.keys(BEHAVIOURS).filter((b) => b !== 'LEGACY');

const BUILT_IN = [
  ['DEMO', 'Demo', 'RETURNABLE', 'Out on Demo', 'OUT_ON_DEMO', 10],
  ['RENTAL', 'Rental', 'RETURNABLE', 'Out on Rental', 'OUT_ON_RENTAL', 20],
  ['REPAIR', 'Repair', 'RETURNABLE', 'Out for Repair', 'OUT_FOR_REPAIR', 30],
  ['INTERNAL_USE', 'Internal Use / Project / Shoot', 'RETURNABLE', 'Out for Internal Use', 'OUT_FOR_INTERNAL_USE', 40],
  ['STOCK_TRANSFER', 'Stock Transfer', 'RETURNABLE_DESTINATION', 'In Transit', 'IN_TRANSIT', 50],
  ['SALE', 'Sale', 'SALE_EXIT', 'Sold', 'SOLD', 110],
  ['REPLACEMENT', 'Replacement / Warranty swap', 'OTHER_EXIT', 'Replaced', 'REPLACED', 120],
  ['FOC', 'Free of Cost / Sample', 'OTHER_EXIT', 'Issued FOC', 'ISSUED_FOC', 130],
  ['VENDOR_RETURN', 'Return to Vendor', 'VENDOR_EXIT', 'Returned to Vendor', 'RETURNED_TO_VENDOR', 140],
  ['LEGACY_UNSPECIFIED', 'Not specified (legacy)', 'LEGACY', null, 'LEGACY', 999]
].map(([code, label, behaviour, asset_status, disposition_status, sort_order]) => ({
  code, label, behaviour, asset_status, disposition_status, sort_order,
  is_active: behaviour !== 'LEGACY', is_system: true
}));

/** Statuses an exit/out reason may never set — they are the normal in-store states. */
const RESERVED_ASSET_STATUSES = new Set([
  'in store', 'under inspection', 'in-use', 'in use', 'stand by', 'standby', 'project', 'owned', 'returned'
]);

const CACHE_TTL_MS = 30000;
let cache = { at: 0, rows: null };
let statusSnapshot = new Set(BUILT_IN.filter((r) => r.asset_status).map((r) => r.asset_status.toLowerCase()));

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

const trimText = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

function publicReason(row, extras = {}) {
  const b = BEHAVIOURS[row.behaviour] || BEHAVIOURS.LEGACY;
  return {
    code: row.code,
    label: row.label,
    behaviour: row.behaviour,
    behaviourLabel: b.label,
    tallyColumn: b.tally,
    returnable: b.returnable,
    exit: b.exit,
    requiresDestination: b.destination,
    assetStatus: row.asset_status || null,
    dispositionStatus: row.disposition_status,
    isActive: row.is_active !== false && row.is_active !== 0,
    isSystem: row.is_system === true || row.is_system === 1,
    sortOrder: Number(row.sort_order || 0),
    ...extras
  };
}

async function tableReady(runner = db) {
  return runner.schema.hasTable('dc_dispatch_reason');
}

function invalidate() {
  cache = { at: 0, rows: null };
}

async function loadRows(runner = db) {
  if (runner === db && cache.rows && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  let rows = BUILT_IN;
  if (await tableReady(runner)) {
    rows = await runner('dc_dispatch_reason').select('*').orderBy([{ column: 'sort_order' }, { column: 'label' }]);
  }
  if (runner === db) {
    cache = { at: Date.now(), rows };
    statusSnapshot = new Set(rows.filter((r) => r.asset_status).map((r) => String(r.asset_status).trim().toLowerCase()));
  }
  return rows;
}

async function list({ includeInactive = false, runner = db } = {}) {
  const rows = await loadRows(runner);
  return rows
    .filter((r) => r.behaviour !== 'LEGACY')
    .filter((r) => includeInactive || publicReason(r).isActive)
    .map((r) => publicReason(r));
}

async function get(code, runner = db) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return null;
  const row = (await loadRows(runner)).find((r) => r.code === key);
  return row ? publicReason(row) : null;
}

/** For setting a reason on a DC: must exist, be active and not legacy. */
async function requireUsable(code, runner = db) {
  const reason = await get(code, runner);
  if (!reason || reason.behaviour === 'LEGACY' || !reason.isActive) {
    const active = (await list({ runner })).map((r) => r.code);
    throw httpError(`dispatchReason must be one of ${active.join(', ')}`, 400, 'INVALID_DISPATCH_REASON');
  }
  return reason;
}

/** For dispatching a DC that already carries a reason (it may have been deactivated since). */
async function requireKnown(code, runner = db) {
  const reason = await get(code, runner);
  if (!reason || reason.behaviour === 'LEGACY') {
    throw httpError(`Unknown dispatch reason ${code}`, 400, 'INVALID_DISPATCH_REASON');
  }
  return reason;
}

async function codesByBehaviour(runner = db) {
  const rows = await loadRows(runner);
  const pick = (fn) => rows.filter((r) => fn(BEHAVIOURS[r.behaviour] || BEHAVIOURS.LEGACY, r)).map((r) => r.code);
  return {
    returnable: pick((b) => b.returnable),
    saleExit: pick((b, r) => r.behaviour === 'SALE_EXIT'),
    otherExit: pick((b, r) => r.behaviour === 'OTHER_EXIT'),
    vendorExit: pick((b, r) => r.behaviour === 'VENDOR_EXIT'),
    exit: pick((b) => b.exit),
    destination: pick((b) => b.destination)
  };
}

async function assetStatuses({ returnable, exit } = {}, runner = db) {
  const rows = await loadRows(runner);
  return rows
    .filter((r) => r.asset_status)
    .filter((r) => {
      const b = BEHAVIOURS[r.behaviour] || BEHAVIOURS.LEGACY;
      if (returnable && !b.returnable) return false;
      if (exit && !b.exit) return false;
      return true;
    })
    .map((r) => String(r.asset_status).trim().toLowerCase());
}

/** Sync view of every reason's asset status (refreshed on each catalog load). */
function controlledStatusSnapshot() {
  return statusSnapshot;
}

async function inUseCount(code, runner = db) {
  let n = 0;
  if (await runner.schema.hasTable('delivery_challans')) {
    n += Number((await runner('delivery_challans').where({ dispatch_reason: code }).count('* as c').first())?.c || 0);
  }
  if (await runner.schema.hasTable('dc_disposition_line')) {
    n += Number((await runner('dc_disposition_line').where({ dispatch_reason: code }).count('* as c').first())?.c || 0);
  }
  return n;
}

function slugCode(label) {
  let code = String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Z]/.test(code)) code = `R_${code}`;
  return code.slice(0, 32).replace(/_+$/, '') || 'REASON';
}

async function uniqueValue(runner, column, base, maxLen = 32) {
  for (let i = 0; i < 50; i += 1) {
    const suffix = i === 0 ? '' : `_${i + 1}`;
    const candidate = `${base.slice(0, maxLen - suffix.length)}${suffix}`;
    const hit = await runner('dc_dispatch_reason').where(column, candidate).first();
    if (!hit && candidate !== 'RETURNED') return candidate;
  }
  throw httpError(`Could not allocate a unique ${column}`, 409, 'REASON_CODE_CONFLICT');
}

function validateLabel(raw) {
  const label = trimText(raw);
  if (!label || label.length < 2) throw httpError('Label is required (min 2 characters)', 400, 'REASON_LABEL_REQUIRED');
  if (label.length > 80) throw httpError('Label is too long (max 80 characters)', 400, 'REASON_LABEL_TOO_LONG');
  return label;
}

function validateAssetStatus(raw) {
  const status = trimText(raw);
  if (!status) throw httpError('Asset status is required', 400, 'REASON_ASSET_STATUS_REQUIRED');
  if (status.length > 64) throw httpError('Asset status is too long (max 64 characters)', 400, 'REASON_ASSET_STATUS_TOO_LONG');
  if (RESERVED_ASSET_STATUSES.has(status.toLowerCase())) {
    throw httpError(`"${status}" is an in-store status and cannot be set by a dispatch reason`, 400, 'REASON_ASSET_STATUS_RESERVED');
  }
  return status;
}

function validateBehaviour(raw) {
  const behaviour = String(raw || '').trim().toUpperCase();
  if (!SELECTABLE_BEHAVIOURS.includes(behaviour)) {
    throw httpError(`behaviour must be one of ${SELECTABLE_BEHAVIOURS.join(', ')}`, 400, 'REASON_BEHAVIOUR_INVALID');
  }
  return behaviour;
}

async function assertLabelFree(runner, label, exceptCode = null) {
  const q = runner('dc_dispatch_reason').whereRaw('LOWER(label) = LOWER(?)', [label]);
  if (exceptCode) q.whereNot({ code: exceptCode });
  if (await q.first()) throw httpError(`A reason named "${label}" already exists`, 409, 'REASON_LABEL_TAKEN');
}

async function requireTable(runner) {
  if (!(await tableReady(runner))) {
    throw httpError('DC reason catalog not migrated (20260928180000)', 503, 'SCHEMA_PENDING');
  }
}

async function create(input = {}, actor = null) {
  const label = validateLabel(input.label);
  const behaviour = validateBehaviour(input.behaviour);
  const assetStatus = validateAssetStatus(input.assetStatus);
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 500;

  const created = await db.transaction(async (trx) => {
    await requireTable(trx);
    await assertLabelFree(trx, label);
    const code = await uniqueValue(trx, 'code', trimText(input.code) ? slugCode(input.code) : slugCode(label));
    const prefix = BEHAVIOURS[behaviour].returnable ? 'OUT_' : 'EXIT_';
    const dispositionStatus = await uniqueValue(trx, 'disposition_status', `${prefix}${code}`);
    const now = new Date().toISOString();
    await trx('dc_dispatch_reason').insert({
      code,
      label,
      behaviour,
      asset_status: assetStatus,
      disposition_status: dispositionStatus,
      is_active: input.isActive === false ? false : true,
      is_system: false,
      sort_order: sortOrder,
      created_by: actor,
      updated_by: actor,
      created_at: now,
      updated_at: now
    });
    return trx('dc_dispatch_reason').where({ code }).first();
  });
  invalidate();
  await loadRows();
  return publicReason(created, { inUse: 0 });
}

async function update(code, input = {}, actor = null) {
  const key = String(code || '').trim().toUpperCase();
  const updated = await db.transaction(async (trx) => {
    await requireTable(trx);
    const row = await trx('dc_dispatch_reason').where({ code: key }).forUpdate().first();
    if (!row) throw httpError(`Reason ${key} not found`, 404, 'REASON_NOT_FOUND');
    if (row.behaviour === 'LEGACY') throw httpError('The legacy reason cannot be edited', 409, 'REASON_LEGACY');
    const used = await inUseCount(key, trx);
    const patch = {};

    if (input.label !== undefined) {
      const label = validateLabel(input.label);
      await assertLabelFree(trx, label, key);
      patch.label = label;
    }
    if (input.sortOrder !== undefined) {
      const n = Number(input.sortOrder);
      if (!Number.isFinite(n)) throw httpError('sortOrder must be a number', 400, 'REASON_SORT_INVALID');
      patch.sort_order = Math.trunc(n);
    }
    if (input.isActive !== undefined) patch.is_active = !!input.isActive;

    if (input.behaviour !== undefined && String(input.behaviour).toUpperCase() !== row.behaviour) {
      if (row.is_system) throw httpError('Built-in reasons keep their behaviour', 409, 'REASON_SYSTEM_LOCKED');
      if (used) throw httpError('Behaviour is fixed once the reason has been used on a DC', 409, 'REASON_IN_USE');
      const behaviour = validateBehaviour(input.behaviour);
      const wasReturnable = BEHAVIOURS[row.behaviour].returnable;
      patch.behaviour = behaviour;
      if (BEHAVIOURS[behaviour].returnable !== wasReturnable) {
        patch.disposition_status = await uniqueValue(trx, 'disposition_status', `${BEHAVIOURS[behaviour].returnable ? 'OUT_' : 'EXIT_'}${key}`);
      }
    }
    if (input.assetStatus !== undefined && trimText(input.assetStatus) !== row.asset_status) {
      if (row.is_system) throw httpError('Built-in reasons keep their asset status', 409, 'REASON_SYSTEM_LOCKED');
      if (used) throw httpError('Asset status is fixed once the reason has been used on a DC', 409, 'REASON_IN_USE');
      patch.asset_status = validateAssetStatus(input.assetStatus);
    }

    if (Object.keys(patch).length) {
      patch.updated_by = actor;
      patch.updated_at = new Date().toISOString();
      await trx('dc_dispatch_reason').where({ code: key }).update(patch);
    }
    return { row: await trx('dc_dispatch_reason').where({ code: key }).first(), used };
  });
  invalidate();
  await loadRows();
  return publicReason(updated.row, { inUse: updated.used });
}

/** Full list for the management screen, with usage counts. */
async function listForManagement() {
  const rows = await loadRows();
  const out = [];
  for (const r of rows) {
    if (r.behaviour === 'LEGACY') continue;
    out.push(publicReason(r, { inUse: (await tableReady()) ? await inUseCount(r.code) : 0 }));
  }
  return out;
}

module.exports = {
  BEHAVIOURS,
  SELECTABLE_BEHAVIOURS,
  list,
  get,
  requireUsable,
  requireKnown,
  codesByBehaviour,
  assetStatuses,
  controlledStatusSnapshot,
  refresh: () => { invalidate(); return loadRows(); },
  create,
  update,
  listForManagement,
  invalidate
};
