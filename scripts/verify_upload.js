
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const asset = db.prepare("SELECT * FROM assets WHERE ID LIKE 'TEST-%' ORDER BY LastUpdated DESC LIMIT 1").get();
console.log('Last Test Asset:', JSON.stringify(asset, null, 2));
