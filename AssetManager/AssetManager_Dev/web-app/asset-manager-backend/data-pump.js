
const Database = require('better-sqlite3');
const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig.development);
const path = require('path');

// Source SQLite Database
const sqlitePath = path.join(__dirname, '../../data/test/database_v2.db');
const sqlite = new Database(sqlitePath);

async function pumpData() {
  console.log('--- Starting Data Pump (SQLite -> Knex/Postgres Ready) ---');

  const tables = [
    'asset_kinds', 'projects', 'assets', 'asset_it_details', 
    'project_assets', 'project_orders', 'project_order_items', 
    'delivery_challans', 'dc_item_mappings', 'users', 
    'companies', 'audit_log', 'quantity_events', 
    'quantity_event_lines', 'roles', 'permissions', 'role_permissions'
  ];

  try {
    // 1. Run migrations first to ensure target schema exists
    console.log('Running migrations on target...');
    await knex.migrate.latest();

    // 2. Transfer data for each table
    for (const table of tables) {
      console.log(`Transferring table: ${table}...`);
      
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) {
        console.log(`  Table ${table} is empty, skipping.`);
        continue;
      }

      // Chunk inserts for large tables
      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await knex(table).insert(chunk).onConflict().ignore();
      }
      
      console.log(`  Transferred ${rows.length} rows.`);
    }

    console.log('--- Data Pump Completed Successfully ---');
  } catch (err) {
    console.error('Data Pump Failed:', err);
  } finally {
    await knex.destroy();
    sqlite.close();
  }
}

pumpData();
