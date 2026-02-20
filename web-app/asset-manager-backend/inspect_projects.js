const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db';
const db = new Database(dbPath);

console.log('Inspecting projects table schema...');
const columns = db.prepare("PRAGMA table_info(projects)").all();
console.log('Columns:', columns.map(c => `${c.name} (${c.type})`).join(', '));

const sample = db.prepare("SELECT * FROM projects LIMIT 1").get();
console.log('\nSample Project Data:', sample);

const count = db.prepare("SELECT COUNT(*) as total FROM projects").get();
console.log('\nTotal projects:', count.total);
