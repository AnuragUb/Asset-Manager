-- Repair corrupted icons in asset_manager database
-- Created: 2026-05-21

-- 1. Repair Folders
UPDATE folders SET icon = '💻' WHERE name = 'IT Assets' AND icon LIKE '%?%';
UPDATE folders SET icon = '📦' WHERE name = 'Non-IT Assets' AND icon LIKE '%?%';
UPDATE folders SET icon = '📂' WHERE icon LIKE '%?%'; -- Fallback for any other corrupted folder icons

-- 2. Repair Asset Kinds (Categories)
UPDATE asset_kinds SET icon = '/static/icons/laptop.svg' WHERE name IN ('Laptop', 'Apple', 'Gaming Laptop') AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '/static/icons/desktop.svg' WHERE name IN ('Desktop', 'Desktops', 'Konvision') AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '/static/icons/monitor.svg' WHERE name = 'Monitor' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '/static/icons/server.svg' WHERE name = 'Server' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '/static/icons/switch.svg' WHERE name = 'Switch' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '/static/icons/camera.svg' WHERE name = 'Camera' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '⌨️' WHERE name = 'Keyboard' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '🖱️' WHERE name = 'Mouse' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '🔑' WHERE name = 'License' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '📶' WHERE name = 'Router' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '🎧' WHERE name = 'Audio Equipments' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '🔍' WHERE name = 'Cinema Lens' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '🧩' WHERE name = 'Component' AND icon LIKE '%?%';
UPDATE asset_kinds SET icon = '📦' WHERE name IN ('Printer', 'Scanner', 'Printer & Scanner', 'Mobile Phones', 'Phone', 'Tablet', 'Projector', 'UPS', 'Rack', 'Software', 'Furniture', 'Vehicle', 'Machinery', 'Data Drives', 'Access Point', 'Accessory', 'Cable', 'Cables', 'Firewall') AND icon LIKE '%?%';

-- Fallback for any remaining corrupted icons
UPDATE asset_kinds SET icon = '📦' WHERE icon LIKE '%?%';
