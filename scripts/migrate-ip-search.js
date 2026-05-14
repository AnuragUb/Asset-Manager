const Database = require('better-sqlite3');
const path = require('path');
const encryptionService = require('./services/encryptionService');

const DB_PATH = path.join(__dirname, '../../data/test/database_v2.db');

function migrateIpEncryption() {
    console.log('[Migration] Converting IP Addresses to Deterministic Encryption...');
    const db = new Database(DB_PATH);

    const itDetails = db.prepare('SELECT AssetID, IPAddress FROM asset_it_details').all();

    db.transaction(() => {
        const updateIt = db.prepare('UPDATE asset_it_details SET IPAddress = ? WHERE AssetID = ?');
        let count = 0;
        for (const it of itDetails) {
            if (it.IPAddress) {
                // Decrypt the current one (could be plaintext, enc:, or det:)
                const decrypted = encryptionService.universalDecrypt(it.IPAddress);
                // Encrypt deterministically
                const deterministic = encryptionService.encryptDeterministic(decrypted);
                
                if (it.IPAddress !== deterministic) {
                    updateIt.run(deterministic, it.AssetID);
                    count++;
                }
            }
        }
        console.log(`[Migration] Updated ${count} IP addresses.`);
    })();

    db.close();
}

migrateIpEncryption();
