const { db } = require('./web-app/asset-manager-backend/utils');

console.log('Project Assets Table Columns:');
const paInfo = db.prepare('PRAGMA table_info(project_assets)').all();
console.log(paInfo.map(c => c.name));
