
const Database = require('better-sqlite3');
const path = require('path');

// Assuming running from web-app/asset-manager-backend/
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const info = db.pragma('table_info(assets)');
console.log(JSON.stringify(info, null, 2));
