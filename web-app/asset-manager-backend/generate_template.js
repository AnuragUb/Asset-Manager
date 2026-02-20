const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const outputPath = path.join(__dirname, '../asset-manager-frontend/dist/static/Asset_Import_Template.xlsx');

// 1. Define Headers and Instructions
const headers = [
    'Item Name', 'Category', 'Status', 'Make', 'Model', 'Serial No', 
    'Current Location', 'Purchase Date', 'Value', 'Warranty (Months)', 'Warranty Tracking Enabled', 'AMC', 'Employee ID', 'Parent ID', 'Remarks'
];

const sampleRow = [
    'Dell Latitude 3420', 'Laptop', 'In Use', 'Dell', 'Latitude 3420', 'SN12345678', 
    'Mumbai Office', '2024-01-15', 45000, 36, 'Yes', '12', 'EMP001', '', 'Primary laptop'
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
    { wch: 30 }  // Remarks
];

XLSX.utils.book_append_sheet(wb, wsData, "Assets");

// -- Instructions Sheet --
const instructions = [
    ['Bulk Import Instructions'],
    [''],
    ['1. Column Descriptions:'],
    ['   - Item Name: (Required) The name of the asset.'],
    ['   - Category: (Required) E.g., Laptop, Desktop, Printer. Must match system categories.'],
    ['   - Status: E.g., In Use, In Store, Repair, Scrap.'],
    ['   - Current Location: The physical location of the asset.'],
    ['   - Purchase Date: Format YYYY-MM-DD or DD-MM-YYYY.'],
    ['   - Value: Numeric value only.'],
    ['   - Warranty (Months): Number of months (e.g., 12, 24, 36).'],
    ['   - Warranty Tracking Enabled: "Yes" or "No".'],
    ['   - AMC: Number of months (e.g., 12) or "Yes" (defaults to 12).'],
    ['   - Employee ID: ID of the employee assigned to this asset.'],
    ['   - Parent ID: ID of the parent asset if this is a component.'],
    ['   - Remarks: Any additional notes.'],
    [''],
    ['2. Tips:'],
    ['   - Do not change the header row (Row 1).'],
    ['   - You can delete the sample row (Row 2) before uploading.'],
    ['   - Ensure dates are formatted correctly to avoid errors.']
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
    console.log(`Template generated successfully at: ${outputPath}`);
} catch (err) {
    console.error('Error generating template:', err);
}
