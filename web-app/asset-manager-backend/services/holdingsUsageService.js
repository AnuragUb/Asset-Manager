/**
 * Current-usage snapshot for a holding (ASSET or INVENTORY).
 * Intended for list-row "where used" UI and later reporting portals.
 */
const { db } = require('../utils');
const reservationService = require('./reservationService');
const kitSetService = require('./kitSetService');

const RESOURCE_TYPES = Object.freeze({
  ASSET: { table: 'assets', label: 'ASSET' },
  INVENTORY: { table: 'inventory_items', label: 'INVENTORY' }
});

function httpError(message, statusCode, reasonCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  return err;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normType(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!RESOURCE_TYPES[key]) {
    throw httpError('resourceType must be ASSET or INVENTORY', 400, 'INVALID_TYPE');
  }
  return key;
}

function trimId(value) {
  const text = String(value || '').trim();
  if (!text) throw httpError('resourceId is required', 400, 'MISSING_ID');
  return text;
}

function pickHoldingFields(row, resourceType) {
  return {
    id: row.id,
    name: row.itemname || row.ItemName || null,
    status: row.status || null,
    location: row.currentlocation || row.CurrentLocation || null,
    assignedTo: row.assignedto || row.AssignedTo || null,
    sentAgainstDc: row.sentagainstdc || row.SentAgainstDC || null,
    productId: row.product_id || row.ProductId || null,
    quantityUnit: row.quantity_unit || row.QuantityUnit || null,
    quantityPrecision: row.quantity_precision == null ? null : Number(row.quantity_precision),
    isQuantityTracked: !!(row.is_quantity_tracked === 1 || row.IsQuantityTracked === 1 || row.quantity_unit),
    resourceType
  };
}

function quantityBuckets(row) {
  const total = qtyNum(row.quantity_total);
  const available = qtyNum(row.quantity_available);
  const reserved = qtyNum(row.quantity_reserved);
  const converted = qtyNum(row.quantity_converted);
  const inUse = Math.max(0, total - available);
  // Residual after known ledger buckets (reserved/converted usually already reduce available).
  // When total was raised without raising available, residualUnexplained > 0 with empty placements.
  const residualUnexplained = Math.max(0, total - available - reserved - converted);
  return {
    total,
    available,
    reserved,
    converted,
    inUse,
    residualUnexplained,
    unit: row.quantity_unit || null
  };
}

async function loadPurchaseBookPhysicalPlacements(resourceType, resourceId) {
  if (!(await db.schema.hasTable('purchase_book_physical'))) return [];
  const rows = await db('purchase_book_physical as p')
    .leftJoin('purchase_book as b', 'b.id', 'p.purchase_book_id')
    .leftJoin('purchase_book_line as l', 'l.id', 'p.purchase_book_line_id')
    .where({
      'p.resource_type': resourceType,
      'p.status': 'ACTIVE'
    })
    .whereRaw('LOWER(p.resource_id) = LOWER(?)', [resourceId])
    .select(
      'p.id',
      'p.purchase_book_id',
      'p.purchase_book_line_id',
      'p.serial_sort_order',
      'p.qty_allocated',
      'b.vendor_invoice_no',
      'l.display_name'
    );
  const out = [];
  for (const r of rows) {
    let serialValue = null;
    if (r.serial_sort_order != null && (await db.schema.hasTable('serial_identity'))) {
      const sn = await db('serial_identity')
        .where({
          resource_type: resourceType,
          resource_id: resourceId,
          sort_order: r.serial_sort_order
        })
        .first();
      serialValue = sn ? sn.serial_value : null;
    }
    out.push({
      kind: 'PURCHASE_BOOK',
      label: r.vendor_invoice_no || r.purchase_book_id,
      detail: [
        r.display_name || r.purchase_book_line_id,
        serialValue ? `SN ${serialValue}` : (r.serial_sort_order != null ? `serial #${r.serial_sort_order}` : 'whole holding'),
        `qty ${qtyNum(r.qty_allocated)}`
      ].filter(Boolean).join(' · '),
      purchaseBookId: r.purchase_book_id,
      quantity: qtyNum(r.qty_allocated)
    });
  }
  return out;
}

async function loadRecentQuantityEvents(resourceType, resourceId) {
  const table = resourceType === 'INVENTORY' ? 'inventory_quantity_events' : 'quantity_events';
  const lineTable = resourceType === 'INVENTORY' ? 'inventory_quantity_event_lines' : 'quantity_event_lines';
  const itemCol = resourceType === 'INVENTORY' ? 'item_id' : 'asset_id';
  if (!(await db.schema.hasTable(table)) || !(await db.schema.hasTable(lineTable))) return [];
  try {
    const rows = await db(`${table} as e`)
      .leftJoin(`${lineTable} as l`, 'l.event_id', 'e.id')
      .where(function () {
        this.where('e.root_id', resourceId).orWhere(`l.${itemCol}`, resourceId);
      })
      .orderBy('e.id', 'desc')
      .limit(12)
      .select(
        'e.id',
        'e.type',
        'e.actor',
        'e.timestamp',
        'e.note',
        'l.delta_available',
        'l.delta_total'
      );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor,
      when: r.timestamp,
      note: r.note,
      deltaAvailable: qtyNum(r.delta_available),
      deltaTotal: qtyNum(r.delta_total)
    }));
  } catch (_) {
    return [];
  }
}

function buildLedgerExplanation(quantity, placements, recentEvents) {
  const unexplained = qtyNum(quantity.residualUnexplained);
  const placementQty = (placements || []).reduce((sum, p) => sum + qtyNum(p.quantity), 0);
  const reasons = [];
  if (qtyNum(quantity.reserved) > 0) {
    reasons.push({
      kind: 'RESERVED',
      label: `${quantity.reserved} reserved`,
      detail: 'Held by active reservations'
    });
  }
  if (qtyNum(quantity.converted) > 0) {
    reasons.push({
      kind: 'CONVERTED',
      label: `${quantity.converted} converted`,
      detail: 'Moved via inventory↔asset conversion'
    });
  }
  for (const p of placements || []) {
    if (p.kind === 'RESERVATION' || p.kind === 'PURCHASE_BOOK' || p.kind === 'DC' || p.kind === 'SET' || p.kind === 'PROJECT' || p.kind === 'ASSIGNED') {
      reasons.push({
        kind: p.kind,
        label: p.label,
        detail: p.detail,
        quantity: p.quantity
      });
    }
  }
  // Detect total↑ without available↑ in recent events
  const adjustGaps = (recentEvents || []).filter(
    (ev) => qtyNum(ev.deltaTotal) > 0 && qtyNum(ev.deltaAvailable) === 0
  );
  if (unexplained > 0 && adjustGaps.length) {
    const totalGap = adjustGaps.reduce((s, ev) => s + qtyNum(ev.deltaTotal), 0);
    reasons.push({
      kind: 'LEDGER_GAP',
      label: `${Math.min(unexplained, totalGap) || unexplained} from quantity adjusts (total ↑, available unchanged)`,
      detail: adjustGaps
        .slice(0, 4)
        .map((ev) => `${ev.type}: +${ev.deltaTotal} total / +${ev.deltaAvailable} avail${ev.note ? ` · ${ev.note}` : ''}`)
        .join('; '),
      quantity: unexplained
    });
  } else if (unexplained > 0 && placementQty + qtyNum(quantity.reserved) + qtyNum(quantity.converted) < unexplained - 1e-9) {
    reasons.push({
      kind: 'LEDGER_GAP',
      label: `${unexplained} not explained by placements`,
      detail: 'Total exceeds available + reserved + converted with no matching project/DC/reservation/book link. Check Quantity History for ADJUST events.',
      quantity: unexplained
    });
  }
  return {
    unexplained,
    placementQty,
    reasons
  };
}

async function loadProjectsForAsset(assetId) {
  const hasTable = await db.schema.hasTable('project_assets');
  if (!hasTable) return [];
  const rows = await db('project_assets as pa')
    .leftJoin('projects as p', 'pa.projectid', 'p.id')
    .whereRaw('LOWER(pa.assetid) = LOWER(?)', [assetId])
    .select(
      'pa.projectid as projectId',
      'pa.type as linkType',
      'pa.assigneddate as assignedDate',
      'p.projectname as projectName',
      'p.status as projectStatus'
    );
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName || r.projectId,
    projectStatus: r.projectStatus || null,
    linkType: r.linkType || null,
    assignedDate: r.assignedDate || null
  }));
}

async function enrichReservationOwners(reservations) {
  const enriched = [];
  for (const r of reservations) {
    const item = { ...r, ownerLabel: `${r.ownerType} ${r.ownerId}` };
    try {
      if (r.ownerType === 'PROJECT') {
        const p = await db('projects').whereRaw('LOWER(id) = LOWER(?)', [r.ownerId]).select('id', 'projectname').first();
        if (p) item.ownerLabel = p.projectname || p.id;
      } else if (r.ownerType === 'SET' && (await db.schema.hasTable('managed_sets'))) {
        const s = await db('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [r.ownerId]).select('id', 'name', 'set_code').first();
        if (s) item.ownerLabel = s.name || s.set_code || s.id;
      } else if (r.ownerType === 'DC') {
        item.ownerLabel = `DC ${r.ownerId}`;
      }
    } catch (_) {
      /* keep fallback label */
    }
    enriched.push(item);
  }
  return enriched;
}

async function resolveHoldingRow(typeHint, id) {
  const hint = String(typeHint || 'ASSET').trim().toUpperCase();
  const tables = hint === 'INVENTORY'
    ? ['inventory_items', 'assets', 'components']
    : ['assets', 'components', 'inventory_items'];

  for (const table of tables) {
    if (!(await db.schema.hasTable(table))) continue;
    const row = await db(table).whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    if (row) {
      return {
        row,
        table,
        detectedType: table === 'inventory_items' ? 'INVENTORY' : 'ASSET'
      };
    }
  }
  return null;
}

function buildPlacements(holding, projects, managedSet, activeReservations) {
  const placements = [];
  if (holding.assignedTo) {
    placements.push({ kind: 'ASSIGNED', label: holding.assignedTo, detail: 'Assigned to person/team' });
  }
  if (holding.sentAgainstDc) {
    placements.push({ kind: 'DC', label: holding.sentAgainstDc, detail: 'Sent against Delivery Challan' });
  }
  for (const p of projects) {
    placements.push({
      kind: 'PROJECT',
      label: p.projectName,
      detail: p.projectId,
      projectId: p.projectId,
      linkType: p.linkType
    });
  }
  if (managedSet || holding.managedSet) {
    const ms = managedSet || holding.managedSet;
    placements.push({
      kind: 'SET',
      label: ms.name || ms.set_code || ms.id,
      detail: ms.id || ms.set_code
    });
  }
  for (const r of activeReservations) {
    placements.push({
      kind: 'RESERVATION',
      label: r.ownerLabel || `${r.ownerType} ${r.ownerId}`,
      detail: `${r.quantity} reserved · ${r.id}`,
      reservationId: r.id,
      quantity: r.quantity,
      ownerType: r.ownerType,
      ownerId: r.ownerId
    });
  }
  return placements;
}

/**
 * @param {'ASSET'|'INVENTORY'} resourceType
 * @param {string} resourceId
 */
async function getUsageSnapshot(resourceType, resourceId) {
  normType(resourceType);
  const id = trimId(resourceId);
  const resolved = await resolveHoldingRow(resourceType, id);
  if (!resolved) {
    throw httpError(`${String(resourceType).toUpperCase()} ${id} not found`, 404, 'NOT_FOUND');
  }

  const { row, detectedType: type } = resolved;
  let holding = pickHoldingFields(row, type);
  const quantity = quantityBuckets(row);

  let managedSet = null;
  try {
    if (type === 'ASSET') {
      const [wrapped] = await kitSetService.attachManagedSetToAssets([{ ...row, id: row.id }]);
      managedSet = wrapped?.managedSet || wrapped?.ManagedSet || null;
      if (wrapped) holding = { ...holding, managedSet };
    } else {
      const [wrapped] = await kitSetService.attachManagedSetToInventory([{ ...row, id: row.id }]);
      managedSet = wrapped?.managedSet || wrapped?.ManagedSet || null;
      if (wrapped) holding = { ...holding, managedSet };
    }
  } catch (_) {
    /* optional */
  }

  const projects = type === 'ASSET' ? await loadProjectsForAsset(id) : [];

  let reservations = [];
  let activeReservations = [];
  try {
    if (await reservationService.tablesReady()) {
      const listed = await reservationService.listForResource(type, id);
      reservations = listed.reservations || [];
      activeReservations = await enrichReservationOwners(
        reservations.filter((r) => String(r.status || '').toUpperCase() === 'ACTIVE')
      );
    }
  } catch (_) {
    reservations = [];
    activeReservations = [];
  }

  const placements = buildPlacements(holding, projects, managedSet, activeReservations);
  let bookPlacements = [];
  try {
    bookPlacements = await loadPurchaseBookPhysicalPlacements(type, id);
    placements.push(...bookPlacements);
  } catch (_) { /* optional */ }

  let recentEvents = [];
  try {
    recentEvents = await loadRecentQuantityEvents(type, id);
  } catch (_) { /* optional */ }

  const explanation = buildLedgerExplanation(quantity, placements, recentEvents);

  return {
    resourceType: type,
    resourceId: id,
    holding,
    quantity,
    placements,
    explanation,
    recentEvents: recentEvents.slice(0, 8),
    projects,
    reservations: {
      active: activeReservations,
      allCount: reservations.length
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  getUsageSnapshot,
  RESOURCE_TYPES
};
