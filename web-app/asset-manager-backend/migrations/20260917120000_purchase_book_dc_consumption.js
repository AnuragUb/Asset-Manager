/**
 * Purchase Book ↔ DC partial qty consumption (ADR amendment 2026-09-17).
 *
 * Additive:
 *   purchase_book_dc_consumption
 *   delivery_challans.voided_at / voided_by
 *
 * One DC may consume qty from many book lines; only ACTIVE rows lock qty.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('purchase_book_line'))) {
    throw new Error('STOP: purchase_book_line missing; apply purchase_book_foundation first');
  }
  if (!(await knex.schema.hasTable('delivery_challans'))) {
    throw new Error('STOP: delivery_challans missing');
  }

  if (!(await knex.schema.hasColumn('delivery_challans', 'voided_at'))) {
    await knex.schema.alterTable('delivery_challans', (table) => {
      table.timestamp('voided_at', { useTz: true }).nullable();
      table.string('voided_by', 255).nullable();
    });
  }

  if (!(await knex.schema.hasTable('purchase_book_dc_consumption'))) {
    await knex.schema.createTable('purchase_book_dc_consumption', (table) => {
      table.string('id', 255).primary();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('purchase_book_id', 255).notNullable();
      table.string('purchase_book_line_id', 255).notNullable();
      table.specificType('qty_consumed', 'NUMERIC(18,6)').notNullable();
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('released_by', 255).nullable();
      table.timestamp('released_at', { useTz: true }).nullable();

      table
        .foreign('delivery_challan_id', 'fk_pb_dc_cons_dc_id')
        .references('id')
        .inTable('delivery_challans')
        .onDelete('CASCADE');
      table
        .foreign('purchase_book_id', 'fk_pb_dc_cons_book_id')
        .references('id')
        .inTable('purchase_book')
        .onDelete('RESTRICT');
      table
        .foreign('purchase_book_line_id', 'fk_pb_dc_cons_line_id')
        .references('id')
        .inTable('purchase_book_line')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE purchase_book_dc_consumption
      ADD CONSTRAINT purchase_book_dc_consumption_id_format_check
      CHECK (id ~ '^PBC-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE purchase_book_dc_consumption
      ADD CONSTRAINT purchase_book_dc_consumption_status_check
      CHECK (status IN ('ACTIVE', 'RELEASED'))
    `);
    await knex.raw(`
      ALTER TABLE purchase_book_dc_consumption
      ADD CONSTRAINT purchase_book_dc_consumption_qty_positive
      CHECK (qty_consumed > 0)
    `);
    await knex.raw(`
      CREATE INDEX idx_pb_dc_cons_line_active
      ON purchase_book_dc_consumption (purchase_book_line_id)
      WHERE status = 'ACTIVE'
    `);
    await knex.raw(`
      CREATE INDEX idx_pb_dc_cons_dc_id
      ON purchase_book_dc_consumption (delivery_challan_id)
    `);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('purchase_book_dc_consumption')) {
    await knex.schema.dropTable('purchase_book_dc_consumption');
  }
  if (await knex.schema.hasColumn('delivery_challans', 'voided_at')) {
    await knex.schema.alterTable('delivery_challans', (table) => {
      table.dropColumn('voided_at');
      table.dropColumn('voided_by');
    });
  }
};
