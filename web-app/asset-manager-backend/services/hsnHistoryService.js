/**
 * Dated HSN / SAC history per holding. Managerial viewer — does not change stock.
 * Period labels use Indian FY (1 Apr – 31 Mar, Asia/Kolkata).
 */
const { db } = require('../utils');

const TZ = 'Asia/Kolkata';
const TABLE = 'holding_hsn_history';

function httpError(message, statusCode, reasonCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  return err;
}

function trimCode(value) {
  return String(value == null ? '' : value).trim();
}

function normType(value) {
  const key = String(value || '').trim().toUpperCase();
  if (key === 'ASSET' || key === 'ASSETS') return 'ASSET';
  if (key === 'INVENTORY') return 'INVENTORY';
  throw httpError('resourceType must be ASSET or INVENTORY', 400, 'INVALID_TYPE');
}

async function tablesReady(runner = db) {
  return runner.schema.hasTable(TABLE);
}

function fyParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: 'numeric'
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value);
  const fy = month >= 4 ? year : year - 1;
  const fyMonthIndex = month >= 4 ? month - 4 : month + 8;
  const fq = Math.floor(fyMonthIndex / 3) + 1;
  return {
    fy,
    fyLabel: `FY ${fy}–${String(fy + 1).slice(-2)}`,
    fq,
    month,
    monthLabel: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long' }).format(date instanceof Date ? date : new Date(date))
  };
}

function overlapsPeriod(row, from, to) {
  if (!from || !to) return true;
  const start = new Date(row.effectiveFrom).getTime();
  const end = row.effectiveTo ? new Date(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  return start < to.getTime() && end > from.getTime();
}

async function loadHolding(resourceType, resourceId) {
  if (resourceType === 'ASSET') {
    return db('assets').whereRaw('LOWER(id) = LOWER(?)', [resourceId]).first();
  }
  return db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [resourceId]).first();
}

function publicRow(row, effectiveTo, catalog) {
  const from = row.effective_from;
  const period = fyParts(from);
  const code = trimCode(row.hsn_code);
  const meta = catalog.get(code) || null;
  return {
    id: row.id || null,
    kind: row.kind,
    hsnCode: code,
    previousHsnCode: trimCode(row.previous_hsn_code) || null,
    description: meta ? meta.description : null,
    effectiveFrom: from,
    effectiveTo: effectiveTo,
    actor: row.actor || null,
    note: row.note || null,
    fy: period.fy,
    fyLabel: period.fyLabel,
    fq: period.fq,
    month: period.month,
    monthLabel: period.monthLabel
  };
}

async function hsnCatalog(codes) {
  const real = [...new Set(codes.filter(Boolean))];
  if (!real.length || !(await db.schema.hasTable('hsn_codes'))) return new Map();
  const rows = await db('hsn_codes').whereIn('code', real).select('code', 'description');
  return new Map(rows.map((r) => [String(r.code), r]));
}

async function listHistory(resourceType, resourceId, { fy, month, asOf } = {}) {
  const type = normType(resourceType);
  const id = String(resourceId || '').trim();
  if (!id) throw httpError('id is required', 400, 'MISSING_ID');
  const holding = await loadHolding(type, id);
  if (!holding) throw httpError(`${type} ${id} not found`, 404, 'NOT_FOUND');

  const currentCode = trimCode(holding.hsn_code);
  let raw = [];
  if (await tablesReady()) {
    raw = await db(TABLE)
      .where({ resource_type: type })
      .whereRaw('LOWER(resource_id) = LOWER(?)', [id])
      .orderBy('effective_from', 'asc')
      .orderBy('id', 'asc');
  }

  if (!raw.length && currentCode) {
    raw = [{
      id: null,
      kind: 'OPENING',
      hsn_code: currentCode,
      previous_hsn_code: null,
      effective_from: holding.purchasedate || holding.lastupdated || holding.created_at || new Date().toISOString(),
      actor: null,
      note: 'Current HSN / SAC on the holding (no dated changes recorded yet).'
    }];
  }

  const catalog = await hsnCatalog(raw.map((r) => r.hsn_code).concat(currentCode));
  const rows = raw.map((row, i) => {
    const next = raw[i + 1];
    return publicRow(row, next ? next.effective_from : null, catalog);
  });

  let filtered = rows;
  if (asOf) {
    const raw = String(asOf).trim();
    const at = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T23:59:59.999+05:30`)
      : new Date(raw);
    if (Number.isNaN(at.getTime())) throw httpError('asOf must be a date', 400, 'INVALID_DATE');
    const t = at.getTime();
    filtered = rows.filter((r) => {
      const start = new Date(r.effectiveFrom).getTime();
      const end = r.effectiveTo ? new Date(r.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return start <= t && t < end;
    });
  } else if (fy) {
    const y = Number(fy);
    const m = month ? Number(month) : null;
    let periodFrom = new Date(`${y}-04-01T00:00:00+05:30`);
    let periodTo = new Date(`${y + 1}-04-01T00:00:00+05:30`);
    if (m >= 1 && m <= 12) {
      const calYear = m >= 4 ? y : y + 1;
      const pad = (n) => String(n).padStart(2, '0');
      periodFrom = new Date(`${calYear}-${pad(m)}-01T00:00:00+05:30`);
      periodTo = m === 12
        ? new Date(`${calYear + 1}-01-01T00:00:00+05:30`)
        : new Date(`${calYear}-${pad(m + 1)}-01T00:00:00+05:30`);
    }
    filtered = rows.filter((r) => overlapsPeriod(r, periodFrom, periodTo));
  }

  const latest = rows.length ? rows[rows.length - 1] : null;
  const asOfRow = asOf ? (filtered.length ? filtered[filtered.length - 1] : null) : latest;

  return {
    timezone: TZ,
    resourceType: type,
    resourceId: holding.id || id,
    current: currentCode,
    currentDescription: (catalog.get(currentCode) || {}).description || null,
    asOf: asOf || null,
    asOfHsn: asOf ? (asOfRow ? asOfRow.hsnCode : '') : currentCode,
    rows: filtered.slice().reverse()
  };
}

async function recordChange({ trx, resourceType, resourceId, previous, next, actor, at, note } = {}) {
  const runner = trx || db;
  if (!(await tablesReady(runner))) return null;
  const type = normType(resourceType);
  const id = String(resourceId || '').trim();
  const fromCode = trimCode(previous);
  const toCode = trimCode(next);
  if (!id || fromCode === toCode) return null;

  const existing = await runner(TABLE)
    .where({ resource_type: type })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [id])
    .first();
  const when = at ? new Date(at) : new Date();
  const rows = [];
  if (!existing && fromCode) {
    const opened = new Date(when.getTime() - 1000);
    rows.push({
      resource_type: type,
      resource_id: id,
      hsn_code: fromCode,
      previous_hsn_code: null,
      kind: 'OPENING',
      effective_from: opened,
      actor: actor || null,
      note: 'HSN / SAC on file before this change',
      created_at: opened
    });
  }
  rows.push({
    resource_type: type,
    resource_id: id,
    hsn_code: toCode,
    previous_hsn_code: fromCode || null,
    kind: 'CHANGE',
    effective_from: when,
    actor: actor || null,
    note: note || null,
    created_at: when
  });
  await runner(TABLE).insert(rows);
  return rows.length;
}

module.exports = {
  listHistory,
  recordChange
};
