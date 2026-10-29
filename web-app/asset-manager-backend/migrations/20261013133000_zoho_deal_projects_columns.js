/**
 * public.zoho_deal_projects already existed as an empty shell (zoho_name only).
 * Replace that shell with the Deal Project mirror columns.
 * Does not touch utility.zoho_deal_projects.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261013133000_zoho_deal_projects_columns.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  const publicSchema = knex.schema.withSchema('public');
  if (!(await publicSchema.hasTable('zoho_deal_projects'))) {
    throw new Error('STOP: public.zoho_deal_projects is missing');
  }
  if (!(await publicSchema.hasColumn('zoho_deal_projects', 'zoho_id'))) {
    await publicSchema.alterTable('zoho_deal_projects', (table) => {
      table.string('zoho_id', 32).notNullable();
      table.text('deal_name');
      table.text('project_id');
      table.string('account_zoho_id', 32).nullable();
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
      table.timestamp('last_synced_at');
      table.timestamp('missing_at');
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });
    await knex.raw('ALTER TABLE public.zoho_deal_projects ADD PRIMARY KEY (zoho_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS zoho_deal_projects_account_zoho_id_idx ON public.zoho_deal_projects (account_zoho_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS zoho_deal_projects_project_id_idx ON public.zoho_deal_projects (project_id)');
  }
  if (await publicSchema.hasColumn('zoho_deal_projects', 'zoho_name')) {
    await publicSchema.alterTable('zoho_deal_projects', (table) => {
      table.dropColumn('zoho_name');
    });
  }
};

exports.down = async function down() {
  // The shell column is not restored. Dropping the mirror columns would
  // delete pulled Deal Projects.
};
