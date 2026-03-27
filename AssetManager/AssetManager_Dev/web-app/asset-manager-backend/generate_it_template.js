
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const outputPath = path.join(__dirname, '../asset-manager-frontend/dist/static/IT_Asset_Import_Template.xlsx');

// 1. Define Headers and Instructions
const headers = [
    'Item Name', 'Category', 'Status', 'Make', 'Model', 'Serial No', 
    'Current Location', 'Purchase Date', 'Value', 'Warranty (Months)', 'Warranty Tracking Enabled', 'AMC', 'Employee ID', 'Parent ID',
    'MAC Address', 'IP Address', 'Network Type', 'Physical Port', 'VLAN', 'Socket ID', 'Network User ID',
    'Remarks'
];

const sampleRow = [
    'Dell Latitude 3420', 'Laptop', 'In Use', 'Dell', 'Latitude 3420', 'SN12345678', 
    'Mumbai Office', '2024-01-15', 45000, 36, 'Yes', '12', 'EMP001', '',
    '00:1A:2B:3C:4D:5E', '192.168.1.105', 'Ethernet', 'Switch-1/Port-5', '10', 'A-12', 'john.d',
    'Primary laptop'
];

// 2. Create Workbook and Sheets
const wb = XLSX.utils.book_new();

// -- Data Sheet --
const wsData = XLSX.utils.aoa_to_sheet([headers, sampleRow]);

// Set column widths
wsData['!cols'] = [
    { wch: 25 }, // Item Name
    { wch: 15 }, // Category
    { wch: 15 }, // Status
    { wch: 15 }, // Make
    { wch: 20 }, // Model
    { wch: 20 }, // Serial No
    { wch: 20 }, // Current Location
    { wch: 15 }, // Purchase Date
    { wch: 12 }, // Value
    { wch: 15 }, // Warranty
    { wch: 20 }, // Warranty Tracking
    { wch: 10 }, // AMC
    { wch: 20 }, // Employee ID
    { wch: 15 }, // Parent ID
    { wch: 20 }, // MAC Address
    { wch: 15 }, // IP Address
    { wch: 15 }, // Network Type
    { wch: 15 }, // Physical Port
    { wch: 10 }, // VLAN
    { wch: 15 }, // Socket ID
    { wch: 20 }, // Network User ID
    { wch: 30 }  // Remarks
];

XLSX.utils.book_append_sheet(wb, wsData, "IT Assets");

// -- Instructions Sheet --
const instructions = [
    ['Bulk Import Instructions (IT Assets)'],
    [''],
    ['1. Basic Asset Columns:'],
    ['   - Item Name: (Required) The name of the asset.'],
    ['   - Category: (Required) E.g., Laptop, Desktop, Printer.'],
    ['   - Status: E.g., In Use, In Store, Repair.'],
    ['   - Employee ID: Assigned user.'],
    [''],
    ['2. IT & Connectivity Columns:'],
    ['   - MAC Address: Physical address (e.g., 00:1A:2B:3C:4D:5E).'],
    ['   - IP Address: Assigned static or dynamic IP.'],
    ['   - Network Type: Ethernet, WiFi, Fiber.'],
    ['   - Physical Port: Switch port or patch panel connection.'],
    ['   - VLAN: Network segment ID.'],
    ['   - Socket ID: Wall socket identifier.'],
    ['   - Network User ID: System login ID or AD username.'],
    [''],
    ['3. Tips:'],
    ['   - Do not change the header row.'],
    ['   - Ensure MAC addresses are formatted correctly.']
];

const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
wsInstructions['!cols'] = [{ wch: 80 }];
XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");

// 3. Write File
try {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    XLSX.writeFile(wb, outputPath);
    console.log(`IT Template generated successfully at: ${outputPath}`);
} catch (err) {
    console.error('Error generating template:', err);
}
