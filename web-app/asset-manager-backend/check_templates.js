const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dc_remark_templates'").get();
    if (table) {
        console.log("Table 'dc_remark_templates' exists.");
        const count = db.prepare('SELECT count(*) as count FROM dc_remark_templates').get();
        console.log(`Row count: ${count.count}`);
        
        const rows = db.prepare('SELECT * FROM dc_remark_templates').all();
        console.log('Rows:', JSON.stringify(rows, null, 2));
    } else {
        console.log("Table 'dc_remark_templates' DOES NOT exist.");
    }
} catch (err) {
    console.error('Error:', err);
}
