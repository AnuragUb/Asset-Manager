const sqlite3 = require('better-sqlite3');
const db = new sqlite3('c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db');

const hdds = db.prepare("SELECT ID, ItemName, ParentId, Type FROM assets WHERE Type = 'Component'").all();
console.log('HDDs in assets table:', hdds);

const server = db.prepare("SELECT ID, ItemName FROM assets WHERE ID = 'LOC-0126-WMWZLG-B'").get();
console.log('Server in assets table:', server);
