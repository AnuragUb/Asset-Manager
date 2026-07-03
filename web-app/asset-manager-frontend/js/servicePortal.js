/**
 * ARRI Service Portal - Job Card Management
 */

export function initServicePortal() {
    console.log('Initializing ARRI Service Portal...');

    const btnNewJobCard = document.getElementById('btnNewJobCard');
    const modal = document.getElementById('newJobCardModal');
    const closeBtn = document.getElementById('closeJobCardModal');
    const cancelBtn = document.getElementById('btnCancelJobCard');
    const form = document.getElementById('newJobCardForm');
    
    const customerSearchInput = document.getElementById('jobCardCustomerSearch');
    const suggestionsBox = document.getElementById('customerSuggestions');
    const arriSearchInput = document.getElementById('arriSearch');
    const btnArriSync = document.getElementById('btnArriSync');
    const btnArriFetchAll = document.getElementById('btnArriFetchAll');
    const btnGoogleSheetsSync = document.getElementById('btnGoogleSheetsSync');

    if (btnGoogleSheetsSync) {
        btnGoogleSheetsSync.onclick = async () => {
            const originalContent = btnGoogleSheetsSync.innerHTML;
            btnGoogleSheetsSync.innerHTML = '<span>⏳ Syncing...</span>';
            btnGoogleSheetsSync.disabled = true;

            try {
                const response = await fetch('/api/arri/sync-sheets', { method: 'POST' });
                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(err);
                }
                const result = await response.json();
                alert(`Successfully synced ${result.count} Job Cards to Google Sheets!`);
            } catch (err) {
                console.error('[ARRI] Sheets Sync Failed:', err);
                alert('Sync Failed: ' + err.message + '\n\nPlease ensure credentials.json and GOOGLE_SHEETS_ID are configured.');
            } finally {
                btnGoogleSheetsSync.innerHTML = originalContent;
                btnGoogleSheetsSync.disabled = false;
            }
        };
    }

    // Sub-tab switching
    const subTabs = document.querySelectorAll('.arri-sub-tab');
    subTabs.forEach(tab => {
        tab.onclick = () => {
            const targetId = tab.dataset.target;
            
            // Update buttons
            subTabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.color = '#64748b';
            });
            tab.classList.add('active');
            tab.style.background = 'white';
            tab.style.color = '#1e293b';
            tab.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';

            // Update sections
            document.querySelectorAll('.arri-section').forEach(sec => {
                sec.classList.add('hidden');
                sec.style.display = 'none';
            });
            const targetSec = document.getElementById(targetId);
            if (targetSec) {
                targetSec.classList.remove('hidden');
                targetSec.style.display = 'block';
                
                // Trigger load based on tab
                if (targetId === 'arri-job-cards-section') {
                    loadJobCards();
                } else if (targetId === 'arri-clients-section') {
                    loadArriClients();
                }
            }
        };
    });

    // Client Management Logic
    async function loadArriClients(search = '') {
        try {
            const url = search ? `/api/arri/customers?search=${encodeURIComponent(search)}` : '/api/arri/customers';
            const response = await fetch(url);
            const clients = await response.json();
            renderArriClientsTable(clients);
            
            // Update Stats
            document.getElementById('client-stat-total').textContent = clients.length;
            
            // Calculate "New this month"
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const newThisMonth = clients.filter(c => {
                const createdAt = new Date(c.CreatedAt || c.created_at);
                return createdAt >= startOfMonth;
            }).length;
            document.getElementById('client-stat-new').textContent = newThisMonth;
            
        } catch (err) {
            console.error('[ARRI] Failed to load clients:', err);
        }
    }

    function renderArriClientsTable(data) {
        const grid = document.getElementById('arri-client-cards-grid');
        if (!grid) return;

        if (data.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No clients found.</div>';
            return;
        }

        grid.innerHTML = data.map(client => `
            <div class="employee-card" style="border-left: 4px solid #6366f1;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                    <div class="employee-icon" style="background: #eef2ff; color: #6366f1;">
                        ${(client.Name || client.name || 'C').charAt(0).toUpperCase()}
                    </div>
                    <button class="action-button indigo" onclick="window.viewClientHistory('${client.Name || client.name}')" style="padding: 4px 12px; font-size: 11px; border-radius: 6px;">
                        View History
                    </button>
                </div>
                <div class="employee-info">
                    <div class="employee-name">${client.Name || client.name}</div>
                    <div class="employee-role">${client.ContactPerson || 'No contact person'}</div>
                </div>
                <div class="employee-details" style="margin-top: 15px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
                    <div class="detail-item">
                        <span class="detail-label">📞 PHONE</span>
                        <span class="detail-value">${client.ContactNo || 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">📧 EMAIL</span>
                        <span class="detail-value" style="font-size: 11px;">${client.Email || 'N/A'}</span>
                    </div>
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">📍 ADDRESS</span>
                        <span class="detail-value" style="font-size: 11px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${client.Address || ''}">
                            ${client.Address || 'No address saved'}
                        </span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Global history viewer function
    window.viewClientHistory = async function(clientName) {
        const modal = document.getElementById('clientHistoryModal');
        const title = document.getElementById('historyModalTitle');
        if (!modal) return;

        title.textContent = `Job History: ${clientName}`;
        modal.style.display = 'flex';

        try {
            // Fetch all job cards for this client
            const response = await fetch(`/api/arri/job-cards?search=${encodeURIComponent(clientName)}`);
            const jobCards = await response.json();
            
            // Filter strictly for this client name to avoid partial matches
            const filtered = jobCards.filter(jc => (jc.CustomerName || jc.customername) === clientName);
            
            // Update modal stats
            const statsContainer = document.getElementById('client-history-stats');
            const total = filtered.length;
            const pending = filtered.filter(jc => jc.Status === 'Pending').length;
            const completed = filtered.filter(jc => jc.Status === 'Completed').length;

            statsContainer.innerHTML = `
                <div style="background: #f8fafc; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                    <div style="font-size: 18px; font-weight: bold; color: #1e293b;">${total}</div>
                    <div style="font-size: 10px; color: #64748b;">TOTAL JOBS</div>
                </div>
                <div style="background: #fffbeb; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #fef3c7;">
                    <div style="font-size: 18px; font-weight: bold; color: #d97706;">${pending}</div>
                    <div style="font-size: 10px; color: #64748b;">PENDING</div>
                </div>
                <div style="background: #f0fdf4; padding: 10px; border-radius: 8px; text-align: center; border: 1px solid #dcfce7;">
                    <div style="font-size: 18px; font-weight: bold; color: #16a34a;">${completed}</div>
                    <div style="font-size: 10px; color: #64748b;">COMPLETED</div>
                </div>
            `;

            // Render table in modal
            new Tabulator("#client-history-table-container", {
                data: filtered,
                layout: "fitColumns",
                pagination: "local",
                paginationSize: 5,
                columns: [
                    { title: "JC No", field: "JobCardNo", width: 100 },
                    { title: "Date", field: "Date", width: 100 },
                    { title: "Model/Serial", field: "ModelName", formatter: (cell) => {
                        const data = cell.getData();
                        return `${data.ModelName || 'N/A'}<br><small>${data.SerialNo || ''}</small>`;
                    }},
                    { title: "Status", field: "Status", width: 100, formatter: (cell) => {
                        const val = cell.getValue();
                        const color = val === 'Completed' ? '#10b981' : '#f59e0b';
                        return `<span style="color: ${color}; font-weight: bold;">${val}</span>`;
                    }},
                    { title: "Actions", formatter: () => "👁️ Open", width: 80, cellClick: (e, cell) => {
                        modal.style.display = 'none';
                        openExistingJobCard(cell.getData().JobCardNo);
                    }}
                ]
            });

        } catch (err) {
            console.error('[ARRI] Failed to fetch client history:', err);
        }
    };

    // Client Tab Search & Refresh
    const clientSearch = document.getElementById('arriClientSearch');
    if (clientSearch) {
        clientSearch.oninput = (e) => loadArriClients(e.target.value);
    }

    const btnRefreshClients = document.getElementById('btnArriRefreshClients');
    if (btnRefreshClients) {
        btnRefreshClients.onclick = () => loadArriClients();
    }

    let allCustomers = [];

    // Fetch customers for autocomplete
    async function loadCustomers() {
        try {
            console.log('[ARRI] Fetching customer list from /api/arri/customers...');
            const response = await fetch('/api/arri/customers');
            allCustomers = await response.json();
            console.log(`[ARRI] Loaded ${allCustomers.length} customers for autocomplete`);
            // Cache globally for window-level access
            window.arriCachedCustomers = allCustomers;
        } catch (err) {
            console.error('[ARRI] Failed to load customers:', err);
        }
    }

    // Global selection function for suggestions
    window.selectArriCustomer = function(id) {
        const customer = window.arriCachedCustomers.find(c => (c.ID || c.id) == id);
        if (customer) {
            console.log('[ARRI] Selected customer:', customer.Name || customer.name);
            const input = document.getElementById('jobCardCustomerSearch');
            const suggestions = document.getElementById('customerSuggestions');
            const form = document.getElementById('newJobCardForm');
            
            if (input) input.value = customer.Name || customer.name;
            if (suggestions) {
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
            }
            
            if (form) {
                const addrField = form.querySelector('textarea[name="customerAddress"]');
                const personField = form.querySelector('input[name="contactPerson"]');
                const phoneField = form.querySelector('input[name="contactNo"]');
                
                if (addrField) addrField.value = customer.Address || customer.address || '';
                if (personField) personField.value = customer.ContactPerson || customer.contactperson || '';
                if (phoneField) phoneField.value = customer.ContactNo || customer.contactno || '';
            }
        }
    };

    // Load customers initially
    loadCustomers();

    // Initialize ARRI View with search and fetch
    if (arriSearchInput) {
        arriSearchInput.oninput = (e) => {
            const val = e.target.value;
            loadJobCards(val);
        };
    }

    if (btnArriSync) {
        btnArriSync.onclick = async () => {
            const originalHTML = btnArriSync.innerHTML;
            btnArriSync.innerHTML = '<span>⏳ Syncing...</span>';
            btnArriSync.disabled = true;

            try {
                // Refresh all ARRI data
                await Promise.all([
                    loadJobCards(),
                    loadArriClients(),
                    loadCustomers()
                ]);
                
                // Add a small delay for visual feedback
                setTimeout(() => {
                    btnArriSync.innerHTML = originalHTML;
                    btnArriSync.disabled = false;
                }, 500);
                
                console.log('[ARRI] Global data sync complete.');
            } catch (err) {
                console.error('[ARRI] Sync failed:', err);
                btnArriSync.innerHTML = originalHTML;
                btnArriSync.disabled = false;
            }
        };
    }

    if (btnArriFetchAll) {
        btnArriFetchAll.onclick = () => {
            loadJobCards();
        };
    }

    async function loadJobCards(search = '') {
        const container = document.getElementById('arri-table-container');
        if (!container) return;

        try {
            const url = search ? `/api/arri/job-cards?search=${encodeURIComponent(search)}` : '/api/arri/job-cards';
            const response = await fetch(url);
            const jobCards = await response.json();
            
            renderJobCardsTable(jobCards);
            
            // Update stats
            const pending = jobCards.filter(jc => jc.Status === 'Pending').length;
            const completed = jobCards.filter(jc => jc.Status === 'Completed').length;
            document.getElementById('stat-pending').textContent = pending;
            document.getElementById('stat-completed').textContent = completed;
            
        } catch (err) {
            console.error('Failed to load Job Cards:', err);
        }
    }

    function renderJobCardsTable(data) {
        const table = new Tabulator("#arri-table-container", {
            data: data,
            layout: "fitColumns",
            pagination: "local",
            paginationSize: 10,
            selectable: 1,
            columns: [
                { title: "JC No", field: "JobCardNo", width: 100, headerFilter: "input" },
                { title: "Date", field: "Date", width: 120 },
                { title: "Customer", field: "CustomerName", headerFilter: "input" },
                { title: "Serial No", field: "SerialNo", headerFilter: "input" },
                { title: "Status", field: "Status", width: 100, formatter: (cell) => {
                    const val = cell.getValue();
                    const color = val === 'Completed' ? '#10b981' : '#f59e0b';
                    return `<span style="color: ${color}; font-weight: bold;">${val}</span>`;
                }},
                { title: "Actions", formatter: () => "👁️ View", width: 80, cellClick: (e, cell) => {
                    openExistingJobCard(cell.getData().JobCardNo);
                }}
            ]
        });
    }

    async function openExistingJobCard(jcNo) {
        try {
            const response = await fetch(`/api/arri/job-cards/${jcNo}`);
            const data = await response.json();
            
            if (modal) {
                modal.style.display = 'flex';
                populateJobCardForm(data);
            }
        } catch (err) {
            console.error('Failed to fetch job card details:', err);
        }
    }

    function populateJobCardForm(data) {
        const activeForm = document.getElementById('newJobCardForm');
        if (!activeForm) return;
        
        document.getElementById('displayJobCardNo').textContent = data.JobCardNo;
        activeForm.querySelector('input[name="jobCardNo"]').value = data.JobCardNo;
        activeForm.querySelector('input[name="jobDate"]').value = data.Date;
        activeForm.querySelector('input[name="customerName"]').value = data.CustomerName;
        activeForm.querySelector('textarea[name="customerAddress"]').value = data.CustomerAddress || '';
        activeForm.querySelector('input[name="contactPerson"]').value = data.ContactPerson || '';
        activeForm.querySelector('input[name="contactNo"]').value = data.ContactNo || '';
        activeForm.querySelector('input[name="brandMake"]').value = data.BrandMake || '';
        activeForm.querySelector('input[name="modelName"]').value = data.ModelName || '';
        activeForm.querySelector('input[name="serialNo"]').value = data.SerialNo || '';
        activeForm.querySelector('input[name="receivingEngineer"]').value = data.ReceivingEngineer || '';
        
        activeForm.querySelector('input[name="acc1"]').value = data.acc1 || '';
        activeForm.querySelector('input[name="acc2"]').value = data.acc2 || '';
        activeForm.querySelector('input[name="acc3"]').value = data.acc3 || '';
        activeForm.querySelector('input[name="acc4"]').value = data.acc4 || '';
        
        activeForm.querySelector('input[name="typeAMC"]').checked = !!data.TypeAMC;
        activeForm.querySelector('input[name="typeWarranty"]').checked = !!data.TypeWarranty;
        activeForm.querySelector('input[name="typeNoWarranty"]').checked = !!data.TypeNoWarranty;
        activeForm.querySelector('input[name="typeOther"]').checked = !!data.TypeOther;
        
        activeForm.querySelector('textarea[name="reportedProblem"]').value = data.ReportedProblem || '';
        activeForm.querySelector('textarea[name="actionTaken"]').value = data.ActionTaken || '';
        activeForm.querySelector('input[name="faultFound"]').value = data.FaultFound || '';
        activeForm.querySelector('input[name="faultSN"]').value = data.FaultSN || '';
        activeForm.querySelector('input[name="partsReplaced"]').value = data.PartsReplaced || '';
        activeForm.querySelector('input[name="partsSN"]').value = data.PartsSN || '';
        activeForm.querySelector('textarea[name="conclusion"]').value = data.Conclusion || '';
    }

    // Initial load
    loadJobCards();

    // --- Helper to Re-attach Autocomplete Logic to the New Form ---
    function attachAutocompleteHandlers() {
        const input = document.getElementById('jobCardCustomerSearch');
        const box = document.getElementById('customerSuggestions');
        if (!input || !box) return;

        input.oninput = (e) => {
            const val = e.target.value.toLowerCase().trim();
            console.log('[ARRI] Searching client:', val);
            
            if (val.length < 1) {
                box.classList.add('hidden');
                box.style.display = 'none';
                return;
            }

            const matches = window.arriCachedCustomers.filter(c => {
                const name = (c.Name || c.name || '').toString().toLowerCase();
                const person = (c.ContactPerson || c.contactperson || '').toString().toLowerCase();
                return name.includes(val) || person.includes(val);
            });

            if (matches.length > 0) {
                box.innerHTML = matches.map(c => `
                    <div class="suggestion-item" 
                         onclick="window.selectArriCustomer('${c.ID || c.id}')"
                         style="padding: 12px; cursor: pointer; border-bottom: 1px solid #eee; background: white; color: #333; transition: background 0.2s;">
                        <div style="font-weight: bold; font-size: 14px;">${c.Name || c.name}</div>
                        <div style="font-size: 12px; color: #666;">
                            <span style="margin-right: 10px;">👤 ${c.ContactPerson || c.contactperson || 'No Contact'}</span>
                            <span>📞 ${c.ContactNo || c.contactno || 'No Phone'}</span>
                        </div>
                    </div>
                `).join('');
                
                box.classList.remove('hidden');
                box.style.display = 'block';
                box.style.position = 'absolute';
                box.style.top = (input.offsetTop + input.offsetHeight) + 'px';
                box.style.left = input.offsetLeft + 'px';
                box.style.width = input.offsetWidth + 'px';
                box.style.backgroundColor = 'white';
                box.style.border = '1px solid #ddd';
                box.style.zIndex = '20001'; // Higher than modal (2000)
                box.style.maxHeight = '250px';
                box.style.overflowY = 'auto';
                box.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
                box.style.borderRadius = '4px';
            } else {
                box.classList.add('hidden');
                box.style.display = 'none';
            }
        };

        // Close results when clicking outside
        document.onclick = (e) => {
            if (e.target !== input && e.target !== box) {
                box.classList.add('hidden');
                box.style.display = 'none';
            }
        };
    }

    if (btnNewJobCard) {
        // Remove existing listeners if any
        const newBtn = btnNewJobCard.cloneNode(true);
        btnNewJobCard.parentNode.replaceChild(newBtn, btnNewJobCard);
        
        newBtn.addEventListener('click', async () => {
            console.log('Opening New Job Card Modal');
            if (modal) {
                modal.style.display = 'flex';
                // Reset form on open
                const activeForm = document.getElementById('newJobCardForm');
                if (activeForm) {
                    activeForm.reset();
                    document.getElementById('jobCardCustomerSearch').value = '';
                    document.getElementById('customerSuggestions').style.display = 'none';
                }
                
                // Load fresh customer list
                await loadCustomers();
                
                // Set default date to today
                const today = new Date().toISOString().split('T')[0];
                const dateInput = document.querySelector('#newJobCardForm input[name="jobDate"]');
                if (dateInput) dateInput.value = today;

                // Re-attach autocomplete specifically to the new form inputs
                setTimeout(() => attachAutocompleteHandlers(), 100);
                
                // Fetch next Job Card No from server
                const now = new Date();
                const year = now.getFullYear().toString().slice(-2);
                
                try {
                    const response = await fetch('/api/arri/next-jc-id');
                    if (!response.ok) throw new Error('Network response was not ok');
                    const { id } = await response.json();
                    const jobNoStr = `JC_${id}_${year}`;
                    
                    document.getElementById('displayJobCardNo').textContent = jobNoStr;
                    const hiddenNo = document.querySelector('#newJobCardForm input[name="jobCardNo"]');
                    if (hiddenNo) hiddenNo.value = jobNoStr;
                } catch (err) {
                    console.error('[ARRI] Failed to fetch next JC ID:', err);
                }
            }
        });
    }

    if (closeBtn) {
        closeBtn.onclick = () => {
            if (modal) modal.style.display = 'none';
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (modal) modal.style.display = 'none';
        };
    }

    if (form) {
        // Remove any previous submit listeners to prevent double-firing
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
        // Re-attach autocomplete every time the form is replaced
        attachAutocompleteHandlers();

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(newForm);
            const data = Object.fromEntries(formData.entries());
            
            // Handle checkboxes
            data.typeAMC = newForm.querySelector('input[name="typeAMC"]').checked;
            data.typeWarranty = newForm.querySelector('input[name="typeWarranty"]').checked;
            data.typeNoWarranty = newForm.querySelector('input[name="typeNoWarranty"]').checked;
            data.typeOther = newForm.querySelector('input[name="typeOther"]').checked;

            // Update hidden jobCardNo if it was manually edited or changed by JS
            const hiddenNo = newForm.querySelector('input[name="jobCardNo"]');
            const displayNo = document.getElementById('displayJobCardNo').textContent;
            if (hiddenNo && displayNo) {
                hiddenNo.value = displayNo;
                data.jobCardNo = displayNo;
            }

            try {
                const response = await fetch('/api/arri/job-cards', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText || 'Server error');
                }

                const result = await response.json();
                if (result.success) {
                    alert(`Job Card ${result.action} successfully!`);
                    modal.style.display = 'none';
                    loadJobCards(); // Refresh table
                    loadCustomers(); // Refresh client list
                    
                    // Refresh Clients tab if it's active
                    const clientsTab = document.querySelector('.arri-sub-tab[data-target="arri-clients-section"]');
                    if (clientsTab && clientsTab.classList.contains('active')) {
                        loadArriClients();
                    }
                }
            } catch (err) {
                console.error('Save failed:', err);
                alert('Failed to save Job Card: ' + err.message);
            }
        });
    }
}

// Expose refresh function globally
window.refreshJobCardTable = function() {
    console.log('Refreshing Job Card Table...');
    // Table logic will go here
};
