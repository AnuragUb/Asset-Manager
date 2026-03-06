const { db } = require('./web-app/asset-manager-backend/utils');
console.log('--- Projects Table ---');
console.log(db.prepare('PRAGMA table_info(projects)').all());
console.log('\n--- Project Orders Table (if exists) ---');
try {
    console.log(db.prepare('PRAGMA table_info(project_orders)').all());
} catch (e) {
    console.log('project_orders table does not exist');
}
