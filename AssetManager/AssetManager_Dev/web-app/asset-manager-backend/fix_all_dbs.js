const Database = require('better-sqlite3');
const path = require('path');

const dbs = [
    { name: 'Production (Data/Prod)', path: path.join(__dirname, '../../data/prod/database_v2.db') },
    { name: 'Testing (Data/Test)', path: path.join(__dirname, '../../data/test/database_v2.db') }
];

const createTableSQL = `
    CREATE TABLE IF NOT EXISTS company_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        company_name TEXT,
        address TEXT,
        gst TEXT,
        cin TEXT,
        state_name TEXT,
        state_code TEXT,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`;

dbs.forEach(dbInfo => {
    try {
        console.log(`\nFixing ${dbInfo.name}...`);
        const db = new Database(dbInfo.path, { fileMustExist: true });
        db.prepare(createTableSQL).run();
        console.log(`✅ Table 'company_templates' created successfully.`);
        db.close();
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
    }
});
