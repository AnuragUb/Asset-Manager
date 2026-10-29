/**
 * Kind parent is a folder/kind id so the same category name can sit under
 * two different top folders.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261026140000_asset_kind_parent_id.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const SCHEMA = 'assets';
const TABLE = 'asset_kinds';

exports.up = async function up(knex) {
  if (!(await knex.schema.withSchema(SCHEMA).hasColumn(TABLE, 'parent_id'))) {
    await knex.schema.withSchema(SCHEMA).alterTable(TABLE, (table) => {
      table.string('parent_id', 64);
    });
  }

  await knex.raw(`
    UPDATE ${SCHEMA}.${TABLE} k
    SET parent_id = f.id
    FROM ${SCHEMA}.asset_folders f
    WHERE (k.parent_id IS NULL OR btrim(k.parent_id) = '')
      AND lower(f.name) = lower(k.parentname)
  `);

  await knex.raw(`
    UPDATE ${SCHEMA}.${TABLE} k
    SET parent_id = p.id
    FROM ${SCHEMA}.${TABLE} p
    WHERE (k.parent_id IS NULL OR btrim(k.parent_id) = '')
      AND p.id IS DISTINCT FROM k.id
      AND coalesce(p.is_deleted, 0) = 0
      AND lower(p.name) = lower(k.parentname)
  `);

  await knex.raw(`DROP INDEX IF EXISTS ${SCHEMA}.asset_kinds_live_sibling_name`);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS asset_kinds_live_sibling_name
    ON ${SCHEMA}.${TABLE} (
      lower(coalesce(module, '')),
      lower(coalesce(parent_id, '')),
      lower(name)
    )
    WHERE coalesce(is_deleted, 0) = 0
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${SCHEMA}.asset_kinds_live_sibling_name`);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS asset_kinds_live_sibling_name
    ON ${SCHEMA}.${TABLE} (
      lower(coalesce(module, '')),
      lower(coalesce(parentname, '')),
      lower(name)
    )
    WHERE coalesce(is_deleted, 0) = 0
  `);
};
