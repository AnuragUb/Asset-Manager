/**
 * Apply ONLY 20260903120000_rbac_view_permissions.js.
 * Never migrate:latest. Does not grant keys to roles.
 */
const MIGRATION_NAME = '20260903120000_rbac_view_permissions.js';

(async () => {
  const { db } = require('../utils');
  const migration = require(`../migrations/${MIGRATION_NAME}`);
  try {
    const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
    console.log('DATABASE', dbName);
    const already = await db('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (already) {
      console.log('ALREADY_APPLIED', MIGRATION_NAME);
      return;
    }
    await migration.up(db);
    const batchRow = await db('knex_migrations').max('batch as batch').first();
    const nextBatch = Number(batchRow && batchRow.batch ? batchRow.batch : 0) + 1;
    await db('knex_migrations').insert({
      name: MIGRATION_NAME,
      batch: nextBatch,
      migration_time: db.fn.now()
    });
    const keys = await db('permissions').where('key', 'like', 'view.%').orderBy('key');
    const grants = await db('role_permissions').whereIn('permission_key', keys.map((k) => k.key));
    console.log('APPLIED', MIGRATION_NAME, 'batch', nextBatch, 'view_keys', keys.length, 'view_grants', grants.length);
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
