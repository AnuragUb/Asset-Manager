const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

try {
    const id = 'PRJ' + Date.now();
    db.prepare(`
        INSERT INTO projects (ID, ProjectName, ClientName, Description, Status, StartDate, EndDate, CreatedBy, Timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'Sample Project', 'Test Client', 'This is a test project to verify the Projects tab works.', 'Active', new Date().toISOString(), '', 'admin', new Date().toISOString());
    console.log('Sample project created with ID:', id);
} catch (err) {
    console.error('Error seeding project:', err);
} finally {
    db.close();
}
