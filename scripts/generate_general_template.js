
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const outputPath = path.join(__dirname, '../asset-manager-frontend/static/Asset_Import_Template.xlsx');

// 1. Define Headers and Instructions
const headers = [
    'Item Name', 'Category', 'Status', 'Make', 'Model', 'Serial No', 
    'Current Location', 'Purchase Date', 'Value', 'Warranty (Months)', 'Warranty Tracking Enabled', 'AMC', 'Employee ID', 'Parent ID',
    'Remarks'
];

const sampleRow = [
    'Camera Sony A7R', 'Camera', 'In Use', 'Sony', 'A7R V', 'SN987654321', 
    'Delhi Studio', '2024-02-10', 250000, 24, 'Yes', '12', 'EMP005', '',
    'Main studio camera'
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
    ['Bulk Import Instructions (General Assets)'],
    [''],
    ['1. Basic Asset Columns:'],
    ['   - Item Name: (Required) The name of the asset.'],
    ['   - Category: (Required) E.g., Camera, Lens, Furniture.'],
    ['   - Status: E.g., In Use, In Store, Repair.'],
    ['   - Employee ID: Assigned user.'],
    [''],
    ['2. Tips:'],
    ['   - Do not change the header row.'],
    ['   - Ensure dates are in YYYY-MM-DD format.']
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
    console.log(`General Template generated successfully at: ${outputPath}`);
} catch (err) {
    console.error('Error generating template:', err);
}
