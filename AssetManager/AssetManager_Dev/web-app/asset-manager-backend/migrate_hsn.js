const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Migrating HSN codes table...');

try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS hsn_codes (
            code TEXT PRIMARY KEY,
            description TEXT,
            gst_rate REAL
        )
    `).run();
    console.log('Created hsn_codes table.');

    // Check if table is empty, if so, seed some initial data?
    const count = db.prepare('SELECT count(*) as count FROM hsn_codes').get();
    if (count.count === 0) {
        console.log('Seeding initial HSN codes...');
        const stmt = db.prepare('INSERT INTO hsn_codes (code, description, gst_rate) VALUES (?, ?, ?)');
        const seedData = [
            ['39231030', 'Ferrule', 18.0],
            ['8544', 'Cables', 18.0],
            ['8517', 'Networking Equipment', 18.0]
        ];
        
        const insertMany = db.transaction((data) => {
            for (const row of data) stmt.run(row);
        });
        insertMany(seedData);
        console.log('Seeded initial HSN codes.');
    }

} catch (err) {
    console.error('Error migrating HSN table:', err);
} finally {
    db.close();
}
