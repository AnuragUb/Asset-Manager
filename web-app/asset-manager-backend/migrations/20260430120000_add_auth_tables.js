/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // 1. Auth Tokens (for Remember Me)
    await knex.schema.createTable('auth_tokens', (table) => {
        table.string('user_id').notNullable().references('username').inTable('users').onDelete('CASCADE');
        table.string('token_hash').primary();
        table.timestamp('expires_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // 2. Password Resets
    await knex.schema.createTable('password_resets', (table) => {
        table.string('email').notNullable();
        table.string('token_hash').primary();
        table.timestamp('expires_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('password_resets');
    await knex.schema.dropTableIfExists('auth_tokens');
};
