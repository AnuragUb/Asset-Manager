/**
 * Backfill serial_identity from legacy assets.srno / inventory_items.srno.
 *
 *   node scripts/serial-identity-backfill.js --database-name asset_manager --allow-production
 */
function parseArgs(argv) {
  const args = { databaseName: null, allowProduction: false, reportPath: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--database-name') args.databaseName = argv[++i];
    else if (argv[i] === '--allow-production') args.allowProduction = true;
    else if (argv[i] === '--report') args.reportPath = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.databaseName) process.env.DB_NAME = args.databaseName;

(async () => {
  const { db } = require('../utils');
  const serialIdentityService = require('../services/serialIdentityService');
  try {
    const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
    if (!args.databaseName) throw new Error('--database-name is required');
    if (args.databaseName !== dbName) {
      throw new Error(`connected to ${dbName}, expected ${args.databaseName}`);
    }
    if (dbName === 'asset_manager' && !args.allowProduction) {
      throw new Error('refused: asset_manager requires --allow-production');
    }
    const report = await serialIdentityService.backfillFromLegacySrno({
      reportPath: args.reportPath
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
