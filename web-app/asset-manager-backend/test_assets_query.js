const knex = require('knex');

async function checkAssetsQuery(dbName) {
    console.log(`\n--- Testing assets query for: ${dbName} ---`);
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
        let query = db('assets as a')
          .leftJoin('asset_it_details as it', 'a.ID', 'it.AssetID')
          .leftJoin('project_assets as pa', 'a.ID', 'pa.AssetID')
          .leftJoin('projects as p', 'pa.ProjectID', 'p.ID')
          .where(function() {
            this.where('a.is_deleted', 0).orWhereNull('a.is_deleted');
          });

        const assets = await query
          .select('a.*', 'it.MACAddress', 'it.IPAddress', 'it.NetworkType', 'it.PhysicalPort', 'it.VLAN', 'it.SocketID', 'it.UserID', 'p.ProjectName as AssignedProjectName', 'p.ID as AssignedProjectID')
          .orderBy('a.LastUpdated', 'desc');

        console.log(`Total assets found: ${assets.length}`);
        if (assets.length > 0) {
            console.log('Sample Asset:', JSON.stringify(assets[0], null, 2));
            
            // Check for missing critical fields
            const missingCategory = assets.filter(a => !a.Category).length;
            console.log(`Assets with missing Category: ${missingCategory}`);

            const missingItemName = assets.filter(a => !a.ItemName).length;
            console.log(`Assets with missing ItemName: ${missingItemName}`);
        }

    } catch (e) {
        console.error('Error:', e.message);
        console.error(e.stack);
    } finally {
        await db.destroy();
    }
}

async function run() {
    await checkAssetsQuery('asset_manager');
    await checkAssetsQuery('asset_manager_test');
}

run();
