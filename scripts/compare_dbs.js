const Database = require('better-sqlite3');
const devDb = new Database('c:/Users/Admin/AssetManager/AssetManager_Dev/web-app/asset-manager-backend/database_v2.db');
const prodDb = new Database('c:/Users/Admin/AssetManager/AssetManager_Prod/data/prod/database_v2.db');

const getTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

console.log('Dev Tables:', getTables(devDb));
console.log('Prod Tables:', getTables(prodDb));

const getColumns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

console.log('Dev assets columns:', getColumns(devDb, 'assets'));
console.log('Prod assets columns:', getColumns(prodDb, 'assets'));
