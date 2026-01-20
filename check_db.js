const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'web-app/asset-manager-backend/database_v2.db');
const db = new Database(dbPath);

console.log('--- ASSETS SCHEMA ---');
const schema = db.prepare("PRAGMA table_info(assets)").all();
console.log(JSON.stringify(schema, null, 2));

console.log('\n--- SAMPLE DATA (1 row) ---');
const sample = db.prepare("SELECT * FROM assets LIMIT 1").get();
console.log(JSON.stringify(sample, null, 2));

console.log('\n--- WARRANTY COLUMNS CHECK ---');
const hasWarranty = schema.some(c => c.name === 'warranty_months');
const hasPurchaseDate = schema.some(c => c.name === 'PurchaseDate');
console.log(`warranty_months exists: ${hasWarranty}`);
console.log(`PurchaseDate exists: ${hasPurchaseDate}`);
