const { db } = require('./web-app/asset-manager-backend/utils');

console.log('--- Projects Table ---');
const projectsInfo = db.prepare('PRAGMA table_info(projects)').all();
console.log(projectsInfo.map(c => c.name));

console.log('\n--- Project Orders Table ---');
const ordersInfo = db.prepare('PRAGMA table_info(project_orders)').all();
console.log(ordersInfo.map(c => c.name));
