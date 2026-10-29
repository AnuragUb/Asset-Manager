/**
 * The logical schemas held copies. The live tables, including foreign keys
 * and triggers, were still in public and were ahead of those copies.
 *
 * Drop each stale copy, then move the live public table into the schema
 * that already owned that name. Knex's ledger stays in public. The assets
 * schema is already the live home of the asset registers and is left alone.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const SCHEMAS = [
  'delivery_challans',
  'inventory',
  'purchase_books',
  'purchase_orders',
  'receipt_note',
  'sets',
  'utility'
];

const KEEP_IN_PUBLIC = new Set(['knex_migrations', 'knex_migrations_lock']);

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unexpected identifier ${name}`);
  }
  return name;
}

async function duplicatePairs(knex) {
  const found = await knex.raw(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = ANY(?)
      AND EXISTS (
        SELECT 1
        FROM pg_class pc
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace
        WHERE pn.nspname = 'public'
          AND pc.relname = c.relname
          AND pc.relkind = 'r'
      )
    ORDER BY n.nspname, c.relname
  `, [SCHEMAS]);
  return found.rows;
}

async function outsideReferences(knex, schema, table) {
  const refs = await knex.raw(`
    SELECT src_n.nspname AS src_schema, src.relname AS src_table, con.conname
    FROM pg_constraint con
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace src_n ON src_n.oid = src.relnamespace
    WHERE con.contype = 'f'
      AND tn.nspname = ?
      AND tgt.relname = ?
      AND src_n.nspname <> ?
  `, [schema, table, schema]);
  return refs.rows;
}

exports.up = async function (knex) {
  const pairs = await duplicatePairs(knex);
  for (const row of pairs) {
    const refs = await outsideReferences(knex, row.schema_name, row.table_name);
    if (refs.length) {
      const detail = refs.map((ref) => `${ref.src_schema}.${ref.src_table} (${ref.conname})`).join(', ');
      throw new Error(`STOP: ${row.schema_name}.${row.table_name} is referenced by ${detail}`);
    }
    const schema = ident(row.schema_name);
    const table = ident(row.table_name);
    await knex.raw(`DROP TABLE ${schema}.${table} CASCADE`);
    if (KEEP_IN_PUBLIC.has(table)) continue;
    await knex.raw(`ALTER TABLE public.${table} SET SCHEMA ${schema}`);
  }
};

exports.down = async function (knex) {
  const pairs = await knex.raw(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = ANY(?)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_class pc
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace
        WHERE pn.nspname = 'public'
          AND pc.relname = c.relname
          AND pc.relkind = 'r'
      )
    ORDER BY n.nspname, c.relname
  `, [SCHEMAS]);
  for (const row of pairs.rows) {
    const schema = ident(row.schema_name);
    const table = ident(row.table_name);
    await knex.raw(`ALTER TABLE ${schema}.${table} SET SCHEMA public`);
  }
};
