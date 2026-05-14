const Database = require('better-sqlite3');
const path = require('path');
const encryptionService = require('./services/encryptionService');

const DB_PATH = path.join(__dirname, '../../data/test/database_v2.db');

function migrateData() {
    console.log('[Migration] Encrypting existing sensitive data...');
    const db = new Database(DB_PATH);

    const assets = db.prepare('SELECT ID, SrNo FROM assets').all();
    const itDetails = db.prepare('SELECT AssetID, MACAddress, IPAddress, SocketID FROM asset_it_details').all();

    db.transaction(() => {
        // 1. Encrypt Asset Serial Numbers
        const updateAsset = db.prepare('UPDATE assets SET SrNo = ? WHERE ID = ?');
        for (const asset of assets) {
            if (asset.SrNo && !asset.SrNo.startsWith('det:')) {
                updateAsset.run(encryptionService.encryptDeterministic(asset.SrNo), asset.ID);
            }
        }

        // 2. Encrypt IT Details
        const updateIt = db.prepare('UPDATE asset_it_details SET MACAddress = ?, IPAddress = ?, SocketID = ? WHERE AssetID = ?');
        for (const it of itDetails) {
            const mac = (it.MACAddress && !it.MACAddress.startsWith('enc:')) ? encryptionService.encrypt(it.MACAddress) : it.MACAddress;
            const ip = (it.IPAddress && !it.IPAddress.startsWith('enc:')) ? encryptionService.encrypt(it.IPAddress) : it.IPAddress;
            const socket = (it.SocketID && !it.SocketID.startsWith('enc:')) ? encryptionService.encrypt(it.SocketID) : it.SocketID;
            
            updateIt.run(mac, ip, socket, it.AssetID);
        }
    })();

    console.log(`[Migration] Successfully encrypted ${assets.length} assets and ${itDetails.length} IT records.`);
    db.close();
}

migrateData();
