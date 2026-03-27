const { db } = require('./utils');

try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_templates'").get();
    if (table) {
        console.log("Table 'company_templates' exists.");
        const count = db.prepare('SELECT count(*) as count FROM company_templates').get();
        console.log(`Row count: ${count.count}`);
    } else {
        console.log("Table 'company_templates' DOES NOT exist.");
    }
} catch (err) {
    console.error('Error:', err);
}
