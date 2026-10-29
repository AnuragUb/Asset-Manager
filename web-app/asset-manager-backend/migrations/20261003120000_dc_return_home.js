/**
 * Where a Return Inward lands.
 *
 * ORIGIN — leave the holding at the place it left from.
 * ASSET / INVENTORY — set current location to return_location, chosen from
 * that register's places. Does not convert an asset into inventory.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261003120000_dc_return_home.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('dc_return_log'))) return;
  const cols = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'dc_return_log' })
    .select('column_name');
  const have = new Set(cols.map((c) => c.column_name));
  await knex.schema.alterTable('dc_return_log', (table) => {
    if (!have.has('return_home')) table.string('return_home', 16).nullable();
    if (!have.has('return_location')) table.string('return_location', 255).nullable();
  });
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE dc_return_log
        ADD CONSTRAINT dc_return_log_home_check
        CHECK (return_home IS NULL OR return_home IN ('ORIGIN','ASSET','INVENTORY'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('dc_return_log'))) return;
  await knex.raw('ALTER TABLE dc_return_log DROP CONSTRAINT IF EXISTS dc_return_log_home_check');
  const cols = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'dc_return_log' })
    .select('column_name');
  const have = new Set(cols.map((c) => c.column_name));
  await knex.schema.alterTable('dc_return_log', (table) => {
    if (have.has('return_location')) table.dropColumn('return_location');
    if (have.has('return_home')) table.dropColumn('return_home');
  });
};
