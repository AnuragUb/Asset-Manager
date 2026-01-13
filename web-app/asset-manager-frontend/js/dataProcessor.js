/**
 * dataProcessor.js
 * Handles fuzzy column mapping and data transformation for bulk imports
 * Version: 4.1 (Added Employee Support & Static Methods)
 */

export class DataProcessor {
    static get DB_COLUMNS() {
        return {
            'ItemName': { label: 'Item Name', synonyms: ['asset name', 'item', 'description', 'name', 'asset'] },
            'Make': { label: 'Manufacturer/Make', synonyms: ['make', 'manufacturer', 'brand', 'mfr'] },
            'Model': { label: 'Model', synonyms: ['model', 'model no', 'model number'] },
            'SrNo': { label: 'Serial Number', synonyms: ['serial', 'srno', 's/n', 'sn', 'serial no'] },
            'Status': { label: 'Status', synonyms: ['status', 'state', 'condition'] },
            'CurrentLocation': { label: 'Location', synonyms: ['location', 'site', 'place'] },
            'AssignedTo': { label: 'Assigned To', synonyms: ['assigned', 'user', 'owner', 'employee'] },
            'MACAddress': { label: 'MAC Address', synonyms: ['mac', 'physical address', 'ethernet'] },
            'IPAddress': { label: 'IP Address', synonyms: ['ip', 'network address'] },
            'Type': { label: 'Asset Type', synonyms: ['type', 'kind', 'class'] }
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
                        obj[targetField] = val.toString().trim();
                        hasData = true;
                    }
                }
            }

            if (hasData) {
                if (type === 'asset') {
                    // Default asset fields
                    if (!obj.ItemName && obj.Name) obj.ItemName = obj.Name;
                    obj.Type = obj.Type || kind || 'AST';
                    obj.Category = obj.Category || category || 'IT';
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
