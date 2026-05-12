const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/test/database_v2.db');
const TEMP_DB_PATH = DB_PATH + '.encrypted';
const BACKUP_PATH = DB_PATH + '.bak';
const ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'AssetManagerSecureKey2026!';

async function encryptDatabase() {
    console.log('[Migration] Starting Database Encryption...');

    if (!fs.existsSync(DB_PATH)) {
        console.error('[Migration] Source database not found at:', DB_PATH);
        return;
    }

    try {
        // 1. Try to open the DB without a key to check if it's plaintext
        const plaintextDb = new Database(DB_PATH);
        try {
            // Check if we can read from it (if this fails, it might already be encrypted)
            plaintextDb.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
            console.log('[Migration] Database is currently plaintext. Proceeding with encryption.');
        } catch (err) {
            console.log('[Migration] Database is already encrypted or inaccessible. Skipping encryption step.');
            plaintextDb.close();
            return;
        }

        // 2. Perform the encryption using SQLCipher's ATTACH method
        // This is the standard way to encrypt a plaintext DB
        plaintextDb.prepare(`ATTACH DATABASE '${TEMP_DB_PATH}' AS encrypted KEY '${ENCRYPTION_KEY}'`).run();
        
        // Copy all tables and data
        console.log('[Migration] Copying data to encrypted volume...');
        plaintextDb.prepare("SELECT sqlcipher_export('encrypted')").run();
        
        plaintextDb.prepare("DETACH DATABASE encrypted").run();
        plaintextDb.close();

        // 3. Swap the files
        console.log('[Migration] Swapping database files...');
        if (fs.existsSync(BACKUP_PATH)) fs.unlinkSync(BACKUP_PATH);
        fs.renameSync(DB_PATH, BACKUP_PATH);
        fs.renameSync(TEMP_DB_PATH, DB_PATH);

        console.log('[Migration] Database successfully encrypted!');
        console.log('[Migration] Original plaintext backup saved at:', BACKUP_PATH);

    } catch (err) {
        console.error('[Migration] Encryption failed:', err.message);
        if (fs.existsSync(TEMP_DB_PATH)) fs.unlinkSync(TEMP_DB_PATH);
        process.exit(1);
    }
}

encryptDatabase();
