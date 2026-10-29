/**
 * Vendor Purchase Return (PRTN-…) — physical outbound to OEM/vendor.
 *
 * OPEN / READY → no stock effect
 * DISPATCHED → ownership exit (Asset retired / Inventory qty reduced via lineage)
 *
 * Distinct from customer Return Inward (RET- / RETURN_INWARD RN).
 */
const {
  db,
  generateVendorReturnId,
  verifyVendorReturnId,
  generateVendorReturnLineId,
  verifyVendorReturnLineId
} = require('../utils');
const reservationService = require('./reservationService');
const procurementReconciliationService = require('./procurementReconciliationService');

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function qtyNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(v, precision = 6) {
  const p = Math.min(6, Math.max(0, parseInt(precision, 10) || 0));
  const n = qtyNum(v);
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function trimText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) throw httpError(`Non-canonical ${label} id: ${id}`, 500);
    if (!(await trx(table).where({ id }).first())) return id;
  }
  throw httpError(`Could not allocate ${label} ID`, 500);
}

function publicVendorReturn(row, lines = []) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    procurementPoId: row.procurement_po_id,
    procurementReconciliationId: row.procurement_reconciliation_id,
    vendorName: row.vendor_name,
    vendorZohoId: row.vendor_zoho_id,
    returnReason: row.return_reason,
    notes: row.notes,
    createdBy: row.created_by,
    readyAt: row.ready_at,
    readyBy: row.ready_by,
    dispatchedAt: row.dispatched_at,
    dispatchedBy: row.dispatched_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    createdAt: row.created_at,
    lines: lines.map((l) => ({
      id: l.id,
      procurementPoLineId: l.procurement_po_line_id,
      procurementReconciliationId: l.procurement_reconciliation_id,
      receiptNoteId: l.receipt_note_id,
      receiptLineId: l.receipt_line_id,
      productId: l.product_id,
      resourceType: l.resource_type,
      resourceId: l.resource_id,
      quantity: qtyNum(l.quantity),
      serialSnapshot: l.serial_snapshot
    }))
  };
}

async function schemaReady() {
  return db.schema.hasTable('vendor_return');
}

async function getVendorReturn(id) {
  if (!(await schemaReady())) throw httpError('Schema pending', 503, 'SCHEMA_PENDING');
  const row = await db('vendor_return').where({ id: String(id).trim() }).first();
  if (!row) throw httpError('Vendor Return not found', 404, 'NOT_FOUND');
  const lines = await db('vendor_return_line').where({ vendor_return_id: row.id });
  return publicVendorReturn(row, lines);
}

async function listVendorReturns(filters = {}) {
  if (!(await schemaReady())) return { vendorReturns: [] };
  let q = db('vendor_return').orderBy('created_at', 'desc');
  if (filters.status) q = q.andWhere('status', String(filters.status).toUpperCase());
  if (filters.poId) q = q.andWhere('procurement_po_id', String(filters.poId));
  if (filters.reconciliationId) q = q.andWhere('procurement_reconciliation_id', String(filters.reconciliationId));
  const rows = await q.limit(Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50)));
  const out = [];
  for (const row of rows) {
    const lines = await db('vendor_return_line').where({ vendor_return_id: row.id });
    out.push(publicVendorReturn(row, lines));
  }
  return { vendorReturns: out };
}

/**
 * Eligible physical holdings born from POSTED purchase RNs for a PO line.
 */
async function listEligibleHoldings(poLineId) {
  const lineId = String(poLineId || '').trim();
  if (!lineId) throw httpError('poLineId required', 400);
  const outputs = await db('receipt_physical_output as o')
    .join('receipt_note_line as l', 'l.id', 'o.receipt_line_id')
    .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
    .where('l.po_line_id', lineId)
    .where('n.status', 'POSTED')
    .where(function () {
      this.whereNull('n.inward_kind').orWhere('n.inward_kind', 'PURCHASE_INWARD');
    })
    .select(
      'o.resource_type',
      'o.resource_id',
      'o.quantity',
      'o.receipt_note_id',
      'o.receipt_line_id',
      'l.product_id'
    );
  const eligible = [];
  for (const o of outputs) {
    if (o.resource_type === 'ASSET') {
      const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [o.resource_id]).first();
      if (!asset) continue;
      if (Number(asset.is_retired) === 1) continue;
      if (['Sold', 'Returned to Vendor', 'Scraped', 'Consumed'].includes(String(asset.status))) continue;
      if (asset.sentagainstdc) continue; // on DC
      eligible.push({
        resourceType: 'ASSET',
        resourceId: asset.id,
        quantity: 1,
        serialSnapshot: trimText(asset.srno || asset.SrNo) || null,
        productId: o.product_id || asset.product_id,
        receiptNoteId: o.receipt_note_id,
        receiptLineId: o.receipt_line_id,
        status: asset.status
      });
    } else {
      const inv = await db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [o.resource_id]).first();
      if (!inv) continue;
      const avail = qtyNum(inv.quantity_available);
      if (avail <= 1e-9) continue;
      eligible.push({
        resourceType: 'INVENTORY',
        resourceId: inv.id,
        quantity: avail,
        serialSnapshot: null,
        productId: o.product_id || inv.product_id,
        receiptNoteId: o.receipt_note_id,
        receiptLineId: o.receipt_line_id,
        status: inv.status
      });
    }
  }
  return { holdings: eligible };
}

async function createVendorReturn(args = {}) {
  if (!(await schemaReady())) throw httpError('Schema pending', 503, 'SCHEMA_PENDING');
  const poId = trimText(args.procurementPoId || args.poId);
  const reconId = trimText(args.procurementReconciliationId || args.reconciliationId);
  const actor = trimText(args.actor) || 'web';
  const inputLines = Array.isArray(args.lines) ? args.lines : [];
  if (!poId) throw httpError('procurementPoId is required', 400, 'MISSING_PO');
  if (!inputLines.length) throw httpError('At least one return line is required', 400, 'EMPTY_RETURN');

  return db.transaction(async (trx) => {
    const po = await trx('procurement_po').where({ id: poId }).forUpdate().first();
    if (!po) throw httpError('Purchase Order not found', 404, 'NOT_FOUND');

    let recon = null;
    if (reconId) {
      recon = await trx('procurement_reconciliation').where({ id: reconId }).forUpdate().first();
      if (!recon) throw httpError('Reconciliation not found', 404, 'RECON_NOT_FOUND');
      if (recon.procurement_po_id !== poId) {
        throw httpError('Reconciliation does not belong to this PO', 409, 'RECON_PO_MISMATCH');
      }
      await procurementReconciliationService.markReturnPending(trx, recon.id, actor);
    }

    const prepared = [];
    let totalQty = 0;
    for (const raw of inputLines) {
      const resourceType = String(raw.resourceType || raw.resource_type || '').toUpperCase();
      const resourceId = trimText(raw.resourceId || raw.resource_id);
      const poLineId = trimText(raw.procurementPoLineId || raw.poLineId) || (recon && recon.procurement_po_line_id);
      if (!['ASSET', 'INVENTORY'].includes(resourceType) || !resourceId) {
        throw httpError('Each line needs resourceType and resourceId', 400, 'INVALID_LINE');
      }
      if (!poLineId) throw httpError('procurementPoLineId required on each line', 400, 'MISSING_PO_LINE');

      let qty = roundQty(raw.quantity != null ? raw.quantity : (resourceType === 'ASSET' ? 1 : 0));
      if (resourceType === 'ASSET') qty = 1;
      if (!(qty > 0)) throw httpError('Return quantity must be > 0', 400, 'INVALID_QUANTITY');

      if (resourceType === 'ASSET') {
        const asset = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [resourceId]).forUpdate().first();
        if (!asset) throw httpError(`Asset ${resourceId} not found`, 404, 'ASSET_NOT_FOUND');
        if (Number(asset.is_retired) === 1 || String(asset.status).toLowerCase() === 'sold') {
          throw httpError(`Asset ${resourceId} is sold/retired`, 409, 'ASSET_UNAVAILABLE');
        }
        if (String(asset.status) === 'Returned to Vendor') {
          throw httpError(`Asset ${resourceId} already returned to vendor`, 409, 'ALREADY_RETURNED');
        }
        if (asset.sentagainstdc) {
          throw httpError(`Asset ${resourceId} is on DC ${asset.sentagainstdc}`, 409, 'ASSET_ON_DC');
        }
        const activeVr = await trx('vendor_return_line as l')
          .join('vendor_return as v', 'v.id', 'l.vendor_return_id')
          .whereRaw('LOWER(l.resource_id) = LOWER(?)', [resourceId])
          .where('l.resource_type', 'ASSET')
          .whereIn('v.status', ['OPEN', 'READY'])
          .select('v.id as vendor_return_id')
          .first();
        if (activeVr) {
          throw httpError(
            `Asset ${resourceId} is already on active Vendor Return ${activeVr.vendor_return_id}`,
            409,
            'ASSET_ON_ACTIVE_VENDOR_RETURN'
          );
        }
        const markingSerial = await trx('physical_marking')
          .where({ holding_type: 'ASSET', holding_id: asset.id, status: 'ACTIVE' })
          .whereIn('kind', ['MANUFACTURER_SERIAL', 'SERIAL', 'OEM_SERIAL'])
          .orderBy('created_at', 'desc')
          .first()
          .catch(() => null);
        const expected = trimText(asset.srno || asset.SrNo || (markingSerial && markingSerial.value));
        const given = trimText(raw.serialNumber || raw.serialSnapshot || raw.srNo);
        if (expected && given && expected.toLowerCase() !== given.toLowerCase()) {
          throw httpError(
            `Serial mismatch for ${resourceId}: expected ${expected}, got ${given}`,
            409,
            'SERIAL_MISMATCH'
          );
        }
        if (expected && !given) {
          throw httpError(`Serial number required for ${resourceId}`, 400, 'SERIAL_REQUIRED');
        }
        // Must originate from a POSTED purchase RN on this PO line
        const birth = await trx('receipt_physical_output as o')
          .join('receipt_note_line as l', 'l.id', 'o.receipt_line_id')
          .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
          .whereRaw('LOWER(o.resource_id) = LOWER(?)', [resourceId])
          .where('l.po_line_id', poLineId)
          .where('n.status', 'POSTED')
          .first();
        if (!birth) {
          throw httpError(
            `Asset ${resourceId} was not received against PO line ${poLineId}`,
            409,
            'NOT_FROM_PO_LINE'
          );
        }
        prepared.push({
          poLineId,
          reconId: reconId || null,
          resourceType: 'ASSET',
          resourceId: asset.id,
          quantity: 1,
          serialSnapshot: expected || given,
          productId: trimText(raw.productId) || asset.product_id,
          receiptNoteId: birth.receipt_note_id,
          receiptLineId: birth.receipt_line_id,
          priorAssetStatus: asset.status
        });
      } else {
        const inv = await trx('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [resourceId]).forUpdate().first();
        if (!inv) throw httpError(`Inventory ${resourceId} not found`, 404, 'INVENTORY_NOT_FOUND');
        const avail = qtyNum(inv.quantity_available);
        if (qty - avail > 1e-9) {
          throw httpError(
            `Return ${qty} exceeds available ${avail} on ${resourceId}`,
            409,
            'INSUFFICIENT_AVAILABLE',
            { avail, qty }
          );
        }
        const birth = await trx('receipt_physical_output as o')
          .join('receipt_note_line as l', 'l.id', 'o.receipt_line_id')
          .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
          .whereRaw('LOWER(o.resource_id) = LOWER(?)', [resourceId])
          .where('l.po_line_id', poLineId)
          .where('n.status', 'POSTED')
          .first();
        if (!birth) {
          throw httpError(
            `Inventory ${resourceId} was not received against PO line ${poLineId}`,
            409,
            'NOT_FROM_PO_LINE'
          );
        }
        prepared.push({
          poLineId,
          reconId: reconId || null,
          resourceType: 'INVENTORY',
          resourceId: inv.id,
          quantity: qty,
          serialSnapshot: null,
          productId: trimText(raw.productId) || inv.product_id,
          receiptNoteId: birth.receipt_note_id,
          receiptLineId: birth.receipt_line_id,
          priorAssetStatus: null
        });
      }
      totalQty += qty;
    }

    if (recon) {
      const pending = await procurementReconciliationService.pendingVendorReturnQty(trx, recon.id);
      const openDiff = roundQty(
        Math.max(
          0,
          qtyNum(recon.physical_received_quantity)
            - qtyNum(recon.commercial_quantity)
            - qtyNum(recon.physically_returned_quantity)
            - qtyNum(recon.retained_quantity)
            - pending
        )
      );
      if (totalQty - openDiff > 1e-9) {
        throw httpError(
          `Vendor return qty ${totalQty} exceeds open difference ${openDiff}`,
          409,
          'OVER_RETURN',
          { totalQty, openDiff, pendingOpenVendorReturn: pending }
        );
      }
    }

    const vrId = await uniquePrefixedId(
      trx,
      'vendor_return',
      generateVendorReturnId,
      verifyVendorReturnId,
      'Vendor Return'
    );
    await trx('vendor_return').insert({
      id: vrId,
      status: 'OPEN',
      procurement_po_id: poId,
      procurement_reconciliation_id: reconId,
      vendor_name: po.vendor_name_snapshot || po.vendor_name || null,
      vendor_zoho_id: po.vendor_zoho_id || null,
      return_reason: trimText(args.returnReason) || 'COMMERCIAL_REVISION',
      notes: trimText(args.notes),
      created_by: actor,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    for (const prep of prepared) {
      const lineId = await uniquePrefixedId(
        trx,
        'vendor_return_line',
        generateVendorReturnLineId,
        verifyVendorReturnLineId,
        'Vendor Return Line'
      );
      await trx('vendor_return_line').insert({
        id: lineId,
        vendor_return_id: vrId,
        procurement_po_line_id: prep.poLineId,
        procurement_reconciliation_id: prep.reconId,
        receipt_note_id: prep.receiptNoteId,
        receipt_line_id: prep.receiptLineId,
        product_id: prep.productId,
        resource_type: prep.resourceType,
        resource_id: prep.resourceId,
        quantity: prep.quantity,
        serial_snapshot: prep.serialSnapshot,
        prior_asset_status: prep.priorAssetStatus,
        created_at: new Date().toISOString()
      });
    }

    const linesOut = await trx('vendor_return_line').where({ vendor_return_id: vrId });
    const rowOut = await trx('vendor_return').where({ id: vrId }).first();
    return publicVendorReturn(rowOut, linesOut);
  });
}

async function markReady(id, actor) {
  return db.transaction(async (trx) => {
    const row = await trx('vendor_return').where({ id }).forUpdate().first();
    if (!row) throw httpError('Vendor Return not found', 404, 'NOT_FOUND');
    if (String(row.status) === 'READY') {
      const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
      return publicVendorReturn(row, lines);
    }
    if (String(row.status) === 'DISPATCHED') {
      throw httpError('Vendor Return already DISPATCHED', 409, 'ALREADY_DISPATCHED');
    }
    if (String(row.status) === 'CANCELLED') {
      throw httpError('Cannot READY a CANCELLED Vendor Return', 409, 'CANCELLED');
    }
    if (String(row.status) !== 'OPEN') {
      throw httpError(`Vendor Return ${row.status} cannot be marked READY`, 409, 'INVALID_STATUS');
    }
    await trx('vendor_return').where({ id }).update({
      status: 'READY',
      ready_at: new Date().toISOString(),
      ready_by: actor || null,
      updated_at: new Date().toISOString()
    });
    const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
    return publicVendorReturn(await trx('vendor_return').where({ id }).first(), lines);
  });
}

async function cancel(id, actor, reason) {
  return db.transaction(async (trx) => {
    const row = await trx('vendor_return').where({ id }).forUpdate().first();
    if (!row) throw httpError('Vendor Return not found', 404, 'NOT_FOUND');
    if (String(row.status) === 'DISPATCHED') {
      throw httpError('Cannot cancel a DISPATCHED Vendor Return', 409, 'ALREADY_DISPATCHED');
    }
    if (String(row.status) === 'CANCELLED') {
      const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
      return publicVendorReturn(row, lines);
    }
    await trx('vendor_return').where({ id }).update({
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actor || null,
      notes: reason ? `${row.notes || ''}\nCancelled: ${reason}`.trim() : row.notes,
      updated_at: new Date().toISOString()
    });
    const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
    return publicVendorReturn(await trx('vendor_return').where({ id }).first(), lines);
  });
}

async function dispatch(id, actor) {
  return db.transaction(async (trx) => {
    const row = await trx('vendor_return').where({ id }).forUpdate().first();
    if (!row) throw httpError('Vendor Return not found', 404, 'NOT_FOUND');
    if (String(row.status) === 'DISPATCHED') {
      const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
      return publicVendorReturn(row, lines);
    }
    if (String(row.status) !== 'READY') {
      throw httpError('Vendor Return must be READY before DISPATCH', 409, 'NOT_READY');
    }
    const lines = await trx('vendor_return_line').where({ vendor_return_id: id });
    if (!lines.length) throw httpError('Vendor Return has no lines', 409, 'EMPTY_RETURN');

    const restoredByRecon = new Map();
    for (const line of lines) {
      const qty = roundQty(line.quantity);
      if (line.resource_type === 'ASSET') {
        const asset = await trx('assets').where({ id: line.resource_id }).forUpdate().first();
        if (!asset) throw httpError(`Asset ${line.resource_id} missing`, 404, 'ASSET_NOT_FOUND');
        if (Number(asset.is_retired) === 1 || String(asset.status) === 'Sold') {
          throw httpError(`Asset ${line.resource_id} unavailable`, 409, 'ASSET_UNAVAILABLE');
        }
        // Release any active reservation
        if (await trx.schema.hasTable('reservation')) {
          const rsv = await trx('reservation')
            .where({ resource_type: 'ASSET', status: 'ACTIVE' })
            .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
            .first();
          if (rsv) {
            await reservationService.release({
              trx,
              id: rsv.id,
              actor: actor || null,
              reason: `Vendor Return ${id}`
            });
          }
        }
        await trx('assets').where({ id: asset.id }).update({
          status: 'Returned to Vendor',
          is_retired: 1,
          sentagainstdc: null,
          lastupdated: new Date().toISOString()
        });
        if (await trx.schema.hasTable('quantity_events')) {
          const inserted = await trx('quantity_events')
            .insert({
              root_id: asset.id,
              type: 'VENDOR_RETURN_EXIT',
              actor: actor || null,
              timestamp: new Date().toISOString(),
              note: `Vendor Return ${id}`,
              metadata_json: JSON.stringify({
                vendorReturnId: id,
                procurementPoId: row.procurement_po_id,
                serialSnapshot: line.serial_snapshot
              })
            })
            .returning('id');
          const eventId = Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
          if (eventId && (await trx.schema.hasTable('quantity_event_lines'))) {
            await trx('quantity_event_lines').insert({
              event_id: eventId,
              asset_id: asset.id,
              unit: asset.quantity_unit || 'Nos',
              delta_available: -1,
              delta_total: -1
            }).catch(() => null);
          }
        }
      } else {
        const inv = await trx('inventory_items').where({ id: line.resource_id }).forUpdate().first();
        if (!inv) throw httpError(`Inventory ${line.resource_id} missing`, 404, 'INVENTORY_NOT_FOUND');
        // Release reservation covering return qty if needed
        if (await trx.schema.hasTable('reservation')) {
          const rsv = await trx('reservation')
            .where({ resource_type: 'INVENTORY', status: 'ACTIVE' })
            .whereRaw('LOWER(resource_id) = LOWER(?)', [inv.id])
            .first();
          if (rsv && qtyNum(rsv.quantity) > 0) {
            const releaseQty = Math.min(qty, qtyNum(rsv.quantity));
            if (releaseQty > 0) {
              await reservationService.release({
                trx,
                id: rsv.id,
                quantity: releaseQty,
                actor: actor || null,
                reason: `Vendor Return ${id}`
              });
            }
          }
        }
        const refreshed = await trx('inventory_items').where({ id: inv.id }).first();
        const avail = qtyNum(refreshed.quantity_available);
        const total = qtyNum(refreshed.quantity_total);
        if (qty - avail > 1e-9) {
          throw httpError(
            `Insufficient available ${avail} for return ${qty} on ${inv.id}`,
            409,
            'INSUFFICIENT_AVAILABLE'
          );
        }
        if (qty - total > 1e-9) {
          throw httpError(
            `Insufficient owned ${total} for return ${qty} on ${inv.id}`,
            409,
            'INSUFFICIENT_OWNED_QUANTITY'
          );
        }
        const nextAvail = roundQty(avail - qty);
        const nextTotal = roundQty(total - qty);
        await trx('inventory_items').where({ id: inv.id }).update({
          quantity_available: nextAvail,
          quantity_total: nextTotal,
          status: nextTotal <= 1e-9 ? 'Consumed' : refreshed.status,
          lastupdated: new Date().toISOString()
        });
        if (await trx.schema.hasTable('inventory_quantity_events')) {
          const inserted = await trx('inventory_quantity_events')
            .insert({
              root_id: inv.id,
              type: 'VENDOR_RETURN_EXIT',
              actor: actor || null,
              timestamp: new Date().toISOString(),
              note: `Vendor Return ${id}`,
              metadata_json: JSON.stringify({
                vendorReturnId: id,
                procurementPoId: row.procurement_po_id,
                receiptNoteId: line.receipt_note_id
              })
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
      }
      if (line.procurement_reconciliation_id) {
        const prev = restoredByRecon.get(line.procurement_reconciliation_id) || 0;
        restoredByRecon.set(line.procurement_reconciliation_id, prev + qty);
      }
    }

    for (const [reconId, q] of restoredByRecon.entries()) {
      await procurementReconciliationService.applyVendorReturnDispatched(trx, reconId, q, actor);
    }

    const now = new Date().toISOString();
    await trx('vendor_return').where({ id }).update({
      status: 'DISPATCHED',
      dispatched_at: now,
      dispatched_by: actor || null,
      updated_at: now
    });

    if (await trx.schema.hasTable('vendor_return_outbox')) {
      const idem = `vendor-return-dispatched-${id}`;
      const existing = await trx('vendor_return_outbox').where({ idempotency_key: idem }).first();
      if (!existing) {
        await trx('vendor_return_outbox').insert({
          vendor_return_id: id,
          event_type: 'VENDOR_RETURN_DISPATCHED',
          status: 'PENDING',
          idempotency_key: idem,
          payload_json: JSON.stringify({
            eventType: 'VENDOR_RETURN_DISPATCHED',
            vendorReturnId: id,
            procurementPoId: row.procurement_po_id,
            procurementReconciliationId: row.procurement_reconciliation_id,
            vendorName: row.vendor_name,
            returnReason: row.return_reason,
            actor: actor || null,
            dispatchedAt: now,
            lines: lines.map((l) => ({
              resourceType: l.resource_type,
              resourceId: l.resource_id,
              quantity: qtyNum(l.quantity),
              serialSnapshot: l.serial_snapshot,
              productId: l.product_id,
              procurementPoLineId: l.procurement_po_line_id,
              receiptNoteId: l.receipt_note_id
            }))
          }),
          created_at: now,
          updated_at: now
        });
      }
    }

    return publicVendorReturn(await trx('vendor_return').where({ id }).first(), lines);
  });
}

module.exports = {
  schemaReady,
  publicVendorReturn,
  getVendorReturn,
  listVendorReturns,
  listEligibleHoldings,
  createVendorReturn,
  markReady,
  cancel,
  dispatch
};
