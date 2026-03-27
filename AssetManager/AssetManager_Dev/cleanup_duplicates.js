const { db } = require('./web-app/asset-manager-backend/utils');

const assetId = 'CAM2601022567';

console.log(`Checking assignments for ${assetId}...`);
const assignments = db.prepare('SELECT * FROM project_assets WHERE AssetID = ? ORDER BY AssignedDate DESC').all(assetId);

if (assignments.length > 1) {
    console.log(`Found ${assignments.length} assignments. Keeping the latest one:`, assignments[0]);
    
    const keep = assignments[0];
    // Delete all assignments for this asset
    db.prepare('DELETE FROM project_assets WHERE AssetID = ?').run(assetId);
    
    // Re-insert the latest one
    db.prepare('INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type) VALUES (?, ?, ?, ?)').run(keep.ProjectID, keep.AssetID, keep.AssignedDate, keep.Type);
    
    console.log('Cleanup complete.');
} else {
    console.log('No duplicates found or only one assignment exists.');
}
