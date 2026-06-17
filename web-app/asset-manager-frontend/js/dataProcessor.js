/**
 * dataProcessor.js
 * Handles fuzzy column mapping and data transformation for bulk imports
 * Version: 4.1 (Added Employee Support & Static Methods)
 */

export class DataProcessor {
    static get DB_COLUMNS() {
        return {
            'ItemName': { label: 'Item Name', synonyms: ['asset name', 'item', 'name', 'asset'] },
            'ItemDescription': { label: 'Item Description', synonyms: ['description', 'desc', 'details'] },
            'Make': { label: 'Manufacturer/Make', synonyms: ['make', 'manufacturer', 'brand', 'mfr'] },
            'Model': { label: 'Model', synonyms: ['model', 'model no', 'model number'] },
            'SrNo': { label: 'Serial Number', synonyms: ['serial', 'srno', 's/n', 'sn', 'serial no'] },
            'Status': { label: 'Status', synonyms: ['status', 'state', 'condition'] },
            'Category': { label: 'Category', synonyms: ['category', 'group', 'cat'] },
            'asset_value': { label: 'Asset Value', synonyms: ['value', 'price', 'cost', 'amount', 'asset value'] },
            'Currency': { label: 'Currency', synonyms: ['currency', 'curr'] },
            'CurrentLocation': { label: 'Location', synonyms: ['location', 'site', 'place'] },
            'AssignedTo': { label: 'Assigned To', synonyms: ['assigned', 'user', 'owner', 'employee'] },
            'PurchaseDate': { label: 'Purchase Date', synonyms: ['purchase date', 'date of purchase', 'bought on'] },
            'PurchaseDetails': { label: 'Purchase Details', synonyms: ['purchase details', 'vendor', 'supplier'] },
            'itemHsnCode': { label: 'HSN / SAC Code', synonyms: ['hsn', 'sac', 'tax code', 'hsn code', 'sac code'] },
            'Remarks': { label: 'Remarks', synonyms: ['remarks', 'notes', 'comment'] },
            'Weight': { label: 'Weight (kg)', synonyms: ['weight', 'kg', 'kilograms', 'mass'] },
            'warranty_months': { label: 'Warranty (Months)', synonyms: ['warranty', 'warranty months'] },
            'amc_months': { label: 'AMC (Months)', synonyms: ['amc', 'amc months'] },
            'MACAddress': { label: 'MAC Address', synonyms: ['mac', 'physical address', 'ethernet'] },
            'IPAddress': { label: 'IP Address', synonyms: ['ip', 'network address'] },
            'itemFolder': { label: 'Parent Folder', synonyms: ['folder', 'parent folder', 'main category', 'grandparent'] },
            'itemBrandCategory': { label: 'Make Category (Brand)', synonyms: ['make category', 'brand category', 'sub-kind'] },
            'Type': { label: 'Asset Type / Kind', synonyms: ['type', 'kind', 'class'] },
            'ParentId': { label: 'Parent Asset ID', synonyms: ['parent id', 'parentid', 'linked to', 'member of'] },
            'ParentGroup': { label: 'Temporary Group Name (for Sets)', synonyms: ['group name', 'batch name', 'kit name', 'set name', 'parent group'] }
        };
    }

    static get EMP_COLUMNS() {
        return {
            'EmployeeID': { label: 'Employee ID', synonyms: ['emp id', 'employee id', 'id', 'code', 'emp code'] },
            'Name': { label: 'Full Name', synonyms: ['name', 'employee name', 'full name', 'emp name'] },
            'Department': { label: 'Department', synonyms: ['dept', 'department', 'unit', 'team'] },
            'Designation': { label: 'Designation', synonyms: ['designation', 'role', 'position', 'title'] },
            'Email': { label: 'Email Address', synonyms: ['email', 'e-mail', 'mail'] },
            'Phone': { label: 'Phone Number', synonyms: ['phone', 'mobile', 'contact', 'tel'] },
            'Status': { label: 'Status', synonyms: ['status', 'state', 'employment status'] }
        };
    }

    static analyzeMapping(rows, type = 'asset') {
        if (!rows || rows.length === 0) return [];
        const headers = rows[0];
        const sampleRow = rows[1] || [];
        const config = type === 'employee' ? this.EMP_COLUMNS : this.DB_COLUMNS;

        return headers.map((header, index) => {
            const normalized = header.toString().toLowerCase().trim();
            let suggestedColumn = 'skip';

            for (const [colId, colInfo] of Object.entries(config)) {
                if (colInfo.synonyms.some(s => normalized.includes(s) || s.includes(normalized))) {
                    suggestedColumn = colId;
                    break;
                }
            }

            return {
                index,
                header,
                sampleValue: sampleRow[index] || '',
                suggestedColumn
            };
        });
    }

    static processWithMapping(rows, userMapping, kind, category, type = 'asset') {
        const dataRows = rows.slice(1);
        const results = [];

        dataRows.forEach(row => {
            const obj = {};
            let hasData = false;

            for (const [colIndex, targetField] of Object.entries(userMapping)) {
                if (targetField !== 'skip') {
                    const val = row[colIndex];
                    if (val !== undefined && val !== null && val !== '') {
                        // Keep raw values for special fields like dates, let backend normalize
                        if (targetField === 'PurchaseDate') {
                            obj[targetField] = val;
                        } else {
                            obj[targetField] = val.toString().trim();
                        }
                        hasData = true;
                    }
                }
            }

            if (hasData) {
                if (type === 'asset') {
                    // Default asset fields
                    if (!obj.ItemName && obj.Name) obj.ItemName = obj.Name;
                    
                    // Normalize Category and Type logic
                    // If the user mapped a column to 'Category' but it contains a specific type (e.g. 'Laptop'),
                    // we should set Category to 'IT' (or current context) and Type to that value.
                    // This prevents assets from disappearing from the main views.
                    
                    const rawCategory = obj.Category || '';
                    const knownTypes = ['server', 'workstation', 'laptop', 'desktop', 'monitor', 'printer', 'scanner', 'broadcast monitor', 'camera', 'lens', 'tripod', 'audio'];
                    
                    if (rawCategory && knownTypes.includes(rawCategory.toLowerCase())) {
                        obj.Type = obj.Category; // Move specific value to Type
                        obj.Category = category || 'IT'; // Force generic Category
                    } else {
                        obj.Category = obj.Category || category || 'IT';
                    }

                    obj.Type = obj.Type || kind || 'AST';
                    obj.Status = obj.Status || 'In Store';
                } else if (type === 'employee') {
                    obj.Status = obj.Status || 'ACTIVE';
                }
                results.push(obj);
            }
        });

        return results;
    }
}
