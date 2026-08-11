/**
 * Add users.email for password-reset delivery and account contact.
 *
 * Why: forgot-password previously referenced users.email but the column did not
 * exist on asset_manager_test / asset_manager. Reset mail must go to a stored
 * address on the user record, not an ad-hoc typed value alone.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasEmail = await knex.schema.hasColumn('users', 'email');
  if (!hasEmail) {
    await knex.schema.alterTable('users', (table) => {
      table.string('email', 255).nullable();
    });
  }

  // Case-insensitive lookups for forgot-password by email
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email))
    WHERE email IS NOT NULL AND email <> ''
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_users_email_lower`);
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;
  const hasEmail = await knex.schema.hasColumn('users', 'email');
  if (hasEmail) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('email');
    });
  }
};
