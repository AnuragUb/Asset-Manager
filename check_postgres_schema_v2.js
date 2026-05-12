const knex = require('knex');
const knexConfig = require('./knexfile');

async function check() {
  const db = knex(knexConfig.development);
  try {
    console.log('Checking tables...');
    const tables = ['assets', 'projects', 'asset_kinds', 'temporary_assets', 'asset_history'];
    for (const table of tables) {
      const hasTable = await db.schema.hasTable(table);
      if (hasTable) {
        const columns = await db(table).columnInfo();
        console.log(`Table: ${table}`);
        console.log(`Columns: ${Object.keys(columns).join(', ')}`);
      } else {
        console.log(`Table: ${table} NOT FOUND`);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await db.destroy();
  }
}

check();
