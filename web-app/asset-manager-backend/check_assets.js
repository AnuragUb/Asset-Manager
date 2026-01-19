const Database = require('better-sqlite3');
const db = new Database('c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db');
const assets = db.prepare("SELECT * FROM assets WHERE Type = 'Printer & Scanner' LIMIT 5").all();
console.log(JSON.stringify(assets, null, 2));
