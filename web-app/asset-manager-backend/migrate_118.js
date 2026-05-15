const knex = require('knex');
const knexConfig = require('./knexfile');

// This script syncs the database schema on server 118
async function migrate118() {
    console.log('--- Starting Migration for Server 118 ---');
    const db = knex(knexConfig.production || knexConfig.development);
    
    try {
        // 1. Sync components table
        const compCols = await db('information_schema.columns')
            .where({ table_name: 'components' })
            .select('column_name');
        const compColNames = compCols.map(c => c.column_name.toLowerCase());

        const missingComp = [
            { name: 'itemname', type: 'string' },
            { name: 'make', type: 'string' },
            { name: 'model', type: 'string' },
            { name: 'srno', type: 'string' },
            { name: 'status', type: 'string' },
            { name: 'category', type: 'string' },
            { name: 'lastupdated', type: 'string' },
            { name: 'noqr', type: 'integer', default: 0 }
        ].filter(c => !compColNames.includes(c.name));

        if (missingComp.length > 0) {
            console.log(`Adding missing columns to components: ${missingComp.map(m => m.name).join(', ')}`);
            await db.schema.alterTable('components', (table) => {
                for (const col of missingComp) {
                    if (col.type === 'string') table.string(col.name);
                    else if (col.type === 'integer') table.integer(col.name).defaultTo(col.default || 0);
                }
            });
        }

        // 2. Sync company_templates table
        const tempCols = await db('information_schema.columns')
            .where({ table_name: 'company_templates' })
            .select('column_name');
        const tempColNames = tempCols.map(c => c.column_name.toLowerCase());

        const missingTemp = [
            { name: 'name', type: 'string' },
            { name: 'company_name', type: 'string' },
            { name: 'address', type: 'text' },
            { name: 'gst', type: 'string' },
            { name: 'cin', type: 'string' },
            { name: 'state_name', type: 'string' },
            { name: 'state_code', type: 'string' },
            { name: 'is_default', type: 'integer', default: 0 }
        ].filter(c => !tempColNames.includes(c.name));

        if (missingTemp.length > 0) {
            console.log(`Adding missing columns to company_templates: ${missingTemp.map(m => m.name).join(', ')}`);
            await db.schema.alterTable('company_templates', (table) => {
                for (const col of missingTemp) {
                    if (col.type === 'string') table.string(col.name);
                    else if (col.type === 'text') table.text(col.name);
                    else if (col.type === 'integer') table.integer(col.name).defaultTo(col.default || 0);
                }
            });
        }

        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration Error:', err.message);
    } finally {
        await db.destroy();
    }
}

migrate118();
