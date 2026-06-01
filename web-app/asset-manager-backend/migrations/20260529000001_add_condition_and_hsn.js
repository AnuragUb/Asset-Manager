/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('assets', (table) => {
    return knex.schema.hasColumn('assets', 'condition').then(exists => {
      if (!exists) {
        table.string('condition').defaultTo('Good');
      }
    }).then(() => {
      return knex.schema.hasColumn('assets', 'hsn_code').then(exists => {
        if (!exists) {
          table.string('hsn_code');
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
    table.dropColumn('condition');
    table.dropColumn('hsn_code');
  });
};
