const { db } = require('./web-app/asset-manager-backend/utils');
console.log(db.prepare('SELECT * FROM project_assets WHERE AssetID = ?').all('CAM2601022567'));