const { db } = require('./web-app/asset-manager-backend/utils');

console.log('Assets Table Columns:');
const assetsInfo = db.prepare('PRAGMA table_info(assets)').all();
console.log(assetsInfo.map(c => c.name));
