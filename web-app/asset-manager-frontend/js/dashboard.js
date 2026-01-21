import { showView, TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator } from './utils.js?v=3.8';
import { HierarchyManager } from './hierarchy.js?v=3.8';
import { DataProcessor } from './dataProcessor.js?v=4.1';
import { initScannerView } from './networkScanner.js?v=3.8';

console.log('DASHBOARD.JS: Module loading (v3.0)');

let searchVisible = false;

// Initialize Sheet View with Tabulator
// --- Delivery Challan (DC) Logic ---
let selectedDCAssets = [];
let selectedBatchAssets = [];
let isSelectionMode = false;

function toggleSelectionMode(enable) {
    isSelectionMode = enable;
    const overlay = document.getElementById('batchPrintOverlay');
    if (overlay) overlay.style.display = enable ? 'flex' : 'none';
    
    const btnBatch = document.getElementById('btnBatchPrintQr');
    if (btnBatch) {
        if (enable) {
            btnBatch.style.background = '#dc3545';
            btnBatch.querySelector('span').textContent = 'Exit Selection';
        } else {
            btnBatch.style.background = '#17a2b8';
            btnBatch.querySelector('span').textContent = 'Print QR';
            selectedBatchAssets = [];
            updateBatchOverlay();
        }
    }
    
    // Refresh current view to show/hide checkboxes
    const currentView = document.querySelector('.view:not(.hidden)');
    if (currentView && currentView.id === 'dashboardView') {
        renderDashboard(window.allAssets, () => {
            const category = localStorage.getItem('selectedAssetCategory');
            const query = window.currentSearchQuery;
            let assets = window.allAssets.filter(a => a.Category === category);
            if (query) assets = assets.filter(a => matchesQuery(a, query));
            return assets;
        });
    }
    
    // Also refresh asset list modal if open
    const assetListModal = document.getElementById('assetListModal');
    if (assetListModal && assetListModal.style.display === 'flex') {
        const title = document.getElementById('assetListTitle').textContent;
        const kindName = title.replace(' Inventory', '');
        showAssetList(kindName);
    }
}

function updateBatchOverlay() {
    const countSpan = document.getElementById('selectedCount');
    if (countSpan) countSpan.textContent = selectedBatchAssets.length;
    
    const overlay = document.getElementById('batchPrintOverlay');
    if (overlay) overlay.style.display = (isSelectionMode && selectedBatchAssets.length > 0) ? 'flex' : (isSelectionMode ? 'flex' : 'none');
}

function toggleAssetSelection(asset) {
    const index = selectedBatchAssets.findIndex(a => a.ID === asset.ID);
    if (index > -1) {
        selectedBatchAssets.splice(index, 1);
    } else {
        selectedBatchAssets.push(asset);
    }
    updateBatchOverlay();
}

function initDCView() {
    console.log('initDCView() called');
    const dcAssetSearch = document.getElementById('dcAssetSearch');
    const dcSearchResults = document.getElementById('dcSearchResults');
    const dcSelectedAssetsBody = document.getElementById('dcSelectedAssetsBody');
    const dcEmptyState = document.getElementById('dcEmptyState');
    const btnGenerateDC = document.getElementById('btnGenerateDC');
    const btnPrintDC = document.getElementById('btnPrintDC');
    
    // Set default date
    const dateInput = document.getElementById('dcDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    // Search assets for DC
    if (dcAssetSearch) {
        dcAssetSearch.oninput = (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query.length < 2) {
                dcSearchResults.style.display = 'none';
                return;
            }

            const category = localStorage.getItem('selectedAssetCategory') || 'IT';
            const matches = (window.allAssets || []).filter(a => 
                a.Category === category && 
                matchesQuery(a, query) &&
                !selectedDCAssets.find(s => s.ID === a.ID)
            ).slice(0, 10);

            if (matches.length > 0) {
                dcSearchResults.innerHTML = matches.map(a => `
                    <div class="search-result-item" data-id="${a.ID}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600;">${a.ItemName}</div>
                            <div style="font-size: 11px; color: #666;">ID: ${a.ID} | ${a.Status}</div>
                        </div>
                        <button class="add-asset-small" style="padding: 2px 8px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Add</button>
                    </div>
                `).join('');
                dcSearchResults.style.display = 'block';

                // Add click events to search results
                dcSearchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.onclick = () => {
                        const assetId = item.getAttribute('data-id');
                        const asset = window.allAssets.find(a => a.ID === assetId);
                        if (asset) {
                            addAssetToDC(asset);
                            dcAssetSearch.value = '';
                            dcSearchResults.style.display = 'none';
                        }
                    };
                });
            } else {
                dcSearchResults.innerHTML = '<div style="padding: 10px; color: #999;">No matching assets found</div>';
                dcSearchResults.style.display = 'block';
            }
        };
    }

    // Generate DC Button
    if (btnGenerateDC) {
        btnGenerateDC.onclick = async () => {
            const customerName = document.getElementById('dcCustomerName').value;
            const deliveryDate = document.getElementById('dcDate').value;
            const assetIds = selectedDCAssets.map(a => a.ID);

            if (!customerName) return alert('Please enter customer name');
            if (assetIds.length === 0) return alert('Please select at least one asset');

            try {
                btnGenerateDC.textContent = 'Generating...';
                btnGenerateDC.disabled = true;

                const response = await fetch('/api/dc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        CustomerName: customerName,
                        DeliveryDate: deliveryDate,
                        AssetIds: assetIds,
                        CreatedBy: localStorage.getItem('username') || 'System'
                    })
                });

                const result = await response.json();
                if (result.success) {
                    showDCPreview(result, customerName, deliveryDate);
                } else {
                    alert('Error creating DC: ' + result.error);
                }
            } catch (err) {
                console.error('DC Creation Error:', err);
                alert('Failed to connect to server');
            } finally {
                btnGenerateDC.textContent = 'Generate DC & QR Code';
                btnGenerateDC.disabled = false;
            }
        };
    }

    // Print DC Button
    if (btnPrintDC) {
        btnPrintDC.onclick = () => {
            window.print();
        };
    }
}

function addAssetToDC(asset) {
    selectedDCAssets.push(asset);
    renderSelectedAssets();
}

function removeAssetFromDC(assetId) {
    selectedDCAssets = selectedDCAssets.filter(a => a.ID !== assetId);
    renderSelectedAssets();
}

function renderSelectedAssets() {
    const dcSelectedAssetsBody = document.getElementById('dcSelectedAssetsBody');
    const dcEmptyState = document.getElementById('dcEmptyState');
    
    if (selectedDCAssets.length === 0) {
        dcSelectedAssetsBody.innerHTML = '';
        dcEmptyState.style.display = 'block';
        return;
    }

    dcEmptyState.style.display = 'none';
    dcSelectedAssetsBody.innerHTML = selectedDCAssets.map(a => `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-family: monospace; font-size: 12px;">${a.ID}</td>
            <td style="padding: 10px;">${a.ItemName}</td>
            <td style="padding: 10px; text-align: center;">
                <button onclick="removeAssetFromDC('${a.ID}')" style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 18px;">&times;</button>
            </td>
        </tr>
    `).join('');
}

// Expose to global for onclick handlers and main.js navigation
window.removeAssetFromDC = removeAssetFromDC;
window.initDCView = initDCView;
window.initSheetView = initSheetView;

function showDCPreview(result, customer, date) {
    const modal = document.getElementById('dcPreviewModal');
    const itemsBody = document.getElementById('dcPreviewItemsBody');
    
    document.getElementById('dcChallanNoDisplay').textContent = result.challanNo;
    document.getElementById('dcCustomerDisplay').textContent = customer;
    document.getElementById('dcDateDisplay').textContent = date;
    document.getElementById('dcQRCodeImage').src = result.qrCode;

    itemsBody.innerHTML = selectedDCAssets.map((a, index) => `
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${index + 1}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace;">${a.ID}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${a.ItemName} ${a.Model ? '- ' + a.Model : ''}</td>
        </tr>
    `).join('');

    modal.style.display = 'flex';
}

function initSheetView() {
    console.log('initSheetView() called');
    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
    const assets = (window.allAssets || []).filter(a => 
        a.Category === category && 
        !(a.isPlaceholder === true || a.isPlaceholder === 1 || a.isPlaceholder === 'true')
    );

    console.log('Assets for sheet view:', assets.length);

    if (window.tabulatorInstance) {
        window.tabulatorInstance.setData(assets).then(() => {
            robustRedraw(window.tabulatorInstance);
        });
        return;
    }

    const columns = [
        { title: "ID", field: "ID", width: 150, headerFilter: "input" },
        { title: "Type", field: "Type", width: 120, headerFilter: "input" },
        { title: "Item Name", field: "ItemName", editor: "input", headerFilter: "input" },
        { title: "Status", field: "Status", width: 120, editor: "select", editorParams: { values: ["In Store", "In Use", "In Repair", "Others"] }, headerFilter: "select", headerFilterParams: { values: ["In Store", "In Use", "In Repair", "Others"] } },
        { title: "Make", field: "Make", editor: "input", headerFilter: "input" },
        { title: "Model", field: "Model", editor: "input", headerFilter: "input" },
        { title: "Serial No", field: "SrNo", editor: "input", headerFilter: "input" },
        { title: "Location", field: "CurrentLocation", editor: "input", headerFilter: "input" },
        { title: "Assigned To", field: "AssignedTo", editor: "list", editorParams: { 
            values: () => (window.allEmployees || []).map(e => e.Name),
            autocomplete: true,
            allowEmpty: true,
            listOnEmpty: true
        }, headerFilter: "input" }
    ];

    if (category === 'IT') {
        columns.push(
            { title: "MAC Address", field: "MACAddress", editor: "input", headerFilter: "input" },
            { title: "IP Address", field: "IPAddress", editor: "input", headerFilter: "input" },
            { title: "Port", field: "PhysicalPort", editor: "input", headerFilter: "input" },
            { title: "VLAN", field: "VLAN", editor: "input", headerFilter: "input" },
            { title: "Socket ID", field: "SocketID", editor: "input", headerFilter: "input" },
            { title: "User ID", field: "UserID", editor: "input", headerFilter: "input" }
        );
    }

    columns.push(
        { title: "Parent ID", field: "ParentId", editor: "input", headerFilter: "input" },
        { title: "Last Updated", field: "LastUpdated", width: 150, hozAlign: "center" }
    );

    window.tabulatorInstance = new Tabulator("#excel-grid", {
        ...TABULATOR_BASE_CONFIG,
        data: assets,
        placeholder: "No assets found",
        initialSort: [
            { column: "ID", dir: "asc" },
        ],
        columns: columns,
        cellEdited: function(cell) {
            const data = cell.getRow().getData();
            console.log('Cell edited, saving asset:', data);
            window.saveAsset(data);
        }
    });

    registerTabulator(window.tabulatorInstance);
    
    // Ensure redraw to handle flexbox initialization
    robustRedraw(window.tabulatorInstance);
}

function matchesQuery(asset, query) {
    const fields = [
        asset.ID, asset.Id, 
        asset.SrNo, 
        asset.ItemName, asset.Name, 
        asset.Make, 
        asset.Model, 
        asset.DispatchReceiveDt, 
        asset.PurchaseDate,
        asset.AssignedTo,
        asset.ParentId,
        asset.MACAddress,
        asset.IPAddress,
        asset.PhysicalPort,
        asset.VLAN,
        asset.SocketID,
        asset.UserID
    ].map(f => String(f || '').toLowerCase());
    
    return fields.some(f => f.includes(query));
}

export function setupChildrenUI() {
    const btnAddChild = document.getElementById('btnAddChildField');
    if (btnAddChild) {
        btnAddChild.onclick = () => addChildField();
    }

    const searchInput = document.getElementById('linkComponentSearch');
    const resultsContainer = document.getElementById('linkComponentResults');
    const linkedList = document.getElementById('linkedComponentsList');

    if (searchInput && resultsContainer && linkedList) {
        searchInput.oninput = () => {
            const query = searchInput.value.toLowerCase().trim();
            if (query.length < 2) {
                resultsContainer.style.display = 'none';
                return;
            }

            const matches = (window.allAssets || []).filter(a => 
                (a.ID?.toLowerCase().includes(query) || a.ItemName?.toLowerCase().includes(query)) &&
                !a.NoQR // Only link assets with QR codes
            ).slice(0, 10);

            if (matches.length > 0) {
                resultsContainer.innerHTML = matches.map(m => `
                    <div class="search-result-item" data-id="${m.ID}" style="padding: 5px 10px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px;">
                        <b>${m.ID}</b> - ${m.ItemName}
                    </div>
                `).join('');
                resultsContainer.style.display = 'block';

                resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                    item.onclick = () => {
                        const id = item.getAttribute('data-id');
                        const asset = matches.find(m => m.ID === id);
                        addLinkedComponent(asset);
                        searchInput.value = '';
                        resultsContainer.style.display = 'none';
                    };
                });
            } else {
                resultsContainer.innerHTML = '<div style="padding: 5px 10px; font-size: 12px; color: #999;">No results</div>';
                resultsContainer.style.display = 'block';
            }
        };

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
                resultsContainer.style.display = 'none';
            }
        });
    }
}

export function addLinkedComponent(asset) {
    const linkedList = document.getElementById('linkedComponentsList');
    if (!linkedList) return;

    // Avoid duplicates
    if (linkedList.querySelector(`[data-id="${asset.ID}"]`)) return;

    const tag = document.createElement('div');
    tag.className = 'linked-component-tag';
    tag.setAttribute('data-id', asset.ID);
    tag.style = 'background: #e7f3ff; color: #0078d4; padding: 2px 8px; border-radius: 12px; font-size: 11px; display: flex; align-items: center; gap: 5px; border: 1px solid #0078d4;';
    tag.innerHTML = `
        <span>${asset.ID}</span>
        <span class="remove-link" style="cursor: pointer; font-weight: bold;">&times;</span>
    `;

    tag.querySelector('.remove-link').onclick = () => tag.remove();
    linkedList.appendChild(tag);
}

export function addChildField(data = null) {
    const container = document.getElementById('childrenListContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'child-asset-row';
    row.style = 'display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 8px; align-items: center; background: #f8f9fa; padding: 8px; border-radius: 4px; border: 1px solid #e9ecef;';
    
    const id = `child_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    row.innerHTML = `
        <input type="text" class="child-name" placeholder="Component Name (e.g. RAM)" value="${data?.ItemName || ''}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <input type="text" class="child-make" placeholder="Make" value="${data?.Make || ''}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <input type="text" class="child-srno" placeholder="Serial No" value="${data?.SrNo || ''}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <button type="button" class="remove-child-btn" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">&times;</button>
    `;

    row.querySelector('.remove-child-btn').onclick = () => row.remove();
    container.appendChild(row);
}

export function setupDashboard() {
    console.log('setupDashboard() called');

    // Setup Children / Components UI
    setupChildrenUI();
    
    // Navigation is now handled centrally in main.js. 
    // This function only handles dashboard-specific UI initialization.
    
    // Export Excel Handler
    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) {
        btnExportExcel.onclick = () => {
            if (window.tabulatorInstance) {
                window.tabulatorInstance.download("xlsx", "assets_inventory.xlsx", {sheetName:"Inventory"});
            }
        };
    }

    // Tally Sync Handler
    const btnSyncTally = document.getElementById('btnSyncTally');
    if (btnSyncTally) {
        btnSyncTally.onclick = async () => {
            const originalText = btnSyncTally.textContent;
            try {
                btnSyncTally.textContent = 'Syncing...';
                btnSyncTally.disabled = true;
                
                const response = await fetch('/api/tally/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reportName: 'Stock Summary' })
                });
                
                const result = await response.json();
                if (response.ok) {
                    alert(`Tally Sync Successful!\n${result.message}`);
                    if (window.loadAssets) await window.loadAssets(); // Refresh assets
                } else {
                    alert(`Tally Sync Failed: ${result.message}\n\nTip: ${result.tip || ''}`);
                }
            } catch (err) {
                console.error('Tally Sync Error:', err);
                alert('Failed to connect to backend for Tally sync.');
            } finally {
                btnSyncTally.textContent = originalText;
                btnSyncTally.disabled = false;
            }
        };
    }

    // Graph API Sync Handler (Placeholder for now)
    const btnSyncGraph = document.getElementById('btnSyncGraph');
    if (btnSyncGraph) {
        btnSyncGraph.onclick = () => {
            alert('Microsoft Graph API integration requires Azure AD app registration. Please configure Client ID in settings.');
            console.log('Graph API Sync requested');
        };
    }

    // Batch Print Handlers
    const btnBatchPrintQr = document.getElementById('btnBatchPrintQr');
    if (btnBatchPrintQr) {
        btnBatchPrintQr.onclick = () => {
            toggleSelectionMode(!isSelectionMode);
        };
    }

    const btnCancelSelection = document.getElementById('btnCancelSelection');
    if (btnCancelSelection) {
        btnCancelSelection.onclick = () => {
            toggleSelectionMode(false);
        };
    }

    const btnProceedBatchPrint = document.getElementById('btnProceedBatchPrint');
    if (btnProceedBatchPrint) {
        btnProceedBatchPrint.onclick = () => {
            if (selectedBatchAssets.length === 0) {
                alert('Please select at least one asset to print.');
                return;
            }
            showBatchPrintPreview();
        };
    }

    // Setup Search Logic
    const searchInput = document.querySelector('.sidebar-search input');
    if (searchInput) {
        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase().trim();
            window.currentSearchQuery = query; // Store globally for card clicks
            console.log('Searching for:', query);
            
            if (!query) {
                renderDashboard(window.allAssets, () => {
                    const category = localStorage.getItem('selectedAssetCategory');
                    return window.allAssets.filter(a => a.Category === category);
                });
                return;
            }

            const filtered = () => (window.allAssets || []).filter(a => matchesQuery(a, query));
            // Re-render dashboard with filtered assets
            renderDashboard(window.allAssets, filtered);
        };
    }

    // Handle Delegation for all dashboard interactions
    if (!window.dashboardEventsAttached) {
        console.log('Attaching dashboard global click listeners');
        document.addEventListener('click', (e) => {
            // 1. Handle Modal Close
            if (e.target.classList.contains('close-modal')) {
                const modal = e.target.closest('.modal');
                if (modal) modal.style.display = 'none';
                return;
            }
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
                return;
            }
            
            // 2. Handle Add Asset Kind Button (top right)
            if (e.target.id === 'btnAddAssetKind' || e.target.closest('#btnAddAssetKind')) {
                console.log('Add Asset Kind button clicked');
                openAddKindModal();
                return;
            }

            // 2b. Handle Add Asset Item Button (top right)
            if (e.target.id === 'btnAddAssetItem' || e.target.closest('#btnAddAssetItem')) {
                console.log('Add Asset Item button clicked');
                openAddItemModal(); // Open without a pre-filled kind
                return;
            }

            // 3. Handle Add Asset Item Button (on cards)
            const addBtn = e.target.classList.contains('asset-card-add-button') ? e.target : e.target.closest('.asset-card-add-button');
            if (addBtn) {
                e.preventDefault();
                e.stopPropagation();
                const kind = addBtn.getAttribute('data-kind');
                console.log('Add Asset Item button clicked for kind:', kind);
                openAddItemModal(kind);
                return;
            }

            // 4. Handle Card Click (Show Asset List)
            const card = e.target.classList.contains('asset-card') ? e.target : e.target.closest('.asset-card');
            if (card) {
                const kind = card.getAttribute('data-kind');
                console.log('Card clicked for kind:', kind);
                showAssetList(kind);
                return;
            }
        });
        window.dashboardEventsAttached = true;
    }

    // Setup Bulk Upload Listener
    const bulkUploadFile = document.getElementById('bulkUploadFile');
    if (bulkUploadFile) {
        bulkUploadFile.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const kind = document.getElementById('itemKind').value;
            const category = localStorage.getItem('selectedAssetCategory');
            await handleBulkUpload(file, kind, category);
        };
    }

    // Setup Search Button
    const btnSearchBy = document.getElementById('btnSearchBy');
    const searchPanel = document.getElementById('searchPanel');
    if (btnSearchBy && searchPanel) {
        btnSearchBy.onclick = () => {
            searchVisible = !searchVisible;
            searchPanel.style.display = searchVisible ? 'block' : 'none';
        };
    }

    // --- Project System Initialization ---
    const btnSideSubmitProject = document.getElementById('btnSideSubmitProject');
    if (btnSideSubmitProject) {
        btnSideSubmitProject.onclick = async () => {
            const name = document.getElementById('sideProjectName').value.trim();
            const client = document.getElementById('sideProjectClient').value.trim();
            const location = document.getElementById('sideProjectLocation').value;
            const currency = document.getElementById('sideProjectCurrency').value;
            const description = document.getElementById('sideProjectDesc').value.trim();
            const startDate = document.getElementById('sideProjectStartDate').value;
            const endDate = document.getElementById('sideProjectEndDate').value;
            
            if (!name || !client) {
                alert('Please fill in both Project Name and Client Name');
                return;
            }

            try {
                btnSideSubmitProject.disabled = true;
                btnSideSubmitProject.textContent = 'Creating...';
                
                const response = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name, 
                        client, 
                        location,
                        currency,
                        description,
                        startDate,
                        endDate,
                        status: 'Active'
                    })
                });
                const data = await response.json();
                
                if (data.id) {
                    // Reset form fields
                    document.getElementById('sideProjectName').value = '';
                    document.getElementById('sideProjectClient').value = '';
                    document.getElementById('sideProjectDesc').value = '';
                    document.getElementById('sideProjectStartDate').value = '';
                    document.getElementById('sideProjectEndDate').value = '';
                    
                    // Close modal
                    const modal = document.getElementById('createProjectModal');
                    if (modal) modal.style.display = 'none';
                    
                    alert('Project created successfully!');
                    initProjectsView();
                } else {
                    alert('Error creating project: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('Error creating project:', err);
                alert('Error creating project: ' + err.message);
            } finally {
                btnSideSubmitProject.disabled = false;
                btnSideSubmitProject.textContent = 'Initialize Project';
            }
        };
    }

    // Project Search Handler
    const projectSearch = document.getElementById('projectSearch');
    if (projectSearch) {
        projectSearch.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            const columns = document.querySelectorAll('.kanban-column');
            
            columns.forEach(column => {
                const cards = column.querySelectorAll('.project-card');
                let visibleInColumn = 0;
                
                cards.forEach(card => {
                    const text = card.textContent.toLowerCase();
                    if (text.includes(term)) {
                        card.style.display = 'flex';
                        visibleInColumn++;
                    } else {
                        card.style.display = 'none';
                    }
                });
                
                // Update the count in the header to reflect filtered results
                const countBadge = column.querySelector('.kanban-column-count');
                if (countBadge) countBadge.textContent = visibleInColumn;
                
                // Optional: Fade the column if it has no matches
                column.style.opacity = visibleInColumn === 0 && term ? '0.4' : '1';
            });
        };
    }
}

// --- Project View Functions ---
const CURRENCY_SYMBOLS = {
    'USD': '$', 'EUR': '€', 'JPY': '¥', 'INR': '₹', 'GBP': '£',
    'CNY': '¥', 'CAD': 'C$', 'AED': 'د.إ', 'AUD': 'A$', 'SGD': 'S$'
};

// Fallback exchange rates (will be updated by API)
let EXCHANGE_RATES = {
    'USD': 1.0,
    'INR': 83.0,
    'EUR': 0.92,
    'GBP': 0.79,
    'JPY': 150.0,
    'CNY': 7.2,
    'CAD': 1.35,
    'AED': 3.67,
    'AUD': 1.52,
    'SGD': 1.34
};

async function fetchExchangeRates() {
    try {
        // Check if we have cached rates from today
        const cached = localStorage.getItem('exchangeRates');
        const cacheTimestamp = localStorage.getItem('exchangeRatesTimestamp');
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        if (cached && cacheTimestamp && (now - cacheTimestamp < oneDay)) {
            EXCHANGE_RATES = JSON.parse(cached);
            console.log('Using cached exchange rates');
            return;
        }

        console.log('Fetching live exchange rates...');
        // Using Frankfurter API (Free, no key required)
        const response = await fetch('https://api.frankfurter.app/latest?from=USD');
        const data = await response.json();
        
        if (data && data.rates) {
            // Update rates (Frankfurter provides rates relative to base, here USD)
            EXCHANGE_RATES = {
                'USD': 1.0,
                ...data.rates
            };
            
            // Cache them
            localStorage.setItem('exchangeRates', JSON.stringify(EXCHANGE_RATES));
            localStorage.setItem('exchangeRatesTimestamp', now.toString());
            console.log('Exchange rates updated from API');
        }
    } catch (err) {
        console.warn('Failed to fetch live exchange rates, using fallbacks:', err);
    }
}

// Initialize rates immediately
fetchExchangeRates();

function getCurrencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code || '$';
}

function convertCurrency(amount, fromCurr, toCurr) {
    if (!amount) return 0;
    const from = fromCurr || 'INR';
    const to = toCurr || 'INR';
    
    if (from === to) return parseFloat(amount);
    
    // Convert from fromCurr to USD, then from USD to toCurr
    // If a currency is missing from rates, we fallback to a safe 1:1 or log warning
    if (!EXCHANGE_RATES[from] || !EXCHANGE_RATES[to]) {
        console.warn(`Missing exchange rate for ${from} or ${to}`);
        return parseFloat(amount);
    }

    const amountInUSD = parseFloat(amount) / EXCHANGE_RATES[from];
    return amountInUSD * EXCHANGE_RATES[to];
}

let currentProjectId = null;
let allProjects = [];
let currentProjectCurrency = 'INR';

window.initProjectsView = async function() {
    console.log('initProjectsView() called');
    const projectsGrid = document.getElementById('projectsGrid');
    const projectCount = document.getElementById('projectCount');
    
    if (!projectsGrid) {
        console.error('CRITICAL: projectsGrid element not found!');
        return;
    }

    try {
        console.log('Fetching projects from /api/projects...');
        const response = await fetch('/api/projects').catch(err => {
            console.error('Fetch error:', err);
            throw new Error(`Network error or server unreachable: ${err.message}`);
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error body');
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        allProjects = await response.json();
        console.log('Successfully loaded projects:', allProjects.length);
        
        if (projectCount) projectCount.textContent = `${allProjects.length} Projects`;
        
        if (!allProjects || allProjects.length === 0) {
            projectsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: #fdfdfd; border-radius: 8px; border: 2px dashed #eee;">
                    <div style="font-size: 64px; margin-bottom: 20px; opacity: 0.5;">📁</div>
                    <h3 style="color: #444; margin-bottom: 10px;">No projects found</h3>
                    <p style="color: #888; max-width: 300px; margin: 0 auto;">Use the form on the left to create your first project and start managing assets.</p>
                </div>
            `;
            return;
        }

        // Kanban Setup
        const columns = {
            'Planning': [],
            'Active': [],
            'Completed': [],
            'On Hold': []
        };

        allProjects.forEach(p => {
            const status = p.Status || 'Planning';
            if (columns[status]) {
                columns[status].push(p);
            } else {
                columns['Planning'].push(p);
            }
        });

        projectsGrid.classList.add('kanban-board');
        projectsGrid.innerHTML = Object.entries(columns).map(([status, projects]) => {
            const statusClass = `status-${status.toLowerCase().replace(' ', '-')}`;
            return `
                <div class="kanban-column" 
                     ondragover="allowDrop(event)" 
                     ondragleave="dragLeave(event)"
                     ondrop="dropProject(event, '${status}')"
                     style="flex: 0 0 clamp(300px, 28vw, 380px); display: flex; flex-direction: column;">
                  <div class="kanban-column-header" style="padding: 1rem 1.25rem; flex-shrink: 0;">
                    <h4 class="kanban-column-title" style="margin: 0; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${status}</h4>
                    <span class="kanban-column-count" style="background: #eee; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem; flex-shrink: 0;">${projects.length}</span>
                  </div>
                  <div class="kanban-column-content" style="padding: 1rem; flex: 1; overflow-y: auto; min-height: 0;">
                    ${projects.map(p => `
                      <div class="project-card" 
                           draggable="true" 
                           ondragstart="dragProject(event, '${p.ID}')"
                           onclick="showProjectDetails('${p.ID}')" 
                           style="margin-bottom: 1rem; padding: 1rem; flex-shrink: 0; cursor: grab;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; gap: 8px;">
                          <div class="project-status-pill ${statusClass}" style="font-size: 0.65rem; padding: 3px 10px; border-radius: 4px; font-weight: 700; text-transform: uppercase; white-space: nowrap;">
                            ${status}
                          </div>
                          <div style="font-size: 0.65rem; color: #aaa; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.ID}</div>
                        </div>
                        
                        <h3 style="margin: 0.5rem 0; color: #1a1a1a; font-size: 1rem; line-height: 1.4; font-weight: 700; word-break: break-word;">${p.Name}</h3>
                        
                        <div class="client-name" style="color: #666; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                          <span style="opacity: 0.6; flex-shrink: 0;">🏢</span> 
                          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.ClientName}</span>
                        </div>
                        
                        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #888;">
                          <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="opacity: 0.7;">📅</span> ${p.StartDate ? new Date(p.StartDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'N/A'}
                          </div>
                          <div style="color: #0078d4; font-weight: 700; font-size: 0.8rem;">Details →</div>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error('Error loading projects:', err);
        projectsGrid.innerHTML = `<div style="color: red; padding: 20px; grid-column: 1/-1; text-align: center;">Error loading projects: ${err.message}</div>`;
    }
}

// Drag and Drop Handlers
window.dragProject = function(ev, projectId) {
    ev.dataTransfer.setData("projectId", projectId);
    ev.currentTarget.style.opacity = '0.4';
};

window.allowDrop = function(ev) {
    ev.preventDefault();
    const column = ev.currentTarget.closest('.kanban-column');
    if (column) column.classList.add('drag-over');
};

window.dragLeave = function(ev) {
    const column = ev.currentTarget.closest('.kanban-column');
    if (column) column.classList.remove('drag-over');
};

window.dropProject = async function(ev, newStatus) {
    ev.preventDefault();
    const column = ev.currentTarget.closest('.kanban-column');
    if (column) column.classList.remove('drag-over');
    
    const projectId = ev.dataTransfer.getData("projectId");
    
    // Reset opacity of dragged element
    const draggedEl = document.querySelector(`[ondragstart*="${projectId}"]`);
    if (draggedEl) draggedEl.style.opacity = '1';

    try {
        await updateProjectStatus(projectId, newStatus);
        initProjectsView(); // Refresh board
    } catch (err) {
        console.error('Failed to move project:', err);
        alert('Failed to move project');
    }
};

window.updateProjectStatus = async function(projectId, status) {
    const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'x-user': localStorage.getItem('currentUser') ? JSON.parse(localStorage.getItem('currentUser')).username : 'web'
        },
        body: JSON.stringify({ status })
    });

    let data;
    try {
        data = await response.json();
    } catch (e) {
        data = { error: 'Invalid server response' };
    }

    if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
    }
    return data;
};

window.showProjectDetails = async function(projectId) {
    currentProjectId = projectId;
    const modal = document.getElementById('projectDetailsModal');
    const title = document.getElementById('modalProjectTitle');
    const clientInfo = document.getElementById('projectClientInfo');
    const projectStats = document.getElementById('projectStats');
    const clientUserAction = document.getElementById('clientUserAction');
    
    // Hide client user creation for non-admins
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
        const user = JSON.parse(userStr);
        if (clientUserAction) {
            clientUserAction.style.display = (user.role === 'admin' || user.role === 'superuser') ? 'block' : 'none';
        }
    }

    try {
        const response = await fetch(`/api/projects/${projectId}`);
        const project = await response.json();
        
        currentProjectCurrency = project.Currency || 'INR';
        const projectSymbol = getCurrencySymbol(currentProjectCurrency);
        
        title.textContent = project.Name;
        clientInfo.innerHTML = `
            <div class="info-group">
                <label>Client</label>
                <div class="value">${project.ClientName}</div>
            </div>
            <div class="info-group">
                <label>Location</label>
                <div class="value">${project.Location || 'MUMBAI'}</div>
            </div>
            <div class="info-group">
                <label>Currency</label>
                <div class="value">${currentProjectCurrency} (${projectSymbol})</div>
            </div>
            <div class="info-group">
                <label>Start Date</label>
                <div class="value">${project.StartDate ? new Date(project.StartDate).toLocaleDateString() : 'Not set'}</div>
            </div>
            <div class="info-group">
                <label>Status</label>
                <select class="status-select" onchange="updateProjectStatus('${project.ID}', this.value).then(() => initProjectsView())" style="
                    padding: 4px 12px;
                    border-radius: 4px;
                    border: 1px solid #ddd;
                    font-size: 0.85rem;
                    background: #fff;
                    cursor: pointer;
                    width: 100%;
                    margin-top: 4px;
                ">
                    <option value="Planning" ${project.Status === 'Planning' ? 'selected' : ''}>Planning</option>
                    <option value="Active" ${project.Status === 'Active' ? 'selected' : ''}>Active</option>
                    <option value="Completed" ${project.Status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="On Hold" ${project.Status === 'On Hold' ? 'selected' : ''}>On Hold</option>
                </select>
            </div>
        `;

        // Load assets and calculate stats
        const assets = await loadProjectAssets(projectId);
        const tempAssets = await loadProjectTempAssets(projectId);
        
        // Calculate total value in project currency
        let totalValue = 0;
        assets.forEach(a => {
            if (a.AssignmentType !== 'Temporary') {
                totalValue += convertCurrency(a.EstimatedPrice || 0, a.Currency || 'INR', currentProjectCurrency);
            }
        });
        tempAssets.forEach(a => {
            totalValue += convertCurrency(a.EstimatedPrice || 0, a.Currency || 'INR', currentProjectCurrency);
        });
        
        projectStats.innerHTML = `
            <div class="stat-item">
                <span class="stat-value">${assets.filter(a => a.AssignmentType !== 'Temporary').length}</span>
                <span class="stat-label">Permanent Assets</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${tempAssets.length}</span>
                <span class="stat-label">Temp Assets</span>
            </div>
            <div class="stat-item" style="grid-column: span 2;">
                <span class="stat-value">${projectSymbol}${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <span class="stat-label">Total Est. Value (${currentProjectCurrency})</span>
            </div>
        `;

        // Ensure we show the first tab by default
        switchProjectTab('assets');

        modal.style.display = 'block';
    } catch (err) {
        console.error('Error loading project details:', err);
        alert('Error loading project details');
    }
};

window.showAssignAssetModal = async function() {
    if (!currentProjectId) return;
    const modal = document.getElementById('assignAssetModal');
    const select = document.getElementById('assignAssetSelect');
    if (!modal || !select) return;

    try {
        select.innerHTML = '<option value="">-- Loading Assets --</option>';
        modal.style.display = 'block';

        const response = await fetch('/api/assets');
        const allAssets = await response.json();
        if (allAssets.error) throw new Error(allAssets.error);
        
        // Get already assigned assets for this project to exclude them
        const assignedResponse = await fetch(`/api/projects/${currentProjectId}/assets`);
        const assignedAssets = await assignedResponse.json();
        if (assignedAssets.error) throw new Error(assignedAssets.error);
        
        const assignedIds = new Set(Array.isArray(assignedAssets) ? assignedAssets.map(a => a.ID) : []);

        const availableAssets = (Array.isArray(allAssets) ? allAssets : []).filter(a => !assignedIds.has(a.ID));

        if (availableAssets.length === 0) {
            select.innerHTML = '<option value="">No available assets to assign</option>';
        } else {
            select.innerHTML = '<option value="">-- Select an Asset --</option>' + 
                availableAssets.map(a => `<option value="${a.ID}">${a.ID} - ${a.ItemName} (${a.Status})</option>`).join('');
        }
    } catch (err) {
        console.error('Error loading assets for assignment:', err);
        select.innerHTML = '<option value="">Error loading assets</option>';
    }
};

window.showAddTempAssetModal = function() {
    if (!currentProjectId) return;
    const modal = document.getElementById('addTempAssetModal');
    if (modal) {
        // Reset form
        document.getElementById('tempItemName').value = '';
        document.getElementById('tempMake').value = '';
        document.getElementById('tempModel').value = '';
        document.getElementById('tempPrice').value = '';
        document.getElementById('tempQuantity').value = '1';
        modal.style.display = 'block';
    }
};

async function loadProjectAssets(projectId) {
    console.log('loadProjectAssets called for:', projectId);
    const tbody = document.getElementById('projectAssetsTableBody');
    if (!tbody) {
        console.error('projectAssetsTableBody not found!');
        return [];
    }
    try {
        const response = await fetch(`/api/projects/${projectId}/assets`);
        const assets = await response.json();
        console.log(`Loaded ${assets.length} assets for project ${projectId}`, assets);
        
        tbody.innerHTML = assets.map(a => {
            const isTemp = a.AssignmentType === 'Temporary';
            const statusClass = `status-${(a.Status || 'active').toLowerCase().replace(' ', '-')}`;
            
            // Fix for missing property names in database
            const displayName = a.ItemName || a.Name || 'Unnamed Asset';
            
            return `
                <tr>
                    <td><strong>${a.ID}</strong></td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>${a.Icon || (isTemp ? '🧩' : '📦')}</span>
                            ${displayName}
                        </div>
                    </td>
                    <td><span class="status-pill ${statusClass}" style="font-size: 10px; padding: 2px 8px;">${a.Status || 'Active'}</span></td>
                    <td>${a.Category || '-'}</td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="${isTemp ? `showTempAssetDetails('${a.ID}')` : `showAssetDetails('${a.ID}')`}" class="btn-action" style="font-size: 11px; background: #f0f0f0; color: #333;">View</button>
                            ${!isTemp ? `<button onclick="unassignAsset('${a.ID}')" class="btn-action" style="font-size: 11px; background: #fff1f0; color: #cf1322; border-color: #ffa39e;">Unassign</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="5" style="text-align:center; padding: 40px; color: #666;">No assets assigned to this project yet.</td></tr>';
        
        return assets;
    } catch (err) {
        console.error('Error loading project assets:', err);
        return [];
    }
}

window.showAssetDetails = async function(assetId) {
    // Basic implementation to show asset details
    alert(`Viewing Permanent Asset: ${assetId}\n(Full details modal can be implemented here)`);
};

window.showTempAssetDetails = async function(assetId) {
    alert(`Viewing Temporary Asset: ${assetId}\n(Full details modal can be implemented here)`);
};

window.makeAssetPermanent = async function(id) {
    if (!confirm('Convert this temporary asset to a permanent asset?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${id}/make-permanent`, {
            method: 'POST',
            headers: {
                'x-user': localStorage.getItem('username') || 'web'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            alert(`Asset converted successfully! New ID: ${result.assetId || result.permanentId}`);
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            if (window.loadAssets) await window.loadAssets();
            
            // Refresh Project view if active
            if (currentProjectId) {
                if (typeof loadProjectAssets === 'function') await loadProjectAssets(currentProjectId);
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            const err = await response.text();
            alert('Error converting asset: ' + err);
        }
    } catch (err) {
        console.error('Conversion error:', err);
        alert('Failed to convert asset');
    }
};

window.deleteTempAsset = async function(id) {
    if (!confirm('Are you sure you want to delete this temporary asset?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert('Temporary asset deleted.');
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            
            // Refresh Project view if active
            if (currentProjectId) {
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            const err = await response.text();
            alert('Error deleting asset: ' + err);
        }
    } catch (err) {
        console.error('Delete error:', err);
        alert('Failed to delete asset');
    }
};

async function loadProjectTempAssets(projectId) {
    const tbody = document.getElementById('projectTempAssetsTableBody');
    if (!tbody) {
        console.warn('projectTempAssetsTableBody not found!');
        return [];
    }
    try {
        const response = await fetch(`/api/projects/${projectId}/temporary-assets`);
        const assets = await response.json();
        
        const projectSymbol = getCurrencySymbol(currentProjectCurrency);
        tbody.innerHTML = assets.map(a => {
            const convertedPrice = convertCurrency(a.EstimatedPrice || 0, a.Currency || 'INR', currentProjectCurrency);
            return `
            <tr>
                <td><small style="font-family: monospace; color: #666;">${a.ID}</small></td>
                <td><strong>${a.ItemName}</strong></td>
                <td>${a.Make || '-'} / ${a.Model || '-'}</td>
                <td>${a.Quantity || 1}</td>
                <td><strong>${projectSymbol}${convertedPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button onclick="makeAssetPermanent('${a.ID}')" class="btn-action" style="font-size: 11px; background: #e6f7ff; color: #1890ff; border-color: #91d5ff;">Convert to Permanent</button>
                        <button onclick="deleteTempAsset('${a.ID}')" class="btn-action" style="font-size: 11px; background: #fff1f0; color: #cf1322; border-color: #ffa39e;">Delete</button>
                    </div>
                </td>
            </tr>
        `}).join('') || '<tr><td colspan="6" style="text-align:center; padding: 40px; color: #666;">No temporary assets added.</td></tr>';
        
        return assets;
    } catch (err) {
        console.error('Error loading temp assets:', err);
        return [];
    }
}

window.switchProjectTab = function(tabName) {
    console.log('Switching to tab:', tabName);
    
    // Hide all tab contents and remove active class
    document.querySelectorAll('.project-tab-content').forEach(t => {
        t.style.display = 'none';
        t.classList.remove('active');
    });
    
    // Update active button state
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.getAttribute('onclick')?.includes(`'${tabName}'`)) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    
    // Show selected tab content
    let contentId = `project${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`;
    // Fix for temporary assets tab ID mismatch
    if (tabName === 'temp') contentId = 'projectTempAssetsTab';
    
    const content = document.getElementById(contentId);
    if (content) {
        content.style.display = 'block';
        content.classList.add('active');
        console.log('Showing content:', contentId);
    } else {
        console.warn('Tab content not found:', contentId);
    }
    
    if (tabName === 'bom') generateProjectBOM();
    if (tabName === 'assets') {
        if (currentProjectId) loadProjectAssets(currentProjectId);
    }
    if (tabName === 'temp') {
        if (currentProjectId) loadProjectTempAssets(currentProjectId);
    }
};

window.showCreateClientUserModal = async function() {
    if (!currentProjectId) return;
    const username = prompt('Enter login username for client:');
    if (!username) return;
    const password = prompt('Enter login password:');
    if (!password) return;
    const fullname = prompt('Enter display name (optional):');

    try {
        const response = await fetch(`/api/projects/${currentProjectId}/create-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, fullname })
        });
        const result = await response.json();
        if (result.success) {
            alert('Client user account created successfully!');
        } else {
            alert('Error: ' + result.error);
        }
    } catch (err) {
        console.error('Error creating client user:', err);
        alert('Error creating client user');
    }
};

// Initialize the confirm button handler
document.addEventListener('DOMContentLoaded', () => {
    const btnConfirm = document.getElementById('btnConfirmAssignAsset');
    if (btnConfirm) {
        btnConfirm.onclick = async () => {
            const assetId = document.getElementById('assignAssetSelect').value;
            
            if (!assetId) {
                alert('Please select an asset');
                return;
            }

            try {
                btnConfirm.disabled = true;
                btnConfirm.textContent = 'Assigning...';

                const response = await fetch(`/api/projects/${currentProjectId}/assign-asset`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ AssetID: assetId, Type: 'Permanent' })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Asset assigned successfully!');
                    document.getElementById('assignAssetModal').style.display = 'none';
                    await loadProjectAssets(currentProjectId);
                } else {
                    alert('Error assigning asset: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('Error assigning asset:', err);
                alert('Error assigning asset: ' + err.message);
            } finally {
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Assign to Project';
            }
        };
    }
});

// Initialize the temp asset submission handler
document.addEventListener('DOMContentLoaded', () => {
    // ... existing confirm assignment handler ...
    const btnSubmitTempAsset = document.getElementById('btnSubmitTempAsset');
    if (btnSubmitTempAsset) {
        btnSubmitTempAsset.onclick = async () => {
            const itemName = document.getElementById('tempItemName').value.trim();
            const make = document.getElementById('tempMake').value.trim();
            const model = document.getElementById('tempModel').value.trim();
            const estimatedPrice = document.getElementById('tempPrice').value || 0;
            const quantity = document.getElementById('tempQuantity').value || 1;
            const currency = document.getElementById('tempCurrency').value || 'USD';

            if (!itemName) {
                alert('Please enter an Item Name');
                return;
            }

            try {
                btnSubmitTempAsset.disabled = true;
                btnSubmitTempAsset.textContent = 'Adding...';

                const response = await fetch(`/api/projects/${currentProjectId}/temporary-assets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ itemName, make, model, estimatedPrice, quantity, currency })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Temporary asset added successfully!');
                    document.getElementById('addTempAssetModal').style.display = 'none';
                    await loadProjectAssets(currentProjectId);
                    await loadProjectTempAssets(currentProjectId);
                } else {
                    alert('Error adding asset: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('Error adding temp asset:', err);
                alert('Error adding temp asset: ' + err.message);
            } finally {
                btnSubmitTempAsset.disabled = false;
                btnSubmitTempAsset.textContent = 'Add to Project';
            }
        };
    }
});

window.unassignAsset = async function(assetId) {
    if (!currentProjectId) return;
    if (!confirm(`Are you sure you want to unassign asset ${assetId} from this project?`)) return;

    try {
        const response = await fetch(`/api/projects/${currentProjectId}/unassign-asset/${assetId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            alert('Asset unassigned successfully');
            loadProjectAssets(currentProjectId);
        } else {
            alert('Error: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Error unassigning asset:', err);
        alert('Error unassigning asset');
    }
};

window.makeAssetPermanent = async function(tempAssetId) {
    if (!confirm('Convert this temporary asset to a permanent asset in the inventory?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${tempAssetId}/make-permanent`, {
            method: 'POST',
            headers: {
                'x-user': localStorage.getItem('username') || 'web'
            }
        });
        const result = await response.json();
        if (result.success) {
            alert(`Asset converted successfully! New ID: ${result.permanentId}`);
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            if (window.loadAssets) await window.loadAssets();
            
            // Refresh Project view if active
            if (currentProjectId) {
                if (typeof loadProjectAssets === 'function') await loadProjectAssets(currentProjectId);
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            alert('Error: ' + (result.error || 'Failed to convert'));
        }
    } catch (err) {
        console.error('Error converting asset:', err);
        alert('Error converting asset');
    }
};

window.deleteTempAsset = async function(tempAssetId) {
    if (!confirm('Are you sure you want to delete this temporary item?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${tempAssetId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            alert('Temporary item deleted successfully!');
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            if (window.loadAssets) await window.loadAssets();

            // Refresh Project view if active
            if (currentProjectId) {
                if (typeof loadProjectAssets === 'function') await loadProjectAssets(currentProjectId);
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            alert('Error: ' + (result.error || 'Failed to delete'));
        }
    } catch (err) {
        console.error('Error deleting temp asset:', err);
        alert('Error deleting temp asset');
    }
};

window.printBOM = function() {
    // The BOM content is in the 'bomContent' div (as seen in generateProjectBOM)
    const bomContent = document.getElementById('bomContent');
    if (!bomContent) {
        console.error('BOM content element not found');
        return;
    }
    
    // Get project info
    const projectName = document.getElementById('modalProjectTitle')?.textContent || 'Project BOM';
    
    // Create a hidden iframe for printing (bypasses popup blockers)
    let printFrame = document.getElementById('bomPrintFrame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'bomPrintFrame';
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);
    }
    
    const doc = printFrame.contentWindow.document;
    
    // Build the HTML for the print window
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${projectName} - BOM/BOQ</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    padding: 20px;
                    color: #333;
                }
                .print-header {
                    margin-bottom: 20px;
                    border-bottom: 2px solid #eee;
                    padding-bottom: 10px;
                }
                .print-header h1 { margin: 0; font-size: 24px; color: #2c3e50; }
                .print-header p { margin: 5px 0; font-size: 14px; color: #666; }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }
                th {
                    background-color: #f8f9fa !important;
                    -webkit-print-color-adjust: exact;
                    text-align: left;
                    padding: 10px;
                    border-bottom: 2px solid #dee2e6;
                    font-size: 13px;
                }
                td {
                    padding: 10px;
                    border-bottom: 1px solid #eee;
                    font-size: 13px;
                }
                .status-pill {
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    background: #eee;
                }
                .status-active { background: #e1f5fe; color: #01579b; }
                
                /* Hide UI elements from the copied HTML */
                .btn-action, button, .no-print { display: none !important; }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>${projectName}</h1>
                <p>Bill of Materials / Bill of Quantities</p>
                <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>
            ${bomContent.innerHTML}
        </body>
        </html>
    `;
    
    doc.open();
    doc.write(html);
    doc.close();
    
    // Wait for content to be ready and print
    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
    }, 250);
};

window.generateProjectBOM = async function() {
    if (!currentProjectId) return;
    const bomContent = document.getElementById('bomContent');
    if (!bomContent) return;

    try {
        // /api/projects/:id/assets returns both permanent and temporary assets
        const response = await fetch(`/api/projects/${currentProjectId}/assets`);
        const allItems = await response.json();
        
        if (allItems.error) throw new Error(allItems.error);
        if (!Array.isArray(allItems) || allItems.length === 0) {
            bomContent.innerHTML = '<div style="text-align:center; padding: 40px; color: #666;">No items in BOM/BOQ yet.</div>';
            return;
        }

        const summary = {};
        const projectSymbol = getCurrencySymbol(currentProjectCurrency);

        allItems.forEach(item => {
            const name = item.ItemName || item.Name || 'Unnamed Asset';
            const make = item.Make || '';
            const model = item.Model || '';
            const currency = item.Currency || 'INR';
            
            const idStr = (item.ID || '').toString();
            const isTempId = idStr.startsWith('TEMP') || idStr.startsWith('MUMT-');
            const type = item.AssignmentType || (item.ID && isTempId ? 'Temporary' : 'Permanent');
            
            // Convert price to project currency
            const priceInProjectCurr = convertCurrency(item.EstimatedPrice || 0, currency, currentProjectCurrency);
            
            const key = `${name} (${make} ${model}) [${type}]`.trim();
            if (!summary[key]) {
                summary[key] = { 
                    name, make, model, type,
                    count: 0, 
                    price: priceInProjectCurr
                };
            }
            summary[key].count += (item.Quantity || 1);
        });

        let html = `
            <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 20px; border-left: 4px solid #0078d4;">
                <h3 style="margin-top: 0; color: #2c3e50; font-size: 16px;">Consolidated Bill of Materials</h3>
                <p style="margin-bottom: 0; color: #666; font-size: 13px;">Project Base Currency: <strong>${currentProjectCurrency}</strong>. All items converted for uniformity.</p>
            </div>
            <div class="table-container">
                <table class="project-table">
                    <thead>
                        <tr>
                            <th>Item Description</th>
                            <th style="text-align: center;">Type</th>
                            <th style="text-align: center;">Qty</th>
                            <th style="text-align: right;">Unit Price (${currentProjectCurrency})</th>
                            <th style="text-align: right;">Total (${currentProjectCurrency})</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        let grandTotal = 0;
        for (const data of Object.values(summary)) {
            const total = data.count * data.price;
            grandTotal += total;

            html += `
                <tr>
                    <td>
                        <strong>${data.name}</strong><br>
                        <small style="color: #666;">${data.make} ${data.model}</small>
                    </td>
                    <td style="text-align: center;">
                        <span class="status-pill ${data.type === 'Permanent' ? 'status-active' : ''}" style="font-size: 10px;">
                            ${data.type}
                        </span>
                    </td>
                    <td style="text-align: center;">${data.count}</td>
                    <td style="text-align: right;">${projectSymbol}${data.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style="text-align: right;"><strong>${projectSymbol}${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></td>
                </tr>
            `;
        }
        
        html += `
                    </tbody>
                    <tfoot>
                        <tr style="background: #f8f9fa; font-size: 1.1em; border-top: 2px solid #dee2e6;">
                            <td colspan="4" style="text-align: right; padding: 15px;"><strong>Project Grand Total (${currentProjectCurrency}):</strong></td>
                            <td style="text-align: right; padding: 15px; color: #0078d4;"><strong>${projectSymbol}${grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn-action" style="background: #6c757d; color: white;" onclick="window.printBOM()">🖨️ Print BOM/BOQ</button>
                <button class="btn-action" onclick="alert('Export functionality coming soon!')">📥 Export CSV</button>
            </div>
        `;
        bomContent.innerHTML = html;
    } catch (err) {
        console.error('Error generating BOM:', err);
        bomContent.innerHTML = '<div style="color:red; text-align:center; padding: 20px;">Error generating BOM/BOQ</div>';
    }
};

export function renderSidebarTree() {
    console.log('[Sidebar] renderSidebarTree() initiated');
    
    const sidebarMenu = document.getElementById('sidebar-tree');
    if (!sidebarMenu) return Promise.resolve();

    // Fetch folders and kinds
    return Promise.all([
        fetch('/api/folders').then(r => r.ok ? r.json() : []),
        fetch('/api/asset_kinds').then(r => r.ok ? r.json() : [])
    ]).then(([folders, kinds]) => {
        const category = localStorage.getItem('selectedAssetCategory') || 'IT';
        
        // Merge folders and kinds into a single hierarchy structure using standardized mapping
        const allNodes = HierarchyManager.mapNodes(folders, kinds);

        const manager = new HierarchyManager(allNodes);
        window.hierarchyManager = manager; // Store for dashboard use
        
        const moduleTree = manager.getModuleTree(category);
        console.log('[Sidebar] Category:', category, 'Module Tree Size:', moduleTree.length);
        
        const treeHTML = manager.generateSidebarHTML(moduleTree);
        console.log('[Sidebar] Generated Tree HTML length:', treeHTML.length);

        sidebarMenu.innerHTML = `
            <li style="list-style: none;">
                <div class="menu-item-wrapper active" style="padding: 10px 20px; background-color: #e9f5ff; display: flex; align-items: center; gap: 8px; border-left: 4px solid #007bff;">
                    <span class="tree-toggle-main" style="cursor:pointer; color: #007bff; width: 20px; display: inline-block; text-align: center;">▼</span>
                    <a href="#" class="menu-item toggle-submenu active" id="allAssetsLink" style="text-decoration: none; color: #007bff; font-weight: bold; flex: 1;">All Assets</a>
                </div>
                <div id="sidebar-hierarchy-container" style="display: block;">
                    <div class="tree-node" style="user-select: none;">
                        <div class="tree-item-wrapper" style="padding: 6px 20px 6px 40px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <span class="tree-icon">⏳</span>
                            <a href="#" class="tree-link" id="tempAssetsLink" style="flex: 1; color: #555; font-size: 13px; text-decoration: none;">Temporary Assets</a>
                        </div>
                    </div>
                    ${treeHTML || '<p style="padding: 10px 40px; color: #999; font-size: 12px; font-style: italic;">No categories found</p>'}
                </div>
            </li>
        `;

        // Add toggle functionality for the main "All Assets" group
        const mainToggle = sidebarMenu.querySelector('.tree-toggle-main');
        const hierarchyContainer = document.getElementById('sidebar-hierarchy-container');
        if (mainToggle && hierarchyContainer) {
            mainToggle.onclick = (e) => {
                e.stopPropagation();
                const isHidden = hierarchyContainer.style.display === 'none';
                hierarchyContainer.style.display = isHidden ? 'block' : 'none';
                mainToggle.textContent = isHidden ? '▼' : '▶';
                console.log('[Sidebar] Main hierarchy toggled:', isHidden ? 'shown' : 'hidden');
            };
        }

        const allAssetsLink = document.getElementById('allAssetsLink');
        if (allAssetsLink) {
            allAssetsLink.onclick = (e) => {
                e.preventDefault();
                window.currentDashboardParent = null;
                renderDashboard(window.allAssets, () => window.allAssets);
                
                // Reset sidebar active states
                sidebarMenu.querySelectorAll('.tree-link').forEach(l => {
                    l.style.color = '#555';
                    l.style.fontWeight = 'normal';
                });
                allAssetsLink.style.color = '#007bff';
            };
        }

        const tempAssetsLink = document.getElementById('tempAssetsLink');
        if (tempAssetsLink) {
            tempAssetsLink.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.currentDashboardParent = { ID: 'TEMP_VIEW', Name: 'Temporary Assets', type: 'virtual' };
                
                // Set active state
                sidebarMenu.querySelectorAll('.tree-link').forEach(l => {
                    l.style.color = '#555';
                    l.style.fontWeight = 'normal';
                });
                tempAssetsLink.style.color = '#007bff';
                tempAssetsLink.style.fontWeight = 'bold';

                renderDashboard(window.allAssets, () => []); // We'll handle fetching temp assets in renderDashboard
            };
        }

        // Add toggle logic for nested items
        const container = document.getElementById('sidebar-hierarchy-container');
        if (container) {
            container.querySelectorAll('.tree-toggle').forEach(toggle => {
                toggle.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const nodeDiv = toggle.closest('.tree-node');
                    const childrenDiv = nodeDiv.querySelector('.tree-children');
                    if (childrenDiv) {
                        const isHidden = childrenDiv.style.display === 'none';
                        childrenDiv.style.display = isHidden ? 'block' : 'none';
                        toggle.textContent = isHidden ? '▼' : '▶';
                        toggle.style.color = isHidden ? '#333' : '#999';
                    }
                };
            });

            container.querySelectorAll('.tree-link').forEach(link => {
                link.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = link.getAttribute('data-id');
                    const node = manager.findNode(id);
                    
                    if (node) {
                        console.log('[Sidebar] Node selected:', node.Name);
                        
                        // Set active state
                        container.querySelectorAll('.tree-link').forEach(l => {
                            l.style.color = '#555';
                            l.style.fontWeight = 'normal';
                        });
                        link.style.color = '#007bff';
                        link.style.fontWeight = 'bold';

                        // Navigate dashboard to this parent
                        window.currentDashboardParent = node;
                        renderDashboard(window.allAssets, () => window.allAssets);
                        
                        // If it's a leaf kind, also open the list modal immediately
                        if (node.type === 'kind' && (!node.children || node.children.length === 0)) {
                            showAssetList(node);
                        }
                    }
                };
            });
        }

        // Setup other links
        const navQrCode = document.getElementById('navQrCode');
        if (navQrCode) navQrCode.onclick = () => window.showView && window.showView('adminView');
        
        const navGenerateCode = document.getElementById('navGenerateCode');
        if (navGenerateCode) navGenerateCode.onclick = () => window.showView && window.showView('adminView');

    }).catch(err => {
        console.error('[Sidebar] Error rendering tree:', err);
    });
}

export function renderDashboard(assets, filteredAssets) {
    window.allAssets = assets;
    console.log('[Dashboard] renderDashboard() called');
    console.log('[Dashboard] Assets count:', (assets || []).length);
    console.log('[Dashboard] Category:', localStorage.getItem('selectedAssetCategory'));
    
    const assetGrid = document.getElementById('assetGrid');
    if (!assetGrid) return;
    assetGrid.innerHTML = '';
    
    const assetsToRender = filteredAssets();
    const kinds = window.allAssetKinds || [];
    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
    const manager = window.hierarchyManager;
    if (!manager) {
        console.warn('HierarchyManager not yet initialized. Postponing renderDashboard.');
        assetGrid.innerHTML = '<div style="padding: 20px; color: #666;">Loading hierarchy...</div>';
        return;
    }

    // Special Case: Temporary Assets View
    if (window.currentDashboardParent && window.currentDashboardParent.ID === 'TEMP_VIEW') {
        const dashboardTitle = document.getElementById('dashboard-title');
        if (dashboardTitle) {
            dashboardTitle.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button id="btnDashboardBack" class="icon-button" style="background: #eee; border-radius: 50%; width: 24px; height: 24px; font-size: 14px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; cursor: pointer;">←</button>
                    <span>Temporary Assets</span>
                </div>
            `;
            const btnBack = document.getElementById('btnDashboardBack');
            if (btnBack) {
                btnBack.onclick = () => {
                    window.currentDashboardParent = null;
                    renderDashboard(window.allAssets, () => window.allAssets);
                };
            }
        }

        assetGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; text-align: center;">Loading temporary assets...</div>';
        
        fetch('/api/temporary-assets')
            .then(r => r.json())
            .then(tempAssets => {
                if (tempAssets.length === 0) {
                    assetGrid.innerHTML = `
                        <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #999;">
                            <div style="font-size: 48px; margin-bottom: 20px;">⏳</div>
                            <p>No temporary assets found.</p>
                        </div>
                    `;
                    return;
                }

                assetGrid.innerHTML = '';
                // Group by project if needed, or just show all
                tempAssets.forEach(asset => {
                    const card = document.createElement('div');
                    card.classList.add('asset-card');
                    card.style.cursor = 'default';
                    card.innerHTML = `
                        <div class="asset-card-icon">⏳</div>
                        <div class="asset-card-header">
                            <span class="asset-card-title">${asset.ItemName}</span>
                        </div>
                        <div style="padding: 10px; font-size: 12px; color: #666;">
                            <div>Project ID: ${asset.ProjectId}</div>
                            <div>Make/Model: ${asset.Make || '-'} / ${asset.Model || '-'}</div>
                            <div>Qty: ${asset.Quantity}</div>
                            <div>Est. Price: ${asset.EstimatedPrice} ${asset.Currency}</div>
                        </div>
                        <div style="padding: 10px; display: flex; gap: 5px; justify-content: center;">
                            <button onclick="makeAssetPermanent('${asset.ID}')" class="btn-action" style="font-size: 11px; background: #e6f7ff; color: #1890ff; border-color: #91d5ff;">Convert</button>
                            <button onclick="deleteTempAsset('${asset.ID}')" class="btn-action" style="font-size: 11px; background: #fff1f0; color: #cf1322; border-color: #ffa39e;">Delete</button>
                        </div>
                    `;
                    assetGrid.appendChild(card);
                });
            })
            .catch(err => {
                console.error('Error loading temp assets:', err);
                assetGrid.innerHTML = '<div style="grid-column: 1 / -1; color: red; text-align: center; padding: 20px;">Error loading temporary assets</div>';
            });
        return;
    }

    // Re-sync parentNode with current manager to avoid stale object issues
    let parentNode = window.currentDashboardParent;
    if (parentNode && manager) {
        parentNode = manager.findNode(parentNode.ID);
        window.currentDashboardParent = parentNode; // Update global reference
    }

    const dashboardTitle = document.getElementById('dashboard-title');
    if (dashboardTitle) {
        dashboardTitle.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                ${window.currentDashboardParent ? '<button id="btnDashboardBack" class="icon-button" style="background: #eee; border-radius: 50%; width: 24px; height: 24px; font-size: 14px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; cursor: pointer;">←</button>' : ''}
                <span>${parentNode ? parentNode.Name : `${category} Assets`}</span>
                <button id="btnHierarchyDebug" style="background: #6c757d; color: white; border: none; border-radius: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer; margin-left: 10px; opacity: 0.6;">Debug</button>
            </div>
        `;
        
        // Add Back Handler
        const btnBack = document.getElementById('btnDashboardBack');
        if (btnBack) {
            btnBack.onclick = (e) => {
                e.stopPropagation();
                if (window.currentDashboardParent && window.currentDashboardParent.ParentID) {
                    window.currentDashboardParent = manager.findNode(window.currentDashboardParent.ParentID);
                } else {
                    window.currentDashboardParent = null;
                }
                renderDashboard(window.allAssets, filteredAssets);
            };
        }

        // Add Debug Handler
        const btnDebug = document.getElementById('btnHierarchyDebug');
        if (btnDebug) {
            btnDebug.onclick = (e) => {
                e.stopPropagation();
                console.log('--- Hierarchy Debug ---');
                console.log('Category:', category);
                console.log('Current Parent:', window.currentDashboardParent);
                console.log('Hierarchy Manager Tree:', manager.tree);
                console.log('Module Tree:', manager.getModuleTree(category));
                console.log('All Nodes:', manager.data);
                alert(`Hierarchy Debug: Check Console\nRoots for ${category}: ${manager.getModuleTree(category).length}`);
            };
        }
    }

    let displayNodes = [];
    let recursiveAssets = [];

    if (!parentNode) {
        // "All Assets" view: Show Tier 1 categories as cards
        displayNodes = manager.getModuleTree(category);
        console.log(`[Dashboard] Root nodes for ${category}:`, displayNodes.length);
        
        // In "All Assets" view, the filteredAssets already contains what we want
        recursiveAssets = filteredAssets();
        
        if (displayNodes.length === 0) {
            assetGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #999;">
                    <div style="font-size: 48px; margin-bottom: 20px;">📂</div>
                    <p>No categories found for <b>${category}</b> assets.</p>
                    <p style="font-size: 13px;">Check if the Hierarchy Manager is properly initialized.</p>
                </div>
            `;
            return;
        }
    } else {
        // Specific Folder/Kind view: Show children as cards
        displayNodes = parentNode.children || [];
        document.getElementById('dashboard-title').textContent = parentNode.Name;
        
        // If it's a "Kind", show its specific assets + children's assets
        // If it's a "Folder", show all assets under its children
        const descendants = manager.getDescendants(parentNode.ID, true);
        const descendantKindNames = descendants
            .filter(d => d.type === 'kind')
            .map(d => d.Name);
        
        recursiveAssets = assets.filter(a => descendantKindNames.includes(a.Type) && a.Category === category);
    }

    // If it's a leaf kind (no children), show a message and automatically open the list
        if (parentNode && parentNode.type === 'kind' && (!parentNode.children || parentNode.children.length === 0)) {
            assetGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px; text-align: center; background: white; border-radius: 8px; border: 1px dashed #ccc;">
                    <div style="font-size: 48px; margin-bottom: 20px;">📦</div>
                    <h3 style="margin-bottom: 10px;">${parentNode.Name} Assets</h3>
                    <p style="color: #666; margin-bottom: 20px;">Viewing inventory for this category.</p>
                    <button id="btnOpenLeafList" style="padding: 10px 24px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">View Full Inventory List</button>
                </div>
            `;
            const btn = document.getElementById('btnOpenLeafList');
            if (btn) btn.onclick = () => showAssetList(parentNode);
            
            // Auto-open list if it's not already open
            const modal = document.getElementById('assetListModal');
            if (modal && modal.style.display !== 'flex') {
                showAssetList(parentNode);
            }
            return;
        }

        // Render cards for displayNodes (subfolders/subkinds)
        if (displayNodes.length === 0 && parentNode) {
            assetGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #999;">
                    <p>No sub-categories or folders found in <b>${parentNode.Name}</b>.</p>
                </div>
            `;
            return;
        }

        displayNodes.forEach(node => {
        const isKind = node.type === 'kind';
        const nodeName = node.Name;
        
        // Calculate stats recursively for this node
        const nodeDescendants = manager.getDescendants(node.ID, true);
        const nodeKindNames = nodeDescendants.filter(d => d.type === 'kind').map(d => d.Name);
        const nodeAssets = assets.filter(a => nodeKindNames.includes(a.Type) && a.Category === category);
        
        const realAssets = nodeAssets.filter(a => {
            const p = a.isPlaceholder;
            return !(p === true || p === 'true' || p === 1 || p === '1');
        });
        
        const total = realAssets.length;
        const inUse = realAssets.filter(a => a.Status === 'In Use').length;
        const inStore = realAssets.filter(a => a.Status === 'In Store').length;
        const inRepair = realAssets.filter(a => a.Status === 'In Repair').length;
        const others = total - (inUse + inStore + inRepair);

        const assetCard = document.createElement('div');
        assetCard.classList.add('asset-card');
        assetCard.setAttribute('data-kind', nodeName); // For global listener fallback
        if (isSelectionMode) assetCard.classList.add('selection-mode');
        
        assetCard.style.cursor = 'pointer';
        assetCard.onclick = (e) => {
                    e.stopPropagation(); // Prevent global listener from firing redundant showAssetList(null)
                    
                    if (node.children && node.children.length > 0) {
                        // Drill down if there are children
                        window.currentDashboardParent = node;
                        renderDashboard(window.allAssets, filteredAssets);
                    } else if (node.type === 'kind') {
                        // Leaf kind - show assets
                        showAssetList(node);
                    } else {
                        // It's a folder with no children, show message or navigate
                        window.currentDashboardParent = node;
                        renderDashboard(window.allAssets, filteredAssets);
                    }
                };

        assetCard.innerHTML = `
            ${isKind ? `<button class="asset-card-add-button" data-kind="${nodeName}" title="Add ${nodeName}">+</button>` : ''}
            <div class="asset-card-icon">
                ${(node.Icon && node.Icon.startsWith('/icons/')) 
                    ? `<img src="${node.Icon}" style="width: 48px; height: 48px; object-fit: contain;">`
                    : (node.Icon || (isKind ? '📦' : '📂'))}
            </div>
            <div class="asset-card-header">
                <span class="asset-card-title">${nodeName} (${total})</span>
            </div>
            <div class="asset-card-status">
                <div class="asset-card-status-item">
                    <span class="asset-card-status-value">${inUse}</span>
                    <span class="asset-card-status-label">In Use</span>
                </div>
                <div class="asset-card-status-item">
                    <span class="asset-card-status-value">${inStore}</span>
                    <span class="asset-card-status-label">In Store</span>
                </div>
                <div class="asset-card-status-item">
                    <span class="asset-card-status-value">${inRepair}</span>
                    <span class="asset-card-status-label">Repair</span>
                </div>
                <div class="asset-card-status-item">
                    <span class="asset-card-status-value">${others}</span>
                    <span class="asset-card-status-label">Other</span>
                </div>
            </div>
        `;

        // Add handler for the "+" button on the card
        if (isKind) {
            const addBtn = assetCard.querySelector('.asset-card-add-button');
            if (addBtn) {
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    openAddItemModal(nodeName);
                };
            }
        }

        assetGrid.appendChild(assetCard);
    });

    // If there are NO sub-nodes, or we are at a leaf "Kind", we might want to show assets directly?
    // The user said: "under the parent asset kind i should see children under them grandchildren so on and so forth"
    // This implies the dashboard is for navigating the HIERARCHY.
    // Asset lists are usually shown in a modal when clicking a card.
}

function showBatchPrintPreview() {
    const batchView = document.getElementById('batchPrintView');
    const container = document.getElementById('batchQrContainer');
    if (!batchView || !container) return;

    console.log(`[BatchPrint] Rendering ${selectedBatchAssets.length} assets using dashboard QR data`);

    container.innerHTML = selectedBatchAssets.map(asset => {
        // Use the stored complex QR data if available (contains full info)
        // Otherwise fall back to the URL-based QR from the API
        let qrUrl = (asset.QRCode && asset.QRCode.length > 50) ? asset.QRCode : `/api/qr/${encodeURIComponent(asset.ID)}?v=${Date.now()}`;
        
        return `
            <div class="batch-qr-item" style="text-align: center; display: inline-block; margin: 15px; border: 1px solid #eee; padding: 15px; background: white; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <img src="${qrUrl}" 
                     class="batch-qr-img"
                     style="display: block; margin: 0 auto; background: white;" 
                     onload="console.log('Batch QR loaded for ${asset.ID}')" 
                     onerror="console.error('Batch QR failed for ${asset.ID}')">
                <div style="font-size: 13px; margin-top: 10px; color: #333; font-weight: bold; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border-top: 1px solid #f0f0f0; padding-top: 8px;">${asset.ID}</div>
            </div>
        `;
    }).join('');

    showView('batchPrintView');
    
    // Setup batch print buttons
    const btnConfirm = document.getElementById('btnConfirmBatchPrint');
    if (btnConfirm) {
        btnConfirm.onclick = () => {
            const activeBtn = document.querySelector('.batch-size-btn.active');
            if (activeBtn) {
                const size = activeBtn.dataset.size;
                container.classList.remove('qr-print-1cm', 'qr-print-2cm', 'qr-print-5cm');
                container.classList.add(`qr-print-${size}`);
            }
            window.print();
        };
    }

    const btnBack = document.getElementById('btnBackFromBatch');
    if (btnBack) {
        btnBack.onclick = () => {
            showView('dashboardView');
        };
    }

    // Size buttons for batch
    document.querySelectorAll('.batch-size-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.batch-size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const size = btn.dataset.size;
            container.classList.remove('qr-print-1cm', 'qr-print-2cm', 'qr-print-5cm');
            container.classList.add(`qr-print-${size}`);
        };
    });
}

export function openAddKindModal() {
    console.log('openAddKindModal() called');
    const modal = document.getElementById('addAssetKindModal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Populate the Parent Kind dropdown
        const parentSelect = document.getElementById('newKindParent');
        if (parentSelect) {
            const currentCategory = localStorage.getItem('selectedAssetCategory') || 'IT';
            const allKinds = window.allAssetKinds || [];
            const allFolders = window.allFolders || [];
            
            // Only show kinds/folders that belong to the current module (category)
            const filteredKinds = allKinds.filter(k => k.Module === currentCategory);
            const filteredFolders = allFolders.filter(f => f.Module === currentCategory);
            
            console.log(`Populating Parent Kind dropdown with ${filteredKinds.length} kinds and ${filteredFolders.length} folders`);
            
            parentSelect.innerHTML = '<option value="">None (Top Level)</option>';
            
            // Add Folders
            if (filteredFolders.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Folders';
                filteredFolders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.Name;
                    opt.textContent = `${f.Icon || '📁'} ${f.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }

            // Add Kinds
            if (filteredKinds.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Existing Categories';
                filteredKinds.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k.Name;
                    opt.textContent = `${k.Icon || '📦'} ${k.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }
        }
    } else {
        console.error('CRITICAL: addAssetKindModal NOT found in DOM');
    }
}

export function openAddItemModal(kind) {
    console.log('openAddItemModal() called for kind:', kind);
    const modal = document.getElementById('addAssetItemModal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Reset the form and hidden ID
        const form = document.getElementById('addAssetItemForm');
        if (form) form.reset();
        const assetDbId = document.getElementById('assetDbId');
        if (assetDbId) assetDbId.value = '';

        // Clear children list
        const childrenContainer = document.getElementById('childrenListContainer');
        if (childrenContainer) childrenContainer.innerHTML = '';

        // Clear linked components
        const linkedList = document.getElementById('linkedComponentsList');
        if (linkedList) linkedList.innerHTML = '';

        // Reset the Icon field
        const iconInput = document.getElementById('itemIcon');
        if (iconInput) iconInput.value = '';

        // Populate the Kind dropdown
        const kindSelect = document.getElementById('itemKind');
        if (kindSelect) {
            const currentCategory = localStorage.getItem('selectedAssetCategory') || 'IT';
            const allKinds = window.allAssetKinds || [];
            
            // Only show kinds that belong to the current module (category)
            const filteredKinds = allKinds.filter(k => k.Module === currentCategory);
            
            console.log(`Populating Kind dropdown with ${filteredKinds.length} options for ${currentCategory}`);
            
            kindSelect.innerHTML = '<option value="" disabled>Select Kind...</option>';
            filteredKinds.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k.Name;
                opt.textContent = k.Name;
                kindSelect.appendChild(opt);
            });
            
            // Add change listener to update title when kind changes manually
            kindSelect.onchange = () => {
                const title = document.getElementById('addItemModalTitle');
                if (title && kindSelect.value) {
                    title.textContent = `Add New ${kindSelect.value}`;
                }
                
                // Toggle IT fields
                const itFields = document.getElementById('itFields');
                if (itFields) {
                    itFields.style.display = (currentCategory === 'IT') ? 'block' : 'none';
                }
            };
            
            if (kind) {
                kindSelect.value = kind;
                const title = document.getElementById('addItemModalTitle');
                if (title) title.textContent = `Add New ${kind}`;
            } else {
                kindSelect.value = "";
                const title = document.getElementById('addItemModalTitle');
                if (title) title.textContent = 'Add New Asset';
            }
            
            // Initial toggle for IT fields
            const itFields = document.getElementById('itFields');
            if (itFields) {
                itFields.style.display = (currentCategory === 'IT') ? 'block' : 'none';
            }
        }

        // Populate Assigned To dropdown
        const assignedSelect = document.getElementById('itemAssignedTo');
        if (assignedSelect) {
            const employees = window.allEmployees || [];
            assignedSelect.innerHTML = '<option value="">-- Select Employee --</option>';
            employees.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.Name;
                opt.textContent = `${emp.Name} (${emp.EmployeeID})`;
                assignedSelect.appendChild(opt);
            });
        }
    } else {
        console.error('CRITICAL: addAssetItemModal NOT found in DOM');
    }
}

export async function editAsset(asset) {
    console.log('editAsset() called for:', asset.ID);
    
    // Close assetListModal if it's open
    const listModal = document.getElementById('assetListModal');
    if (listModal) listModal.style.display = 'none';

    openAddItemModal(asset.Type);
    
    const title = document.getElementById('addItemModalTitle');
    if (title) title.textContent = `Edit Asset: ${asset.ID}`;
    
    // Fill the hidden ID
    const assetDbId = document.getElementById('assetDbId');
    if (assetDbId) assetDbId.value = asset.ID;

    // Fill basic fields
    document.getElementById('itemKind').value = asset.Type || '';
    document.getElementById('itemName').value = asset.ItemName || '';
    document.getElementById('itemIcon').value = asset.Icon || '';
    document.getElementById('itemStatus').value = asset.Status || 'In Store';
    document.getElementById('itemMake').value = asset.Make || '';
    document.getElementById('itemModel').value = asset.Model || '';
    document.getElementById('itemSrNo').value = asset.SrNo || '';
    document.getElementById('itemLocation').value = asset.CurrentLocation || '';
    document.getElementById('itemIn').value = asset.IN || '0';
    document.getElementById('itemOut').value = asset.OUT || '0';
    document.getElementById('itemBalance').value = asset.Balance || '0';
    
    if (asset.DispatchReceiveDt) {
        // Handle date format if needed
        document.getElementById('itemDate').value = asset.DispatchReceiveDt;
    }
    
    document.getElementById('itemPurchase').value = asset.PurchaseDetails || '';
    document.getElementById('itemRemarks').value = asset.Remarks || '';
    document.getElementById('itemAssignedTo').value = asset.AssignedTo || '';
    document.getElementById('itemParentId').value = asset.ParentId || '';

    // Warranty Details
    const warrantyField = document.getElementById('itemWarranty');
    const amcField = document.getElementById('itemAMC');
    const valueField = document.getElementById('itemValue');
    const currencyField = document.getElementById('itemCurrency');
    const purchaseDateField = document.getElementById('itemPurchaseDate');

    if (warrantyField) warrantyField.value = asset.warranty_months || 0;
    if (amcField) amcField.value = asset.amc_months || 0;
    if (valueField) valueField.value = asset.asset_value || 0;
    if (currencyField) currencyField.value = asset.Currency || 'INR';
    if (purchaseDateField) purchaseDateField.value = asset.PurchaseDate || '';

    // IT Specific Fields
    if (localStorage.getItem('selectedAssetCategory') === 'IT') {
        const macField = document.getElementById('itemMAC');
        const ipField = document.getElementById('itemIP');
        const ntField = document.getElementById('itemNetworkType');
        const ppField = document.getElementById('itemPhysicalPort');
        const vlanField = document.getElementById('itemVLAN');
        const sidField = document.getElementById('itemSocketID');
        const uidField = document.getElementById('itemUserID');

        if (macField) macField.value = asset.MACAddress || '';
        if (ipField) ipField.value = asset.IPAddress || '';
        if (ntField) ntField.value = asset.NetworkType || 'DHCP';
        if (ppField) ppField.value = asset.PhysicalPort || '';
        if (vlanField) vlanField.value = asset.VLAN || '';
        if (sidField) sidField.value = asset.SocketID || '';
        if (uidField) uidField.value = asset.UserID || '';
    }

    // Fetch and populate children (No QR)
    try {
        const response = await fetch(`/api/asset-details/${encodeURIComponent(asset.ID)}`);
        if (response.ok) {
            const data = await response.json();
            const childrenContainer = document.getElementById('childrenListContainer');
            if (childrenContainer && data.children) {
                // Filter for children without QR codes (NoQR = 1)
                const noQrChildren = data.children.filter(c => c.NoQR === 1 || c.NoQR === true);
                noQrChildren.forEach(child => addChildField(child));

                // Filter for children WITH QR codes (Components)
                const qrChildren = data.children.filter(c => !c.NoQR);
                qrChildren.forEach(child => addLinkedComponent(child));
            }
        }
    } catch (err) {
        console.error('Error fetching asset children for edit:', err);
    }
}
window.editAsset = editAsset;

function showAssetList(nodeOrKindName) {
    const modal = document.getElementById('assetListModal');
    const title = document.getElementById('assetListTitle');
    const body = document.getElementById('tblBodyAssetList');
    
    if (!modal || !body) return;
    if (!nodeOrKindName) {
        console.warn('showAssetList called with null/undefined nodeOrKindName');
        return;
    }
    
    let kindName = '';
    let nodeKindNames = [];
    const manager = window.hierarchyManager;

    if (typeof nodeOrKindName === 'string') {
        kindName = nodeOrKindName;
        nodeKindNames = [kindName];
    } else {
        kindName = nodeOrKindName.Name || 'Unknown';
        if (manager && nodeOrKindName.ID) {
            const descendants = manager.getDescendants(nodeOrKindName.ID, true);
            nodeKindNames = descendants.filter(d => d.type === 'kind').map(d => d.Name);
        } else {
            nodeKindNames = [kindName];
        }
    }
    
    title.textContent = `${kindName} Inventory`;
    body.innerHTML = '';
    
    const query = window.currentSearchQuery || '';
    let assets = (window.allAssets || []).filter(a => 
        nodeKindNames.includes(a.Type) && 
        !(a.isPlaceholder === true || a.isPlaceholder === 1 || a.isPlaceholder === 'true')
    );

    // Apply search filter if present
    if (query) {
        assets = assets.filter(a => matchesQuery(a, query));
    }
    
    if (assets.length === 0) {
        body.innerHTML = `<tr><td colspan="16" style="text-align:center;">No ${query ? 'matching ' : ''}assets found for this kind.</td></tr>`;
    } else {
        assets.forEach(a => {
            const isSelected = selectedBatchAssets.some(sa => sa.ID === a.ID);
            const tr = document.createElement('tr');
            if (isSelected) tr.style.backgroundColor = '#e3f2fd';
            
            tr.innerHTML = `
                <td>
                    ${isSelectionMode ? `
                        <input type="checkbox" class="selection-checkbox" data-id="${a.ID}" ${isSelected ? 'checked' : ''} style="position:static; width:16px; height:16px;">
                    ` : (a.ID || a.Id || '-')}
                </td>
                <td style="text-align: center; font-size: 20px;">
                    ${(a.Icon && a.Icon.startsWith('/icons/')) 
                        ? `<img src="${a.Icon}" style="width: 24px; height: 24px; object-fit: contain;">`
                        : (a.Icon || '📦')}
                </td>
                <td>${a.ItemName || a.Name || '-'}</td>
                <td><span class="status-badge ${a.Status ? a.Status.toLowerCase().replace(' ', '-') : ''}">${a.Status || 'In Store'}</span></td>
                <td>${a.Make || '-'}</td>
                <td>${a.Model || '-'}</td>
                <td>${a.SrNo || '-'}</td>
                <td>${a.CurrentLocation || '-'}</td>
                <td>
                    ${a.AssignedTo ? `
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>${a.AssignedTo}</span>
                            <button class="view-emp-small" data-name="${a.AssignedTo}" style="padding: 2px 5px; font-size: 10px; background: #eee; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;" title="View Employee Details">👤</button>
                        </div>
                    ` : '-'}
                </td>
                <td>${a.warranty_months ? `${a.warranty_months}m` : '-'}</td>
                <td>${a.ParentId || '-'}</td>
                <td>${a.IN || '0'}</td>
                <td>${a.OUT || '0'}</td>
                <td>${a.Balance || '0'}</td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <a href="/asset/${a.ID}" target="_blank" class="view-link" style="color: var(--primary); text-decoration: none; font-weight: 600; font-size: 12px;">View Page</a>
                        <button class="edit-asset-btn" data-id="${a.ID}" style="background: #0078d4; color: white; border: none; border-radius: 3px; padding: 4px 8px; cursor: pointer; font-size: 12px;">Edit Details</button>
                        <button class="print-single-qr" data-id="${a.ID}" style="background: #17a2b8; color: white; border: none; border-radius: 3px; padding: 4px 8px; cursor: pointer; font-size: 12px;">Print QR</button>
                    </div>
                </td>
                <td>
                    ${a.QRCode && a.QRCode.length > 50 ? 
                        `<a href="${a.QRCode}" target="_blank" title="View Full QR (Stored Data)">
                            <img src="${a.QRCode}" 
                                 style="width: 100px; height: 100px; border: 1px solid #eee; padding: 2px; background: white; cursor: pointer;">
                        </a>` : 
                        `<a href="/api/qr/${encodeURIComponent(a.ID)}?v=${Date.now()}" target="_blank" title="View URL QR">
                            <img src="/api/qr/${encodeURIComponent(a.ID)}?v=${Date.now()}" 
                                 style="width: 100px; height: 100px; border: 1px solid #eee; padding: 2px; background: white; cursor: pointer;"
                                 onerror="this.parentElement.innerHTML='<span style=\'color:#999;font-size:12px;\'>No QR</span>'">
                        </a>`
                    }
                </td>
            `;
            body.appendChild(tr);
        });

        // Add checkbox handlers
        body.querySelectorAll('.selection-checkbox').forEach(cb => {
            cb.onclick = (e) => {
                e.stopPropagation();
                const id = cb.getAttribute('data-id');
                const asset = assets.find(a => a.ID === id);
                if (asset) {
                    toggleAssetSelection(asset);
                    const tr = cb.closest('tr');
                    if (cb.checked) {
                        tr.style.backgroundColor = '#e3f2fd';
                    } else {
                        tr.style.backgroundColor = '';
                    }
                }
            };
        });

        // Add Single Print Handler
        body.querySelectorAll('.print-single-qr').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                const asset = assets.find(a => a.ID === id);
                if (asset) {
                    // Open QR view with this asset
                    const qrInput = document.getElementById('qrAssetId');
                    if (qrInput) {
                        qrInput.value = asset.ID;
                        showView('qrView');
                        document.getElementById('btnGenerateQr').click();
                    }
                }
            };
        });

        // Add click events for "View Employee" buttons
        body.querySelectorAll('.view-emp-small').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const empName = btn.getAttribute('data-name');
                const emp = (window.allEmployees || []).find(e => e.Name === empName);
                if (emp) {
                    // Switch to employee view and open modal
                    window.showView('dashboardView');
                    const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view'];
                    subViews.forEach(sv => {
                        const el = document.getElementById(sv);
                        if (el) el.style.display = (sv === 'employee-view') ? 'block' : 'none';
                    });
                    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                    document.getElementById('nav-employees')?.classList.add('active');
                    
                    // Open the employee modal (need to import editEmployee or use a global)
                    if (window.editEmployee) {
                        window.editEmployee(emp);
                    } else {
                        // Fallback if not globally available
                        import('./employees.js?v=3.3').then(m => m.initEmployeeView() || m.loadEmployees().then(() => {
                            // This is a bit complex, let's just make editEmployee global in employees.js
                        }));
                    }
                } else {
                    alert('Employee details not found in database.');
                }
            };
        });

        // Add click events for "Edit Asset" buttons
        body.querySelectorAll('.edit-asset-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const assetId = btn.getAttribute('data-id');
                const asset = (window.allAssets || []).find(a => a.ID === assetId);
                if (asset) {
                    editAsset(asset);
                }
            };
        });
    }
    
    modal.style.display = 'flex';
}

async function fetchAndPopulateIcons() {
    try {
        const response = await fetch('/api/icons');
        const icons = await response.json();
        const picker = document.getElementById('iconPicker');
        const kindPicker = document.getElementById('kindIconPicker');
        
        // Clear previous dynamically added icons but keep emojis
        const clearDynamicIcons = (p) => {
            if (!p) return;
            const options = Array.from(p.options);
            options.forEach(opt => {
                if (opt.value.startsWith('/icons/')) opt.remove();
            });
        };
        
        clearDynamicIcons(picker);
        clearDynamicIcons(kindPicker);

        if ((picker || kindPicker) && icons.length > 0) {
            // Add PNG icons
            icons.forEach(iconPath => {
                const fileName = iconPath.split('/').pop();
                const opt = document.createElement('option');
                opt.value = iconPath;
                opt.textContent = `🖼️ ${fileName}`;
                if (picker) picker.appendChild(opt.cloneNode(true));
                if (kindPicker) kindPicker.appendChild(opt.cloneNode(true));
            });
        }
    } catch (err) {
        console.error('Failed to fetch icons:', err);
    }
}

// Icon Upload Logic
let currentIconTargetId = null;

window.triggerIconUpload = (targetId) => {
    currentIconTargetId = targetId;
    document.getElementById('iconUploadInput').click();
};

document.getElementById('iconUploadInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('icon', file);

    try {
        const response = await fetch('/api/icons/upload', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            if (currentIconTargetId) {
                document.getElementById(currentIconTargetId).value = result.path;
            }
            await fetchAndPopulateIcons();
            alert('Icon uploaded successfully!');
        }
    } catch (err) {
        console.error('Icon upload failed:', err);
        alert('Failed to upload icon.');
    }
};

// Call it on load
fetchAndPopulateIcons();

async function handleBulkUpload(file, kind, category) {
    console.log('handleBulkUpload() called for', file.name, kind, category);
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) {
                alert('The file is empty.');
                return;
            }

            // Use the new DataProcessor module for robust mapping and normalization
            if (!DataProcessor) {
                throw new Error('DataProcessor module not loaded');
            }

            // --- START NEW INTERACTIVE MAPPING FLOW ---
            const suggestions = DataProcessor.analyzeMapping(jsonData);
            const tableBody = document.getElementById('mappingTableBody');
            tableBody.innerHTML = '';

            // Create options for the select dropdowns
            const dbColumns = DataProcessor.DB_COLUMNS;
            let optionsHtml = '<option value="skip">-- Skip This Column --</option>';
            for (const col in dbColumns) {
                optionsHtml += `<option value="${col}">${dbColumns[col].label}</option>`;
            }

            const updatePreview = () => {
                const userMapping = {};
                document.querySelectorAll('.mapping-select').forEach(sel => {
                    userMapping[sel.dataset.index] = sel.value;
                });

                const previewData = DataProcessor.processWithMapping(jsonData.slice(0, 4), userMapping, kind, category);
                const previewContainer = document.getElementById('bulkUploadPreview');
                
                if (previewData.length === 0) {
                    previewContainer.innerHTML = '<p style="color: #dc3545; font-style: italic;">No valid assets found with current mapping. (Item Name is required)</p>';
                    return;
                }

                let html = '<table style="width: 100%; border-collapse: collapse;">';
                html += '<tr style="background: #eee;">' + 
                        ['Item Name', 'Make/Model', 'Serial', 'Status'].map(h => `<th style="padding: 4px; border: 1px solid #ddd; text-align: left;">${h}</th>`).join('') + 
                        '</tr>';
                
                previewData.slice(0, 3).forEach(asset => {
                    html += `<tr>
                        <td style="padding: 4px; border: 1px solid #ddd;">${asset.ItemName || '<span style="color:red">MISSING</span>'}</td>
                        <td style="padding: 4px; border: 1px solid #ddd;">${asset.Make || ''} ${asset.Model || ''}</td>
                        <td style="padding: 4px; border: 1px solid #ddd;">${asset.SrNo || ''}</td>
                        <td style="padding: 4px; border: 1px solid #ddd;">${asset.Status || ''}</td>
                    </tr>`;
                });
                html += '</table>';
                previewContainer.innerHTML = html;
            };

            suggestions.forEach(s => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #eee';
                
                // Highlight ItemName suggestion
                const isItemName = s.suggestedColumn === 'ItemName';
                const rowBg = isItemName ? '#fff4e5' : (s.suggestedColumn ? '#f0fff4' : '#fff');
                tr.style.backgroundColor = rowBg;

                tr.innerHTML = `
                    <td style="padding: 10px; font-weight: bold;">${s.header}</td>
                    <td style="padding: 10px; color: #666; font-style: italic;">${s.sampleValue}</td>
                    <td style="padding: 10px;">
                        <select class="mapping-select" data-index="${s.index}" style="width: 100%; padding: 5px; border-radius: 4px; border: 1px solid ${isItemName ? '#ffa94d' : '#ccc'};">
                            ${optionsHtml}
                        </select>
                    </td>
                `;
                tableBody.appendChild(tr);

                const select = tr.querySelector('select');
                if (s.suggestedColumn) {
                    select.value = s.suggestedColumn;
                }

                // Add event listener for live preview update
                select.addEventListener('change', () => {
                    tr.style.backgroundColor = select.value === 'skip' ? '#fff' : (select.value === 'ItemName' ? '#fff4e5' : '#f0fff4');
                    updatePreview();
                });
            });

            // Initial preview
            updatePreview();

            document.getElementById('bulkMappingModal').style.display = 'block';

            // Setup the confirmation button
            const confirmBtn = document.getElementById('btnConfirmBulkUpload');
            confirmBtn.onclick = async () => {
                const userMapping = {};
                document.querySelectorAll('.mapping-select').forEach(sel => {
                    userMapping[sel.dataset.index] = sel.value;
                });

                const finalAssets = DataProcessor.processWithMapping(jsonData, userMapping, kind, category);
                
                if (finalAssets.length === 0) {
                    alert('No valid assets to upload after mapping.');
                    return;
                }

                confirmBtn.disabled = true;
                confirmBtn.innerText = 'Uploading...';

                try {
                    const username = localStorage.getItem('username') || 'web';
                    const response = await fetch('/api/assets/bulk', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-user': username
                        },
                        body: JSON.stringify(finalAssets)
                    });

                    if (response.ok) {
                            const result = await response.json();
                            alert(`Successfully uploaded ${result.count} assets.`);
                            document.getElementById('bulkMappingModal').style.display = 'none';
                            document.getElementById('addAssetItemModal').style.display = 'none';
                            
                            // Refresh data and update UI
                            if (window.loadAssets) {
                                await window.loadAssets();
                                // Specifically re-render the dashboard to update counts
                                renderDashboard(window.allAssets, () => window.allAssets);
                            }
                        } else {
                        const errText = await response.text();
                        throw new Error(errText);
                    }
                } catch (err) {
                    alert('Upload failed: ' + err.message);
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerText = 'Process & Upload';
                }
            };
            // --- END NEW INTERACTIVE MAPPING FLOW ---
        } catch (err) {
            console.error('Bulk upload failed:', err);
            alert('Bulk upload failed: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- Expose to global ---
window.initScannerView = initScannerView;
window.removeAssetFromDC = removeAssetFromDC;

export function setupDashboardFormHandlers() {
    console.log('setupDashboardFormHandlers() called');
    const form = document.getElementById('addAssetItemForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            console.log('addAssetItemForm onsubmit triggered');
            
            const btnSubmit = form.querySelector('button[type="submit"]');
            const originalText = btnSubmit ? btnSubmit.textContent : 'Save Asset';
            
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.textContent = 'Saving...';
            }

            try {
                const formData = new FormData(form);
                const assetId = document.getElementById('assetDbId').value;
                const category = localStorage.getItem('selectedAssetCategory') || 'IT';
                
                // Collect basic fields
                const asset = {
                    ID: assetId || null,
                    Type: formData.get('itemKind'),
                    ItemName: formData.get('itemName'),
                    Icon: formData.get('itemIcon'),
                    Status: formData.get('itemStatus'),
                    Make: formData.get('itemMake'),
                    Model: formData.get('itemModel'),
                    SrNo: formData.get('itemSrNo'),
                    CurrentLocation: formData.get('itemLocation'),
                    IN: formData.get('itemIn') || 0,
                    OUT: formData.get('itemOut') || 0,
                    Balance: formData.get('itemBalance') || 0,
                    DispatchReceiveDt: formData.get('itemDate'),
                    PurchaseDetails: formData.get('itemPurchase'),
                    Remarks: formData.get('itemRemarks'),
                    AssignedTo: formData.get('itemAssignedTo'),
                    ParentId: formData.get('itemParentId'),
                    Category: category,
                    
                    // Warranty
                    warranty_months: formData.get('itemWarranty') || 0,
                    amc_months: formData.get('itemAMC') || 0,
                    asset_value: formData.get('itemValue') || 0,
                    Currency: formData.get('itemCurrency') || 'INR',
                    PurchaseDate: formData.get('itemPurchaseDate')
                };

                // Add IT fields if applicable
                if (category === 'IT') {
                    asset.MACAddress = formData.get('itemMAC');
                    asset.IPAddress = formData.get('itemIP');
                    asset.NetworkType = formData.get('itemNetworkType');
                    asset.PhysicalPort = formData.get('itemPhysicalPort');
                    asset.VLAN = formData.get('itemVLAN');
                    asset.SocketID = formData.get('itemSocketID');
                    asset.UserID = formData.get('itemUserID');
                }

                // Collect Children (No QR)
                const components = [];
                form.querySelectorAll('.child-asset-row').forEach(row => {
                    const name = row.querySelector('.child-name').value;
                    if (name) {
                        components.push({
                            ItemName: name,
                            Make: row.querySelector('.child-make').value,
                            SrNo: row.querySelector('.child-srno').value,
                            NoQR: 1
                        });
                    }
                });
                asset.components = components;

                // Collect Linked Components (With QR)
                const linkedIds = [];
                const linkedList = document.getElementById('linkedComponentsList');
                if (linkedList) {
                    linkedList.querySelectorAll('.linked-component-tag').forEach(tag => {
                        linkedIds.push(tag.getAttribute('data-id'));
                    });
                }
                asset.linkedIds = linkedIds;

                console.log('Saving asset via window.saveAsset:', asset);
                const result = await window.saveAsset(asset);
                
                if (result) {
                    alert('Asset saved successfully!');
                    document.getElementById('addAssetItemModal').style.display = 'none';
                    // Dashboard and sidebar are refreshed inside window.saveAsset
                }
            } catch (err) {
                console.error('Error in setupDashboardFormHandlers submit:', err);
                alert('Failed to save asset: ' + err.message);
            } finally {
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = originalText;
                }
            }
        };
    }

    // Add Asset Kind Form Handler
    const kindForm = document.getElementById('addAssetKindForm');
    if (kindForm) {
        kindForm.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(kindForm);
            const category = localStorage.getItem('selectedAssetCategory') || 'IT';
            
            const kindData = {
                Name: formData.get('newKindName'),
                Icon: formData.get('newKindIcon'),
                ParentID: formData.get('newKindParent'),
                Module: category
            };

            try {
                const response = await fetch('/api/asset_kinds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(kindData)
                });
                
                if (response.ok) {
                    alert('Category added successfully!');
                    document.getElementById('addAssetKindModal').style.display = 'none';
                    kindForm.reset();
                    if (window.loadAssets) await window.loadAssets();
                    if (typeof renderSidebarTree === 'function') await renderSidebarTree();
                } else {
                    const err = await response.text();
                    alert('Error: ' + err);
                }
            } catch (err) {
                console.error('Kind submission error:', err);
                alert('Failed to save category');
            }
        };
    }

    // Unified Reporting System Handlers
    const btnReportDashboard = document.getElementById('btnReportDashboard');
    if (btnReportDashboard) {
        btnReportDashboard.onclick = () => {
            const category = localStorage.getItem('selectedAssetCategory') || 'IT';
            const parent = window.currentDashboardParent;
            const parentName = parent ? parent.Name : 'All Assets';
            
            let assetsToReport = [];
            if (parent && parent.ID === 'TEMP_VIEW') {
                // For temporary assets, we'd need to fetch them or get them from the grid
                alert('Generating report for Temporary Assets...');
                // Simplified: Just print the current view
                window.print();
                return;
            }

            // Get current assets in view
            if (!parent) {
                assetsToReport = window.allAssets || [];
            } else {
                const manager = window.hierarchyManager;
                if (manager) {
                    const descendants = manager.getDescendants(parent.ID, true);
                    const kindNames = descendants.filter(d => d.type === 'kind').map(d => d.Name);
                    assetsToReport = (window.allAssets || []).filter(a => kindNames.includes(a.Type));
                }
            }

            if (assetsToReport.length === 0) {
                alert('No assets to report in current view.');
                return;
            }

            console.log(`Generating report for ${assetsToReport.length} assets in ${parentName}`);
            
            // For now, let's use a simple CSV export for the dashboard as well
            const headers = ['ID', 'ItemName', 'Type', 'Status', 'Make', 'Model', 'SrNo', 'Location', 'AssignedTo'];
            const csvContent = [
                headers.join(','),
                ...assetsToReport.map(a => [
                    a.ID,
                    `"${a.ItemName || ''}"`,
                    `"${a.Type || ''}"`,
                    `"${a.Status || ''}"`,
                    `"${a.Make || ''}"`,
                    `"${a.Model || ''}"`,
                    `"${a.SrNo || ''}"`,
                    `"${a.CurrentLocation || ''}"`,
                    `"${a.AssignedTo || ''}"`
                ].join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `AssetReport_${category}_${parentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
    }

    const btnReportSheet = document.getElementById('btnReportSheet');
    if (btnReportSheet) {
        btnReportSheet.onclick = () => {
            if (window.tabulatorInstance) {
                const category = localStorage.getItem('selectedAssetCategory') || 'IT';
                window.tabulatorInstance.download("xlsx", `AssetSheet_${category}_${new Date().toISOString().split('T')[0]}.xlsx`, { sheetName: "Assets" });
            } else {
                alert('Sheet view is not initialized.');
            }
        };
    }
}
