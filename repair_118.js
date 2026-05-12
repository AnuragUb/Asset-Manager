/**
 * REPAIR SCRIPT FOR .118 SERVER
 * Fixes: Missing categories, incorrect asset types, and CIN -> CNM ID standardization.
 */
const { db } = require('./web-app/asset-manager-backend/utils');
const { execSync } = require('child_process');

async function repair118() {
    console.log('--- STARTING .118 DATA REPAIR ---');
    
    try {
        // 1. Ensure Konvision Kind exists under Monitor
        console.log('1. Checking Hierarchy...');
        const monitorKind = await db('asset_kinds').where('name', 'Monitor').first();
        if (!monitorKind) {
            console.log('   Creating Monitor kind...');
            await db('asset_kinds').insert({
                name: 'Monitor',
                module: 'IT',
                icon: '🖥️',
                parentname: 'Peripherals',
                lastupdated: new Date().toISOString()
            });
        }

        const konvisionKind = await db('asset_kinds').where('name', 'Konvision').first();
        if (!konvisionKind) {
            console.log('   Creating Konvision sub-category...');
            await db('asset_kinds').insert({
                name: 'Konvision',
                module: 'IT',
                icon: '🖥️',
                parentname: 'Monitor',
                lastupdated: new Date().toISOString()
            });
        }

        // 2. Fix Asset Classification
        console.log('2. Fixing Asset Classification...');
        const updatedCount = await db('assets')
            .where('make', 'Konvision')
            .update({
                type: 'Konvision',
                category: 'IT'
            });
        console.log(`   Updated ${updatedCount} Konvision assets.`);

        // 3. Migrate CIN -> CNM IDs
        console.log('3. Standardizing IDs (CIN -> CNM)...');
        const cinAssets = await db('assets').where('id', 'like', '%-CIN-%');
        for (const asset of cinAssets) {
            const newId = asset.id.replace('-CIN-', '-CNM-');
            console.log(`   Renaming: ${asset.id} -> ${newId}`);
            
            await db.transaction(async (trx) => {
                await trx('assets').where('id', asset.id).update({ id: newId });
                await trx('asset_it_details').where('assetid', asset.id).update({ assetid: newId });
                await trx('project_assets').where('assetid', asset.id).update({ assetid: newId });
                await trx('components').where('parentid', asset.id).update({ parentid: newId });
                await trx('audit_log').where('assetid', asset.id).update({ assetid: newId });
            });
        }

        // 4. Fix any lingering GEN-LOC IDs
        console.log('4. Fixing GEN-LOC IDs...');
        const genLocAssets = await db('assets').where('id', 'like', 'GEN-LOC%');
        for (const asset of genLocAssets) {
            let prefix = 'GEN';
            if (asset.itemname.toLowerCase().includes('monitor')) prefix = 'MON';
            const rest = asset.id.split('-').slice(2).join('-');
            const newId = `${prefix}-CNM-${rest}`;
            
            console.log(`   Fixing: ${asset.id} -> ${newId}`);
            await db.transaction(async (trx) => {
                await trx('assets').where('id', asset.id).update({ id: newId });
                await trx('asset_it_details').where('assetid', asset.id).update({ assetid: newId });
                await trx('project_assets').where('assetid', asset.id).update({ assetid: newId });
                await trx('components').where('parentid', asset.id).update({ parentid: newId });
                await trx('audit_log').where('assetid', asset.id).update({ assetid: newId });
            });
        }

        // 5. Flush Redis Cache
        console.log('5. Flushing System Cache...');
        try {
            execSync('docker exec asset-manager-cache redis-cli flushall');
            console.log('   Cache flushed successfully.');
        } catch (err) {
            console.warn('   Could not flush cache via Docker. Please run manually.');
        }

        console.log('--- REPAIR COMPLETE ---');
        console.log('Please refresh your browser on .118');

    } catch (err) {
        console.error('REPAIR FAILED:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

repair118();
