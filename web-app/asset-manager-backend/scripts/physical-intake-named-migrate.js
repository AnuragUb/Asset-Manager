/**
 * Apply ONLY 20260901180000_physical_intake_foundation.js.
 * Never migrate:latest. Use --allow-production to target asset_manager.
 */
const MIGRATION_NAME = '20260901180000_physical_intake_foundation.js';

function parseArgs(argv) {
  const args = { databaseName: null, allowProduction: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--database-name') args.databaseName = argv[++i];
    else if (argv[i] === '--allow-production') args.allowProduction = true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.databaseName) process.env.DB_NAME = args.databaseName;

(async () => {
  const { db } = require('../utils');
  const migration = require(`../migrations/${MIGRATION_NAME}`);
  try {
    const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
    if (!args.databaseName) throw new Error('--database-name is required');
    if (args.databaseName !== dbName) {
      throw new Error(`connected to ${dbName}, expected ${args.databaseName}`);
    }
    if (dbName === 'asset_manager' && !args.allowProduction) {
      throw new Error('refused: asset_manager requires --allow-production');
    }
    const already = await db('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (already) {
      console.log('ALREADY_APPLIED', MIGRATION_NAME, dbName);
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
    const hasIntake = await db.schema.hasTable('physical_intake');
    const hasAssetCol = await db.schema.hasColumn('assets', 'physical_intake_id');
    const hasInvCol = await db.schema.hasColumn('inventory_items', 'physical_intake_id');
    console.log('APPLIED', MIGRATION_NAME, 'batch', nextBatch, 'db', dbName, {
      physical_intake: hasIntake,
      assets_physical_intake_id: hasAssetCol,
      inventory_physical_intake_id: hasInvCol
    });
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
