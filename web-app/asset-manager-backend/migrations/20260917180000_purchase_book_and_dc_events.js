/**
 * Append-only event streams for Purchase Book + Delivery Challan lifecycle history.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('purchase_book_event'))) {
    await knex.schema.createTable('purchase_book_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('purchase_book_id', 255).notNullable();
      table.string('purchase_book_line_id', 255).nullable();
      table.string('type', 48).notNullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();

      table
        .foreign('purchase_book_id', 'fk_pb_event_book_id')
        .references('id')
        .inTable('purchase_book')
        .onDelete('CASCADE');
    });
    await knex.raw(`
      ALTER TABLE purchase_book_event
      ADD CONSTRAINT purchase_book_event_type_check
      CHECK (type IN (
        'CREATED','UPDATED','POSTED','VOIDED',
        'PHYSICAL_ALLOCATED','PHYSICAL_RELEASED',
        'DC_CONSUMED','DC_RELEASED'
      ))
    `);
    await knex.raw(`CREATE INDEX idx_pb_event_book_id ON purchase_book_event (purchase_book_id, id)`);
    await knex.raw(`CREATE INDEX idx_pb_event_timestamp ON purchase_book_event (timestamp DESC)`);
  }

  if (!(await knex.schema.hasTable('delivery_challan_event'))) {
    await knex.schema.createTable('delivery_challan_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('type', 48).notNullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();
    });
    await knex.raw(`
      ALTER TABLE delivery_challan_event
      ADD CONSTRAINT delivery_challan_event_type_check
      CHECK (type IN ('CREATED','VOIDED','UPDATED'))
    `);
    await knex.raw(`CREATE INDEX idx_dc_event_dc_id ON delivery_challan_event (delivery_challan_id, id)`);
    await knex.raw(`CREATE INDEX idx_dc_event_timestamp ON delivery_challan_event (timestamp DESC)`);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('delivery_challan_event')) {
    await knex.schema.dropTable('delivery_challan_event');
  }
  if (await knex.schema.hasTable('purchase_book_event')) {
    await knex.schema.dropTable('purchase_book_event');
  }
};
