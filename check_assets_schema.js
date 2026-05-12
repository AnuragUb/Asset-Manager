
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'web-app', 'asset-manager-backend', 'database_v2.db');
const db = new Database(dbPath);

const info = db.pragma('table_info(assets)');
console.log(JSON.stringify(info, null, 2));
