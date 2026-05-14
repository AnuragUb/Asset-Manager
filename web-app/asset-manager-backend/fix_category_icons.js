const { db } = require('./web-app/asset-manager-backend/utils');

const iconMap = {
    // SVGs
    'Hardware': '/static/icons/hardware.svg',
    'Networking': '/static/icons/Networking_HM.svg',
    'Server': '/static/icons/server.svg',
    'Laptop': '/static/icons/laptop.svg',
    'Desktop': '/static/icons/desktop.svg',
    'Monitor': '/static/icons/monitor.svg',
    'Camera': '/static/icons/camera.svg',
    'Switch': '/static/icons/switch.svg',
    'Software': '/static/icons/software.svg',
    
    // Emojis (Fallbacks)
    'Printer': '�️',
    'Router': '�',
    'NVR': '📹',
    'Phone': '📱',
    'Tablet': '📱',
    'Projector': '📽️',
    'Scanner': '📠',
    'UPS': '🔋',
    'Rack': '🗄️',
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
    console.log('--- STARTING ICON REPAIR (SVG VERSION) ---');
    try {
        // 1. Fix asset_kinds
        const kinds = await db('asset_kinds').select('name', 'icon');
        let fixedKinds = 0;
        for (const kind of kinds) {
            // Fix if it's question marks OR if it's an emoji that we now have an SVG for
            const shouldFix = (kind.icon && kind.icon.includes('?')) || 
                             (iconMap[kind.name] && iconMap[kind.name].endsWith('.svg') && !kind.icon.endsWith('.svg'));
            
            if (shouldFix) {
                const newIcon = iconMap[kind.name];
                if (newIcon) {
                    console.log(`Fixing Kind ${kind.name}: ${kind.icon} -> ${newIcon}`);
                    await db('asset_kinds').where('name', kind.name).update({ icon: newIcon });
                    fixedKinds++;
                } else {
                    // Only default to box if it's actually broken (question marks)
                    if (kind.icon && kind.icon.includes('?')) {
                        await db('asset_kinds').where('name', kind.name).update({ icon: '📦' });
                        fixedKinds++;
                    }
                }
            }
        }

        // 2. Fix folders
        const folders = await db('folders').select('id', 'name', 'icon');
        let fixedFolders = 0;
        for (const folder of folders) {
            // Use ID or Name for lookup
            const lookupName = folder.name || folder.id;
            const shouldFix = (folder.icon && folder.icon.includes('?')) || 
                             (iconMap[lookupName] && iconMap[lookupName].endsWith('.svg') && !folder.icon.endsWith('.svg'));

            if (shouldFix) {
                const newIcon = iconMap[lookupName] || iconMap[folder.id] || '📁';
                console.log(`Fixing Folder ${lookupName}: ${folder.icon} -> ${newIcon}`);
                await db('folders').where('id', folder.id).update({ icon: newIcon });
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
