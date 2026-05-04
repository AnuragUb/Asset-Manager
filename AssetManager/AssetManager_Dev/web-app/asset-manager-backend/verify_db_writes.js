const { db, appendAudit } = require('./utils');

async function verifyWrites() {
    console.log('--- DB WRITE VERIFICATION START ---');
    const testId = 'TEST-' + Date.now();
    
    try {
        // 1. Test Write to asset_kinds (Category)
        console.log(`[1/3] Attempting to create test category: ${testId}`);
        await db('asset_kinds').insert({
            name: testId,
            module: 'TEST',
            icon: '🧪',
            lastupdated: new Date().toISOString(),
            is_deleted: 0
        });
        console.log('✅ Write to asset_kinds successful.');

        // 2. Test Write to audit_log
        console.log('[2/3] Attempting to create audit log entry...');
        await appendAudit({
            Action: 'DB_WRITE_TEST',
            User: 'SYSTEM_DIAGNOSTIC',
            AssetId: testId,
            Severity: 'INFO',
            Details: 'Verified that DB writes are functioning correctly.'
        });
        console.log('✅ Write to audit_log successful.');

        // 3. Verify the data exists
        console.log('[3/3] Verifying data can be read back...');
        const verifyRow = await db('asset_kinds').where('name', testId).first();
        if (verifyRow) {
            console.log('✅ Data verification successful: Row found in DB.');
        } else {
            throw new Error('❌ DATA LOSS DETECTED: Row was inserted but could not be found!');
        }

        // Cleanup
        console.log('[CLEANUP] Removing test category...');
        await db('asset_kinds').where('name', testId).delete();
        console.log('✅ Cleanup successful.');

        console.log('\n--- VERIFICATION RESULT: PASS ---');
        console.log('The database is correctly accepting and persisting writes.');

    } catch (err) {
        console.error('\n--- VERIFICATION RESULT: FAIL ---');
        console.error('Error during DB write verification:', err.message);
        process.exit(1);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

verifyWrites();
