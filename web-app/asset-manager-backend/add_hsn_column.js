const knex = require('knex');
const knexConfig = require('./knexfile');

async function addHSNColumn() {
    // On 118 prod, we use the production config
    const db = knex(knexConfig.production || knexConfig.development);
    
    try {
        console.log('--- Checking for HSN column ---');
        const hasHSN = await db.schema.hasColumn('assets', 'hsn_code');
        if (!hasHSN) {
            console.log("Adding 'hsn_code' to assets table...");
            await db.schema.alterTable('assets', (table) => {
                table.string('hsn_code', 50).nullable();
            });
            console.log("Column 'hsn_code' added successfully.");
        } else {
            console.log("Column 'hsn_code' already exists.");
        }
    } catch (err) {
        console.error("Migration Error:", err.message);
    } finally {
        await db.destroy();
    }
}

addHSNColumn();
