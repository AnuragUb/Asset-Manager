/**
 * Apply ONLY 20260917180000_purchase_book_and_dc_events.js.
 * Never migrate:latest. Use --allow-production to target asset_manager.
 */
const MIGRATION_NAME = '20260917180000_purchase_book_and_dc_events.js';

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
    await migration.up(db);
    const batchRow = await db('knex_migrations').max('batch as batch').first();
    const nextBatch = Number(batchRow && batchRow.batch ? batchRow.batch : 0) + 1;
    await db('knex_migrations').insert({
      name: MIGRATION_NAME,
      batch: nextBatch,
      migration_time: db.fn.now()
    });
    console.log('APPLIED', MIGRATION_NAME, 'batch', nextBatch, 'db', dbName, {
      purchase_book_event: await db.schema.hasTable('purchase_book_event'),
      delivery_challan_event: await db.schema.hasTable('delivery_challan_event')
    });
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
