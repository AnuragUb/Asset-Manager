const sqlite3 = require('better-sqlite3');
const db = new sqlite3('database_v2.db');
const kinds = db.prepare('SELECT * FROM asset_kinds').all();
console.log('--- ASSET KINDS ---');
console.log(JSON.stringify(kinds, null, 2));
const folders = db.prepare('SELECT * FROM folders').all();
console.log('--- FOLDERS ---');
console.log(JSON.stringify(folders, null, 2));
db.close();
