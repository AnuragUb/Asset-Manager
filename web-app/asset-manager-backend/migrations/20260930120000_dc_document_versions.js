/**
 * Document versions for Delivery Challans edited in the builder.
 *
 * Each save of a drafted or stock-reserved DC stores a snapshot, the reason,
 * and the lifecycle stage the DC was in when that version was written
 * (DRAFT or READY). Posted DCs are not revised here.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20260930120000_dc_document_versions.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('delivery_challans'))) return;
  if (await knex.schema.hasTable('delivery_challan_version')) return;

  await knex.schema.createTable('delivery_challan_version', (table) => {
    table.bigIncrements('id').primary();
    table.string('delivery_challan_id', 255).notNullable();
    table.integer('version_no').notNullable();
    table.string('lifecycle_status', 32).notNullable();
    table.text('reason').notNullable();
    table.string('actor', 255).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('snapshot_json').notNullable();

    table
      .foreign('delivery_challan_id', 'fk_dc_version_dc')
      .references('id')
      .inTable('delivery_challans')
      .onDelete('CASCADE');

    table.unique(['delivery_challan_id', 'version_no'], 'uq_dc_version_no');
  });

  await knex.raw(`
    ALTER TABLE delivery_challan_version
    ADD CONSTRAINT delivery_challan_version_lifecycle_check
    CHECK (lifecycle_status IN ('DRAFT','READY','DISPATCHED'))
  `);
  await knex.raw(`CREATE INDEX idx_dc_version_dc_id ON delivery_challan_version (delivery_challan_id, version_no DESC)`);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('delivery_challan_version')) {
    await knex.schema.dropTable('delivery_challan_version');
  }
};
