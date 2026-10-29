/**
 * Shared vendor invoice identity.
 *
 * One row per vendor name + invoice number. Purchase Books and Receipt Notes
 * gain a nullable reference. The typed vendor_invoice_no columns stay.
 * pdf_storage_key is the place a hosted PDF will hang later; nothing is uploaded here.
 *
 * Existing numbers are linked when both the vendor name and the number are present.
 * Posted documents keep their text. Rows with a blank vendor or a blank number stay unlinked.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261005120000_vendor_invoice.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const IdGenerator = require('../IdGenerator');

function keyOf(value) {
  return String(value || '').trim().toLowerCase();
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('purchase_book'))) {
    throw new Error('STOP: purchase_book is missing');
  }
  if (!(await knex.schema.hasTable('receipt_note'))) {
    throw new Error('STOP: receipt_note is missing');
  }

  if (!(await knex.schema.hasTable('vendor_invoice'))) {
    await knex.schema.createTable('vendor_invoice', (table) => {
      table.string('id', 255).primary();
      table.text('vendor_name').notNullable();
      table.text('vendor_key').notNullable();
      table.text('invoice_number').notNullable();
      table.text('invoice_number_key').notNullable();
      table.text('invoice_date').nullable();
      table.text('pdf_storage_key').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE vendor_invoice
      ADD CONSTRAINT vendor_invoice_id_format_check
      CHECK (id ~ '^VIN-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX vendor_invoice_vendor_number_unique
      ON vendor_invoice (vendor_key, invoice_number_key)
    `);
  }

  const bookCols = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'purchase_book' })
    .select('column_name');
  if (!bookCols.some((c) => c.column_name === 'vendor_invoice_id')) {
    await knex.schema.alterTable('purchase_book', (table) => {
      table.string('vendor_invoice_id', 255).nullable();
    });
    await knex.raw(`
      ALTER TABLE purchase_book
      ADD CONSTRAINT fk_purchase_book_vendor_invoice
      FOREIGN KEY (vendor_invoice_id) REFERENCES vendor_invoice (id)
      ON DELETE SET NULL
    `);
    await knex.raw('CREATE INDEX idx_purchase_book_vendor_invoice ON purchase_book (vendor_invoice_id)');
  }

  const noteCols = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'receipt_note' })
    .select('column_name');
  if (!noteCols.some((c) => c.column_name === 'vendor_invoice_id')) {
    await knex.schema.alterTable('receipt_note', (table) => {
      table.string('vendor_invoice_id', 255).nullable();
    });
    await knex.raw(`
      ALTER TABLE receipt_note
      ADD CONSTRAINT fk_receipt_note_vendor_invoice
      FOREIGN KEY (vendor_invoice_id) REFERENCES vendor_invoice (id)
      ON DELETE SET NULL
    `);
    await knex.raw('CREATE INDEX idx_receipt_note_vendor_invoice ON receipt_note (vendor_invoice_id)');
  }

  const groups = new Map();
  function take(vendorName, invoiceNumber, invoiceDate, target) {
    const name = String(vendorName || '').trim();
    const number = String(invoiceNumber || '').trim();
    if (!name || !number) return;
    const key = `${keyOf(name)}\u0000${keyOf(number)}`;
    let group = groups.get(key);
    if (!group) {
      group = { vendorName: name, invoiceNumber: number, invoiceDate: null, books: [], notes: [] };
      groups.set(key, group);
    }
    const date = invoiceDate == null || String(invoiceDate).trim() === '' ? null : String(invoiceDate).trim();
    if (!group.invoiceDate && date) group.invoiceDate = date;
    group[target.kind].push(target.id);
  }

  const books = await knex('purchase_book as b')
    .leftJoin('procurement_po as p', 'p.id', 'b.procurement_po_id')
    .whereNull('b.vendor_invoice_id')
    .select('b.id', 'b.vendor_invoice_no', 'b.invoice_date', 'p.vendor_name_snapshot');
  books.forEach((row) => take(row.vendor_name_snapshot, row.vendor_invoice_no, row.invoice_date, { kind: 'books', id: row.id }));

  const notes = await knex('receipt_note')
    .whereNull('vendor_invoice_id')
    .select('id', 'vendor_name', 'vendor_invoice_no');
  notes.forEach((row) => take(row.vendor_name, row.vendor_invoice_no, null, { kind: 'notes', id: row.id }));

  const now = new Date().toISOString();
  for (const group of groups.values()) {
    let invoice = await knex('vendor_invoice')
      .where({ vendor_key: keyOf(group.vendorName), invoice_number_key: keyOf(group.invoiceNumber) })
      .first();
    if (!invoice) {
      const id = IdGenerator.generateVendorInvoiceId();
      if (!IdGenerator.verifyVendorInvoiceId(id)) {
        throw new Error('ID generator produced an invalid vendor invoice id');
      }
      await knex('vendor_invoice').insert({
        id,
        vendor_name: group.vendorName,
        vendor_key: keyOf(group.vendorName),
        invoice_number: group.invoiceNumber,
        invoice_number_key: keyOf(group.invoiceNumber),
        invoice_date: group.invoiceDate,
        pdf_storage_key: null,
        created_at: now,
        updated_at: now
      });
      invoice = { id };
    }
    if (group.books.length) {
      await knex('purchase_book').whereIn('id', group.books).update({ vendor_invoice_id: invoice.id });
    }
    if (group.notes.length) {
      await knex('receipt_note').whereIn('id', group.notes).update({ vendor_invoice_id: invoice.id });
    }
  }
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE purchase_book DROP CONSTRAINT IF EXISTS fk_purchase_book_vendor_invoice');
  await knex.raw('DROP INDEX IF EXISTS idx_purchase_book_vendor_invoice');
  await knex.raw('ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS fk_receipt_note_vendor_invoice');
  await knex.raw('DROP INDEX IF EXISTS idx_receipt_note_vendor_invoice');
  if (await knex.schema.hasColumn('purchase_book', 'vendor_invoice_id')) {
    await knex.schema.alterTable('purchase_book', (table) => {
      table.dropColumn('vendor_invoice_id');
    });
  }
  if (await knex.schema.hasColumn('receipt_note', 'vendor_invoice_id')) {
    await knex.schema.alterTable('receipt_note', (table) => {
      table.dropColumn('vendor_invoice_id');
    });
  }
  await knex.schema.dropTableIfExists('vendor_invoice');
};
