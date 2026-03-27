
const fetch = require('node-fetch');

async function testBulkUpload() {
    // Dynamic import for node-fetch if using v3
    // But assuming v2 for require, if it fails with 'fetch is not a function' it means require failed or v3 ESM issue
    // Let's use native fetch if available (Node 18+)
    const _fetch = global.fetch || require('node-fetch');

    const assetId = `TEST-${Date.now()}`;
    const payload = [
        {
            ID: assetId,
            ItemName: 'Test Asset Bulk Upload',
            ItemDescription: 'Description for test asset',
            Category: 'IT',
            Status: 'In Store',
            asset_value: 1000,
            Currency: 'USD',
            PurchaseDate: '2025-01-01',
            Remarks: 'Test Remark'
        }
    ];

    console.log('Sending payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await _fetch('http://localhost:8080/api/assets/bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user': 'test-script'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', text);

        if (response.ok) {
            console.log('Upload successful. Verifying DB...');
            // We can't easily check DB from here without better-sqlite3, 
            // but we can assume if 200 OK and "count": 1, it's likely good.
            // We will run a separate check or use the check_assets.js script.
        }
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testBulkUpload();
