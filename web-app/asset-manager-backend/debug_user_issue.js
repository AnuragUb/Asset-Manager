
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const assetId = 'MUM-0226-LXB2WR-G';

console.log(`Checking asset ${assetId}...`);

try {
    const asset = db.prepare('SELECT * FROM assets WHERE ID = ?').get(assetId);
    if (asset) {
        console.log('Asset found:');
        // Only print relevant fields to avoid clutter
        console.log(JSON.stringify({
            ID: asset.ID,
            ItemName: asset.ItemName,
            QRCode: asset.QRCode ? (asset.QRCode.substring(0, 50) + '...') : 'null',
            Status: asset.Status
        }, null, 2));
        
        // Try to decode QR content if possible (if it was text, but here it's likely base64 image)
        // If we want to check the URL, we can't easily do it from the image without a QR decoder library.
        // But we can check if the asset exists.
    } else {
        console.log('Asset NOT found in assets table.');
    }

    const component = db.prepare('SELECT * FROM components WHERE ID = ?').get(assetId);
    if (component) {
        console.log('Component found:');
        console.log(JSON.stringify(component, null, 2));
    }

    // Check project QR
    const project = db.prepare('SELECT ID, ProjectName, QRCode FROM projects LIMIT 1').get();
    if (project) {
        console.log('Sample Project:', {
            ID: project.ID,
            ProjectName: project.ProjectName,
            QRCode: project.QRCode ? (project.QRCode.substring(0, 50) + '...') : 'null'
        });
    }

} catch (err) {
    console.error('Error:', err);
}
