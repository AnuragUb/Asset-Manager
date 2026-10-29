/**
 * Phase 4 conversion engine.
 *
 * Cross-domain Inventory ↔ Asset quantity move. Does not import kitSetService,
 * zohoService, DC helpers, or project assign. Reuses reservation eligibility
 * and locking; does not duplicate reservation math.
 */
const qrcode = require('qrcode');
const {
  db,
  generateConversionId,
  verifyConversionId,
  generateModernAssetId
} = require('../utils');
const reservationService = require('./reservationService');

const DIRECTIONS = Object.freeze(['INVENTORY_TO_ASSET', 'ASSET_TO_INVENTORY']);
const GRANULARITIES = Object.freeze(['GROUPED', 'INDIVIDUAL']);
const CONDITIONS = Object.freeze(['AVAILABLE', 'INSPECTION', 'DAMAGED']);
const ID_RE = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{4}-[A-Z0-9]{6}-[A-Z0-9]$/;

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
  if (!Number.isFinite(n)) throw httpError('Invalid quantity value', 400, 'INVALID_QUANTITY');
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

function trimId(value, label) {
  const text = String(value || '').trim();
  if (!text) throw httpError(`${label} is required`, 400, 'MISSING_ID');
  return text;
}

function nonempty(value) {
  return value != null && String(value).trim() !== '';
}

function isQuantityTracked(row) {
  return Number(row && row.is_quantity_tracked) === 1;
}

function clientLabelFromId(id) {
  const parts = String(id || '').split('-');
  return `${parts[0] || 'AST'}-${parts[1] || 'LOC'}-${parts[3] || '000000'}`;
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

async function tablesReady(runner = db) {
  return runner.schema.hasTable('conversion');
}

async function requireTables(runner = db) {
  if (!(await tablesReady(runner))) {
    throw httpError('Conversion tables are not installed', 503, 'NOT_INSTALLED');
  }
}

async function uniqueConversionId(trx) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateConversionId();
    if (!verifyConversionId(id)) {
      throw httpError(`ID generator produced a non-canonical conversion id: ${id}`, 500);
    }
    const existing = await trx('conversion').where({ id }).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique conversion ID', 500);
}

async function uniqueAssetId(trx, location, type) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateModernAssetId(location || 'Mumbai', type || 'GEN');
    if (!ID_RE.test(id) || /-NaN$/i.test(id)) {
      throw httpError(`ID generator produced a non-canonical id: ${id}`, 500);
    }
    const existing = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    if (!existing) return id;
  }
  throw httpError('Could not allocate a unique AssetEngine ID', 500);
}

function publicConversion(row) {
  if (!row) return null;
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    quantity: row.quantity,
    quantityOriginal: row.quantity_original,
    granularity: row.granularity || null,
    condition: row.condition || null,
    productId: row.product_id || null,
    reason: row.reason || null,
    reasonCode: row.reason_code || null,
    reference: row.reference || null,
    idempotencyKey: row.idempotency_key || null,
    parentConversionId: row.parent_conversion_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicLine(row) {
  return {
    id: row.id,
    conversionId: row.conversion_id,
    holdingType: row.holding_type,
    holdingId: row.holding_id,
    role: row.role,
    quantity: row.quantity
  };
}

function publicEvent(row) {
  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch (err) {
      metadata = { raw: row.metadata_json };
    }
  }
  return {
    id: row.id,
    conversionId: row.conversion_id,
    type: row.type,
    quantity: row.quantity,
    actor: row.actor || null,
    timestamp: row.timestamp,
    note: row.note || null,
    metadata
  };
}

function publicHolding(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    itemname: row.itemname,
    productId: row.product_id || null,
    lineageStatus: row.lineage_status || 'ACTIVE',
    quantityOriginal: row.quantity_original,
    quantityTotal: row.quantity_total,
    quantityAvailable: row.quantity_available,
    quantityReserved: row.quantity_reserved == null ? 0 : row.quantity_reserved,
    quantityConverted: row.quantity_converted == null ? 0 : row.quantity_converted,
    quantityUnit: row.quantity_unit || null,
    quantityParentId: row.quantity_parent_id || null,
    quantityRootId: row.quantity_root_id || null,
    conversionSourceType: row.conversion_source_type || null,
    conversionSourceId: row.conversion_source_id || null,
    conversionRootType: row.conversion_root_type || null,
    conversionRootId: row.conversion_root_id || null,
    conversionId: row.conversion_id || null,
    qrcode: Boolean(row.qrcode),
    ...extra
  };
}

async function findByIdempotencyKey(runner, key) {
  if (!key) return null;
  return runner('conversion').where({ idempotency_key: key }).first();
}

function isUniqueViolation(err, name) {
  if (!err || String(err.code) !== '23505') return false;
  const hay = `${err.constraint || ''} ${err.message || ''}`;
  return hay.includes(name);
}

async function hydrate(runner, row) {
  const [lines, events] = await Promise.all([
    runner('conversion_line').where({ conversion_id: row.id }).orderBy('id'),
    runner('conversion_event').where({ conversion_id: row.id }).orderBy('id')
  ]);
  const destIds = lines.filter((l) => l.role === 'DESTINATION' && l.holding_type === 'ASSET').map((l) => l.holding_id);
  const assets = destIds.length
    ? await runner('assets').whereIn('id', destIds)
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return {
    conversion: publicConversion(row),
    lines: lines.map(publicLine),
    events: events.map(publicEvent),
    assets: destIds.map((id) => publicHolding(assetById.get(id) || { id }))
  };
}

async function writeConversionEvent(trx, { conversionId, type, quantity, actor, note, metadata }) {
  await trx('conversion_event').insert({
    conversion_id: conversionId,
    type,
    quantity,
    actor: actor || null,
    timestamp: new Date().toISOString(),
    note: note || null,
    metadata_json: metadata ? JSON.stringify(metadata) : null
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

async function lockInventory(trx, id) {
  const row = await trx('inventory_items')
    .whereRaw('LOWER(id) = LOWER(?)', [id])
    .forUpdate()
    .first();
  if (!row) throw httpError(`INVENTORY ${id} not found`, 404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function lockAsset(trx, id) {
  const row = await trx('assets')
    .whereRaw('LOWER(id) = LOWER(?)', [id])
    .forUpdate()
    .first();
  if (!row) throw httpError(`ASSET ${id} not found`, 404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function productSnapshot(trx, productId) {
  if (!nonempty(productId)) return null;
  const row = await trx('product').where({ id: productId }).first();
  if (!row) return { id: productId, name: null };
  return { id: row.id, name: row.name || null, make: row.make || null, model: row.model || null };
}

async function applyInventoryMove(trx, id, { deltaTotal, deltaAvailable, deltaConverted, precision }) {
  const p = declaredPrecision({ quantity_precision: precision });
  const result = await trx.raw(
    `
      UPDATE inventory_items
      SET quantity_total = ROUND((COALESCE(quantity_total, 0)::numeric + ?::numeric), ?),
          quantity_available = ROUND((COALESCE(quantity_available, 0)::numeric + ?::numeric), ?),
          quantity_converted = ROUND((COALESCE(quantity_converted, 0)::numeric + ?::numeric), ?),
          quantity_updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(id) = LOWER(?)
        AND ROUND((COALESCE(quantity_available, 0)::numeric + ?::numeric), ?) >= 0
        AND ROUND((COALESCE(quantity_converted, 0)::numeric + ?::numeric), ?) >= 0
        AND ROUND((COALESCE(quantity_total, 0)::numeric + ?::numeric), ?) >= 0
      RETURNING id, quantity_total, quantity_available, quantity_reserved, quantity_converted, quantity_original
    `,
    [
      deltaTotal, p,
      deltaAvailable, p,
      deltaConverted, p,
      id,
      deltaAvailable, p,
      deltaConverted, p,
      deltaTotal, p
    ]
  );
  const row = result.rows && result.rows[0];
  if (!row) {
    throw httpError(
      'Quantity update rejected (available/converted/total would become negative or row missing)',
      409,
      'INSUFFICIENT_AVAILABLE'
    );
  }
  const total = qtyNum(row.quantity_total);
  const available = qtyNum(row.quantity_available);
  const reserved = qtyNum(row.quantity_reserved);
  if (available + reserved - total > 1e-9) {
    throw httpError(
      `Quantity bounds failed for ${id}: available ${available} + reserved ${reserved} > total ${total}`,
      500,
      'CONSERVATION_FAILED'
    );
  }
  return row;
}

async function assertConvertedLedger(trx, inventoryId, precision) {
  const holding = await trx('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [inventoryId]).first();
  const sumRow = await trx('conversion')
    .where({ source_type: 'INVENTORY', direction: 'INVENTORY_TO_ASSET', status: 'ACTIVE' })
    .whereRaw('LOWER(source_id) = LOWER(?)', [inventoryId])
    .sum({ total: 'quantity' })
    .first();
  const ledger = qtyNum(sumRow && sumRow.total);
  const converted = qtyNum(holding && holding.quantity_converted);
  if (!qtyEq(ledger, converted, precision)) {
    throw httpError(
      `Conversion ledger mismatch on INVENTORY ${inventoryId}: SUM(ACTIVE)=${ledger} converted=${converted}`,
      500,
      'LEDGER_MISMATCH'
    );
  }
}

function conversionAssetFields(inventory, assetId, qty, qrDataUrl, now, lineage) {
  return {
    id: assetId,
    itemname: inventory.itemname,
    itemdescription: inventory.itemdescription || '',
    status: 'In Store',
    make: inventory.make || '',
    model: inventory.model || '',
    srno: '',
    type: inventory.type || '',
    category: inventory.category || '',
    icon: inventory.icon || '',
    isplaceholder: 0,
    parentid: null,
    currentlocation: inventory.currentlocation || '',
    dispatchreceivedt: null,
    purchasedetails: inventory.purchasedetails || '',
    remarks: inventory.remarks || '',
    purpose: inventory.purpose || 'Owned',
    lastupdated: now,
    qrcode: qrDataUrl,
    assignedto: '',
    client_label: clientLabelFromId(assetId),
    noqr: 0,
    company_id: inventory.company_id || null,
    currency: inventory.currency || 'INR',
    asset_value: 0,
    is_quantity_tracked: 1,
    is_batch: 0,
    is_set: 0,
    quantity_unit: inventory.quantity_unit || 'Nos',
    quantity_total: qty,
    quantity_available: qty,
    quantity_reserved: 0,
    quantity_converted: 0,
    quantity_precision: inventory.quantity_precision || 0,
    quantity_parent_id: null,
    quantity_root_id: assetId,
    quantity_original: qty,
    lineage_status: 'ACTIVE',
    product_id: inventory.product_id,
    conversion_unit: inventory.conversion_unit || null,
    conversion_factor: inventory.conversion_factor || null,
    conversion_mode: inventory.conversion_mode || null,
    conversion_source_type: 'INVENTORY',
    conversion_source_id: lineage.sourceId,
    conversion_root_type: 'INVENTORY',
    conversion_root_id: lineage.rootId,
    conversion_id: lineage.conversionId,
    quantity_updated_at: now
  };
}

async function assertInventoryConvertible(row) {
  if (Number(row.is_deleted) === 1) {
    throw httpError(`INVENTORY ${row.id} is deleted and cannot be converted`, 409, 'INVENTORY_NOT_CONVERTIBLE');
  }
  if (String(row.lineage_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
    throw httpError(`INVENTORY ${row.id} is inactive and cannot be converted`, 409, 'INVENTORY_NOT_CONVERTIBLE');
  }
  if (!isQuantityTracked(row)) {
    throw httpError(`INVENTORY ${row.id} is not quantity-tracked`, 400, 'NOT_QUANTITY_TRACKED');
  }
  if (!nonempty(row.product_id)) {
    throw httpError(
      `INVENTORY ${row.id} has no Product. Conversion requires a Product.`,
      409,
      'PRODUCT_REQUIRED'
    );
  }
}

async function assertAssetReturnable(trx, row) {
  if (Number(row.is_deleted) === 1) {
    throw httpError(`ASSET ${row.id} is deleted and cannot be returned`, 409, 'NOT_ACTIVE');
  }
  if (String(row.lineage_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
    throw httpError(`ASSET ${row.id} is inactive and cannot be returned`, 409, 'NOT_ACTIVE');
  }
  if (!nonempty(row.conversion_source_id) || String(row.conversion_source_type || '').toUpperCase() !== 'INVENTORY') {
    throw httpError(
      `ASSET ${row.id} has no Inventory conversion lineage and cannot be returned`,
      409,
      'NO_INVENTORY_LINEAGE'
    );
  }
  await reservationService.assertAssetEligible(trx, row);
  try {
    await reservationService.assertNoActiveReservations('ASSET', row.id, trx);
  } catch (err) {
    if (err.reasonCode === 'RESOURCE_HAS_ACTIVE_RESERVATION') {
      throw httpError(
        `ASSET ${row.id} has an active reservation and cannot be returned`,
        409,
        'ASSET_RESERVED',
        err.details
      );
    }
    throw err;
  }
  const children = await trx('assets')
    .whereRaw('LOWER(quantity_parent_id) = LOWER(?)', [row.id])
    .andWhere('lineage_status', 'ACTIVE')
    .select('id');
  if (children.length) {
    throw httpError(
      `ASSET ${row.id} has active Break children; return each child, or inactivate them first`,
      409,
      'ASSET_HAS_ACTIVE_CHILDREN',
      { childIds: children.map((c) => c.id) }
    );
  }
}

async function assertNoUnreturnedConversions(resourceType, resourceId, trx) {
  if (!(await tablesReady(trx || db))) return;
  const type = String(resourceType || '').trim().toUpperCase();
  const id = trimId(resourceId, 'resourceId');
  const runner = trx || db;
  const table = type === 'ASSET' ? 'assets' : 'inventory_items';
  const row = await runner(table).whereRaw('LOWER(id) = LOWER(?)', [id]).first();
  if (row && qtyNum(row.quantity_converted) > 0) {
    throw httpError(
      `${type} ${id} has unreturned converted quantity ${row.quantity_converted} and cannot be inactivated`,
      409,
      'UNRETURNED_CONVERSION'
    );
  }
  const active = await runner('conversion')
    .where({ source_type: type, status: 'ACTIVE' })
    .whereRaw('LOWER(source_id) = LOWER(?)', [id])
    .first();
  if (active) {
    throw httpError(
      `${type} ${id} has ACTIVE conversion ${active.id}; return that quantity before inactivating`,
      409,
      'UNRETURNED_CONVERSION',
      { conversionId: active.id }
    );
  }
}

function convertAssetQtys(granularity, quantity, precision) {
  if (granularity === 'INDIVIDUAL') {
    if (!qtyEq(quantity, Math.round(quantity), precision)) {
      throw httpError('Individual conversion quantity must be a whole number of units', 400, 'INVALID_QUANTITY');
    }
    const count = Math.round(quantity);
    return Array.from({ length: count }, () => roundQty(1, precision));
  }
  return [quantity];
}

async function convertInventoryToAsset(args = {}) {
  await requireTables();
  const sourceId = trimId(args.sourceId || args.source_id, 'sourceId');
  const granularity = String(args.granularity || 'GROUPED').trim().toUpperCase();
  if (!GRANULARITIES.includes(granularity)) {
    throw httpError('granularity must be GROUPED or INDIVIDUAL', 400, 'INVALID_TYPE');
  }
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;
  const reasonCode = args.reasonCode || args.reason_code
    ? String(args.reasonCode || args.reason_code).trim().slice(0, 32)
    : null;
  const reference = args.reference ? String(args.reference).slice(0, 255) : null;
  const idempotencyKey = args.idempotencyKey || args.idempotency_key
    ? String(args.idempotencyKey || args.idempotency_key).trim().slice(0, 64)
    : null;
  const host = args.host;

  const existingKey = await findByIdempotencyKey(db, idempotencyKey);
  if (existingKey) return hydrate(db, existingKey);

  try {
    return await db.transaction(async (trx) => {
      const replay = await findByIdempotencyKey(trx, idempotencyKey);
      if (replay) return hydrate(trx, replay);

      const inventory = await lockInventory(trx, sourceId);
      const replayAfterLock = await findByIdempotencyKey(trx, idempotencyKey);
      if (replayAfterLock) return hydrate(trx, replayAfterLock);

      await assertInventoryConvertible(inventory);
      const precision = declaredPrecision(inventory);
      const quantity = roundQty(args.quantity, precision);
      if (!(quantity > 0)) {
        throw httpError('Conversion quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      }
      const available = roundQty(inventory.quantity_available, precision);
      if (quantity - available > 1e-9) {
        const reserved = roundQty(inventory.quantity_reserved, precision);
        throw httpError(
          `Cannot convert ${quantity}. Only ${available} is available` +
            (reserved > 0 ? ` (${reserved} reserved).` : '.'),
          409,
          reserved > 0 && quantity > available ? 'RESERVED_QUANTITY_NOT_CONVERTIBLE' : 'INSUFFICIENT_AVAILABLE',
          { requested: quantity, available, reserved }
        );
      }

      const childQtys = convertAssetQtys(granularity, quantity, precision);
      const conversionId = await uniqueConversionId(trx);
      const rootId = inventory.quantity_root_id || inventory.id;
      const product = await productSnapshot(trx, inventory.product_id);
      const now = new Date().toISOString();

      await trx('conversion').insert({
        id: conversionId,
        direction: 'INVENTORY_TO_ASSET',
        status: 'ACTIVE',
        source_type: 'INVENTORY',
        source_id: inventory.id,
        quantity,
        quantity_original: quantity,
        granularity,
        condition: null,
        product_id: inventory.product_id,
        reason,
        reason_code: reasonCode,
        reference,
        idempotency_key: idempotencyKey,
        parent_conversion_id: null,
        created_by: actor,
        created_at: now,
        updated_at: now
      });

      await trx('conversion_line').insert({
        conversion_id: conversionId,
        holding_type: 'INVENTORY',
        holding_id: inventory.id,
        role: 'SOURCE',
        quantity
      });

      const created = [];
      for (const qty of childQtys) {
        const assetId = await uniqueAssetId(
          trx,
          inventory.currentlocation || inventory.CurrentLocation,
          inventory.type || inventory.Type
        );
        if (String(assetId).toLowerCase() === String(inventory.id).toLowerCase()) {
          throw httpError('Refusing to reuse Inventory ID as Asset ID', 500, 'IDENTITY_COLLISION');
        }
        const qrDataUrl = await buildQrDataUrl(host, 'asset', assetId);
        const fields = conversionAssetFields(inventory, assetId, qty, qrDataUrl, now, {
          sourceId: inventory.id,
          rootId,
          conversionId
        });
        await trx('assets').insert(fields);
        await trx('conversion_line').insert({
          conversion_id: conversionId,
          holding_type: 'ASSET',
          holding_id: assetId,
          role: 'DESTINATION',
          quantity: qty
        });
        await writeAssetHistory(
          trx,
          assetId,
          'CONVERT_FROM_INVENTORY',
          inventory.id,
          assetId,
          actor,
          `Converted ${qty} ${inventory.quantity_unit || ''} from ${inventory.id} (${conversionId})`
        );
        created.push(fields);
      }

      const updatedInv = await applyInventoryMove(trx, inventory.id, {
        deltaTotal: -quantity,
        deltaAvailable: -quantity,
        deltaConverted: quantity,
        precision
      });

      await writeConversionEvent(trx, {
        conversionId,
        type: 'CONVERT_INVENTORY_TO_ASSET',
        quantity,
        actor,
        note: reason,
        metadata: {
          source_id: inventory.id,
          destination_ids: created.map((a) => a.id),
          product_id: inventory.product_id,
          direction: 'INVENTORY_TO_ASSET',
          granularity,
          reason_code: reasonCode
        }
      });

      await writeQuantityEvent(trx, {
        table: 'inventory_items',
        rootId,
        type: 'CONVERT',
        actor,
        note: `Converted ${quantity} from ${inventory.id} to Asset`,
        metadata: {
          conversion_id: conversionId,
          source_id: inventory.id,
          destination_ids: created.map((a) => a.id),
          product_id: inventory.product_id,
          granularity
        },
        lines: [
          { id: inventory.id, unit: inventory.quantity_unit, deltaTotal: -quantity, deltaAvailable: -quantity }
        ]
      });

      for (const asset of created) {
        await writeQuantityEvent(trx, {
          table: 'assets',
          rootId: asset.id,
          type: 'CONVERT',
          actor,
          note: `Created from Inventory ${inventory.id}`,
          metadata: {
            conversion_id: conversionId,
            source_id: inventory.id,
            destination_id: asset.id,
            product_id: inventory.product_id
          },
          lines: [
            { id: asset.id, unit: asset.quantity_unit, deltaTotal: qtyNum(asset.quantity_total), deltaAvailable: qtyNum(asset.quantity_available) }
          ]
        });
      }

      await assertConvertedLedger(trx, inventory.id, precision);
      const breakService = require('./breakService');
      await breakService.assertConservation(trx, 'inventory_items', rootId, precision);

      const destSum = created.reduce((acc, a) => acc + qtyNum(a.quantity_total), 0);
      if (!qtyEq(destSum, quantity, precision)) {
        throw httpError('Destination Asset quantities do not equal requested conversion quantity', 500, 'CONSERVATION_FAILED');
      }

      const row = await trx('conversion').where({ id: conversionId }).first();
      const hydrated = await hydrate(trx, row);
      return {
        ...hydrated,
        source: publicHolding(Object.assign({}, inventory, updatedInv)),
        product
      };
    });
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err, 'conversion_idempotency_key_unique')) {
      const replay = await findByIdempotencyKey(db, idempotencyKey);
      if (replay) return hydrate(db, replay);
    }
    throw err;
  }
}

async function returnAssetToInventory(args = {}) {
  await requireTables();
  const sourceId = trimId(args.sourceId || args.source_id, 'sourceId');
  const condition = String(args.condition || '').trim().toUpperCase();
  if (!CONDITIONS.includes(condition)) {
    throw httpError('condition must be AVAILABLE, INSPECTION, or DAMAGED', 400, 'INVALID_TYPE');
  }
  const actor = args.actor || null;
  const reason = args.reason ? String(args.reason) : null;
  const reasonCode = args.reasonCode || args.reason_code
    ? String(args.reasonCode || args.reason_code).trim().slice(0, 32)
    : (condition === 'DAMAGED' ? 'DAMAGED' : condition === 'INSPECTION' ? 'INSPECTION' : null);
  const reference = args.reference ? String(args.reference).slice(0, 255) : null;
  const idempotencyKey = args.idempotencyKey || args.idempotency_key
    ? String(args.idempotencyKey || args.idempotency_key).trim().slice(0, 64)
    : null;

  const existingKey = await findByIdempotencyKey(db, idempotencyKey);
  if (existingKey) return hydrate(db, existingKey);

  try {
    return await db.transaction(async (trx) => {
      const replay = await findByIdempotencyKey(trx, idempotencyKey);
      if (replay) return hydrate(trx, replay);

      const peek = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [sourceId]).first();
      if (!peek) throw httpError(`ASSET ${sourceId} not found`, 404, 'RESOURCE_NOT_FOUND');
      const destId = peek.conversion_source_id;
      if (!nonempty(destId)) {
        throw httpError(
          `ASSET ${peek.id} has no Inventory conversion lineage and cannot be returned`,
          409,
          'NO_INVENTORY_LINEAGE'
        );
      }

      const inventory = await lockInventory(trx, destId);
      const asset = await lockAsset(trx, sourceId);
      const replayAfterLock = await findByIdempotencyKey(trx, idempotencyKey);
      if (replayAfterLock) return hydrate(trx, replayAfterLock);

      await assertAssetReturnable(trx, asset);
      if (String(asset.conversion_source_id).toLowerCase() !== String(inventory.id).toLowerCase()) {
        throw httpError('Return destination is not the immediate Inventory source', 409, 'NO_INVENTORY_LINEAGE');
      }
      if (Number(inventory.is_deleted) === 1) {
        throw httpError(`Immediate Inventory source ${inventory.id} is deleted`, 409, 'INVENTORY_LINEAGE_INACTIVE');
      }
      if (String(inventory.lineage_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
        throw httpError(
          `Immediate Inventory source ${inventory.id} is inactive; return will not collapse to the root`,
          409,
          'INVENTORY_LINEAGE_INACTIVE'
        );
      }

      const precision = declaredPrecision(asset);
      const quantity = roundQty(asset.quantity_total, precision);
      if (!(quantity > 0)) {
        throw httpError(`ASSET ${asset.id} has no remaining represented quantity to return`, 409, 'NOTHING_TO_RETURN');
      }

      const conversionId = await uniqueConversionId(trx);
      const now = new Date().toISOString();
      const parentConversionId = asset.conversion_id || null;
      const availableDelta = condition === 'AVAILABLE' ? quantity : 0;

      await trx('conversion').insert({
        id: conversionId,
        direction: 'ASSET_TO_INVENTORY',
        status: 'RETURNED',
        source_type: 'ASSET',
        source_id: asset.id,
        quantity: 0,
        quantity_original: quantity,
        granularity: null,
        condition,
        product_id: asset.product_id || inventory.product_id || null,
        reason,
        reason_code: reasonCode,
        reference,
        idempotency_key: idempotencyKey,
        parent_conversion_id: parentConversionId,
        created_by: actor,
        created_at: now,
        updated_at: now
      });

      await trx('conversion_line').insert([
        {
          conversion_id: conversionId,
          holding_type: 'ASSET',
          holding_id: asset.id,
          role: 'SOURCE',
          quantity
        },
        {
          conversion_id: conversionId,
          holding_type: 'INVENTORY',
          holding_id: inventory.id,
          role: 'DESTINATION',
          quantity
        }
      ]);

      if (parentConversionId) {
        const parent = await trx('conversion').where({ id: parentConversionId }).forUpdate().first();
        if (parent && parent.status === 'ACTIVE') {
          const remaining = roundQty(qtyNum(parent.quantity) - quantity, declaredPrecision({ quantity_precision: 6 }));
          if (remaining < -1e-9) {
            throw httpError(
              `Parent conversion ${parentConversionId} remaining ${parent.quantity} is less than return ${quantity}`,
              500,
              'LEDGER_MISMATCH'
            );
          }
          await trx('conversion').where({ id: parentConversionId }).update({
            quantity: remaining <= 0 ? 0 : remaining,
            status: remaining > 0 ? 'ACTIVE' : 'RETURNED',
            updated_at: now
          });
        }
      }

      const updatedInv = await applyInventoryMove(trx, inventory.id, {
        deltaTotal: quantity,
        deltaAvailable: availableDelta,
        deltaConverted: -quantity,
        precision: declaredPrecision(inventory)
      });

      await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [asset.id]).update({
        lineage_status: 'INACTIVE',
        quantity_available: 0,
        quantity_converted: roundQty(qtyNum(asset.quantity_converted) + quantity, precision),
        quantity_updated_at: now,
        lastupdated: now
      });

      await writeConversionEvent(trx, {
        conversionId,
        type: 'RETURN_ASSET_TO_INVENTORY',
        quantity,
        actor,
        note: reason,
        metadata: {
          source_id: asset.id,
          destination_id: inventory.id,
          product_id: asset.product_id || inventory.product_id || null,
          direction: 'ASSET_TO_INVENTORY',
          condition,
          reason_code: reasonCode,
          parent_conversion_id: parentConversionId
        }
      });

      await writeQuantityEvent(trx, {
        table: 'inventory_items',
        rootId: inventory.quantity_root_id || inventory.id,
        type: 'CONVERT_RETURN',
        actor,
        note: `Returned ${quantity} from ${asset.id} (${condition})`,
        metadata: {
          conversion_id: conversionId,
          source_id: asset.id,
          destination_id: inventory.id,
          condition,
          product_id: asset.product_id || inventory.product_id || null
        },
        lines: [
          {
            id: inventory.id,
            unit: inventory.quantity_unit,
            deltaTotal: quantity,
            deltaAvailable: availableDelta
          }
        ]
      });

      await writeQuantityEvent(trx, {
        table: 'assets',
        rootId: asset.quantity_root_id || asset.id,
        type: 'CONVERT_RETURN',
        actor,
        note: `Returned to Inventory ${inventory.id} (${condition})`,
        metadata: {
          conversion_id: conversionId,
          source_id: asset.id,
          destination_id: inventory.id,
          condition
        },
        lines: [
          { id: asset.id, unit: asset.quantity_unit, deltaTotal: 0, deltaAvailable: -qtyNum(asset.quantity_available) }
        ]
      });

      await writeAssetHistory(
        trx,
        asset.id,
        'RETURN_TO_INVENTORY',
        'ACTIVE',
        'INACTIVE',
        actor,
        `Returned ${quantity} ${asset.quantity_unit || ''} to ${inventory.id} as ${condition} (${conversionId})`
      );

      await assertConvertedLedger(trx, inventory.id, declaredPrecision(inventory));
      const breakService = require('./breakService');
      await breakService.assertConservation(
        trx,
        'inventory_items',
        inventory.quantity_root_id || inventory.id,
        declaredPrecision(inventory)
      );
      await breakService.assertConservation(
        trx,
        'assets',
        asset.quantity_root_id || asset.id,
        precision
      );

      const row = await trx('conversion').where({ id: conversionId }).first();
      const hydrated = await hydrate(trx, row);
      const updatedAsset = await trx('assets').where({ id: asset.id }).first();
      return {
        ...hydrated,
        source: publicHolding(updatedAsset),
        destination: publicHolding(Object.assign({}, inventory, updatedInv)),
        product: await productSnapshot(trx, asset.product_id || inventory.product_id)
      };
    });
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err, 'conversion_idempotency_key_unique')) {
      const replay = await findByIdempotencyKey(db, idempotencyKey);
      if (replay) return hydrate(db, replay);
    }
    throw err;
  }
}

async function createConversion(args = {}) {
  const direction = String(args.direction || '').trim().toUpperCase();
  if (!DIRECTIONS.includes(direction)) {
    throw httpError('direction must be INVENTORY_TO_ASSET or ASSET_TO_INVENTORY', 400, 'INVALID_TYPE');
  }
  if (direction === 'INVENTORY_TO_ASSET') return convertInventoryToAsset(args);
  return returnAssetToInventory(args);
}

/*
 * Reclassify an Asset as Inventory (PHYSICAL_TALLY_AUTHORITY_ADR §11).
 * Superuser-only (enforced by the route). The whole asset record moves; partial moves
 * Break first. Target is a new inventory item or an existing one of the same Product
 * and unit. Recorded as a RECLASSIFIED conversion; serial identities move with the unit.
 */
const RECLASSIFY_MIN_REASON = 10;
const RECLASSIFY_TARGETS = Object.freeze(['NEW', 'EXISTING']);
const NOT_IN_STORE_STATUSES = Object.freeze([
  'sold', 'scraped', 'scrapped', 'retired', 'consumed', 'lost', 'returned to vendor',
  'out on demo', 'out on rental', 'out for repair', 'out for internal use', 'in transit',
  'demo', 'rental', 'in-repair', 'in repair'
]);

async function notInStoreStatuses() {
  const catalog = await require('./dcReasonCatalog').assetStatuses();
  return new Set([...NOT_IN_STORE_STATUSES, ...catalog.map((s) => String(s).toLowerCase())]);
}

function normUnit(unit) {
  return String(unit || 'Nos').trim().toLowerCase();
}

function assetQuantity(asset) {
  return isQuantityTracked(asset) ? qtyNum(asset.quantity_total) : 1;
}

/** Every reason the asset cannot be reclassified right now (empty = allowed). */
async function reclassifyBlockers(runner, asset) {
  const out = [];
  const add = (reasonCode, message, details) => out.push({ reasonCode, message, ...(details ? { details } : {}) });
  if (Number(asset.is_deleted) === 1) add('ASSET_DELETED', `${asset.id} is deleted`);
  if (String(asset.lineage_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') add('ASSET_INACTIVE', `${asset.id} is inactive`);
  const statuses = await notInStoreStatuses();
  if (Number(asset.is_retired) === 1 || statuses.has(String(asset.status || '').trim().toLowerCase())) {
    add('ASSET_NOT_IN_STORE', `${asset.id} is "${asset.status}"; only in-store assets can be reclassified`);
  }
  if (Number(asset.is_set) === 1) add('ASSET_IS_SET', 'Set containers cannot be reclassified');
  if (!nonempty(asset.product_id)) add('ASSET_NO_PRODUCT', `${asset.id} has no Product; link a Product first`);

  const reservation = await runner('reservation')
    .where({ resource_type: 'ASSET', status: 'ACTIVE' })
    .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
    .first();
  if (reservation) {
    add('ASSET_RESERVED', `${asset.id} is reserved (${reservation.owner_type} ${reservation.owner_id}); release it first`,
      { reservationId: reservation.id });
  }
  if (await runner.schema.hasTable('managed_set_components')) {
    const component = await runner('managed_set_components')
      .where({ is_active: true })
      .whereRaw('LOWER(asset_id) = LOWER(?)', [asset.id])
      .first();
    if (component) add('ASSET_IN_SET', `${asset.id} is allocated to Set ${component.set_id}; release it first`);
  }
  const openDc = await runner('delivery_challans')
    .whereIn('lifecycle_status', ['DRAFT', 'READY'])
    .whereNull('voided_at')
    .andWhere(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
    .andWhereRaw('LOWER(CAST(assetids AS text)) LIKE ?', [`%"${String(asset.id).toLowerCase()}"%`])
    .first('id', 'challanno', 'lifecycle_status');
  if (openDc) {
    add('ASSET_ON_OPEN_DC', `${asset.id} is on open DC ${openDc.challanno || openDc.id} (${openDc.lifecycle_status})`);
  }
  const child = await runner('assets')
    .whereRaw('LOWER(quantity_parent_id) = LOWER(?)', [asset.id])
    .andWhere(function active() { this.whereNull('lineage_status').orWhere('lineage_status', 'ACTIVE'); })
    .andWhere(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
    .first('id');
  if (child) add('ASSET_HAS_ACTIVE_CHILDREN', `${asset.id} has active Break children (e.g. ${child.id}); reclassify each piece instead`);

  if (isQuantityTracked(asset)) {
    const total = qtyNum(asset.quantity_total);
    if (!(total > 0)) add('NOTHING_TO_RECLASSIFY', `${asset.id} has no quantity`);
    if (qtyNum(asset.quantity_reserved) > 1e-9 || Math.abs(qtyNum(asset.quantity_available) - total) > 1e-9) {
      add('ASSET_NOT_FULLY_FREE', `${asset.id} has ${qtyNum(asset.quantity_available)} of ${total} free; the whole quantity must be free (Break first to move part of it)`);
    }
  }
  return out;
}

/** Inventory items of the same Product and unit that may receive the asset. */
async function reclassifyTargetsFor(runner, asset) {
  if (!nonempty(asset.product_id)) return [];
  const statuses = [...(await notInStoreStatuses())];
  const rows = await runner('inventory_items')
    .where('product_id', asset.product_id)
    .where('is_quantity_tracked', 1)
    .andWhere(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
    .andWhere(function active() { this.whereNull('lineage_status').orWhere('lineage_status', 'ACTIVE'); })
    .andWhere(function inStore() {
      this.whereNull('status').orWhereRaw(`LOWER(TRIM(status)) NOT IN (${statuses.map(() => '?').join(', ')})`, statuses);
    })
    .select('id', 'itemname', 'status', 'currentlocation', 'quantity_total', 'quantity_available', 'quantity_unit', 'quantity_root_id')
    .orderBy('itemname', 'asc')
    .limit(200);
  return rows.filter((r) => normUnit(r.quantity_unit) === normUnit(asset.quantity_unit));
}

async function inventoryKinds(runner) {
  const rows = await runner('inventory_kinds as k')
    .leftJoin('inventory_folders as f', 'f.id', 'k.folderid')
    .where(function notDeleted() { this.where('k.is_deleted', 0).orWhereNull('k.is_deleted'); })
    .whereNotNull('k.folderid')
    .select('k.id', 'k.name', 'k.folderid', 'f.name as folder_name')
    .orderBy('k.name', 'asc');
  return rows.map((k) => ({ id: k.id, name: k.name, folderId: k.folderid, folderName: k.folder_name || k.folderid }));
}

async function resolveReclassifyKind(trx, kindId) {
  const kind = await trx('inventory_kinds')
    .where({ id: kindId })
    .where(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
    .first();
  if (!kind || !nonempty(kind.folderid)) {
    throw httpError('Choose an inventory Kind (it decides the folder of the new item)', 400, 'RECLASSIFY_KIND_REQUIRED');
  }
  return kind;
}

async function uniqueInventoryId(trx, location, type) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateModernAssetId(location || 'Mumbai', type || 'GEN');
    if (!ID_RE.test(id) || /-NaN$/i.test(id)) {
      throw httpError(`ID generator produced a non-canonical id: ${id}`, 500);
    }
    const [inv, asset] = await Promise.all([
      trx('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [id]).first('id'),
      trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id]).first('id')
    ]);
    if (!inv && !asset) return id;
  }
  throw httpError('Could not allocate a unique AssetEngine ID', 500);
}

/** Read-only: what the reclassify dialog needs (blockers + eligible existing items). */
async function reclassifyOptions(assetId) {
  await requireTables();
  const id = trimId(assetId, 'assetId');
  const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
  if (!asset) throw httpError(`ASSET ${id} not found`, 404, 'RESOURCE_NOT_FOUND');
  const serialCount = (await db.schema.hasTable('serial_identity'))
    ? Number((await db('serial_identity')
      .where({ resource_type: 'ASSET', status: 'ACTIVE' })
      .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
      .count('* as n')
      .first()).n)
    : 0;
  return {
    asset: {
      id: asset.id,
      name: asset.itemname,
      productId: asset.product_id || null,
      quantity: assetQuantity(asset),
      unit: asset.quantity_unit || 'Nos',
      quantityTracked: isQuantityTracked(asset),
      hasSerial: serialCount > 0 || nonempty(asset.srno),
      serialCount
    },
    minReasonLength: RECLASSIFY_MIN_REASON,
    blockers: await reclassifyBlockers(db, asset),
    kinds: await inventoryKinds(db),
    targets: (await reclassifyTargetsFor(db, asset)).map((r) => ({
      id: r.id,
      name: r.itemname,
      status: r.status,
      location: r.currentlocation,
      quantityTotal: qtyNum(r.quantity_total),
      quantityAvailable: qtyNum(r.quantity_available),
      unit: r.quantity_unit || 'Nos'
    }))
  };
}

async function reclassifyAssetToInventory(args = {}) {
  await requireTables();
  const assetId = trimId(args.assetId || args.sourceId, 'assetId');
  const target = String(args.target || '').trim().toUpperCase();
  if (!RECLASSIFY_TARGETS.includes(target)) {
    throw httpError('target must be NEW or EXISTING', 400, 'INVALID_TARGET');
  }
  const targetInventoryId = target === 'EXISTING' ? trimId(args.inventoryId, 'inventoryId') : null;
  const kindId = target === 'NEW' ? String(args.kindId || '').trim() : null;
  if (target === 'NEW' && !kindId) {
    throw httpError('Choose an inventory Kind (it decides the folder of the new item)', 400, 'RECLASSIFY_KIND_REQUIRED');
  }
  const reason = String(args.reason || '').trim().slice(0, 2000);
  if (reason.length < RECLASSIFY_MIN_REASON) {
    throw httpError(`Enter a reason (at least ${RECLASSIFY_MIN_REASON} characters)`, 400, 'RECLASSIFY_REASON_REQUIRED');
  }
  const actor = args.actor || null;
  const idempotencyKey = args.idempotencyKey ? String(args.idempotencyKey).trim().slice(0, 64) : null;
  if (target === 'NEW') requestHost(args.host);

  const run = async (trx) => {
    const replay = await findByIdempotencyKey(trx, idempotencyKey);
    if (replay) return hydrate(trx, replay);

    const asset = await lockAsset(trx, assetId);
    const blockers = await reclassifyBlockers(trx, asset);
    if (blockers.length) {
      const first = blockers[0];
      throw httpError(first.message, 409, first.reasonCode, { blockers });
    }
    const quantity = assetQuantity(asset);
    const precision = declaredPrecision(asset);
    const now = new Date().toISOString();
    const conversionId = await uniqueConversionId(trx);

    let destination;
    if (target === 'EXISTING') {
      destination = await lockInventory(trx, targetInventoryId);
      const eligible = (await reclassifyTargetsFor(trx, asset)).some(
        (r) => String(r.id).toLowerCase() === String(destination.id).toLowerCase()
      );
      if (!eligible) {
        throw httpError(
          `${destination.id} cannot receive ${asset.id}: it must be an active, in-store, quantity-tracked item of the same Product and unit`,
          409,
          'RECLASSIFY_TARGET_INVALID'
        );
      }
    }

    await trx('conversion').insert({
      id: conversionId,
      direction: 'ASSET_TO_INVENTORY',
      status: 'RECLASSIFIED',
      source_type: 'ASSET',
      source_id: asset.id,
      quantity: 0,
      quantity_original: quantity,
      granularity: null,
      condition: 'AVAILABLE',
      product_id: asset.product_id,
      reason,
      reason_code: target === 'NEW' ? 'RECLASSIFY_NEW' : 'RECLASSIFY_EXISTING',
      reference: destination ? destination.id : null,
      idempotency_key: idempotencyKey,
      parent_conversion_id: null,
      created_by: actor,
      created_at: now,
      updated_at: now
    });

    if (target === 'NEW') {
      const kind = await resolveReclassifyKind(trx, kindId);
      const newId = await uniqueInventoryId(trx, asset.currentlocation, kind.name);
      const qr = await buildQrDataUrl(args.host, 'inventory', newId);
      await trx('inventory_items').insert({
        id: newId,
        itemname: asset.itemname,
        itemdescription: asset.itemdescription || '',
        icon: asset.icon || '📦',
        status: 'In Store',
        make: asset.make || '',
        model: asset.model || '',
        srno: asset.srno || null,
        type: kind.name || 'Inventory',
        category: kind.name || 'Inventory',
        parentid: null,
        folderid: kind.folderid,
        kindid: kind.id,
        currentlocation: asset.currentlocation || '',
        remarks: `Reclassified from asset ${asset.id} (${conversionId})`,
        lastupdated: now,
        qrcode: qr,
        client_label: clientLabelFromId(newId),
        noqr: 0,
        quantity_total: quantity,
        quantity_available: quantity,
        quantity_precision: asset.quantity_precision || 0,
        is_quantity_tracked: 1,
        quantity_unit: asset.quantity_unit || 'Nos',
        is_batch: 0,
        is_set: 0,
        quantity_parent_id: null,
        quantity_root_id: newId,
        quantity_original: quantity,
        lineage_status: 'ACTIVE',
        product_id: asset.product_id,
        quantity_reserved: 0,
        quantity_converted: 0,
        quantity_updated_at: now,
        conversion_source_type: 'ASSET',
        conversion_source_id: asset.id,
        conversion_id: conversionId
      });
      destination = await lockInventory(trx, newId);
    } else {
      const invPrecision = declaredPrecision(destination);
      const rootId = destination.quantity_root_id || destination.id;
      await trx('inventory_items').where({ id: destination.id }).update({
        quantity_total: roundQty(qtyNum(destination.quantity_total) + quantity, invPrecision),
        quantity_available: roundQty(qtyNum(destination.quantity_available) + quantity, invPrecision),
        remarks: [destination.remarks, `+${quantity} reclassified from asset ${asset.id} (${conversionId})`]
          .filter(nonempty).join('\n'),
        quantity_updated_at: now,
        lastupdated: now
      });
      await trx('inventory_items')
        .whereRaw('LOWER(id) = LOWER(?)', [rootId])
        .whereNotNull('quantity_original')
        .update({ quantity_original: trx.raw('quantity_original + ?', [quantity]) });
    }

    await trx('conversion_line').insert([
      { conversion_id: conversionId, holding_type: 'ASSET', holding_id: asset.id, role: 'SOURCE', quantity },
      { conversion_id: conversionId, holding_type: 'INVENTORY', holding_id: destination.id, role: 'DESTINATION', quantity }
    ]);

    let serialsMoved = 0;
    if (await trx.schema.hasTable('serial_identity')) {
      const serials = await trx('serial_identity')
        .where({ resource_type: 'ASSET', status: 'ACTIVE' })
        .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
        .orderBy('sort_order', 'asc');
      if (serials.length) {
        const maxRow = await trx('serial_identity')
          .where({ resource_type: 'INVENTORY', resource_id: destination.id })
          .max('sort_order as m')
          .first();
        let next = Number(maxRow && maxRow.m != null ? maxRow.m : -1) + 1;
        for (const s of serials) {
          await trx('serial_identity')
            .where({ resource_type: s.resource_type, resource_id: s.resource_id, sort_order: s.sort_order })
            .update({ resource_type: 'INVENTORY', resource_id: destination.id, sort_order: next, updated_at: now });
          next += 1;
          serialsMoved += 1;
        }
      }
    }

    await trx('assets').where({ id: asset.id }).update({
      lineage_status: 'INACTIVE',
      quantity_available: 0,
      quantity_converted: roundQty(qtyNum(asset.quantity_converted) + quantity, precision),
      quantity_updated_at: now,
      lastupdated: now
    });

    await writeConversionEvent(trx, {
      conversionId,
      type: 'RECLASSIFY_ASSET_TO_INVENTORY',
      quantity,
      actor,
      note: reason,
      metadata: {
        source_id: asset.id,
        destination_id: destination.id,
        target,
        product_id: asset.product_id,
        prior_status: asset.status || null,
        srno_encrypted: asset.srno || null,
        serials_moved: serialsMoved
      }
    });

    if (isQuantityTracked(asset)) {
      await writeQuantityEvent(trx, {
        table: 'assets',
        rootId: asset.quantity_root_id || asset.id,
        type: 'RECLASSIFY_OUT',
        actor,
        note: `Reclassified ${quantity} to inventory ${destination.id}: ${reason}`,
        metadata: { conversion_id: conversionId, source_id: asset.id, destination_id: destination.id },
        lines: [{ id: asset.id, unit: asset.quantity_unit, deltaTotal: 0, deltaAvailable: -qtyNum(asset.quantity_available) }]
      });
    }
    await writeQuantityEvent(trx, {
      table: 'inventory_items',
      rootId: destination.quantity_root_id || destination.id,
      type: 'RECLASSIFY_IN',
      actor,
      note: `Reclassified ${quantity} from asset ${asset.id}: ${reason}`,
      metadata: { conversion_id: conversionId, source_id: asset.id, destination_id: destination.id, target },
      lines: [{ id: destination.id, unit: destination.quantity_unit, deltaTotal: quantity, deltaAvailable: quantity }]
    });

    await writeAssetHistory(
      trx,
      asset.id,
      'RECLASSIFIED_TO_INVENTORY',
      'ACTIVE',
      'INACTIVE',
      actor,
      `Reclassified ${quantity} ${asset.quantity_unit || ''} to ${target === 'NEW' ? 'new' : 'existing'} inventory ${destination.id} (${conversionId})${serialsMoved ? `; ${serialsMoved} serial(s) moved` : ''} — ${reason}`
    );

    const breakService = require('./breakService');
    await breakService.assertConservation(
      trx, 'inventory_items', destination.quantity_root_id || destination.id, declaredPrecision(destination)
    );
    if (isQuantityTracked(asset) && asset.quantity_root_id) {
      await breakService.assertConservation(trx, 'assets', asset.quantity_root_id, precision);
    }

    const row = await trx('conversion').where({ id: conversionId }).first();
    const hydrated = await hydrate(trx, row);
    const updatedAsset = await trx('assets').where({ id: asset.id }).first();
    const updatedInv = await trx('inventory_items').where({ id: destination.id }).first();
    return {
      ...hydrated,
      target,
      serialsMoved,
      source: publicHolding(updatedAsset),
      destination: publicHolding(updatedInv)
    };
  };

  if (args.trx) return run(args.trx);
  const existingKey = await findByIdempotencyKey(db, idempotencyKey);
  if (existingKey) return hydrate(db, existingKey);
  try {
    return await db.transaction(run);
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err, 'conversion_idempotency_key_unique')) {
      const replay = await findByIdempotencyKey(db, idempotencyKey);
      if (replay) return hydrate(db, replay);
    }
    throw err;
  }
}

async function getById(id) {
  await requireTables();
  const row = await db('conversion').where({ id: trimId(id, 'id') }).first();
  if (!row) throw httpError(`Conversion ${id} not found`, 404, 'NOT_FOUND');
  return hydrate(db, row);
}

async function list(filters = {}) {
  await requireTables();
  let q = db('conversion').orderBy('created_at', 'desc');
  if (filters.direction) q = q.andWhere('direction', String(filters.direction).toUpperCase());
  if (filters.sourceType || filters.source_type) {
    q = q.andWhere('source_type', String(filters.sourceType || filters.source_type).toUpperCase());
  }
  if (filters.sourceId || filters.source_id) {
    q = q.andWhereRaw('LOWER(source_id) = LOWER(?)', [filters.sourceId || filters.source_id]);
  }
  if (filters.status) q = q.andWhere('status', String(filters.status).toUpperCase());
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const rows = await q.limit(limit);
  return { conversions: rows.map(publicConversion) };
}

async function listForResource(resourceType, resourceId) {
  await requireTables();
  const type = String(resourceType || '').trim().toUpperCase();
  const id = trimId(resourceId, 'resourceId');
  if (type !== 'ASSET' && type !== 'INVENTORY') {
    throw httpError('resourceType must be ASSET or INVENTORY', 400, 'INVALID_TYPE');
  }
  const asSource = await db('conversion')
    .where({ source_type: type })
    .whereRaw('LOWER(source_id) = LOWER(?)', [id])
    .orderBy('created_at', 'desc');
  const asLine = await db('conversion_line')
    .where({ holding_type: type })
    .whereRaw('LOWER(holding_id) = LOWER(?)', [id])
    .select('conversion_id');
  const extraIds = asLine.map((l) => l.conversion_id).filter((cid) => !asSource.some((s) => s.id === cid));
  const extra = extraIds.length
    ? await db('conversion').whereIn('id', extraIds).orderBy('created_at', 'desc')
    : [];
  const rows = [...asSource, ...extra];
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return {
    resourceType: type,
    resourceId: id,
    conversions: unique.map(publicConversion)
  };
}

module.exports = {
  DIRECTIONS,
  GRANULARITIES,
  CONDITIONS,
  createConversion,
  convertInventoryToAsset,
  returnAssetToInventory,
  reclassifyAssetToInventory,
  reclassifyOptions,
  getById,
  list,
  listForResource,
  assertNoUnreturnedConversions,
  tablesReady,
  qtyNum,
  roundQty,
  qtyEq
};
