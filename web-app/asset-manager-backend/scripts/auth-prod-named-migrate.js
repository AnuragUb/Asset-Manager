/**
 * Apply ONLY 20260901120000_auth_infrastructure_hardening.js.
 * Refuses any database other than asset_manager. Never migrate:latest.
 */
const MIGRATION_NAME = '20260901120000_auth_infrastructure_hardening.js';

(async () => {
  const { db } = require('../utils');
  const migration = require(`../migrations/${MIGRATION_NAME}`);
  try {
    const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
    if (dbName !== 'asset_manager') {
      throw new Error(`refused: connected to ${dbName}, expected asset_manager`);
    }
    const already = await db('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (already) {
      console.log('ALREADY_APPLIED', MIGRATION_NAME);
      return;
    }
    const parked = await db('knex_migrations').where({ name: '20260824120000_create_managed_sets_tables.js' }).first();
    if (parked) {
      throw new Error('unexpected: abandoned managed-sets migration is recorded');
    }
    await migration.up(db);
    const batchRow = await db('knex_migrations').max('batch as batch').first();
    const nextBatch = Number(batchRow && batchRow.batch ? batchRow.batch : 0) + 1;
    await db('knex_migrations').insert({
      name: MIGRATION_NAME,
      batch: nextBatch,
      migration_time: db.fn.now()
    });
    const hasStatus = await db.schema.hasColumn('users', 'status');
    const hasUsedAt = await db.schema.hasColumn('password_resets', 'used_at');
    console.log('APPLIED', MIGRATION_NAME, 'batch', nextBatch, 'users.status', hasStatus, 'password_resets.used_at', hasUsedAt);
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
