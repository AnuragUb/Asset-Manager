const db = require('better-sqlite3')('database_v2.db');

try {
    // Check if table exists
    const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_templates'").get();
    if (!tableInfo) {
        console.log('Table company_templates does NOT exist.');
    } else {
        console.log('Table company_templates exists.');
        
        // Check count
        const count = db.prepare('SELECT count(*) as count FROM company_templates').get().count;
        console.log(`Row count: ${count}`);
        
        // Show rows
        const rows = db.prepare('SELECT * FROM company_templates').all();
        console.log('Rows:', JSON.stringify(rows, null, 2));
    }
} catch (e) {
    console.error('Error:', e);
}
