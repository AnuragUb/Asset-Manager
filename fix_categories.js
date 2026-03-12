
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'web-app', 'asset-manager-backend', 'database_v2.db');
const db = new Database(dbPath);

console.log('Fixing Category typos...');

// 1. Fix "Workstattion" -> "Workstation" (Type/Category)
// We'll update Category to 'IT' and Type to 'Workstation' for these, assuming they are IT assets.
// Actually, let's just fix the typo first.
db.prepare("UPDATE assets SET Category = 'Workstation' WHERE Category = 'Workstattion'").run();

// 2. Move known IT types from Category to Type if Category is not 'IT'
// List of known IT types that might have been put in Category
const itTypes = ['Server', 'Workstation', 'BroadCast Monitor', 'Laptop', 'Desktop', 'Monitor', 'Printer', 'Scanner'];

itTypes.forEach(type => {
    // If Category matches a known Type, set Category='IT' and Type=ThatValue
    const info = db.prepare("UPDATE assets SET Category = 'IT', Type = ? WHERE Category = ?").run(type, type);
    if (info.changes > 0) console.log(`Moved ${info.changes} assets from Category='${type}' to Category='IT', Type='${type}'`);
});

console.log('Database fixes applied.');
