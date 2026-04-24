const fs = require('fs');
const path = require('path');

const devServerPath = 'c:/Users/Admin/AssetManager/AssetManager_Dev/web-app/asset-manager-backend/server.js';
const prodServerPath = 'c:/Users/Admin/AssetManager/AssetManager_Prod/web-app/asset-manager-backend/server.js';

let content = fs.readFileSync(devServerPath, 'utf8');

// Replace port to 8080 for production
content = content.replace(/const port = process\.env\.PORT || 9090;/, "const port = process.env.PORT || 8080;");
content = content.replace(/app\.listen\(port, '0\.0\.0\.0'/, "app.listen(8080, '0.0.0.0'");

// Ensure production DB path is used if explicitly defined (though it seems it uses a relative path by default)
// Dev server.js has: const dbPath = process.env.DB_PATH || path.join(__dirname, 'database_v2.db');
// Prod uses data/prod/database_v2.db usually via utils.js. Let's check utils.js.

fs.writeFileSync(prodServerPath, content);
console.log('Synchronized server.js to Production with port 8080.');

// Sync other backend files
const filesToSync = ['utils.js', 'IdGenerator.js'];
filesToSync.forEach(file => {
    const devPath = path.join('c:/Users/Admin/AssetManager/AssetManager_Dev/web-app/asset-manager-backend', file);
    const prodPath = path.join('c:/Users/Admin/AssetManager/AssetManager_Prod/web-app/asset-manager-backend', file);
    if (fs.existsSync(devPath)) {
        let fileContent = fs.readFileSync(devPath, 'utf8');
        // If it's utils.js, we must adjust the DB path
        if (file === 'utils.js') {
            fileContent = fileContent.replace(/'\.\.\/\.\.\/data\/test\/database_v2\.db'/, "'../../data/prod/database_v2.db'");
        }
        fs.writeFileSync(prodPath, fileContent);
        console.log(`Synchronized ${file} to Production.`);
    }
});

// Sync frontend files
const frontendFiles = ['js/dashboard.js', 'js/projects.js', 'js/main.js', 'js/dc.js', 'index.html'];
frontendFiles.forEach(file => {
    const devPath = path.join('c:/Users/Admin/AssetManager/AssetManager_Dev/web-app/asset-manager-frontend', file);
    const prodPath = path.join('c:/Users/Admin/AssetManager/AssetManager_Prod/web-app/asset-manager-frontend', file);
    if (fs.existsSync(devPath)) {
        fs.writeFileSync(prodPath, fs.readFileSync(devPath));
        console.log(`Synchronized ${file} to Production.`);
    }
});
