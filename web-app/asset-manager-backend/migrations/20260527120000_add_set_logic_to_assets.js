/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('assets', (table) => {
    table.integer('is_set').defaultTo(0);
    table.string('set_price_mode').defaultTo('SUM_OF_CHILDREN'); // SUM_OF_CHILDREN, FIXED
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('assets', (table) => {
    table.dropColumn('is_set');
    table.dropColumn('set_price_mode');
  });
};
