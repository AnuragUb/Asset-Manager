/**
 * Physical tally report (PHYSICAL_TALLY_AUTHORITY_ADR).
 *
 * Per Product: stock IN (Receipt Note, Physical Intake, legacy opening) vs controlled
 * exits (DC Sale, Retire, Vendor Return, Consume, other/manual) vs ON HAND.
 * Assets and inventory are combined per product so reshaping (conversion, break /
 * split) nets to zero. A non-zero mismatch means the count moved without a document
 * behind it (e.g. a manual quantity override).
 *
 * Read-only. Quantity rule: tracked holdings use quantity_total, untracked count as 1.
 */
const { db } = require('../utils');
const reasonCatalog = require('./dcReasonCatalog');

const BASE_ASSET_EXIT_STATUSES = [
  'sold', 'retired', 'returned to vendor', 'scraped', 'scrapped', 'consumed', 'lost',
  'replaced', 'issued foc'
];
/** Base exit statuses plus every exit reason's asset status; refreshed on each report load. */
let ASSET_EXIT_STATUSES = new Set(BASE_ASSET_EXIT_STATUSES);
const BASE_OUT_STATUSES = [
  'demo', 'rental', 'in-repair', 'in repair',
  'out on demo', 'out on rental', 'out for repair', 'out for internal use', 'in transit'
];
/** "Out but still owned" statuses (legacy manual ones plus every returnable reason's status). */
let OUT_STATUSES = new Set(BASE_OUT_STATUSES);
// Reason codes are catalog-constrained to ^[A-Z][A-Z0-9_]+$, so inlining them is safe.
const sqlList = (values) => (values.length
  ? values.filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v)).map((v) => `'${v}'`).join(',') || 'NULL'
  : 'NULL');
const EPS = 1e-6;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(num(v) * 1e6) / 1e6;
const lower = (v) => String(v || '').trim().toLowerCase();
const docs = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

function rawRows(result) {
  if (!result) return [];
  if (Array.isArray(result.rows)) return result.rows;
  return Array.isArray(result) ? result : [];
}

async function hasTable(name) {
  return db.schema.hasTable(name);
}

async function sourceCtes() {
  const parts = [];
  const codes = await reasonCatalog.codesByBehaviour();
  ASSET_EXIT_STATUSES = new Set([
    ...BASE_ASSET_EXIT_STATUSES,
    ...(await reasonCatalog.assetStatuses({ exit: true }))
  ]);
  OUT_STATUSES = new Set([
    ...BASE_OUT_STATUSES,
    ...(await reasonCatalog.assetStatuses({ returnable: true }))
  ]);
  const hasRn = (await hasTable('receipt_physical_output')) && (await hasTable('receipt_note'));
  const hasInwardKind = hasRn && (await db.schema.hasColumn('receipt_note', 'inward_kind'));
  parts.push(hasRn
    ? `rn AS (
        SELECT o.resource_type, LOWER(o.resource_id) AS rid, SUM(o.quantity) AS qty,
               ARRAY_AGG(DISTINCT o.receipt_note_id) AS docs
        FROM receipt_physical_output o
        JOIN receipt_note n ON n.id = o.receipt_note_id
        WHERE n.status = 'POSTED'
          ${hasInwardKind ? `AND COALESCE(n.inward_kind, 'PURCHASE_INWARD') <> 'RETURN_INWARD'` : ''}
        GROUP BY 1, 2)`
    : `rn AS (SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS qty, ARRAY[]::text[] AS docs WHERE FALSE)`);

  parts.push((await hasTable('physical_intake_output'))
    ? `pi AS (
        SELECT o.resource_type, LOWER(o.resource_id) AS rid, SUM(o.quantity) AS qty,
               ARRAY_AGG(DISTINCT o.physical_intake_id) AS docs
        FROM physical_intake_output o
        GROUP BY 1, 2)`
    : `pi AS (SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS qty, ARRAY[]::text[] AS docs WHERE FALSE)`);

  parts.push((await hasTable('dc_disposition_line'))
    ? `dcl AS (
        SELECT resource_type, LOWER(resource_id) AS rid,
               SUM(CASE WHEN dispatch_reason IN (${sqlList(codes.saleExit)}) THEN quantity ELSE 0 END) AS sale_qty,
               SUM(CASE WHEN dispatch_reason IN (${sqlList(codes.otherExit)}) THEN quantity ELSE 0 END) AS other_exit_qty,
               SUM(CASE WHEN dispatch_reason IN (${sqlList(codes.vendorExit)}) THEN quantity ELSE 0 END) AS vr_dc_qty,
               SUM(CASE WHEN dispatch_reason IN (${sqlList(codes.returnable)}) THEN COALESCE(quantity_returned, 0) ELSE 0 END) AS returned_qty,
               SUM(CASE WHEN dispatch_reason IN (${sqlList(codes.returnable)}) AND disposition_status <> 'RETURNED'
                        THEN quantity - COALESCE(quantity_returned, 0) ELSE 0 END) AS out_qty,
               ARRAY_AGG(DISTINCT delivery_challan_id) FILTER (
                 WHERE NOT (dispatch_reason IN (${sqlList(codes.returnable)}) AND (disposition_status = 'RETURNED' OR COALESCE(quantity_returned, 0) >= quantity))
               ) AS docs,
               ARRAY_AGG(DISTINCT delivery_challan_id) FILTER (
                 WHERE dispatch_reason IN (${sqlList(codes.returnable)}) AND (disposition_status = 'RETURNED' OR COALESCE(quantity_returned, 0) > 0)
               ) AS returned_docs
        FROM dc_disposition_line
        GROUP BY 1, 2)`
    : `dcl AS (SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS sale_qty, 0::numeric AS other_exit_qty, 0::numeric AS vr_dc_qty, 0::numeric AS returned_qty, 0::numeric AS out_qty, ARRAY[]::text[] AS docs, ARRAY[]::text[] AS returned_docs WHERE FALSE)`);

  parts.push((await hasTable('vendor_return_line')) && (await hasTable('vendor_return'))
    ? `vr AS (
        SELECT l.resource_type, LOWER(l.resource_id) AS rid, SUM(l.quantity) AS qty,
               ARRAY_AGG(DISTINCT l.vendor_return_id) AS docs
        FROM vendor_return_line l
        JOIN vendor_return v ON v.id = l.vendor_return_id
        WHERE v.status = 'DISPATCHED'
        GROUP BY 1, 2)`
    : `vr AS (SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS qty, ARRAY[]::text[] AS docs WHERE FALSE)`);

  parts.push((await hasTable('inventory_quantity_events')) && (await hasTable('inventory_quantity_event_lines'))
    ? `invx AS (
        SELECT LOWER(l.item_id) AS rid,
               -SUM(CASE WHEN e.type = 'CONSUME' THEN l.delta_total ELSE 0 END) AS consumed,
               SUM(CASE WHEN e.type = 'ADJUST' AND COALESCE(e.metadata_json, '') NOT LIKE '%"reversal":true%'
                        THEN l.delta_total ELSE 0 END) AS adjusted
        FROM inventory_quantity_events e
        JOIN inventory_quantity_event_lines l ON l.event_id = e.id
        WHERE e.type IN ('CONSUME', 'ADJUST')
        GROUP BY 1)`
    : `invx AS (SELECT NULL::text AS rid, 0::numeric AS consumed, 0::numeric AS adjusted WHERE FALSE)`);

  // Asset → Inventory reclassification (§11): source asset = converted out, destination
  // inventory = converted in; "created" marks an inventory item born from the reclassification.
  parts.push((await hasTable('conversion')) && (await hasTable('conversion_line'))
    ? `rc AS (
        SELECT l.holding_type AS resource_type, LOWER(l.holding_id) AS rid,
               SUM(CASE WHEN l.role = 'SOURCE' THEN l.quantity ELSE 0 END) AS out_qty,
               SUM(CASE WHEN l.role = 'DESTINATION' THEN l.quantity ELSE 0 END) AS in_qty,
               BOOL_OR(l.role = 'DESTINATION' AND c.reason_code = 'RECLASSIFY_NEW') AS created
        FROM conversion_line l
        JOIN "conversion" c ON c.id = l.conversion_id
        WHERE c.status = 'RECLASSIFIED'
        GROUP BY 1, 2)`
    : `rc AS (SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS out_qty, 0::numeric AS in_qty, FALSE AS created WHERE FALSE)`);

  parts.push((await hasTable('quantity_events')) && (await hasTable('quantity_event_lines'))
    ? `ax AS (
        SELECT LOWER(l.asset_id) AS rid,
               SUM(CASE WHEN COALESCE(e.metadata_json, '') NOT LIKE '%"reversal":true%' THEN l.delta_total ELSE 0 END) AS adjusted
        FROM quantity_events e
        JOIN quantity_event_lines l ON l.event_id = e.id
        WHERE e.type = 'ADJUST'
        GROUP BY 1)`
    : `ax AS (SELECT NULL::text AS rid, 0::numeric AS adjusted WHERE FALSE)`);

  const emptySetRes = `SELECT NULL::text AS resource_type, NULL::text AS rid, 0::numeric AS qty, ARRAY[]::text[] AS set_ids WHERE FALSE`;
  const hasRes = await hasTable('reservation');
  parts.push(hasRes
    ? `setr AS (
        SELECT resource_type, LOWER(resource_id) AS rid, SUM(quantity) AS qty,
               ARRAY_AGG(DISTINCT owner_id) AS set_ids
        FROM reservation
        WHERE status = 'ACTIVE' AND owner_type = 'SET'
        GROUP BY 1, 2)`
    : `setr AS (${emptySetRes})`);

  parts.push((await hasTable('managed_set_components'))
    ? `seta AS (
        SELECT CASE WHEN UPPER(c.component_type) = 'ASSET' THEN 'ASSET' ELSE 'INVENTORY' END AS resource_type,
               LOWER(COALESCE(c.asset_id, c.inventory_item_id)) AS rid,
               SUM(c.quantity) AS qty,
               ARRAY_AGG(DISTINCT c.set_id) AS set_ids
        FROM managed_set_components c
        WHERE COALESCE(c.is_active, true) = true
          ${hasRes ? `AND NOT EXISTS (
            SELECT 1 FROM reservation r
            WHERE r.id = c.reservation_id
              AND r.status = 'ACTIVE'
              AND r.owner_type = 'SET'
          )` : ''}
        GROUP BY 1, 2)`
    : `seta AS (${emptySetRes})`);

  return `WITH ${parts.join(',\n')}`;
}

async function loadHoldingRows(productId) {
  const ctes = await sourceCtes();
  const bindings = [];
  const productFilter = (alias) => {
    if (!productId) return '';
    if (productId === '__none__') return `AND ${alias}.product_id IS NULL`;
    bindings.push(productId);
    return `AND ${alias}.product_id = ?`;
  };
  const assetSql = `
    ${ctes}
    SELECT 'ASSET' AS resource_type, a.id, a.product_id, a.itemname AS name, a.status,
           COALESCE(a.is_deleted, 0) AS is_deleted,
           CASE WHEN COALESCE(a.is_quantity_tracked, 0) = 1 THEN COALESCE(a.quantity_total, 0) ELSE 1 END AS hq,
           COALESCE(a.is_retired, 0) AS is_retired, a.retired_at, a.retire_reason,
           a.quantity_root_id, a.conversion_source_id, 0 AS quantity_converted,
           rn.qty AS rn_qty, rn.docs AS rn_docs, pi.qty AS pi_qty, pi.docs AS pi_docs,
           dcl.sale_qty, dcl.other_exit_qty, dcl.vr_dc_qty, dcl.returned_qty, dcl.out_qty, dcl.docs AS dc_docs, dcl.returned_docs AS returned_dc_docs, vr.qty AS vr_qty, vr.docs AS vr_docs,
           0 AS consumed_qty, COALESCE(ax.adjusted, 0) AS adjusted_qty,
           COALESCE(rc.out_qty, 0) AS reclass_out, 0 AS reclass_in, FALSE AS reclass_created,
           COALESCE(setr.qty, 0) + COALESCE(seta.qty, 0) AS reserved_set_qty,
           COALESCE(setr.set_ids, ARRAY[]::text[]) || COALESCE(seta.set_ids, ARRAY[]::text[]) AS set_docs
    FROM assets.assets a
    LEFT JOIN ax ON ax.rid = LOWER(a.id)
    LEFT JOIN rc ON rc.resource_type = 'ASSET' AND rc.rid = LOWER(a.id)
    LEFT JOIN rn ON rn.resource_type = 'ASSET' AND rn.rid = LOWER(a.id)
    LEFT JOIN pi ON pi.resource_type = 'ASSET' AND pi.rid = LOWER(a.id)
    LEFT JOIN dcl ON dcl.resource_type = 'ASSET' AND dcl.rid = LOWER(a.id)
    LEFT JOIN vr ON vr.resource_type = 'ASSET' AND vr.rid = LOWER(a.id)
    LEFT JOIN setr ON setr.resource_type = 'ASSET' AND setr.rid = LOWER(a.id)
    LEFT JOIN seta ON seta.resource_type = 'ASSET' AND seta.rid = LOWER(a.id)
    WHERE (COALESCE(a.lineage_status, 'ACTIVE') <> 'INACTIVE' OR COALESCE(rc.out_qty, 0) > 0)
    ${productFilter('a')}`;
  const assetRows = rawRows(await db.raw(assetSql, bindings.splice(0)));

  let inventoryRows = [];
  if (await hasTable('inventory_items')) {
    const hasConverted = await db.schema.hasColumn('inventory_items', 'quantity_converted');
    const hasLineage = await db.schema.hasColumn('inventory_items', 'lineage_status');
    const invSql = `
      ${ctes}
      SELECT 'INVENTORY' AS resource_type, i.id, i.product_id, i.itemname AS name, i.status,
             COALESCE(i.is_deleted, 0) AS is_deleted,
             CASE WHEN COALESCE(i.is_quantity_tracked, 0) = 1 THEN COALESCE(i.quantity_total, 0)
                  WHEN LOWER(COALESCE(i.status, '')) = 'consumed' THEN 0 ELSE 1 END AS hq,
             0 AS is_retired, NULL AS retired_at, NULL AS retire_reason,
             i.quantity_root_id, NULL AS conversion_source_id,
             ${hasConverted ? 'COALESCE(i.quantity_converted, 0)' : '0'} AS quantity_converted,
             rn.qty AS rn_qty, rn.docs AS rn_docs, pi.qty AS pi_qty, pi.docs AS pi_docs,
             dcl.sale_qty, dcl.other_exit_qty, dcl.vr_dc_qty, dcl.returned_qty, dcl.out_qty, dcl.docs AS dc_docs, dcl.returned_docs AS returned_dc_docs, vr.qty AS vr_qty, vr.docs AS vr_docs,
             COALESCE(invx.consumed, 0) AS consumed_qty, COALESCE(invx.adjusted, 0) AS adjusted_qty,
             0 AS reclass_out, COALESCE(rc.in_qty, 0) AS reclass_in, COALESCE(rc.created, FALSE) AS reclass_created,
             COALESCE(setr.qty, 0) + COALESCE(seta.qty, 0) AS reserved_set_qty,
             COALESCE(setr.set_ids, ARRAY[]::text[]) || COALESCE(seta.set_ids, ARRAY[]::text[]) AS set_docs
      FROM inventory_items i
      LEFT JOIN rc ON rc.resource_type = 'INVENTORY' AND rc.rid = LOWER(i.id)
      LEFT JOIN rn ON rn.resource_type = 'INVENTORY' AND rn.rid = LOWER(i.id)
      LEFT JOIN pi ON pi.resource_type = 'INVENTORY' AND pi.rid = LOWER(i.id)
      LEFT JOIN dcl ON dcl.resource_type = 'INVENTORY' AND dcl.rid = LOWER(i.id)
      LEFT JOIN vr ON vr.resource_type = 'INVENTORY' AND vr.rid = LOWER(i.id)
      LEFT JOIN invx ON invx.rid = LOWER(i.id)
      LEFT JOIN setr ON setr.resource_type = 'INVENTORY' AND setr.rid = LOWER(i.id)
      LEFT JOIN seta ON seta.resource_type = 'INVENTORY' AND seta.rid = LOWER(i.id)
      WHERE ${hasLineage ? `COALESCE(i.lineage_status, 'ACTIVE') <> 'INACTIVE'` : 'TRUE'}
      ${productFilter('i')}`;
    inventoryRows = rawRows(await db.raw(invSql, bindings.splice(0)));
  }
  return [...assetRows, ...inventoryRows];
}

/** Classify one holding into tally buckets. */
function classifyHolding(row, sourcedIds) {
  const isAsset = row.resource_type === 'ASSET';
  const hq = num(row.hq);
  const deleted = Number(row.is_deleted) === 1;
  const rnIn = num(row.rn_qty);
  const piIn = num(row.pi_qty);
  const out = {
    dcSale: 0, dcOtherExit: 0, retired: 0, vendorReturn: 0, consumed: 0, otherExit: 0,
    deleted: 0, onHand: 0, outOnDc: num(row.out_qty), outManual: 0,
    reservedForSet: num(row.reserved_set_qty)
  };

  if (isAsset) {
    const exited = Number(row.is_retired) === 1 || ASSET_EXIT_STATUSES.has(lower(row.status));
    if (exited) {
      if (num(row.sale_qty) > 0) out.dcSale = hq;
      else if (num(row.other_exit_qty) > 0) out.dcOtherExit = hq;
      else if (row.retired_at) out.retired = hq;
      else if (num(row.vr_qty) > 0 || num(row.vr_dc_qty) > 0 || lower(row.status) === 'returned to vendor') out.vendorReturn = hq;
      else out.otherExit = hq;
    } else if (deleted) {
      out.deleted = hq;
    } else {
      out.onHand = hq;
    }
  } else {
    out.dcSale = num(row.sale_qty);
    out.dcOtherExit = num(row.other_exit_qty);
    out.vendorReturn = num(row.vr_qty) + num(row.vr_dc_qty);
    out.consumed = num(row.consumed_qty);
    if (deleted) out.deleted = hq;
    else out.onHand = hq;
  }

  const reclassOut = num(row.reclass_out);
  const reclassIn = num(row.reclass_in);
  if (reclassOut > 0) out.onHand = 0;

  // Status says "out" (e.g. set by a superuser override) but no open DC backs it.
  // Informational like outOnDc: the holding is still owned, so it stays in onHand.
  if (out.onHand > 0 && out.outOnDc <= EPS && OUT_STATUSES.has(lower(row.status))) {
    out.outManual = out.onHand;
  }

  const idKey = `${row.resource_type}:${lower(row.id)}`;
  const rootKey = `${row.resource_type}:${lower(row.quantity_root_id || row.id)}`;
  const legacy = !sourcedIds.has(idKey) && !sourcedIds.has(rootKey) && !row.conversion_source_id;
  const exits = out.dcSale + out.dcOtherExit + out.retired + out.vendorReturn + out.consumed + out.otherExit;
  // Inventory→Asset conversion: the asset side is "converted in", the source inventory's
  // outstanding quantity_converted is "converted out". They net to zero when both types are shown.
  // Reclassification adds to both sides the same way.
  const convertedIn = (isAsset && row.conversion_source_id ? hq : 0) + reclassIn;
  const convertedOut = (isAsset ? 0 : num(row.quantity_converted)) + reclassOut;
  const opening = legacy ? out.onHand + exits + out.deleted + convertedOut - convertedIn : 0;

  return {
    resourceType: row.resource_type,
    id: row.id,
    productId: row.product_id || null,
    name: row.name || null,
    status: row.status || null,
    isDeleted: deleted,
    retireReason: row.retire_reason || null,
    source: rnIn > 0 ? 'RECEIPT_NOTE' : (piIn > 0 ? 'PHYSICAL_INTAKE' : (row.reclass_created ? 'RECLASSIFIED' : (legacy ? 'LEGACY' : 'RESHAPED'))),
    inReceipt: round(rnIn),
    inIntake: round(piIn),
    inDcReturn: round(num(row.returned_qty)),
    inOpening: round(opening),
    convertedIn: round(convertedIn),
    convertedOut: round(convertedOut),
    reclassifiedIn: round(reclassIn),
    reclassifiedOut: round(reclassOut),
    // Closed by reclassification: kept for the audit trail, no longer a holding.
    closed: reclassOut > 0,
    ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round(v)])),
    manualAdjustments: legacy ? 0 : round(row.adjusted_qty),
    documents: {
      receiptNotes: docs(row.rn_docs),
      physicalIntakes: docs(row.pi_docs),
      deliveryChallans: docs(row.dc_docs),
      returnedDeliveryChallans: docs(row.returned_dc_docs),
      vendorReturns: docs(row.vr_docs),
      reservedSets: docs(row.set_docs)
    }
  };
}

const SUM_KEYS = [
  'inReceipt', 'inIntake', 'inDcReturn', 'inOpening', 'convertedIn', 'convertedOut',
  'dcSale', 'dcOtherExit', 'retired', 'vendorReturn', 'consumed', 'otherExit',
  'deleted', 'onHand', 'outOnDc', 'outManual', 'reservedForSet', 'manualAdjustments'
];

function finalizeTotals(t) {
  const expected = t.inReceipt + t.inIntake + t.inOpening + t.convertedIn - t.convertedOut
    - t.dcSale - t.dcOtherExit - t.retired - t.vendorReturn - t.consumed - t.otherExit - t.deleted;
  t.expectedOnHand = round(expected);
  t.mismatch = round(t.onHand - expected);
  if (Math.abs(t.mismatch) < EPS) t.mismatch = 0;
  SUM_KEYS.forEach((k) => { t[k] = round(t[k]); });
  t.onHandAssets = round(t.onHandAssets);
  t.onHandInventory = round(t.onHandInventory);
  return t;
}

function emptyTotals() {
  return Object.fromEntries([...SUM_KEYS, 'onHandAssets', 'onHandInventory', 'holdings'].map((k) => [k, 0]));
}

function normalizeType(type) {
  const t = String(type || '').trim().toUpperCase();
  if (t === 'ASSET' || t === 'ASSETS') return 'ASSET';
  if (t === 'INVENTORY') return 'INVENTORY';
  return null;
}

function classifyAll(rows, type = null) {
  const sourcedIds = new Set();
  rows.forEach((r) => {
    if (num(r.rn_qty) > 0 || num(r.pi_qty) > 0 || r.reclass_created) sourcedIds.add(`${r.resource_type}:${lower(r.id)}`);
  });
  const holdings = rows.map((r) => classifyHolding(r, sourcedIds));
  return type ? holdings.filter((h) => h.resourceType === type) : holdings;
}

function accumulate(totals, h) {
  SUM_KEYS.forEach((k) => { totals[k] += h[k]; });
  if (h.resourceType === 'ASSET') totals.onHandAssets += h.onHand;
  else totals.onHandInventory += h.onHand;
  if (!h.closed) totals.holdings += 1;
}

async function productMeta(ids) {
  const real = ids.filter((id) => id && id !== '__none__');
  if (!real.length || !(await hasTable('product'))) return new Map();
  const rows = await db('product').select('id', 'name', 'product_code', 'origin', 'status').whereIn('id', real);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Tally summary per product.
 * @param {{ q?: string, mismatchOnly?: boolean, type?: 'ASSET'|'INVENTORY' }} opts
 */
async function getTallySummary({ q, mismatchOnly, type } = {}) {
  const resourceType = normalizeType(type);
  const holdings = classifyAll(await loadHoldingRows(null), resourceType);
  const byProduct = new Map();
  const returnedByProduct = new Map();
  holdings.forEach((h) => {
    const key = h.productId || '__none__';
    if (!byProduct.has(key)) byProduct.set(key, emptyTotals());
    accumulate(byProduct.get(key), h);
    docs(h.documents && h.documents.returnedDeliveryChallans).forEach((id) => {
      if (!returnedByProduct.has(key)) returnedByProduct.set(key, new Set());
      returnedByProduct.get(key).add(id);
    });
  });
  const returnedIds = [...new Set([...returnedByProduct.values()].flatMap((set) => [...set]))];
  const challanById = new Map();
  if (returnedIds.length && (await hasTable('delivery_challans'))) {
    const challans = await db('delivery_challans').whereIn('id', returnedIds).select('id', 'challanno', 'dispatch_reason');
    challans.forEach((row) => challanById.set(row.id, row));
  }

  const meta = await productMeta([...byProduct.keys()]);
  const grand = emptyTotals();
  let rows = [...byProduct.entries()].map(([key, totals]) => {
    const p = meta.get(key);
    SUM_KEYS.forEach((k) => { grand[k] += totals[k]; });
    grand.onHandAssets += totals.onHandAssets;
    grand.onHandInventory += totals.onHandInventory;
    grand.holdings += totals.holdings;
    return {
      productId: key === '__none__' ? null : key,
      productName: key === '__none__' ? 'No Product linked' : (p?.name || key),
      productCode: p?.product_code || null,
      origin: p?.origin || null,
      productStatus: p?.status || null,
      returnedChallans: [...(returnedByProduct.get(key) || [])].map((id) => {
        const row = challanById.get(id);
        return {
          id,
          challanNo: row && row.challanno ? row.challanno : id,
          dispatchReason: row && row.dispatch_reason ? row.dispatch_reason : null
        };
      }),
      ...finalizeTotals(totals)
    };
  });

  const needle = lower(q);
  if (needle) {
    rows = rows.filter((r) => [r.productId, r.productName, r.productCode].some((v) => lower(v).includes(needle)));
  }
  const mismatchCount = rows.filter((r) => r.mismatch !== 0).length;
  if (mismatchOnly) rows = rows.filter((r) => r.mismatch !== 0);
  rows.sort((a, b) => (Math.abs(b.mismatch) - Math.abs(a.mismatch)) || String(a.productName).localeCompare(String(b.productName)));

  return {
    generatedAt: new Date().toISOString(),
    type: resourceType || 'ALL',
    rules: {
      quantity: 'Tracked holdings use quantity_total; untracked holdings count as 1.',
      mismatch: 'On hand − (In − Out − Deleted). Non-zero means the count moved without a document.'
    },
    totals: finalizeTotals(grand),
    productCount: rows.length,
    mismatchCount,
    rows
  };
}

/** Replace raw DC ids on a product drill-down with challan number and reason. */
async function attachChallanLabels(holdings) {
  const ids = [...new Set(holdings.flatMap((h) => [
    ...docs(h.documents && h.documents.deliveryChallans),
    ...docs(h.documents && h.documents.returnedDeliveryChallans)
  ]))];
  if (!ids.length || !(await hasTable('delivery_challans'))) return;
  const rows = await db('delivery_challans').whereIn('id', ids).select('id', 'challanno', 'dispatch_reason');
  const byId = new Map(rows.map((r) => [r.id, r]));
  holdings.forEach((h) => {
    if (!h.documents) return;
    const labelDc = (id) => {
      const row = byId.get(id);
      return {
        id,
        challanNo: row && row.challanno ? row.challanno : id,
        dispatchReason: row && row.dispatch_reason ? row.dispatch_reason : null
      };
    };
    h.documents.deliveryChallans = docs(h.documents.deliveryChallans).map(labelDc);
    h.documents.returnedDeliveryChallans = docs(h.documents.returnedDeliveryChallans).map(labelDc);
  });
}

async function attachReservedSetLabels(holdings) {
  const ids = [...new Set(holdings.flatMap((h) => docs(h.documents && h.documents.reservedSets)))];
  if (!ids.length || !(await hasTable('managed_sets'))) return;
  const rows = await db('managed_sets').whereIn('id', ids).select('id', 'name', 'set_code');
  const byId = new Map(rows.map((r) => [r.id, r]));
  holdings.forEach((h) => {
    if (!h.documents) return;
    h.documents.reservedSets = docs(h.documents.reservedSets).map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: row && row.name ? row.name : id,
        setCode: row && row.set_code ? row.set_code : null
      };
    });
  });
}

/** Per-holding breakdown for one product ('__none__' = holdings without a product). */
async function getProductTally(productId, { type } = {}) {
  const resourceType = normalizeType(type);
  const key = String(productId || '').trim();
  if (!key) {
    const err = new Error('Product id is required');
    err.statusCode = 400;
    throw err;
  }
  const productRows = await loadHoldingRows(key);
  const holdings = classifyAll(productRows, resourceType);
  const totals = emptyTotals();
  holdings.forEach((h) => accumulate(totals, h));
  const meta = await productMeta([key]);
  const p = meta.get(key);
  holdings.sort((a, b) => a.resourceType.localeCompare(b.resourceType) || String(a.id).localeCompare(String(b.id)));
  await attachChallanLabels(holdings);
  await attachReservedSetLabels(holdings);
  return {
    productId: key === '__none__' ? null : key,
    productName: key === '__none__' ? 'No Product linked' : (p?.name || key),
    productCode: p?.product_code || null,
    origin: p?.origin || null,
    type: resourceType || 'ALL',
    totals: finalizeTotals(totals),
    holdings
  };
}

module.exports = {
  getTallySummary,
  getProductTally,
  _classifyHolding: classifyHolding
};
