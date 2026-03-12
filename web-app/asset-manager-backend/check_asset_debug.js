const fs = require('fs');
const path = require('path');
const dbPath = path.resolve('database_v2.db');

if (!fs.existsSync(dbPath)) {
    console.error('Database not found at:', dbPath);
    process.exit(1);
}

const db = require('better-sqlite3')(dbPath);
const id = 'DSK-MUM-0326-JPN179-T';
console.log(`Checking for asset: ${id}`);
const row = db.prepare('SELECT * FROM assets WHERE ID = ?').get(id);
if (row) {
    console.log('Found:', JSON.stringify(row, null, 2));
} else {
    console.log('Not Found');
    const all = db.prepare('SELECT ID FROM assets').all();
    console.log('Total assets:', all.length);
    console.log('Sample IDs:', all.slice(0, 5).map(a => a.ID));
    // Check for partial match
    const similar = db.prepare('SELECT ID FROM assets WHERE ID LIKE ?').all('%DSK%');
    console.log('Similar IDs (DSK):', similar.map(a => a.ID));
}
