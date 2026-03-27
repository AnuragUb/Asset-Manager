const Database = require('better-sqlite3');
const db = new Database('database_v2.db');
const assets = db.prepare('SELECT ID, quantity_root_id, quantity_unit, quantity_total FROM assets WHERE quantity_root_id IS NOT NULL').all();
console.log(JSON.stringify(assets, null, 2));
db.close();
