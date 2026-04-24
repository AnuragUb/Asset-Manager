const Database = require('better-sqlite3');
const path = require('path');

async function migrateData(sqlitePath, knex) {
  console.log(`\n--- Starting migration from: ${sqlitePath} to ${process.env.DB_NAME} ---`);
  
  let sqliteDb;
  try {
    sqliteDb = new Database(sqlitePath, { readonly: true });
  } catch (err) {
    console.error(`Failed to open SQLite database at ${sqlitePath}:`, err.message);
    return;
  }

  const tables = [
    { name: 'asset_kinds', pk: 'name' },
    { name: 'projects', pk: 'id' },
    { name: 'assets', pk: 'id' },
    { name: 'asset_it_details', pk: 'assetid' },
    { name: 'project_assets', pk: ['projectid', 'assetid'] },
    { name: 'project_orders', pk: 'id' },
    { name: 'project_order_items', pk: 'id' },
    { name: 'delivery_challans', pk: 'id' },
    { name: 'dc_item_mappings', pk: 'id' },
    { name: 'users', pk: 'username' },
    { name: 'companies', pk: 'id' },
    { name: 'audit_log', pk: 'id' },
    { name: 'roles', pk: 'name' },
    { name: 'permissions', pk: 'key' },
    { name: 'role_permissions', pk: ['role_name', 'permission_key'] },
    { name: 'quantity_events', pk: 'id' },
    { name: 'quantity_event_lines', pk: ['event_id', 'asset_id'] },
    { name: 'components', pk: 'id' },
    { name: 'employees', pk: 'id' },
    { name: 'department_quotas', pk: ['department', 'category'] },
    { name: 'folders', pk: 'id' },
    { name: 'company_templates', pk: 'id' },
    { name: 'hsn_codes', pk: 'code' },
    { name: 'asset_hierarchy', pk: 'id' },
    { name: 'layouts', pk: 'id' },
    { name: 'layout_markers', pk: 'id' },
    { name: 'temporary_assets', pk: 'id' }
  ];

  try {
    for (const tableConfig of tables) {
      const table = tableConfig.name;
      const pk = tableConfig.pk;
      
      try {
        const tableCheck = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!tableCheck) {
          console.log(`  Table ${table} not found in source. Skipping.`);
          continue;
        }

        console.log(`Migrating table: ${table}...`);
        
        const pgColumns = await knex(table).columnInfo();
        const validPgColumns = Object.keys(pgColumns);
        
        const data = sqliteDb.prepare(`SELECT * FROM ${table}`).all();
        
        if (data.length === 0) {
          console.log(`  No data found in ${table}.`);
          continue;
        }

        // 2. Clear target table
        await knex(table).del();

        const chunkSize = 50;
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);
          
          const normalizedChunk = chunk.map(row => {
            const normalized = {};
            
            // Map row to only valid PostgreSQL columns (case-insensitive)
            Object.keys(row).forEach(key => {
              const lowerKey = key.toLowerCase();
              if (validPgColumns.includes(lowerKey)) {
                normalized[lowerKey] = row[key];
              }
            });

            // FIX: If id is still null but required, generate one or skip
            if (validPgColumns.includes('id') && (normalized.id === null || normalized.id === undefined)) {
                if (table === 'asset_hierarchy') {
                    normalized.id = `AH_${Math.random().toString(36).substr(2, 9)}`;
                }
            }

            if (table === 'users' && typeof normalized.role === 'string' && normalized.role.startsWith('[')) {
              try {
                const roles = JSON.parse(normalized.role);
                normalized.role = Array.isArray(roles) ? roles[0] : normalized.role;
              } catch (e) {}
            }

            return normalized;
          });

          await knex(table).insert(normalizedChunk).onConflict(pk).ignore();
        }
        
        console.log(`  Successfully processed ${data.length} records for ${table}.`);
      } catch (tableErr) {
        console.error(`  Failed to migrate table ${table}:`, tableErr.message);
      }
    }
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    sqliteDb.close();
  }
}

async function runAll() {
  const sources = [
    {
      path: 'C:/Users/Admin/AssetManager/backups/8080_prod/database_v2_20260417_1304.db',
      dbName: 'asset_manager'
    },
    {
      path: 'C:/Users/Admin/AssetManager/backups/9090_dev/database_v2_20260416_1056.db',
      dbName: 'asset_manager_test'
    }
  ];

  for (const source of sources) {
    // Re-initialize knex for the target database
    process.env.DB_NAME = source.dbName;
    const knex = require('knex')({
        client: 'postgresql',
        connection: {
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: 'password',
            database: source.dbName
        }
    });

    await migrateData(source.path, knex);
    
    // Final fix: Ensure admin password is reset to 'admin'
    console.log(`\n--- Resetting admin password in ${source.dbName} ---`);
    const bcrypt = require('bcrypt');
    const adminHash = await bcrypt.hash('admin', 12);
    await knex('users').where('username', 'admin').update({ password: adminHash });
    
    await knex.destroy();
  }
  
  console.log('\nAll migrations completed.');
}

runAll();
