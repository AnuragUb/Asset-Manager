const knex = require('knex');
const knexConfig = require('./knexfile');

async function fixSequences(envName, dbNameOverride = null) {
  const config = JSON.parse(JSON.stringify(knexConfig[envName]));
  if (dbNameOverride) {
    config.connection.database = dbNameOverride;
  }
  
  console.log(`\n--- Fixing sequences for database: ${config.connection.database} ---`);
  const db = knex(config);
  
  try {
    // Get all tables that have an 'id' column
    const tablesResult = await db.raw(`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE column_name = 'id' 
      AND table_schema = 'public'
    `);
    
    const tables = tablesResult.rows.map(r => r.table_name);
    
    for (const table of tables) {
      const seqResult = await db.raw(`SELECT pg_get_serial_sequence(?, 'id') as seq_name`, [table]);
      const seqName = seqResult.rows[0].seq_name;
      
      if (seqName) {
        const maxIdResult = await db(table).max('id as max_id').first();
        const maxId = parseInt(maxIdResult.max_id) || 0;
        
        if (maxId === 0) {
          // Empty table: set to 1 and mark as not called
          await db.raw(`SELECT setval(?, 1, false)`, [seqName]);
          console.log(`Resetting sequence ${seqName} for empty table ${table} to 1 (not called).`);
        } else {
          // Table has data: set to maxId and mark as called
          await db.raw(`SELECT setval(?, ?, true)`, [seqName, maxId]);
          console.log(`Resetting sequence ${seqName} for table ${table} to ${maxId} (called).`);
        }
      }
    }
  } catch (err) {
    console.error(`Error fixing sequences for ${config.connection.database}:`, err.message);
  } finally {
    await db.destroy();
  }
}

async function run() {
  await fixSequences('development');
  await fixSequences('development', 'asset_manager_test');
}

run();
