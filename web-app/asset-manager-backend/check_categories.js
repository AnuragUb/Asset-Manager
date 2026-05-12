const knex = require('knex');

async function checkCategories(dbName) {
    console.log(`\n--- Checking categories for: ${dbName} ---`);
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
        const categories = await db('assets').distinct('Category');
        console.log('Categories:', JSON.stringify(categories, null, 2));

        const assetKinds = await db('asset_kinds').distinct('Module');
        console.log('Asset Kind Modules:', JSON.stringify(assetKinds, null, 2));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await checkCategories('asset_manager');
    await checkCategories('asset_manager_test');
}

run();
