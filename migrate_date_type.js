/**
 * MIGRATION SCRIPT: Formalize Purchase Date Column
 * Converts purchasedate from varchar to DATE type in PostgreSQL.
 */
const { db } = require('./web-app/asset-manager-backend/utils');

async function migratePurchaseDate() {
    const dbName = process.env.DB_NAME || 'asset_manager';
    console.log(`--- STARTING DATE MIGRATION FOR [${dbName}] ---`);

    try {
        // 1. First, try to clean up existing "jumbled" data to prevent migration failure
        console.log('1. Cleaning up existing date strings...');
        
        // We'll update rows where purchasedate is a number (Excel serial)
        const assets = await db('assets').select('id', 'purchasedate').whereNotNull('purchasedate');
        
        for (const asset of assets) {
            let val = asset.purchasedate;
            
            // If it's an empty string or just whitespace, set to null
            if (val === '' || (typeof val === 'string' && val.trim() === '')) {
                await db('assets').where('id', asset.id).update({ purchasedate: null });
                continue;
            }

            if (!val || (typeof val === 'string' && val.includes('-') && val.split('-').length === 3 && val.split('-')[0].length === 4)) continue; // Already YYYY-MM-DD

            let dateObj;
            if (!isNaN(val) && !isNaN(parseFloat(val))) {
                const num = parseFloat(val);
                dateObj = new Date((num - 25569) * 86400 * 1000);
            } else {
                dateObj = new Date(val);
            }

            if (dateObj && !isNaN(dateObj.getTime())) {
                const formatted = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
                await db('assets').where('id', asset.id).update({ purchasedate: formatted });
            } else {
                // If it's totally invalid, null it out so the migration doesn't crash
                await db('assets').where('id', asset.id).update({ purchasedate: null });
            }
        }

        // 2. Perform the actual column type change
        console.log('2. Altering column type to DATE...');
        await db.raw('ALTER TABLE assets ALTER COLUMN purchasedate TYPE DATE USING purchasedate::DATE');

        console.log('--- MIGRATION SUCCESSFUL ---');
    } catch (err) {
        console.error('MIGRATION FAILED:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

migratePurchaseDate();
