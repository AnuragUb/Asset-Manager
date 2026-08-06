/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    console.log(`[inventory-preview] Skipping inventory preview tables for database ${dbName}`);
    return;
  }

  const hasFolders = await knex.schema.hasTable('inventory_folders');
  if (!hasFolders) {
    await knex.schema.createTable('inventory_folders', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('parentid').nullable();
      table.string('icon').defaultTo('📦');
      table.string('module').defaultTo('INVENTORY');
      table.string('createdby');
      table.string('timestamp');
      table.integer('is_deleted').defaultTo(0);
      table.string('deleted_at');

      table.foreign('parentid').references('inventory_folders.id').onDelete('SET NULL');
      table.index(['parentid']);
    });
  }

  const hasKinds = await knex.schema.hasTable('inventory_kinds');
  if (!hasKinds) {
    await knex.schema.createTable('inventory_kinds', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('folderid').nullable();
      table.string('parentid').nullable();
      table.string('module').defaultTo('INVENTORY');
      table.string('icon').defaultTo('📦');
      table.string('displayimage');
      table.string('identifier');
      table.string('lastupdated');
      table.integer('is_deleted').defaultTo(0);
      table.string('deleted_at');

      table.foreign('folderid').references('inventory_folders.id').onDelete('SET NULL');
      table.foreign('parentid').references('inventory_kinds.id').onDelete('SET NULL');
      table.index(['folderid']);
      table.index(['parentid']);
    });
  }

  const hasItems = await knex.schema.hasTable('inventory_items');
  if (!hasItems) {
    await knex.schema.createTable('inventory_items', (table) => {
      table.string('id').primary();
      table.text('itemname').notNullable();
      table.text('itemdescription');
      table.string('status').defaultTo('In Store');
      table.string('make');
      table.string('model');
      table.string('srno');
      table.string('serialno');
      table.string('type');
      table.string('category');
      table.text('icon');
      table.string('parentid').nullable();
      table.string('folderid').nullable();
      table.string('kindid').nullable();
      table.text('currentlocation');
      table.text('remarks');
      table.string('lastupdated');
      table.string('currency').defaultTo('INR');
      table.float('asset_value').defaultTo(0);
      table.integer('warranty_months').defaultTo(0);
      table.integer('amc_months').defaultTo(0);
      table.float('quantity_total').defaultTo(0);
      table.float('quantity_available').defaultTo(0);
      table.integer('quantity_precision').defaultTo(0);
      table.integer('is_quantity_tracked').defaultTo(0);
      table.integer('is_set').defaultTo(0);
      table.string('set_price_mode');
      table.string('hsn_code');
      table.float('weight').defaultTo(0);
      table.string('zoho_product_id');
      table.string('catalog_uuid');
      table.integer('is_deleted').defaultTo(0);
      table.string('deleted_at');

      table.foreign('parentid').references('inventory_items.id').onDelete('SET NULL');
      table.foreign('folderid').references('inventory_folders.id').onDelete('SET NULL');
      table.foreign('kindid').references('inventory_kinds.id').onDelete('SET NULL');
      table.index(['parentid']);
      table.index(['folderid']);
      table.index(['kindid']);
      table.index(['zoho_product_id']);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    return;
  }

  await knex.schema.dropTableIfExists('inventory_items');
  await knex.schema.dropTableIfExists('inventory_kinds');
  await knex.schema.dropTableIfExists('inventory_folders');
};
