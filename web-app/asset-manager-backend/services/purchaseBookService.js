/**
 * Purchase Book — Tax Invoice book against procurement PO (ADR-PURCHASE-BOOK-001).
 * Does not create stock. Does not sync Zoho Books in v1.
 */
const {
  db,
  generatePurchaseBookId,
  verifyPurchaseBookId,
  generatePurchaseBookLineId,
  verifyPurchaseBookLineId,
  generatePurchaseBookDcConsumptionId,
  verifyPurchaseBookDcConsumptionId
} = require('../utils');
const purchaseBookPhysicalService = require('./purchaseBookPhysicalService');
const { ensureVendorInvoice } = require('./vendorInvoiceService');

const STATUSES = Object.freeze(['DRAFT', 'POSTED', 'VOID']);
const DOCUMENT_KINDS = Object.freeze(['INVOICE', 'CREDIT']);

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

function trimText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function actorOf(args) {
  return trimText(args && (args.actor || args.username || args.user)) || 'web';
}

async function requireTables() {
  if (!(await db.schema.hasTable('purchase_book')) || !(await db.schema.hasTable('purchase_book_line'))) {
    throw httpError('Purchase Book tables are not migrated yet', 503, 'NOT_MIGRATED');
  }
}

async function writeBookEvent(trx, payload) {
  if (!(await trx.schema.hasTable('purchase_book_event'))) return null;
  const inserted = await trx('purchase_book_event')
    .insert({
      purchase_book_id: payload.purchaseBookId,
      purchase_book_line_id: payload.purchaseBookLineId || null,
      type: payload.type,
      actor: payload.actor || null,
      timestamp: new Date().toISOString(),
      note: payload.note || null,
      metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null
    })
    .returning('id');
  return Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted?.id;
}

function publicBookEvent(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata_json) {
    try { metadata = JSON.parse(row.metadata_json); } catch (_) { metadata = row.metadata_json; }
  }
  return {
    id: row.id,
    purchaseBookId: row.purchase_book_id,
    purchaseBookLineId: row.purchase_book_line_id || null,
    type: row.type,
    actor: row.actor,
    timestamp: row.timestamp,
    note: row.note,
    metadata,
    vendorInvoiceNo: row.vendor_invoice_no || null,
    procurementPoId: row.procurement_po_id || null
  };
}

async function uniqueId(trx, table, generate, verify, label) {
  for (let i = 0; i < 8; i += 1) {
    const id = generate();
    if (!verify(id)) throw httpError(`ID generator produced invalid ${label}`, 500);
    const existing = await trx(table).where({ id }).first();
    if (!existing) return id;
  }
  throw httpError(`Could not allocate a unique ${label} ID`, 500);
}

/**
 * Sum booked qty for a PO line across non-VOID books.
 * CREDIT lines subtract from the sum (return capacity to remaining).
 */
async function bookedQtyForPoLine(runner, poLineId, { excludeBookId } = {}) {
  const rows = await runner('purchase_book_line as l')
    .join('purchase_book as b', 'b.id', 'l.purchase_book_id')
    .where('l.procurement_po_line_id', poLineId)
    .whereNot('b.status', 'VOID')
    .modify((q) => {
      if (excludeBookId) q.whereNot('b.id', excludeBookId);
    })
    .select('l.qty_booked', 'b.document_kind');

  let total = 0;
  for (const row of rows) {
    const qty = qtyNum(row.qty_booked);
    if (String(row.document_kind).toUpperCase() === 'CREDIT') total -= qty;
    else total += qty;
  }
  return roundQty(Math.max(0, total));
}

async function remainingBookableQty(runner, poLine, { excludeBookId } = {}) {
  const ordered = roundQty(poLine.ordered_qty);
  const booked = await bookedQtyForPoLine(runner, poLine.id, { excludeBookId });
  return roundQty(Math.max(0, ordered - booked));
}

function publicLine(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseBookId: row.purchase_book_id,
    procurementPoLineId: row.procurement_po_line_id,
    productId: row.product_id,
    sortOrder: row.sort_order,
    displayName: row.display_name,
    displayDescription: row.display_description,
    qtyBooked: qtyNum(row.qty_booked),
    unit: row.unit,
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    discount: row.discount == null ? null : Number(row.discount),
    tax: row.tax == null ? null : Number(row.tax),
    lineTotal: row.line_total == null ? null : Number(row.line_total),
    ...extra
  };
}

function publicBook(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    procurementPoId: row.procurement_po_id,
    documentKind: row.document_kind,
    status: row.status,
    vendorInvoiceNo: row.vendor_invoice_no,
    vendorInvoiceId: row.vendor_invoice_id || null,
    invoiceDate: row.invoice_date,
    currency: row.currency,
    subTotal: row.sub_total == null ? null : Number(row.sub_total),
    taxTotal: row.tax_total == null ? null : Number(row.tax_total),
    grandTotal: row.grand_total == null ? null : Number(row.grand_total),
    notes: row.notes,
    externalSystem: row.external_system,
    externalId: row.external_id,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    postedBy: row.posted_by,
    postedAt: row.posted_at,
    voidedBy: row.voided_by,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

async function hydrate(runner, row) {
  const lines = await runner('purchase_book_line')
    .where({ purchase_book_id: row.id })
    .orderBy('sort_order')
    .orderBy('id');
  const po = await runner('procurement_po').where({ id: row.procurement_po_id }).first();
  const productIds = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  const products = productIds.length
    ? await runner('product').whereIn('id', productIds).select('id', 'name')
    : [];
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const physicalByLine = await purchaseBookPhysicalService.listForBookLines(
    runner,
    lines.map((l) => l.id)
  );
  return {
    purchaseBook: publicBook(row, {
      poNumber: po ? po.po_number : null,
      vendorName: po ? po.vendor_name_snapshot : null
    }),
    lines: lines.map((line) => publicLine(line, {
      productName: nameById.get(line.product_id) || null,
      physicals: physicalByLine.get(line.id) || []
    }))
  };
}

async function listBooks({ poId, status, q, limit, offset } = {}) {
  await requireTables();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const skip = Math.max(parseInt(offset, 10) || 0, 0);
  let query = db('purchase_book as b')
    .leftJoin('procurement_po as p', 'p.id', 'b.procurement_po_id')
    .select(
      'b.*',
      'p.po_number',
      'p.vendor_name_snapshot'
    )
    .orderBy('b.created_at', 'desc');

  if (poId) query = query.where('b.procurement_po_id', String(poId).trim());
  if (status) {
    const s = String(status).toUpperCase();
    if (!STATUSES.includes(s)) throw httpError('Invalid status filter', 400);
    query = query.where('b.status', s);
  }
  const term = trimText(q);
  if (term) {
    const like = `%${term}%`;
    query = query.andWhere((inner) => {
      inner
        .whereILike('b.id', like)
        .orWhereILike('b.vendor_invoice_no', like)
        .orWhereILike('p.po_number', like)
        .orWhereILike('p.vendor_name_snapshot', like);
    });
  }

  const rows = await query.limit(cap).offset(skip);
  return {
    purchaseBooks: rows.map((row) => publicBook(row, {
      poNumber: row.po_number,
      vendorName: row.vendor_name_snapshot
    })),
    count: rows.length
  };
}

async function getBook(id) {
  await requireTables();
  const noteId = String(id || '').trim();
  if (!verifyPurchaseBookId(noteId)) throw httpError('Invalid Purchase Book id', 400);
  const row = await db('purchase_book').where({ id: noteId }).first();
  if (!row) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
  return hydrate(db, row);
}

async function poLineCapacity(runner, poId) {
  const lines = await runner('procurement_po_line')
    .where({ procurement_po_id: poId })
    .orderBy('sequence_number')
    .orderBy('id');
  const out = [];
  for (const line of lines) {
    if (String(line.line_status || '').toUpperCase() === 'WITHDRAWN') continue;
    const booked = await bookedQtyForPoLine(runner, line.id);
    const remaining = roundQty(Math.max(0, qtyNum(line.ordered_qty) - booked));
    out.push({
      poLineId: line.id,
      productId: line.product_id,
      description: line.description,
      zohoProductName: line.zoho_product_name || null,
      orderedQty: qtyNum(line.ordered_qty),
      bookedQty: booked,
      remainingQty: remaining,
      unit: line.unit,
      listPrice: line.list_price == null ? null : Number(line.list_price),
      mappingRequired: !line.product_id
    });
  }
  return out;
}

async function getPoBookCapacity(poId) {
  await requireTables();
  const id = String(poId || '').trim();
  const po = await db('procurement_po').where({ id }).first();
  if (!po) throw httpError('Purchase Order not found', 404, 'PO_NOT_FOUND');
  const lines = await poLineCapacity(db, id);
  return {
    procurementPoId: id,
    poNumber: po.po_number,
    vendorName: po.vendor_name_snapshot,
    lines
  };
}

function normalizeIncomingLines(rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw httpError('At least one book line is required', 400, 'EMPTY_LINES');
  }
  return rawLines.map((raw, index) => {
    const poLineId = trimText(raw.poLineId || raw.procurementPoLineId);
    if (!poLineId) throw httpError(`Line ${index + 1}: poLineId is required`, 400);
    const qtyBooked = roundQty(raw.qtyBooked ?? raw.qty);
    if (!(qtyBooked > 0)) throw httpError(`Line ${index + 1}: qtyBooked must be greater than zero`, 400);
    return {
      poLineId,
      qtyBooked,
      displayName: trimText(raw.displayName),
      displayDescription: trimText(raw.displayDescription),
      unit: trimText(raw.unit),
      unitPrice: raw.unitPrice == null || raw.unitPrice === '' ? null : Number(raw.unitPrice),
      discount: raw.discount == null || raw.discount === '' ? null : Number(raw.discount),
      tax: raw.tax == null || raw.tax === '' ? null : Number(raw.tax),
      lineTotal: raw.lineTotal == null || raw.lineTotal === '' ? null : Number(raw.lineTotal)
    };
  });
}

async function assertLineCapacity(trx, poId, lines, { excludeBookId, documentKind } = {}) {
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line.poLineId)) {
      throw httpError(`Duplicate PO line ${line.poLineId} on this book`, 400, 'DUPLICATE_PO_LINE');
    }
    seen.add(line.poLineId);
    const poLine = await trx('procurement_po_line').where({ id: line.poLineId }).forUpdate().first();
    if (!poLine || String(poLine.procurement_po_id) !== String(poId)) {
      throw httpError(`PO line ${line.poLineId} does not belong to PO ${poId}`, 409, 'PO_LINE_MISMATCH');
    }
    if (!poLine.product_id) {
      throw httpError(
        `PO line ${line.poLineId} has no AssetEngine Product. Map the Product before booking.`,
        409,
        'PRODUCT_MAPPING_REQUIRED'
      );
    }
    line.productId = poLine.product_id;
    line.unit = line.unit || poLine.unit || null;
    if (!line.displayName) {
      line.displayName = poLine.zoho_product_name || poLine.description || poLine.product_id;
    }
    if (!line.displayDescription) {
      line.displayDescription = poLine.description || null;
    }
    if (line.unitPrice == null && poLine.list_price != null) {
      line.unitPrice = Number(poLine.list_price);
    }

    // CREDIT restores capacity — skip ≤ ordered check for credit qty itself;
    // still require positive qty and valid PO line.
    if (String(documentKind).toUpperCase() === 'CREDIT') continue;

    const remaining = await remainingBookableQty(trx, poLine, { excludeBookId });
    if (line.qtyBooked - remaining > 1e-9) {
      throw httpError(
        `Book qty ${line.qtyBooked} exceeds remaining ordered capacity ${remaining} for PO line ${line.poLineId}`,
        409,
        'INSUFFICIENT_PO_QTY',
        {
          poLineId: line.poLineId,
          orderedQty: qtyNum(poLine.ordered_qty),
          remainingQty: remaining,
          thisQty: line.qtyBooked
        }
      );
    }
  }
}

async function createFromPo(poId, args = {}) {
  await requireTables();
  const id = String(poId || '').trim();
  const actor = actorOf(args);
  const documentKind = String(args.documentKind || 'INVOICE').toUpperCase();
  if (!DOCUMENT_KINDS.includes(documentKind)) {
    throw httpError('documentKind must be INVOICE or CREDIT', 400);
  }
  const lines = normalizeIncomingLines(args.lines);

  return db.transaction(async (trx) => {
    const po = await trx('procurement_po').where({ id }).forUpdate().first();
    if (!po) throw httpError('Purchase Order not found', 404, 'PO_NOT_FOUND');
    await assertLineCapacity(trx, po.id, lines, { documentKind });

    const bookId = await uniqueId(trx, 'purchase_book', generatePurchaseBookId, verifyPurchaseBookId, 'Purchase Book');
    const now = new Date().toISOString();
    const vendorInvoiceNo = trimText(args.vendorInvoiceNo);
    const invoiceDate = trimText(args.invoiceDate);
    const bookInsert = {
      id: bookId,
      procurement_po_id: po.id,
      document_kind: documentKind,
      status: 'DRAFT',
      vendor_invoice_no: vendorInvoiceNo,
      invoice_date: invoiceDate,
      currency: trimText(args.currency) || po.currency || null,
      sub_total: args.subTotal == null || args.subTotal === '' ? null : Number(args.subTotal),
      tax_total: args.taxTotal == null || args.taxTotal === '' ? null : Number(args.taxTotal),
      grand_total: args.grandTotal == null || args.grandTotal === '' ? null : Number(args.grandTotal),
      notes: trimText(args.notes),
      external_system: null,
      external_id: null,
      sync_status: null,
      created_by: actor,
      updated_by: actor,
      created_at: now,
      updated_at: now
    };
    if (await trx.schema.hasColumn('purchase_book', 'vendor_invoice_id')) {
      bookInsert.vendor_invoice_id = await ensureVendorInvoice(trx, {
        vendorName: po.vendor_name_snapshot,
        invoiceNumber: vendorInvoiceNo,
        invoiceDate
      });
    }
    await trx('purchase_book').insert(bookInsert);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineId = await uniqueId(
        trx,
        'purchase_book_line',
        generatePurchaseBookLineId,
        verifyPurchaseBookLineId,
        'Purchase Book line'
      );
      const lineTotal = line.lineTotal != null
        ? line.lineTotal
        : (line.unitPrice != null ? roundQty(line.unitPrice * line.qtyBooked, 4) : null);
      await trx('purchase_book_line').insert({
        id: lineId,
        purchase_book_id: bookId,
        procurement_po_line_id: line.poLineId,
        product_id: line.productId,
        sort_order: i,
        display_name: line.displayName,
        display_description: line.displayDescription,
        qty_booked: line.qtyBooked,
        unit: line.unit,
        unit_price: line.unitPrice,
        discount: line.discount,
        tax: line.tax,
        line_total: lineTotal,
        created_at: now,
        updated_at: now
      });
    }

    const row = await trx('purchase_book').where({ id: bookId }).first();
    await writeBookEvent(trx, {
      purchaseBookId: bookId,
      type: 'CREATED',
      actor,
      note: `Draft ${documentKind} against PO ${po.po_number || po.id}`,
      metadata: {
        procurementPoId: po.id,
        vendorInvoiceNo: trimText(args.vendorInvoiceNo),
        lineCount: lines.length
      }
    });
    return hydrate(trx, row);
  });
}

async function updateDraft(id, args = {}) {
  await requireTables();
  const bookId = String(id || '').trim();
  const actor = actorOf(args);

  return db.transaction(async (trx) => {
    const book = await trx('purchase_book').where({ id: bookId }).forUpdate().first();
    if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
    if (book.status !== 'DRAFT') {
      throw httpError(`Purchase Book ${book.status} cannot be edited`, 409, 'INVALID_STATUS');
    }

    const patch = {
      updated_by: actor,
      updated_at: new Date().toISOString()
    };
    if (Object.prototype.hasOwnProperty.call(args, 'vendorInvoiceNo')) {
      patch.vendor_invoice_no = trimText(args.vendorInvoiceNo);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'invoiceDate')) {
      patch.invoice_date = trimText(args.invoiceDate);
    }
    if (
      await trx.schema.hasColumn('purchase_book', 'vendor_invoice_id')
      && (
        Object.prototype.hasOwnProperty.call(args, 'vendorInvoiceNo')
        || Object.prototype.hasOwnProperty.call(args, 'invoiceDate')
      )
    ) {
      const po = await trx('procurement_po').where({ id: book.procurement_po_id }).first();
      const number = Object.prototype.hasOwnProperty.call(args, 'vendorInvoiceNo')
        ? patch.vendor_invoice_no
        : book.vendor_invoice_no;
      const date = Object.prototype.hasOwnProperty.call(args, 'invoiceDate')
        ? patch.invoice_date
        : book.invoice_date;
      patch.vendor_invoice_id = await ensureVendorInvoice(trx, {
        vendorName: po ? po.vendor_name_snapshot : null,
        invoiceNumber: number,
        invoiceDate: date
      });
    }
    if (Object.prototype.hasOwnProperty.call(args, 'currency')) {
      patch.currency = trimText(args.currency);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'notes')) {
      patch.notes = trimText(args.notes);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'subTotal')) {
      patch.sub_total = args.subTotal == null || args.subTotal === '' ? null : Number(args.subTotal);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'taxTotal')) {
      patch.tax_total = args.taxTotal == null || args.taxTotal === '' ? null : Number(args.taxTotal);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'grandTotal')) {
      patch.grand_total = args.grandTotal == null || args.grandTotal === '' ? null : Number(args.grandTotal);
    }
    if (Object.prototype.hasOwnProperty.call(args, 'documentKind')) {
      const kind = String(args.documentKind).toUpperCase();
      if (!DOCUMENT_KINDS.includes(kind)) throw httpError('Invalid documentKind', 400);
      patch.document_kind = kind;
    }

    if (Array.isArray(args.lines)) {
      const lines = normalizeIncomingLines(args.lines);
      const kind = patch.document_kind || book.document_kind;
      await assertLineCapacity(trx, book.procurement_po_id, lines, {
        excludeBookId: book.id,
        documentKind: kind
      });
      await trx('purchase_book_line').where({ purchase_book_id: book.id }).del();
      const now = patch.updated_at;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineId = await uniqueId(
          trx,
          'purchase_book_line',
          generatePurchaseBookLineId,
          verifyPurchaseBookLineId,
          'Purchase Book line'
        );
        const lineTotal = line.lineTotal != null
          ? line.lineTotal
          : (line.unitPrice != null ? roundQty(line.unitPrice * line.qtyBooked, 4) : null);
        await trx('purchase_book_line').insert({
          id: lineId,
          purchase_book_id: book.id,
          procurement_po_line_id: line.poLineId,
          product_id: line.productId,
          sort_order: i,
          display_name: line.displayName,
          display_description: line.displayDescription,
          qty_booked: line.qtyBooked,
          unit: line.unit,
          unit_price: line.unitPrice,
          discount: line.discount,
          tax: line.tax,
          line_total: lineTotal,
          created_at: now,
          updated_at: now
        });
      }
    }

    await trx('purchase_book').where({ id: book.id }).update(patch);
    const row = await trx('purchase_book').where({ id: book.id }).first();
    await writeBookEvent(trx, {
      purchaseBookId: book.id,
      type: 'UPDATED',
      actor,
      note: 'Draft updated',
      metadata: { vendorInvoiceNo: row.vendor_invoice_no }
    });
    return hydrate(trx, row);
  });
}

async function postBook(id, args = {}) {
  await requireTables();
  const bookId = String(id || '').trim();
  const actor = actorOf(args);
  return db.transaction(async (trx) => {
    const book = await trx('purchase_book').where({ id: bookId }).forUpdate().first();
    if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
    if (book.status === 'POSTED') return hydrate(trx, book);
    if (book.status !== 'DRAFT') {
      throw httpError(`Purchase Book ${book.status} cannot be posted`, 409, 'INVALID_STATUS');
    }
    const lines = await trx('purchase_book_line').where({ purchase_book_id: book.id });
    if (!lines.length) throw httpError('Cannot post an empty Purchase Book', 400, 'EMPTY_LINES');

    const normalized = lines.map((line) => ({
      poLineId: line.procurement_po_line_id,
      qtyBooked: qtyNum(line.qty_booked),
      displayName: line.display_name,
      displayDescription: line.display_description,
      unit: line.unit,
      unitPrice: line.unit_price == null ? null : Number(line.unit_price),
      discount: line.discount == null ? null : Number(line.discount),
      tax: line.tax == null ? null : Number(line.tax),
      lineTotal: line.line_total == null ? null : Number(line.line_total)
    }));
    await assertLineCapacity(trx, book.procurement_po_id, normalized, {
      excludeBookId: book.id,
      documentKind: book.document_kind
    });

    const now = new Date().toISOString();
    await trx('purchase_book').where({ id: book.id }).update({
      status: 'POSTED',
      posted_by: actor,
      posted_at: now,
      updated_by: actor,
      updated_at: now
    });
    await writeBookEvent(trx, {
      purchaseBookId: book.id,
      type: 'POSTED',
      actor,
      note: `Posted invoice ${book.vendor_invoice_no || book.id}`,
      metadata: { lineCount: lines.length }
    });
    const row = await trx('purchase_book').where({ id: book.id }).first();
    return hydrate(trx, row);
  });
}

async function voidBook(id, args = {}) {
  await requireTables();
  const bookId = String(id || '').trim();
  const actor = actorOf(args);
  return db.transaction(async (trx) => {
    const book = await trx('purchase_book').where({ id: bookId }).forUpdate().first();
    if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
    if (book.status === 'VOID') return hydrate(trx, book);
    if (book.status !== 'DRAFT' && book.status !== 'POSTED') {
      throw httpError(`Purchase Book ${book.status} cannot be voided`, 409, 'INVALID_STATUS');
    }
    if (await trx.schema.hasTable('purchase_book_dc_consumption')) {
      const active = await trx('purchase_book_dc_consumption')
        .where({ purchase_book_id: book.id, status: 'ACTIVE' })
        .first();
      if (active) {
        throw httpError(
          'Cannot void Purchase Book while active DC consumption exists. Void those DCs first.',
          409,
          'BOOK_HAS_ACTIVE_DC'
        );
      }
    }
    const now = new Date().toISOString();
    await trx('purchase_book').where({ id: book.id }).update({
      status: 'VOID',
      voided_by: actor,
      voided_at: now,
      updated_by: actor,
      updated_at: now,
      notes: trimText(args.reason)
        ? `${book.notes ? `${book.notes}\n` : ''}VOID: ${trimText(args.reason)}`
        : book.notes
    });
    await writeBookEvent(trx, {
      purchaseBookId: book.id,
      type: 'VOIDED',
      actor,
      note: trimText(args.reason) || 'Purchase Book voided',
      metadata: { previousStatus: book.status }
    });
    const row = await trx('purchase_book').where({ id: book.id }).first();
    return hydrate(trx, row);
  });
}

async function dcConsumedQtyForLine(runner, bookLineId, { excludeDcId } = {}) {
  if (!(await runner.schema.hasTable('purchase_book_dc_consumption'))) return 0;
  const rows = await runner('purchase_book_dc_consumption')
    .where({ purchase_book_line_id: bookLineId, status: 'ACTIVE' })
    .modify((q) => {
      if (excludeDcId) q.whereNot('delivery_challan_id', excludeDcId);
    })
    .select('qty_consumed');
  return roundQty(rows.reduce((sum, r) => sum + qtyNum(r.qty_consumed), 0));
}

/**
 * Books + lines with remaining DC-able qty for a procurement PO (Mode A2).
 * Only POSTED INVOICE books; CREDIT excluded.
 */
async function getPoBooksForDc(poId) {
  await requireTables();
  const procurementPoId = String(poId || '').trim();
  if (!procurementPoId) throw httpError('procurementPoId is required', 400);

  const books = await db('purchase_book')
    .where({ procurement_po_id: procurementPoId })
    .where({ status: 'POSTED', document_kind: 'INVOICE' })
    .orderBy('invoice_date', 'desc')
    .orderBy('created_at', 'desc');

  const result = [];
  for (const book of books) {
    const lines = await db('purchase_book_line')
      .where({ purchase_book_id: book.id })
      .orderBy('sort_order');
    const physicalByLine = await purchaseBookPhysicalService.listForBookLines(
      db,
      lines.map((l) => l.id)
    );
    const publicLines = [];
    for (const line of lines) {
      const booked = roundQty(line.qty_booked);
      const consumed = await dcConsumedQtyForLine(db, line.id);
      const remainingDcQty = roundQty(Math.max(0, booked - consumed));
      publicLines.push({
        ...publicLine(line),
        qtyBooked: booked,
        qtyDcConsumed: consumed,
        remainingDcQty,
        physicals: physicalByLine.get(line.id) || []
      });
    }
    const remainingDcQty = roundQty(publicLines.reduce((s, l) => s + l.remainingDcQty, 0));
    if (remainingDcQty <= 0 && publicLines.every((l) => l.remainingDcQty <= 0)) {
      // Still list fully consumed books so UI can show locked state
    }
    result.push({
      id: book.id,
      procurementPoId: book.procurement_po_id,
      documentKind: book.document_kind,
      status: book.status,
      vendorInvoiceNo: book.vendor_invoice_no,
      invoiceDate: book.invoice_date,
      currency: book.currency,
      notes: book.notes,
      remainingDcQty,
      lines: publicLines
    });
  }
  return { purchaseBooks: result };
}

/**
 * Record ACTIVE consumption rows for a DC. Validates remaining qty.
 * consumptions: [{ purchaseBookLineId, qty }]
 */
async function recordDcBookConsumption(trx, deliveryChallanId, consumptions, args = {}) {
  if (!(await trx.schema.hasTable('purchase_book_dc_consumption'))) {
    if (consumptions && consumptions.length) {
      throw httpError('Purchase Book DC consumption table is not migrated yet', 503, 'NOT_MIGRATED');
    }
    return [];
  }
  const list = Array.isArray(consumptions) ? consumptions : [];
  if (!list.length) return [];

  const actor = actorOf(args);
  const dcId = String(deliveryChallanId || '').trim();
  if (!dcId) throw httpError('deliveryChallanId is required', 400);

  const aggregated = new Map();
  for (const raw of list) {
    const lineId = String(raw.purchaseBookLineId || raw.purchase_book_line_id || '').trim();
    const qty = roundQty(raw.qty ?? raw.qtyConsumed ?? raw.qty_consumed);
    if (!lineId) throw httpError('purchaseBookLineId is required', 400, 'INVALID_CONSUMPTION');
    if (qty <= 0) continue;
    aggregated.set(lineId, roundQty((aggregated.get(lineId) || 0) + qty));
  }

  const created = [];
  for (const [lineId, qty] of aggregated.entries()) {
    const line = await trx('purchase_book_line').where({ id: lineId }).forUpdate().first();
    if (!line) throw httpError(`Purchase Book line not found: ${lineId}`, 404, 'BOOK_LINE_NOT_FOUND');
    const book = await trx('purchase_book').where({ id: line.purchase_book_id }).forUpdate().first();
    if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
    if (book.status !== 'POSTED') {
      throw httpError(`Purchase Book ${book.id} must be POSTED to use on a DC`, 409, 'BOOK_NOT_POSTED');
    }
    if (String(book.document_kind).toUpperCase() === 'CREDIT') {
      throw httpError('CREDIT Purchase Books cannot be used on an outbound DC', 400, 'CREDIT_NOT_ALLOWED');
    }
    const booked = roundQty(line.qty_booked);
    const consumed = await dcConsumedQtyForLine(trx, lineId);
    const remaining = roundQty(Math.max(0, booked - consumed));
    if (qty > remaining + 1e-9) {
      throw httpError(
        `Insufficient DC-able qty on book line ${lineId}`,
        409,
        'INSUFFICIENT_BOOK_DC_QTY',
        { purchaseBookLineId: lineId, requested: qty, remaining }
      );
    }
    const id = await uniqueId(
      trx,
      'purchase_book_dc_consumption',
      generatePurchaseBookDcConsumptionId,
      verifyPurchaseBookDcConsumptionId,
      'Purchase Book DC consumption'
    );
    await trx('purchase_book_dc_consumption').insert({
      id,
      delivery_challan_id: dcId,
      purchase_book_id: book.id,
      purchase_book_line_id: lineId,
      qty_consumed: qty,
      status: 'ACTIVE',
      created_by: actor,
      created_at: new Date().toISOString()
    });
    await writeBookEvent(trx, {
      purchaseBookId: book.id,
      purchaseBookLineId: lineId,
      type: 'DC_CONSUMED',
      actor,
      note: `DC ${dcId} consumed ${qty}`,
      metadata: { deliveryChallanId: dcId, qty }
    });
    created.push({ id, purchaseBookLineId: lineId, qtyConsumed: qty });
  }
  return created;
}

/**
 * Physical Tally Authority ADR §3: a holding that carries an ACTIVE Purchase Book
 * physical link but was added to a DC without its book records that link, capped
 * at the book line's remaining DC-able qty. Never blocks the DC.
 * Mutates matching items (purchaseBookId / purchaseBookLineId / autoBookLink).
 */
async function planAutoBookConsumptions(runner, items, explicitConsumptions = []) {
  if (!Array.isArray(items) || !items.length) return [];
  if (!(await runner.schema.hasTable('purchase_book_physical'))) return [];
  if (!(await runner.schema.hasTable('purchase_book_dc_consumption'))) return [];

  const planned = new Map();
  for (const c of explicitConsumptions || []) {
    const lineId = String(c.purchaseBookLineId || c.purchase_book_line_id || '').trim();
    if (lineId) planned.set(lineId, roundQty((planned.get(lineId) || 0) + roundQty(c.qty ?? c.qtyConsumed)));
  }

  const auto = [];
  for (const item of items) {
    if (!item || item.purchaseBookLineId) continue;
    const type = String(item.resourceType || '').toUpperCase();
    const resourceId = String(item.assetId || '').trim();
    if ((type !== 'ASSET' && type !== 'INVENTORY') || !resourceId) continue;
    if (/^(PO|PB)-LINE-/i.test(resourceId)) continue;

    const links = await runner('purchase_book_physical as p')
      .join('purchase_book as b', 'b.id', 'p.purchase_book_id')
      .where('p.status', 'ACTIVE')
      .andWhere('p.resource_type', type)
      .andWhereRaw('LOWER(p.resource_id) = LOWER(?)', [resourceId])
      .andWhere('b.status', 'POSTED')
      .andWhereRaw("UPPER(b.document_kind) <> 'CREDIT'")
      .orderBy('p.created_at', 'asc')
      .select('p.purchase_book_id', 'p.purchase_book_line_id', 'p.qty_allocated');
    if (!links.length) continue;

    const itemQty = Number(item.qty);
    let wanted = roundQty(Number.isFinite(itemQty) && itemQty > 0 ? itemQty : 1);
    for (const link of links) {
      if (wanted <= 0) break;
      const lineId = link.purchase_book_line_id;
      const line = await runner('purchase_book_line').where({ id: lineId }).first();
      if (!line) continue;
      const consumed = await dcConsumedQtyForLine(runner, lineId);
      const remaining = roundQty(Math.max(0, roundQty(line.qty_booked) - consumed - (planned.get(lineId) || 0)));
      const qty = roundQty(Math.min(wanted, remaining, roundQty(link.qty_allocated) || wanted));
      if (qty <= 0) continue;
      planned.set(lineId, roundQty((planned.get(lineId) || 0) + qty));
      auto.push({ purchaseBookLineId: lineId, purchaseBookId: link.purchase_book_id, qty, auto: true });
      if (!item.purchaseBookLineId) {
        item.purchaseBookId = link.purchase_book_id;
        item.purchaseBookLineId = lineId;
        item.autoBookLink = true;
      }
      wanted = roundQty(wanted - qty);
    }
  }
  return auto;
}

async function releaseDcBookConsumption(trx, deliveryChallanId, args = {}) {
  if (!(await trx.schema.hasTable('purchase_book_dc_consumption'))) return 0;
  const dcId = String(deliveryChallanId || '').trim();
  const actor = actorOf(args);
  const now = new Date().toISOString();
  const active = await trx('purchase_book_dc_consumption')
    .where({ delivery_challan_id: dcId, status: 'ACTIVE' })
    .select('purchase_book_id', 'purchase_book_line_id', 'qty_consumed');
  const updated = await trx('purchase_book_dc_consumption')
    .where({ delivery_challan_id: dcId, status: 'ACTIVE' })
    .update({
      status: 'RELEASED',
      released_by: actor,
      released_at: now
    });
  if (updated && (await trx.schema.hasTable('purchase_book_event'))) {
    const byBook = new Map();
    for (const row of active) {
      const list = byBook.get(row.purchase_book_id) || [];
      list.push(row);
      byBook.set(row.purchase_book_id, list);
    }
    for (const [bookId, rows] of byBook.entries()) {
      await writeBookEvent(trx, {
        purchaseBookId: bookId,
        type: 'DC_RELEASED',
        actor,
        note: `DC ${dcId} consumption released`,
        metadata: {
          deliveryChallanId: dcId,
          lines: rows.map((r) => ({
            purchaseBookLineId: r.purchase_book_line_id,
            qty: qtyNum(r.qty_consumed)
          }))
        }
      });
    }
  }
  return updated;
}

async function listHistory(id) {
  await requireTables();
  const bookId = String(id || '').trim();
  if (!verifyPurchaseBookId(bookId)) throw httpError('Invalid Purchase Book id', 400);
  const book = await db('purchase_book').where({ id: bookId }).first();
  if (!book) throw httpError('Purchase Book not found', 404, 'NOT_FOUND');
  if (!(await db.schema.hasTable('purchase_book_event'))) {
    return { purchaseBookId: bookId, events: [] };
  }
  const rows = await db('purchase_book_event')
    .where({ purchase_book_id: bookId })
    .orderBy('id', 'desc')
    .limit(200);
  return { purchaseBookId: bookId, events: rows.map(publicBookEvent) };
}

/** Recent Purchase Book events for Lifecycle History feed. */
async function listRecentEvents({ limit } = {}) {
  if (!(await db.schema.hasTable('purchase_book_event'))) {
    return { events: [] };
  }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const rows = await db('purchase_book_event as e')
    .leftJoin('purchase_book as b', 'b.id', 'e.purchase_book_id')
    .select(
      'e.*',
      'b.vendor_invoice_no',
      'b.procurement_po_id'
    )
    .orderBy('e.timestamp', 'desc')
    .orderBy('e.id', 'desc')
    .limit(cap);
  return { events: rows.map(publicBookEvent) };
}

module.exports = {
  listBooks,
  getBook,
  getPoBookCapacity,
  getPoBooksForDc,
  createFromPo,
  updateDraft,
  postBook,
  voidBook,
  recordDcBookConsumption,
  planAutoBookConsumptions,
  releaseDcBookConsumption,
  dcConsumedQtyForLine,
  listHistory,
  listRecentEvents,
  writeBookEvent,
  STATUSES,
  DOCUMENT_KINDS
};
