/**
 * Force staff on a temporary password to set their own password via email.
 *
 * Adds utility.users.must_change_password and flags the Cineom staff accounts
 * that were issued the shared default password.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261016120000_users_must_change_password.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const UTILITY = 'utility';

const STAFF_IDS = [
  'bhagyashree@cineom.in',
  'swapnil.marathe@cineom.in',
  'SwapnilM',
  'sunil.rane@cineom.in',
  'abhishek@cineom.in',
  'sunil.nigam@cineom.in',
  'shailesh@cineom.in',
  'swapnil@cineom.in',
  'itsupport@cineom.in',
  'sudhir.lodhi@cineom.in'
];

exports.up = async function (knex) {
  const hasUsers = await knex.schema.withSchema(UTILITY).hasTable('users');
  if (!hasUsers) {
    throw new Error('STOP: utility.users is missing');
  }

  if (!(await knex.schema.withSchema(UTILITY).hasColumn('users', 'must_change_password'))) {
    await knex.schema.withSchema(UTILITY).alterTable('users', (table) => {
      table.boolean('must_change_password').notNullable().defaultTo(false);
    });
  }

  await knex.withSchema(UTILITY).from('users')
    .where(function () {
      STAFF_IDS.forEach((id) => {
        this.orWhereRaw('LOWER(username) = LOWER(?)', [id]);
        this.orWhereRaw("LOWER(COALESCE(email, '')) = LOWER(?)", [id]);
      });
    })
    .update({ must_change_password: true });
};

exports.down = async function (knex) {
  if (!(await knex.schema.withSchema(UTILITY).hasTable('users'))) return;
  if (!(await knex.schema.withSchema(UTILITY).hasColumn('users', 'must_change_password'))) return;
  await knex.schema.withSchema(UTILITY).alterTable('users', (table) => {
    table.dropColumn('must_change_password');
  });
};
