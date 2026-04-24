const Database = require('better-sqlite3');
const path = require('path');

const prodDbPath = 'C:/Users/Admin/AssetManager/backups/8080_prod/database_v2_20260417_1304.db';
const devDbPath = 'C:/Users/Admin/AssetManager/backups/9090_dev/database_v2_20260416_1056.db';

function inspect(name, p) {
    try {
        const db = new Database(p, { readonly: true });
        const users = db.prepare('SELECT count(*) as c FROM users').get().c;
        const assets = db.prepare('SELECT count(*) as c FROM assets').get().c;
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
        console.log(`--- ${name} ---`);
        console.log(`Path: ${p}`);
        console.log(`Users: ${users}`);
        console.log(`Assets: ${assets}`);
        console.log(`Tables: ${tables.join(', ')}`);
        db.close();
    } catch (e) {
        console.error(`Failed to inspect ${name}: ${e.message}`);
    }
}

inspect('PROD (8080)', prodDbPath);
inspect('DEV (9090)', devDbPath);
