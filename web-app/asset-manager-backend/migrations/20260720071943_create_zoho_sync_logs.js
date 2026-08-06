/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('zoho_sync_logs', (table) => {
    table.increments('id').primary();
    table.string('module').notNullable(); // e.g., 'Products', 'Deals'
    table.string('operation').notNullable(); // e.g., 'PUSH_ASSET', 'PULL_CATALOG', 'PULL_DEALS'
    table.string('status').notNullable(); // 'SUCCESS', 'ERROR'
    table.string('local_id').nullable(); // Internal Asset ID or Project ID
    table.string('zoho_id').nullable(); // Zoho Record ID
    table.text('payload').nullable(); // JSON string of data sent
    table.text('response').nullable(); // JSON string of Zoho response
    table.text('error_message').nullable(); // Detailed error if failed
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('zoho_sync_logs');
};
