/**
 * Category vs Make on asset_kinds.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261023120000_asset_kind_role.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const SCHEMA = 'assets';
const TABLE = 'asset_kinds';

exports.up = async function up(knex) {
  if (!(await knex.schema.withSchema(SCHEMA).hasColumn(TABLE, 'kind_role'))) {
    await knex.schema.withSchema(SCHEMA).alterTable(TABLE, (table) => {
      table.string('kind_role', 16).notNullable().defaultTo('CATEGORY');
    });
  }
  await knex.raw(`
    UPDATE ${SCHEMA}.${TABLE}
    SET kind_role = 'CATEGORY'
    WHERE kind_role IS NULL OR kind_role = ''
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'asset_kinds_kind_role_check'
      ) THEN
        ALTER TABLE ${SCHEMA}.${TABLE}
        ADD CONSTRAINT asset_kinds_kind_role_check
        CHECK (kind_role IN ('CATEGORY', 'MAKE'));
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} DROP CONSTRAINT IF EXISTS asset_kinds_kind_role_check`);
  if (await knex.schema.withSchema(SCHEMA).hasColumn(TABLE, 'kind_role')) {
    await knex.schema.withSchema(SCHEMA).alterTable(TABLE, (table) => {
      table.dropColumn('kind_role');
    });
  }
};
