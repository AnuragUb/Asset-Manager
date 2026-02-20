const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database_v2.db');
const db = new sqlite3(dbPath);

console.log('--- Tables ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables.forEach(t => console.log(t.name));

// Try to guess AssetKinds table name
const likelyTable = tables.find(t => t.name.toLowerCase().includes('kind') || t.name.toLowerCase().includes('asset_type'));
if (likelyTable) {
    console.log(`\n--- ${likelyTable.name} ---`);
    const kinds = db.prepare(`SELECT * FROM ${likelyTable.name}`).all();
    kinds.forEach(k => console.log(`${k.ID}: ${k.Name} (Parent: ${k.ParentID || k.ParentName}, Module: ${k.Module})`));
}

console.log('\n--- Folders ---');
try {
    const folders = db.prepare('SELECT * FROM Folders').all();
    folders.forEach(f => console.log(`${f.ID}: ${f.Name} (Parent: ${f.ParentID}, Module: ${f.Module})`));
} catch (e) { console.log('Folders table error:', e.message); }

console.log('\n--- Sample Assets (Type, Category) ---');
try {
    const assets = db.prepare('SELECT ID, ItemName, Type, Category FROM Assets LIMIT 20').all();
    assets.forEach(a => console.log(`${a.ID}: ${a.ItemName} [Type: ${a.Type}, Cat: ${a.Category}]`));
} catch (e) { console.log('Assets table error:', e.message); }
