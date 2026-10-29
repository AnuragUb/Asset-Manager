/**
 * Dated HSN / SAC history per Asset or Inventory holding.
 * Viewer + change log. Does not alter quantity or tally.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261022120000_holding_hsn_history.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const SCHEMA = 'utility';
const TABLE = 'holding_hsn_history';

exports.up = async function up(knex) {
  if (!(await knex.schema.withSchema(SCHEMA).hasTable(TABLE))) {
    await knex.schema.withSchema(SCHEMA).createTable(TABLE, (table) => {
      table.increments('id').primary();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.string('hsn_code', 64).notNullable().defaultTo('');
      table.string('previous_hsn_code', 64).nullable();
      table.string('kind', 16).notNullable().defaultTo('CHANGE');
      table.timestamp('effective_from', { useTz: true }).notNullable();
      table.string('actor', 255).nullable();
      table.text('note').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE ${SCHEMA}.${TABLE}
      ADD CONSTRAINT holding_hsn_history_type_check
      CHECK (resource_type IN ('ASSET', 'INVENTORY'))
    `);
    await knex.raw(`
      ALTER TABLE ${SCHEMA}.${TABLE}
      ADD CONSTRAINT holding_hsn_history_kind_check
      CHECK (kind IN ('OPENING', 'CHANGE'))
    `);
    await knex.raw(`
      CREATE INDEX holding_hsn_history_resource_idx
      ON ${SCHEMA}.${TABLE} (resource_type, resource_id, effective_from)
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.withSchema(SCHEMA).dropTableIfExists(TABLE);
};
