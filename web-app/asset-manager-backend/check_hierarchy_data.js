const knex = require('knex');

async function checkHierarchy(dbName) {
    console.log(`\n--- Checking hierarchy for: ${dbName} ---`);
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
        const kinds = await db('asset_kinds').select('name', 'module', 'parentname');
        console.log('Asset Kinds:', JSON.stringify(kinds, null, 2));

        const folders = await db('folders').select('id', 'name', 'parentid', 'module');
        console.log('Folders:', JSON.stringify(folders, null, 2));

        const roots = kinds.filter(k => k.module === 'IT' && (!k.parentname || k.parentname === ''));
        console.log('IT Root Kinds:', roots.length);

        const folderRoots = folders.filter(f => f.module === 'IT' && (!f.parentid || f.parentid === ''));
        console.log('IT Root Folders:', folderRoots.length);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await checkHierarchy('asset_manager');
    await checkHierarchy('asset_manager_test');
}

run();
