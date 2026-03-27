const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const columns = [
    'ConsigneeName', 'ConsigneeAddress', 'ConsigneeGSTIN', 'ConsigneeState', 'ConsigneeStateCode',
    'BuyerName', 'BuyerAddress', 'BuyerGSTIN', 'BuyerState', 'BuyerStateCode'
];

try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    const existingColumns = new Set(tableInfo.map(c => c.name));

    columns.forEach(col => {
        if (!existingColumns.has(col)) {
            console.log(`Adding column ${col} to projects table...`);
            db.prepare(`ALTER TABLE projects ADD COLUMN ${col} TEXT`).run();
        } else {
            console.log(`Column ${col} already exists.`);
        }
    });
    console.log('Schema update complete.');
} catch (err) {
    console.error('Error updating schema:', err);
}
