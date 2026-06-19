// Employees management module
import { showView, TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator, showToast, canViewPrice } from './utils.js?v=6.41';
import { DataProcessor } from './dataProcessor.js?v=6.41';

let employeeTable = null;

export function initEmployeeView() {
    console.log('initEmployeeView() called');
    window.editEmployee = editEmployee; // Expose globally
    window.switchEmployeeTab = switchEmployeeTab; // Expose globally
    const btnAddEmployee = document.getElementById('btnAddEmployee');
    const btnBulkAssign = document.getElementById('btnBulkAssign');
    const btnDeptQuotas = document.getElementById('btnDeptQuotas');
    const btnBulkUpload = document.getElementById('btnBulkUploadEmployees');
    const employeeBulkInput = document.getElementById('employeeBulkInput');
    const employeeModal = document.getElementById('employeeModal');
    const employeeForm = document.getElementById('employeeForm');
    const btnCancelEmployee = document.getElementById('btnCancelEmployee');
    const closeEmployeeModal = document.getElementById('closeEmployeeModal');
    const employeeSearch = document.getElementById('employeeSearch');
    const deptFilter = document.getElementById('deptFilter');

    if (btnAddEmployee) {
        btnAddEmployee.onclick = () => {
            document.getElementById('employeeModalTitle').textContent = 'Add New Employee';
            employeeForm.reset();
            document.getElementById('employeeDbId').value = '';
            document.getElementById('employeeAssetsSection').style.display = 'none';
            document.getElementById('employeeHistorySection').style.display = 'none';
            // Hide tabs for new employee
            const tabsDiv = document.querySelector('#employeeModal .tabs');
            if (tabsDiv) tabsDiv.style.display = 'none';
            employeeModal.style.display = 'flex';
        };
    }

    if (btnBulkAssign) {
        btnBulkAssign.onclick = () => {
            initBulkAssignment();
            document.getElementById('bulkAssignmentModal').style.display = 'flex';
        };
    }

    if (btnDeptQuotas) {
        btnDeptQuotas.onclick = () => {
            initDeptQuotas();
            document.getElementById('deptQuotasModal').style.display = 'flex';
        };
    }

    if (btnBulkUpload && employeeBulkInput) {
        btnBulkUpload.onclick = () => employeeBulkInput.click();
        employeeBulkInput.onchange = (e) => handleBulkUpload(e);
    }

    if (btnCancelEmployee) {
        btnCancelEmployee.onclick = () => {
            employeeModal.style.display = 'none';
        };
    }

    if (closeEmployeeModal) {
        closeEmployeeModal.onclick = () => {
            employeeModal.style.display = 'none';
        };
    }

    if (employeeSearch) {
        employeeSearch.oninput = () => renderEmployeeCards();
    }

    if (deptFilter) {
        deptFilter.onchange = () => renderEmployeeCards();
    }

    // Quick Return Button
    const btnQuickReturn = document.getElementById('btnQuickReturn');
    if (btnQuickReturn) {
        btnQuickReturn.onclick = async () => {
            const empName = document.getElementById('empName').value;
            const empId = document.getElementById('employeeDbId').value;
            if (!empName) return;

            if (confirm(`Are you sure you want to return all assets from ${empName}? This will set their status to "In Store".`)) {
                try {
                    const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === empName);
                    for (const asset of assignedAssets) {
                        const updatedAsset = { ...asset, AssignedTo: '', Status: 'In Store' };
                        await fetch(`/api/assets/${asset.ID}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updatedAsset)
                        });
                    }
                    alert('All assets returned successfully.');
                    // Refresh assets and employee view
                    if (window.loadAssets) await window.loadAssets();
                    const emp = window.allEmployees.find(e => e.ID === empId);
                    if (emp) editEmployee(emp);
                    loadEmployees();
                } catch (err) {
                    console.error('Quick return error:', err);
                    alert('Failed to return some assets.');
                }
            }
        };
    }

    // Digital Handover Button
    const btnDigitalHandover = document.getElementById('btnDigitalHandover');
    if (btnDigitalHandover) {
        btnDigitalHandover.onclick = () => {
            const empName = document.getElementById('empName').value;
            const empId = document.getElementById('empId').value;
            const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === empName);
            
            if (assignedAssets.length === 0) {
                alert('No assets assigned to this employee.');
                return;
            }

            generateHandoverPDF(empName, empId, assignedAssets);
        };
    }

    // Asset Assignment Note Button
    const btnAssignmentNote = document.getElementById('btnAssignmentNote');
    if (btnAssignmentNote) {
        btnAssignmentNote.onclick = () => {
            const empName = document.getElementById('empName').value;
            const empId = document.getElementById('empId').value;
            const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === empName);
            
            if (assignedAssets.length === 0) {
                alert('No assets assigned to this employee.');
                return;
            }

            generateAssignmentPDF(empName, empId, assignedAssets);
        };
    }

    if (employeeForm) {
        employeeForm.onsubmit = async (e) => {
            e.preventDefault();
            const dbId = document.getElementById('employeeDbId').value;
            const employeeData = {
                EmployeeID: document.getElementById('empId').value,
                Name: document.getElementById('empName').value,
                Department: document.getElementById('empDept').value,
                Designation: document.getElementById('empDesignation').value,
                Email: document.getElementById('empEmail').value,
                Phone: document.getElementById('empPhone').value,
                Status: document.getElementById('empStatus').value
            };

            try {
                const method = dbId ? 'PUT' : 'POST';
                const url = dbId ? `/api/employees/${dbId}` : '/api/employees';
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(employeeData)
                });

                if (response.ok) {
                    employeeModal.style.display = 'none';
                    loadEmployees();
                } else {
                    const err = await response.text();
                    alert('Error saving employee: ' + err);
                }
            } catch (err) {
                console.error('Failed to save employee:', err);
                alert('Failed to save employee');
            }
        };
    }

    loadEmployees();
}

let selectedBulkAssets = [];

function initBulkAssignment() {
    const empSelect = document.getElementById('bulkAssignEmployee');
    const assetList = document.getElementById('bulkAssignList');
    const assetInput = document.getElementById('bulkAssignAssetInput');
    const btnAdd = document.getElementById('btnAddAssetToBulk');
    const btnConfirm = document.getElementById('btnConfirmBulkAssign');

    selectedBulkAssets = [];
    assetList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No assets added yet.</div>';
    assetInput.value = '';

    // Populate employee dropdown
    empSelect.innerHTML = '<option value="">-- Choose Employee --</option>' + 
        window.allEmployees.map(emp => `<option value="${emp.Name}">${emp.Name} (${emp.EmployeeID})</option>`).join('');

    btnAdd.onclick = () => {
        const id = assetInput.value.trim();
        if (!id) return;
        
        const asset = (window.allAssets || []).find(a => a.ID === id || a.SrNo === id);
        if (!asset) {
            alert('Asset not found in database.');
            return;
        }

        if (selectedBulkAssets.find(a => a.ID === asset.ID)) {
            alert('Asset already in list.');
            return;
        }

        selectedBulkAssets.push(asset);
        renderBulkAssignList();
        assetInput.value = '';
        assetInput.focus();
    };

    assetInput.onkeypress = (e) => {
        if (e.key === 'Enter') btnAdd.click();
    };

    btnConfirm.onclick = async () => {
        const empName = empSelect.value;
        if (!empName) {
            alert('Please select an employee.');
            return;
        }

        if (selectedBulkAssets.length === 0) {
            alert('Please add at least one asset.');
            return;
        }

        if (confirm(`Assign ${selectedBulkAssets.length} assets to ${empName}?`)) {
            try {
                for (const asset of selectedBulkAssets) {
                    const updated = { ...asset, AssignedTo: empName, Status: 'Assigned' };
                    await fetch(`/api/assets/${asset.ID}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated)
                    });
                }
                alert('Bulk assignment completed successfully.');
                document.getElementById('bulkAssignmentModal').style.display = 'none';
                if (window.loadAssets) await window.loadAssets();
                renderEmployeeCards();
            } catch (err) {
                console.error('Bulk assign error:', err);
                alert('An error occurred during bulk assignment.');
            }
        }
    };
}

let currentDept = null;
let allQuotas = [];

async function initDeptQuotas() {
    const deptList = document.getElementById('deptList');
    const response = await fetch('/api/quotas');
    allQuotas = await response.json();

    const depts = [...new Set(window.allEmployees.map(e => e.Department).filter(Boolean))];
    
    deptList.innerHTML = depts.map(d => `
        <div class="dept-item" onclick="window.selectDeptForQuota('${d}')" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; transition: background 0.2s;">
            ${d}
        </div>
    `).join('');

    window.selectDeptForQuota = (dept) => {
        currentDept = dept;
        document.getElementById('noDeptSelected').style.display = 'none';
        document.getElementById('deptQuotaDetails').style.display = 'block';
        document.getElementById('selectedDeptName').textContent = dept;
        
        // Highlight selected
        const items = document.querySelectorAll('.dept-item');
        items.forEach(i => i.style.background = i.textContent.trim() === dept ? '#e6f7ff' : 'transparent');

        renderQuotasForDept(dept);
        renderUtilization(dept);
    };

    const btnAddRow = document.getElementById('btnAddQuotaRow');
    btnAddRow.onclick = () => {
        const grid = document.getElementById('quotaGrid');
        const row = document.createElement('div');
        row.style.display = 'contents';
        row.innerHTML = `
            <input type="text" class="quota-cat form-input" placeholder="e.g. Laptop" style="padding: 5px;">
            <input type="number" class="quota-val form-input" placeholder="Qty" style="padding: 5px;">
        `;
        grid.appendChild(row);
    };

    const btnSave = document.getElementById('btnSaveDeptQuotas');
    btnSave.onclick = async () => {
        if (!currentDept) return;
        const grid = document.getElementById('quotaGrid');
        const cats = grid.querySelectorAll('.quota-cat');
        const vals = grid.querySelectorAll('.quota-val');
        
        try {
            for (let i = 0; i < cats.length; i++) {
                const category = cats[i].value.trim();
                const quota = parseInt(vals[i].value);
                if (category && !isNaN(quota)) {
                    await fetch('/api/quotas', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ department: currentDept, category, quota })
                    });
                }
            }
            alert('Quotas saved successfully.');
            initDeptQuotas(); // Refresh
        } catch (err) {
            alert('Error saving quotas.');
        }
    };
}

function renderQuotasForDept(dept) {
    const grid = document.getElementById('quotaGrid');
    const deptQuotas = allQuotas.filter(q => q.Department === dept);
    
    if (deptQuotas.length === 0) {
        grid.innerHTML = `
            <input type="text" class="quota-cat form-input" placeholder="e.g. Laptop" style="padding: 5px;">
            <input type="number" class="quota-val form-input" placeholder="Qty" style="padding: 5px;">
        `;
        return;
    }

    grid.innerHTML = deptQuotas.map(q => `
        <input type="text" class="quota-cat form-input" value="${q.Category}" style="padding: 5px;">
        <input type="number" class="quota-val form-input" value="${q.Quota}" style="padding: 5px;">
    `).join('');
}

function renderUtilization(dept) {
    const utilDiv = document.getElementById('deptUtilization');
    const deptEmps = window.allEmployees.filter(e => e.Department === dept);
    const empNames = deptEmps.map(e => e.Name);
    const deptAssets = (window.allAssets || []).filter(a => empNames.includes(a.AssignedTo));
    
    const stats = {};
    deptAssets.forEach(a => {
        const cat = a.Category || 'Other';
        stats[cat] = (stats[cat] || 0) + 1;
    });

    const deptQuotas = allQuotas.filter(q => q.Department === dept);
    
    let html = '<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-weight: 600; border-bottom: 2px solid #eee; padding-bottom: 5px; margin-bottom: 10px;">';
    html += '<div>Category</div><div>Used</div><div>Quota</div></div>';

    // Show categories with quotas
    deptQuotas.forEach(q => {
        const used = stats[q.Category] || 0;
        const color = used > q.Quota ? '#f5222d' : (used === q.Quota ? '#faad14' : '#52c41a');
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
            <div>${q.Category}</div>
            <div style="color: ${color}; font-weight: 600;">${used}</div>
            <div>${q.Quota}</div>
        </div>`;
        delete stats[q.Category];
    });

    // Show categories without quotas
    Object.keys(stats).forEach(cat => {
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px solid #f0f0f0; color: #999;">
            <div>${cat}</div>
            <div>${stats[cat]}</div>
            <div>--</div>
        </div>`;
    });

    utilDiv.innerHTML = html;
}

function renderBulkAssignList() {
    const list = document.getElementById('bulkAssignList');
    if (selectedBulkAssets.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No assets added yet.</div>';
        return;
    }

    list.innerHTML = selectedBulkAssets.map(a => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #eee; font-size: 0.9em;">
            <div>
                <strong>${a.ID}</strong> - ${a.ItemName}<br>
                <span style="font-size: 0.8em; color: #666;">${a.Make} ${a.Model}</span>
            </div>
            <button onclick="window.removeAssetFromBulk('${a.ID}')" style="background: none; border: none; color: #f5222d; cursor: pointer; font-size: 1.2em;">&times;</button>
        </div>
    `).join('');
    
    window.removeAssetFromBulk = (id) => {
        selectedBulkAssets = selectedBulkAssets.filter(a => a.ID !== id);
        renderBulkAssignList();
    };
}

export async function loadEmployees() {
    try {
        const response = await fetch('/api/employees');
        let employees = await response.json();
        
        // Handle paginated response or wrapped data
        if (employees && !Array.isArray(employees)) {
            if (Array.isArray(employees.data)) {
                employees = employees.data;
            } else {
                console.warn('Expected array of employees but got:', typeof employees);
                employees = [];
            }
        }
        
        window.allEmployees = employees || []; // Store globally for reference

        // Update department filter
        const deptFilter = document.getElementById('deptFilter');
        if (deptFilter) {
            const depts = [...new Set(window.allEmployees.map(e => e.Department).filter(d => d))].sort();
            const currentVal = deptFilter.value;
            deptFilter.innerHTML = '<option value="all">All Departments</option>' + 
                depts.map(d => `<option value="${d}">${d}</option>`).join('');
            deptFilter.value = currentVal;
        }

        renderEmployeeCards();
    } catch (err) {
        console.error('Failed to load employees:', err);
        window.allEmployees = []; // Fallback
    }
}

export function renderEmployeeCards() {
    const container = document.getElementById('employee-cards-container');
    if (!container) return;

    const searchTerm = document.getElementById('employeeSearch')?.value.toLowerCase() || '';
    const deptTerm = document.getElementById('deptFilter')?.value || 'all';

    const filtered = window.allEmployees.filter(emp => {
        const nameParts = emp.Name.toLowerCase().split(' ');
        // Check if any part of the name STARTS with the search term
        const matchesName = nameParts.some(part => part.startsWith(searchTerm));
        
        // OR matches ID (contains is fine for ID) OR matches Department (contains is fine)
        const matchesOther = emp.EmployeeID.toLowerCase().includes(searchTerm) ||
                             (emp.Department || '').toLowerCase().includes(searchTerm);
        
        const matchesSearch = matchesName || matchesOther;
        const matchesDept = deptTerm === 'all' || emp.Department === deptTerm;
        return matchesSearch && matchesDept;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 100px; color: #999;">No employees found matching your criteria.</div>';
        return;
    }

    container.innerHTML = filtered.map(emp => {
        const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === emp.Name);
        const totalValue = assignedAssets.reduce((sum, a) => sum + (parseFloat(a.Value) || 0), 0);
        const assetCount = assignedAssets.length;

        return `
            <div class="employee-card" data-id="${emp.ID}">
                <div class="employee-badge ${emp.Status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}">${emp.Status}</div>
                <div class="employee-card-header">
                    <div class="employee-photo">
                        ${emp.Photo ? `<img src="${emp.Photo}" alt="${emp.Name}">` : emp.Name.charAt(0)}
                    </div>
                    <div class="employee-info">
                        <h3 class="employee-name">${emp.Name}</h3>
                        <p class="employee-designation">${emp.Designation || 'N/A'}</p>
                        <p style="font-size: 11px; color: #999;">${emp.EmployeeID} • ${emp.Department || 'No Dept'}</p>
                    </div>
                </div>
                <div class="employee-stats">
                    <div class="stat-item">
                        <span class="stat-label">Assets</span>
                        <span class="stat-value">${assetCount}</span>
                    </div>
                    <div class="stat-item" style="${canViewPrice() ? '' : 'display: none;'}">
                        <span class="stat-label">Total Value</span>
                        <span class="stat-value">₹${totalValue.toLocaleString()}</span>
                    </div>
                </div>
                <div class="employee-card-actions">
                    <button class="btn-view-emp" onclick="window.editEmployee(${JSON.stringify(emp).replace(/"/g, '&quot;')})">View & Manage</button>
                    <button class="btn-edit-emp" onclick="window.deleteEmployee('${emp.ID}')" style="background: #fff1f0; color: #f5222d; border-color: #ffa39e !important;">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function generateHandoverPDF(empName, empId, assets) {
    // Simple printable window approach for now as we don't have jsPDF on frontend
    const printWindow = window.open('', '_blank');
    const date = new Date().toLocaleDateString();
    
    printWindow.document.write(`
        <html>
        <head>
            <title>Handover Note - ${empName}</title>
            <style>
                body { font-family: sans-serif; padding: 40px; color: #333; line-height: 1.6; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
                .details { margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background: #f8f9fa; }
                .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 50px 100px; margin-top: 80px; }
                .sig-box { border-top: 1px solid #333; text-align: center; padding-top: 10px; font-weight: bold; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px;">
                <button onclick="window.print()">Print Handover Note</button>
            </div>
            <div class="header">
                <h1>ASSET HANDOVER NOTE</h1>
                <p>Cineom IT Asset Management System</p>
            </div>
            <div class="details">
                <div>
                    <strong>Employee Name:</strong> ${empName}<br>
                    <strong>Employee ID:</strong> ${empId}
                </div>
                <div style="text-align: right;">
                    <strong>Date:</strong> ${date}
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Asset ID</th>
                        <th>Item Name</th>
                        <th>Category</th>
                        <th>Serial No</th>
                    </tr>
                </thead>
                <tbody>
                    ${assets.map(a => `
                        <tr>
                            <td>${a.ID}</td>
                            <td>${a.ItemName}</td>
                            <td>${a.Kind}</td>
                            <td>${a.SerialNo || 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p>I hereby acknowledge that I am returning the above listed assets in the condition specified. I confirm that all personal data has been removed and company data remains intact as per policy.</p>
            
            <div class="signatures">
                <div class="sig-box">Employee Signature</div>
                <div class="sig-box">Manager Signature</div>
                <div class="sig-box">HR Signature</div>
                <div class="sig-box">IT Signature</div>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function generateAssignmentPDF(empName, empId, assets) {
    const printWindow = window.open('', '_blank');
    const date = new Date().toLocaleDateString();
    
    printWindow.document.write(`
        <html>
        <head>
            <title>Asset Assignment Note - ${empName}</title>
            <style>
                body { font-family: sans-serif; padding: 40px; color: #333; line-height: 1.6; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
                .details { margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background: #f8f9fa; }
                .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 50px 100px; margin-top: 80px; }
                .sig-box { border-top: 1px solid #333; text-align: center; padding-top: 10px; font-weight: bold; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px;">
                <button onclick="window.print()">Print Assignment Note</button>
            </div>
            <div class="header">
                <h1>ASSET ASSIGNMENT NOTE</h1>
                <p>Cineom IT Asset Management System</p>
            </div>
            <div class="details">
                <div>
                    <strong>Employee Name:</strong> ${empName}<br>
                    <strong>Employee ID:</strong> ${empId}
                </div>
                <div style="text-align: right;">
                    <strong>Date:</strong> ${date}
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Asset ID</th>
                        <th>Item Name</th>
                        <th>Category</th>
                        <th>Serial No</th>
                    </tr>
                </thead>
                <tbody>
                    ${assets.map(a => `
                        <tr>
                            <td>${a.ID}</td>
                            <td>${a.ItemName}</td>
                            <td>${a.Kind}</td>
                            <td>${a.SerialNo || 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p>I hereby acknowledge receipt of the above listed assets in good working condition. I understand that I am responsible for the safekeeping of these assets and will return them upon offboarding or request.</p>
            
            <div class="signatures">
                <div class="sig-box">Employee Signature</div>
                <div class="sig-box">Manager Signature</div>
                <div class="sig-box">HR Signature</div>
                <div class="sig-box">IT Signature</div>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
}

export function editEmployee(emp) {
    window.editEmployee = editEmployee; // Make it globally accessible for cross-view navigation
    document.getElementById('employeeModalTitle').textContent = 'Edit Employee';
    document.getElementById('employeeDbId').value = emp.ID;
    document.getElementById('empId').value = emp.EmployeeID;
    document.getElementById('empName').value = emp.Name;
    document.getElementById('empDept').value = emp.Department;
    document.getElementById('empDesignation').value = emp.Designation;
    document.getElementById('empEmail').value = emp.Email;
    document.getElementById('empPhone').value = emp.Phone;
    document.getElementById('empStatus').value = emp.Status;
    
    // Show tabs for existing employee
    const tabsDiv = document.querySelector('#employeeModal .tabs');
    if (tabsDiv) tabsDiv.style.display = 'flex';
    
    // Reset tabs
    switchEmployeeTab('assets');
    
    // Show assigned assets
    const assetsSection = document.getElementById('employeeAssetsSection');
    const assetsBody = document.getElementById('employeeAssetsBody');
    if (assetsSection && assetsBody) {
        assetsSection.style.display = 'block';
        const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === emp.Name);
        
        if (assignedAssets.length > 0) {
            assetsBody.innerHTML = assignedAssets.map(a => `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.ID}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.ItemName}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><span class="status-badge ${a.Status.toLowerCase().replace(' ', '-')}">${a.Status}</span></td>
                </tr>
            `).join('');
        } else {
            assetsBody.innerHTML = '<tr><td colspan="3" style="padding: 15px; text-align: center; color: #999;">No assets assigned to this employee.</td></tr>';
        }
    }
    
    // Load history and tree in background
    loadEmployeeHistory(emp.Name);
    renderEmployeeTree(emp.Name);
    
    document.getElementById('employeeModal').style.display = 'flex';
}

export function switchEmployeeTab(tabName) {
    const contents = document.querySelectorAll('.emp-tab-content');
    const buttons = document.querySelectorAll('#employeeModal .tab-btn');
    
    contents.forEach(c => c.style.display = 'none');
    buttons.forEach(b => b.classList.remove('active'));
    
    if (tabName === 'assets') {
        document.getElementById('employeeAssetsSection').style.display = 'block';
        document.getElementById('tabEmpAssets').classList.add('active');
    } else if (tabName === 'history') {
        document.getElementById('employeeHistorySection').style.display = 'block';
        document.getElementById('tabEmpHistory').classList.add('active');
    } else if (tabName === 'tree') {
        document.getElementById('employeeTreeSection').style.display = 'block';
        document.getElementById('tabEmpTree').classList.add('active');
    }
}

async function loadEmployeeHistory(empName) {
    const historyBody = document.getElementById('employeeHistoryBody');
    if (!historyBody) return;
    
    historyBody.innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center;"><div class="spinner"></div> Loading history...</td></tr>';
    
    try {
        console.log(`Fetching history for ${empName}...`);
        const response = await fetch(`/api/employees/${encodeURIComponent(empName)}/history`);
        console.log(`History response status: ${response.status}`);
        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errData.error || `Server error: ${response.status}`);
        }
        const history = await response.json();
        console.log(`History data received for ${empName}:`, history);
        
        if (!Array.isArray(history) || history.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center; color: #999;">No history found for this employee.</td></tr>';
            return;
        }
        
        historyBody.innerHTML = history.map(h => {
            if (!h) return '';
            // Defensive checks for null/undefined fields
            const date = h.Timestamp ? new Date(h.Timestamp).toLocaleString() : 'N/A';
            const assetId = h.AssetId || 'N/A';
            const itemName = h.ItemName || 'Unknown Asset';
            let actionText = h.Details || 'No details available';
            
            // Simplify action text if possible
            if (h.Details && typeof h.Details === 'string') {
                if (h.Details.includes(`to "${empName}"`)) {
                    actionText = `<span style="color: #52c41a;">Assigned</span>`;
                } else if (h.Details.includes(`from "${empName}"`)) {
                    actionText = `<span style="color: #f5222d;">Returned/Unassigned</span>`;
                }
            }
            
            return `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${date}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">
                        <strong>${assetId}</strong><br>
                        <span style="font-size: 0.9em; color: #666;">${itemName}</span>
                    </td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${actionText}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load history:', err);
        let errorMsg = err.message;
        if (errorMsg.includes('Unexpected token')) {
            errorMsg = 'Invalid response from server (not JSON). Please check if the API endpoint is correct.';
        }
        historyBody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #f5222d;">Error loading history: ${errorMsg}</td></tr>`;
    }
}

function renderEmployeeTree(empName) {
    const container = document.getElementById('employeeTreeContainer');
    if (!container) return;

    const assignedAssets = (window.allAssets || []).filter(a => a.AssignedTo === empName);
    if (assignedAssets.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No assets assigned to build a hierarchy.</div>';
        return;
    }

    // Build hierarchy: Top-level assets (no parent or parent not assigned to this employee)
    const roots = assignedAssets.filter(a => !a.ParentId || !assignedAssets.find(p => p.ID === a.ParentId));
    
    function buildTreeHtml(asset, level = 0) {
        const children = assignedAssets.filter(a => a.ParentId === asset.ID);
        let html = `
            <div style="margin-left: ${level * 20}px; border-left: 2px solid #ddd; padding: 5px 0 5px 15px; position: relative;">
                <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #eee; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.2em;">${asset.Type === 'Server' ? '🖥️' : (asset.Type === 'Component' ? '🔌' : '📦')}</span>
                    <div>
                        <strong>${asset.ItemName}</strong> <span style="font-size: 0.8em; color: #999;">(${asset.ID})</span><br>
                        <span style="font-size: 0.8em; color: #666;">${asset.Make} ${asset.Model}</span>
                    </div>
                </div>
        `;
        
        if (children.length > 0) {
            html += children.map(c => buildTreeHtml(c, level + 1)).join('');
        }
        
        html += '</div>';
        return html;
    }

    container.innerHTML = roots.map(r => buildTreeHtml(r)).join('');
}

async function deleteEmployee(id) {
    try {
        const response = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
        if (response.ok) {
            loadEmployees();
        } else {
            alert('Failed to delete employee');
        }
    } catch (err) {
        console.error('Error deleting employee:', err);
    }
}

async function handleBulkUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            if (rows.length < 2) {
                alert('The file seems to be empty or missing data rows.');
                return;
            }

            const mappings = DataProcessor.analyzeMapping(rows, 'employee');
            showMappingModal(rows, mappings);
        } catch (err) {
            console.error('Bulk upload processing error:', err);
            alert('Failed to process file: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset input
}

function showMappingModal(rows, suggestions) {
    const modal = document.getElementById('bulkMappingModal');
    const tbody = document.getElementById('mappingTableBody');
    const btnConfirm = document.getElementById('btnConfirmBulkUpload');
    
    tbody.innerHTML = '';
    const userMapping = {};

    suggestions.forEach(s => {
        const tr = document.createElement('tr');
        userMapping[s.index] = s.suggestedColumn;

        tr.innerHTML = `
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${s.header}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666; font-style: italic;">${s.sampleValue || '(empty)'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">
                <select class="mapping-select" data-index="${s.index}" style="width: 100%; padding: 5px; border-radius: 4px; border: 1px solid #ddd;">
                    <option value="skip">-- Skip this column --</option>
                    ${Object.entries(DataProcessor.EMP_COLUMNS).map(([id, info]) => 
                        `<option value="${id}" ${s.suggestedColumn === id ? 'selected' : ''}>${info.label}</option>`
                    ).join('')}
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const updatePreview = () => {
        const previewData = DataProcessor.processWithMapping(rows.slice(0, 4), userMapping, null, null, 'employee');
        const previewDiv = document.getElementById('bulkUploadPreview');
        if (previewData.length > 0) {
            previewDiv.innerHTML = '<pre>' + JSON.stringify(previewData, null, 2) + '</pre>';
        } else {
            previewDiv.innerHTML = '<p style="color: #dc3545;">No columns mapped. Please select at least one field.</p>';
        }
    };

    tbody.querySelectorAll('.mapping-select').forEach(select => {
        select.onchange = (e) => {
            userMapping[e.target.dataset.index] = e.target.value;
            updatePreview();
        };
    });

    btnConfirm.onclick = async () => {
        const finalData = DataProcessor.processWithMapping(rows, userMapping, null, null, 'employee');
        if (finalData.length === 0) {
            alert('No data to upload. Please check your mappings.');
            return;
        }

        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Uploading...';

        try {
            const response = await fetch('/api/employees/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalData)
            });

            if (response.ok) {
                const result = await response.json();
                alert(`Successfully uploaded ${result.count} employees.`);
                modal.style.display = 'none';
                loadEmployees();
            } else {
                const err = await response.text();
                alert('Upload failed: ' + err);
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert('Failed to upload data.');
        } finally {
            btnConfirm.disabled = false;
            btnConfirm.textContent = 'Process & Upload';
        }
    };

    updatePreview();
    modal.style.display = 'flex';
}
