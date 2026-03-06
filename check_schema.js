const { db } = require('./web-app/asset-manager-backend/utils');
console.log(db.prepare('PRAGMA table_info(project_assets)').all());