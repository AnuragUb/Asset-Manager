/**
 * Local copy of Zoho CRM Accounts, in public.
 *
 * Outbound Purchase Orders will link to these rows later. This migration
 * only stores the account mirror. It does not alter procurement_po.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013103000_zoho_account_public.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('zoho_account')) return;
  await knex.schema.createTable('zoho_account', (table) => {
    table.string('zoho_id', 32).primary();
    table.text('account_name');
    table.text('phone');
    table.text('fax');
    table.text('website');
    table.text('account_type');
    table.text('industry');
    table.text('rating');
    table.string('owner_zoho_id', 32);
    table.text('owner_name');
    table.text('billing_address');
    table.text('billing_street');
    table.text('billing_city');
    table.text('billing_state');
    table.text('billing_code');
    table.text('billing_country');
    table.text('billing_flat');
    table.text('shipping_address');
    table.text('shipping_street');
    table.text('shipping_city');
    table.text('shipping_state');
    table.text('shipping_code');
    table.text('shipping_country');
    table.text('shipping_flat');
    table.text('description');
    table.timestamp('last_activity_time');
    table.jsonb('raw_json');
    table.timestamp('last_synced_at').notNullable();
    table.timestamp('missing_at');
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index(['account_name'], 'zoho_account_name_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('zoho_account');
};
