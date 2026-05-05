const { db } = require('./web-app/asset-manager-backend/utils');

const iconMap = {
    'Laptop': '💻',
    'Desktop': '🖥️',
    'Monitor': '🖥️',
    'Printer': '🖨️',
    'Server': '🖥️',
    'Switch': '🔌',
    'Router': '📶',
    'Camera': '📷',
    'NVR': '📹',
    'Phone': '📱',
    'Tablet': '📱',
    'Projector': '📽️',
    'Scanner': '📠',
    'UPS': '🔋',
    'Rack': '🗄️',
    'Software': '💾',
    'License': '🔑',
    'Furniture': '🪑',
    'Vehicle': '🚗',
    'Machinery': '⚙️',
    'Data Drives': '💾',
    'Gaming Laptop': '🎮',
    'Access Point': '📡',
    'Accessory': '⌨️',
    'Cable': '🔌',
    'Cables': '🔌',
    'Firewall': '🧱',
    'IT Assets': '💻'
};

async function fixIcons() {
    console.log('--- STARTING ICON REPAIR ---');
    try {
        // 1. Fix asset_kinds
        const kinds = await db('asset_kinds').select('name', 'icon');
        let fixedKinds = 0;
        for (const kind of kinds) {
            if (kind.icon && kind.icon.includes('?')) {
                const newIcon = iconMap[kind.name];
                if (newIcon) {
                    console.log(`Fixing Kind ${kind.name}: ${kind.icon} -> ${newIcon}`);
                    await db('asset_kinds').where('name', kind.name).update({ icon: newIcon });
                    fixedKinds++;
                } else {
                    await db('asset_kinds').where('name', kind.name).update({ icon: '📦' });
                    fixedKinds++;
                }
            }
        }

        // 2. Fix folders (IT Assets / Non-IT Assets)
        const folders = await db('folders').select('name', 'icon');
        let fixedFolders = 0;
        for (const folder of folders) {
            if (folder.icon && folder.icon.includes('?')) {
                const newIcon = iconMap[folder.name] || '📁';
                console.log(`Fixing Folder ${folder.name}: ${folder.icon} -> ${newIcon}`);
                await db('folders').where('name', folder.name).update({ icon: newIcon });
                fixedFolders++;
            }
        }

        console.log(`--- REPAIR COMPLETE: Fixed ${fixedKinds} kinds and ${fixedFolders} folders ---`);
    } catch (err) {
        console.error('Failed to fix icons:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

fixIcons();
