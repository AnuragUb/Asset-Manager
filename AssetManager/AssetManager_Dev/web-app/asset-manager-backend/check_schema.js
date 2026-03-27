const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    console.log('Columns in projects table:');
    tableInfo.forEach(c => console.log(`- ${c.name} (${c.type})`));
} catch (err) {
    console.error('Error:', err);
}
