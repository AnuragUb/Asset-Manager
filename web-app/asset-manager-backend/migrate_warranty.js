const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

try {
    // Add amc_months if it doesn't exist
    const tableInfo = db.prepare("PRAGMA table_info(assets)").all();
    
    if (!tableInfo.find(c => c.name === 'amc_months')) {
        db.prepare("ALTER TABLE assets ADD COLUMN amc_months INTEGER DEFAULT 0").run();
        console.log('Added amc_months column to assets table.');
    } else {
        console.log('amc_months column already exists.');
    }

    if (!tableInfo.find(c => c.name === 'warranty_months')) {
        db.prepare("ALTER TABLE assets ADD COLUMN warranty_months INTEGER DEFAULT 0").run();
        console.log('Added warranty_months column to assets table.');
    }

    if (!tableInfo.find(c => c.name === 'asset_value')) {
        db.prepare("ALTER TABLE assets ADD COLUMN asset_value REAL DEFAULT 0").run();
        console.log('Added asset_value column to assets table.');
    }

    if (!tableInfo.find(c => c.name === 'Currency')) {
        db.prepare("ALTER TABLE assets ADD COLUMN Currency TEXT DEFAULT 'USD'").run();
        console.log('Added Currency column to assets table.');
    }

} catch (err) {
    console.error('Error migrating database:', err);
} finally {
    db.close();
}
