const { db } = require('./web-app/asset-manager-backend/utils');
console.log(db.prepare('SELECT * FROM asset_kinds LIMIT 5').all());