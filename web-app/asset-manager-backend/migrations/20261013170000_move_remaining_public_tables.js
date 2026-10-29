/**
 * Move the last live business tables out of public.
 * asset_kinds and components belong with the asset registers.
 * sets and set_components belong with the set tables.
 * Retired snapshots and the Knex ledger stay in public.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const MOVES = [
  ['asset_kinds', 'assets'],
  ['components', 'assets'],
  ['sets', 'sets'],
  ['set_components', 'sets']
];

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unexpected identifier ${name}`);
  }
  return name;
}

async function exists(knex, schema, table) {
  const found = await knex.raw(`
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ? AND c.relname = ? AND c.relkind = 'r'
  `, [schema, table]);
  return found.rows.length > 0;
}

exports.up = async function (knex) {
  for (const [tableName, schemaName] of MOVES) {
    const table = ident(tableName);
    const schema = ident(schemaName);
    if (!(await exists(knex, 'public', table))) continue;
    if (await exists(knex, schema, table)) {
      throw new Error(`STOP: ${schema}.${table} already exists`);
    }
    const refs = await knex.raw(`
      SELECT src_n.nspname AS src_schema, src.relname AS src_table, con.conname
      FROM pg_constraint con
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_namespace src_n ON src_n.oid = src.relnamespace
      WHERE con.contype = 'f'
        AND tn.nspname = 'public'
        AND tgt.relname = ?
        AND NOT (src_n.nspname = 'public' AND src.relname = ANY(?))
    `, [table, MOVES.map(([name]) => name)]);
    if (refs.rows.length) {
      const detail = refs.rows.map((ref) => `${ref.src_schema}.${ref.src_table} (${ref.conname})`).join(', ');
      throw new Error(`STOP: public.${table} is referenced by ${detail}`);
    }
    await knex.raw(`ALTER TABLE public.${table} SET SCHEMA ${schema}`);
  }
};

exports.down = async function (knex) {
  for (const [tableName, schemaName] of [...MOVES].reverse()) {
    const table = ident(tableName);
    const schema = ident(schemaName);
    if (!(await exists(knex, schema, table))) continue;
    if (await exists(knex, 'public', table)) continue;
    await knex.raw(`ALTER TABLE ${schema}.${table} SET SCHEMA public`);
  }
};
