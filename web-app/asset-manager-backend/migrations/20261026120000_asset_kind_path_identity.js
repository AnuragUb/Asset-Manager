/**
 * Kind identity is the path: same Make/Category name may exist under
 * different parents. Duplicate names under the same parent stay forbidden.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261026120000_asset_kind_path_identity.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const SCHEMA = 'assets';
const TABLE = 'asset_kinds';

exports.up = async function up(knex) {
  if (!(await knex.schema.withSchema(SCHEMA).hasColumn(TABLE, 'id'))) {
    await knex.schema.withSchema(SCHEMA).alterTable(TABLE, (table) => {
      table.string('id', 64);
    });
  }

  await knex.raw(`
    UPDATE ${SCHEMA}.${TABLE}
    SET id = name
    WHERE id IS NULL OR btrim(id) = ''
  `);

  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} ALTER COLUMN id SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} DROP CONSTRAINT IF EXISTS asset_kinds_pkey`);
  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} ADD PRIMARY KEY (id)`);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS asset_kinds_live_sibling_name
    ON ${SCHEMA}.${TABLE} (
      lower(coalesce(module, '')),
      lower(coalesce(parentname, '')),
      lower(name)
    )
    WHERE coalesce(is_deleted, 0) = 0
  `);

  // Undo name-merge: if holdings still point at parent / name, put the kind back.
  await knex.raw(`
    WITH inferred AS (
      SELECT
        a.type AS kind_name,
        reverse(trim(split_part(reverse(a.folder_path), ' / ', 2))) AS parent_from_path,
        count(*)::int AS n
      FROM ${SCHEMA}.assets a
      WHERE coalesce(a.folder_path, '') <> ''
        AND coalesce(a.type, '') <> ''
        AND position(' / ' in a.folder_path) > 0
      GROUP BY 1, 2
    ),
    best AS (
      SELECT DISTINCT ON (kind_name) kind_name, parent_from_path
      FROM inferred
      ORDER BY kind_name, n DESC
    )
    UPDATE ${SCHEMA}.${TABLE} k
    SET parentname = b.parent_from_path
    FROM best b
    WHERE k.name = b.kind_name
      AND coalesce(k.is_deleted, 0) = 0
      AND k.parentname IS DISTINCT FROM b.parent_from_path
      AND EXISTS (
        SELECT 1
        FROM ${SCHEMA}.${TABLE} p
        WHERE p.name = b.parent_from_path
          AND coalesce(p.is_deleted, 0) = 0
      )
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${SCHEMA}.asset_kinds_live_sibling_name`);
  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} DROP CONSTRAINT IF EXISTS asset_kinds_pkey`);
  await knex.raw(`ALTER TABLE ${SCHEMA}.${TABLE} ADD PRIMARY KEY (name)`);
};
