const knex = require('knex');
const knexConfig = require('./web-app/asset-manager-backend/knexfile');

async function fixSequences(envName) {
  console.log(`\n--- Fixing sequences for database: ${knexConfig[envName].connection.database} ---`);
  const db = knex(knexConfig[envName]);
  
  try {
    // Get all tables that have an 'id' column and are not views
    const tablesResult = await db.raw(`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE column_name = 'id' 
      AND table_schema = 'public'
      AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public')
    `);
    
    const tables = tablesResult.rows.map(r => r.table_name);
    
    for (const table of tables) {
      // Find the sequence name associated with the id column
      const seqResult = await db.raw(`
        SELECT pg_get_serial_sequence(?, 'id') as seq_name
      `, [table]);
      
      const seqName = seqResult.rows[0].seq_name;
      
      if (seqName) {
        console.log(`Resetting sequence ${seqName} for table ${table}...`);
        
        // Get the current max id
        const maxIdResult = await db(table).max('id as max_id').first();
        const maxId = maxIdResult.max_id || 0;
        
        // Reset the sequence to maxId + 1
        await db.raw(`SELECT setval(?, ?, true)`, [seqName, maxId]);
        console.log(`  Done. Set to ${maxId}.`);
      } else {
        // console.log(`  No sequence found for table ${table}. Skipping.`);
      }
    }
    
    console.log(`Finished fixing sequences for ${knexConfig[envName].connection.database}.`);
  } catch (err) {
    console.error(`Error fixing sequences for ${envName}:`, err);
  } finally {
    await db.destroy();
  }
}

async function run() {
  // Fix sequences for the development database (Port 8080)
  await fixSequences('development');
  
  // Fix sequences for the test database (Port 9090)
  // We need to temporarily override the connection for 'development' to point to asset_manager_test
  // because knexfile.js uses env vars.
  const originalDbName = process.env.DB_NAME;
  process.env.DB_NAME = 'asset_manager_test';
  
  // Create a new config for test since it's not explicitly in knexfile as a separate postgres target
  const testConfig = JSON.parse(JSON.stringify(knexConfig.development));
  testConfig.connection.database = 'asset_manager_test';
  
  console.log(`\n--- Fixing sequences for database: asset_manager_test ---`);
  const testDb = knex(testConfig);
  try {
    const tablesResult = await testDb.raw(`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE column_name = 'id' 
      AND table_schema = 'public'
    `);
    const tables = tablesResult.rows.map(r => r.table_name);
    for (const table of tables) {
      const seqResult = await testDb.raw(`SELECT pg_get_serial_sequence(?, 'id') as seq_name`, [table]);
      const seqName = seqResult.rows[0].seq_name;
      if (seqName) {
        const maxIdResult = await testDb(table).max('id as max_id').first();
        const maxId = maxIdResult.max_id || 0;
        await testDb.raw(`SELECT setval(?, ?, true)`, [seqName, maxId]);
        console.log(`Resetting sequence ${seqName} for table ${table} to ${maxId}.`);
      }
    }
  } catch (err) {
    console.error(`Error fixing sequences for asset_manager_test:`, err);
  } finally {
    await testDb.destroy();
  }
}

run();
