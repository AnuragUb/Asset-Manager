const Database = require('better-sqlite3');
const path = require('path');

// Go up two levels from backend folder to reach data/prod
const dbPath = path.join(__dirname, '../../data/prod/database_v2.db');
const db = new Database(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name));

const remarksTable = tables.find(t => t.name === 'remarks_templates');
if (remarksTable) {
    const schema = db.prepare("PRAGMA table_info(remarks_templates)").all();
    console.log('Schema:', schema);
} else {
    console.log('remarks_templates table not found');
}
