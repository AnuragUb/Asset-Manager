const Database = require('better-sqlite3');
const db = new Database('c:/Users/Admin/AssetManager/AssetManager_Prod/data/prod/database_v2.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('Prod Tables:', tables);
const cols = db.prepare("PRAGMA table_info(assets)").all().map(c => c.name);
console.log('Prod assets columns:', cols);
