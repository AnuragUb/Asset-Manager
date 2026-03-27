const Database = require('better-sqlite3');
const path = require('path');

const dbs = [
    { name: 'Original (Backend Folder)', path: path.join(__dirname, 'database_v2.db') },
    { name: 'Production (Data/Prod)', path: path.join(__dirname, '../../data/prod/database_v2.db') },
    { name: 'Testing (Data/Test)', path: path.join(__dirname, '../../data/test/database_v2.db') }
];

dbs.forEach(dbInfo => {
    try {
        console.log(`\nChecking ${dbInfo.name}...`);
        console.log(`Path: ${dbInfo.path}`);
        const db = new Database(dbInfo.path, { fileMustExist: true });
        
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_templates'").get();
        if (table) {
            const count = db.prepare('SELECT count(*) as count FROM company_templates').get();
            console.log(`✅ Table exists. Rows: ${count.count}`);
        } else {
            console.log("❌ Table 'company_templates' MISSING.");
        }
        db.close();
    } catch (err) {
        console.log(`❌ Error opening DB: ${err.message}`);
    }
});
