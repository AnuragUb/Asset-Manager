const db = require('better-sqlite3')('database_v2.db');
const rows = db.prepare('SELECT * FROM hsn_codes').all();
console.log(JSON.stringify(rows, null, 2));
