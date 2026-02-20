/**
 * Network Module (formerly Network Scanner)
 * Handles IP discovery, subnet detection, linking assets, and Network Credentials.
 */
import { TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator } from './utils.js?v=3.4';

let scannerTabulator = null;
let credentialsTabulator = null;
let contactsTabulator = null;

export async function initScannerView() {
    console.log('initScannerView() called - Initializing Network View');
    
    // Inject Tab Navigation if missing
    const viewContainer = document.getElementById('scanner-view');
    if (!viewContainer) return;

    if (!document.getElementById('network-tab-controls')) {
        const header = viewContainer.querySelector('.view-toolbar') || viewContainer.firstElementChild;
        const controls = document.createElement('div');
        controls.id = 'network-tab-controls';
        controls.className = 'admin-tabs'; // Reuse admin tab styling
        controls.style.cssText = 'display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px;';
        controls.innerHTML = `
            <button class="tab-btn active" id="tab-network-scanner" onclick="switchNetworkTab('scanner')">Network Scanner</button>
            <button class="tab-btn" id="tab-network-credentials" onclick="switchNetworkTab('credentials')">Access Points & Credentials</button>
            <button class="tab-btn" id="tab-network-contacts" onclick="switchNetworkTab('contacts')">Quick Contacts</button>
        `;
        if (header) {
            header.insertAdjacentElement('afterend', controls);
        } else {
            viewContainer.prepend(controls);
        }

        // Create Container for Credentials if missing
        const scannerContent = document.querySelector('.scanner-content') || document.querySelector('.card-panel');
        if (scannerContent) {
            scannerContent.id = 'network-content-scanner';
            scannerContent.style.display = 'block'; // Default visible
        }

        const credsContainer = document.createElement('div');
        credsContainer.id = 'network-content-credentials';
        credsContainer.style.display = 'none';
        credsContainer.className = 'card-panel';
        credsContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>Network Access Points</h3>
                <button class="action-button blue" onclick="openCredentialModal()">+ Add Credential</button>
            </div>
            <div id="credentials-grid" style="min-height: 400px;"></div>
        `;
        viewContainer.appendChild(credsContainer);

        // Create Container for Contacts
        const contactsContainer = document.createElement('div');
        contactsContainer.id = 'network-content-contacts';
        contactsContainer.style.display = 'none';
        contactsContainer.className = 'card-panel';
        contactsContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>Quick Contacts</h3>
                <button class="action-button blue" onclick="openContactModal()">+ Add Contact</button>
            </div>
            <div id="contacts-grid" style="min-height: 400px;"></div>
        `;
        viewContainer.appendChild(contactsContainer);

        // Inject Modal for Credentials
        const modalHtml = `
            <div id="credentialModal" class="modal" style="display: none;">
                <div class="modal-content" style="max-width: 500px;">
                    <span class="close-modal" onclick="closeCredentialModal()">&times;</span>
                    <h3 id="credModalTitle">Add Network Credential</h3>
                    <form id="credForm" onsubmit="handleSaveCredential(event)">
                        <input type="hidden" name="id" id="credId">
                        <div class="form-group">
                            <label>Device Name *</label>
                            <input type="text" name="device_name" id="credDeviceName" required class="form-control" placeholder="e.g. Printer-HR">
                        </div>
                        <div class="form-group">
                            <label>IP Address</label>
                            <input type="text" name="ip_address" id="credIp" class="form-control" placeholder="e.g. 192.168.1.50">
                        </div>
                        <div class="form-group">
                            <label>Type</label>
                            <select name="type" id="credType" class="form-control">
                                <option value="Printer">Printer</option>
                                <option value="Server">Server</option>
                                <option value="Router">Router</option>
                                <option value="Switch">Switch</option>
                                <option value="Firewall">Firewall</option>
                                <option value="NAS">NAS</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Username</label>
                            <input type="text" name="username" id="credUsername" class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Password</label>
                            <div style="position: relative;">
                                <input type="password" name="password" id="credPassword" class="form-control">
                                <span onclick="toggleCredPassword()" style="position: absolute; right: 10px; top: 10px; cursor: pointer;">👁️</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Notes</label>
                            <textarea name="notes" id="credNotes" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="modal-actions" style="margin-top: 20px; text-align: right;">
                            <button type="button" class="cancel-button" onclick="closeCredentialModal()">Cancel</button>
                            <button type="submit" class="action-button blue">Save</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Inject Modal for Contacts
        const contactModalHtml = `
            <div id="contactModal" class="modal" style="display: none;">
                <div class="modal-content" style="max-width: 500px;">
                    <span class="close-modal" onclick="closeContactModal()">&times;</span>
                    <h3 id="contactModalTitle">Add Quick Contact</h3>
                    <form id="contactForm" onsubmit="handleSaveContact(event)">
                        <input type="hidden" name="id" id="contactId">
                        <div class="form-group">
                            <label>Service *</label>
                            <input type="text" name="service" id="contactService" required class="form-control" placeholder="e.g. Internet Service">
                        </div>
                        <div class="form-group">
                            <label>Service Provider</label>
                            <input type="text" name="provider" id="contactProvider" class="form-control" placeholder="e.g. Comcast">
                        </div>
                        <div class="form-group">
                            <label>Contact (Name / Phone)</label>
                            <input type="text" name="contact" id="contactName" class="form-control" placeholder="e.g. John Doe - 555-0123">
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" name="email" id="contactEmail" class="form-control" placeholder="e.g. support@provider.com">
                        </div>
                        <div class="modal-actions" style="margin-top: 20px; text-align: right;">
                            <button type="button" class="cancel-button" onclick="closeContactModal()">Cancel</button>
                            <button type="submit" class="action-button blue">Save</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', contactModalHtml);
    }

    // Expose functions globally
    window.switchNetworkTab = switchNetworkTab;
    window.openCredentialModal = openCredentialModal;
    window.closeCredentialModal = closeCredentialModal;
    window.handleSaveCredential = handleSaveCredential;
    window.deleteCredential = deleteCredential;
    window.editCredential = editCredential;
    window.toggleCredPassword = toggleCredPassword;
    window.copyToClipboard = copyToClipboard;
    window.launchAndCopy = launchAndCopy;

    window.openContactModal = openContactModal;
    window.closeContactModal = closeContactModal;
    window.handleSaveContact = handleSaveContact;
    window.editContact = editContact;
    window.deleteContact = deleteContact;

    // Default Scanner Logic
    initScannerLogic();
}

function switchNetworkTab(tab) {
    const scannerContent = document.getElementById('network-content-scanner');
    const credsContent = document.getElementById('network-content-credentials');
    const contactsContent = document.getElementById('network-content-contacts');
    
    const tabScanner = document.getElementById('tab-network-scanner');
    const tabCreds = document.getElementById('tab-network-credentials');
    const tabContacts = document.getElementById('tab-network-contacts');

    // Reset all
    scannerContent.style.display = 'none';
    credsContent.style.display = 'none';
    contactsContent.style.display = 'none';
    
    tabScanner.classList.remove('active');
    tabCreds.classList.remove('active');
    tabContacts.classList.remove('active');

    if (tab === 'scanner') {
        scannerContent.style.display = 'block';
        tabScanner.classList.add('active');
        if (scannerTabulator) robustRedraw(scannerTabulator);
    } else if (tab === 'credentials') {
        credsContent.style.display = 'block';
        tabCreds.classList.add('active');
        loadCredentials();
    } else if (tab === 'contacts') {
        contactsContent.style.display = 'block';
        tabContacts.classList.add('active');
        loadContacts();
    }
}

// --- Quick Contacts Logic ---

async function loadContacts() {
    try {
        const response = await fetch('/api/network/contacts');
        if (response.ok) {
            const data = await response.json();
            renderContacts(data.contacts || []);
        } else {
            console.error('Failed to load contacts');
        }
    } catch (err) {
        console.error('Error loading contacts:', err);
    }
}

function renderContacts(data) {
    if (contactsTabulator) {
        contactsTabulator.setData(data);
        return;
    }

    contactsTabulator = new Tabulator("#contacts-grid", {
        ...TABULATOR_BASE_CONFIG,
        data: data,
        layout: "fitColumns",
        placeholder: "No contacts stored",
        columns: [
            {title: "Service", field: "service", sorter: "string", headerFilter: "input", widthGrow: 2},
            {title: "Provider", field: "provider", sorter: "string", headerFilter: "input", widthGrow: 2},
            {title: "Contact Person / Phone", field: "contact", sorter: "string", headerFilter: "input", widthGrow: 2},
            {title: "Email", field: "email", sorter: "string", headerFilter: "input", widthGrow: 2, formatter: (cell) => {
                const val = cell.getValue();
                if (!val) return '-';
                return `<a href="mailto:${val}" style="color: #2196F3; text-decoration: underline;">${val}</a>`;
            }},
            {title: "Actions", formatter: (cell) => {
                const data = cell.getRow().getData();
                return `
                    <button class="action-button small blue" onclick="editContact('${data.id}')" style="margin-right: 5px;">✏️</button>
                    <button class="action-button small red" onclick="deleteContact('${data.id}')">🗑️</button>
                `;
            }, hozAlign: "center", width: 120}
        ]
    });
}

function openContactModal(contact = null) {
    const modal = document.getElementById('contactModal');
    const form = document.getElementById('contactForm');
    const title = document.getElementById('contactModalTitle');
    
    form.reset();
    document.getElementById('contactId').value = '';
    
    if (contact) {
        title.textContent = 'Edit Contact';
        document.getElementById('contactId').value = contact.id;
        document.getElementById('contactService').value = contact.service;
        document.getElementById('contactProvider').value = contact.provider;
        document.getElementById('contactName').value = contact.contact;
        document.getElementById('contactEmail').value = contact.email;
    } else {
        title.textContent = 'Add Quick Contact';
    }
    
    modal.style.display = 'flex';
}

function closeContactModal() {
    document.getElementById('contactModal').style.display = 'none';
}

function editContact(id) {
    const row = contactsTabulator.getRow(id);
    if (row) {
        openContactModal(row.getData());
    }
}

async function deleteContact(id) {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    
    try {
        const response = await fetch(`/api/network/contacts/${id}`, { method: 'DELETE' });
        if (response.ok) {
            loadContacts();
        } else {
            alert('Failed to delete contact');
        }
    } catch (err) {
        console.error(err);
        alert('Error deleting contact');
    }
}

async function handleSaveContact(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const id = data.id;
    
    try {
        const url = id ? `/api/network/contacts/${id}` : '/api/network/contacts';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            closeContactModal();
            loadContacts();
        } else {
            alert('Failed to save contact');
        }
    } catch (err) {
        console.error(err);
        alert('Error saving contact');
    }
}

async function loadCredentials() {
    try {
        const response = await fetch('/api/network/credentials');
        if (response.ok) {
            const data = await response.json();
            renderCredentials(data.credentials || []);
        } else {
            console.error('Failed to load credentials');
        }
    } catch (err) {
        console.error('Error loading credentials:', err);
    }
}

function renderCredentials(data) {
    if (credentialsTabulator) {
        credentialsTabulator.setData(data);
        return;
    }

    credentialsTabulator = new Tabulator("#credentials-grid", {
        ...TABULATOR_BASE_CONFIG,
        data: data,
        layout: "fitColumns",
        placeholder: "No credentials stored",
        columns: [
            {title: "Device Name", field: "device_name", sorter: "string", headerFilter: "input"},
            {title: "IP / URL", field: "ip_address", sorter: "string", headerFilter: "input", formatter: (cell) => {
                const val = cell.getValue();
                if (!val) return '-';
                let url = val;
                if (!url.startsWith('http')) url = 'http://' + url;
                return `<a href="${url}" target="_blank" style="color: #2196F3; text-decoration: underline; font-weight: bold;">${val}</a>`;
            }},
            {title: "Type", field: "type", sorter: "string", headerFilter: "input"},
            {title: "Username", field: "username", sorter: "string", formatter: (cell) => {
                const val = cell.getValue();
                if (!val) return '-';
                return `<div style="display: flex; align-items: center; justify-content: space-between;">
                    <span>${val}</span>
                    <button style="border: none; background: none; cursor: pointer; opacity: 0.6;" onclick="copyToClipboard('${val}', this)" title="Copy Username">📋</button>
                </div>`;
            }},
            {title: "Password", field: "password", formatter: (cell) => {
                const val = cell.getValue();
                if (!val) return '-';
                // Escape single quotes in password for the onclick handler
                const safeVal = val.replace(/'/g, "\\'");
                return `<div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: #666; letter-spacing: 2px;">••••••</span>
                    <button style="border: none; background: none; cursor: pointer; opacity: 0.6;" onclick="copyToClipboard('${safeVal}', this)" title="Copy Password">📋</button>
                </div>`;
            }},
            {title: "Notes", field: "notes", sorter: "string"},
            {title: "Actions", formatter: (cell) => {
                const data = cell.getRow().getData();
                let url = data.ip_address;
                if (url && !url.startsWith('http')) url = 'http://' + url;
                const safePass = (data.password || '').replace(/'/g, "\\'");
                
                return `
                    ${url ? `<button class="action-button small green" onclick="launchAndCopy('${url}', '${safePass}')" title="Launch & Copy Password" style="margin-right: 5px;">🚀</button>` : ''}
                    <button class="action-button small blue" onclick="editCredential('${data.id}')" style="margin-right: 5px;">✏️</button>
                    <button class="action-button small red" onclick="deleteCredential('${data.id}')">🗑️</button>
                `;
            }, hozAlign: "center", width: 180}
        ]
    });
}

function copyToClipboard(text, btnElement) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        if (btnElement) {
            const original = btnElement.innerHTML;
            btnElement.innerHTML = '✅';
            setTimeout(() => btnElement.innerHTML = original, 1500);
        }
    }).catch(err => {
        console.error('Copy failed', err);
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("Copy");
        textArea.remove();
        if (btnElement) {
            const original = btnElement.innerHTML;
            btnElement.innerHTML = '✅';
            setTimeout(() => btnElement.innerHTML = original, 1500);
        }
    });
}

function launchAndCopy(url, password) {
    if (password) {
        // Attempt copy
        navigator.clipboard.writeText(password).catch(e => console.error(e));
        alert('Password copied to clipboard! Opening site...');
    }
    // Open immediately
    window.open(url, '_blank');
}

function openCredentialModal(cred = null) {
    const modal = document.getElementById('credentialModal');
    const form = document.getElementById('credForm');
    const title = document.getElementById('credModalTitle');
    
    form.reset();
    document.getElementById('credId').value = '';
    
    if (cred) {
        title.textContent = 'Edit Credential';
        document.getElementById('credId').value = cred.id;
        document.getElementById('credDeviceName').value = cred.device_name;
        document.getElementById('credIp').value = cred.ip_address;
        document.getElementById('credType').value = cred.type;
        document.getElementById('credUsername').value = cred.username;
        document.getElementById('credPassword').value = cred.password;
        document.getElementById('credNotes').value = cred.notes;
    } else {
        title.textContent = 'Add Network Credential';
    }
    
    modal.style.display = 'flex';
}

function closeCredentialModal() {
    document.getElementById('credentialModal').style.display = 'none';
}

function editCredential(id) {
    const row = credentialsTabulator.getRow(id);
    if (row) {
        openCredentialModal(row.getData());
    }
}

async function deleteCredential(id) {
    if (!confirm('Are you sure you want to delete this credential?')) return;
    
    try {
        const response = await fetch(`/api/network/credentials/${id}`, { method: 'DELETE' });
        if (response.ok) {
            loadCredentials();
        } else {
            alert('Failed to delete credential');
        }
    } catch (err) {
        console.error(err);
        alert('Error deleting credential');
    }
}

async function handleSaveCredential(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const id = data.id;
    
    try {
        const url = id ? `/api/network/credentials/${id}` : '/api/network/credentials';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            closeCredentialModal();
            loadCredentials();
        } else {
            alert('Failed to save credential');
        }
    } catch (err) {
        console.error(err);
        alert('Error saving credential');
    }
}

function toggleCredPassword() {
    const input = document.getElementById('credPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
}

// Original Scanner Logic moved here
async function initScannerLogic() {
    console.log('initScannerLogic() called');
    const btnStartScan = document.getElementById('btnStartScan');
    const btnScanEntireNetwork = document.getElementById('btnScanEntireNetwork');
    const scannerTarget = document.getElementById('scannerTarget');
    const scannerPorts = document.getElementById('scannerPorts');
    const scannerInterfaceInfo = document.getElementById('scannerInterfaceInfo');

    let detectedSubnet = '';

    // Load network info to suggest a range
    try {
        const infoRes = await fetch('/api/network-info');
        if (!infoRes.ok) throw new Error(`Server returned ${infoRes.status}`);
        
        const data = await infoRes.json();
        const interfaces = data.interfaces || [];
        
        console.log('Detected interfaces:', interfaces);
        
        if (interfaces.length > 0) {
            scannerInterfaceInfo.innerHTML = interfaces.map(iface => 
                `<span style="margin-right: 15px; cursor: pointer; text-decoration: underline; ${iface.isClientSubnet ? 'font-weight: bold; color: #28a745;' : ''}" 
                    title="Click to set target" 
                    onclick="document.getElementById('scannerTarget').value='${iface.subnet}'">
                    ${iface.name}: ${iface.address} ${iface.isClientSubnet ? '(Your Network)' : ''}
                </span>`
            ).join('');

            // Pick the most likely subnet
            const primary = interfaces.find(i => i.isClientSubnet) || interfaces[0];
            if (primary && primary.subnet) {
                detectedSubnet = primary.subnet;
                
                if (scannerTarget && !scannerTarget.value) {
                    scannerTarget.value = detectedSubnet;
                }
            }
        } else {
            scannerInterfaceInfo.innerHTML = '<span style="color: #666; font-style: italic;">No active network interfaces detected.</span>';
        }
    } catch (err) {
        console.error('Failed to load network info:', err);
        scannerInterfaceInfo.innerHTML = `<span style="color: #dc3545; font-style: italic;">Network detection failed: ${err.message}</span>`;
    }

    const runScan = async (targetRange) => {
        const ports = scannerPorts.value;
        const target = targetRange || scannerTarget.value;

        if (!target) return alert('Please enter or detect a target IP range');

        try {
            const activeBtn = targetRange ? btnScanEntireNetwork : btnStartScan;
            
            activeBtn.textContent = 'Scanning...';
            activeBtn.disabled = true;
            if (!targetRange) btnScanEntireNetwork.disabled = true;
            else btnStartScan.disabled = true;

            const response = await fetch(`/api/scan?target=${encodeURIComponent(target)}&ports=${encodeURIComponent(ports)}`);
            if (!response.ok) throw new Error(await response.text());
            
            const results = await response.json();
            console.log(`[Scanner] Received ${results.length} results from server`);
            if (results.length > 0) {
                console.log('[Scanner] Sample result object keys:', Object.keys(results[0]));
                console.log('[Scanner] Sample result:', results[0]);
                const withMfg = results.filter(r => r.manufacturer && r.manufacturer !== 'Unknown');
                console.log(`[Scanner] Results with manufacturers: ${withMfg.length}/${results.length}`);
                if (withMfg.length > 0) {
                    console.log('[Scanner] First device with manufacturer:', withMfg[0]);
                } else {
                    console.warn('[Scanner] NO manufacturers found in results!');
                }
                console.table(results.map(r => ({ ip: r.ip, mac: r.mac, manufacturer: r.manufacturer })));
            }
            
            // Validate results before rendering
            if (!Array.isArray(results)) {
                throw new Error('Invalid response format from server');
            }
            
            renderScannerResults(results);
        } catch (err) {
            console.error('Network scan failed:', err);
            // Check if this is a Tabulator internal error (which we can ignore if results are shown)
            if (err.message && !err.message.includes('offsetWidth')) {
                alert('Scan failed: ' + err.message);
            }
        } finally {
            btnStartScan.textContent = 'Start Scan';
            btnScanEntireNetwork.textContent = 'Scan Entire Network';
            btnStartScan.disabled = false;
            btnScanEntireNetwork.disabled = false;
        }
    };

    if (btnStartScan) {
        btnStartScan.onclick = () => runScan();
    }

    if (btnScanEntireNetwork) {
        btnScanEntireNetwork.onclick = () => {
            if (!detectedSubnet) {
                return alert('Could not automatically detect your network. Please enter a range manually.');
            }
            if (scannerTarget) scannerTarget.value = detectedSubnet;
            runScan(detectedSubnet);
        };
    }
}

export function renderScannerResults(results) {
    console.log('Rendering scanner results:', results);
    window.lastScannerResults = results; // For debugging in console
    
    if (typeof Tabulator === 'undefined') {
        console.error('Tabulator is not loaded! Cannot render results.');
        return;
    }

    if (!scannerTabulator) {
        console.log('[Scanner] Initializing Tabulator with results:', results.length);
        console.log('[Scanner] Data sample for Tabulator:', results[0]);
        scannerTabulator = new Tabulator("#scanner-grid", {
            ...TABULATOR_BASE_CONFIG,
            data: results,
            placeholder: "No devices found",
            columns: [
                {title: "IP Address", field: "ip", sorter: "string", width: 120, headerFilter: "input", headerFilterFunc: (headerValue, rowValue) => {
                    // If user types a full IP, do exact match. Otherwise, do startsWith match.
                    const val = String(rowValue);
                    const search = String(headerValue);
                    
                    // Regex for full IPv4
                    const isFullIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(search);
                    
                    if (isFullIp) {
                        return val === search;
                    }
                    return val.startsWith(search);
                }},
                {title: "Hostname", field: "name", sorter: "string", width: 150},
                {title: "MAC Address", field: "mac", sorter: "string", width: 150},
                {title: "Manufacturer (Mfr)", field: "manufacturer", sorter: "string", width: 180, formatter: (cell) => {
                    const val = cell.getValue();
                    console.log(`[Scanner] Formatter for ${cell.getData().ip}: "${val}"`);
                    if (!val || val === 'Unknown') return `<span style="color: #999; font-style: italic;">Unknown</span>`;
                    return `<span style="color: #333; font-weight: 500;">${val}</span>`;
                }},
                {title: "Open Ports", field: "ports", formatter: (cell) => {
                    const ports = cell.getValue();
                    return ports && ports.length > 0 ? ports.join(', ') : '<span style="color:#999; font-style:italic;">None detected</span>';
                }},
                {title: "Status", field: "status", width: 100, formatter: (cell) => `<span style="color: green;">● Online</span>`},
                {title: "Action", width: 130, hozAlign: "center", formatter: () => `<button class="login-button" style="padding: 2px 10px; font-size: 11px;">Link to Asset</button>`, cellClick: (e, cell) => {
                    const data = cell.getData();
                    openLinkToAssetModal(data.ip, data.mac);
                }}
            ]
        });
        
        registerTabulator(scannerTabulator);
        
        // Ensure redraw on next tick to handle any flexbox initialization lag
        robustRedraw(scannerTabulator);
    } else {
        scannerTabulator.setData(results).then(() => {
            robustRedraw(scannerTabulator);
        });
    }
}

export function openLinkToAssetModal(ip, mac) {
    const modal = document.getElementById('linkAssetModal');
    const subtitle = document.getElementById('linkModalSubtitle');
    const select = document.getElementById('linkAssetSelect');
    const btnConfirm = document.getElementById('btnConfirmLinkAsset');

    subtitle.textContent = `Device: ${ip} ${mac !== 'Unknown' ? '(' + mac + ')' : ''}`;
    modal.style.display = 'flex';

    // Populate dropdown
    select.innerHTML = '<option value="">-- Select Asset --</option>';
    fetch('/api/assets')
        .then(res => res.json())
        .then(assets => {
            assets.sort((a, b) => (a.AssetName || '').localeCompare(b.AssetName || ''));
            assets.forEach(asset => {
                const opt = document.createElement('option');
                opt.value = asset.ID;
                opt.textContent = `${asset.AssetName || 'Unnamed'} (ID: ${asset.ID}${asset.AssetKindName ? ' - ' + asset.AssetKindName : ''})`;
                select.appendChild(opt);
            });
        })
        .catch(err => {
            console.error('Failed to load assets:', err);
            select.innerHTML = '<option value="">Error loading assets</option>';
        });

    btnConfirm.onclick = () => {
        const assetId = select.value;
        if (!assetId) return alert('Please select an asset');
        
        linkIpToAsset(ip, mac, assetId);
        modal.style.display = 'none';
    };
}

export async function linkIpToAsset(ip, mac, assetId) {
    try {
        const payload = { IPAddress: ip };
        if (mac && mac !== 'Unknown') {
            payload.MACAddress = mac;
        }

        const response = await fetch(`/api/assets/${assetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            alert(`Asset ${assetId} updated with IP ${ip} ${mac ? 'and MAC ' + mac : ''}`);
            if (window.loadAssets) window.loadAssets();
        } else {
            const err = await response.text();
            alert('Failed to link: ' + err);
        }
    } catch (err) {
        alert('Error linking: ' + err.message);
    }
}
