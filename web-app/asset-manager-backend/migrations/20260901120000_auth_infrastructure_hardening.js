/**
 * Additive auth infrastructure columns.
 *
 * Why: public signup/login must honor DISABLED accounts, and password-reset
 * tokens must be distinguishable as used vs expired (single-use).
 *
 * Does not change role semantics or existing user rows beyond defaults.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (hasUsers && !(await knex.schema.hasColumn('users', 'status'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
    });
  }

  const hasResets = await knex.schema.hasTable('password_resets');
  if (hasResets && !(await knex.schema.hasColumn('password_resets', 'used_at'))) {
    await knex.schema.alterTable('password_resets', (table) => {
      table.timestamp('used_at').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasResets = await knex.schema.hasTable('password_resets');
  if (hasResets && (await knex.schema.hasColumn('password_resets', 'used_at'))) {
    await knex.schema.alterTable('password_resets', (table) => {
      table.dropColumn('used_at');
    });
  }

  const hasUsers = await knex.schema.hasTable('users');
  if (hasUsers && (await knex.schema.hasColumn('users', 'status'))) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('status');
    });
  }
};
