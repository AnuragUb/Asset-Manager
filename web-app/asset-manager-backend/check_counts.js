const knex = require('knex');

async function checkCounts(dbName) {
    console.log(`\n--- Checking counts for: ${dbName} ---`);
    const db = knex({
        client: 'postgresql',
        connection: {
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: 'password',
            database: dbName
        }
    });

    try {
        const counts = await db('assets')
            .select('Category')
            .count('* as count')
            .groupBy('Category');
        console.log('Asset Counts by Category:', JSON.stringify(counts, null, 2));

        const kinds = await db('asset_kinds')
            .select('Module')
            .count('* as count')
            .groupBy('Module');
        console.log('Asset Kinds by Module:', JSON.stringify(kinds, null, 2));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await checkCounts('asset_manager');
    await checkCounts('asset_manager_test');
}

run();
