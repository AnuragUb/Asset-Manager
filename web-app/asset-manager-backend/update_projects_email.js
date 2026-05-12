const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Adding email columns to projects table...');

try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    
    if (!tableInfo.find(c => c.name === 'OwnerEmail')) {
        db.prepare("ALTER TABLE projects ADD COLUMN OwnerEmail TEXT").run();
        console.log('Added OwnerEmail column.');
    }
    
    if (!tableInfo.find(c => c.name === 'CoordinatorEmail')) {
        db.prepare("ALTER TABLE projects ADD COLUMN CoordinatorEmail TEXT").run();
        console.log('Added CoordinatorEmail column.');
    }

    console.log('Project table updated successfully.');
} catch (err) {
    console.error('Error updating project table:', err);
} finally {
    db.close();
}
