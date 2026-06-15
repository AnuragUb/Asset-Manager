/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('assets', table => {
    table.string('weight').nullable();
  });
  await knex.schema.alterTable('components', table => {
    table.string('weight').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('assets', table => {
    table.dropColumn('weight');
  });
  await knex.schema.alterTable('components', table => {
    table.dropColumn('weight');
  });
};
