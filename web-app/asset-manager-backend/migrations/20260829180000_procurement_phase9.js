/**
 * Phase 9 — Procurement / Zoho Purchase Order mirror.
 *
 * Additive:
 *   procurement_po
 *   procurement_po_line
 *   procurement_po_external_ref
 *   procurement_sync_event
 *   receipt_note.zoho_po_id
 *   receipt_note_line.zoho_line_id
 *
 * Does NOT:
 *   - rewrite project_orders / project_order_items
 *   - migrate the two historical local POs
 *   - drop zoho_catalog
 *   - apply 20260824120000_create_managed_sets_tables.js
 *
 * Apply with:
 *   npx knex migrate:up 20260829180000_procurement_phase9.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const QTY = 'NUMERIC(18,6)';

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('product'))) {
    throw new Error('STOP: product table is missing; Phase 1 must be applied first');
  }
  if (!(await knex.schema.hasTable('receipt_note'))) {
    throw new Error('STOP: receipt_note is missing; Phase 7 must be applied first');
  }

  if (!(await knex.schema.hasTable('procurement_po'))) {
    await knex.schema.createTable('procurement_po', (table) => {
      table.string('id', 255).primary();
      table.string('source', 16).notNullable().defaultTo('ZOHO');
      table.string('classification', 32).notNullable().defaultTo('CANONICAL');
      table.string('zoho_po_id', 255).nullable();
      table.string('po_number', 255).nullable();
      table.string('subject', 255).nullable();
      table.string('status', 32).notNullable().defaultTo('CREATED');
      table.string('vendor_zoho_id', 255).nullable();
      table.text('vendor_name_snapshot').nullable();
      table.string('po_date', 64).nullable();
      table.string('due_date', 64).nullable();
      table.string('currency', 16).nullable();
      table.decimal('sub_total', 18, 2).nullable();
      table.decimal('discount', 18, 2).nullable();
      table.decimal('tax', 18, 2).nullable();
      table.decimal('grand_total', 18, 2).nullable();
      table.string('project_id', 255).nullable();
      table.string('source_hash', 64).nullable();
      table.timestamp('zoho_modified_at', { useTz: true }).nullable();
      table.timestamp('last_synced_at', { useTz: true }).nullable();
      table.text('last_error').nullable();
      table.timestamp('last_error_at', { useTz: true }).nullable();
      table.string('created_by', 255).nullable();
      table.string('updated_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE procurement_po
      ADD CONSTRAINT procurement_po_id_format_check
      CHECK (id ~ '^PPO-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE procurement_po
      ADD CONSTRAINT procurement_po_source_check
      CHECK (source IN ('ZOHO'))
    `);
    await knex.raw(`
      ALTER TABLE procurement_po
      ADD CONSTRAINT procurement_po_classification_check
      CHECK (classification IN ('CANONICAL', 'BRIDGE', 'LEGACY', 'MANUAL_REVIEW'))
    `);
    await knex.raw(`
      ALTER TABLE procurement_po
      ADD CONSTRAINT procurement_po_status_check
      CHECK (status IN ('CREATED', 'APPROVED', 'DELIVERED', 'CANCELLED'))
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX procurement_po_zoho_id_unique
      ON procurement_po (zoho_po_id)
      WHERE zoho_po_id IS NOT NULL AND BTRIM(zoho_po_id) <> ''
    `);
  }

  if (!(await knex.schema.hasTable('procurement_po_line'))) {
    await knex.schema.createTable('procurement_po_line', (table) => {
      table.string('id', 255).primary();
      table.string('procurement_po_id', 255).notNullable();
      table.string('zoho_line_id', 255).nullable();
      table.string('zoho_product_id', 255).nullable();
      table.string('product_id', 255).nullable();
      table.integer('sequence_number').nullable();
      table.text('description').nullable();
      table.specificType('ordered_qty', QTY).notNullable().defaultTo(0);
      table.string('unit', 64).nullable();
      table.decimal('list_price', 18, 4).nullable();
      table.decimal('discount', 18, 4).nullable();
      table.decimal('tax', 18, 4).nullable();
      table.decimal('net_total', 18, 4).nullable();
      table.string('line_status', 32).notNullable().defaultTo('OPEN');
      table.string('source_hash', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('procurement_po_id', 'fk_procurement_po_line_po_id')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
      table
        .foreign('product_id', 'fk_procurement_po_line_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE procurement_po_line
      ADD CONSTRAINT procurement_po_line_id_format_check
      CHECK (id ~ '^POL-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE procurement_po_line
      ADD CONSTRAINT procurement_po_line_qty_nonneg_check
      CHECK (ordered_qty >= 0)
    `);
    await knex.raw(`
      ALTER TABLE procurement_po_line
      ADD CONSTRAINT procurement_po_line_status_check
      CHECK (line_status IN ('OPEN', 'WITHDRAWN'))
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX procurement_po_line_zoho_id_unique
      ON procurement_po_line (zoho_line_id)
      WHERE zoho_line_id IS NOT NULL AND BTRIM(zoho_line_id) <> ''
    `);
    await knex.raw('CREATE INDEX idx_procurement_po_line_po_id ON procurement_po_line (procurement_po_id)');
    await knex.raw('CREATE INDEX idx_procurement_po_line_product_id ON procurement_po_line (product_id)');
  }

  if (!(await knex.schema.hasTable('procurement_po_external_ref'))) {
    await knex.schema.createTable('procurement_po_external_ref', (table) => {
      table.string('id', 255).primary();
      table.string('procurement_po_id', 255).notNullable();
      table.string('system', 32).notNullable().defaultTo('ZOHO_CRM');
      table.string('module', 64).notNullable().defaultTo('Purchase_Orders');
      table.string('external_id', 255).notNullable();
      table.string('link_origin', 16).notNullable().defaultTo('PULL');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('procurement_po_id', 'fk_procurement_po_ext_po_id')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE procurement_po_external_ref
      ADD CONSTRAINT procurement_po_ext_id_not_blank_check
      CHECK (BTRIM(external_id) <> '')
    `);
    await knex.raw(`
      ALTER TABLE procurement_po_external_ref
      ADD CONSTRAINT procurement_po_ext_unique
      UNIQUE (system, module, external_id)
    `);
    await knex.raw(`
      ALTER TABLE procurement_po_external_ref
      ADD CONSTRAINT procurement_po_ext_po_unique
      UNIQUE (procurement_po_id, system, module)
    `);
  }

  if (!(await knex.schema.hasTable('procurement_sync_event'))) {
    await knex.schema.createTable('procurement_sync_event', (table) => {
      table.string('id', 255).primary();
      table.string('procurement_po_id', 255).nullable();
      table.string('zoho_po_id', 255).nullable();
      table.string('operation', 64).notNullable();
      table.string('status', 16).notNullable();
      table.string('actor', 255).nullable();
      table.jsonb('changed_fields').nullable();
      table.text('error_message').nullable();
      table.timestamp('source_updated_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE procurement_sync_event
      ADD CONSTRAINT procurement_sync_event_id_format_check
      CHECK (id ~ '^PSE-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE procurement_sync_event
      ADD CONSTRAINT procurement_sync_event_status_check
      CHECK (status IN ('SUCCESS', 'ERROR', 'SKIPPED'))
    `);
    await knex.raw('CREATE INDEX idx_procurement_sync_event_po ON procurement_sync_event (procurement_po_id, created_at DESC)');
  }

  if (!(await knex.schema.hasColumn('receipt_note', 'zoho_po_id'))) {
    await knex.schema.alterTable('receipt_note', (table) => {
      table.string('zoho_po_id', 255).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('receipt_note_line', 'zoho_line_id'))) {
    await knex.schema.alterTable('receipt_note_line', (table) => {
      table.string('zoho_line_id', 255).nullable();
    });
  }

  if (!(await constraintExists(knex, 'fk_receipt_note_zoho_po_not_required'))) {
    /* lineage columns are snapshots; no FK to Zoho */
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('receipt_note_line', 'zoho_line_id')) {
    await knex.schema.alterTable('receipt_note_line', (table) => {
      table.dropColumn('zoho_line_id');
    });
  }
  if (await knex.schema.hasColumn('receipt_note', 'zoho_po_id')) {
    await knex.schema.alterTable('receipt_note', (table) => {
      table.dropColumn('zoho_po_id');
    });
  }
  await knex.schema.dropTableIfExists('procurement_sync_event');
  await knex.schema.dropTableIfExists('procurement_po_external_ref');
  await knex.schema.dropTableIfExists('procurement_po_line');
  await knex.schema.dropTableIfExists('procurement_po');
};
