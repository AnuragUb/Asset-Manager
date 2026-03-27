
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

try {
    const info = db.prepare("PRAGMA table_info(users)").all();
    console.log(JSON.stringify(info, null, 2));
} catch (err) {
    console.error(err);
}
