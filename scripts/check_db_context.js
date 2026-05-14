const knex = require('knex');

async function checkContext(dbName) {
    console.log(`\n--- Checking context for: ${dbName} ---`);
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
        const users = await db('users').select('username', 'company_id', 'role');
        console.log('Users:', JSON.stringify(users, null, 2));

        const projects = await db('projects').select('ID', 'ProjectName', 'CreatedBy').limit(5);
        console.log('Sample Projects:', JSON.stringify(projects, null, 2));

        const assetsCount = await db('assets').count('* as count').first();
        console.log('Assets Count:', assetsCount.count);

        const projectAssetsCount = await db('project_assets').count('* as count').first();
        console.log('Project Assets Mappings:', projectAssetsCount.count);

        // Check if admin is associated with any projects
        const adminProjects = await db('projects').where('CreatedBy', 'admin').count('* as count').first();
        console.log('Projects created by admin:', adminProjects.count);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await checkContext('asset_manager');
    await checkContext('asset_manager_test');
}

run();
