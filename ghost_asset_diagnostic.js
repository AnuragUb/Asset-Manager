const { db } = require('./web-app/asset-manager-backend/utils');

async function diagnostic() {
    console.log('--- ASSET HEALTH DIAGNOSTIC START ---');
    
    try {
        // 1. Find assets without categories
        const noCategory = await db('assets')
            .where(function() {
                this.whereNull('category').orWhere('category', '').orWhere('category', 'null');
            })
            .andWhere(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            });
        
        console.log(`\n[1] Assets without Category: ${noCategory.length}`);
        noCategory.forEach(a => console.log(`  - ID: ${a.id} | Name: ${a.itemname}`));

        // 2. Find assets without Type (Kind)
        const noType = await db('assets')
            .where(function() {
                this.whereNull('type').orWhere('type', '').orWhere('type', 'null');
            })
            .andWhere(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            });
            
        console.log(`\n[2] Assets without Type (Kind): ${noType.length}`);
        noType.forEach(a => console.log(`  - ID: ${a.id} | Name: ${a.itemname}`));

        // 3. Find assets assigned to non-existent projects
        const orphanedProjects = await db('project_assets as pa')
            .leftJoin('projects as p', 'pa.projectid', 'p.id')
            .whereNull('p.id')
            .select('pa.assetid', 'pa.projectid');
            
        console.log(`\n[3] Assets linked to non-existent projects: ${orphanedProjects.length}`);
        orphanedProjects.forEach(o => console.log(`  - Asset: ${o.assetid} | Target Project: ${o.projectid}`));

        // 4. Ghost Component Check (Components without valid parents)
        const orphanedComponents = await db('components as c')
            .leftJoin('assets as a', 'c.parentid', 'a.id')
            .whereNull('a.id')
            .select('c.id', 'c.parentid');
            
        console.log(`\n[4] Components without valid parent assets: ${orphanedComponents.length}`);
        orphanedComponents.forEach(o => console.log(`  - Component: ${o.id} | Parent ID: ${o.parentid}`));

        console.log('\n--- DIAGNOSTIC COMPLETE ---');
        
        if (noCategory.length > 0 || noType.length > 0 || orphanedProjects.length > 0 || orphanedComponents.length > 0) {
            console.log('\nRECOMMENDATION: Run the auto-cleanup script.');
        } else {
            console.log('\nRESULT: No Ghost Assets detected. System is clean.');
        }

    } catch (err) {
        console.error('Diagnostic failed:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

diagnostic();
