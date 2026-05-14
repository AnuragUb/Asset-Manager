const Database = require('better-sqlite3');
const db = new Database('c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db');
const kinds = db.prepare("SELECT * FROM asset_kinds WHERE Name = 'Printer & Scanner'").all();
console.log(JSON.stringify(kinds, null, 2));
const folders = db.prepare("SELECT * FROM folders").all();
console.log(JSON.stringify(folders, null, 2));
