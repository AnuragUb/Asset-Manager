const Database = require('better-sqlite3');
const qrcode = require('qrcode');
const os = require('os');

const dbPath = 'c:/Users/Admin/AssetManager/duplicate/web-app/asset-manager-backend/database_v2.db';
const db = new Database(dbPath);

const regenerateAll = process.argv.includes('--all') || process.env.REGEN_ALL === '1';
const port = Number(process.env.PORT || 8080);

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

async function populateProjectQRs() {
    const projects = regenerateAll
        ? db.prepare('SELECT * FROM projects').all()
        : db.prepare("SELECT * FROM projects WHERE QRCode IS NULL OR QRCode = ''").all();
    console.log(
        regenerateAll
            ? `Found ${projects.length} projects (regenerating all QR codes).`
            : `Found ${projects.length} projects without QR codes.`
    );

    const ip = getLocalIP();

    for (const project of projects) {
        const id = project.ID;
        const urlText = `http://${ip}:${port}/project/${encodeURIComponent(id)}`;

        try {
            const qrCode = await qrcode.toDataURL(urlText, { width: 512 });
            db.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
            console.log(`Generated QR for Project: ${id}`);
        } catch (err) {
            console.error(`Failed to generate QR for ${id}:`, err);
        }
    }

    console.log('Done populating project QR codes.');
}

populateProjectQRs();
