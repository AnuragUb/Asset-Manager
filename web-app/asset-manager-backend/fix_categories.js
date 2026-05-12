
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Fixing Category typos...');

// 1. Fix "Workstattion" -> "Workstation" (Type/Category)
db.prepare("UPDATE assets SET Category = 'Workstation' WHERE Category = 'Workstattion'").run();

// 2. Move known IT types from Category to Type if Category is not 'IT'
const itTypes = ['Server', 'Workstation', 'BroadCast Monitor', 'Laptop', 'Desktop', 'Monitor', 'Printer', 'Scanner'];

itTypes.forEach(type => {
    // If Category matches a known Type, set Category='IT' and Type=ThatValue
    const info = db.prepare("UPDATE assets SET Category = 'IT', Type = ? WHERE Category = ?").run(type, type);
    if (info.changes > 0) console.log(`Moved ${info.changes} assets from Category='${type}' to Category='IT', Type='${type}'`);
});

console.log('Database fixes applied.');
