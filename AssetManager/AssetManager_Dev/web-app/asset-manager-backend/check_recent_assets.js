
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const assets = db.prepare("SELECT ID, ItemName, Category, Status, LastUpdated FROM assets ORDER BY LastUpdated DESC LIMIT 10").all();
console.log('Recent Assets:', JSON.stringify(assets, null, 2));
