/**
 * Commercial provenance for Physical Intake holdings.
 *
 * Provenance only: does not create Assets, Inventory, Products, Intakes,
 * or Receipt Notes, and does not change PO accepted/outstanding.
 */
const { db } = require('../utils');
const procurementService = require('./procurementService');

const RESOURCE_TYPES = Object.freeze(['ASSET', 'INVENTORY']);
const STATES = Object.freeze(['NOT_REQUIRED', 'AWAITING_PO', 'PO_LINKED']);
const CHOICES = Object.freeze(['EXPECTED', 'NOT_REQUIRED', 'AVAILABLE']);
const DEFAULT_CHOICE_BY_INTAKE_TYPE = Object.freeze({
  OPENING_BALANCE: 'EXPECTED',
  LEGACY_EXISTING_STOCK: 'EXPECTED',
  DONATION: 'EXPECTED',
  NON_PO_ACQUISITION: 'EXPECTED',
  EXTERNAL_ACQUISITION: 'EXPECTED',
  INTERNAL_TRANSFER: 'EXPECTED',
  OTHER_APPROVED: 'EXPECTED'
});
const PO_STATUS_LABELS = Object.freeze({
  EXPECTED: 'PO Expected Later',
  NOT_REQUIRED: 'No PO Required',
  AVAILABLE: 'Purchase Order Already Available',
  AWAITING_PO: 'PO Expected Later',
  PO_LINKED: 'Purchase Order linked'
});
const MAPPING_MESSAGE = 'Map the PO line to an AssetEngine Product before linking this intake.';

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

function trimText(value) {
  return nonempty(value) ? String(value).trim() : null;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function tableFor(resourceType) {
  return resourceType === 'ASSET' ? 'assets' : 'inventory_items';
}

function insertedId(inserted) {
  if (Array.isArray(inserted)) return inserted[0]?.id ?? inserted[0];
  return inserted?.id ?? inserted;
}

async function tablesReady(runner = db) {
  return runner.schema.hasTable('commercial_provenance');
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Commercial provenance tables are not installed', 503, 'NOT_INSTALLED');
  }
}

function defaultChoiceForIntakeType(intakeType) {
  const key = String(intakeType || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(DEFAULT_CHOICE_BY_INTAKE_TYPE, key)) {
    return DEFAULT_CHOICE_BY_INTAKE_TYPE[key];
  }
  return 'EXPECTED';
}

function normalizeChoice(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!value) return null;
  if (value === 'EXPECTED' || value === 'AWAITING_PO' || value === 'PO_EXPECTED_LATER') return 'EXPECTED';
  if (value === 'NOT_REQUIRED' || value === 'NO_PO_REQUIRED') return 'NOT_REQUIRED';
  if (value === 'AVAILABLE' || value === 'PO_LINKED' || value === 'ALREADY_AVAILABLE' || value === 'PURCHASE_ORDER_ALREADY_AVAILABLE') {
    return 'AVAILABLE';
  }
  return null;
}

function choiceFromArgs(args) {
  return normalizeChoice(
    args && (
      args.commercialPoChoice
      || args.poStatus
      || args.purchaseOrderStatus
      || args.commercial_po_choice
    )
  );
}

function resolveRegistrationChoice(intakeType, args) {
  const explicit = choiceFromArgs(args);
  if (explicit === 'NOT_REQUIRED') {
    throw httpError(
      'Mark No PO Required after the holding is registered, from Awaiting Adoption.',
      400,
      'NOT_REQUIRED_AT_REGISTER'
    );
  }
  if (explicit) return explicit;
  return defaultChoiceForIntakeType(intakeType);
}

function stateForChoice(choice) {
  if (choice === 'EXPECTED') return 'AWAITING_PO';
  if (choice === 'NOT_REQUIRED') return 'NOT_REQUIRED';
  if (choice === 'AVAILABLE') return 'PO_LINKED';
  throw httpError('Choose Purchase Order Status before registering this intake.', 400, 'PO_STATUS_REQUIRED');
}

function publicProvenance(row, extra = {}) {
  if (!row) return null;
  const state = row.state;
  const choice = state === 'AWAITING_PO' ? 'EXPECTED' : (state === 'PO_LINKED' ? 'AVAILABLE' : 'NOT_REQUIRED');
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    quantity: qtyNum(row.quantity),
    state,
    poStatusLabel: PO_STATUS_LABELS[state] || PO_STATUS_LABELS[choice],
    expectedPoNumber: row.expected_po_number || null,
    expectedVendorRef: row.expected_vendor_ref || null,
    expectedZohoPoId: row.expected_zoho_po_id || null,
    procurementPoId: row.procurement_po_id || null,
    procurementPoLineId: row.procurement_po_line_id || null,
    poFamilyId: row.po_family_id || null,
    poVersionId: row.po_version_id || row.procurement_po_id || null,
    vendorZohoId: row.vendor_zoho_id != null ? String(row.vendor_zoho_id) : null,
    vendorName: row.vendor_name_snapshot || null,
    physicalIntakeId: row.physical_intake_id || null,
    physicalIntakeOutputId: row.physical_intake_output_id || null,
    createdBy: row.created_by || null,
    linkedBy: row.linked_by || null,
    createdAt: row.created_at,
    linkedAt: row.linked_at,
    stateChangedAt: row.state_changed_at,
    ...extra
  };
}

async function getForHolding(runner, resourceType, resourceId) {
  const type = String(resourceType || '').trim().toUpperCase();
  const id = trimText(resourceId);
  if (!id || !RESOURCE_TYPES.includes(type)) return null;
  if (!(await tablesReady(runner))) return null;
  const row = await runner('commercial_provenance')
    .where({ resource_type: type, resource_id: id })
    .first();
  return publicProvenance(row);
}

async function getHoldingProvenance(resourceType, resourceId) {
  return getForHolding(db, resourceType, resourceId);
}

async function loadEligiblePoAndLine(runner, { procurementPoId, procurementPoLineId, productId, quantity }) {
  const poId = trimText(procurementPoId);
  const lineId = trimText(procurementPoLineId);
  if (!poId || !lineId) {
    throw httpError('Select a Purchase Order and PO line before linking.', 400, 'PO_LINE_REQUIRED');
  }
  const po = await runner('procurement_po').where({ id: poId }).forUpdate().first();
  if (!po) {
    throw httpError('That Purchase Order was not found.', 404, 'PO_NOT_FOUND');
  }
  if (String(po.source || 'ZOHO').toUpperCase() !== 'ZOHO') {
    throw httpError('Only imported Purchase Orders can be linked.', 409, 'PO_NOT_ELIGIBLE');
  }
  if (String(po.status || '').toUpperCase() === 'CANCELLED') {
    throw httpError('This Purchase Order is cancelled and cannot be linked.', 409, 'PO_NOT_ELIGIBLE');
  }
  const line = await runner('procurement_po_line')
    .where({ id: lineId, procurement_po_id: po.id })
    .forUpdate()
    .first();
  if (!line) {
    throw httpError('That PO line was not found on the selected Purchase Order.', 409, 'PO_LINE_NOT_FOUND');
  }
  if (String(line.line_status || 'OPEN').toUpperCase() === 'WITHDRAWN') {
    throw httpError('That PO line is withdrawn and cannot be linked.', 409, 'PO_LINE_NOT_ELIGIBLE');
  }
  if (!trimText(line.product_id)) {
    throw httpError(MAPPING_MESSAGE, 409, 'PRODUCT_MAPPING_REQUIRED');
  }
  if (trimText(productId) && String(line.product_id) !== String(productId)) {
    throw httpError(
      'The intake Product does not match the Purchase Order line Product.',
      409,
      'PRODUCT_MISMATCH'
    );
  }
  const holdingQty = qtyNum(quantity);
  if (!(holdingQty > 0)) {
    throw httpError('Quantity must be greater than zero.', 400, 'INTAKE_QUANTITY_INVALID');
  }
  const ledger = await procurementService.qtyLedger(runner, line.id);
  const qty = procurementService.lineQuantities(line.ordered_qty, ledger);
  return { po, line, qty };
}

function expectedMeta(args, choice) {
  if (choice !== 'EXPECTED') {
    return { expectedPoNumber: null, expectedVendorRef: null, expectedZohoPoId: null };
  }
  return {
    expectedPoNumber: trimText(args && (args.expectedPoNumber || args.expected_po_number)),
    expectedVendorRef: trimText(args && (args.expectedVendorRef || args.expected_vendor_ref || args.expectedVendor)),
    expectedZohoPoId: trimText(args && (args.expectedZohoPoId || args.expected_zoho_po_id))
  };
}

async function insertProvenance(trx, payload) {
  const now = payload.now || new Date().toISOString();
  const inserted = await trx('commercial_provenance')
    .insert({
      resource_type: payload.resourceType,
      resource_id: payload.resourceId,
      quantity: payload.quantity,
      state: payload.state,
      expected_po_number: payload.expectedPoNumber || null,
      expected_vendor_ref: payload.expectedVendorRef || null,
      expected_zoho_po_id: payload.expectedZohoPoId || null,
      procurement_po_id: payload.procurementPoId || null,
      procurement_po_line_id: payload.procurementPoLineId || null,
      po_family_id: payload.poFamilyId || null,
      po_version_id: payload.poVersionId || null,
      vendor_zoho_id: payload.vendorZohoId || null,
      vendor_name_snapshot: payload.vendorName || null,
      physical_intake_id: payload.physicalIntakeId || null,
      physical_intake_output_id: payload.physicalIntakeOutputId || null,
      created_by: payload.createdBy || null,
      linked_by: payload.linkedBy || null,
      created_at: now,
      linked_at: payload.linkedAt || null,
      state_changed_at: now
    })
    .returning('id');
  return insertedId(inserted);
}

async function attachAtIntake(trx, ctx) {
  await requireTables(trx);
  const choice = ctx.choice;
  const state = stateForChoice(choice);
  const meta = expectedMeta(ctx.args || {}, choice);
  let po = null;
  let line = null;
  if (choice === 'AVAILABLE') {
    const loaded = await loadEligiblePoAndLine(trx, {
      procurementPoId: ctx.args && (ctx.args.procurementPoId || ctx.args.procurement_po_id),
      procurementPoLineId: ctx.args && (ctx.args.procurementPoLineId || ctx.args.procurement_po_line_id),
      productId: ctx.productId,
      quantity: ctx.quantity
    });
    po = loaded.po;
    line = loaded.line;
  }
  await insertProvenance(trx, {
    resourceType: ctx.resourceType,
    resourceId: ctx.resourceId,
    quantity: ctx.quantity,
    state,
    expectedPoNumber: meta.expectedPoNumber,
    expectedVendorRef: meta.expectedVendorRef,
    expectedZohoPoId: meta.expectedZohoPoId,
    procurementPoId: po ? po.id : null,
    procurementPoLineId: line ? line.id : null,
    vendorZohoId: po ? po.vendor_zoho_id : null,
    vendorName: po ? po.vendor_name_snapshot : null,
    physicalIntakeId: ctx.physicalIntakeId,
    physicalIntakeOutputId: ctx.physicalIntakeOutputId,
    createdBy: ctx.actor || null,
    linkedBy: state === 'PO_LINKED' ? (ctx.actor || null) : null,
    linkedAt: state === 'PO_LINKED' ? new Date().toISOString() : null
  });
  return { choice, state, po, line, meta };
}

async function writeIntakeProvenanceEvents(trx, { physicalIntakeId, productId, quantity, unit, actor, resourceType, resourceId, choice, state, po, line, meta }) {
  if (!physicalIntakeId) return;
  if (state === 'AWAITING_PO') {
    await trx('physical_intake_event').insert({
      physical_intake_id: physicalIntakeId,
      type: 'PO_EXPECTED',
      product_id: productId || null,
      quantity,
      unit: unit || null,
      actor: actor || null,
      timestamp: new Date().toISOString(),
      reason: 'PO Expected Later',
      resource_type: resourceType,
      resource_id: resourceId,
      metadata_json: JSON.stringify({
        poChoice: choice,
        state,
        expectedPoNumber: meta && meta.expectedPoNumber,
        expectedVendorRef: meta && meta.expectedVendorRef,
        expectedZohoPoId: meta && meta.expectedZohoPoId
      })
    });
  }
  if (state === 'PO_LINKED') {
    await trx('physical_intake_event').insert({
      physical_intake_id: physicalIntakeId,
      type: 'PO_LINKED',
      product_id: productId || null,
      quantity,
      unit: unit || null,
      actor: actor || null,
      timestamp: new Date().toISOString(),
      reason: 'Purchase Order Already Available',
      resource_type: resourceType,
      resource_id: resourceId,
      metadata_json: JSON.stringify({
        poChoice: choice,
        state,
        procurementPoId: po && po.id,
        procurementPoLineId: line && line.id
      })
    });
  }
}

async function linkPurchaseOrder(args = {}) {
  await requireTables();
  const resourceType = String(args.resourceType || args.resource_type || '').trim().toUpperCase();
  const resourceId = trimText(args.resourceId || args.resource_id);
  const actor = trimText(args.actor || args.linkedBy);
  if (!RESOURCE_TYPES.includes(resourceType) || !resourceId) {
    throw httpError('A physical holding is required.', 400, 'MISSING_ID');
  }

  try {
    return await db.transaction(async (trx) => {
      const table = tableFor(resourceType);
      const holding = await trx(table).where({ id: resourceId }).forUpdate().first();
      if (!holding) {
        throw httpError('That Asset or Inventory holding was not found.', 404, 'NOT_FOUND');
      }
      const existing = await trx('commercial_provenance')
        .where({ resource_type: resourceType, resource_id: resourceId })
        .forUpdate()
        .first();
      if (!existing) {
        throw httpError(
          'This holding has no Purchase Order expectation to link.',
          409,
          'PROVENANCE_NOT_AWAITING'
        );
      }
      const poId = trimText(args.procurementPoId || args.procurement_po_id);
      const lineId = trimText(args.procurementPoLineId || args.procurement_po_line_id);
      if (existing.state === 'PO_LINKED') {
        if (existing.procurement_po_id === poId && existing.procurement_po_line_id === lineId) {
          return publicProvenance(existing, { replayed: true });
        }
        throw httpError(
          'This holding is already linked to a Purchase Order.',
          409,
          'ALREADY_LINKED'
        );
      }
      if (existing.state !== 'AWAITING_PO') {
        throw httpError(
          'This holding is not waiting for a Purchase Order.',
          409,
          'PROVENANCE_NOT_AWAITING'
        );
      }
      const holdingQty = qtyNum(holding.quantity_total);
      const provenanceQty = qtyNum(existing.quantity);
      if (Math.abs(holdingQty - provenanceQty) > 1e-9) {
        throw httpError(
          'Whole-holding linkage requires the current quantity to match the registered holding.',
          409,
          'QUANTITY_NOT_WHOLE_HOLDING'
        );
      }
      const { po, line } = await loadEligiblePoAndLine(trx, {
        procurementPoId: poId,
        procurementPoLineId: lineId,
        productId: holding.product_id,
        quantity: provenanceQty
      });
      const now = new Date().toISOString();
      await trx('commercial_provenance').where({ id: existing.id }).update({
        state: 'PO_LINKED',
        procurement_po_id: po.id,
        procurement_po_line_id: line.id,
        po_version_id: null,
        vendor_zoho_id: po.vendor_zoho_id || null,
        vendor_name_snapshot: po.vendor_name_snapshot || null,
        linked_by: actor,
        linked_at: now,
        state_changed_at: now
      });
      if (existing.physical_intake_id) {
        await trx('physical_intake_event').insert({
          physical_intake_id: existing.physical_intake_id,
          type: 'PO_LINKED',
          product_id: holding.product_id || null,
          quantity: provenanceQty,
          unit: holding.quantity_unit || null,
          actor,
          timestamp: now,
          reason: 'Link Purchase Order',
          resource_type: resourceType,
          resource_id: resourceId,
          metadata_json: JSON.stringify({
            procurementPoId: po.id,
            procurementPoLineId: line.id,
            fromState: 'AWAITING_PO',
            toState: 'PO_LINKED'
          })
        });
      }
      if (resourceType === 'ASSET' && (await trx.schema.hasTable('asset_history'))) {
        await trx('asset_history').insert({
          assetid: resourceId,
          action: 'PO_LINKED',
          oldvalue: 'AWAITING_PO',
          newvalue: po.id,
          user: actor || 'web',
          timestamp: now,
          details: `Linked to Purchase Order ${po.po_number || po.id} line ${line.id}`
        });
      }
      const updated = await trx('commercial_provenance').where({ id: existing.id }).first();
      return publicProvenance(updated);
    });
  } catch (err) {
    if (err && String(err.code) === '23505') {
      throw httpError(
        'This holding is already linked to a Purchase Order.',
        409,
        'ALREADY_LINKED'
      );
    }
    throw err;
  }
}

async function insertIntakeEvent(trx, payload) {
  try {
    await trx('physical_intake_event').insert(payload);
  } catch (err) {
    if (String(err.code) === '23514') return;
    throw err;
  }
}

async function markNotRequired(args = {}) {
  await requireTables();
  const resourceType = String(args.resourceType || args.resource_type || '').trim().toUpperCase();
  const resourceId = trimText(args.resourceId || args.resource_id);
  const actor = trimText(args.actor || args.updatedBy);
  if (!RESOURCE_TYPES.includes(resourceType) || !resourceId) {
    throw httpError('A physical holding is required.', 400, 'MISSING_ID');
  }
  return db.transaction(async (trx) => {
    const table = tableFor(resourceType);
    const holding = await trx(table).where({ id: resourceId }).forUpdate().first();
    if (!holding) {
      throw httpError('That Asset or Inventory holding was not found.', 404, 'NOT_FOUND');
    }
    const existing = await trx('commercial_provenance')
      .where({ resource_type: resourceType, resource_id: resourceId })
      .forUpdate()
      .first();
    if (!existing) {
      throw httpError('This holding has no Purchase Order expectation to close.', 409, 'PROVENANCE_NOT_AWAITING');
    }
    if (existing.state === 'NOT_REQUIRED') {
      return publicProvenance(existing, { replayed: true });
    }
    if (existing.state !== 'AWAITING_PO') {
      throw httpError('This holding is not waiting for a Purchase Order.', 409, 'PROVENANCE_NOT_AWAITING');
    }
    const now = new Date().toISOString();
    await trx('commercial_provenance').where({ id: existing.id }).update({
      state: 'NOT_REQUIRED',
      expected_po_number: null,
      expected_vendor_ref: null,
      expected_zoho_po_id: null,
      state_changed_at: now
    });
    if (existing.physical_intake_id) {
      await insertIntakeEvent(trx, {
        physical_intake_id: existing.physical_intake_id,
        type: 'PO_NOT_REQUIRED',
        product_id: holding.product_id || null,
        quantity: qtyNum(existing.quantity),
        unit: holding.quantity_unit || null,
        actor,
        timestamp: now,
        reason: 'No PO Required',
        resource_type: resourceType,
        resource_id: resourceId,
        metadata_json: JSON.stringify({ fromState: 'AWAITING_PO', toState: 'NOT_REQUIRED' })
      });
    }
    if (resourceType === 'ASSET' && (await trx.schema.hasTable('asset_history'))) {
      await trx('asset_history').insert({
        assetid: resourceId,
        action: 'PO_NOT_REQUIRED',
        oldvalue: 'AWAITING_PO',
        newvalue: 'NOT_REQUIRED',
        user: actor || 'web',
        timestamp: now,
        details: 'Operator marked No PO Required from Awaiting Adoption'
      });
    }
    const updated = await trx('commercial_provenance').where({ id: existing.id }).first();
    return publicProvenance(updated);
  });
}

async function holdingLabelMap(rows) {
  const assets = rows.filter((row) => row.resource_type === 'ASSET').map((row) => row.resource_id);
  const inventories = rows.filter((row) => row.resource_type === 'INVENTORY').map((row) => row.resource_id);
  const labels = new Map();
  if (assets.length) {
    const found = await db('assets').whereIn('id', assets).select('id', 'itemname', 'make', 'model', 'status', 'purpose');
    found.forEach((row) => labels.set(`ASSET:${row.id}`, row));
  }
  if (inventories.length) {
    const found = await db('inventory_items').whereIn('id', inventories).select('id', 'itemname', 'make', 'model', 'status', 'purpose');
    found.forEach((row) => labels.set(`INVENTORY:${row.id}`, row));
  }
  return labels;
}

async function countAwaitingAdoption() {
  if (!(await tablesReady())) return 0;
  const row = await db('commercial_provenance').where({ state: 'AWAITING_PO' }).count({ n: '*' }).first();
  return Number(row && row.n ? row.n : 0);
}

async function listByState(query = {}) {
  await requireTables();
  const state = String(query.state || '').trim().toUpperCase();
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  let q = db('commercial_provenance').orderBy('created_at', 'desc');
  if (STATES.includes(state)) q = q.where('state', state);
  const resourceType = String(query.resourceType || query.resource_type || '').trim().toUpperCase();
  if (RESOURCE_TYPES.includes(resourceType)) q = q.where('resource_type', resourceType);
  const countRow = await q.clone().clearOrder().count({ n: '*' }).first();
  const rows = await q.limit(limit).offset(offset);
  const labels = await holdingLabelMap(rows);
  return {
    items: rows.map((row) => {
      const holding = labels.get(`${row.resource_type}:${row.resource_id}`) || {};
      return publicProvenance(row, {
        holdingName: holding.itemname || row.resource_id,
        holdingStatus: holding.status || null,
        holdingPurpose: holding.purpose || null,
        make: holding.make || null,
        model: holding.model || null
      });
    }),
    total: Number(countRow && countRow.n ? countRow.n : 0),
    limit,
    offset
  };
}

async function listLinkablePurchaseOrders({ q, limit } = {}) {
  await requireTables();
  if (!(await db.schema.hasTable('procurement_po'))) {
    return { purchaseOrders: [] };
  }
  const cap = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  let query = db('procurement_po')
    .whereNot('status', 'CANCELLED')
    .orderBy('updated_at', 'desc')
    .limit(cap);
  if (q) {
    const term = `%${String(q).trim()}%`;
    query = query.andWhere(function search() {
      this.where('id', 'ilike', term)
        .orWhere('po_number', 'ilike', term)
        .orWhere('zoho_po_id', 'ilike', term)
        .orWhere('subject', 'ilike', term)
        .orWhere('vendor_name_snapshot', 'ilike', term);
    });
  }
  const rows = await query;
  const purchaseOrders = [];
  for (const row of rows) {
    purchaseOrders.push(await procurementService.publicPo(db, row, { includeLines: true }));
  }
  return { purchaseOrders };
}

async function getLinkablePurchaseOrder(id) {
  await requireTables();
  const po = await db('procurement_po').where({ id: String(id || '').trim() }).first();
  if (!po) throw httpError('That Purchase Order was not found.', 404, 'PO_NOT_FOUND');
  return procurementService.publicPo(db, po, { includeLines: true });
}

module.exports = {
  RESOURCE_TYPES,
  STATES,
  CHOICES,
  DEFAULT_CHOICE_BY_INTAKE_TYPE,
  PO_STATUS_LABELS,
  MAPPING_MESSAGE,
  tablesReady,
  defaultChoiceForIntakeType,
  resolveRegistrationChoice,
  stateForChoice,
  publicProvenance,
  getForHolding,
  getHoldingProvenance,
  attachAtIntake,
  writeIntakeProvenanceEvents,
  linkPurchaseOrder,
  markNotRequired,
  countAwaitingAdoption,
  listByState,
  listLinkablePurchaseOrders,
  getLinkablePurchaseOrder
};
