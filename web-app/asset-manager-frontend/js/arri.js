/**
 * ARRI Service Portal Module
 * Handles Job Card creation, Digital Twin logic, and Client database
 */

export function initArriView() {
    console.log('[ARRI] Initializing View...');
    
    // Ensure sections are visible
    const historySection = document.getElementById('arri_history_section');
    if (historySection) {
        historySection.classList.remove('hidden');
        historySection.style.display = 'block';
    }

    setupArriTabs();
    setupArriActions();
    loadArriHistory();
}

function setupArriTabs() {
    const tabs = document.querySelectorAll('.arri-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const target = tab.dataset.tab;
            document.querySelectorAll('.arri-section').forEach(s => s.classList.add('hidden'));
            document.getElementById(`arri_${target}_section`).classList.remove('hidden');
            
            if (target === 'history') loadArriHistory();
            if (target === 'clients') loadArriClients();
        });
    });
}

function setupArriActions() {
    const btnNewJC = document.getElementById('btnNewJC');
    if (btnNewJC) {
        btnNewJC.addEventListener('click', () => {
            openJobCardModal();
        });
    }

    const btnSaveJC = document.getElementById('btnSaveJC');
    if (btnSaveJC) {
        btnSaveJC.addEventListener('click', () => {
            saveJobCard();
        });
    }

    // Live Search for Clients
    const customerInput = document.getElementById('jc_customer_name');
    const customerResults = document.getElementById('jc_customer_results');
    if (customerInput && customerResults) {
        customerInput.addEventListener('input', async (e) => {
            const query = e.target.value;
            if (query.length < 2) {
                customerResults.style.display = 'none';
                return;
            }

            try {
                const response = await fetch('/api/arri/clients');
                const clients = await response.json();
                const filtered = clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
                
                if (filtered.length > 0) {
                    customerResults.innerHTML = filtered.map(c => `
                        <div class="search-item-result" onclick="window.selectArriClient('${c.name}', '${c.address || ''}', '${c.contactperson || ''}', '${c.contactno || ''}')">
                            <div class="emp-name">${c.name}</div>
                            <div class="emp-meta">${c.contactperson || 'No Contact'}</div>
                        </div>
                    `).join('');
                    customerResults.style.display = 'block';
                } else {
                    customerResults.style.display = 'none';
                }
            } catch (err) {
                console.error('Error fetching clients:', err);
            }
        });
    }

    // Live Search for Assets (by Serial No)
    const serialInput = document.getElementById('jc_serial');
    const serialResults = document.getElementById('jc_serial_results');
    if (serialInput && serialResults) {
        serialInput.addEventListener('input', async (e) => {
            const query = e.target.value;
            if (query.length < 2) {
                serialResults.style.display = 'none';
                return;
            }

            // Note: window.assets is usually available from main.js loadAssets
            const assets = window.assets || [];
            const filtered = assets.filter(a => 
                (a.SerialNo && a.SerialNo.toLowerCase().includes(query.toLowerCase())) ||
                (a.ID && a.ID.toLowerCase().includes(query.toLowerCase()))
            );

            if (filtered.length > 0) {
                serialResults.innerHTML = filtered.map(a => `
                    <div class="search-item-result" onclick="window.selectArriAsset('${a.Brand || ''}', '${a.Model || ''}', '${a.SerialNo || ''}')">
                        <div class="emp-name">${a.SerialNo || a.ID}</div>
                        <div class="emp-meta">${a.Brand || ''} ${a.Model || ''}</div>
                    </div>
                `).join('');
                serialResults.style.display = 'block';
            } else {
                serialResults.style.display = 'none';
            }
        });
    }
}

function selectArriClient(name, address, person, contact) {
    document.getElementById('jc_customer_name').value = name;
    document.getElementById('jc_address').value = address;
    document.getElementById('jc_contact_person').value = person;
    document.getElementById('jc_contact_no').value = contact;
    document.getElementById('jc_customer_results').style.display = 'none';
}

function selectArriAsset(brand, model, serial) {
    document.getElementById('jc_brand').value = brand;
    document.getElementById('jc_model').value = model;
    document.getElementById('jc_serial').value = serial;
    document.getElementById('jc_serial_results').style.display = 'none';
}

async function loadArriHistory() {
    const grid = document.getElementById('arri_jc_grid');
    if (!grid) return;

    grid.innerHTML = '<div style="padding: 20px; color: #64748b;">Loading Job Cards...</div>';

    try {
        const response = await fetch('/api/arri/job-cards');
        
        // Handle 404 or other non-OK responses gracefully
        if (!response.ok) {
            if (response.status === 404) {
                grid.innerHTML = '<div style="padding: 20px; color: #dc3545;">API Error: ARRI Endpoints not active on this port.</div>';
            } else {
                grid.innerHTML = `<div style="padding: 20px; color: #dc3545;">Error: Server responded with status ${response.status}</div>`;
            }
            return;
        }

        const jcs = await response.json();
        
        if (!jcs.length) {
            grid.innerHTML = '<div style="padding: 20px; color: #64748b;">No Job Cards found. Create your first one!</div>';
            return;
        }

        grid.innerHTML = jcs.map(jc => `
            <div class="card-panel" style="padding: 20px; cursor: pointer;" onclick="window.openJobCardModal('${jc.jobcardno}')">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <span style="font-weight: 700; color: #1e293b;">${jc.jobcardno}</span>
                    <span class="status-badge" style="background: #f1f5f9; color: #475569;">${jc.date}</span>
                </div>
                <div style="font-size: 14px; color: #475569; margin-bottom: 8px;">${jc.customername}</div>
                <div style="font-size: 12px; color: #94a3b8;">${jc.brandmake} ${jc.modelnoname}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('[ARRI] Error loading history:', err);
        grid.innerHTML = '<div style="padding: 20px; color: #dc3545;">Error loading data.</div>';
    }
}

async function loadArriClients() {
    const grid = document.getElementById('arri_client_grid');
    if (!grid) return;

    grid.innerHTML = '<div style="padding: 20px; color: #64748b;">Loading Clients...</div>';

    try {
        const response = await fetch('/api/arri/clients');
        const clients = await response.json();
        
        grid.innerHTML = clients.map(client => `
            <div class="card-panel" style="padding: 20px;">
                <div style="font-weight: 700; color: #1e293b; margin-bottom: 8px;">${client.name}</div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">${client.contactperson || 'No Contact'}</div>
                <div style="font-size: 12px; color: #94a3b8;">${client.email || ''}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('[ARRI] Error loading clients:', err);
    }
}

async function openJobCardModal(jcNo = null) {
    const modal = document.getElementById('arriJobCardModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    // Reset form
    const inputs = modal.querySelectorAll('input, textarea');
    inputs.forEach(i => i.value = '');
    
    // Set current date
    document.getElementById('jc_date').value = new Date().toISOString().split('T')[0];
    
    // Fetch next JC ID if creating new
    if (!jcNo) {
        try {
            const response = await fetch('/api/arri/next-jc-id');
            const data = await response.json();
            document.getElementById('jc_number').value = data.id;
        } catch (err) { 
            console.error('Error fetching next JC ID:', err);
        }
    }
}

async function saveJobCard() {
    // Logic for saving Job Card would go here
    console.log('[ARRI] Save Job Card clicked');
}

window.openJobCardModal = openJobCardModal;
window.initArriView = initArriView;
window.selectArriClient = selectArriClient;
window.selectArriAsset = selectArriAsset;
