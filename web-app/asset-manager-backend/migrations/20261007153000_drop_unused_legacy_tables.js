/**
 * Drop empty unused public tables.
 * knex_migrations and knex_migrations_lock stay: Knex uses them as its ledger and lock.
 * temporary_assets and dc_remark_templates are different tables and stay.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const DROP_ORDER = ['layout_markers', 'layouts', 'oauthtoken', 'temp_assets', 'remark_templates'];

async function assertEmpty(knex, name) {
  if (!(await knex.schema.hasTable(name))) return;
  const row = await knex(name).count({ n: '*' }).first();
  const n = Number(row && row.n);
  if (n > 0) {
    throw new Error(`STOP: ${name} has ${n} rows`);
  }
}

exports.up = async function (knex) {
  for (const name of DROP_ORDER) {
    await assertEmpty(knex, name);
  }
  for (const name of DROP_ORDER) {
    await knex.schema.dropTableIfExists(name);
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('layouts'))) {
    await knex.schema.createTable('layouts', (table) => {
      table.string('id', 255).primary();
      table.string('name', 255);
      table.text('description');
      table.string('projectid', 255);
      table.text('image_url');
      table.string('createdby', 255);
      table.string('timestamp', 255);
    });
  }
  if (!(await knex.schema.hasTable('layout_markers'))) {
    await knex.schema.createTable('layout_markers', (table) => {
      table.bigIncrements('id').primary();
      table.text('assetid');
      table.timestamp('created_at', { useTz: true });
      table.timestamp('updated_at', { useTz: true });
    });
  }
  if (!(await knex.schema.hasTable('oauthtoken'))) {
    await knex.schema.createTable('oauthtoken', (table) => {
      table.string('user_mail', 100).notNullable();
      table.string('client_id', 100).notNullable();
      table.string('refresh_token', 255).notNullable();
      table.string('access_token', 255);
      table.string('grant_token', 255);
      table.string('expiry_time', 20);
      table.primary(['user_mail', 'client_id']);
    });
  }
  if (!(await knex.schema.hasTable('temp_assets'))) {
    await knex.schema.createTable('temp_assets', (table) => {
      table.bigIncrements('id').primary();
      table.text('name');
      table.timestamp('created_at', { useTz: true });
    });
  }
  if (!(await knex.schema.hasTable('remark_templates'))) {
    await knex.schema.createTable('remark_templates', (table) => {
      table.increments('id').primary();
      table.string('title', 255).notNullable();
      table.text('content').notNullable();
      table.string('module', 255);
      table.string('created_by', 255);
      table.string('created_at', 255);
    });
  }
};
