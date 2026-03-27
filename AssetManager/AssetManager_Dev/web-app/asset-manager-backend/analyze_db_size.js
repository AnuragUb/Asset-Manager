
const Database = require('better-sqlite3');
const db = new Database('database_v2.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('--- TABLES ---');
tables.forEach(t => {
    console.log(`Table: ${t.name}`);
    const columns = db.prepare(`PRAGMA table_info(${t.name})`).all();
    console.log('Columns:', columns.length);
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${t.name}`).get();
    console.log('Rows:', count.count);
    
    // Estimate row size (rough average of text length + fixed overhead)
    // This is very approximate
    try {
        const sample = db.prepare(`SELECT * FROM ${t.name} LIMIT 10`).all();
        if (sample.length > 0) {
            const avgSize = sample.reduce((acc, row) => {
                return acc + JSON.stringify(row).length;
            }, 0) / sample.length;
            console.log('Avg Row Size (JSON est):', Math.round(avgSize), 'bytes');
        }
    } catch (e) {}
    console.log('---');
});
