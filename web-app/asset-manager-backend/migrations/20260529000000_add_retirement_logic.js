/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('assets', (table) => {
    // Check if column exists first to be idempotent
    return knex.schema.hasColumn('assets', 'is_retired').then(exists => {
      if (!exists) {
        table.integer('is_retired').defaultTo(0);
      }
    }).then(() => {
      return knex.schema.hasColumn('assets', 'sale_details').then(exists => {
        if (!exists) {
          table.text('sale_details');
        }
      });
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('assets', (table) => {
    table.dropColumn('is_retired');
    table.dropColumn('sale_details');
  });
};
