/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('oauthtoken', (table) => {
    table.string('user_mail', 100).notNullable();
    table.string('client_id', 100).notNullable();
    table.string('refresh_token', 255).notNullable();
    table.string('access_token', 255);
    table.string('grant_token', 255);
    table.string('expiry_time', 20);
    table.primary(['user_mail', 'client_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('oauthtoken');
};
