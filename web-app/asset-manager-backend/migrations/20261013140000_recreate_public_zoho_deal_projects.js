/**
 * Recreate public.zoho_deal_projects.
 *
 * The previous shell had no Deal Project columns. This replaces only the
 * public table. utility.zoho_deal_projects is left as it is.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013140000_recreate_public_zoho_deal_projects.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  const cols = await knex.raw(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'zoho_deal_projects'
  `);
  const names = new Set((cols.rows || []).map((row) => row.column_name));
  if (names.has('zoho_id') && names.has('account_zoho_id')) return;

  await knex.raw('DROP TABLE IF EXISTS public.zoho_deal_projects');
  await knex.raw(`
    CREATE TABLE public.zoho_deal_projects (
      zoho_id varchar(32) PRIMARY KEY,
      deal_name text,
      project_id text,
      account_zoho_id varchar(32),
      account_name text,
      contact_zoho_id varchar(32),
      contact_name text,
      stage text,
      deal_type text,
      amount numeric(18,2),
      closing_date date,
      pipeline text,
      owner_zoho_id varchar(32),
      owner_name text,
      description text,
      last_activity_time timestamptz,
      zoho_modified_at timestamptz,
      raw_json jsonb,
      last_synced_at timestamptz NOT NULL,
      missing_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await knex.raw('CREATE INDEX zoho_deal_projects_account_zoho_id_idx ON public.zoho_deal_projects (account_zoho_id)');
  await knex.raw('CREATE INDEX zoho_deal_projects_project_id_idx ON public.zoho_deal_projects (project_id)');
};

exports.down = async function down() {};
