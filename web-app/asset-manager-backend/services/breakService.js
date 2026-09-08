/**
 * Phase 2 Break engine.
 *
 * Intra-domain quantity lineage only. Does not call make-set / break-set,
 * does not write parentid, does not parse manufacturer serials.
 */
const qrcode = require('qrcode');
const { db, generateModernAssetId } = require('../utils');
const reservationService = require('./reservationService');

const HOLDING = {
  ASSET: { table: 'assets', domain: 'ASSET', publicPath: 'asset' },
  INVENTORY: { table: 'inventory_items', domain: 'INVENTORY', publicPath: 'inventory' }
};

const ID_RE = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{4}-[A-Z0-9]{6}-[A-Z0-9]$/;

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError('Invalid quantity value', 400);
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

function holdingConfig(holdingType) {
  const key = String(holdingType || '').trim().toUpperCase();
  const cfg = HOLDING[key];
  if (!cfg) throw httpError('holdingType must be ASSET or INVENTORY', 400);
  return cfg;
}

function clientLabelFromId(id) {
  const parts = String(id || '').split('-');
  return `${parts[0] || 'AST'}-${parts[1] || 'LOC'}-${parts[3] || '000000'}`;
}

function requestHost(host) {
  const value = String(host || '').trim();
  if (!value) throw httpError('Host is required to generate a QR', 400);
  return value.replace(/^https?:\/\//i, '');
}

async function buildQrDataUrl(host, publicPath, id) {
  const urlText = `http://${requestHost(host)}/${publicPath}/${encodeURIComponent(id)}`;
  return qrcode.toDataURL(urlText, { width: 512, margin: 2 });
}

async function uniqueModernId(trx, table, location, type) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateModernAssetId(location || 'Mumbai', type || 'GEN');
    if (!ID_RE.test(id) || /-NaN$/i.test(id)) {
      throw httpError(`ID generator produced a non-canonical id: ${id}`, 500);
    }
    const existing = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique AssetEngine ID', 500);
}

async function loadRow(trx, table, id, { forUpdate = false } = {}) {
  let q = trx(table).whereRaw('LOWER(id) = LOWER(?)', [String(id || '').trim()]);
  if (forUpdate) q = q.forUpdate();
  const row = await q.first();
  if (!row) throw httpError(`${table} ${id} not found`, 404);
  return row;
}

async function assertConservation(trx, table, rootId, precision) {
  const root = await loadRow(trx, table, rootId);
  if (root.quantity_original == null) {
    throw httpError(`Root ${rootId} is missing quantity_original`, 500);
  }
  const hasReserved = await trx.schema.hasColumn(table, 'quantity_reserved');
  const hasConverted = await trx.schema.hasColumn(table, 'quantity_converted');
  const cols = ['id', 'quantity_total', 'quantity_available', 'lineage_status'];
  if (hasReserved) cols.push('quantity_reserved');
  if (hasConverted) cols.push('quantity_converted');
  const tree = await trx(table)
    .whereRaw('LOWER(quantity_root_id) = LOWER(?)', [rootId])
    .select(cols);
  const active = tree.filter((row) => String(row.lineage_status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  const sum = active.reduce((acc, row) => acc + qtyNum(row.quantity_total), 0);
  const convertedSum = hasConverted
    ? tree.reduce((acc, row) => acc + qtyNum(row.quantity_converted), 0)
    : 0;
  if (!qtyEq(root.quantity_original, sum + convertedSum, precision)) {
    throw httpError(
      `Conservation failed for ${rootId}: original ${root.quantity_original} != active sum ${sum} + converted ${convertedSum}`,
      500
    );
  }
  for (const row of active) {
    const total = qtyNum(row.quantity_total);
    const available = qtyNum(row.quantity_available);
    const reserved = hasReserved ? qtyNum(row.quantity_reserved) : 0;
    if (available < 0 || total < 0 || reserved < 0 || available - total > 1e-9) {
      throw httpError(
        `Quantity bounds failed for ${row.id}: available ${available} / total ${total}`,
        500
      );
    }
    if (hasReserved && available + reserved - total > 1e-9) {
      throw httpError(
        `Quantity bounds failed for ${row.id}: available ${available} + reserved ${reserved} > total ${total}`,
        500
      );
    }
  }
}

async function applyNumericDelta(trx, table, id, deltaTotal, deltaAvailable, precision) {
  const p = declaredPrecision({ quantity_precision: precision });
  const result = await trx.raw(
    `
      UPDATE ${table}
      SET quantity_total = ROUND((COALESCE(quantity_total, 0)::numeric + ?::numeric), ?),
          quantity_available = ROUND((COALESCE(quantity_available, 0)::numeric + ?::numeric), ?),
          quantity_updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(id) = LOWER(?)
      RETURNING id, quantity_total, quantity_available
    `,
    [deltaTotal, p, deltaAvailable, p, id]
  );
  const row = result.rows && result.rows[0];
  if (!row) throw httpError(`Failed to update quantity on ${id}`, 500);
  if (qtyNum(row.quantity_available) < 0 || qtyNum(row.quantity_total) < 0) {
    throw httpError('Quantity would become negative', 400);
  }
  if (qtyNum(row.quantity_available) - qtyNum(row.quantity_total) > 1e-9) {
    throw httpError('Available quantity cannot exceed total', 400);
  }
  return row;
}

async function writeAssetHistory(trx, assetId, action, oldValue, newValue, actor, details) {
  await trx('asset_history').insert({
    assetid: assetId,
    action,
    oldvalue: oldValue == null ? null : String(oldValue),
    newvalue: newValue == null ? null : String(newValue),
    user: actor || 'web',
    timestamp: new Date().toISOString(),
    details: details || ''
  });
}

async function writeQuantityEvent(trx, { table, rootId, type, actor, note, metadata, lines }) {
  const now = new Date().toISOString();
  const isAsset = table === 'assets';
  const eventTable = isAsset ? 'quantity_events' : 'inventory_quantity_events';
  const lineTable = isAsset ? 'quantity_event_lines' : 'inventory_quantity_event_lines';
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
  if (eventId && Array.isArray(lines) && lines.length) {
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

function childAssetFields(parent, childId, qty, qrDataUrl, now) {
  return {
    id: childId,
    itemname: parent.itemname,
    itemdescription: parent.itemdescription || '',
    status: parent.status || 'In Store',
    make: parent.make || '',
    model: parent.model || '',
    srno: '',
    type: parent.type || '',
    category: parent.category || '',
    icon: parent.icon || '',
    isplaceholder: 0,
    parentid: null,
    currentlocation: parent.currentlocation || '',
    dispatchreceivedt: parent.dispatchreceivedt || null,
    purchasedetails: parent.purchasedetails || '',
    remarks: parent.remarks || '',
    purpose: parent.purpose || parent.Purpose || 'Owned',
    lastupdated: now,
    qrcode: qrDataUrl,
    assignedto: '',
    client_label: clientLabelFromId(childId),
    noqr: 0,
    company_id: parent.company_id || null,
    currency: parent.currency || 'INR',
    asset_value: 0,
    is_quantity_tracked: 1,
    is_batch: 0,
    is_set: 0,
    quantity_unit: parent.quantity_unit || 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_precision: parent.quantity_precision || 0,
    quantity_parent_id: parent.id,
    quantity_root_id: parent.quantity_root_id || parent.id,
    quantity_original: null,
    lineage_status: 'ACTIVE',
    product_id: parent.product_id || null,
    conversion_unit: parent.conversion_unit || null,
    conversion_factor: parent.conversion_factor || null,
    conversion_mode: parent.conversion_mode || null,
    quantity_reserved: 0,
    quantity_converted: 0,
    conversion_source_type: parent.conversion_source_type || null,
    conversion_source_id: parent.conversion_source_id || null,
    conversion_root_type: parent.conversion_root_type || null,
    conversion_root_id: parent.conversion_root_id || null,
    conversion_id: parent.conversion_id || null,
    quantity_updated_at: now
  };
}

function childInventoryFields(parent, childId, qty, qrDataUrl, now) {
  return {
    id: childId,
    itemname: parent.itemname,
    itemdescription: parent.itemdescription || '',
    icon: parent.icon || '📦',
    status: parent.status || 'In Store',
    make: parent.make || '',
    model: parent.model || '',
    srno: null,
    type: parent.type || '',
    category: parent.category || '',
    parentid: null,
    folderid: parent.folderid,
    kindid: parent.kindid,
    currentlocation: parent.currentlocation || '',
    lastupdated: now,
    qrcode: qrDataUrl,
    client_label: clientLabelFromId(childId),
    noqr: 0,
    quantity_total: qty,
    quantity_available: qty,
    quantity_precision: parent.quantity_precision || 0,
    is_quantity_tracked: 1,
    quantity_unit: parent.quantity_unit || 'Nos',
    is_batch: 0,
    is_set: 0,
    quantity_parent_id: parent.id,
    quantity_root_id: parent.quantity_root_id || parent.id,
    quantity_original: null,
    lineage_status: 'ACTIVE',
    product_id: parent.product_id || null,
    conversion_unit: parent.conversion_unit || null,
    conversion_factor: parent.conversion_factor || null,
    conversion_mode: parent.conversion_mode || null,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_updated_at: now
  };
}

function normalizeChildrenSpec(mode, amount, children, precision) {
  const roundedAmount = roundQty(amount, precision);
  if (!(roundedAmount > 0)) throw httpError('Break amount must be greater than zero', 400);

  if (String(mode).toUpperCase() === 'MAKE_INDIVIDUAL') {
    if (!qtyEq(roundedAmount, Math.round(roundedAmount), precision)) {
      throw httpError('Make Individual amount must be a whole number of units', 400);
    }
    const count = Math.round(roundedAmount);
    return Array.from({ length: count }, () => roundQty(1, precision));
  }

  if (Array.isArray(children) && children.length) {
    const qtys = children.map((c) => roundQty(c.quantity ?? c.qty ?? c.amount, precision));
    if (qtys.some((q) => !(q > 0))) throw httpError('Each child quantity must be greater than zero', 400);
    const sum = roundQty(qtys.reduce((a, b) => a + b, 0), precision);
    if (!qtyEq(sum, roundedAmount, precision)) {
      throw httpError(`Child quantities (${sum}) must equal break amount (${roundedAmount})`, 400);
    }
    return qtys;
  }

  return [roundedAmount];
}

async function breakQuantity({
  holdingType,
  parentId,
  mode = 'BREAK',
  amount,
  children,
  actor,
  host,
  trx: externalTrx
} = {}) {
  const cfg = holdingConfig(holdingType);
  const run = async (trx) => {
    const parent = await loadRow(trx, cfg.table, parentId, { forUpdate: true });
    if (Number(parent.is_quantity_tracked) !== 1) {
      throw httpError('Parent is not quantity-tracked', 400);
    }
    if (String(parent.lineage_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      throw httpError('Inactive records cannot be broken', 400);
    }
    if (!parent.quantity_root_id) {
      throw httpError('Parent is missing quantity_root_id; repair roots before Break', 400);
    }

    const precision = declaredPrecision(parent);
    const childQtys = normalizeChildrenSpec(mode, amount, children, precision);
    const totalAmount = roundQty(childQtys.reduce((a, b) => a + b, 0), precision);
    const available = roundQty(parent.quantity_available, precision);
    if (totalAmount - available > 1e-9) {
      throw httpError(
        `Child quantity ${totalAmount} exceeds parent available ${available}`,
        400
      );
    }

    const created = [];
    const now = new Date().toISOString();
    const eventLines = [
      {
        id: parent.id,
        unit: parent.quantity_unit,
        deltaTotal: -totalAmount,
        deltaAvailable: -totalAmount
      }
    ];

    await applyNumericDelta(trx, cfg.table, parent.id, -totalAmount, -totalAmount, precision);

    for (const qty of childQtys) {
      const childId = await uniqueModernId(
        trx,
        cfg.table,
        parent.currentlocation || parent.CurrentLocation,
        parent.type || parent.Type
      );
      const qrDataUrl = await buildQrDataUrl(host, cfg.publicPath, childId);
      const fields = cfg.table === 'assets'
        ? childAssetFields(parent, childId, qty, qrDataUrl, now)
        : childInventoryFields(parent, childId, qty, qrDataUrl, now);
      await trx(cfg.table).insert(fields);
      created.push({
        id: childId,
        quantity_total: qty,
        quantity_available: qty,
        product_id: parent.product_id || null,
        quantity_parent_id: parent.id,
        quantity_root_id: parent.quantity_root_id || parent.id,
        qrcode: true
      });
      eventLines.push({
        id: childId,
        unit: parent.quantity_unit,
        deltaTotal: qty,
        deltaAvailable: qty
      });
      if (cfg.table === 'assets') {
        await writeAssetHistory(
          trx,
          childId,
          'BREAK_CHILD_CREATED',
          null,
          String(qty),
          actor,
          `Separated ${qty} ${parent.quantity_unit || ''} from ${parent.id}`
        );
      }
    }

    if (cfg.table === 'assets') {
      await writeAssetHistory(
        trx,
        parent.id,
        'BREAK_PARENT_UPDATED',
        String(parent.quantity_total),
        String(roundQty(qtyNum(parent.quantity_total) - totalAmount, precision)),
        actor,
        `Broke ${totalAmount} ${parent.quantity_unit || ''} into ${created.length} child record(s)`
      );
    }

    await writeQuantityEvent(trx, {
      table: cfg.table,
      rootId: parent.quantity_root_id || parent.id,
      type: 'BREAK',
      actor,
      note: `${mode} ${totalAmount} from ${parent.id}`,
      metadata: {
        mode: String(mode).toUpperCase(),
        parent_id: parent.id,
        child_ids: created.map((c) => c.id)
      },
      lines: eventLines
    });

    await assertConservation(trx, cfg.table, parent.quantity_root_id || parent.id, precision);

    const updatedParent = await loadRow(trx, cfg.table, parent.id);
    return {
      parent: {
        id: updatedParent.id,
        quantity_total: updatedParent.quantity_total,
        quantity_available: updatedParent.quantity_available,
        quantity_original: updatedParent.quantity_original,
        quantity_root_id: updatedParent.quantity_root_id,
        product_id: updatedParent.product_id || null,
        parentid: updatedParent.parentid || null
      },
      children: created
    };
  };

  if (externalTrx) return run(externalTrx);
  return db.transaction(run);
}

async function inactivateChild({ holdingType, childId, actor, trx: externalTrx } = {}) {
  const cfg = holdingConfig(holdingType);
  const run = async (trx) => {
    const child = await loadRow(trx, cfg.table, childId, { forUpdate: true });
    if (!child.quantity_parent_id) {
      throw httpError('Only Break children can be inactivated', 400);
    }
    if (String(child.lineage_status || 'ACTIVE').toUpperCase() === 'INACTIVE') {
      throw httpError('Child is already inactive', 400);
    }
    await reservationService.assertNoActiveReservations(cfg.domain, child.id, trx);
    const conversionService = require('./conversionService');
    await conversionService.assertNoUnreturnedConversions(cfg.domain, child.id, trx);
    const descendants = await trx(cfg.table)
      .whereRaw('LOWER(quantity_parent_id) = LOWER(?)', [child.id])
      .andWhere('lineage_status', 'ACTIVE')
      .select('id');
    if (descendants.length) {
      throw httpError(
        `Child ${child.id} has active descendants; inactivate or break those first`,
        409
      );
    }

    const parent = await loadRow(trx, cfg.table, child.quantity_parent_id, { forUpdate: true });
    const precision = declaredPrecision(parent);
    const restore = roundQty(child.quantity_total, precision);

    await trx(cfg.table)
      .whereRaw('LOWER(id) = LOWER(?)', [child.id])
      .update({
        lineage_status: 'INACTIVE',
        lastupdated: new Date().toISOString()
      });

    await applyNumericDelta(trx, cfg.table, parent.id, restore, restore, precision);

    await writeQuantityEvent(trx, {
      table: cfg.table,
      rootId: child.quantity_root_id || parent.quantity_root_id || parent.id,
      type: 'BREAK_INACTIVATE',
      actor,
      note: `Inactivated ${child.id}; restored ${restore} to ${parent.id}`,
      metadata: { child_id: child.id, parent_id: parent.id },
      lines: [
        { id: parent.id, unit: parent.quantity_unit, deltaTotal: restore, deltaAvailable: restore },
        { id: child.id, unit: child.quantity_unit, deltaTotal: 0, deltaAvailable: 0 }
      ]
    });

    if (cfg.table === 'assets') {
      await writeAssetHistory(
        trx,
        child.id,
        'BREAK_CHILD_INACTIVATED',
        'ACTIVE',
        'INACTIVE',
        actor,
        `Restored ${restore} ${child.quantity_unit || ''} to ${parent.id}`
      );
      await writeAssetHistory(
        trx,
        parent.id,
        'BREAK_PARENT_RESTORED',
        String(parent.quantity_total),
        String(roundQty(qtyNum(parent.quantity_total) + restore, precision)),
        actor,
        `Restored ${restore} from inactive child ${child.id}`
      );
    }

    await assertConservation(
      trx,
      cfg.table,
      child.quantity_root_id || parent.quantity_root_id || parent.id,
      precision
    );

    const updatedParent = await loadRow(trx, cfg.table, parent.id);
    const updatedChild = await loadRow(trx, cfg.table, child.id);
    return {
      parent: {
        id: updatedParent.id,
        quantity_total: updatedParent.quantity_total,
        quantity_available: updatedParent.quantity_available
      },
      child: {
        id: updatedChild.id,
        lineage_status: updatedChild.lineage_status,
        quantity_total: updatedChild.quantity_total,
        qrcode: Boolean(updatedChild.qrcode)
      }
    };
  };

  if (externalTrx) return run(externalTrx);
  return db.transaction(run);
}

async function getLineageTree(holdingType, id) {
  const cfg = holdingConfig(holdingType);
  const row = await loadRow(db, cfg.table, id);
  const children = await db(cfg.table)
    .whereRaw('LOWER(quantity_parent_id) = LOWER(?)', [row.id])
    .orderBy('id');
  return {
    holdingType: cfg.domain,
    record: {
      id: row.id,
      itemname: row.itemname,
      lineage_status: row.lineage_status || 'ACTIVE',
      quantity_total: row.quantity_total,
      quantity_available: row.quantity_available,
      quantity_reserved: row.quantity_reserved == null ? 0 : row.quantity_reserved,
      quantity_converted: row.quantity_converted == null ? 0 : row.quantity_converted,
      quantity_original: row.quantity_original,
      quantity_unit: row.quantity_unit,
      quantity_parent_id: row.quantity_parent_id || null,
      quantity_root_id: row.quantity_root_id || null,
      product_id: row.product_id || null,
      conversion_source_id: row.conversion_source_id || null,
      conversion_id: row.conversion_id || null,
      parentid: row.parentid || null,
      is_set: Number(row.is_set || 0),
      is_quantity_tracked: Number(row.is_quantity_tracked || 0),
      qrcode: Boolean(row.qrcode),
      client_label: row.client_label || null
    },
    children: children.map((c) => ({
      id: c.id,
      itemname: c.itemname,
      lineage_status: c.lineage_status || 'ACTIVE',
      quantity_total: c.quantity_total,
      quantity_available: c.quantity_available,
      product_id: c.product_id || null,
      qrcode: Boolean(c.qrcode)
    }))
  };
}

module.exports = {
  breakQuantity,
  inactivateChild,
  getLineageTree,
  assertConservation,
  buildQrDataUrl,
  clientLabelFromId,
  qtyNum,
  roundQty,
  qtyEq,
  ID_RE
};
