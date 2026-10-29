/**
 * Phase 9 procurement mirror: Zoho CRM Purchase Orders as read-only AE context.
 * Does not create Zoho POs. Does not rewrite project_orders.
 */
const crypto = require('crypto');
const {
  db,
  generateProcurementPoId,
  verifyProcurementPoId,
  generateProcurementPoLineId,
  verifyProcurementPoLineId,
  generateProcurementSyncEventId,
  verifyProcurementSyncEventId
} = require('../utils');

const RECEIVE_STATUSES = Object.freeze(['APPROVED', 'DELIVERED']);
const STALE_MS = 5 * 60 * 1000;

let zohoGateway = null;

function setZohoGateway(gateway) {
  zohoGateway = gateway;
}

function zohoProc() {
  return zohoGateway || require('./zohoProcurementService');
}

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

function roundQty(value, precision = 6) {
  const n = qtyNum(value);
  const f = 10 ** precision;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Normalize stored PO calendar dates (including legacy Date.toString dumps). */
function normalizeStoredPoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  const isoDay = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) return isoDay[1];
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return text;
}

function asZohoIdString(value, fieldName = 'external_id') {
  if (value == null || value === '') {
    throw httpError(`${fieldName} is required`, 400, 'INVALID_ZOHO_ID');
  }
  if (typeof value === 'number') {
    throw httpError(`${fieldName} must be sent as a decimal string`, 400, 'INVALID_ZOHO_ID');
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw httpError(`${fieldName} must be a decimal string`, 400, 'INVALID_ZOHO_ID');
  }
  return text;
}

function sourceHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function tablesReady() {
  return db.schema.hasTable('procurement_po');
}

async function requireTables() {
  if (!(await tablesReady())) {
    throw httpError('Procurement tables are not installed', 503, 'PROCUREMENT_NOT_INSTALLED');
  }
}

async function uniquePrefixedId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) throw httpError(`ID generator produced a non-canonical ${label} id`, 500);
    const existing = await trx(table).where({ id }).first();
    if (!existing) return id;
  }
  throw httpError(`Could not allocate a unique ${label} ID`, 500);
}

async function writeSyncEvent(trx, row) {
  const id = await uniquePrefixedId(
    trx,
    'procurement_sync_event',
    generateProcurementSyncEventId,
    verifyProcurementSyncEventId,
    'sync event'
  );
  await trx('procurement_sync_event').insert({
    id,
    procurement_po_id: row.procurementPoId || null,
    zoho_po_id: row.zohoPoId || null,
    operation: row.operation,
    status: row.status,
    actor: row.actor || null,
    changed_fields: row.changedFields || null,
    error_message: row.errorMessage || null,
    source_updated_at: row.sourceUpdatedAt || null,
    created_at: new Date().toISOString()
  });
  return id;
}

async function acceptedToDate(runner, poLineId, exceptNoteId) {
  let q = runner('receipt_note_line as l')
    .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
    .where('l.po_line_id', String(poLineId))
    .where('n.status', 'POSTED');
  if (exceptNoteId) q = q.andWhereNot('n.id', exceptNoteId);
  const row = await q.sum({ total: 'l.qty_accepted' }).first();
  return roundQty(row && row.total, 6);
}

async function qtyLedger(runner, poLineId) {
  const row = await runner('receipt_note_line as l')
    .join('receipt_note as n', 'n.id', 'l.receipt_note_id')
    .where('l.po_line_id', String(poLineId))
    .where('n.status', 'POSTED')
    .select(
      runner.raw('coalesce(sum(l.qty_accepted),0) as accepted'),
      runner.raw('coalesce(sum(l.qty_rejected),0) as rejected'),
      runner.raw('coalesce(sum(l.qty_damaged),0) as damaged')
    )
    .first();
  return {
    accepted: roundQty(row && row.accepted),
    rejected: roundQty(row && row.rejected),
    damaged: roundQty(row && row.damaged)
  };
}

function lineQuantities(orderedQty, ledger) {
  const ordered = roundQty(orderedQty);
  const accepted = roundQty(ledger.accepted);
  const rejected = roundQty(ledger.rejected);
  const damaged = roundQty(ledger.damaged);
  const outstanding = ordered >= accepted ? roundQty(ordered - accepted) : 0;
  const reconciliationRequired = ordered + 1e-9 < accepted;
  return {
    ordered,
    accepted,
    rejected,
    damaged,
    outstanding,
    onOrder: outstanding,
    reconciliationRequired,
    reconciliationStatus: reconciliationRequired ? 'RECONCILIATION_REQUIRED' : 'OK'
  };
}

async function resolveProductId(runner, zohoProductId) {
  if (!zohoProductId) return null;
  const ref = await runner('product_external_ref')
    .where({
      system: 'ZOHO_CRM',
      module: 'Products',
      external_id: String(zohoProductId)
    })
    .first();
  return ref ? ref.product_id : null;
}

async function resolveZohoProductName(runner, remoteLine) {
  const fromRemote = remoteLine && remoteLine.zohoProductName
    ? String(remoteLine.zohoProductName).trim()
    : '';
  if (fromRemote) return fromRemote;
  const zohoProductId = remoteLine && remoteLine.zohoProductId
    ? String(remoteLine.zohoProductId).trim()
    : '';
  if (!zohoProductId) return null;
  if (!(await runner.schema.hasTable('zoho_catalog'))) return null;
  const cat = await runner('zoho_catalog').where({ zoho_product_id: zohoProductId }).first();
  return cat && cat.product_name ? String(cat.product_name).trim() : null;
}

async function mapRemoteLine(runner, remoteLine) {
  const productId = await resolveProductId(runner, remoteLine.zohoProductId);
  const zohoProductName = await resolveZohoProductName(runner, remoteLine);
  const description = remoteLine.description != null && String(remoteLine.description).trim() !== ''
    ? String(remoteLine.description).trim()
    : null;
  return {
    zohoLineId: remoteLine.zohoLineId,
    zohoProductId: remoteLine.zohoProductId || null,
    zohoProductName,
    productId,
    sequenceNumber: remoteLine.sequenceNumber == null ? null : Number(remoteLine.sequenceNumber),
    description,
    orderedQty: roundQty(remoteLine.quantity),
    unit: remoteLine.unit || 'Nos',
    listPrice: remoteLine.listPrice,
    discount: remoteLine.discount,
    tax: remoteLine.tax,
    netTotal: remoteLine.netTotal,
    mappingRequired: !productId,
    sourceHash: sourceHash({
      zohoLineId: remoteLine.zohoLineId,
      zohoProductId: remoteLine.zohoProductId || null,
      quantity: roundQty(remoteLine.quantity),
      listPrice: remoteLine.listPrice
    })
  };
}

function headerHash(remote) {
  return sourceHash({
    zohoPoId: remote.zohoPoId,
    poNumber: remote.poNumber,
    outboundPoIdentifier: remote.outboundPoIdentifier,
    outboundPoNumber: remote.outboundPoNumber,
    poVersionNumber: remote.poVersionNumber,
    status: remote.status,
    vendorZohoId: remote.vendorZohoId,
    accountZohoId: remote.accountZohoId,
    customerId: remote.customerId,
    dueDate: remote.dueDate,
    lines: (remote.lines || []).map((l) => ({
      zohoLineId: l.zohoLineId,
      quantity: l.quantity,
      zohoProductId: l.zohoProductId
    }))
  });
}

function deriveSyncStatus(po, lines) {
  if (String(po.status).toUpperCase() === 'CANCELLED') return 'CANCELLED';
  if (po.last_error) return 'FAILED';
  if ((lines || []).some((l) => l.reconciliationRequired)) return 'RECONCILIATION_REQUIRED';
  if (po.last_synced_at) return 'SYNCED';
  return 'IMPORTED';
}

async function accountDisplayName(runner, po) {
  const snapshot = po.account_name_snapshot || null;
  const zohoId = po.account_zoho_id != null ? String(po.account_zoho_id) : '';
  if (!zohoId || !(await runner.schema.hasTable('zoho_account'))) return snapshot;
  const account = await runner('zoho_account').where({ zoho_id: zohoId }).first('account_name');
  return (account && account.account_name) || snapshot;
}

async function publicPo(runner, po, { includeLines = true } = {}) {
  const lines = includeLines
    ? await runner('procurement_po_line').where({ procurement_po_id: po.id }).orderBy('sequence_number', 'asc')
    : [];
  const publicLines = [];
  for (const line of lines) {
    if (String(line.line_status || '').toUpperCase() === 'WITHDRAWN') continue;
    const ledger = await qtyLedger(runner, line.id);
    const qty = lineQuantities(line.ordered_qty, ledger);
    publicLines.push({
      id: line.id,
      zohoLineId: line.zoho_line_id != null ? String(line.zoho_line_id) : null,
      zohoProductId: line.zoho_product_id != null ? String(line.zoho_product_id) : null,
      productId: line.product_id,
      sequenceNumber: line.sequence_number,
      productName: line.zoho_product_name || null,
      zohoProductName: line.zoho_product_name || null,
      description: line.description,
      unit: line.unit,
      listPrice: line.list_price,
      discount: line.discount,
      tax: line.tax,
      netTotal: line.net_total,
      lineStatus: line.line_status,
      mappingRequired: !line.product_id,
      ...qty
    });
  }
  const anyMapping = publicLines.some((l) => l.mappingRequired);
  const anyRecon = publicLines.some((l) => l.reconciliationRequired);
  return {
    id: po.id,
    source: 'ZOHO',
    classification: po.classification,
    zohoPoId: po.zoho_po_id != null ? String(po.zoho_po_id) : null,
    poNumber: po.outbound_po_identifier || null,
    outboundPoIdentifier: po.outbound_po_identifier || null,
    outboundPoNumber: po.outbound_po_number || null,
    poVersionNumber: po.po_version_number != null ? Number(po.po_version_number) : null,
    subject: po.subject,
    status: po.status,
    vendorZohoId: po.vendor_zoho_id != null ? String(po.vendor_zoho_id) : null,
    vendorName: po.vendor_name_snapshot,
    accountZohoId: po.account_zoho_id != null ? String(po.account_zoho_id) : null,
    accountName: await accountDisplayName(runner, po),
    customerId: po.customer_id || null,
    poDate: normalizeStoredPoDate(po.po_date),
    dueDate: normalizeStoredPoDate(po.due_date),
    currency: po.currency,
    subTotal: po.sub_total,
    discount: po.discount,
    tax: po.tax,
    grandTotal: po.grand_total,
    projectId: po.project_id,
    lastSyncedAt: po.last_synced_at,
    lastError: po.last_error,
    zohoModifiedAt: po.zoho_modified_at,
    createdAt: po.created_at,
    updatedAt: po.updated_at,
    createdBy: po.created_by,
    updatedBy: po.updated_by,
    syncStatus: anyRecon ? 'RECONCILIATION_REQUIRED' : deriveSyncStatus(po, publicLines),
    mappingRequired: anyMapping,
    reconciliationRequired: anyRecon,
    lines: publicLines
  };
}

async function findByZohoId(runner, zohoPoId) {
  return runner('procurement_po').where({ zoho_po_id: String(zohoPoId) }).first();
}

function trimOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function isInternalPoId(value) {
  return /^PPO-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$/.test(String(value || '').trim());
}

/**
 * Build header columns from a Zoho remote PO.
 * The internal PPO- row id is not a commercial number.
 * Identifier, number, and version are stored separately and kept when Zoho
 * later returns them blank.
 */
function headerPatch(remote, actor, hash, existing) {
  const identifier = trimOrNull(remote.outboundPoIdentifier)
    || (existing ? trimOrNull(existing.outbound_po_identifier) : null);
  const outboundNumber = trimOrNull(remote.outboundPoNumber)
    || (existing ? trimOrNull(existing.outbound_po_number) : null);
  const legacyNumber = trimOrNull(remote.legacyPoNumber);
  const existingPoNumber = existing && !isInternalPoId(existing.po_number)
    ? trimOrNull(existing.po_number)
    : null;
  const version = remote.poVersionNumber != null
    ? remote.poVersionNumber
    : (existing ? existing.po_version_number : null);
  return {
    po_number: identifier || outboundNumber || legacyNumber || existingPoNumber || null,
    outbound_po_identifier: identifier,
    outbound_po_number: outboundNumber || legacyNumber || null,
    po_version_number: version,
    subject: remote.subject,
    status: remote.status,
    vendor_zoho_id: remote.vendorZohoId,
    vendor_name_snapshot: remote.vendorName,
    account_zoho_id: remote.accountZohoId || null,
    account_name_snapshot: remote.accountName || null,
    customer_id: trimOrNull(remote.customerId),
    po_date: remote.poDate,
    due_date: remote.dueDate,
    sub_total: remote.subTotal,
    discount: remote.discount,
    tax: remote.tax,
    grand_total: remote.grandTotal,
    source_hash: hash,
    zoho_modified_at: remote.modifiedTime || null,
    last_synced_at: new Date().toISOString(),
    last_error: null,
    last_error_at: null,
    updated_by: actor || null,
    updated_at: new Date().toISOString()
  };
}

async function headerForWrite(trx, remote, actor, hash, existing) {
  const patch = headerPatch(remote, actor, hash, existing);
  if (!(await trx.schema.hasColumn('procurement_po', 'outbound_po_identifier'))) {
    delete patch.outbound_po_identifier;
    delete patch.outbound_po_number;
    delete patch.po_version_number;
  }
  if (!(await trx.schema.hasColumn('procurement_po', 'account_zoho_id'))) {
    delete patch.account_zoho_id;
    delete patch.account_name_snapshot;
  }
  if (!(await trx.schema.hasColumn('procurement_po', 'customer_id'))) {
    delete patch.customer_id;
  }
  return patch;
}

async function upsertLines(trx, poId, remoteLines, actor) {
  const existing = await trx('procurement_po_line').where({ procurement_po_id: poId }).forUpdate();
  const byZoho = new Map(existing.map((row) => [String(row.zoho_line_id), row]));
  const seen = new Set();
  const warnings = [];
  for (const mapped of remoteLines) {
    seen.add(mapped.zohoLineId);
    const current = byZoho.get(mapped.zohoLineId);
    if (current) {
      const ledger = await qtyLedger(trx, current.id);
      if (ledger.accepted > 0 && current.product_id && mapped.productId && current.product_id !== mapped.productId) {
        warnings.push({
          poLineId: current.id,
          code: 'PRODUCT_LOCKED',
          message: 'Posted receipts exist; Product on this line was not changed'
        });
        mapped.productId = current.product_id;
      }
      await trx('procurement_po_line').where({ id: current.id }).update({
        zoho_product_id: mapped.zohoProductId,
        zoho_product_name: mapped.zohoProductName,
        product_id: mapped.productId,
        sequence_number: mapped.sequenceNumber,
        description: mapped.description,
        ordered_qty: mapped.orderedQty,
        unit: mapped.unit,
        list_price: mapped.listPrice,
        discount: mapped.discount,
        tax: mapped.tax,
        net_total: mapped.netTotal,
        line_status: 'OPEN',
        source_hash: mapped.sourceHash,
        updated_at: new Date().toISOString()
      });
    } else {
      const lineId = await uniquePrefixedId(
        trx,
        'procurement_po_line',
        generateProcurementPoLineId,
        verifyProcurementPoLineId,
        'PO line'
      );
      await trx('procurement_po_line').insert({
        id: lineId,
        procurement_po_id: poId,
        zoho_line_id: mapped.zohoLineId,
        zoho_product_id: mapped.zohoProductId,
        zoho_product_name: mapped.zohoProductName,
        product_id: mapped.productId,
        sequence_number: mapped.sequenceNumber,
        description: mapped.description,
        ordered_qty: mapped.orderedQty,
        unit: mapped.unit,
        list_price: mapped.listPrice,
        discount: mapped.discount,
        tax: mapped.tax,
        net_total: mapped.netTotal,
        line_status: 'OPEN',
        source_hash: mapped.sourceHash,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }
  for (const row of existing) {
    if (seen.has(String(row.zoho_line_id))) continue;
    const ledger = await qtyLedger(trx, row.id);
    if (ledger.accepted > 0) {
      await trx('procurement_po_line').where({ id: row.id }).update({
        line_status: 'WITHDRAWN',
        updated_at: new Date().toISOString()
      });
      warnings.push({ poLineId: row.id, code: 'LINE_WITHDRAWN', message: 'Zoho removed a line that already has receipts' });
    } else {
      await trx('procurement_po_line').where({ id: row.id }).update({
        line_status: 'WITHDRAWN',
        updated_at: new Date().toISOString()
      });
    }
  }
  return warnings;
}

/**
 * Fill procurement_po_line.product_id from product_external_ref when Zoho
 * commercial fields are unchanged. Refresh previously skipped this, so a
 * Product linked after PO import stayed "mapping required" forever.
 */
async function applyResolvedMappings(trx, poId, mappedLines) {
  const existing = await trx('procurement_po_line').where({ procurement_po_id: poId }).forUpdate();
  const byZoho = new Map(existing.map((row) => [String(row.zoho_line_id), row]));
  const warnings = [];
  let filled = 0;
  for (const mapped of mappedLines) {
    const current = byZoho.get(String(mapped.zohoLineId));
    if (!current) continue;
    const nextProductId = mapped.productId || null;
    const nextZohoProductId = mapped.zohoProductId || null;
    if (current.product_id && nextProductId && current.product_id !== nextProductId) {
      const ledger = await qtyLedger(trx, current.id);
      if (ledger.accepted > 0) {
        warnings.push({
          poLineId: current.id,
          code: 'PRODUCT_LOCKED',
          message: 'Posted receipts exist; Product on this line was not changed'
        });
        continue;
      }
    }
    if (current.product_id && !nextProductId) continue;
    const productChanged = (current.product_id || null) !== nextProductId;
    const zohoChanged = String(current.zoho_product_id || '') !== String(nextZohoProductId || '');
    if (!productChanged && !zohoChanged) continue;
    await trx('procurement_po_line').where({ id: current.id }).update({
      product_id: nextProductId || current.product_id,
      zoho_product_id: nextZohoProductId,
      updated_at: new Date().toISOString()
    });
    filled += 1;
  }
  return { filled, warnings };
}

async function applyDealProjectAccount(runner, remote) {
  const projectId = trimOrNull(remote.customerId);
  if (!projectId) return remote;
  const ready = await runner.raw(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'utility'
      AND table_name = 'zoho_deal_projects'
      AND column_name = 'project_id'
  `);
  if (!ready.rows.length) return remote;
  const deal = await runner('zoho_deal_projects')
    .whereRaw('btrim(project_id) = ?', [projectId])
    .whereNull('missing_at')
    .orderByRaw('account_zoho_id nulls last')
    .first();
  if (!deal) return remote;
  remote.accountZohoId = deal.account_zoho_id || null;
  remote.accountName = deal.account_name || null;
  return remote;
}

async function persistRemote(remote, actor, operation, { force = false } = {}) {
  await applyDealProjectAccount(db, remote);
  const hash = headerHash(remote);
  const mappedLines = [];
  for (const line of remote.lines || []) {
    mappedLines.push(await mapRemoteLine(db, line));
  }
  return db.transaction(async (trx) => {
    let po = await findByZohoId(trx, remote.zohoPoId);
    const warnings = [];
    if (po && po.source_hash === hash && operation === 'REFRESH' && !force) {
      const mapping = await applyResolvedMappings(trx, po.id, mappedLines);
      warnings.push(...mapping.warnings);
      const identity = await headerForWrite(trx, remote, actor, hash, po);
      const kept = {
        po_number: identity.po_number,
        subject: identity.subject,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
        updated_at: new Date().toISOString(),
        updated_by: actor || null
      };
      if (Object.prototype.hasOwnProperty.call(identity, 'outbound_po_identifier')) {
        kept.outbound_po_identifier = identity.outbound_po_identifier;
        kept.outbound_po_number = identity.outbound_po_number;
        kept.po_version_number = identity.po_version_number;
      }
      if (Object.prototype.hasOwnProperty.call(identity, 'account_zoho_id')) {
        kept.account_zoho_id = identity.account_zoho_id;
        kept.account_name_snapshot = identity.account_name_snapshot;
      }
      if (Object.prototype.hasOwnProperty.call(identity, 'customer_id')) {
        kept.customer_id = identity.customer_id;
      }
      await trx('procurement_po').where({ id: po.id }).update(kept);
      await writeSyncEvent(trx, {
        procurementPoId: po.id,
        zohoPoId: remote.zohoPoId,
        operation,
        status: mapping.filled > 0 ? 'SUCCESS' : 'SKIPPED',
        actor,
        changedFields: mapping.filled > 0
          ? { reason: 'PRODUCT_MAPPING_RESOLVED', filled: mapping.filled }
          : { reason: 'UNCHANGED_HASH' },
        sourceUpdatedAt: remote.modifiedTime
      });
      const skipped = await trx('procurement_po').where({ id: po.id }).first();
      return {
        po: await publicPo(trx, skipped),
        skipped: mapping.filled === 0,
        warnings
      };
    }
    if (!po) {
      const id = await uniquePrefixedId(
        trx,
        'procurement_po',
        generateProcurementPoId,
        verifyProcurementPoId,
        'Purchase Order'
      );
      await trx('procurement_po').insert({
        id,
        source: 'ZOHO',
        classification: 'CANONICAL',
        zoho_po_id: remote.zohoPoId,
        created_by: actor || null,
        created_at: new Date().toISOString(),
        ...await headerForWrite(trx, remote, actor, hash, null)
      });
      await trx('procurement_po_external_ref').insert({
        id: `PER-PO-${id}`.slice(0, 255),
        procurement_po_id: id,
        system: 'ZOHO_CRM',
        module: 'Purchase_Orders',
        external_id: remote.zohoPoId,
        link_origin: 'PULL',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      po = await trx('procurement_po').where({ id }).first();
    } else {
      await trx('procurement_po').where({ id: po.id }).update(await headerForWrite(trx, remote, actor, hash, po));
      po = await trx('procurement_po').where({ id: po.id }).first();
    }
    const lineWarnings = await upsertLines(trx, po.id, mappedLines, actor);
    warnings.push(...lineWarnings);
    await writeSyncEvent(trx, {
      procurementPoId: po.id,
      zohoPoId: remote.zohoPoId,
      operation,
      status: 'SUCCESS',
      actor,
      changedFields: { lineCount: mappedLines.length, warnings },
      sourceUpdatedAt: remote.modifiedTime
    });
    const fresh = await trx('procurement_po').where({ id: po.id }).first();
    return { po: await publicPo(trx, fresh), skipped: false, warnings };
  }).then(async (result) => {
    try {
      const procurementReconciliationService = require('./procurementReconciliationService');
      if (await procurementReconciliationService.schemaReady()) {
        const synced = await procurementReconciliationService.syncPoReconciliations(result.po.id, actor);
        result.reconciliations = synced.reconciliations || [];
      }
    } catch (_) {
      result.reconciliations = result.reconciliations || [];
    }
    return result;
  });
}

async function loadRemoteForPull(opoOrZohoId) {
  const text = String(opoOrZohoId || '').trim();
  if (!text) throw httpError('Enter an OPO ID', 400, 'OPO_ID_REQUIRED');
  const byOpo = await zohoProc().findByOutboundPoNumber(text);
  if (byOpo) return byOpo;
  if (/^\d+$/.test(text)) {
    try {
      return await zohoProc().getPurchaseOrder(asZohoIdString(text, 'zoho_po_id'));
    } catch (err) {
      if (err && (err.reasonCode === 'ZOHO_PO_NOT_FOUND' || err.statusCode === 404)) {
        throw httpError(`No Purchase Order with OPO ID ${text}`, 404, 'ZOHO_PO_NOT_FOUND');
      }
      throw err;
    }
  }
  throw httpError(`No Purchase Order with OPO ID ${text}`, 404, 'ZOHO_PO_NOT_FOUND');
}

async function previewPurchaseOrder(zohoPoId) {
  await requireTables();
  const remote = await loadRemoteForPull(zohoPoId);
  await applyDealProjectAccount(db, remote);
  const mappedLines = [];
  for (const line of remote.lines || []) {
    mappedLines.push(await mapRemoteLine(db, line));
  }
  const existing = await findByZohoId(db, remote.zohoPoId);
  const mappingRequired = mappedLines.some((l) => l.mappingRequired);
  return {
    alreadyImported: !!existing,
    existingId: existing ? existing.id : null,
    mappingRequired,
    reasonCode: mappingRequired ? 'PRODUCT_MAPPING_REQUIRED' : null,
    purchaseOrder: {
      zohoPoId: remote.zohoPoId != null ? String(remote.zohoPoId) : null,
      poNumber: remote.outboundPoIdentifier || null,
      outboundPoIdentifier: remote.outboundPoIdentifier || null,
      outboundPoNumber: remote.outboundPoNumber || null,
      subject: remote.subject,
      status: remote.status,
      vendorZohoId: remote.vendorZohoId != null ? String(remote.vendorZohoId) : null,
      vendorName: remote.vendorName,
      accountZohoId: remote.accountZohoId != null ? String(remote.accountZohoId) : null,
      accountName: remote.accountName || null,
      customerId: remote.customerId || null,
      poDate: remote.poDate,
      dueDate: remote.dueDate,
      subTotal: remote.subTotal,
      discount: remote.discount,
      tax: remote.tax,
      grandTotal: remote.grandTotal,
      lines: mappedLines.map((line) => ({
        zohoLineId: line.zohoLineId != null ? String(line.zohoLineId) : null,
        zohoProductId: line.zohoProductId != null ? String(line.zohoProductId) : null,
        productId: line.productId,
        productName: line.zohoProductName || null,
        zohoProductName: line.zohoProductName || null,
        description: line.description,
        orderedQty: line.orderedQty,
        unit: line.unit,
        listPrice: line.listPrice,
        mappingRequired: line.mappingRequired
      }))
    }
  };
}

async function importPurchaseOrder(zohoPoId, actor) {
  await requireTables();
  let remote;
  try {
    remote = await loadRemoteForPull(zohoPoId);
  } catch (err) {
    const externalId = String(zohoPoId || '').trim();
    await db.transaction(async (trx) => {
      await writeSyncEvent(trx, {
        procurementPoId: null,
        zohoPoId: /^\d+$/.test(externalId) ? externalId : null,
        operation: 'IMPORT',
        status: 'ERROR',
        actor,
        errorMessage: err.message
      });
    }).catch(() => null);
    throw err;
  }
  const externalId = String(remote.zohoPoId);
  const existing = await findByZohoId(db, externalId);
  if (existing) {
    return persistRemote(remote, actor, 'IMPORT');
  }
  try {
    return await persistRemote(remote, actor, 'IMPORT');
  } catch (err) {
    if (err && err.code === '23505') {
      const raced = await findByZohoId(db, externalId);
      if (raced) return { po: await publicPo(db, raced), skipped: true, warnings: [{ code: 'CONCURRENT_IMPORT' }] };
    }
    throw err;
  }
}

/**
 * Zoho create / edit / custom refresh. The body only identifies the record.
 * The Purchase Order is loaded from Zoho and saved through the same path as import and refresh.
 */
async function ingestZohoPurchaseOrderEvent({ event, moduleName, zohoPoId, opoId, actor } = {}) {
  await requireTables();
  const mod = String(moduleName || 'Purchase_Orders').trim();
  if (mod !== 'Purchase_Orders') {
    throw httpError('Only Purchase_Orders events are accepted', 400, 'UNSUPPORTED_MODULE');
  }
  const ev = String(event || '').trim().toLowerCase();
  if (!['create', 'edit', 'refresh'].includes(ev)) {
    throw httpError('event must be create, edit, or refresh', 400, 'INVALID_EVENT');
  }
  const recordId = String(zohoPoId || '').trim();
  const opo = String(opoId || '').trim();
  if (!recordId && !opo) throw httpError('zohoPoId or opoId is required', 400, 'MISSING_PO');
  let remote;
  if (/^\d+$/.test(recordId)) {
    remote = await zohoProc().getPurchaseOrder(recordId);
  } else if (opo) {
    remote = await zohoProc().findByOutboundPoNumber(opo);
    if (!remote) throw httpError(`No Purchase Order with OPO ID ${opo}`, 404, 'ZOHO_PO_NOT_FOUND');
  } else {
    throw httpError('zohoPoId must be the Zoho record id', 400, 'INVALID_ZOHO_ID');
  }
  return persistRemote(remote, actor || 'zoho-event', ev === 'create' ? 'IMPORT' : 'REFRESH');
}

async function refreshPurchaseOrder(id, actor, { force = false } = {}) {
  await requireTables();
  const po = await loadPoRow(db, id);
  if (!po.zoho_po_id) throw httpError('This PO is not linked to Zoho', 409, 'UNLINKED');
  let remote;
  try {
    remote = await zohoProc().getPurchaseOrder(String(po.zoho_po_id));
  } catch (err) {
    await db.transaction(async (trx) => {
      await writeSyncEvent(trx, {
        procurementPoId: po.id,
        zohoPoId: po.zoho_po_id,
        operation: 'REFRESH',
        status: 'ERROR',
        actor,
        errorMessage: err.message
      });
    }).catch(() => null);
    await db('procurement_po').where({ id: po.id }).update({
      last_error: String(err.message || err).slice(0, 2000),
      last_error_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    throw err;
  }
  return persistRemote(remote, actor, 'REFRESH', { force });
}

async function loadPoRow(runner, id) {
  const key = String(id || '').trim();
  if (!key) throw httpError('PO id is required', 400, 'MISSING_PO');
  let row = await runner('procurement_po').where({ id: key }).first();
  if (!row && /^\d+$/.test(key)) {
    row = await runner('procurement_po').where({ zoho_po_id: key }).first();
  }
  if (!row) {
    row = await runner('procurement_po').where({ po_number: key }).first();
  }
  if (!row) throw httpError(`Purchase Order ${key} is not imported`, 404, 'NOT_FOUND');
  return row;
}

async function getPurchaseOrder(id) {
  await requireTables();
  const row = await loadPoRow(db, id);
  return publicPo(db, row);
}

async function listPurchaseOrders({ q, status, limit } = {}) {
  await requireTables();
  const cap = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  let query = db('procurement_po').orderBy('updated_at', 'desc').limit(cap);
  if (status) query = query.andWhere('status', String(status).toUpperCase());
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
    purchaseOrders.push(await publicPo(db, row, { includeLines: true }));
  }
  return { purchaseOrders };
}

async function listLegacyLocalPos() {
  const rows = await db('project_orders')
    .where(function notDeleted() {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .orderBy('id');
  return rows.map((row) => ({
    id: row.id,
    source: 'LOCAL',
    classification: 'LEGACY',
    zohoPoId: null,
    poNumber: row.ponumber,
    status: row.status || 'Active',
    vendorName: row.vendorname || null,
    poDate: row.podate || null,
    dueDate: null,
    syncStatus: 'NOT_IMPORTED',
    mappingRequired: false,
    reconciliationRequired: false,
    projectId: row.projectid,
    lines: []
  }));
}

async function listUnified({ q, status, limit } = {}) {
  const zoho = await listPurchaseOrders({ q, status, limit });
  const legacy = await listLegacyLocalPos();
  const filteredLegacy = q
    ? legacy.filter((row) => {
      const hay = `${row.id} ${row.poNumber || ''} ${row.vendorName || ''}`.toLowerCase();
      return hay.includes(String(q).toLowerCase());
    })
    : legacy;
  return { purchaseOrders: [...zoho.purchaseOrders, ...filteredLegacy] };
}

function mapMirrorHeader(po) {
  return {
    id: po.id,
    ponumber: po.outbound_po_identifier || po.outbound_po_number || (isInternalPoId(po.po_number) ? null : po.po_number),
    outbound_po_identifier: po.outbound_po_identifier || null,
    outbound_po_number: po.outbound_po_number || null,
    po_version_number: po.po_version_number,
    vendorname: po.vendor_name_snapshot,
    status: po.status,
    zoho_po_id: po.zoho_po_id
  };
}

function mapMirrorLine(line) {
  return {
    id: line.id,
    orderid: line.procurement_po_id,
    qtyordered: line.ordered_qty,
    uom: line.unit,
    itemdescription: line.description,
    itemname: line.zoho_product_name || null,
    product_name: line.zoho_product_name || null,
    product_id: line.product_id,
    zoho_line_id: line.zoho_line_id,
    zoho_product_id: line.zoho_product_id,
    line_status: line.line_status,
    list_price: line.list_price,
    status: line.line_status
  };
}

async function loadMirrorForReceipt(runner, poId) {
  const po = await loadPoRow(runner, poId);
  const lines = await runner('procurement_po_line')
    .where({ procurement_po_id: po.id })
    .whereNot('line_status', 'WITHDRAWN')
    .orderBy('sequence_number', 'asc');
  return {
    header: mapMirrorHeader(po),
    items: lines.map(mapMirrorLine),
    po
  };
}

async function maybeRefreshStale(po, actor) {
  if (!po.last_synced_at) return refreshPurchaseOrder(po.id, actor);
  const age = Date.now() - new Date(po.last_synced_at).getTime();
  if (age > STALE_MS) {
    return refreshPurchaseOrder(po.id, actor);
  }
  return null;
}

async function assertReceivable(runner, poId, { actor, refreshStale = true } = {}) {
  let po = await loadPoRow(runner, poId);
  if (refreshStale) {
    try {
      const refreshed = await maybeRefreshStale(po, actor);
      if (refreshed && refreshed.po) {
        po = await loadPoRow(runner, refreshed.po.id);
      }
    } catch (err) {
      throw httpError(
        `Cannot receive against a stale Zoho PO: ${err.message}`,
        err.statusCode || 409,
        err.reasonCode === 'PO_OAUTH_SCOPE_REQUIRED' ? 'PO_OAUTH_SCOPE_REQUIRED' : 'STALE_PO',
        { cause: err.reasonCode }
      );
    }
  }
  const status = String(po.status || '').toUpperCase();
  if (status === 'CANCELLED') {
    throw httpError('This Purchase Order is cancelled. New receiving is blocked.', 409, 'PO_CANCELLED');
  }
  if (!RECEIVE_STATUSES.includes(status)) {
    throw httpError(
      `Receiving is allowed only when the Zoho PO is Approved (current status ${status})`,
      409,
      'PO_NOT_APPROVED'
    );
  }
  return po;
}

async function assertReceivableLine(runner, po, line, thisAccepted = 0, exceptNoteId) {
  if (!line) throw httpError('PO line is not available', 409, 'PO_UNAVAILABLE');
  if (String(line.line_status || line.lineStatus || 'OPEN').toUpperCase() === 'WITHDRAWN') {
    throw httpError('This PO line was withdrawn in Zoho. New receiving is blocked.', 409, 'PO_LINE_WITHDRAWN');
  }
  // Product mapping is required only when accepting stock. OPEN drafts may include
  // unmapped lines at qty 0 so operators can link Products on the receipt editor.
  if (!line.product_id && !line.productId && thisAccepted > 1e-9) {
    throw httpError(
      'PRODUCT MAPPING REQUIRED. Link the Zoho Product to an AssetEngine Product before receiving.',
      409,
      'PRODUCT_MAPPING_REQUIRED'
    );
  }
  const ordered = roundQty(line.ordered_qty != null ? line.ordered_qty : line.qtyordered);
  const accepted = await acceptedToDate(runner, line.id, exceptNoteId);
  if (ordered + 1e-9 < accepted) {
    throw httpError(
      `This PO line has less commercial quantity (${ordered}) than has already been physically accepted (${accepted}). Further receiving is blocked.`,
      409,
      'RECONCILIATION_REQUIRED',
      { ordered, accepted }
    );
  }
  const outstanding = roundQty(Math.max(ordered - accepted, 0));
  if (thisAccepted - outstanding > 1e-9) {
    const code = outstanding > 0 ? 'INSUFFICIENT_OUTSTANDING' : 'OVER_RECEIPT';
    throw httpError(
      `Over-receipt rejected for PO line ${line.id}: accepted ${thisAccepted} exceeds outstanding ${outstanding}`,
      409,
      code,
      { ordered, accepted, outstanding, thisAccepted }
    );
  }
  return { ordered, accepted, outstanding };
}

async function onOrderForProduct(runner, productId) {
  const lines = await runner('procurement_po_line as l')
    .join('procurement_po as p', 'p.id', 'l.procurement_po_id')
    .where('l.product_id', productId)
    .where('l.line_status', 'OPEN')
    .whereIn('p.status', RECEIVE_STATUSES)
    .select('l.id', 'l.ordered_qty');
  let total = 0;
  for (const line of lines) {
    const ledger = await qtyLedger(runner, line.id);
    const qty = lineQuantities(line.ordered_qty, ledger);
    total += qty.onOrder;
  }
  return roundQty(total);
}

async function getSetProcurementNeed(setId) {
  await requireTables();
  const setService = require('./setService');
  const set = await setService.getSet(setId);
  const lines = [];
  for (const req of set.requirements || []) {
    const completeness = (set.completenessLines || []).find((l) => l.requirementId === req.id);
    const required = qtyNum(req.quantity);
    const allocated = completeness ? qtyNum(completeness.allocated) : 0;
    const shortfall = Math.max(required - allocated, 0);
    const onOrder = await onOrderForProduct(db, req.productId || req.product_id);
    lines.push({
      requirementId: req.id,
      productId: req.productId || req.product_id,
      productName: req.productName || req.product_name || null,
      required: roundQty(required),
      allocated: roundQty(allocated),
      shortfall: roundQty(shortfall),
      onOrder,
      additionalNeed: roundQty(Math.max(shortfall - onOrder, 0)),
      unit: req.unit || null
    });
  }
  return {
    setId: set.id,
    setName: set.name,
    completeness: set.completeness,
    lines
  };
}

async function listHistory(id) {
  await requireTables();
  const po = await loadPoRow(db, id);
  const rows = await db('procurement_sync_event')
    .where({ procurement_po_id: po.id })
    .orderBy('created_at', 'desc')
    .limit(100);
  return {
    purchaseOrderId: po.id,
    events: rows.map((row) => ({
      id: row.id,
      operation: row.operation,
      status: row.status,
      actor: row.actor,
      errorMessage: row.error_message,
      changedFields: row.changed_fields,
      sourceUpdatedAt: row.source_updated_at,
      createdAt: row.created_at,
      zohoPoId: row.zoho_po_id != null ? String(row.zoho_po_id) : null
    }))
  };
}

/** Recent PO sync events for lifecycle / Dashboard activity feeds. */
async function listRecentSyncEvents({ limit } = {}) {
  await requireTables();
  if (!(await db.schema.hasTable('procurement_sync_event'))) {
    return { events: [] };
  }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const rows = await db('procurement_sync_event as e')
    .leftJoin('procurement_po as p', 'p.id', 'e.procurement_po_id')
    .select(
      'e.id',
      'e.procurement_po_id',
      'e.zoho_po_id',
      'e.operation',
      'e.status',
      'e.actor',
      'e.error_message',
      'e.changed_fields',
      'e.created_at',
      'p.po_number'
    )
    .orderBy('e.created_at', 'desc')
    .limit(cap);
  return {
    events: rows.map((row) => ({
      id: row.id,
      procurementPoId: row.procurement_po_id,
      zohoPoId: row.zoho_po_id != null ? String(row.zoho_po_id) : null,
      poNumber: row.po_number || null,
      operation: row.operation,
      status: row.status,
      actor: row.actor,
      errorMessage: row.error_message,
      changedFields: row.changed_fields,
      createdAt: row.created_at
    }))
  };
}

async function probeZohoScope() {
  try {
    await zohoProc().listPurchaseOrders({ page: 1, perPage: 1 });
    return { ok: true, reasonCode: null };
  } catch (err) {
    return {
      ok: false,
      reasonCode: err.reasonCode || err.code || 'ZOHO_ERROR',
      message: err.message
    };
  }
}

function payloadMentionsPo(raw, po) {
  let payload = raw;
  if (typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch (_) { return false; }
  }
  if (!payload || typeof payload !== 'object') return false;
  const meta = payload.meta || {};
  const poId = String(po.id || '');
  const poNumber = String(po.po_number || '');
  const ids = [
    meta.procurementPoId,
    meta.ProcurementPoId,
    payload.procurementPoId,
    payload.POReference && payload.POReference.ProcurementPoId
  ].map((value) => String(value || ''));
  if (poId && ids.includes(poId)) return true;
  const numbers = [
    meta.buyerOrderNo,
    meta.referenceNo,
    payload.buyer && payload.buyer.orderNo,
    payload.POReference && payload.POReference.PONumber
  ].map((value) => String(value || '').trim());
  return !!(poNumber && numbers.includes(poNumber));
}

async function linkedDocuments(po) {
  const receipts = await db('receipt_note')
    .where({ po_id: po.id })
    .select('id', 'status', 'po_number');
  const books = await db('purchase_book')
    .where({ procurement_po_id: po.id })
    .select('id', 'status');
  const byId = new Map();
  if (await db.schema.hasTable('delivery_challans')) {
    const needles = [po.id];
    if (po.po_number && String(po.po_number).length >= 6) needles.push(po.po_number);
    for (const needle of needles) {
      const rows = await db('delivery_challans')
        .whereRaw('payloadjson::text ILIKE ?', [`%${needle}%`])
        .select('id', 'challanno', 'lifecycle_status', 'voided_at', 'payloadjson');
      rows.forEach((row) => {
        if (payloadMentionsPo(row.payloadjson, po)) byId.set(row.id, row);
      });
    }
    if (books.length && await db.schema.hasTable('purchase_book_dc_consumption')) {
      const consumed = await db('purchase_book_dc_consumption')
        .whereIn('purchase_book_id', books.map((book) => book.id))
        .distinct('delivery_challan_id');
      const ids = consumed.map((row) => row.delivery_challan_id).filter((id) => id && !byId.has(id));
      if (ids.length) {
        const rows = await db('delivery_challans')
          .whereIn('id', ids)
          .select('id', 'challanno', 'lifecycle_status', 'voided_at', 'payloadjson');
        rows.forEach((row) => byId.set(row.id, row));
      }
    }
  }
  return { receipts, books, dcs: [...byId.values()] };
}

/**
 * Void Receipt Notes, Purchase Books, and Delivery Challans raised against
 * this Purchase Order, and record that void against the PO as it stands now.
 * Order is DC, then Purchase Book, then Receipt Note.
 */
async function voidDocumentsForCurrentVersion(poId, args = {}) {
  await requireTables();
  const po = await loadPoRow(db, poId);
  const actor = args.actor || null;
  const version = {
    procurementPoId: po.id,
    poNumber: po.po_number,
    zohoPoId: po.zoho_po_id != null ? String(po.zoho_po_id) : null,
    sourceHash: po.source_hash,
    syncedAt: po.last_synced_at
  };
  const reason = trimOrNull(args.reason)
    || `Voided for ${po.po_number || po.id}, current Purchase Order version`;
  const found = await linkedDocuments(po);
  const voided = [];
  const blocked = [];
  const dcDispositionService = require('./dcDispositionService');
  const purchaseBookService = require('./purchaseBookService');
  const receiptService = require('./receiptService');

  for (const dc of found.dcs) {
    if (dc.voided_at || String(dc.lifecycle_status || '').toUpperCase() === 'VOID') continue;
    try {
      const result = await dcDispositionService.voidChallan(dc.id, { actor, reason });
      voided.push({ kind: 'DC', id: result.id, label: result.challanNo, status: 'VOID' });
    } catch (err) {
      blocked.push({
        kind: 'DC',
        id: dc.id,
        label: dc.challanno,
        message: err.message,
        reasonCode: err.reasonCode || null
      });
    }
  }
  for (const book of found.books) {
    if (String(book.status || '').toUpperCase() === 'VOID') continue;
    try {
      await purchaseBookService.voidBook(book.id, { actor, reason });
      voided.push({ kind: 'PB', id: book.id, label: book.id, status: 'VOID' });
    } catch (err) {
      blocked.push({ kind: 'PB', id: book.id, label: book.id, message: err.message, reasonCode: err.reasonCode || null });
    }
  }
  for (const note of found.receipts) {
    const status = String(note.status || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'REVERSED') continue;
    try {
      if (status === 'OPEN') {
        await receiptService.cancelReceipt(note.id, { actor, reason });
        voided.push({ kind: 'RN', id: note.id, label: note.id, status: 'CANCELLED' });
      } else if (status === 'POSTED') {
        await receiptService.reverseReceipt(note.id, { actor, reason });
        voided.push({ kind: 'RN', id: note.id, label: note.id, status: 'REVERSED' });
      } else {
        blocked.push({ kind: 'RN', id: note.id, label: note.id, message: `Status ${status} cannot be voided` });
      }
    } catch (err) {
      blocked.push({ kind: 'RN', id: note.id, label: note.id, message: err.message, reasonCode: err.reasonCode || null });
    }
  }

  await db.transaction(async (trx) => {
    await writeSyncEvent(trx, {
      procurementPoId: po.id,
      zohoPoId: po.zoho_po_id,
      operation: 'VOID_DOCUMENTS',
      status: blocked.length ? 'ERROR' : 'SUCCESS',
      actor,
      changedFields: { version, reason, voided, blocked }
    });
  });
  return { poNumber: po.po_number, version, voided, blocked };
}

module.exports = {
  RECEIVE_STATUSES,
  setZohoGateway,
  previewPurchaseOrder,
  importPurchaseOrder,
  refreshPurchaseOrder,
  ingestZohoPurchaseOrderEvent,
  getPurchaseOrder,
  listPurchaseOrders,
  listUnified,
  listLegacyLocalPos,
  listHistory,
  listRecentSyncEvents,
  getSetProcurementNeed,
  onOrderForProduct,
  loadMirrorForReceipt,
  assertReceivable,
  assertReceivableLine,
  acceptedToDate,
  qtyLedger,
  lineQuantities,
  publicPo,
  tablesReady,
  probeZohoScope,
  asZohoIdString,
  voidDocumentsForCurrentVersion
};
