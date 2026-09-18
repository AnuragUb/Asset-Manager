/**
 * Allow multiple Receipt Notes to post quantity into the same holding.
 *
 * Original foundation enforced UNIQUE (resource_type, resource_id), which assumed
 * every receipt creates a brand-new Asset/Inventory row. Add-to-existing receiving
 * reuses the same holding across POs/receipts and needs append-only output rows.
 *
 * Replace with:
 *   - UNIQUE (receipt_line_id, resource_type, resource_id) — one output per line/holding
 *   - INDEX (resource_type, resource_id) — reverse/lookup by holding
 */

async function constraintExists(knex, name) {
  const row = await knex
    .select(knex.raw('1'))
    .from('pg_constraint')
    .where({ conname: name })
    .first();
  return !!row;
}

async function indexExists(knex, name) {
  const row = await knex
    .select(knex.raw('1'))
    .from('pg_indexes')
    .where({ indexname: name })
    .first();
  return !!row;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('receipt_physical_output'))) return;

  if (await constraintExists(knex, 'receipt_physical_output_resource_unique')) {
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      DROP CONSTRAINT receipt_physical_output_resource_unique
    `);
  }

  if (!(await constraintExists(knex, 'receipt_physical_output_line_resource_unique'))) {
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      ADD CONSTRAINT receipt_physical_output_line_resource_unique
      UNIQUE (receipt_line_id, resource_type, resource_id)
    `);
  }

  if (!(await indexExists(knex, 'idx_receipt_physical_output_resource'))) {
    await knex.raw(`
      CREATE INDEX idx_receipt_physical_output_resource
      ON receipt_physical_output (resource_type, resource_id)
    `);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('receipt_physical_output'))) return;

  if (await indexExists(knex, 'idx_receipt_physical_output_resource')) {
    await knex.raw(`DROP INDEX IF EXISTS idx_receipt_physical_output_resource`);
  }

  if (await constraintExists(knex, 'receipt_physical_output_line_resource_unique')) {
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      DROP CONSTRAINT receipt_physical_output_line_resource_unique
    `);
  }

  // Only restore global uniqueness when no holding is referenced by multiple rows.
  const dupes = await knex('receipt_physical_output')
    .select('resource_type', 'resource_id')
    .count('* as n')
    .groupBy('resource_type', 'resource_id')
    .havingRaw('COUNT(*) > 1');
  if (dupes.length) {
    throw new Error(
      'Cannot restore receipt_physical_output_resource_unique: some holdings have multiple receipt outputs'
    );
  }

  if (!(await constraintExists(knex, 'receipt_physical_output_resource_unique'))) {
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      ADD CONSTRAINT receipt_physical_output_resource_unique
      UNIQUE (resource_type, resource_id)
    `);
  }
};
