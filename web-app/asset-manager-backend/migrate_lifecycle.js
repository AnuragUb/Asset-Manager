const knex = require('knex');
const knexConfig = require('./knexfile');

async function migrateLifecycle() {
    const db = knex(knexConfig.test || knexConfig.development);
    
    try {
        console.log('--- Migrating Asset Lifecycle Columns (Test DB) ---');
        
        const hasCondition = await db.schema.hasColumn('assets', 'condition');
        const hasIsRetired = await db.schema.hasColumn('assets', 'is_retired');
        const hasSaleDetails = await db.schema.hasColumn('assets', 'sale_details');

        await db.schema.alterTable('assets', (table) => {
            if (!hasCondition) {
                table.string('condition', 50).defaultTo('Good');
                console.log('Added column: condition');
            }
            if (!hasIsRetired) {
                table.integer('is_retired').defaultTo(0);
                console.log('Added column: is_retired');
            }
            if (!hasSaleDetails) {
                table.text('sale_details').nullable();
                console.log('Added column: sale_details');
            }
        });
        
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await db.destroy();
    }
}

migrateLifecycle();
