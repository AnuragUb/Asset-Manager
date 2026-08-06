/**
 * Inventory preview: persist batch serial mode on 9090/test only
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    console.log(`[inventory-preview] Skipping inventory is_batch column for database ${dbName}`);
    return;
  }

  const hasTable = await knex.schema.hasTable('inventory_items');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('inventory_items', 'is_batch');
  if (!hasColumn) {
    await knex.schema.alterTable('inventory_items', (table) => {
      table.integer('is_batch').defaultTo(0);
    });
  }
};

exports.down = async function () {
  // Intentionally no-op: preview-only schema expansion on 9090.
};

