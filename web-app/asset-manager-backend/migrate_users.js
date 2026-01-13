const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Migrating users to SQLite...');

// 1. Create users table
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        fullname TEXT,
        role TEXT DEFAULT 'user',
        client_id TEXT,
        project_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// 2. Load existing users from users.json
const usersFile = path.join(__dirname, '../../users.json');
if (fs.existsSync(usersFile)) {
    try {
        const userData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        const users = userData.users || [];
        
        const insert = db.prepare('INSERT OR IGNORE INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)');
        
        db.transaction((usersToInsert) => {
            for (const user of usersToInsert) {
                insert.run(user.username, user.password, user.fullname, user.role);
            }
        })(users);
        
        console.log(`Migrated ${users.length} users.`);
    } catch (err) {
        console.error('Error migrating users:', err);
    }
} else {
    // Add default admin if no file exists
    db.prepare('INSERT OR IGNORE INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)').run('admin', 'admin123', 'Administrator', 'superuser');
}

console.log('User migration complete.');
