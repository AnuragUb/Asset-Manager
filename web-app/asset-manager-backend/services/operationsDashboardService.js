/**
 * Operations Dashboard aggregates.
 * Calendar windows use Asia/Kolkata date_trunc + window functions.
 * Never assemble these counts from capped list APIs.
 */
const { db } = require('../utils');
const commercialProvenanceService = require('./commercialProvenanceService');
const productService = require('./productService');

const TZ = 'Asia/Kolkata';
const PERIODS = Object.freeze(['month', 'quarter', 'year']);

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function normalizePeriod(raw) {
  const value = String(raw || 'month').trim().toLowerCase();
  if (value === 'quarter' || value === 'quarterly') return 'quarter';
  if (value === 'year' || value === 'yearly' || value === 'annual') return 'year';
  return 'month';
}

function normalizeMetric(raw) {
  const value = String(raw || 'count').trim().toLowerCase();
  return value === 'value' ? 'value' : 'count';
}

function receiptEventTsSql(alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  return `CASE WHEN ${col('status')} = 'OPEN' THEN ${col('created_at')}::timestamptz ELSE COALESCE(${col('posted_at')}::timestamptz, ${col('created_at')}::timestamptz) END`;
}

function rawRows(result) {
  if (!result) return [];
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result)) return result;
  return [];
}

function logDashboardError(scope, err) {
  console.error(`[operations-dashboard] ${scope}:`, err && err.message ? err.message : err);
}

async function receiptPeriodSummary({ period } = {}) {
  const unit = normalizePeriod(period);
  if (!PERIODS.includes(unit)) {
    throw httpError('Period must be month, quarter, or year.', 400, 'INVALID_PERIOD');
  }
  if (!(await db.schema.hasTable('receipt_note'))) {
    return { period: unit, timezone: TZ, openCount: 0, totalCount: 0, previousOpenCount: null, previousTotalCount: null, bucket: null };
  }
  const tzLiteral = `'${TZ.replace(/'/g, "''")}'`;
  const result = await db.raw(
    `
      WITH notes AS (
        SELECT
          id,
          status,
          (${receiptEventTsSql()}) AS event_ts
        FROM receipt_note
      ),
      bucketed AS (
        SELECT
          status,
          date_trunc('${unit}', timezone(${tzLiteral}, event_ts)) AS bucket
        FROM notes
      ),
      agg AS (
        SELECT
          bucket,
          COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_count,
          COUNT(*)::int AS total_count
        FROM bucketed
        GROUP BY bucket
      ),
      windowed AS (
        SELECT
          bucket,
          open_count,
          total_count,
          LAG(open_count) OVER (ORDER BY bucket) AS prev_open_count,
          LAG(total_count) OVER (ORDER BY bucket) AS prev_total_count
        FROM agg
      )
      SELECT *
      FROM windowed
      WHERE bucket = date_trunc('${unit}', timezone(${tzLiteral}, CURRENT_TIMESTAMP))
    `
  );
  const row = rawRows(result)[0];
  return {
    period: unit,
    timezone: TZ,
    bucket: row ? row.bucket : null,
    openCount: row ? Number(row.open_count) : 0,
    totalCount: row ? Number(row.total_count) : 0,
    previousOpenCount: row && row.prev_open_count != null ? Number(row.prev_open_count) : null,
    previousTotalCount: row && row.prev_total_count != null ? Number(row.prev_total_count) : null
  };
}

/**
 * Assets pie: purpose first, then status (many rows have null purpose with status Demo / In-Use).
 */
function assetSliceSql() {
  return `
    CASE
      WHEN LOWER(COALESCE(purpose, '')) IN ('rental', 'rented')
        OR LOWER(COALESCE(status, '')) IN ('rental', 'rented') THEN 'Rented'
      WHEN LOWER(COALESCE(purpose, '')) = 'demo'
        OR LOWER(COALESCE(status, '')) = 'demo' THEN 'Demo'
      ELSE 'Owned'
    END
  `;
}

/**
 * Inventory doughnut: Sold first, then Rented/Demo from purpose or status,
 * else In Stock (owned / in-store / other active).
 */
function inventorySliceSql() {
  return `
    CASE
      WHEN LOWER(COALESCE(NULLIF(TRIM(status), ''), '')) IN ('sold', 'scraped') THEN 'Sold'
      WHEN LOWER(COALESCE(purpose, '')) IN ('rental', 'rented')
        OR LOWER(COALESCE(status, '')) IN ('rental', 'rented') THEN 'Rented'
      WHEN LOWER(COALESCE(purpose, '')) = 'demo'
        OR LOWER(COALESCE(status, '')) = 'demo' THEN 'Demo'
      ELSE 'In Stock'
    END
  `;
}

async function firstExistingColumn(table, candidates) {
  for (const name of candidates) {
    if (await db.schema.hasColumn(table, name)) return name;
  }
  return null;
}

/**
 * Count expression: inventory prefers quantity_available then quantity_total when present.
 * Assets and non-quantity inventory fall back to row count (1 per row).
 */
async function countExprForTable(table, resourceType) {
  if (resourceType !== 'INVENTORY') return '1';
  const qtyAvail = await firstExistingColumn(table, ['quantity_available']);
  const qtyTotal = await firstExistingColumn(table, ['quantity_total']);
  if (qtyAvail) {
    return `GREATEST(COALESCE(h.${qtyAvail}::float, 0), 0)`;
  }
  if (qtyTotal) {
    return `GREATEST(COALESCE(h.${qtyTotal}::float, 0), 0)`;
  }
  return '1';
}

async function compositionForTable({ table, resourceType, metric, sliceSql, extraWhere }) {
  if (table !== 'assets' && table !== 'inventory_items') {
    throw httpError('Invalid holdings table.', 400, 'INVALID_TABLE');
  }
  if (resourceType !== 'ASSET' && resourceType !== 'INVENTORY') {
    throw httpError('Invalid resource type.', 400, 'INVALID_RESOURCE');
  }
  const useValue = normalizeMetric(metric) === 'value';
  const valueCol = await firstExistingColumn(table, ['asset_value', 'unitprice']);
  const hasDeleted = await db.schema.hasColumn(table, 'is_deleted');
  const hasRetired = await db.schema.hasColumn(table, 'is_retired');
  const hasStatus = await db.schema.hasColumn(table, 'status');
  const countExpr = await countExprForTable(table, resourceType);
  // Count metric: quantity-aware for inventory, else 1 per row.
  // Value metric: sum of monetary column (not multiplied by qty — asset_value is already a holding value).
  const sumCountExpr = countExpr;
  const sumValueExpr = useValue && valueCol ? `COALESCE(h.${valueCol}, 0)` : countExpr;
  const where = ['TRUE'];
  if (hasDeleted) where.push('COALESCE(h.is_deleted::int, 0) <> 1');
  if (resourceType === 'ASSET') {
    if (hasRetired) where.push('COALESCE(h.is_retired::int, 0) <> 1');
    if (hasStatus) where.push("LOWER(COALESCE(h.status, '')) NOT IN ('sold', 'scraped')");
  }
  if (extraWhere) where.push(extraWhere);
  const sql = `
    SELECT
      ${sliceSql} AS slice,
      COALESCE(SUM(${sumCountExpr}), 0)::float AS item_count,
      COALESCE(SUM(${sumValueExpr}), 0)::float AS item_value
    FROM ${table} h
    WHERE ${where.join(' AND ')}
    GROUP BY 1
    ORDER BY 1
  `;
  const result = await db.raw(sql);
  return rawRows(result).map((row) => ({
    slice: row.slice,
    count: Number(row.item_count) || 0,
    value: Number(row.item_value) || 0
  }));
}

async function holdingsComposition({ metric } = {}) {
  const useValue = normalizeMetric(metric) === 'value';
  const assets = await compositionForTable({
    table: 'assets',
    resourceType: 'ASSET',
    metric: useValue ? 'value' : 'count',
    sliceSql: assetSliceSql()
  });
  const inventory = await compositionForTable({
    table: 'inventory_items',
    resourceType: 'INVENTORY',
    metric: useValue ? 'value' : 'count',
    sliceSql: inventorySliceSql()
  });
  const assetSlices = ['Rented', 'Demo', 'Owned'].map((name) => {
    const row = assets.find((item) => item.slice === name);
    return { slice: name, count: row ? row.count : 0, value: row ? row.value : 0 };
  });
  const inventorySlices = ['Rented', 'Demo', 'Sold', 'In Stock'].map((name) => {
    const row = inventory.find((item) => item.slice === name);
    return { slice: name, count: row ? row.count : 0, value: row ? row.value : 0 };
  });
  const sum = (rows, key) => rows.reduce((n, row) => n + Number(row[key] || 0), 0);
  return {
    timezone: TZ,
    metric: useValue ? 'value' : 'count',
    assets: {
      totalCount: sum(assetSlices, 'count'),
      totalValue: sum(assetSlices, 'value'),
      slices: assetSlices
    },
    inventory: {
      totalCount: sum(inventorySlices, 'count'),
      totalValue: sum(inventorySlices, 'value'),
      slices: inventorySlices
    }
  };
}

async function dashboardSnapshot({ period, metric } = {}) {
  const unit = normalizePeriod(period);
  const useValue = normalizeMetric(metric);
  const emptyComposition = {
    timezone: TZ,
    metric: useValue,
    assets: {
      totalCount: 0,
      totalValue: 0,
      slices: ['Rented', 'Demo', 'Owned'].map((slice) => ({ slice, count: 0, value: 0 }))
    },
    inventory: {
      totalCount: 0,
      totalValue: 0,
      slices: ['Rented', 'Demo', 'Sold', 'In Stock'].map((slice) => ({ slice, count: 0, value: 0 }))
    }
  };
  const [awaitingCount, receipts, composition, zohoUnlinkedCount] = await Promise.all([
    commercialProvenanceService.countAwaitingAdoption().catch((err) => {
      logDashboardError('awaiting-adoption', err);
      return 0;
    }),
    receiptPeriodSummary({ period: unit }).catch((err) => {
      logDashboardError('receiving', err);
      return { period: unit, timezone: TZ, openCount: 0, totalCount: 0 };
    }),
    holdingsComposition({ metric: useValue }).catch((err) => {
      logDashboardError('composition', err);
      return emptyComposition;
    }),
    productService.countUnlinkedCatalog().catch((err) => {
      logDashboardError('zoho-unlinked', err);
      return 0;
    })
  ]);
  return {
    period: unit,
    timezone: TZ,
    metric: useValue,
    awaitingAdoption: { count: awaitingCount },
    receiving: receipts,
    composition,
    zohoUnlinkedProducts: { count: Number(zohoUnlinkedCount) || 0 }
  };
}

function periodBoundsSql(aliasPeriod) {
  const unit = normalizePeriod(aliasPeriod);
  return { unit, tz: TZ, eventTs: receiptEventTsSql() };
}

module.exports = {
  TZ,
  PERIODS,
  httpError,
  normalizePeriod,
  normalizeMetric,
  receiptEventTsSql,
  rawRows,
  periodBoundsSql,
  receiptPeriodSummary,
  holdingsComposition,
  dashboardSnapshot
};
