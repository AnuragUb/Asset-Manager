// Employees management module
import { showView, TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator } from './utils.js?v=3.4';
import { DataProcessor } from './dataProcessor.js?v=4.1';

let employeeTable = null;

export function initEmployeeView() {
    console.log('initEmployeeView() called');
    window.editEmployee = editEmployee; // Expose globally
    const btnAddEmployee = document.getElementById('btnAddEmployee');
    const btnBulkUpload = document.getElementById('btnBulkUploadEmployees');
    const employeeBulkInput = document.getElementById('employeeBulkInput');
    const employeeModal = document.getElementById('employeeModal');
    const employeeForm = document.getElementById('employeeForm');
    const btnCancelEmployee = document.getElementById('btnCancelEmployee');
    const closeEmployeeModal = document.getElementById('closeEmployeeModal');

    if (btnAddEmployee) {
        btnAddEmployee.onclick = () => {
            document.getElementById('employeeModalTitle').textContent = 'Add New Employee';
            employeeForm.reset();
            document.getElementById('employeeDbId').value = '';
            document.getElementById('employeeAssetsSection').style.display = 'none';
            employeeModal.style.display = 'flex';
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

export async function loadEmployees() {
    try {
        const response = await fetch('/api/employees');
        const employees = await response.json();
        window.allEmployees = employees; // Store globally for reference

        if (!employeeTable) {
            employeeTable = new Tabulator("#employee-grid", {
                ...TABULATOR_BASE_CONFIG,
                data: employees,
                placeholder: "No employees found",
                columns: [
                    { title: "Emp ID", field: "EmployeeID", width: 100 },
                    { title: "Name", field: "Name", headerFilter: "input" },
                    { title: "Department", field: "Department", headerFilter: "input" },
                    { title: "Designation", field: "Designation" },
                    { title: "Email", field: "Email" },
                    { title: "Status", field: "Status", width: 100, formatter: (cell) => {
                        const val = cell.getValue();
                        const color = val === 'ACTIVE' ? '#28a745' : '#dc3545';
                        return `<span style="color: white; background: ${color}; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${val}</span>`;
                    }},
                    { title: "Actions", width: 120, hozAlign: "center", formatter: () => {
                        return `
                            <button class="edit-emp" style="padding: 4px 8px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                            <button class="delete-emp" style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">Del</button>
                        `;
                    }, cellClick: (e, cell) => {
                        const rowData = cell.getRow().getData();
                        if (e.target.classList.contains('edit-emp')) {
                            editEmployee(rowData);
                        } else if (e.target.classList.contains('delete-emp')) {
                            if (confirm(`Are you sure you want to delete ${rowData.Name}?`)) {
                                deleteEmployee(rowData.ID);
                            }
                        }
                    }}
                ],
            });
            
            registerTabulator(employeeTable);
            robustRedraw(employeeTable);
        } else {
            employeeTable.setData(employees).then(() => {
                robustRedraw(employeeTable);
            });
        }
    } catch (err) {
        console.error('Failed to load employees:', err);
    }
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
    
    document.getElementById('employeeModal').style.display = 'flex';
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
