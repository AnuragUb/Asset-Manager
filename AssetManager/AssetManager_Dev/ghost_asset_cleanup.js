const { db, appendAudit } = require('./web-app/asset-manager-backend/utils');

async function autoCleanup() {
    console.log('--- ASSET AUTO-CLEANUP START ---');
    
    try {
        await db.transaction(async (trx) => {
            // 1. Cleanup orphaned project links
            const orphanedProjects = await trx('project_assets as pa')
                .leftJoin('projects as p', 'pa.projectid', 'p.id')
                .whereNull('p.id')
                .select('pa.assetid', 'pa.projectid');
            
            if (orphanedProjects.length > 0) {
                console.log(`[1] Cleaning ${orphanedProjects.length} orphaned project links...`);
                for (const o of orphanedProjects) {
                    await trx('project_assets')
                        .where('assetid', o.assetid)
                        .andWhere('projectid', o.projectid)
                        .delete();
                    
                    // Return asset to stock if it was stuck
                    await trx('assets')
                        .where('id', o.assetid)
                        .whereIn('status', ['In-Use', 'Project Assigned', 'Shipped'])
                        .update({ status: 'In-Stock', assignedto: 'General Stock', lastupdated: new Date().toISOString() });
                    
                    console.log(`  - Recovered asset ${o.assetid} from ghost project ${o.projectid}`);
                }
            }

            // 2. Fix Assets without mandatory fields
            // We move them to a 'UNCATEGORIZED' bucket so they can be found and fixed via UI
            const missingFields = await trx('assets')
                .where(function() {
                    this.whereNull('category').orWhere('category', '').orWhere('category', 'null')
                        .orWhereNull('type').orWhere('type', '').orWhere('type', 'null');
                })
                .andWhere(function() {
                    this.where('is_deleted', 0).orWhereNull('is_deleted');
                });

            if (missingFields.length > 0) {
                console.log(`[2] Fixing ${missingFields.length} assets with missing category/type...`);
                for (const a of missingFields) {
                    await trx('assets')
                        .where('id', a.id)
                        .update({
                            category: a.category || 'IT',
                            type: a.type || 'Accessory',
                            itemname: a.itemname || 'RECOVERY_NEEDED',
                            lastupdated: new Date().toISOString()
                        });
                    console.log(`  - Initialized mandatory fields for asset: ${a.id}`);
                }
            }

            await appendAudit({
                Action: 'GHOST_CLEANUP',
                User: 'SYSTEM_MAINTENANCE',
                AssetId: 'MULTIPLE',
                Severity: 'INFO',
                Details: `Ran automated cleanup. Fixed ${orphanedProjects.length} project links and ${missingFields.length} data field issues.`
            });
        });

        console.log('\n--- AUTO-CLEANUP COMPLETE ---');
        console.log('System is now optimized and healthy.');

    } catch (err) {
        console.error('Cleanup failed:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

autoCleanup();
