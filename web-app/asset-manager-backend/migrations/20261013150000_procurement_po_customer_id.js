/**
 * Customer ID on an Outbound Purchase Order is the Deal Project Project ID.
 * The account name is read from public.zoho_deal_projects by that id.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013150000_procurement_po_customer_id.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) {
    throw new Error('STOP: procurement_po is missing');
  }
  if (await knex.schema.hasColumn('procurement_po', 'customer_id')) return;
  await knex.schema.alterTable('procurement_po', (table) => {
    table.text('customer_id').nullable().index();
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) return;
  if (!(await knex.schema.hasColumn('procurement_po', 'customer_id'))) return;
  await knex.schema.alterTable('procurement_po', (table) => {
    table.dropColumn('customer_id');
  });
};
