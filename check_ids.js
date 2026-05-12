
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'web-app', 'asset-manager-backend', 'database_v2.db');
const db = new Database(dbPath);

const assets = db.prepare("SELECT ID FROM assets WHERE ID NOT LIKE 'TEST-%' ORDER BY LastUpdated DESC LIMIT 10").all();
console.log('Sample Asset IDs:', JSON.stringify(assets, null, 2));
