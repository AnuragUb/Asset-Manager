/**
 * Physical Intake — controlled non-procurement physical birth.
 *
 * Creates one Asset or one Inventory holding from an existing Product.
 * Does not create PO, Receipt Note, reservation, Set, conversion, or Break.
 * Direct POST /api/assets and POST /api/inventory/items remain contained.
 */
const qrcode = require('qrcode');
const {
  db,
  generatePhysicalIntakeId,
  verifyPhysicalIntakeId,
  generateModernAssetId
} = require('../utils');
const { EVENT_TYPES } = require('../../shared/inventoryEventSystem');
const productService = require('./productService');
const commercialProvenanceService = require('./commercialProvenanceService');

const HOLDING_TYPES = Object.freeze(['ASSET', 'INVENTORY']);
const INTAKE_TYPES = Object.freeze([
  'OPENING_BALANCE',
  'LEGACY_EXISTING_STOCK',
  'EXTERNAL_ACQUISITION',
  'INTERNAL_TRANSFER',
  'DONATION',
  'NON_PO_ACQUISITION',
  'OTHER_APPROVED'
]);
const REASON_REQUIRED_TYPES = Object.freeze(['NON_PO_ACQUISITION', 'OTHER_APPROVED']);
const ID_RE = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{4}-[A-Z0-9]{6}-[A-Z0-9]$/;
const INTAKE_ID_RE = /^INTAKE-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$/;

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function qtyNum(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError('Quantity is not a valid number.', 400, 'INTAKE_QUANTITY_INVALID');
  return n;
}

function roundQty(value, precision = 6) {
  const p = Math.min(6, Math.max(0, parseInt(precision, 10) || 0));
  const n = qtyNum(value);
  const f = 10 ** p;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

function trimText(value) {
  return nonempty(value) ? String(value).trim() : null;
}

function actorOf(args) {
  return trimText(args && (args.actor || args.createdBy)) || null;
}

function idempotencyKeyOf(args) {
  const raw = args && (args.idempotencyKey || args.idempotency_key);
  if (!raw) return null;
  return String(raw).trim().slice(0, 64) || null;
}

function isUniqueViolation(err, name) {
  if (!err || String(err.code) !== '23505') return false;
  const hay = `${err.constraint || ''} ${err.message || ''}`;
  return hay.includes(name);
}

function requestHost(host) {
  const value = String(host || '').trim();
  if (!value) throw httpError('Host is required to generate a QR', 400, 'MISSING_HOST');
  return value.replace(/^https?:\/\//i, '');
}

async function buildQrDataUrl(host, publicPath, id) {
  const urlText = `http://${requestHost(host)}/${publicPath}/${encodeURIComponent(id)}`;
  return qrcode.toDataURL(urlText, { width: 512, margin: 2 });
}

function clientLabelFromId(id) {
  const parts = String(id || '').split('-');
  return `${parts[0] || 'AST'}-${parts[1] || 'LOC'}-${parts[3] || '000000'}`;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return { raw: value };
  }
}

async function tablesReady(runner = db) {
  return runner.schema.hasTable('physical_intake');
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Physical Intake tables are not installed', 503, 'NOT_INSTALLED');
  }
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id) || !INTAKE_ID_RE.test(id)) {
      throw httpError(`ID generator produced a non-canonical ${label} id: ${id}`, 500);
    }
    const existing = await trx(table).where({ id }).first();
    if (!existing) return id;
  }
  throw httpError(`Could not allocate a unique ${label} ID`, 500);
}

async function uniqueHoldingId(trx, table, location, type) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateModernAssetId(location || 'Mumbai', type || 'GEN');
    if (!ID_RE.test(id) || /-NaN$/i.test(id) || String(id).startsWith('INTAKE-')) {
      throw httpError(`ID generator produced a non-canonical id: ${id}`, 500);
    }
    const existing = await trx(table).whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique physical ID', 500);
}

function sourceObject(args) {
  const raw = (args && (args.source || args.source_json)) || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function pickSource(intakeType, args) {
  const src = sourceObject(args);
  const reason = trimText(args && (args.reason || args.note || src.reason || src.note || src.explanation));
  const out = {};
  if (intakeType === 'OPENING_BALANCE') {
    if (src.note || src.openingBalanceNote) out.openingBalanceNote = trimText(src.note || src.openingBalanceNote);
    if (src.sourceDate || src.source_date) out.sourceDate = trimText(src.sourceDate || src.source_date);
    if (src.legacyReference || src.legacy_reference) out.legacyReference = trimText(src.legacyReference || src.legacy_reference);
  } else if (intakeType === 'LEGACY_EXISTING_STOCK') {
    if (src.legacyId || src.legacy_id) out.legacyId = trimText(src.legacyId || src.legacy_id);
    if (src.sourceSystem || src.source_system) out.sourceSystem = trimText(src.sourceSystem || src.source_system);
    if (src.legacyDescription || src.legacy_description) out.legacyDescription = trimText(src.legacyDescription || src.legacy_description);
  } else if (intakeType === 'EXTERNAL_ACQUISITION') {
    if (src.sourceDocument || src.source_document || src.reference) {
      out.sourceDocument = trimText(src.sourceDocument || src.source_document || src.reference);
    }
    if (src.acquisitionDate || src.acquisition_date) out.acquisitionDate = trimText(src.acquisitionDate || src.acquisition_date);
    if (src.note) out.note = trimText(src.note);
  } else if (intakeType === 'INTERNAL_TRANSFER') {
    out.sourceLocation = trimText(src.sourceLocation || src.source_location || src.sourceContext || src.source_context);
    if (src.transferReference || src.transfer_reference) {
      out.transferReference = trimText(src.transferReference || src.transfer_reference);
    }
    if (src.note) out.note = trimText(src.note);
  } else if (intakeType === 'DONATION') {
    if (src.donor || src.reference) out.donor = trimText(src.donor || src.reference);
    if (src.donationDate || src.donation_date || src.date) {
      out.donationDate = trimText(src.donationDate || src.donation_date || src.date);
    }
    if (src.note) out.note = trimText(src.note);
  } else if (intakeType === 'NON_PO_ACQUISITION') {
    if (src.reference || src.sourceDocument) out.reference = trimText(src.reference || src.sourceDocument);
  } else if (intakeType === 'OTHER_APPROVED') {
    if (src.explanation) out.explanation = trimText(src.explanation);
  }
  if (reason) out.reason = reason;
  return out;
}

function sourceSummary(intakeType, source) {
  const s = source || {};
  if (intakeType === 'OPENING_BALANCE') {
    return s.legacyReference || s.openingBalanceNote || s.sourceDate || null;
  }
  if (intakeType === 'LEGACY_EXISTING_STOCK') {
    return [s.sourceSystem, s.legacyId, s.legacyDescription].filter(Boolean).join(' · ') || null;
  }
  if (intakeType === 'EXTERNAL_ACQUISITION') {
    return [s.sourceDocument, s.acquisitionDate, s.note].filter(Boolean).join(' · ') || null;
  }
  if (intakeType === 'INTERNAL_TRANSFER') {
    return [s.sourceLocation, s.transferReference, s.note].filter(Boolean).join(' · ') || null;
  }
  if (intakeType === 'DONATION') {
    return [s.donor, s.donationDate, s.note].filter(Boolean).join(' · ') || null;
  }
  if (intakeType === 'NON_PO_ACQUISITION') return s.reference || s.reason || null;
  if (intakeType === 'OTHER_APPROVED') return s.explanation || s.reason || null;
  return s.reason || null;
}

function publicIntake(row, extra = {}) {
  if (!row) return null;
  const source = parseJson(row.source_json) || {};
  return {
    id: row.id,
    status: row.status,
    holdingType: row.holding_type,
    intakeType: row.intake_type,
    productId: row.product_id,
    quantity: qtyNum(row.quantity),
    unit: row.unit,
    reason: row.reason || null,
    source,
    sourceSummary: sourceSummary(row.intake_type, source),
    location: row.location || null,
    folderId: row.folder_id || null,
    kindId: row.kind_id || null,
    actor: row.actor || null,
    approvingActor: row.approving_actor || null,
    idempotencyKey: row.idempotency_key || null,
    createdAt: row.created_at,
    origin: 'NON_PROCUREMENT_INTAKE',
    commercialProvenance: extra.commercialProvenance || null,
    ...extra
  };
}

function publicOutput(row) {
  return {
    id: row.id,
    physicalIntakeId: row.physical_intake_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    quantity: qtyNum(row.quantity)
  };
}

function publicEvent(row) {
  return {
    id: row.id,
    physicalIntakeId: row.physical_intake_id,
    type: row.type,
    productId: row.product_id || null,
    quantity: row.quantity == null ? null : qtyNum(row.quantity),
    unit: row.unit || null,
    actor: row.actor || null,
    timestamp: row.timestamp,
    reason: row.reason || null,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    metadata: parseJson(row.metadata_json)
  };
}

async function writeIntakeEvent(trx, payload) {
  await trx('physical_intake_event').insert({
    physical_intake_id: payload.physicalIntakeId,
    type: payload.type,
    product_id: payload.productId || null,
    quantity: payload.quantity == null ? null : payload.quantity,
    unit: payload.unit || null,
    actor: payload.actor || null,
    timestamp: new Date().toISOString(),
    reason: payload.reason || null,
    resource_type: payload.resourceType || null,
    resource_id: payload.resourceId || null,
    metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
  });
}

async function writeQuantityEvent(trx, { table, rootId, type, actor, note, metadata, lines }) {
  const now = new Date().toISOString();
  const isAsset = table === 'assets';
  const eventTable = isAsset ? 'quantity_events' : 'inventory_quantity_events';
  const lineTable = isAsset ? 'quantity_event_lines' : 'inventory_quantity_event_lines';
  if (!(await trx.schema.hasTable(eventTable))) return null;
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
  if (eventId && Array.isArray(lines) && lines.length && (await trx.schema.hasTable(lineTable))) {
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

async function writeAssetHistory(trx, assetId, action, oldValue, newValue, actor, details) {
  if (!(await trx.schema.hasTable('asset_history'))) return;
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

async function hydrate(runner, row) {
  if (!row) return null;
  const [outputs, events, product] = await Promise.all([
    runner('physical_intake_output').where({ physical_intake_id: row.id }).orderBy('id', 'asc'),
    runner('physical_intake_event').where({ physical_intake_id: row.id }).orderBy('id', 'asc'),
    runner('product').where({ id: row.product_id }).first()
  ]);
  let commercialProvenance = null;
  if (await commercialProvenanceService.tablesReady(runner)) {
    const provRow = await runner('commercial_provenance').where({ physical_intake_id: row.id }).first();
    commercialProvenance = commercialProvenanceService.publicProvenance(provRow);
  }
  return publicIntake(row, {
    productName: product ? product.name : null,
    productUnit: product ? product.unit : null,
    outputs: outputs.map(publicOutput),
    events: events.map(publicEvent),
    commercialProvenance
  });
}

async function findByCreateKey(runner, key) {
  if (!key) return null;
  return runner('physical_intake').where({ idempotency_key: key }).first();
}

function fingerprintOf({
  holdingType,
  intakeType,
  productId,
  quantity,
  unit,
  reason,
  commercialChoice,
  expectedPoNumber,
  procurementPoId,
  procurementPoLineId
}) {
  return JSON.stringify({
    holdingType,
    intakeType,
    productId,
    quantity: String(quantity),
    unit: String(unit || ''),
    reason: String(reason || ''),
    commercialChoice: String(commercialChoice || ''),
    expectedPoNumber: String(expectedPoNumber || ''),
    procurementPoId: String(procurementPoId || ''),
    procurementPoLineId: String(procurementPoLineId || '')
  });
}

function sameFingerprint(row, fp) {
  const stored = parseJson(row.source_json) || {};
  if (stored._fingerprint) return stored._fingerprint === fp;
  return fingerprintOf({
    holdingType: row.holding_type,
    intakeType: row.intake_type,
    productId: row.product_id,
    quantity: roundQty(row.quantity),
    unit: row.unit,
    reason: row.reason
  }) === fp;
}

async function resolveInventoryFolder(trx, args) {
  const folderId = trimText(args.folderId || args.folder_id);
  const kindId = trimText(args.kindId || args.kind_id);
  if (!folderId) {
    throw httpError('Parent Folder is required.', 400, 'INTAKE_FOLDER_REQUIRED');
  }
  if (!kindId) {
    throw httpError('Kind / Category is required.', 400, 'INTAKE_KIND_REQUIRED');
  }
  const kind = await trx('inventory_kinds')
    .where({ id: kindId })
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .first();
  if (!kind) {
    throw httpError('Inventory kind was not found.', 400, 'INTAKE_KIND_REQUIRED');
  }
  const kindFolder = trimText(kind.folderid || kind.FolderId || kind.folder_id);
  if (kindFolder && kindFolder !== folderId) {
    throw httpError('Inventory kind does not belong to the selected folder.', 400, 'INTAKE_KIND_REQUIRED');
  }
  const typeName = trimText(args.type) || trimText(kind.name || kind.Name) || 'Inventory';
  const categoryName = trimText(args.category) || typeName;
  return {
    folderid: folderId,
    kindid: kindId,
    type: typeName,
    category: categoryName
  };
}

async function resolveAssetHierarchy(trx, args) {
  const folderId = trimText(args.folderId || args.folder_id);
  const kindId = trimText(args.kindId || args.kind_id);
  if (!folderId) {
    throw httpError('Parent Folder is required.', 400, 'INTAKE_FOLDER_REQUIRED');
  }
  if (!kindId) {
    throw httpError('Kind / Category is required.', 400, 'INTAKE_KIND_REQUIRED');
  }
  let parentFolder = trimText(args.parentFolder || args.parent_folder || args.folderName);
  if (!parentFolder) {
    const folder = await trx('folders')
      .where({ id: folderId })
      .first();
    parentFolder = trimText(folder?.name || folder?.Name) || folderId;
  }
  const type = trimText(args.type) || kindId;
  const category = trimText(args.category || args.module) || 'IT';
  return { folderId, kindId, parentFolder, type, category };
}

async function loadActiveProduct(productId) {
  const id = trimText(productId);
  if (!id) {
    throw httpError('An existing AssetEngine Product is required.', 409, 'PRODUCT_REQUIRED');
  }
  let product;
  try {
    product = await productService.getProduct(id);
  } catch (err) {
    if (err && (err.statusCode === 404 || /not found/i.test(err.message || ''))) {
      throw httpError('An existing AssetEngine Product is required.', 409, 'PRODUCT_REQUIRED');
    }
    throw err;
  }
  if (!product || String(product.status || '').toUpperCase() === 'ARCHIVED') {
    throw httpError('An existing active AssetEngine Product is required.', 409, 'PRODUCT_REQUIRED');
  }
  return product;
}

function validateRequest(args) {
  const holdingType = String(args.holdingType || args.holding_type || '').trim().toUpperCase();
  if (!HOLDING_TYPES.includes(holdingType)) {
    throw httpError('Choose Asset or Inventory.', 400, 'INTAKE_HOLDING_TYPE_REQUIRED');
  }
  const intakeType = String(args.intakeType || args.intake_type || '').trim().toUpperCase();
  if (!intakeType) {
    throw httpError('An intake type is required.', 400, 'INTAKE_TYPE_REQUIRED');
  }
  if (!INTAKE_TYPES.includes(intakeType)) {
    throw httpError('That intake type is not supported.', 400, 'INTAKE_TYPE_REQUIRED');
  }
  const quantity = roundQty(args.quantity);
  if (!(quantity > 0)) {
    throw httpError('Quantity must be greater than zero.', 400, 'INTAKE_QUANTITY_INVALID');
  }
  if (args.quantityReserved != null || args.quantity_reserved != null) {
    const reserved = qtyNum(args.quantityReserved || args.quantity_reserved);
    if (reserved !== 0) {
      throw httpError('Physical Intake cannot create reserved quantity.', 400, 'INTAKE_QUANTITY_INVALID');
    }
  }
  if (args.quantityConverted != null || args.quantity_converted != null) {
    const converted = qtyNum(args.quantityConverted || args.quantity_converted);
    if (converted !== 0) {
      throw httpError('Physical Intake cannot create converted quantity.', 400, 'INTAKE_QUANTITY_INVALID');
    }
  }
  const source = pickSource(intakeType, args);
  const reason = trimText(args.reason || args.note || source.reason || source.explanation || source.note);
  if (REASON_REQUIRED_TYPES.includes(intakeType) && !reason) {
    throw httpError('A reason is required for this intake type.', 400, 'INTAKE_REASON_REQUIRED');
  }
  if (intakeType === 'INTERNAL_TRANSFER' && !source.sourceLocation) {
    throw httpError(
      'Internal Transfer intake requires a source location or context note. This is provenance only — not a transfer ledger.',
      400,
      'INTAKE_REASON_REQUIRED'
    );
  }
  if (intakeType === 'OTHER_APPROVED' && !reason) {
    throw httpError('Other Approved intake requires an explanation.', 400, 'INTAKE_REASON_REQUIRED');
  }
  const commercialChoice = commercialProvenanceService.resolveRegistrationChoice(intakeType, args);
  if (commercialChoice === 'AVAILABLE') {
    const poId = trimText(args.procurementPoId || args.procurement_po_id);
    const lineId = trimText(args.procurementPoLineId || args.procurement_po_line_id);
    if (!poId || !lineId) {
      throw httpError('Select a Purchase Order and PO line before registering.', 400, 'PO_LINE_REQUIRED');
    }
  }
  const folderId = trimText(args.folderId || args.folder_id);
  const kindId = trimText(args.kindId || args.kind_id);
  if (!folderId) {
    throw httpError('Parent Folder is required.', 400, 'INTAKE_FOLDER_REQUIRED');
  }
  if (!kindId) {
    throw httpError('Kind / Category is required.', 400, 'INTAKE_KIND_REQUIRED');
  }
  return {
    holdingType,
    intakeType,
    quantity,
    source,
    reason,
    commercialChoice,
    folderId,
    kindId,
    parentFolder: trimText(args.parentFolder || args.parent_folder || args.folderName),
    type: trimText(args.type),
    category: trimText(args.category || args.module)
  };
}

async function createInventoryRow(trx, { product, qty, unit, location, host, actor, intakeId, folder }) {
  const holdingId = await uniqueHoldingId(trx, 'inventory_items', location, folder.type || product.name || 'Inventory');
  const now = new Date().toISOString();
  const qr = await buildQrDataUrl(host, 'inventory', holdingId);
  await trx('inventory_items').insert({
    id: holdingId,
    itemname: product.name,
    itemdescription: product.description || '',
    status: 'In Store',
    make: product.make || '',
    model: product.model || '',
    type: folder.type || 'Inventory',
    category: folder.category || folder.type || 'Inventory',
    folderid: folder.folderid,
    kindid: folder.kindid,
    currentlocation: location || '',
    lastupdated: now,
    purpose: 'Owned',
    is_quantity_tracked: 1,
    is_set: 0,
    is_batch: 0,
    quantity_unit: unit,
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_parent_id: null,
    quantity_root_id: holdingId,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: product.id,
    receipt_line_id: null,
    physical_intake_id: intakeId,
    parentid: null,
    qrcode: qr,
    noqr: 0,
    client_label: clientLabelFromId(holdingId),
    quantity_updated_at: now
  });
  const outputInserted = await trx('physical_intake_output').insert({
    physical_intake_id: intakeId,
    resource_type: 'INVENTORY',
    resource_id: holdingId,
    quantity: qty,
    created_at: now
  }).returning('id');
  const outputId = Array.isArray(outputInserted) ? (outputInserted[0]?.id ?? outputInserted[0]) : outputInserted?.id;
  await writeQuantityEvent(trx, {
    table: 'inventory_items',
    rootId: holdingId,
    type: EVENT_TYPES.PHYSICAL_INTAKE,
    actor,
    note: `Physical Intake ${intakeId}`,
    metadata: { physical_intake_id: intakeId, origin: 'NON_PROCUREMENT_INTAKE' },
    lines: [{ id: holdingId, unit, deltaAvailable: qty, deltaTotal: qty }]
  });
  return { resourceType: 'INVENTORY', resourceId: holdingId, quantity: qty, qr: true, outputId };
}

async function createAssetRow(trx, { product, qty, unit, location, host, actor, intakeId, hierarchy }) {
  const type = hierarchy?.type || product.make || 'GEN';
  const category = hierarchy?.category || 'IT';
  const parentFolder = hierarchy?.parentFolder || '';
  const holdingId = await uniqueHoldingId(trx, 'assets', location, type);
  const now = new Date().toISOString();
  const qr = await buildQrDataUrl(host, 'asset', holdingId);
  const row = {
    id: holdingId,
    itemname: product.name,
    itemdescription: product.description || '',
    status: 'In Store',
    make: product.make || '',
    model: product.model || '',
    srno: '',
    type,
    category,
    isplaceholder: 0,
    parentid: null,
    currentlocation: location || '',
    lastupdated: now,
    purpose: 'Owned',
    qrcode: qr,
    assignedto: '',
    client_label: clientLabelFromId(holdingId),
    noqr: 0,
    is_quantity_tracked: 1,
    is_batch: 0,
    is_set: 0,
    quantity_unit: unit,
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: 0,
    quantity_parent_id: null,
    quantity_root_id: holdingId,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: product.id,
    receipt_line_id: null,
    physical_intake_id: intakeId,
    quantity_updated_at: now
  };
  if (await trx.schema.hasColumn('assets', 'parent_folder')) {
    row.parent_folder = parentFolder;
  }
  await trx('assets').insert(row);
  const outputInserted = await trx('physical_intake_output').insert({
    physical_intake_id: intakeId,
    resource_type: 'ASSET',
    resource_id: holdingId,
    quantity: qty,
    created_at: now
  }).returning('id');
  const outputId = Array.isArray(outputInserted) ? (outputInserted[0]?.id ?? outputInserted[0]) : outputInserted?.id;
  await writeQuantityEvent(trx, {
    table: 'assets',
    rootId: holdingId,
    type: EVENT_TYPES.PHYSICAL_INTAKE,
    actor,
    note: `Physical Intake ${intakeId}`,
    metadata: { physical_intake_id: intakeId, origin: 'NON_PROCUREMENT_INTAKE' },
    lines: [{ id: holdingId, unit, deltaAvailable: qty, deltaTotal: qty }]
  });
  await writeAssetHistory(
    trx,
    holdingId,
    'PHYSICAL_INTAKE_ASSET_CREATED',
    intakeId,
    holdingId,
    actor,
    `Registered by non-procurement Physical Intake ${intakeId} qty ${qty}`
  );
  return { resourceType: 'ASSET', resourceId: holdingId, quantity: qty, qr: true, outputId };
}

async function createPhysicalIntake(args = {}) {
  await requireTables();
  if (!(await commercialProvenanceService.tablesReady())) {
    throw httpError('Commercial provenance tables are not installed', 503, 'NOT_INSTALLED');
  }
  const key = idempotencyKeyOf(args);
  const actor = actorOf(args);
  const host = args.host;
  const validated = validateRequest(args);
  const product = await loadActiveProduct(args.productId || args.product_id);
  const unit = trimText(args.unit) || trimText(product.unit) || 'Nos';
  if (!unit) {
    throw httpError('A unit is required.', 400, 'INTAKE_QUANTITY_INVALID');
  }
  const location = trimText(args.location || args.currentLocation) || 'Mumbai';
  const expectedMeta = {
    expectedPoNumber: trimText(args.expectedPoNumber || args.expected_po_number),
    procurementPoId: trimText(args.procurementPoId || args.procurement_po_id),
    procurementPoLineId: trimText(args.procurementPoLineId || args.procurement_po_line_id)
  };
  const fp = fingerprintOf({
    holdingType: validated.holdingType,
    intakeType: validated.intakeType,
    productId: product.id,
    quantity: validated.quantity,
    unit,
    reason: validated.reason,
    commercialChoice: validated.commercialChoice,
    expectedPoNumber: expectedMeta.expectedPoNumber,
    procurementPoId: expectedMeta.procurementPoId,
    procurementPoLineId: expectedMeta.procurementPoLineId
  });

  if (key) {
    const existing = await findByCreateKey(db, key);
    if (existing) {
      if (!sameFingerprint(existing, fp)) {
        throw httpError(
          'This Idempotency-Key was already used for a different Physical Intake.',
          409,
          'INTAKE_IDEMPOTENCY_CONFLICT'
        );
      }
      return hydrate(db, existing);
    }
  }

  try {
    return await db.transaction(async (trx) => {
      if (key) {
        const replay = await findByCreateKey(trx, key);
        if (replay) {
          if (!sameFingerprint(replay, fp)) {
            throw httpError(
              'This Idempotency-Key was already used for a different Physical Intake.',
              409,
              'INTAKE_IDEMPOTENCY_CONFLICT'
            );
          }
          return hydrate(trx, replay);
        }
      }

      const intakeId = await uniquePrefixedId(
        trx,
        'physical_intake',
        () => generatePhysicalIntakeId(),
        verifyPhysicalIntakeId,
        'Physical Intake'
      );
      const now = new Date().toISOString();
      const sourceJson = { ...validated.source, _fingerprint: fp };
      const approvingActor = validated.intakeType === 'OTHER_APPROVED'
        ? (trimText(args.approvingActor || args.approving_actor) || actor)
        : null;

      await trx('physical_intake').insert({
        id: intakeId,
        status: 'POSTED',
        holding_type: validated.holdingType,
        intake_type: validated.intakeType,
        product_id: product.id,
        quantity: validated.quantity,
        unit,
        reason: validated.reason,
        source_json: JSON.stringify(sourceJson),
        location,
        folder_id: validated.folderId,
        kind_id: validated.kindId,
        actor,
        approving_actor: approvingActor,
        idempotency_key: key,
        created_at: now,
        updated_at: now
      });
      if (key) {
        await trx('physical_intake_idempotency').insert({
          idempotency_key: key,
          physical_intake_id: intakeId,
          created_at: now
        });
      }

      await writeIntakeEvent(trx, {
        physicalIntakeId: intakeId,
        type: 'PHYSICAL_INTAKE_CREATED',
        productId: product.id,
        quantity: validated.quantity,
        unit,
        actor,
        reason: validated.reason,
        metadata: {
          intakeType: validated.intakeType,
          holdingType: validated.holdingType,
          origin: 'NON_PROCUREMENT_INTAKE',
          poChoice: validated.commercialChoice,
          poState: commercialProvenanceService.stateForChoice(validated.commercialChoice)
        }
      });

      let created;
      if (validated.holdingType === 'INVENTORY') {
        const folder = await resolveInventoryFolder(trx, {
          folderId: validated.folderId,
          kindId: validated.kindId,
          type: validated.type,
          category: validated.category
        });
        created = await createInventoryRow(trx, {
          product,
          qty: validated.quantity,
          unit,
          location,
          host,
          actor,
          intakeId,
          folder
        });
        await writeIntakeEvent(trx, {
          physicalIntakeId: intakeId,
          type: 'PHYSICAL_INTAKE_INVENTORY_CREATED',
          productId: product.id,
          quantity: validated.quantity,
          unit,
          actor,
          reason: validated.reason,
          resourceType: 'INVENTORY',
          resourceId: created.resourceId
        });
      } else {
        const hierarchy = await resolveAssetHierarchy(trx, {
          folderId: validated.folderId,
          kindId: validated.kindId,
          parentFolder: validated.parentFolder,
          type: validated.type,
          category: validated.category
        });
        created = await createAssetRow(trx, {
          product,
          qty: validated.quantity,
          unit,
          location,
          host,
          actor,
          intakeId,
          hierarchy
        });
        await writeIntakeEvent(trx, {
          physicalIntakeId: intakeId,
          type: 'PHYSICAL_INTAKE_ASSET_CREATED',
          productId: product.id,
          quantity: validated.quantity,
          unit,
          actor,
          reason: validated.reason,
          resourceType: 'ASSET',
          resourceId: created.resourceId
        });
      }

      const attached = await commercialProvenanceService.attachAtIntake(trx, {
        choice: validated.commercialChoice,
        args,
        resourceType: created.resourceType,
        resourceId: created.resourceId,
        quantity: validated.quantity,
        productId: product.id,
        physicalIntakeId: intakeId,
        physicalIntakeOutputId: created.outputId,
        actor
      });
      await commercialProvenanceService.writeIntakeProvenanceEvents(trx, {
        physicalIntakeId: intakeId,
        productId: product.id,
        quantity: validated.quantity,
        unit,
        actor,
        resourceType: created.resourceType,
        resourceId: created.resourceId,
        choice: attached.choice,
        state: attached.state,
        po: attached.po,
        line: attached.line,
        meta: attached.meta
      });

      const row = await trx('physical_intake').where({ id: intakeId }).first();
      const result = await hydrate(trx, row);
      result.created = created;
      return result;
    });
  } catch (err) {
    if (key && isUniqueViolation(err, 'physical_intake_idempotency_key_unique')) {
      const existing = await findByCreateKey(db, key);
      if (existing) {
        if (!sameFingerprint(existing, fp)) {
          throw httpError(
            'This Idempotency-Key was already used for a different Physical Intake.',
            409,
            'INTAKE_IDEMPOTENCY_CONFLICT'
          );
        }
        return hydrate(db, existing);
      }
    }
    if (key && isUniqueViolation(err, 'physical_intake_idempotency')) {
      const existing = await findByCreateKey(db, key);
      if (existing) return hydrate(db, existing);
    }
    throw err;
  }
}

async function getPhysicalIntake(id) {
  await requireTables();
  const intakeId = String(id || '').trim();
  if (!intakeId) throw httpError('Physical Intake id is required', 400, 'MISSING_ID');
  const row = await db('physical_intake').where({ id: intakeId }).first();
  if (!row) throw httpError('Physical Intake was not found', 404, 'NOT_FOUND');
  return hydrate(db, row);
}

async function listPhysicalIntakes(query = {}) {
  await requireTables();
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  let q = db('physical_intake').orderBy('created_at', 'desc');
  const holdingType = String(query.holdingType || query.holding_type || '').trim().toUpperCase();
  if (HOLDING_TYPES.includes(holdingType)) q = q.where('holding_type', holdingType);
  const intakeType = String(query.intakeType || query.intake_type || '').trim().toUpperCase();
  if (INTAKE_TYPES.includes(intakeType)) q = q.where('intake_type', intakeType);
  const productId = trimText(query.productId || query.product_id);
  if (productId) q = q.where('product_id', productId);
  const search = trimText(query.q);
  if (search) {
    const like = `%${search}%`;
    q = q.where(function whereSearch() {
      this.where('id', 'ilike', like)
        .orWhere('product_id', 'ilike', like)
        .orWhere('reason', 'ilike', like)
        .orWhere('actor', 'ilike', like);
    });
  }
  const countRow = await q.clone().clearOrder().count({ n: '*' }).first();
  const rows = await q.limit(limit).offset(offset);
  const intakes = [];
  for (const row of rows) {
    intakes.push(await hydrate(db, row));
  }
  return { intakes, total: Number(countRow && countRow.n ? countRow.n : 0), limit, offset };
}

async function listHistory(id) {
  const intake = await getPhysicalIntake(id);
  return { id: intake.id, events: intake.events || [] };
}

async function getProvenanceForHolding(resourceType, resourceId) {
  await requireTables();
  const type = String(resourceType || '').trim().toUpperCase();
  const id = trimText(resourceId);
  if (!id || !HOLDING_TYPES.includes(type)) return null;
  const table = type === 'ASSET' ? 'assets' : 'inventory_items';
  const holding = await db(table).where({ id }).first();
  if (!holding || !holding.physical_intake_id) return null;
  const intake = await db('physical_intake').where({ id: holding.physical_intake_id }).first();
  if (!intake) return null;
  const commercialProvenance = await commercialProvenanceService.getForHolding(db, type, id);
  return publicIntake(intake, {
    origin: 'NON_PROCUREMENT_INTAKE',
    physicalId: id,
    holdingType: type,
    commercialProvenance
  });
}

module.exports = {
  HOLDING_TYPES,
  INTAKE_TYPES,
  REASON_REQUIRED_TYPES,
  tablesReady,
  createPhysicalIntake,
  getPhysicalIntake,
  listPhysicalIntakes,
  listHistory,
  getProvenanceForHolding,
  publicIntake
};
