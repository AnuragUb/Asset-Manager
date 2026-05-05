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
        const kinds = await db('asset_kinds').select('name', 'icon');
        let fixedCount = 0;

        for (const kind of kinds) {
            // Only fix if it contains question marks
            if (kind.icon && kind.icon.includes('?')) {
                const newIcon = iconMap[kind.name];
                if (newIcon) {
                    console.log(`Fixing ${kind.name}: ${kind.icon} -> ${newIcon}`);
                    await db('asset_kinds')
                        .where('name', kind.name)
                        .update({ icon: newIcon });
                    fixedCount++;
                } else {
                    console.warn(`No replacement icon found for: ${kind.name}`);
                    // Default to a generic box if we don't know the category
                    await db('asset_kinds')
                        .where('name', kind.name)
                        .update({ icon: '📦' });
                    fixedCount++;
                }
            }
        }

        console.log(`--- REPAIR COMPLETE: Fixed ${fixedCount} categories ---`);
    } catch (err) {
        console.error('Failed to fix icons:', err);
    } finally {
        await db.destroy();
        process.exit(0);
    }
}

fixIcons();
