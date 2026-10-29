/**
 * Store the Zoho Account lookup from an Outbound Purchase Order.
 *
 * account_zoho_id matches public.zoho_account.zoho_id when that account
 * has been pulled. The name snapshot is what Zoho sent on the PO.
 * No foreign key: a PO refresh must still save if the account list
 * has not been synced yet.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013120000_procurement_po_zoho_account.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) {
    throw new Error('STOP: procurement_po is missing');
  }
  if (await knex.schema.hasColumn('procurement_po', 'account_zoho_id')) return;
  await knex.schema.alterTable('procurement_po', (table) => {
    table.string('account_zoho_id', 32).nullable().index();
    table.text('account_name_snapshot').nullable();
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) return;
  if (!(await knex.schema.hasColumn('procurement_po', 'account_zoho_id'))) return;
  await knex.schema.alterTable('procurement_po', (table) => {
    table.dropColumn('account_name_snapshot');
    table.dropColumn('account_zoho_id');
  });
};
