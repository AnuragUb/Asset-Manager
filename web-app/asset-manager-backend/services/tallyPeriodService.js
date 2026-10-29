/**
 * Period stock ledger (FY / FQ / month) over the same documents as
 * tallyReportService. Managerial viewer — does not write quantity.
 *
 * Indian FY: 1 Apr – 31 Mar, Asia/Kolkata. Inwards/Outwards are ownership
 * movements. Returnable DCs appear as vouchers but do not change closing.
 */
const { db } = require('../utils');
const reasonCatalog = require('./dcReasonCatalog');

const TZ = 'Asia/Kolkata';
const EPS = 1e-6;
const MONTH_NAMES = ['April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March'];
const Q_MONTHS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(num(v) * 1e6) / 1e6;
const pad = (n) => String(n).padStart(2, '0');
const lower = (v) => String(v || '').trim().toLowerCase();

function rawRows(result) {
  if (!result) return [];
  if (Array.isArray(result.rows)) return result.rows;
  return Array.isArray(result) ? result : [];
}

async function hasTable(name) {
  return db.schema.hasTable(name);
}

function istBoundary(year, month, day) {
  return new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00+05:30`);
}

function fyWindow(fyStartYear) {
  const y = Number(fyStartYear);
  return { from: istBoundary(y, 4, 1), to: istBoundary(y + 1, 4, 1) };
}

function fyLabel(fyStartYear) {
  const y = Number(fyStartYear);
  return `FY ${y}–${String(y + 1).slice(-2)}`;
}

function monthWindow(fyStartYear, fyMonthIndex) {
  const y = Number(fyStartYear);
  const calMonth = fyMonthIndex < 9 ? fyMonthIndex + 4 : fyMonthIndex - 8;
  const calYear = fyMonthIndex < 9 ? y : y + 1;
  const from = istBoundary(calYear, calMonth, 1);
  const to = calMonth === 12 ? istBoundary(calYear + 1, 1, 1) : istBoundary(calYear, calMonth + 1, 1);
  return { from, to, calYear, calMonth, key: `${calYear}-${pad(calMonth)}` };
}

function quarterWindow(fyStartYear, q) {
  const start = monthWindow(fyStartYear, (q - 1) * 3);
  const end = monthWindow(fyStartYear, (q - 1) * 3 + 2);
  return { from: start.from, to: end.to };
}

function fyStartYearOf(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: 'numeric'
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value);
  return month >= 4 ? year : year - 1;
}

function inWindow(ts, from, to) {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function before(ts, from) {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  return t < from.getTime();
}

function sqlList(values) {
  return values.length
    ? values.filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v)).map((v) => `'${v}'`).join(',') || 'NULL'
    : 'NULL';
}

function normalizeType(type) {
  const t = String(type || '').trim().toUpperCase();
  if (t === 'ASSET' || t === 'ASSETS') return 'ASSET';
  if (t === 'INVENTORY') return 'INVENTORY';
  return null;
}

const HOLDING_JOIN = `
  LEFT JOIN assets.assets a ON e.resource_type = 'ASSET' AND LOWER(a.id) = LOWER(e.resource_id)
  LEFT JOIN inventory_items i ON e.resource_type = 'INVENTORY' AND LOWER(i.id) = LOWER(e.resource_id)
`;

async function loadEvents() {
  const codes = await reasonCatalog.codesByBehaviour();
  const parts = [];

  const hasRn = (await hasTable('receipt_physical_output')) && (await hasTable('receipt_note'));
  const hasInwardKind = hasRn && (await db.schema.hasColumn('receipt_note', 'inward_kind'));
  if (hasRn) {
    parts.push(`
      SELECT COALESCE(n.posted_at, n.created_at)::timestamptz AS event_ts,
             o.resource_type, o.resource_id, o.quantity AS qty_in, 0::numeric AS qty_out,
             CASE WHEN ${hasInwardKind ? `COALESCE(n.inward_kind, 'PURCHASE_INWARD') = 'RETURN_INWARD'` : 'FALSE'}
                  THEN 'inDcReturn' ELSE 'inReceipt' END AS bucket,
             'RECEIPT_NOTE'::text AS doc_type, n.id AS doc_id, n.id AS vch_no,
             COALESCE(n.vendor_name, n.id) AS particulars,
             CASE WHEN ${hasInwardKind ? `COALESCE(n.inward_kind, 'PURCHASE_INWARD') = 'RETURN_INWARD'` : 'FALSE'}
                  THEN 'DC Return' ELSE 'Receipt Note' END AS vch_type,
             CASE WHEN ${hasInwardKind ? `COALESCE(n.inward_kind, 'PURCHASE_INWARD') = 'RETURN_INWARD'` : 'FALSE'}
                  THEN FALSE ELSE TRUE END AS affects_close
      FROM receipt_physical_output o
      JOIN receipt_note n ON n.id = o.receipt_note_id
      WHERE n.status = 'POSTED'`);
  }

  if ((await hasTable('physical_intake_output')) && (await hasTable('physical_intake'))) {
    parts.push(`
      SELECT p.created_at::timestamptz AS event_ts,
             o.resource_type, o.resource_id, o.quantity AS qty_in, 0::numeric AS qty_out,
             'inIntake'::text AS bucket, 'PHYSICAL_INTAKE'::text AS doc_type,
             p.id AS doc_id, p.id AS vch_no, COALESCE(p.reason, p.id) AS particulars,
             'Physical Intake'::text AS vch_type, TRUE AS affects_close
      FROM physical_intake_output o
      JOIN physical_intake p ON p.id = o.physical_intake_id`);
  }

  if ((await hasTable('dc_disposition_line')) && (await hasTable('delivery_challans'))) {
    const tsBits = [];
    if (await db.schema.hasColumn('delivery_challans', 'dispatched_at')) tsBits.push('d.dispatched_at');
    if (await db.schema.hasColumn('delivery_challans', 'timestamp')) tsBits.push("NULLIF(d.timestamp::text, '')::timestamptz");
    if (await db.schema.hasColumn('delivery_challans', 'created_at')) tsBits.push('d.created_at');
    const eventTsSql = tsBits.length ? `COALESCE(${tsBits.join(', ')})` : 'NULL';
    parts.push(`
      SELECT ${eventTsSql} AS event_ts,
             l.resource_type, l.resource_id,
             0::numeric AS qty_in,
             CASE WHEN l.dispatch_reason IN (${sqlList([...codes.saleExit, ...codes.otherExit, ...codes.vendorExit])})
                  THEN l.quantity ELSE 0 END AS qty_out,
             CASE
               WHEN l.dispatch_reason IN (${sqlList(codes.saleExit)}) THEN 'dcSale'
               WHEN l.dispatch_reason IN (${sqlList(codes.otherExit)}) THEN 'dcOtherExit'
               WHEN l.dispatch_reason IN (${sqlList(codes.vendorExit)}) THEN 'vendorReturn'
               ELSE 'outOnDc'
             END AS bucket,
             'DC'::text AS doc_type, d.id AS doc_id, COALESCE(d.challanno, d.id) AS vch_no,
             COALESCE(d.customername, d.challanno, d.id) AS particulars,
             CASE
               WHEN l.dispatch_reason IN (${sqlList(codes.saleExit)}) THEN 'DC Sale'
               WHEN l.dispatch_reason IN (${sqlList(codes.otherExit)}) THEN 'DC Other exit'
               WHEN l.dispatch_reason IN (${sqlList(codes.vendorExit)}) THEN 'DC Vendor return'
               ELSE 'DC · still owned'
             END AS vch_type,
             (l.dispatch_reason IN (${sqlList([...codes.saleExit, ...codes.otherExit, ...codes.vendorExit])})) AS affects_close
      FROM dc_disposition_line l
      JOIN delivery_challans d ON d.id = l.delivery_challan_id
      WHERE UPPER(COALESCE(d.lifecycle_status, '')) NOT IN ('DRAFT', 'READY', 'VOID')`);
  }

  if ((await hasTable('vendor_return_line')) && (await hasTable('vendor_return'))) {
    parts.push(`
      SELECT COALESCE(v.dispatched_at, v.created_at)::timestamptz AS event_ts,
             l.resource_type, l.resource_id, 0::numeric AS qty_in, l.quantity AS qty_out,
             'vendorReturn'::text AS bucket, 'VENDOR_RETURN'::text AS doc_type,
             v.id AS doc_id, v.id AS vch_no, COALESCE(v.vendor_name, v.id) AS particulars,
             'Vendor Return'::text AS vch_type, TRUE AS affects_close
      FROM vendor_return_line l
      JOIN vendor_return v ON v.id = l.vendor_return_id
      WHERE v.status = 'DISPATCHED'`);
  }

  if (await hasTable('assets')) {
    parts.push(`
      SELECT a.retired_at::timestamptz AS event_ts,
             'ASSET'::text AS resource_type, a.id AS resource_id,
             0::numeric AS qty_in,
             CASE WHEN COALESCE(a.is_quantity_tracked, 0) = 1 THEN COALESCE(a.quantity_total, 0) ELSE 1 END AS qty_out,
             'retired'::text AS bucket, 'RETIRE'::text AS doc_type,
             a.id AS doc_id, a.id AS vch_no, COALESCE(a.retire_reason, 'Retired') AS particulars,
             'Asset Retire'::text AS vch_type, TRUE AS affects_close
      FROM assets.assets a
      WHERE a.retired_at IS NOT NULL`);
  }

  if ((await hasTable('inventory_quantity_events')) && (await hasTable('inventory_quantity_event_lines'))) {
    parts.push(`
      SELECT e.timestamp::timestamptz AS event_ts,
             'INVENTORY'::text AS resource_type, l.item_id AS resource_id,
             CASE WHEN e.type = 'ADJUST' AND l.delta_total > 0 THEN l.delta_total ELSE 0 END AS qty_in,
             CASE
               WHEN e.type = 'CONSUME' THEN ABS(l.delta_total)
               WHEN e.type = 'ADJUST' AND l.delta_total < 0 THEN ABS(l.delta_total)
               ELSE 0
             END AS qty_out,
             CASE WHEN e.type = 'CONSUME' THEN 'consumed' ELSE 'manualAdjustments' END AS bucket,
             CASE WHEN e.type = 'CONSUME' THEN 'CONSUME' ELSE 'ADJUST' END AS doc_type,
             e.id::text AS doc_id, e.id::text AS vch_no,
             COALESCE(e.note, e.type) AS particulars,
             CASE WHEN e.type = 'CONSUME' THEN 'Consume' ELSE 'Manual adj.' END AS vch_type,
             TRUE AS affects_close
      FROM inventory_quantity_events e
      JOIN inventory_quantity_event_lines l ON l.event_id = e.id
      WHERE e.type IN ('CONSUME', 'ADJUST')
        AND COALESCE(e.metadata_json, '') NOT LIKE '%"reversal":true%'`);
  }

  if ((await hasTable('quantity_events')) && (await hasTable('quantity_event_lines'))) {
    parts.push(`
      SELECT e.timestamp::timestamptz AS event_ts,
             'ASSET'::text AS resource_type, l.asset_id AS resource_id,
             CASE WHEN l.delta_total > 0 THEN l.delta_total ELSE 0 END AS qty_in,
             CASE WHEN l.delta_total < 0 THEN ABS(l.delta_total) ELSE 0 END AS qty_out,
             'manualAdjustments'::text AS bucket, 'ADJUST'::text AS doc_type,
             e.id::text AS doc_id, e.id::text AS vch_no,
             COALESCE(e.note, 'Manual adj.') AS particulars,
             'Manual adj.'::text AS vch_type, TRUE AS affects_close
      FROM quantity_events e
      JOIN quantity_event_lines l ON l.event_id = e.id
      WHERE e.type = 'ADJUST'
        AND COALESCE(e.metadata_json, '') NOT LIKE '%"reversal":true%'`);
  }

  if ((await hasTable('conversion')) && (await hasTable('conversion_line'))) {
    parts.push(`
      SELECT c.created_at::timestamptz AS event_ts,
             l.holding_type AS resource_type, l.holding_id AS resource_id,
             CASE WHEN l.role = 'DESTINATION' THEN l.quantity ELSE 0 END AS qty_in,
             CASE WHEN l.role = 'SOURCE' THEN l.quantity ELSE 0 END AS qty_out,
             CASE WHEN l.role = 'DESTINATION' THEN 'convertedIn' ELSE 'convertedOut' END AS bucket,
             'CONVERSION'::text AS doc_type, c.id AS doc_id, c.id AS vch_no,
             COALESCE(c.reason_code, 'Conversion') AS particulars,
             'Conversion'::text AS vch_type, TRUE AS affects_close
      FROM conversion_line l
      JOIN "conversion" c ON c.id = l.conversion_id
      WHERE c.status IN ('ACTIVE', 'RETURNED', 'RECLASSIFIED')`);
  }

  if (!parts.length) return [];

  const sql = `
    SELECT e.event_ts, e.resource_type, e.resource_id, e.qty_in, e.qty_out, e.bucket,
           e.doc_type, e.doc_id, e.vch_no, e.particulars, e.vch_type, e.affects_close,
           COALESCE(a.product_id, i.product_id) AS product_id
    FROM (
      ${parts.join('\nUNION ALL\n')}
    ) e
    ${HOLDING_JOIN}
    WHERE e.event_ts IS NOT NULL`;

  return rawRows(await db.raw(sql)).map((row) => ({
    eventTs: new Date(row.event_ts),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    productId: row.product_id || null,
    qtyIn: num(row.qty_in),
    qtyOut: num(row.qty_out),
    bucket: row.bucket,
    docType: row.doc_type,
    docId: row.doc_id,
    vchNo: row.vch_no,
    particulars: row.particulars,
    vchType: row.vch_type,
    affectsClose: row.affects_close === true || row.affects_close === 't' || row.affects_close === true,
    kind: row.resource_type === 'ASSET' ? 'Asset' : 'Inventory'
  }));
}

function filterType(events, type) {
  const resourceType = normalizeType(type);
  if (!resourceType) return events;
  return events.filter((e) => e.resourceType === resourceType);
}

function netOf(events, pred) {
  let inn = 0;
  let out = 0;
  events.forEach((e) => {
    if (!pred(e) || !e.affectsClose) return;
    inn += e.qtyIn;
    out += e.qtyOut;
  });
  return { inwards: round(inn), outwards: round(out), net: round(inn - out) };
}

function splitKind(events, pred) {
  const out = { inAsset: 0, inInventory: 0, outAsset: 0, outInventory: 0 };
  events.forEach((e) => {
    if (!pred(e) || !e.affectsClose) return;
    if (e.resourceType === 'ASSET') {
      out.inAsset += e.qtyIn;
      out.outAsset += e.qtyOut;
    } else {
      out.inInventory += e.qtyIn;
      out.outInventory += e.qtyOut;
    }
  });
  Object.keys(out).forEach((k) => { out[k] = round(out[k]); });
  return out;
}

async function productMeta(ids) {
  const real = [...new Set(ids.filter(Boolean))];
  if (!real.length || !(await hasTable('product'))) return new Map();
  const rows = await db('product').select('id', 'name', 'product_code').whereIn('id', real);
  return new Map(rows.map((r) => [r.id, r]));
}

function totalsShape(opening, windowEvents) {
  const move = netOf(windowEvents, () => true);
  const kinds = splitKind(windowEvents, () => true);
  const closing = round(opening + move.net);
  return {
    opening: round(opening),
    inwards: move.inwards,
    outwards: move.outwards,
    closing,
    ...kinds
  };
}

async function listFinancialYears({ type } = {}) {
  const events = filterType(await loadEvents(), type);
  const now = new Date();
  const currentFy = fyStartYearOf(now);
  let minFy = currentFy;
  events.forEach((e) => {
    if (!Number.isNaN(e.eventTs.getTime())) minFy = Math.min(minFy, fyStartYearOf(e.eventTs));
  });
  const rows = [];
  for (let y = minFy; y <= currentFy; y += 1) {
    const { from, to } = fyWindow(y);
    const opening = netOf(events, (e) => before(e.eventTs, from)).net;
    const win = events.filter((e) => inWindow(e.eventTs, from, to));
    rows.push({
      key: String(y),
      grain: 'fy',
      fy: y,
      particulars: fyLabel(y),
      sub: `1 Apr ${y} – 31 Mar ${y + 1}`,
      from: from.toISOString(),
      to: to.toISOString(),
      ...totalsShape(opening, win)
    });
  }
  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    grain: 'fy',
    type: normalizeType(type) || 'ALL',
    rows
  };
}

async function listQuarters({ fy, type } = {}) {
  const y = Number(fy);
  if (!Number.isFinite(y) || y < 2000) {
    const err = new Error('fy (start year, e.g. 2026 for FY 2026–27) is required');
    err.statusCode = 400;
    throw err;
  }
  const events = filterType(await loadEvents(), type);
  const fyW = fyWindow(y);
  const openingFy = netOf(events, (e) => before(e.eventTs, fyW.from)).net;
  const rows = [{
    key: 'opening',
    grain: 'opening',
    particulars: 'Opening Balance',
    sub: `1 Apr ${y}`,
    from: fyW.from.toISOString(),
    to: fyW.from.toISOString(),
    opening: round(openingFy),
    inwards: 0,
    outwards: 0,
    closing: round(openingFy),
    inAsset: 0,
    inInventory: 0,
    outAsset: 0,
    outInventory: 0
  }];
  let running = openingFy;
  for (let q = 1; q <= 4; q += 1) {
    const { from, to } = quarterWindow(y, q);
    const win = events.filter((e) => inWindow(e.eventTs, from, to));
    const t = totalsShape(running, win);
    running = t.closing;
    const months = Q_MONTHS[q - 1].map((i) => MONTH_NAMES[i]).join(', ');
    rows.push({
      key: `Q${q}`,
      grain: 'fq',
      fy: y,
      fq: q,
      particulars: `Q${q}`,
      sub: months,
      from: from.toISOString(),
      to: to.toISOString(),
      ...t
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    grain: 'fq',
    fy: y,
    label: fyLabel(y),
    type: normalizeType(type) || 'ALL',
    from: fyW.from.toISOString(),
    to: fyW.to.toISOString(),
    rows
  };
}

async function listMonths({ fy, type } = {}) {
  const y = Number(fy);
  if (!Number.isFinite(y) || y < 2000) {
    const err = new Error('fy (start year, e.g. 2026 for FY 2026–27) is required');
    err.statusCode = 400;
    throw err;
  }
  const events = filterType(await loadEvents(), type);
  const fyW = fyWindow(y);
  const openingFy = netOf(events, (e) => before(e.eventTs, fyW.from)).net;
  const rows = [{
    key: 'opening',
    grain: 'opening',
    particulars: 'Opening Balance',
    sub: `1 Apr ${y}`,
    from: fyW.from.toISOString(),
    to: fyW.from.toISOString(),
    opening: round(openingFy),
    inwards: 0,
    outwards: 0,
    closing: round(openingFy),
    inAsset: 0,
    inInventory: 0,
    outAsset: 0,
    outInventory: 0
  }];
  let running = openingFy;
  for (let i = 0; i < 12; i += 1) {
    const m = monthWindow(y, i);
    const win = events.filter((e) => inWindow(e.eventTs, m.from, m.to));
    const t = totalsShape(running, win);
    running = t.closing;
    const q = Math.floor(i / 3) + 1;
    rows.push({
      key: m.key,
      grain: 'month',
      fy: y,
      fq: q,
      month: m.key,
      particulars: MONTH_NAMES[i],
      sub: `Q${q} · ${m.key}`,
      from: m.from.toISOString(),
      to: m.to.toISOString(),
      ...t
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    grain: 'month',
    fy: y,
    label: fyLabel(y),
    type: normalizeType(type) || 'ALL',
    from: fyW.from.toISOString(),
    to: fyW.to.toISOString(),
    rows
  };
}

async function listProducts({ from, to, type, q } = {}) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('from and to (ISO timestamps) are required');
    err.statusCode = 400;
    throw err;
  }
  const events = filterType(await loadEvents(), type);
  const byProduct = new Map();
  events.forEach((e) => {
    const key = e.productId || '__none__';
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(e);
  });
  const meta = await productMeta([...byProduct.keys()]);
  let rows = [...byProduct.entries()].map(([key, list]) => {
    const opening = netOf(list, (e) => before(e.eventTs, start)).net;
    const win = list.filter((e) => inWindow(e.eventTs, start, end));
    const t = totalsShape(opening, win);
    const p = meta.get(key);
    const activity = win.length;
    return {
      key,
      grain: 'product',
      productId: key === '__none__' ? null : key,
      particulars: key === '__none__' ? 'No Product linked' : (p?.name || key),
      sub: p?.product_code || key,
      productCode: p?.product_code || null,
      activity,
      from: start.toISOString(),
      to: end.toISOString(),
      ...t
    };
  }).filter((r) => r.activity > 0);

  const needle = lower(q);
  if (needle) {
    rows = rows.filter((r) => [r.particulars, r.sub, r.productId].some((v) => lower(v).includes(needle)));
  }
  rows.sort((a, b) => (Math.abs(b.inwards) + Math.abs(b.outwards)) - (Math.abs(a.inwards) + Math.abs(a.outwards))
    || String(a.particulars).localeCompare(String(b.particulars)));

  const grandOpen = round(rows.reduce((s, r) => s + r.opening, 0));
  const grandIn = round(rows.reduce((s, r) => s + r.inwards, 0));
  const grandOut = round(rows.reduce((s, r) => s + r.outwards, 0));
  return {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    grain: 'products',
    type: normalizeType(type) || 'ALL',
    from: start.toISOString(),
    to: end.toISOString(),
    totals: {
      opening: grandOpen,
      inwards: grandIn,
      outwards: grandOut,
      closing: round(grandOpen + grandIn - grandOut),
      inAsset: round(rows.reduce((s, r) => s + r.inAsset, 0)),
      inInventory: round(rows.reduce((s, r) => s + r.inInventory, 0)),
      outAsset: round(rows.reduce((s, r) => s + r.outAsset, 0)),
      outInventory: round(rows.reduce((s, r) => s + r.outInventory, 0)),
      products: rows.length
    },
    rows
  };
}

async function listVouchers({ productId, from, to, type } = {}) {
  const start = new Date(from);
  const end = new Date(to);
  const key = String(productId || '').trim();
  if (!key || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('productId, from and to are required');
    err.statusCode = 400;
    throw err;
  }
  const events = filterType(await loadEvents(), type)
    .filter((e) => (e.productId || '__none__') === key);
  const opening = netOf(events, (e) => before(e.eventTs, start)).net;
  const win = events.filter((e) => inWindow(e.eventTs, start, end))
    .sort((a, b) => a.eventTs - b.eventTs || String(a.docId).localeCompare(String(b.docId)));
  let running = opening;
  const vouchers = win.map((e) => {
    if (e.affectsClose) running = round(running + e.qtyIn - e.qtyOut);
    return {
      eventTs: e.eventTs.toISOString(),
      particulars: e.particulars,
      vchType: e.vchType,
      vchNo: e.vchNo,
      docType: e.docType,
      docId: e.docId,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      kind: e.kind,
      inwards: round(e.qtyIn),
      outwards: round(e.qtyOut),
      closing: running,
      affectsClose: !!e.affectsClose,
      bucket: e.bucket
    };
  });
  const meta = await productMeta([key === '__none__' ? null : key].filter(Boolean));
  const p = meta.get(key);
  const move = netOf(win, () => true);
  return {
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    grain: 'vouchers',
    type: normalizeType(type) || 'ALL',
    productId: key === '__none__' ? null : key,
    productName: key === '__none__' ? 'No Product linked' : (p?.name || key),
    productCode: p?.product_code || null,
    from: start.toISOString(),
    to: end.toISOString(),
    opening: round(opening),
    totals: {
      opening: round(opening),
      inwards: move.inwards,
      outwards: move.outwards,
      closing: round(opening + move.net),
      ...splitKind(win, () => true)
    },
    vouchers
  };
}

module.exports = {
  listFinancialYears,
  listQuarters,
  listMonths,
  listProducts,
  listVouchers,
  fyLabel,
  fyWindow
};
