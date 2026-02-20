
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Adding warranty_tracking column to assets table...');

try {
    const tableInfo = db.prepare("PRAGMA table_info(assets)").all();
    
    if (!tableInfo.find(c => c.name === 'warranty_tracking')) {
        db.prepare("ALTER TABLE assets ADD COLUMN warranty_tracking INTEGER DEFAULT 0").run();
        console.log('Added warranty_tracking column.');
    } else {
        console.log('warranty_tracking column already exists.');
    }

    console.log('Migration complete.');
} catch (err) {
    console.error('Error migrating database:', err);
} finally {
    db.close();
}
