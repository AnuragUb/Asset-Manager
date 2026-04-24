const knex = require('knex');

async function lowercaseColumns(dbName) {
    console.log(`\n--- Lowercasing columns for: ${dbName} ---`);
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
        const columns = await db('information_schema.columns')
            .where('table_schema', 'public')
            .select('table_name', 'column_name');
        
        for (const col of columns) {
            const tableName = col.table_name;
            const colName = col.column_name;
            const lowerName = colName.toLowerCase();

            if (colName !== lowerName) {
                console.log(`  Renaming ${tableName}.${colName} -> ${lowerName}`);
                await db.raw(`ALTER TABLE "${tableName}" RENAME COLUMN "${colName}" TO "${lowerName}"`);
            }
        }
        console.log(`Done with ${dbName}`);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await lowercaseColumns('asset_manager');
    await lowercaseColumns('asset_manager_test');
}

run();
