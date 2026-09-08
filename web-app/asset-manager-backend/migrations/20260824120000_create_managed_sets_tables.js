/**
 * Additive Set management tables.
 * Does not alter assets.parentid / assets.is_set or inventory_items.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasSets = await knex.schema.hasTable('sets');
  if (!hasSets) {
    await knex.schema.createTable('sets', (table) => {
      table.string('id').primary();
      table.string('set_code').notNullable().unique();
      table.string('name').notNullable();
      table.text('description');
      table.string('set_type').notNullable(); // ASSET | INVENTORY
      table.string('status').notNullable().defaultTo('DRAFT'); // DRAFT | ACTIVE | ARCHIVED
      table.string('zoho_product_id').nullable();
      table.string('zoho_sync_status').notNullable().defaultTo('NOT_SYNCED');
      table.string('source_po_reference').nullable();
      table.string('legacy_asset_id').nullable();
      table.string('created_by').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('archived_at').nullable();
      table.index(['set_type']);
      table.index(['status']);
      table.index(['zoho_product_id']);
    });
  }

  const hasComponents = await knex.schema.hasTable('set_components');
  if (!hasComponents) {
    await knex.schema.createTable('set_components', (table) => {
      table.string('id').primary();
      table.string('set_id').notNullable();
      table.string('component_type').notNullable(); // ASSET | INVENTORY
      table.string('asset_id').nullable();
      table.string('inventory_item_id').nullable();
      table.float('quantity').notNullable().defaultTo(1);
      table.string('label').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.foreign('set_id').references('sets.id').onDelete('CASCADE');
      table.index(['set_id']);
      table.index(['asset_id']);
      table.index(['inventory_item_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('set_components');
  await knex.schema.dropTableIfExists('sets');
};
