/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('zoho_catalog', (table) => {
    table.string('zoho_product_id').primary();
    table.string('product_name').notNullable();
    table.decimal('unit_price', 15, 2).defaultTo(0);
    table.string('make').nullable();
    table.string('model').nullable();
    table.string('hsn_code').nullable();
    table.text('description').nullable();
    table.string('sku').nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_synced_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('zoho_catalog');
};
