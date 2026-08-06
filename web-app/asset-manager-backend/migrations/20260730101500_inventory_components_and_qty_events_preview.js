/**
 * Inventory modal parity: components + quantity history support (9090/test only)
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    console.log(`[inventory-preview] Skipping inventory components/qty events tables for database ${dbName}`);
    return;
  }

  const hasInventoryItems = await knex.schema.hasTable('inventory_items');
  if (!hasInventoryItems) return;

  const addItemColumnIfMissing = async (name, callback) => {
    const exists = await knex.schema.hasColumn('inventory_items', name);
    if (!exists) {
      await knex.schema.alterTable('inventory_items', (table) => {
        callback(table);
      });
    }
  };

  await addItemColumnIfMissing('quantity_parent_id', (table) => table.string('quantity_parent_id'));
  await addItemColumnIfMissing('quantity_root_id', (table) => table.string('quantity_root_id'));
  await addItemColumnIfMissing('quantity_updated_at', (table) => table.string('quantity_updated_at'));

  const hasInventoryComponents = await knex.schema.hasTable('inventory_components');
  if (!hasInventoryComponents) {
    await knex.schema.createTable('inventory_components', (table) => {
      table.string('id').primary();
      table.string('parentid').nullable();
      table.text('itemname').notNullable();
      table.text('itemdescription');
      table.string('status').defaultTo('In Store');
      table.string('make');
      table.string('model');
      table.string('srno');
      table.string('type').defaultTo('Component');
      table.string('category');
      table.string('lastupdated');
      table.integer('noqr').defaultTo(1);
      table.integer('is_deleted').defaultTo(0);
      table.string('deleted_at');

      table.foreign('parentid').references('inventory_items.id').onDelete('SET NULL');
      table.index(['parentid']);
    });
  }

  const hasEvents = await knex.schema.hasTable('inventory_quantity_events');
  if (!hasEvents) {
    await knex.schema.createTable('inventory_quantity_events', (table) => {
      table.increments('id').primary();
      table.string('root_id').notNullable();
      table.string('type').notNullable();
      table.string('actor');
      table.string('timestamp').notNullable();
      table.string('note');
      table.text('metadata_json');
    });
    await knex.schema.alterTable('inventory_quantity_events', (table) => {
      table.index(['root_id']);
    });
  }

  const hasLines = await knex.schema.hasTable('inventory_quantity_event_lines');
  if (!hasLines) {
    await knex.schema.createTable('inventory_quantity_event_lines', (table) => {
      table.integer('event_id').notNullable().references('id').inTable('inventory_quantity_events').onDelete('CASCADE');
      table.string('item_id').notNullable();
      table.string('unit');
      table.float('delta_available').notNullable().defaultTo(0);
      table.float('delta_total').notNullable().defaultTo(0);
      table.primary(['event_id', 'item_id']);
    });
    await knex.schema.alterTable('inventory_quantity_event_lines', (table) => {
      table.index(['item_id']);
    });
  }
};

exports.down = async function () {
  // Intentionally no-op: preview-only schema expansion on 9090.
};

