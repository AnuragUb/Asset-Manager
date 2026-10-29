/**
 * Local copy of Zoho Deal Projects (CRM module Deals) in public.
 *
 * Each row keeps Account_Name so a later Purchase Order match can use
 * the same Zoho account id. This migration does not alter procurement_po.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013130000_zoho_deal_projects.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('zoho_deal_projects')) return;
  await knex.schema.createTable('zoho_deal_projects', (table) => {
    table.string('zoho_id', 32).primary();
    table.text('deal_name');
    table.text('project_id');
    table.string('account_zoho_id', 32).nullable().index();
    table.text('account_name');
    table.string('contact_zoho_id', 32);
    table.text('contact_name');
    table.text('stage');
    table.text('deal_type');
    table.decimal('amount', 18, 2);
    table.date('closing_date');
    table.text('pipeline');
    table.string('owner_zoho_id', 32);
    table.text('owner_name');
    table.text('description');
    table.timestamp('last_activity_time');
    table.timestamp('zoho_modified_at');
    table.jsonb('raw_json');
    table.timestamp('last_synced_at').notNullable();
    table.timestamp('missing_at');
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index(['project_id'], 'zoho_deal_projects_project_id_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('zoho_deal_projects');
};
