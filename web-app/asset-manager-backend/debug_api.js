const sqlite3 = require('better-sqlite3');
const db = new sqlite3('c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db');

const query = `
  SELECT a.*, 
         it.MACAddress, it.IPAddress, it.NetworkType, 
         it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
  FROM assets a
  LEFT JOIN asset_it_details it ON a.ID = it.AssetID
`;

let assets = db.prepare(query).all();
const componentIds = new Set(db.prepare('SELECT ID FROM components').all().map(c => c.ID));
const nonQrComponents = db.prepare('SELECT * FROM components WHERE NoQR = 1').all();

const processedAssets = assets.map(a => ({
  ...a,
  isComponent: componentIds.has(a.ID) || a.ParentId != null
}));

const hdd = processedAssets.find(a => a.ID === 'LOC-0126-WD8THD-A');
console.log('HDD processed asset:', hdd);
console.log('HDD isComponent:', hdd.isComponent);
console.log('HDD Type:', hdd.Type);
