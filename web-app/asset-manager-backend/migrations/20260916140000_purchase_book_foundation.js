/**
 * Purchase Book foundation (ADR-PURCHASE-BOOK-001).
 *
 * Additive:
 *   purchase_book
 *   purchase_book_line
 *   view.purchase_books permission (+ grants copied from view.purchase_orders)
 *
 * Does NOT sync to Zoho Books in this migration.
 */

const QTY = 'NUMERIC(18,6)';

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) {
    throw new Error('STOP: procurement_po missing; Phase 9 must be applied first');
  }
  if (!(await knex.schema.hasTable('product'))) {
    throw new Error('STOP: product table missing');
  }

  if (!(await knex.schema.hasTable('purchase_book'))) {
    await knex.schema.createTable('purchase_book', (table) => {
      table.string('id', 255).primary();
      table.string('procurement_po_id', 255).notNullable();
      table.string('document_kind', 16).notNullable().defaultTo('INVOICE');
      table.string('status', 16).notNullable().defaultTo('DRAFT');
      table.string('vendor_invoice_no', 255).nullable();
      table.string('invoice_date', 64).nullable();
      table.string('currency', 16).nullable();
      table.decimal('sub_total', 18, 2).nullable();
      table.decimal('tax_total', 18, 2).nullable();
      table.decimal('grand_total', 18, 2).nullable();
      table.text('notes').nullable();
      // Zoho Books sync placeholders (unused in v1)
      table.string('external_system', 32).nullable();
      table.string('external_id', 255).nullable();
      table.string('sync_status', 32).nullable();
      table.timestamp('last_synced_at', { useTz: true }).nullable();
      table.text('last_sync_error').nullable();
      table.string('created_by', 255).nullable();
      table.string('updated_by', 255).nullable();
      table.string('posted_by', 255).nullable();
      table.timestamp('posted_at', { useTz: true }).nullable();
      table.string('voided_by', 255).nullable();
      table.timestamp('voided_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('procurement_po_id', 'fk_purchase_book_po_id')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE purchase_book
      ADD CONSTRAINT purchase_book_id_format_check
      CHECK (id ~ '^PBK-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE purchase_book
      ADD CONSTRAINT purchase_book_document_kind_check
      CHECK (document_kind IN ('INVOICE', 'CREDIT'))
    `);
    await knex.raw(`
      ALTER TABLE purchase_book
      ADD CONSTRAINT purchase_book_status_check
      CHECK (status IN ('DRAFT', 'POSTED', 'VOID'))
    `);
    await knex.raw(`CREATE INDEX idx_purchase_book_po_id ON purchase_book (procurement_po_id)`);
    await knex.raw(`CREATE INDEX idx_purchase_book_status ON purchase_book (status)`);
  }

  if (!(await knex.schema.hasTable('purchase_book_line'))) {
    await knex.schema.createTable('purchase_book_line', (table) => {
      table.string('id', 255).primary();
      table.string('purchase_book_id', 255).notNullable();
      table.string('procurement_po_line_id', 255).notNullable();
      table.string('product_id', 255).notNullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.string('display_name', 512).nullable();
      table.text('display_description').nullable();
      table.specificType('qty_booked', QTY).notNullable().defaultTo(0);
      table.string('unit', 64).nullable();
      table.decimal('unit_price', 18, 4).nullable();
      table.decimal('discount', 18, 4).nullable();
      table.decimal('tax', 18, 4).nullable();
      table.decimal('line_total', 18, 4).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('purchase_book_id', 'fk_purchase_book_line_book_id')
        .references('id')
        .inTable('purchase_book')
        .onDelete('CASCADE');
      table
        .foreign('procurement_po_line_id', 'fk_purchase_book_line_po_line_id')
        .references('id')
        .inTable('procurement_po_line')
        .onDelete('RESTRICT');
      table
        .foreign('product_id', 'fk_purchase_book_line_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE purchase_book_line
      ADD CONSTRAINT purchase_book_line_id_format_check
      CHECK (id ~ '^PBL-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE purchase_book_line
      ADD CONSTRAINT purchase_book_line_qty_positive_check
      CHECK (qty_booked > 0)
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX purchase_book_line_book_po_line_unique
      ON purchase_book_line (purchase_book_id, procurement_po_line_id)
    `);
    await knex.raw(`CREATE INDEX idx_purchase_book_line_po_line ON purchase_book_line (procurement_po_line_id)`);
    await knex.raw(`CREATE INDEX idx_purchase_book_line_product ON purchase_book_line (product_id)`);
  }

  if (await knex.schema.hasTable('permissions')) {
    const key = 'view.purchase_books';
    const existing = await knex('permissions').where({ key }).first();
    if (existing) {
      await knex('permissions').where({ key }).update({
        description: 'View Purchase Book (Tax Invoice book against PO)'
      });
    } else {
      await knex('permissions').insert({
        key,
        description: 'View Purchase Book (Tax Invoice book against PO)'
      });
    }

    if (await knex.schema.hasTable('role_permissions')) {
      const donorRoles = await knex('role_permissions')
        .where({ permission_key: 'view.purchase_orders' })
        .select('role_name');
      for (const row of donorRoles) {
        await knex('role_permissions')
          .insert({ role_name: row.role_name, permission_key: key })
          .onConflict(['role_name', 'permission_key'])
          .ignore();
      }
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('role_permissions')) {
    await knex('role_permissions').where({ permission_key: 'view.purchase_books' }).del();
  }
  if (await knex.schema.hasTable('permissions')) {
    await knex('permissions').where({ key: 'view.purchase_books' }).del();
  }
  await knex.schema.dropTableIfExists('purchase_book_line');
  await knex.schema.dropTableIfExists('purchase_book');
};
