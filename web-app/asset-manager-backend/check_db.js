const Database = require('better-sqlite3');
const db = new Database('database_v2.db');
const columns = db.prepare("PRAGMA table_info(assets)").all();
console.log(JSON.stringify(columns, null, 2));
db.close();
