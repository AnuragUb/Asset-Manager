import { showView, TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator, showToast } from './utils.js?v=3.8';
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
let dcItemsByAssetId = {};
let showRateAmount = true;

function toNumber(value) {
    const n = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function matchesQuery(asset, query) {
    if (!query) return true;
    const lowerQuery = query.toLowerCase().trim();
    
    // Split terms, but be careful with empty strings
    const terms = lowerQuery.split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return true;
    
    // Fields to search in
    const searchFields = [
        asset.ID,
        asset.ItemName,
        asset.Make,
        asset.Model,
        asset.SrNo,
        asset.CurrentLocation,
        asset.AssignedTo,
        asset.Type,
        asset.Category,
        asset.Status,
        asset.Remarks,
        asset.IPAddress,
        asset.MACAddress,
        asset.User,
        asset.Department,
        asset.EstimatedPrice ? String(asset.EstimatedPrice) : null
    ];
    
    // Ensure we filter out null/undefined fields BEFORE checking include.
    // Also, converting to string and lowercase ONCE.
    const validFields = searchFields
        .filter(f => f !== null && f !== undefined && f !== '')
        .map(f => String(f).toLowerCase());
    
    // Check if EVERY term matches AT LEAST ONE field
    const match = terms.every(term => 
        validFields.some(val => val.includes(term))
    );
    
    // DEBUG: Log matches for "mumt" or similar to understand false positives
    if (match && lowerQuery.includes('mumt') && !asset.ID.toLowerCase().includes('mumt')) {
        console.warn(`[DEBUG] False Positive? Query "${lowerQuery}" matched Asset ${asset.ID} (${asset.ItemName})`);
        console.warn(`[DEBUG] Terms:`, terms);
        // Find exactly which fields matched
        const matchedFields = validFields.filter(val => terms.some(t => val.includes(t)));
        console.warn(`[DEBUG] Matching Field(s):`, matchedFields);
        
        // Also log all fields to see if one is suspiciously long or generic
        // console.log('All fields:', validFields);
    }
    
    return match;
}

// Global Search Logic Injection
function initGlobalSearch() {
    const btnSearchBy = document.getElementById('btnSearchBy');
    const searchPanel = document.getElementById('searchPanel');
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');

    if (btnSearchBy && searchPanel && searchInput && searchButton) {
        // Toggle Search Panel
        btnSearchBy.onclick = () => {
            searchVisible = !searchVisible;
            searchPanel.style.display = searchVisible ? 'block' : 'none';
            if (searchVisible) searchInput.focus();
        };

        // Perform Search
        const performSearch = () => {
            const query = searchInput.value.trim();
            if (!query) return;
            
            // Use the new unified search function
            const results = window.searchAllAssets ? window.searchAllAssets(query) : [];
            
            // Assuming we want to filter the current view (Dashboard)
            window.currentSearchQuery = query;
            
            // Update Dashboard
            if (window.renderDashboard) {
                // Merge results for display
                const combinedAssets = results;
                renderDashboard(combinedAssets, () => combinedAssets);
            }
            
            // Also show a toast or summary
            showToast(`Found ${results.length} matches`, 'info');
        };

        searchButton.onclick = performSearch;
        searchInput.onkeypress = (e) => {
            if (e.key === 'Enter') performSearch();
        };
    }
}

// Call init logic
initGlobalSearch();

// Export for use in other modules if needed (though currently only used in dashboard.js)
window.matchesQuery = matchesQuery;

// Add this function to check temp assets as well
window.searchAllAssets = function(query) {
    if (!query) return window.allAssets || [];
    
    const permanentMatches = (window.allAssets || []).filter(a => matchesQuery(a, query));
    
    // We need to fetch or have temp assets loaded.
    // If they are not loaded globally, we might miss them.
    // Ideally, loadAssets should load both or we fetch them here.
    // Given the constraints, let's assume we can fetch them if not present,
    // or better yet, load them once and store in window.allTempAssets
    
    let tempMatches = [];
    if (window.allTempAssets) {
        tempMatches = window.allTempAssets.filter(a => matchesQuery(a, query));
    }
    
    return [...permanentMatches, ...tempMatches];
};

function numberToWordsIndian(n) {
    const num = Math.floor(Math.abs(Number(n) || 0));
    if (num === 0) return 'Zero';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const twoDigits = (x) => {
        if (x < 20) return ones[x];
        const t = Math.floor(x / 10);
        const o = x % 10;
        return `${tens[t]}${o ? ' ' + ones[o] : ''}`.trim();
    };

    const threeDigits = (x) => {
        const h = Math.floor(x / 100);
        const r = x % 100;
        const parts = [];
        if (h) parts.push(`${ones[h]} Hundred`);
        if (r) parts.push(twoDigits(r));
        return parts.join(' ').trim();
    };

    let remaining = num;
    const crore = Math.floor(remaining / 10000000);
    remaining %= 10000000;
    const lakh = Math.floor(remaining / 100000);
    remaining %= 100000;
    const thousand = Math.floor(remaining / 1000);
    remaining %= 1000;
    const hundredPart = remaining;

    const out = [];
    if (crore) out.push(`${threeDigits(crore)} Crore`);
    if (lakh) out.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) out.push(`${threeDigits(thousand)} Thousand`);
    if (hundredPart) out.push(threeDigits(hundredPart));
    return out.join(' ').trim();
}

function formatAmountWords(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    const rupees = Math.floor(abs);
    const paise = Math.round((abs - rupees) * 100);
    const rupeeWords = numberToWordsIndian(rupees);
    const paiseWords = paise ? numberToWordsIndian(paise) : '';
    const core = paise ? `${rupeeWords} Rupees and ${paiseWords} Paise` : `${rupeeWords} Rupees`;
    return `${n < 0 ? 'Minus ' : ''}${core} Only`;
}

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

function renderAssetKanban(assets) {
    if (!assets) {
        console.error('[Dashboard] renderAssetKanban called with undefined assets');
        return;
    }
    console.log('[Dashboard] renderAssetKanban() called with', assets.length, 'assets');
    const kanban = document.getElementById('assetKanban');
    const grid = document.getElementById('assetCardsContainer') || document.getElementById('assetGrid');
    const gridWrapper = document.getElementById('assetGridWrapper');
    
    if (!kanban) return;
    
    // Explicitly toggle visibility
    kanban.classList.remove('hidden');
    kanban.style.display = 'flex';
    if (grid) grid.style.display = 'none';
    if (gridWrapper) gridWrapper.style.display = 'none';

    kanban.innerHTML = '';

    const statuses = ['In Store', 'Owned', 'Sold', 'Demo', 'In-Use', 'Rental', 'Stand By', 'In-Repair', 'Scraped'];
    
    statuses.forEach(status => {
        const statusAssets = assets.filter(a => (a.Status || 'In Store') === status);
        
        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.status = status;

        column.innerHTML = `
            <div class="kanban-column-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #ddd;">
                <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #5e6c84;">${status.toUpperCase()}</h3>
                <span style="background: #dfe1e6; color: #172b4d; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${statusAssets.length}</span>
            </div>
            <div class="kanban-cards-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px; min-height: 100px;">
            </div>
        `;

        const cardsContainer = column.querySelector('.kanban-cards-container');
        
        // Drag and drop for columns
        cardsContainer.ondragover = (e) => {
            e.preventDefault();
            cardsContainer.style.background = 'rgba(0,0,0,0.05)';
        };
        cardsContainer.ondragleave = () => {
            cardsContainer.style.background = 'transparent';
        };
        cardsContainer.ondrop = async (e) => {
            e.preventDefault();
            cardsContainer.style.background = 'transparent';
            const assetId = e.dataTransfer.getData('assetId');
            const newStatus = column.dataset.status;
            
            if (assetId && newStatus) {
                try {
                    const response = await fetch(`/api/assets/${assetId}`, {
                        method: 'PUT',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-user': localStorage.getItem('username') || 'web'
                        },
                        body: JSON.stringify({ Status: newStatus })
                    });
                    
                    if (response.ok) {
                        // Refresh dashboard data
                        if (window.loadAssets) {
                            await window.loadAssets();
                            renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
                        }
                    } else {
                        const error = await response.text();
                        showToast(`Failed to update status: ${error}`, 'error');
                    }
                } catch (err) {
                    console.error('Error updating asset status:', err);
                    showToast('Error updating asset status. Check console for details.', 'error');
                }
            }
        };
        
        statusAssets.forEach(asset => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.draggable = true;
            card.dataset.id = asset.ID;
            card.style.background = 'white';
            card.style.borderRadius = '4px';
            card.style.padding = '10px';
            card.style.boxShadow = '0 1px 0 rgba(9,30,66,.25)';
            card.style.cursor = 'grab';
            card.style.borderLeft = '4px solid ' + getStatusColor(status);
            
            card.onclick = () => showAssetDetails(asset.ID);
            
            card.ondragstart = (e) => {
                e.dataTransfer.setData('assetId', asset.ID);
                card.style.opacity = '0.5';
            };
            card.ondragend = () => {
                card.style.opacity = '1';
            };

            card.innerHTML = `
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                    <div style="font-size: 20px; width: 30px; text-align: center; flex-shrink: 0;">
                        ${(asset.Icon && (asset.Icon.startsWith('/') || asset.Icon.startsWith('http'))) 
                            ? `<img src="${asset.Icon}" style="width: 24px; height: 24px; object-fit: contain;">`
                            : (asset.Icon || '📦')}
                    </div>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-size: 13px; font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${asset.ItemName}">${asset.ItemName}</div>
                        <div style="font-size: 11px; color: #5e6c84;">ID: ${asset.ID}</div>
                        <div style="font-size: 11px; color: #5e6c84; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${asset.Make || ''} ${asset.Model || ''}</div>
                        ${asset.SrNo ? `<div style="font-size: 11px; color: #5e6c84; margin-top: 3px;">SN: ${asset.SrNo}</div>` : ''}
                        <div style="font-size: 10px; color: #007bff; margin-top: 5px; font-weight: 500;">${asset.Type}</div>
                        <div style="font-size: 10px; margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            ${(asset.is_quantity_tracked === 1 || asset.quantity_unit || asset.quantity_total) ? `
                                <span style="color: #0078d4; font-weight: 600; display: flex; align-items: center; gap: 3px;">⚖️ ${asset.quantity_total ?? 0} ${asset.quantity_unit || ''}</span>
                            ` : ''}
                            <button onclick="event.stopPropagation(); showQuantityHistoryModal('${asset.ID}')" style="color: #0056b3; font-weight: 700; text-decoration: none; background: #e7f3ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #b3d7ff; font-size: 9px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">📅 History</button>
                        </div>
                        ${asset.AssignedTo ? `<div style="font-size: 10px; color: #666; margin-top: 5px; font-style: italic;">👤 ${asset.AssignedTo}</div>` : ''}
                    </div>
                </div>
            `;
            cardsContainer.appendChild(card);
        });

        kanban.appendChild(column);
    });
}

function navigateToAssetPage(assetId) {
    if (!assetId) return;
    // Redirect to the asset details page
    window.location.href = `/asset/${assetId}`;
}

window.navigateToAssetPage = navigateToAssetPage;

function navigateToProjectPage(projectId) {
    if (!projectId) return;
    window.location.href = `/project/${projectId}`;
}
window.navigateToProjectPage = navigateToProjectPage;

function getStatusColor(status) {
    switch(status) {
        case 'Owned': return '#36b37e';
        case 'Sold': return '#ff5630';
        case 'Demo': return '#ffab00';
        case 'In-Use': return '#0052cc';
        case 'Rental': return '#6554c0';
        case 'Stand By': return '#42526e';
        case 'In-Repair': return '#ff8b00';
        case 'Scraped': return '#bf2600';
        default: return '#dfe1e6';
    }
}

window.renderAssetKanban = renderAssetKanban;

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
    const dcOpenId = document.getElementById('dcOpenId');
    const btnOpenDC = document.getElementById('btnOpenDC');
    const btnToggleRateAmount = document.getElementById('btnToggleRateAmount');
    
    // Set default date
    const dateInput = document.getElementById('dcDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    if (btnToggleRateAmount) {
        btnToggleRateAmount.onclick = () => {
            showRateAmount = !showRateAmount;
            
            // Toggle Headers
            const thRate = document.getElementById('dcThRate');
            const thAmount = document.getElementById('dcThAmount');
            if (thRate) thRate.style.display = showRateAmount ? '' : 'none';
            if (thAmount) thAmount.style.display = showRateAmount ? '' : 'none';
            
            // Toggle Body Cells via re-render (simplest way to ensure consistency)
            renderSelectedAssets();
            
            // Update button text/icon
            const span = btnToggleRateAmount.querySelector('span');
            if (span) span.textContent = showRateAmount ? '👁️' : '🚫';
        };
    }

    // --- Remarks Template Logic ---
    const dcRemarksTemplate = document.getElementById('dcRemarksTemplate');
    const btnSaveRemarkTemplate = document.getElementById('btnSaveRemarkTemplate');
    const btnDeleteRemarkTemplate = document.getElementById('btnDeleteRemarkTemplate');
    const dcRemarkTitle = document.getElementById('dcRemarkTitle');
    const dcRemarks = document.getElementById('dcRemarks');

    if (dcRemarksTemplate) {
        // Load Templates
        const loadTemplates = () => {
            const templates = JSON.parse(localStorage.getItem('dcRemarkTemplates') || '[]');
            dcRemarksTemplate.innerHTML = '<option value="">-- Select a Template --</option>';
            templates.forEach((t, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = t.title;
                dcRemarksTemplate.appendChild(opt);
            });
        };
        loadTemplates();

        // On Change
        dcRemarksTemplate.onchange = (e) => {
            const idx = e.target.value;
            if (idx === '') {
                btnDeleteRemarkTemplate.style.display = 'none';
                return;
            }
            const templates = JSON.parse(localStorage.getItem('dcRemarkTemplates') || '[]');
            const t = templates[idx];
            if (t) {
                dcRemarks.value = t.content;
                btnDeleteRemarkTemplate.style.display = 'inline-block';
            }
        };

        // Save Template
        btnSaveRemarkTemplate.onclick = () => {
            if (dcRemarkTitle.style.display === 'none') {
                dcRemarkTitle.style.display = 'block';
                dcRemarkTitle.focus();
                btnSaveRemarkTemplate.textContent = 'Confirm Save';
                return;
            }

            const title = dcRemarkTitle.value.trim();
            const content = dcRemarks.value.trim();

            if (!title || !content) {
                alert('Please enter both title and content for the template');
                return;
            }

            const templates = JSON.parse(localStorage.getItem('dcRemarkTemplates') || '[]');
            templates.push({ title, content });
            localStorage.setItem('dcRemarkTemplates', JSON.stringify(templates));
            
            loadTemplates();
            dcRemarkTitle.value = '';
            dcRemarkTitle.style.display = 'none';
            btnSaveRemarkTemplate.textContent = 'Save as Template';
            alert('Template saved!');
        };

        // Delete Template
        btnDeleteRemarkTemplate.onclick = () => {
            const idx = dcRemarksTemplate.value;
            if (idx === '') return;
            
            if (confirm('Delete this template?')) {
                const templates = JSON.parse(localStorage.getItem('dcRemarkTemplates') || '[]');
                templates.splice(idx, 1);
                localStorage.setItem('dcRemarkTemplates', JSON.stringify(templates));
                loadTemplates();
                dcRemarks.value = '';
                btnDeleteRemarkTemplate.style.display = 'none';
            }
        };
    }

    // Double Click on Headers to toggle
    const thRate = document.getElementById('dcThRate');
    const thAmount = document.getElementById('dcThAmount');
    const toggleHeaderHandler = () => {
        if (btnToggleRateAmount) btnToggleRateAmount.click();
    };
    if (thRate) thRate.ondblclick = toggleHeaderHandler;
    if (thAmount) thAmount.ondblclick = toggleHeaderHandler;

    if (btnOpenDC) {
        btnOpenDC.onclick = () => {
            const id = String(dcOpenId?.value || '').trim();
            if (!id) return showToast('Please enter a DC ID', 'warning');
            if (window.openDeliveryChallan) window.openDeliveryChallan(id);
        };
    }
    
    // --- Load Database Dropdowns ---
    loadDCDropdowns();

    if (dcOpenId) {
        dcOpenId.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnOpenDC?.click();
            }
        };
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
            
            // Combine permanent assets and temporary assets for search
            const allSearchableAssets = [
                ...(window.allAssets || []),
                ...(window.allTempAssets || [])
            ];

            const matches = allSearchableAssets.filter(a => 
                // Strict Category Filter - only for permanent assets (Temp assets usually don't have standard categories or we ignore it)
                // Actually, let's allow Temp assets to be searched regardless of category if they don't have one matching
                ((category === 'ALL' || a.Category === category) || !a.Category) && 
                // Global Search Logic (matchesQuery checks ID, Name, Serial, Location, User, etc.)
                matchesQuery(a, query) &&
                // Exclude already selected assets
                !selectedDCAssets.find(s => s.ID === a.ID)
            ).slice(0, 10);

            if (matches.length > 0) {
                dcSearchResults.innerHTML = matches.map(a => `
                    <div class="search-result-item" data-id="${a.ID}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${a.ItemName} ${a.IsPermanent === 0 ? '<span style="font-size: 9px; background: #fff3cd; color: #856404; padding: 1px 4px; border-radius: 2px;">TEMP</span>' : ''}</div>
                            <div style="font-size: 11px; color: #666; display: flex; gap: 8px;">
                                <span style="font-family: monospace; background: #eee; padding: 1px 4px; border-radius: 3px;">${a.ID}</span>
                                <span>${a.CurrentLocation || 'No Loc'}</span>
                                <span>${a.AssignedTo || 'Unassigned'}</span>
                            </div>
                        </div>
                        <div style="margin-left: 10px;">
                            <span style="font-size: 10px; padding: 2px 6px; border-radius: 10px; background: ${a.Status === 'In-Use' ? '#e6f4ea' : '#f8f9fa'}; color: ${a.Status === 'In-Use' ? '#1e7e34' : '#666'};">${a.Status || 'Active'}</span>
                        </div>
                    </div>
                `).join('');
                dcSearchResults.style.display = 'block';

                // Add click events to search results
                dcSearchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.onclick = () => {
                        const assetId = item.getAttribute('data-id');
                        // Search in both arrays
                        const asset = window.allAssets.find(a => a.ID === assetId) || (window.allTempAssets || []).find(a => a.ID === assetId);
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
        
        // Hide results on blur / click outside
        document.addEventListener('click', (e) => {
            if (dcAssetSearch && dcSearchResults && !dcAssetSearch.contains(e.target) && !dcSearchResults.contains(e.target)) {
                dcSearchResults.style.display = 'none';
            }
        });
    }

    // Generate DC Button
    if (btnGenerateDC) {
        btnGenerateDC.onclick = async () => {
            const customerName = (document.getElementById('dcCustomerName')?.value || '').trim();
            const deliveryDate = document.getElementById('dcDate')?.value || '';
            const assetIds = selectedDCAssets.map(a => a.ID);

            if (!customerName) return showToast('Please enter customer name', 'warning');
            if (assetIds.length === 0) return showToast('Please select at least one asset', 'warning');

            const payload = {
                company: {
                    name: document.getElementById('dcCompanyName')?.value || '',
                    address: document.getElementById('dcCompanyAddress')?.value || '',
                    gstin: document.getElementById('dcCompanyGST')?.value || '',
                    cin: document.getElementById('dcCompanyCIN')?.value || '',
                    stateName: document.getElementById('dcCompanyState')?.value || '',
                    stateCode: document.getElementById('dcCompanyStateCode')?.value || ''
                },
                consignee: {
                    name: document.getElementById('dcConsigneeName')?.value || '',
                    address: document.getElementById('dcConsigneeAddress')?.value || '',
                    gstin: document.getElementById('dcConsigneeGST')?.value || '',
                    stateName: document.getElementById('dcConsigneeState')?.value || '',
                    stateCode: document.getElementById('dcConsigneeStateCode')?.value || ''
                },
                buyer: {
                    name: document.getElementById('dcBuyerName')?.value || '',
                    address: document.getElementById('dcBuyerAddress')?.value || '',
                    gstin: document.getElementById('dcBuyerGST')?.value || '',
                    stateName: document.getElementById('dcBuyerState')?.value || '',
                    stateCode: document.getElementById('dcBuyerStateCode')?.value || ''
                },
                meta: {
                    customerName,
                    deliveryDate,
                    referenceNo: document.getElementById('dcRefNo')?.value || '',
                    buyerOrderNo: document.getElementById('dcBuyerOrderNo')?.value || '',
                    dispatchDocNo: document.getElementById('dcDispatchDocNo')?.value || '',
                    otherReferences: document.getElementById('dcOtherReferences')?.value || '',
                    dispatchedThrough: document.getElementById('dcDispatchedThrough')?.value || '',
                    destination: document.getElementById('dcDestination')?.value || '',
                    termsOfDelivery: document.getElementById('dcTermsOfDelivery')?.value || ''
                },
                items: assetIds.map((assetId, index) => {
                    const row = dcItemsByAssetId[assetId] || {};
                    return {
                        sr: index + 1,
                        assetId,
                        description: row.description || assetId,
                        hsn: row.hsn || '',
                        qty: row.qty ?? 1,
                        per: row.per || 'NO',
                        rate: row.rate ?? '',
                        amount: row.amount ?? ''
                    };
                })
            };

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
                        CreatedBy: localStorage.getItem('username') || 'System',
                        payload
                    })
                });

                const result = await response.json();
                if (result.success) {
                    showDCPreview(result);
                } else {
                    showToast('Error creating DC: ' + result.error, 'error');
                }
            } catch (err) {
                console.error('DC Creation Error:', err);
                showToast('Failed to connect to server', 'error');
            } finally {
                btnGenerateDC.textContent = 'Generate DC & QR Code';
                btnGenerateDC.disabled = false;
            }
        };
    }

    // Print DC Button
    if (btnPrintDC) {
        btnPrintDC.onclick = () => {
            const body = document.body;
            const cleanup = () => {
                body.classList.remove('print-dc');
                window.removeEventListener('afterprint', cleanup);
            };
            body.classList.add('print-dc');
            window.addEventListener('afterprint', cleanup);
            setTimeout(() => window.print(), 50);
        };
    }
}

function addAssetToDC(asset) {
    selectedDCAssets.push(asset);
    if (!dcItemsByAssetId[asset.ID]) {
        const rateCandidate = toNumber(asset.asset_value);
        const qty = 1;
        const amount = rateCandidate === null ? '' : round2(rateCandidate * qty);
        dcItemsByAssetId[asset.ID] = {
            assetId: asset.ID,
            description: `${asset.ItemName || asset.ID}${asset.Model ? ' - ' + asset.Model : ''}`,
            hsn: '',
            qty,
            per: 'NO',
            rate: rateCandidate === null ? '' : rateCandidate,
            amount: amount === '' ? '' : amount
        };
    }
    renderSelectedAssets();
}

function removeAssetFromDC(assetId) {
    selectedDCAssets = selectedDCAssets.filter(a => a.ID !== assetId);
    delete dcItemsByAssetId[assetId];
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
    dcSelectedAssetsBody.innerHTML = selectedDCAssets.map(a => {
        const row = dcItemsByAssetId[a.ID] || {};
        const displayStyle = showRateAmount ? '' : 'display: none;';
        return `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; font-family: monospace; font-size: 12px; white-space: nowrap;">${a.ID}</td>
                <td style="padding: 10px;">
                    <input data-dc-field="description" data-asset-id="${a.ID}" value="${String(row.description || a.ItemName || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" />
                </td>
                <td style="padding: 10px; width: 90px;">
                    <input data-dc-field="hsn" data-asset-id="${a.ID}" value="${String(row.hsn || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" />
                </td>
                <td style="padding: 10px; width: 60px;">
                    <input data-dc-field="per" data-asset-id="${a.ID}" value="${row.per || 'Pcs'}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; text-align: center;" />
                </td>
                <td style="padding: 10px; width: 70px;">
                    <input data-dc-field="qty" data-asset-id="${a.ID}" value="${row.qty ?? 1}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; text-align: right;" />
                </td>
                <td class="dc-rate-col" style="padding: 10px; width: 90px; ${displayStyle}">
                    <input data-dc-field="rate" data-asset-id="${a.ID}" value="${row.rate ?? ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; text-align: right;" />
                </td>
                <td class="dc-amount-col" style="padding: 10px; width: 100px; text-align: right; font-variant-numeric: tabular-nums; ${displayStyle}">
                    <span data-dc-field="amount" data-asset-id="${a.ID}">${row.amount ?? ''}</span>
                </td>
                <td style="padding: 10px; text-align: center; width: 60px;">
                    <button onclick="removeAssetFromDC('${a.ID}')" style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 18px;">&times;</button>
                </td>
            </tr>
        `;
    }).join('');

    dcSelectedAssetsBody.querySelectorAll('input[data-dc-field]').forEach((input) => {
        input.oninput = () => {
            const assetId = input.getAttribute('data-asset-id');
            const field = input.getAttribute('data-dc-field');
            if (!assetId || !field) return;

            const existing = dcItemsByAssetId[assetId] || { assetId };
            const next = { ...existing, [field]: input.value };
            if (field === 'qty' || field === 'rate') {
                const qty = toNumber(next.qty);
                const rate = toNumber(next.rate);
                if (qty !== null) next.qty = qty;
                if (rate !== null) next.rate = rate;
                if (qty !== null && rate !== null) {
                    next.amount = round2(qty * rate);
                } else {
                    next.amount = '';
                }
                const amountEl = dcSelectedAssetsBody.querySelector(`span[data-dc-field="amount"][data-asset-id="${assetId}"]`);
                if (amountEl) amountEl.textContent = next.amount ?? '';
            }
            dcItemsByAssetId[assetId] = next;
        };
    });
}

// Expose to global for onclick handlers and main.js navigation
window.removeAssetFromDC = removeAssetFromDC;
window.initDCView = initDCView;
window.initSheetView = initSheetView;

function showDCPreview(result) {
    const modal = document.getElementById('dcPreviewModal');
    const printable = document.getElementById('printableDC');
    const payload = result?.payload && typeof result.payload === 'object' ? result.payload : {};
    const company = payload.company || {};
    const consignee = payload.consignee || {};
    const buyer = payload.buyer || {};
    const meta = payload.meta || {};
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (printable) {
        const itemsHtml = items.map((it, idx) => {
            const qty = it.qty ?? '';
            const rate = it.rate ?? '';
            const amount = it.amount ?? '';
            return `
                <tr>
                    <td style="padding: 7px; border: 1px solid #222; text-align: center; width: 34px;">${idx + 1}</td>
                    <td style="padding: 7px; border: 1px solid #222; font-family: monospace; white-space: nowrap; width: 150px;">${escapeHtml(it.assetId || '')}</td>
                    <td style="padding: 7px; border: 1px solid #222;">${escapeHtml(it.description || '')}</td>
                    <td style="padding: 7px; border: 1px solid #222; text-align: center; width: 80px;">${escapeHtml(it.hsn || '')}</td>
                    <td style="padding: 7px; border: 1px solid #222; text-align: right; width: 60px; font-variant-numeric: tabular-nums;">${escapeHtml(qty)}</td>
                    <td style="padding: 7px; border: 1px solid #222; text-align: center; width: 55px;">${escapeHtml(it.per || 'NO')}</td>
                    <td style="padding: 7px; border: 1px solid #222; text-align: right; width: 90px; font-variant-numeric: tabular-nums;">${escapeHtml(rate)}</td>
                    <td style="padding: 7px; border: 1px solid #222; text-align: right; width: 110px; font-variant-numeric: tabular-nums;">${escapeHtml(amount)}</td>
                </tr>
            `;
        }).join('');

        const totalAmount = items.reduce((acc, it) => {
            const n = toNumber(it.amount);
            return acc + (n === null ? 0 : n);
        }, 0);
        const totalWords = formatAmountWords(round2(totalAmount));
        const challanNo = result.challanNo || result.ChallanNo || '';
        const dcId = result.id || result.ID || '';
        const dated = meta.deliveryDate || meta.dated || result.deliveryDate || result.DeliveryDate || '';

        printable.innerHTML = `
            <div style="border: 2px solid #222; padding: 14px; color: #111; font-family: Arial, sans-serif;">
                <div style="display: grid; grid-template-columns: 1fr 260px; gap: 12px; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 10px;">
                    <div>
                        <div style="font-size: 16px; font-weight: 800; letter-spacing: 0.3px;">${escapeHtml(company.name || '')}</div>
                        <div style="white-space: pre-wrap; font-size: 12px; margin-top: 4px;">${escapeHtml(company.address || '')}</div>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; margin-top: 6px;">
                            ${(company.gstin || '').trim() ? `<div><span style="color:#555;">GSTIN/UIN:</span> ${escapeHtml(company.gstin)}</div>` : ''}
                            ${(company.cin || '').trim() ? `<div><span style="color:#555;">CIN:</span> ${escapeHtml(company.cin)}</div>` : ''}
                            ${(company.stateName || company.stateCode) ? `<div><span style="color:#555;">State:</span> ${escapeHtml(company.stateName || '')}${company.stateCode ? ' (' + escapeHtml(company.stateCode) + ')' : ''}</div>` : ''}
                        </div>
                    </div>
                    <div style="border-left: 1px solid #222; padding-left: 12px;">
                        <div style="text-align: center; font-size: 18px; font-weight: 900; letter-spacing: 1px;">DELIVERY CHALLAN</div>
                        <div style="display: grid; grid-template-columns: 90px 1fr; gap: 4px 8px; margin-top: 10px; font-size: 12px;">
                            <div style="color:#555;">DC No</div><div style="font-weight:800;">${escapeHtml(challanNo)}</div>
                            <div style="color:#555;">Dated</div><div style="font-weight:800;">${escapeHtml(dated)}</div>
                            ${dcId ? `<div style="color:#555;">DC ID</div><div style="font-weight:700; font-family: monospace;">${escapeHtml(dcId)}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div style="border: 1px solid #222; padding: 10px;">
                        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">Consignee (Ship To)</div>
                        <div style="font-size: 13px; font-weight: 800;">${escapeHtml(consignee.name || meta.customerName || '')}</div>
                        <div style="white-space: pre-wrap; font-size: 12px; margin-top: 4px;">${escapeHtml(consignee.address || '')}</div>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; margin-top: 6px;">
                            ${(consignee.gstin || '').trim() ? `<div><span style="color:#555;">GSTIN/UIN:</span> ${escapeHtml(consignee.gstin)}</div>` : ''}
                            ${(consignee.stateName || consignee.stateCode) ? `<div><span style="color:#555;">State:</span> ${escapeHtml(consignee.stateName || '')}${consignee.stateCode ? ' (' + escapeHtml(consignee.stateCode) + ')' : ''}</div>` : ''}
                        </div>
                    </div>
                    <div style="border: 1px solid #222; padding: 10px;">
                        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">Buyer (Bill To)</div>
                        <div style="font-size: 13px; font-weight: 800;">${escapeHtml(buyer.name || meta.customerName || '')}</div>
                        <div style="white-space: pre-wrap; font-size: 12px; margin-top: 4px;">${escapeHtml(buyer.address || '')}</div>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; margin-top: 6px;">
                            ${(buyer.gstin || '').trim() ? `<div><span style="color:#555;">GSTIN/UIN:</span> ${escapeHtml(buyer.gstin)}</div>` : ''}
                            ${(buyer.stateName || buyer.stateCode) ? `<div><span style="color:#555;">State:</span> ${escapeHtml(buyer.stateName || '')}${buyer.stateCode ? ' (' + escapeHtml(buyer.stateCode) + ')' : ''}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div style="border: 1px solid #222; padding: 10px; margin-bottom: 10px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                        <div><span style="color:#555;">Reference No</span>: ${escapeHtml(meta.referenceNo || '')}</div>
                        <div><span style="color:#555;">Buyer’s Order No</span>: ${escapeHtml(meta.buyerOrderNo || '')}</div>
                        <div><span style="color:#555;">Dispatch Doc No</span>: ${escapeHtml(meta.dispatchDocNo || '')}</div>
                        <div><span style="color:#555;">Other References</span>: ${escapeHtml(meta.otherReferences || '')}</div>
                        <div><span style="color:#555;">Dispatched Through</span>: ${escapeHtml(meta.dispatchedThrough || '')}</div>
                        <div><span style="color:#555;">Destination</span>: ${escapeHtml(meta.destination || '')}</div>
                    </div>
                    ${(meta.termsOfDelivery || '').trim() ? `<div style="margin-top: 8px; font-size: 12px;"><span style="color:#555;">Terms of Delivery</span>: ${escapeHtml(meta.termsOfDelivery)}</div>` : ''}
                </div>

                <table style="width: 100%; border-collapse: collapse; border: 1px solid #222;">
                    <thead>
                        <tr style="background: #f4f4f4;">
                            <th style="padding: 7px; border: 1px solid #222; text-align: center; width: 34px;">Srl</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: left; width: 150px;">Asset ID</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: left;">Description of Goods</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: center; width: 80px;">HSN/SAC</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: right; width: 60px;">Qty</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: center; width: 55px;">Per</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: right; width: 90px;">Rate</th>
                            <th style="padding: 7px; border: 1px solid #222; text-align: right; width: 110px;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml || `<tr><td colspan="8" style="padding: 12px; border: 1px solid #222; color:#666; text-align:center;">No items</td></tr>`}
                        <tr>
                            <td colspan="7" style="padding: 8px; border: 1px solid #222; text-align: right; font-weight: 800;">Total</td>
                            <td style="padding: 8px; border: 1px solid #222; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums;">${escapeHtml(round2(totalAmount))}</td>
                        </tr>
                    </tbody>
                </table>

                <div style="border: 1px solid #222; border-top: none; padding: 10px; font-size: 12px;">
                    <div style="display: grid; grid-template-columns: 190px 1fr; gap: 8px;">
                        <div style="color:#555;">Amount Chargeable (in words)</div>
                        <div style="font-weight: 700;">${escapeHtml(totalWords)}</div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 160px 1fr; gap: 12px; margin-top: 14px; align-items: end;">
                    <div>
                        <div style="height: 60px;"></div>
                        <div style="border-top: 1px solid #222; width: 190px; padding-top: 6px; font-size: 12px;">Receiver's Signature</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 10px; color: #666; margin-bottom: 6px;">VALIDATE</div>
                        <img src="${result.qrCode || result.QRCode || ''}" style="width: 120px; height: 120px; border: 1px solid #eee; padding: 6px;" />
                    </div>
                    <div style="text-align: right;">
                        <div style="height: 60px;"></div>
                        <div style="border-top: 1px solid #222; width: 190px; padding-top: 6px; font-size: 12px; margin-left: auto;">Authorized Signatory</div>
                    </div>
                </div>
            </div>
        `;
    }

    modal.style.display = 'flex';
}

async function openDeliveryChallan(dcId) {
    const id = String(dcId || '').trim();
    if (!id) return;

    const nav = document.getElementById('nav-dc');
    if (nav) nav.click();

    try {
        const res = await fetch(`/api/dc/${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            showToast('Failed to load DC: ' + (data.error || res.statusText), 'error');
            return;
        }

        const dc = data.dc || {};
        showDCPreview({
            id: dc.ID,
            challanNo: dc.ChallanNo,
            qrCode: dc.QRCode,
            payload: data.payload || null,
            deliveryDate: dc.DeliveryDate,
            customerName: dc.CustomerName
        });
    } catch (err) {
        console.error('Failed to load DC:', err);
        showToast('Failed to load DC', 'error');
    }
}

window.openDeliveryChallan = openDeliveryChallan;

async function initSheetView() {
    console.log('initSheetView() called');
    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
    
    let assets = [];
    let isTemp = window.currentDashboardParent && window.currentDashboardParent.ID === 'TEMP_VIEW';

    if (isTemp) {
        if (!window.currentTempAssets || window.currentTempAssets.length === 0) {
            console.log('Fetching temporary assets for sheet view...');
            try {
                const response = await fetch('/api/temporary-assets');
                window.currentTempAssets = await response.json();
            } catch (err) {
                console.error('Error fetching temp assets for sheet:', err);
            }
        }
        assets = window.currentTempAssets || [];
        console.log('Loading temporary assets into sheet view:', assets.length);
    } else {
        assets = (window.allAssets || []).filter(a => 
            a.Category === category && 
            !(a.isPlaceholder === true || a.isPlaceholder === 1 || a.isPlaceholder === 'true')
        );

        const parent = window.currentDashboardParent;
        const manager = window.hierarchyManager;

        if (parent && manager) {
            let parentNode = manager.findNode(parent.ID);
            if (parentNode) {
                const descendants = manager.getDescendants(parentNode.ID, true);
                const descendantKindNames = descendants.map(d => d.Name);

                assets = assets.filter(a => {
                    const assetType = (a.Type || '').toLowerCase().trim();
                    const assetName = (a.Name || '').toLowerCase().trim();

                    return descendantKindNames.some(kindName => {
                        const k = (kindName || '').toLowerCase().trim();
                        const t = assetType;

                        if (t === k) return true;
                        if (t === k + 's' || t + 's' === k) return true;
                        if (t === k + 'es' || t + 'es' === k) return true;
                        if (k.endsWith('y') && t === k.slice(0, -1) + 'ies') return true;
                        if (t.endsWith('y') && k === t.slice(0, -1) + 'ies') return true;
                        if (assetName === k) return true;

                        return false;
                    });
                });
            }
        }

        console.log('Assets for sheet view:', assets.length);
    }

    if (window.tabulatorInstance) {
        // Update columns if switching between temp and regular
        if (isTemp) {
            const tempColumns = [
                { title: "ID", field: "ID", width: 120, headerFilter: "input" },
                { title: "Item Name", field: "ItemName", headerFilter: "input" },
                { title: "Project ID", field: "ProjectId", width: 120, headerFilter: "input" },
                { title: "Quantity", field: "Quantity", width: 100, headerFilter: "number" },
                { title: "Price", field: "EstimatedPrice", width: 100, headerFilter: "number" },
                { title: "Currency", field: "Currency", width: 80 },
                { title: "Make", field: "Make", headerFilter: "input" },
                { title: "Model", field: "Model", headerFilter: "input" },
                { title: "Status", field: "Status", width: 120 },
                { title: "Actions", width: 150, hozAlign: "center", headerFilter: false, formatter: function(cell) {
                    return `
                        <div style="display: flex; gap: 5px;">
                            <button class="btn-action" style="font-size: 10px; background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; border-radius: 4px; padding: 2px 6px; cursor: pointer;">Convert</button>
                            <button class="btn-action" style="font-size: 10px; background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; border-radius: 4px; padding: 2px 6px; cursor: pointer;">Delete</button>
                        </div>
                    `;
                }, cellClick: function(e, cell) {
                    const data = cell.getRow().getData();
                    const target = e.target;
                    if (target.innerText === 'Convert') {
                        e.stopPropagation();
                        window.makeAssetPermanent(data.ID);
                    } else if (target.innerText === 'Delete') {
                        e.stopPropagation();
                        window.deleteTempAsset(data.ID);
                    }
                }}
            ];
            window.tabulatorInstance.setColumns(tempColumns);
        } else {
            // Restore regular columns (simplified for now, ideally we'd re-run the column logic)
            // For simplicity, let's just destroy and recreate if columns change significantly
            // Or better, just recreate the whole thing if we're switching modes
            window.tabulatorInstance.destroy();
            window.tabulatorInstance = null;
            return initSheetView(); 
        }

        window.tabulatorInstance.setData(assets).then(() => {
            robustRedraw(window.tabulatorInstance);
        });
        return;
    }

    let columns = [];
    if (isTemp) {
        columns = [
            { title: "ID", field: "ID", width: 120, headerFilter: "input" },
            { title: "Item Name", field: "ItemName", headerFilter: "input" },
            { title: "Project ID", field: "ProjectId", width: 120, headerFilter: "input" },
            { title: "Quantity", field: "Quantity", width: 100, headerFilter: "number" },
            { title: "Price", field: "EstimatedPrice", width: 100, headerFilter: "number" },
            { title: "Currency", field: "Currency", width: 80 },
            { title: "Make", field: "Make", headerFilter: "input" },
            { title: "Model", field: "Model", headerFilter: "input" },
            { title: "Status", field: "Status", width: 120 },
            { title: "Actions", width: 150, hozAlign: "center", headerFilter: false, formatter: function(cell) {
                return `
                    <div style="display: flex; gap: 5px;">
                        <button class="btn-action" style="font-size: 10px; background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; border-radius: 4px; padding: 2px 6px; cursor: pointer;">Convert</button>
                        <button class="btn-action" style="font-size: 10px; background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; border-radius: 4px; padding: 2px 6px; cursor: pointer;">Delete</button>
                    </div>
                `;
            }, cellClick: function(e, cell) {
                const data = cell.getRow().getData();
                const target = e.target;
                if (target.innerText === 'Convert') {
                    e.stopPropagation();
                    window.makeAssetPermanent(data.ID);
                } else if (target.innerText === 'Delete') {
                    e.stopPropagation();
                    window.deleteTempAsset(data.ID);
                }
            }}
        ];
    } else {
        columns = [
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
            { title: "Last Updated", field: "LastUpdated", width: 150, hozAlign: "center" },
            { title: "Actions", width: 100, hozAlign: "center", headerFilter: false, formatter: function(cell) {
                return `<button class="btn-action" style="font-size: 10px; background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; border-radius: 4px; padding: 2px 6px; cursor: pointer;">Delete</button>`;
            }, cellClick: function(e, cell) {
                e.stopPropagation();
                const data = cell.getRow().getData();
                window.deleteAsset(data.ID);
            }}
        );
    }

    console.log('[SheetView] Initializing Tabulator with', assets ? assets.length : 'null', 'assets');
    console.log('[SheetView] Assets type:', typeof assets, 'IsArray:', Array.isArray(assets));

    // Ensure assets is an array to prevent "Received: object" error
    if (!Array.isArray(assets)) {
        console.warn('[SheetView] Assets is not an array, converting...');
        assets = Array.from(assets || []);
    }

    window.tabulatorInstance = new Tabulator("#excel-grid", {
        ...TABULATOR_BASE_CONFIG,
        paginationSize: 10,
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
        },
        rowClick: function(e, row) {
            const data = row.getData();
            const isTemp = window.currentDashboardParent && window.currentDashboardParent.ID === 'TEMP_VIEW';
            if (isTemp) {
                window.showTempAssetDetails(data.ID);
            } else {
                window.showAssetDetails(data.ID);
            }
        }
    });

    registerTabulator(window.tabulatorInstance);
    
    // Ensure redraw to handle flexbox initialization
    robustRedraw(window.tabulatorInstance);
}

// matchesQuery is already defined at top of file
// function matchesQuery(asset, query) {
// ...
// }

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

            const currentAssetId = document.getElementById('assetDbId')?.value;
            const matches = (window.allAssets || []).filter(a => {
                const s = query;
                return (
                    (a.ID?.toLowerCase().includes(s) || 
                     a.ItemName?.toLowerCase().includes(s) || 
                     a.SrNo?.toLowerCase().includes(s) ||
                     a.Make?.toLowerCase().includes(s) ||
                     a.Model?.toLowerCase().includes(s)) &&
                    (!a.ParentId || a.ParentId === '' || a.ParentId === currentAssetId)
                );
            }).slice(0, 10);

            if (matches.length > 0) {
                resultsContainer.innerHTML = matches.map(m => `
                    <div class="search-result-item" data-id="${m.ID}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px; display: flex; flex-direction: column; line-height: 1.3;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: bold;">${m.ItemName}</span>
                            <span style="color: #666; font-size: 11px;">${m.SrNo || 'No Serial'}</span>
                        </div>
                        <div style="font-size: 10px; color: #999;">
                            ID: ${m.ID} ${m.Make ? ` | ${m.Make}` : ''} ${m.Model ? ` | ${m.Model}` : ''}
                        </div>
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

export function setupConversionUI() {
    console.log('setupConversionUI() initialized');
    const btnApply = document.getElementById('btnApplyConversion');
    if (!btnApply) {
        console.warn('btnApplyConversion not found in DOM');
        return;
    }
    
    btnApply.onclick = () => {
        console.log('Apply Conversion clicked');
            const qtyUnitEl = document.getElementById('itemQtyUnit');
            const qtyTotalEl = document.getElementById('itemQtyTotal');
            const convUnitEl = document.getElementById('itemConvUnit');
            const convFactorEl = document.getElementById('itemConvFactor');
            const convModeEl = document.getElementById('itemConvMode');

            if (!qtyUnitEl || !qtyTotalEl || !convUnitEl || !convFactorEl || !convModeEl) return;

            const convUnit = convUnitEl.value.trim();
            const convFactor = parseFloat(convFactorEl.value);
            const convMode = convModeEl.value; // 'multiply' or 'divide'

            if (!convUnit) {
                showToast('Please enter a conversion unit.', 'warning');
                return;
            }
            if (isNaN(convFactor) || convFactor <= 0) {
                showToast('Please enter a valid positive conversion factor.', 'warning');
                return;
            }

            const currentQty = parseFloat(qtyTotalEl.value) || 0;
            let newQty;
            let operationLabel;

            if (convMode === 'divide') {
                newQty = (currentQty / convFactor).toFixed(4);
                operationLabel = 'divide';
            } else {
                newQty = (currentQty * convFactor).toFixed(4);
                operationLabel = 'multiply';
            }

            if (confirm(`Are you sure you want to convert base unit from "${qtyUnitEl.value || 'None'}" to "${convUnit}"?\n\nThis will ${operationLabel} current quantity (${currentQty}) by ${convFactor} resulting in ${newQty} ${convUnit}.`)) {
                qtyUnitEl.value = convUnit;
                qtyTotalEl.value = parseFloat(newQty); // Remove trailing zeros
                
                // Keep the conversion parameters for persistence so they can be reused
                // Only clear the "Apply" state visually if needed, but we want them saved
                // convUnitEl.value = ''; // Don't clear these yet, let the save collect them
                // convFactorEl.value = '';
                
                showToast(`Successfully converted base unit to ${convUnit}. Click "Save Changes" to finalize.`, 'success');
            }
        };
}

export function addLinkedComponent(asset) {
    const linkedList = document.getElementById('linkedComponentsList');
    if (!linkedList) return;

    // Safety check: Don't add if already assigned to another parent
    const currentAssetId = document.getElementById('assetDbId')?.value;
    if (asset.ParentId && asset.ParentId !== '' && asset.ParentId !== currentAssetId) {
        showToast(`Asset ${asset.ID} is already assigned to parent ${asset.ParentId}`, 'warning');
        return;
    }

    // Avoid duplicates
    if (linkedList.querySelector(`[data-id="${asset.ID}"]`)) return;

    const tag = document.createElement('div');
    tag.className = 'linked-component-tag';
    tag.setAttribute('data-id', asset.ID);
    tag.style = 'background: #e7f3ff; color: #0078d4; padding: 4px 10px; border-radius: 12px; font-size: 11px; display: flex; align-items: center; gap: 8px; border: 1px solid #0078d4;';
    
    // Display Format: Name (SerialNo) [ID as tooltip/small]
    const displayName = asset.ItemName || 'Component';
    const displaySr = asset.SrNo ? `(${asset.SrNo})` : '';
    
    tag.innerHTML = `
        <div style="display: flex; flex-direction: column; line-height: 1.2;">
            <span style="font-weight: bold;">${displayName} ${displaySr}</span>
            <span style="font-size: 9px; opacity: 0.7;">ID: ${asset.ID}</span>
        </div>
        <span class="remove-link" style="cursor: pointer; font-weight: bold; font-size: 14px;">&times;</span>
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
    
    // Store existing ID if available
    const assetId = data?.ID || '';
    
    row.innerHTML = `
        <input type="hidden" class="child-id" value="${assetId}">
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
    setupConversionUI();
    
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
                    showToast(`Tally Sync Successful! ${result.message}`, 'success');
                    if (window.loadAssets) await window.loadAssets(); // Refresh assets
                } else {
                    showToast(`Tally Sync Failed: ${result.message}`, 'error');
                }
            } catch (err) {
                console.error('Tally Sync Error:', err);
                showToast('Failed to connect to backend for Tally sync.', 'error');
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
            showToast('Microsoft Graph API integration requires Azure AD app registration. Please configure Client ID in settings.', 'info');
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
                showToast('Please select at least one asset to print.', 'warning');
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
    const assetKanban = document.getElementById('assetKanban');
    const assetGrid = document.getElementById('assetGrid');

    // Ensure Asset Kanban/Grid is hidden when entering Project View
    if (assetKanban) assetKanban.style.display = 'none';
    if (assetGrid) assetGrid.style.display = 'none';
    if (projectsGrid) {
        projectsGrid.style.display = 'flex'; // Restore project grid visibility
        projectsGrid.classList.remove('hidden'); // Ensure it's not hidden by class
    }
    
    // Also ensure the parent dashboard view is visible if needed, 
    // but usually this function is called after showing the view.
    
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
                          <div style="font-size: 0.65rem; color: #aaa; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px;">
                            ${p.ID}
                            <button onclick="event.stopPropagation(); showQRModal('${p.ID}', '${p.Name.replace(/'/g, "\\'")}')" 
                                    style="border: none; background: none; padding: 2px; cursor: pointer; opacity: 0.6; display: flex; align-items: center;" 
                                    title="Show Project QR Code">
                                <span style="font-size: 14px;">🔳</span>
                            </button>
                          </div>
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
        showToast('Failed to move project', 'error');
    }
};

window.updateProjectField = async function(projectId, field, value) {
    const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'x-user': localStorage.getItem('currentUser') ? JSON.parse(localStorage.getItem('currentUser')).username : 'web'
        },
        body: JSON.stringify({ [field]: value })
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

window.updateProjectStatus = async function(projectId, status) {
    return window.updateProjectField(projectId, 'Status', status);
};

window.showProjectDetails = async function(projectId) {
    console.log(`[ProjectDetails] Opening details for project ID: "${projectId}"`);
    currentProjectId = projectId;
    const modal = document.getElementById('projectDetailsModal');
    const title = document.getElementById('modalProjectTitle');
    const clientInfo = document.getElementById('projectClientInfo');
    const projectStats = document.getElementById('projectStats');
    const clientUserAction = document.getElementById('clientUserAction');
    
    if (!modal) {
        console.error('[ProjectDetails] Modal "projectDetailsModal" not found in DOM');
        return;
    }
    if (!clientInfo) {
        console.error('[ProjectDetails] Container "projectClientInfo" not found in DOM');
        return;
    }

    // Show loading state
    console.log('[ProjectDetails] Showing loading state and modal...');
    clientInfo.innerHTML = '<div style="text-align:center; padding: 20px;"><div class="spinner"></div><p>Loading project details...</p></div>';
    modal.style.display = 'flex';

    // Hide client user creation for non-admins
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            console.log('[ProjectDetails] Current user role:', user.role);
            if (clientUserAction) {
                clientUserAction.style.display = (user.role === 'admin' || user.role === 'superuser') ? 'block' : 'none';
            }
        } catch (e) {
            console.warn('[ProjectDetails] Failed to parse currentUser from localStorage');
        }
    }

    try {
        console.log(`[ProjectDetails] Fetching details from /api/projects/${projectId}...`);
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) {
            console.error(`[ProjectDetails] Fetch failed with status: ${response.status}`);
            throw new Error(`Project not found (${response.status})`);
        }
        const project = await response.json();
        console.log('[ProjectDetails] Received project data:', project);
        
        currentProjectCurrency = project.Currency || 'INR';
        const projectSymbol = getCurrencySymbol(currentProjectCurrency);
        
        if (title) title.textContent = `Project: ${project.Name || project.ProjectName || project.ID}`;
        
        // Comprehensive Project Information Grid
        console.log('[ProjectDetails] Rendering project info grid...');
        clientInfo.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                    <div style="font-size: 60px; margin-bottom: 15px; text-align: center; display: flex; align-items: center; justify-content: center; height: 100px; background: #f0f7ff; border-radius: 12px; border: 1px solid #d0e7ff;">
                        🏗️
                    </div>
                    <div class="info-group" style="margin-bottom: 12px;">
                        <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Client Name</label>
                        <div class="value" style="font-weight: 700; font-size: 1.2rem; color: #0052cc; margin-top: 4px;">${project.ClientName || 'N/A'}</div>
                    </div>
                    <div class="info-group" style="margin-bottom: 12px;">
                        <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Location</label>
                        <div class="value" style="font-weight: 600; color: #333; display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                            📍 ${project.Location || 'MUMBAI'}
                        </div>
                    </div>
                    <div class="info-group" style="margin-bottom: 12px;">
                        <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Status</label>
                        <select class="status-select" onchange="updateProjectStatus('${project.ID}', this.value).then(() => initProjectsView())" style="
                            padding: 6px 12px;
                            border-radius: 6px;
                            border: 2px solid #e2e8f0;
                            font-size: 0.9rem;
                            font-weight: 600;
                            background: #fff;
                            cursor: pointer;
                            width: 100%;
                            margin-top: 6px;
                            transition: border-color 0.2s;
                        ">
                            <option value="Planning" ${project.Status === 'Planning' ? 'selected' : ''}>📋 Planning</option>
                            <option value="Active" ${project.Status === 'Active' ? 'selected' : ''}>⚡ Active</option>
                            <option value="Completed" ${project.Status === 'Completed' ? 'selected' : ''}>✅ Completed</option>
                            <option value="On Hold" ${project.Status === 'On Hold' ? 'selected' : ''}>⏸️ On Hold</option>
                        </select>
                    </div>
                </div>
                <div>
                    <div style="margin-bottom: 20px; text-align: center; background: white; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <img src="/api/qr/${encodeURIComponent(project.ID)}?v=${Date.now()}" style="width: 140px; height: 140px; cursor: pointer; transition: transform 0.2s;" 
                             onclick="showQRModal('${project.ID}', '${(project.Name || project.ProjectName || project.ID).replace(/'/g, "\\'")}')" 
                             onmouseover="this.style.transform='scale(1.05)'"
                             onmouseout="this.style.transform='scale(1)'"
                             title="Click to enlarge">
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px; font-weight: 500;">Project QR Code</div>
                    </div>
                    <div class="info-group" style="margin-bottom: 12px;">
                        <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Timeline</label>
                        <div class="value" style="font-weight: 600; color: #333; display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                            📅 ${project.StartDate ? new Date(project.StartDate).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}) : 'TBD'} 
                            <span style="color: #94a3b8;">→</span> 
                            ${project.EndDate ? new Date(project.EndDate).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}) : 'TBD'}
                        </div>
                    </div>
                    <div class="info-group" style="margin-bottom: 12px;">
                        <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Financials</label>
                        <div class="value" style="font-weight: 700; color: #059669; font-size: 1rem; margin-top: 4px;">
                            ${projectSymbol} <span id="projectTotalValue">Loading...</span> <span style="font-size: 0.8rem; color: #666; font-weight: 500;">(${currentProjectCurrency})</span>
                        </div>
                    </div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px;">
                <div class="info-group">
                    <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Owner Email</label>
                    <div style="position: relative; margin-top: 4px;">
                        <input type="email" class="form-input" value="${project.OwnerEmail || ''}" 
                            onchange="updateProjectField('${project.ID}', 'OwnerEmail', this.value)" 
                            style="width: 100%; padding: 8px 12px; font-size: 0.9rem; border: 1px solid #e2e8f0; border-radius: 6px; font-weight: 500;"
                            placeholder="owner@example.com">
                    </div>
                </div>
                <div class="info-group">
                    <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Coordinator Email</label>
                    <div style="position: relative; margin-top: 4px;">
                        <input type="email" class="form-input" value="${project.CoordinatorEmail || ''}" 
                            onchange="updateProjectField('${project.ID}', 'CoordinatorEmail', this.value)" 
                            style="width: 100%; padding: 8px 12px; font-size: 0.9rem; border: 1px solid #e2e8f0; border-radius: 6px; font-weight: 500;"
                            placeholder="coordinator@example.com">
                    </div>
                </div>
            </div>
            <div class="info-group" style="margin-top: 15px;">
                <label style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Description / Scope</label>
                <div class="value" style="background: #f8fafc; padding: 12px; border-radius: 8px; border-left: 4px solid #0052cc; min-height: 50px; margin-top: 6px; font-size: 0.95rem; line-height: 1.5;">
                    ${project.Description || '<span style="color: #94a3b8; font-style: italic;">No description provided</span>'}
                </div>
            </div>
            <div style="margin-top: 25px; text-align: right; border-top: 2px solid #f1f5f9; padding-top: 20px; display: flex; justify-content: flex-end; gap: 12px;">
                 <button onclick="navigateToProjectPage('${project.ID}')" class="btn-action" style="background: #36b37e; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    🌐 Full View Page
                 </button>
            </div>
        `;

        // Load assets and calculate stats
        const assets = await loadProjectAssets(projectId);
        const tempAssets = await loadProjectTempAssets(projectId);
        
        // Calculate total value in project currency
        let totalValue = 0;
        assets.forEach(a => {
            const isComp = a.isComponent === true || a.isComponent === 'true' || a.isComponent === 1 || a.isComponent === '1';
            if (a.AssignmentType !== 'Temporary' && !isComp) {
                totalValue += convertCurrency(a.EstimatedPrice || 0, a.Currency || 'INR', currentProjectCurrency);
            }
        });
        tempAssets.forEach(a => {
            totalValue += convertCurrency(a.EstimatedPrice || 0, a.Currency || 'INR', currentProjectCurrency);
        });
        
        if (projectStats) {
            projectStats.innerHTML = `
                <div class="stat-item">
                    <span class="stat-value">${assets.filter(a => {
                        const isComp = a.isComponent === true || a.isComponent === 'true' || a.isComponent === 1 || a.isComponent === '1';
                        return a.AssignmentType !== 'Temporary' && !isComp;
                    }).length}</span>
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
        }

        // Ensure we show the first tab by default
        if (typeof switchProjectTab === 'function') {
            switchProjectTab('assets');
        }

        modal.style.display = 'flex'; // Keep it as flex for centering
    } catch (err) {
        console.error('Error loading project details:', err);
        clientInfo.innerHTML = `
            <div style="text-align:center; color: red; padding: 20px;">
                <p>❌ Error: ${err.message}</p>
                <button onclick="document.getElementById('projectDetailsModal').style.display='none'" class="btn-action">Close</button>
            </div>
        `;
        if (projectStats) projectStats.innerHTML = '';
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
                            <span style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;">
                                ${(a.Icon && (a.Icon.startsWith('/') || a.Icon.startsWith('http'))) 
                                    ? `<img src="${a.Icon}" style="width: 20px; height: 20px; object-fit: contain;">`
                                    : (a.Icon || (isTemp ? '🧩' : '📦'))}
                            </span>
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
    console.log(`[AssetDetails] Opening details for asset ID: "${assetId}"`);
    
    let asset = (window.allAssets || []).find(a => a.ID === assetId);
    if (asset) {
        console.log('[AssetDetails] Found asset in local cache');
    }
    
    const modal = document.getElementById('assetDetailsModal');
    const content = document.getElementById('assetDetailsContent');
    const title = document.getElementById('assetDetailsTitle');
    const btnEdit = document.getElementById('btnEditFromDetails');
    const btnDelete = document.getElementById('btnDeleteFromDetails');

    if (!modal) {
        console.error('[AssetDetails] Modal "assetDetailsModal" not found in DOM');
        return;
    }
    if (!content) {
        console.error('[AssetDetails] Container "assetDetailsContent" not found in DOM');
        return;
    }

    // Show loading state in modal
    console.log('[AssetDetails] Showing loading state and modal...');
    content.innerHTML = '<div style="text-align:center; padding: 20px;"><div class="spinner"></div><p>Loading asset details...</p></div>';
    modal.style.display = 'flex';

    if (!asset) {
        console.log(`[AssetDetails] Asset not found in local cache. Fetching from server: /api/asset-details/${assetId}...`);
        try {
            const response = await fetch(`/api/asset-details/${encodeURIComponent(assetId)}`);
            if (!response.ok) {
                console.error(`[AssetDetails] Server fetch failed with status: ${response.status}`);
                throw new Error(`Asset not found (${response.status})`);
            }
            const data = await response.json();
            console.log('[AssetDetails] Received asset data from server:', data);
            asset = data.asset;
        } catch (err) {
            console.error('[AssetDetails] Error fetching asset details:', err);
            content.innerHTML = `<div style="text-align:center; color: red; padding: 20px;">
                <p>❌ Error: ${err.message}</p>
                <button onclick="document.getElementById('assetDetailsModal').style.display='none'" class="btn-action">Close</button>
            </div>`;
            return;
        }
    }

    if (!asset) {
        console.error('[AssetDetails] Asset data is still null after attempt');
        content.innerHTML = `<div style="text-align:center; padding: 20px;">
            <p>❌ Asset not found.</p>
            <button onclick="document.getElementById('assetDetailsModal').style.display='none'" class="btn-action">Close</button>
        </div>`;
        return;
    }

    console.log('[AssetDetails] Rendering asset details...');
    title.textContent = `Asset Details: ${asset.ID}`;
    
    let html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
                <div style="font-size: 60px; margin-bottom: 10px; text-align: center; display: flex; align-items: center; justify-content: center; height: 80px;">
                    ${(asset.Icon && (asset.Icon.startsWith('/') || asset.Icon.startsWith('http'))) 
                        ? `<img src="${asset.Icon}" style="width: 60px; height: 60px; object-fit: contain;">`
                        : (asset.Icon || '📦')}
                </div>
                <p><strong>Item Name:</strong> ${asset.ItemName}</p>
                <p><strong>Status:</strong> <span class="status-pill status-${(asset.Status || 'In Store').toLowerCase().replace(/\s+/g, '-')}">${asset.Status || 'In Store'}</span></p>
                <p><strong>Category:</strong> ${asset.Type || '-'}</p>
                <p><strong>Make:</strong> ${asset.Make || '-'}</p>
                <p><strong>Model:</strong> ${asset.Model || '-'}</p>
                <p><strong>Serial No:</strong> ${asset.SrNo || '-'}</p>
            </div>
            <div>
                <p><strong>Location:</strong> ${asset.CurrentLocation || '-'}</p>
                <p><strong>Assigned To:</strong> ${asset.AssignedTo || '-'}</p>
                <p><strong>Value:</strong> ${asset.asset_value || 0} ${asset.Currency || 'INR'}</p>
                <p><strong>Purchase Date:</strong> ${asset.PurchaseDate || '-'}</p>
                <p><strong>Warranty:</strong> ${asset.warranty_months || 0} Months</p>
                <p><strong>Remarks:</strong> ${asset.Remarks || '-'}</p>
                <div style="margin-top: 15px; border: 1px solid #eee; padding: 10px; border-radius: 8px; text-align: center; background: white;">
                    <img src="/api/qr/dynamic/asset/${encodeURIComponent(asset.ID)}?t=${Date.now()}" style="width: 120px; height: 120px;" onerror="this.style.display='none'">
                    <div style="font-size: 10px; color: #999; margin-top: 5px;">QR Code (Dynamic)</div>
                </div>
            </div>
        </div>
        <div style="margin-top: 20px; text-align: right; border-top: 1px solid #eee; padding-top: 15px;">
             <button onclick="navigateToAssetPage('${asset.ID}')" class="btn-action" style="background: #36b37e; margin-right: 10px;">🌐 Full View Page</button>
        </div>
    `;

    content.innerHTML = html;
    
    if (btnEdit) {
        btnEdit.onclick = () => {
            modal.style.display = 'none';
            editAsset(asset);
        };
    }

    if (btnDelete) {
        btnDelete.onclick = () => {
            modal.style.display = 'none';
            window.deleteAsset(asset.ID);
        };
    }
};

window.showTempAssetDetails = async function(assetId) {
    console.log('showTempAssetDetails() for:', assetId);
    const asset = (window.currentTempAssets || []).find(a => a.ID === assetId);
    if (!asset) {
        showToast('Temporary asset details not available.', 'warning');
        return;
    }

    const modal = document.getElementById('tempAssetDetailsModal');
    const content = document.getElementById('tempAssetDetailsContent');
    const btnConvert = document.getElementById('btnConvertFromDetails');
    const btnDelete = document.getElementById('btnDeleteFromDetails');

    if (!modal || !content) return;

    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div>
                <p><strong>ID:</strong> <small style="font-family: monospace;">${asset.ID}</small></p>
                <p><strong>Item Name:</strong> ${asset.ItemName}</p>
                <p><strong>Project ID:</strong> ${asset.ProjectId}</p>
                <p><strong>Quantity:</strong> ${asset.Quantity}</p>
            </div>
            <div>
                <p><strong>Est. Price:</strong> ${asset.EstimatedPrice} ${asset.Currency}</p>
                <p><strong>Make:</strong> ${asset.Make || '-'}</p>
                <p><strong>Model:</strong> ${asset.Model || '-'}</p>
                <p><strong>Type:</strong> ${asset.Type || '-'}</p>
            </div>
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 4px; font-size: 12px; color: #856404;">
            ⚠️ This is a temporary asset. Convert it to a permanent asset to add it to the inventory and generate a QR code.
        </div>
    `;

    if (btnConvert) {
        btnConvert.onclick = () => {
            modal.style.display = 'none';
            window.makeAssetPermanent(asset.ID);
        };
    }

    if (btnDelete) {
        btnDelete.onclick = () => {
            modal.style.display = 'none';
            window.deleteTempAsset(asset.ID);
        };
    }

    modal.style.display = 'flex';
};

window.deleteAsset = async function(assetId) {
    if (!confirm(`Are you sure you want to delete asset ${assetId}? This action cannot be undone.`)) return;
    
    try {
        const username = localStorage.getItem('username') || 'web';
        const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
            method: 'DELETE',
            headers: { 'x-user': username }
        });
        
        if (response.ok) {
            showToast('Asset deleted successfully', 'success');
            if (window.loadAssets) await window.loadAssets();
            if (typeof renderDashboard === 'function') renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
            
            // If we are in sheet view, refresh it
            const sheetView = document.getElementById('sheetView');
            if (sheetView && sheetView.style.display !== 'none') {
                initSheetView();
            }
        } else {
            const err = await response.text();
            showToast('Error deleting asset: ' + err, 'error');
        }
    } catch (err) {
        console.error('Delete error:', err);
        showToast('Failed to delete asset', 'error');
    }
};

window.makeAssetPermanent = async function(id) {
    if (!confirm('Convert this temporary asset to a permanent asset in the inventory?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${id}/make-permanent`, {
            method: 'POST',
            headers: {
                'x-user': localStorage.getItem('username') || 'web'
            }
        });
        
        const result = await response.json();
        if (result.success) {
            showToast(`Asset converted successfully! New ID: ${result.permanentId || result.assetId}`, 'success');
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            if (window.loadAssets) await window.loadAssets();
            
            // Refresh Project view if active
            if (typeof currentProjectId !== 'undefined' && currentProjectId) {
                if (typeof loadProjectAssets === 'function') await loadProjectAssets(currentProjectId);
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            showToast('Error: ' + (result.error || 'Failed to convert'), 'error');
        }
    } catch (err) {
        console.error('Conversion error:', err);
        showToast('Failed to convert asset', 'error');
    }
};

window.deleteTempAsset = async function(id) {
    if (!confirm('Are you sure you want to delete this temporary asset?')) return;
    
    try {
        const response = await fetch(`/api/temporary-assets/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        if (result.success) {
            showToast('Temporary asset deleted.', 'success');
            
            // Refresh Dashboard if visible
            if (typeof renderDashboard === 'function') {
                renderDashboard(window.allAssets, () => []); 
            }
            if (window.loadAssets) await window.loadAssets();
            
            // Refresh Project view if active
            if (typeof currentProjectId !== 'undefined' && currentProjectId) {
                if (typeof loadProjectTempAssets === 'function') await loadProjectTempAssets(currentProjectId);
            }
        } else {
            showToast('Error: ' + (result.error || 'Failed to delete'), 'error');
        }
    } catch (err) {
        console.error('Delete error:', err);
        showToast('Failed to delete asset', 'error');
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
            showToast('Client user account created successfully!', 'success');
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('Error creating client user:', err);
        showToast('Error creating client user', 'error');
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

        let html = `
            <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 20px; border-left: 4px solid #0078d4;">
                <h3 style="margin-top: 0; color: #2c3e50; font-size: 16px;">Project Bill of Materials</h3>
                <p style="margin-bottom: 0; color: #666; font-size: 13px;">For now, BOM lists all assets assigned to this project.</p>
            </div>
            <div class="table-container">
                <table class="project-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Item Name</th>
                            <th>Make</th>
                            <th>Model</th>
                            <th>Status</th>
                            <th>Category</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        allItems.forEach(item => {
            const id = item.ID || '';
            const name = item.ItemName || item.Name || 'Unnamed Asset';
            const make = item.Make || '';
            const model = item.Model || '';
            const status = item.Status || '';
            const category = item.Category || '';
            
            const idStr = id.toString();
            const isTempId = idStr.startsWith('TEMP') || idStr.startsWith('MUMT-');
            const type = item.AssignmentType || (id && isTempId ? 'Temporary' : 'Permanent');

            html += `
                <tr>
                    <td><small style="font-family: monospace;">${id}</small></td>
                    <td>${name}</td>
                    <td>${make}</td>
                    <td>${model}</td>
                    <td>${status}</td>
                    <td>${category}</td>
                    <td>${type}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
            <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn-action" style="background: #6c757d; color: white;" onclick="window.printBOM()">🖨️ Print BOM</button>
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

    const getActiveDashboardSubView = () => {
        const container = document.getElementById('dashboard-container');
        if (!container) return null;
        const active = container.querySelector('.view.active');
        return active ? active.id : null;
    };

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
                <div class="menu-item-wrapper active" style="padding: 10px 20px;">
                    <span class="tree-toggle-main">▼</span>
                    <a href="#" class="menu-item toggle-submenu active" id="allAssetsLink">All Assets</a>
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
                
                // Determine which view to refresh
                const activeSubViewId = getActiveDashboardSubView();
                if (activeSubViewId === 'sheet-view') {
                    if (window.initSheetView) window.initSheetView();
                } else if (!activeSubViewId || activeSubViewId === 'home-view') {
                    const homeView = document.getElementById('home-view');
                    if (homeView) {
                        homeView.style.display = 'flex';
                        homeView.classList.remove('hidden');
                        document.querySelectorAll('.view').forEach(v => {
                            if (v.id !== 'home-view' && v.id !== 'dashboardView' && v.parentElement?.id === 'dashboard-container') {
                                v.style.display = 'none';
                                v.classList.add('hidden');
                            }
                        });
                    }
                    const filteredAssets = window.getFilteredAssets ? window.getFilteredAssets : () => [];
                    renderDashboard(window.allAssets, filteredAssets);
                }
                
                // Reset sidebar active states
                sidebarMenu.querySelectorAll('.tree-item-wrapper, .menu-item-wrapper').forEach(el => el.classList.remove('active'));
                sidebarMenu.querySelectorAll('.tree-link, .menu-item').forEach(l => {
                    l.classList.remove('active');
                    l.style.color = '';
                    l.style.fontWeight = '';
                });
                
                const wrapper = allAssetsLink.closest('.menu-item-wrapper');
                if (wrapper) wrapper.classList.add('active');
                allAssetsLink.classList.add('active');
            };
        }

        const tempAssetsLink = document.getElementById('tempAssetsLink');
        if (tempAssetsLink) {
            tempAssetsLink.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.currentDashboardParent = { ID: 'TEMP_VIEW', Name: 'Temporary Assets', type: 'virtual' };
                
                // Set active state
                sidebarMenu.querySelectorAll('.tree-item-wrapper, .menu-item-wrapper').forEach(el => el.classList.remove('active'));
                sidebarMenu.querySelectorAll('.tree-link, .menu-item').forEach(l => {
                    l.classList.remove('active');
                    l.style.color = '';
                    l.style.fontWeight = '';
                });

                const wrapper = tempAssetsLink.closest('.tree-item-wrapper');
                if (wrapper) wrapper.classList.add('active');
                tempAssetsLink.classList.add('active');

                // Determine which view to refresh
                const activeSubViewId = getActiveDashboardSubView();
                if (activeSubViewId === 'sheet-view') {
                    if (window.initSheetView) window.initSheetView();
                } else if (!activeSubViewId || activeSubViewId === 'home-view') {
                    const homeView = document.getElementById('home-view');
                    if (homeView) {
                        homeView.style.display = 'flex';
                        homeView.classList.remove('hidden');
                        document.querySelectorAll('.view').forEach(v => {
                            if (v.id !== 'home-view' && v.id !== 'dashboardView' && v.parentElement?.id === 'dashboard-container') {
                                v.style.display = 'none';
                                v.classList.add('hidden');
                            }
                        });
                    }
                    renderDashboard(window.allAssets, () => []); 
                }
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
                // Skip virtual links handled separately
                if (link.id === 'tempAssetsLink' || link.id === 'allAssetsLink') return;
                
                link.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = link.getAttribute('data-id');
                    const node = manager.findNode(id);
                    
                    if (node) {
                        console.log('[Sidebar] Node selected:', node.Name);
                        
                        // Set active state
                        sidebarMenu.querySelectorAll('.tree-item-wrapper, .menu-item-wrapper').forEach(el => el.classList.remove('active'));
                        sidebarMenu.querySelectorAll('.tree-link, .menu-item').forEach(l => {
                            l.classList.remove('active');
                            l.style.color = '';
                            l.style.fontWeight = '';
                        });
                        
                        const wrapper = link.closest('.tree-item-wrapper');
                        if (wrapper) wrapper.classList.add('active');
                        link.classList.add('active');

                        // Navigate dashboard to this parent
                        window.currentDashboardParent = node;
                        
                        // Determine which view to refresh
                        const activeSubViewId = getActiveDashboardSubView();
                        if (activeSubViewId === 'sheet-view') {
                            if (window.initSheetView) window.initSheetView();
                        } else if (!activeSubViewId || activeSubViewId === 'home-view') {
                            const homeView = document.getElementById('home-view');
                            if (homeView && homeView.style.display === 'none') {
                                homeView.style.display = 'flex';
                                homeView.classList.remove('hidden');
                                document.querySelectorAll('.view').forEach(v => {
                                    if (v.id !== 'home-view' && v.id !== 'dashboardView' && v.parentElement?.id === 'dashboard-container') {
                                        v.style.display = 'none';
                                        v.classList.add('hidden');
                                    }
                                });
                            }
                            renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
                        }
                        
                        // If it's a leaf kind, also open the list modal immediately
                        if (node.type === 'kind' && (!node.children || node.children.length === 0)) {
                            showAssetList(node);
                        }
                    }
                };
            });

            // Handle Edit Kind buttons
            container.querySelectorAll('.edit-kind-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = btn.getAttribute('data-id');
                    const node = manager.findNode(id);
                    if (node && node.type === 'kind') {
                        openEditKindModal(node);
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

function renderAssetHealthWidget(assets, title) {
    let healthWidget = document.getElementById('assetHealthWidget');
    const homeView = document.getElementById('home-view');

    if (!healthWidget) {
        healthWidget = document.createElement('div');
        healthWidget.id = 'assetHealthWidget';
        healthWidget.style.display = 'none'; // Default hidden
        
        if (homeView && homeView.firstChild) {
            homeView.insertBefore(healthWidget, homeView.firstChild);
        } else if (homeView) {
            homeView.appendChild(healthWidget);
        }
    }

    // Create Toggle Button if not exists
    let toggleBtn = document.getElementById('btnToggleHealth');
    const dashboardTitleContainer = document.querySelector('#dashboard-title > div');

    const insertToggleBtn = (container, btn) => {
        const firstSpan = container.querySelector('span');
        if (firstSpan) {
            if (firstSpan.nextSibling) {
                container.insertBefore(btn, firstSpan.nextSibling);
            } else {
                container.appendChild(btn);
            }
        } else {
            container.appendChild(btn);
        }
    };

    if (!toggleBtn && dashboardTitleContainer) {
        toggleBtn = document.createElement('div');
        toggleBtn.id = 'btnToggleHealth';
        
        // Check current state
        const isVisible = healthWidget.style.display !== 'none';
        const arrow = isVisible ? '▲' : '▼';
        const bg = isVisible ? '#f0f7ff' : 'white';
        const color = isVisible ? '#007bff' : '#555';
        const border = isVisible ? '#b3d7ff' : '#e0e0e0';

        toggleBtn.innerHTML = `
            <span style="font-weight: 600; font-size: 11px;">Asset Overview</span>
            <span id="toggleHealthArrow" style="font-size: 9px; color: #777;">${arrow}</span>
        `;
        
        // Styling to fit in the title bar
        toggleBtn.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: ${bg};
            padding: 4px 10px;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid ${border};
            color: ${color};
            user-select: none;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            margin-left: 5px;
        `;
        
        insertToggleBtn(dashboardTitleContainer, toggleBtn);

        toggleBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent title bar clicks if any
            const isHidden = healthWidget.style.display === 'none';
            healthWidget.style.display = isHidden ? 'grid' : 'none';
            document.getElementById('toggleHealthArrow').textContent = isHidden ? '▲' : '▼';
            toggleBtn.style.background = isHidden ? '#f0f7ff' : 'white';
            toggleBtn.style.color = isHidden ? '#007bff' : '#555';
            toggleBtn.style.borderColor = isHidden ? '#b3d7ff' : '#e0e0e0';
        };
    } else if (toggleBtn && dashboardTitleContainer && !dashboardTitleContainer.contains(toggleBtn)) {
        // If button exists but lost parent (e.g. title re-render), re-append it
        insertToggleBtn(dashboardTitleContainer, toggleBtn);
    }
    
    // Apply styles to widget
    // We maintain the current display state (unless it's the first render where we set it to none above)
    const currentDisplay = healthWidget.style.display;
    
    healthWidget.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
    healthWidget.style.gap = '15px';
    healthWidget.style.marginBottom = '20px';
    healthWidget.style.padding = '15px';
    healthWidget.style.background = '#f8f9fa';
    healthWidget.style.borderRadius = '8px';
    healthWidget.style.border = '1px solid #e0e0e0';
    // Ensure we don't accidentally override the hidden state if it was hidden
    healthWidget.style.display = currentDisplay === 'none' ? 'none' : 'grid';

    const validAssets = assets.filter(a => !a.isPlaceholder && !a.isComponent);
    const total = validAssets.length;
    
    const stats = {
        'Owned': { count: validAssets.filter(a => a.Status === 'Owned').length, color: '#36b37e' },
        'In-Use': { count: validAssets.filter(a => a.Status === 'In-Use').length, color: '#0052cc' },
        'Stand By': { count: validAssets.filter(a => a.Status === 'Stand By').length, color: '#42526e' },
        'In-Repair': { count: validAssets.filter(a => a.Status === 'In-Repair').length, color: '#ff8b00' },
        'Demo': { count: validAssets.filter(a => a.Status === 'Demo').length, color: '#ffab00' },
        'Rental': { count: validAssets.filter(a => a.Status === 'Rental').length, color: '#6554c0' },
        'Sold': { count: validAssets.filter(a => a.Status === 'Sold').length, color: '#ff5630' },
        'Scraped': { count: validAssets.filter(a => a.Status === 'Scraped').length, color: '#bf2600' }
    };

    let html = `
        <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #007bff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold;">Total ${title}</div>
            <div style="font-size: 24px; font-weight: bold; color: #333;">${total}</div>
        </div>
    `;

    Object.entries(stats).forEach(([status, data]) => {
        if (data.count > 0 || ['Owned', 'In-Use', 'Stand By'].includes(status)) {
            const percentage = total > 0 ? Math.round((data.count / total) * 100) : 0;
            html += `
                <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid ${data.color}; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: bold;">${status}</div>
                    <div style="font-size: 24px; font-weight: bold; color: ${data.color};">${data.count} <span style="font-size: 12px; color: #999; font-weight: normal;">(${percentage}%)</span></div>
                </div>
            `;
        }
    });

    healthWidget.innerHTML = html;
}

export function renderSkeletons() {
    const assetGrid = document.getElementById('assetGrid');
    if (!assetGrid) return;

    assetGrid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        skeleton.innerHTML = `
            <div class="skeleton skeleton-icon"></div>
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton-stats">
                <div class="skeleton skeleton-stat"></div>
                <div class="skeleton skeleton-stat"></div>
                <div class="skeleton skeleton-stat"></div>
                <div class="skeleton skeleton-stat"></div>
            </div>
        `;
        assetGrid.appendChild(skeleton);
    }
}
window.renderSkeletons = renderSkeletons;

let isAssetKanbanActive = false;

document.addEventListener('DOMContentLoaded', () => {
    const btnToggleKanban = document.getElementById('btnToggleKanban');
    if (btnToggleKanban) {
        btnToggleKanban.onclick = () => {
            isAssetKanbanActive = !isAssetKanbanActive;
            const assetGrid = document.getElementById('assetGrid');
            const assetGridWrapper = document.getElementById('assetGridWrapper');
            const assetKanban = document.getElementById('assetKanban');
            const projectsGrid = document.getElementById('projectsGrid');
            const btnSpan = btnToggleKanban.querySelector('span');
            
            if (isAssetKanbanActive) {
                if (assetGrid) assetGrid.style.display = 'none';
                if (assetGridWrapper) assetGridWrapper.style.display = 'none';
                if (projectsGrid) projectsGrid.style.display = 'none';
                if (assetKanban) {
                    assetKanban.classList.remove('hidden');
                    assetKanban.style.display = 'flex';
                }
                if (btnSpan) btnSpan.textContent = '📦 Grid View';
                renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
            } else {
                if (assetGrid) assetGrid.style.display = 'grid';
                if (assetGridWrapper) assetGridWrapper.style.display = 'block';
                if (projectsGrid) projectsGrid.style.display = 'none';
                if (assetKanban) {
                    assetKanban.classList.add('hidden');
                    assetKanban.style.display = 'none';
                }
                if (btnSpan) btnSpan.textContent = '📋 Kanban';
                renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
            }
        };
    }
});

export function renderDashboard(assets, filteredAssets) {
    window.allAssets = assets;
    console.log('[Dashboard] renderDashboard() called');
    console.log('[Dashboard] Assets count:', (assets || []).length);
    console.log('[Dashboard] Category:', localStorage.getItem('selectedAssetCategory'));
    
    const assetGrid = document.getElementById('assetGrid');
    if (!assetGrid) return;
    assetGrid.innerHTML = '';
    
    if (typeof filteredAssets !== 'function') {
        console.error('[Dashboard] filteredAssets is not a function:', filteredAssets);
        assetGrid.innerHTML = '<div style="padding: 20px; color: red;">Error: Invalid filter function</div>';
        return;
    }
    
    const assetsToRender = filteredAssets() || [];
    const kinds = window.allAssetKinds || [];
    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
    const manager = window.hierarchyManager;

    const assetKanban = document.getElementById('assetKanban');
    const projectsGrid = document.getElementById('projectsGrid');
    const isHomeViewActive = document.getElementById('home-view') && !document.getElementById('home-view').classList.contains('hidden');
    const isProjectViewActive = document.getElementById('projects-view') && !document.getElementById('projects-view').classList.contains('hidden');
    
    // If we are in project view, don't let renderDashboard hide the projectsGrid
    // and don't let it show asset containers.
    if (isProjectViewActive && !isAssetKanbanActive) {
        console.log('[Dashboard] Project view is active, skipping asset dashboard render');
        if (assetGrid) assetGrid.style.display = 'none';
        if (assetKanban) {
            assetKanban.classList.add('hidden');
            assetKanban.style.display = 'none';
        }
        return;
    }

    const assetGridWrapper = document.getElementById('assetGridWrapper');



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
                    renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
                };
            }
        }

        assetGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; text-align: center;">Loading temporary assets...</div>';
        
        fetch('/api/temporary-assets')
            .then(r => r.json())
            .then(tempAssets => {
                window.currentTempAssets = tempAssets;
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
                    card.onclick = () => showTempAssetDetails(asset.ID); 
                    card.style.cursor = 'pointer'; 
                    card.style.paddingBottom = '35px'; // Space for buttons
                    card.innerHTML = `
                        <div class="asset-card-icon" style="margin-bottom: 2px;">⏳</div>
                        <div class="asset-card-header" style="margin-bottom: 2px;">
                            <span class="asset-card-title">${asset.ItemName}</span>
                        </div>
                        <div class="asset-card-status" style="grid-template-columns: 1fr; border-top: 1px solid #f0f0f0; margin-top: 2px; padding-top: 4px;">
                            <div class="asset-card-status-item">
                                <span class="asset-card-status-label" style="font-size: 8px;">Project ID</span>
                                <span class="asset-card-status-value" style="font-size: 9px; color: #007bff; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;">${asset.ProjectId}</span>
                            </div>
                        </div>
                        <div style="font-size: 9px; margin-top: 5px; text-align: center;">
                            <a href="/api/quantity/events/${encodeURIComponent(asset.ID)}" target="_blank" onclick="event.stopPropagation()" style="color: #0056b3; font-weight: 700; text-decoration: none; background: #e7f3ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #b3d7ff; display: inline-flex; align-items: center; gap: 3px;">🔗 Qty API</a>
                        </div>
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; display: flex; height: 28px; border-top: 1px solid #eee; background: #fff; border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; overflow: hidden;">
                            <button onclick="event.stopPropagation(); makeAssetPermanent('${asset.ID}')" style="flex: 1; border: none; background: #f0f7ff; color: #007bff; font-size: 10px; font-weight: 600; cursor: pointer; border-right: 1px solid #eee; transition: all 0.2s;" onmouseover="this.style.background='#e6f0ff'" onmouseout="this.style.background='#f0f7ff'">Convert</button>
                            <button onclick="event.stopPropagation(); deleteTempAsset('${asset.ID}')" style="flex: 1; border: none; background: #fff1f0; color: #f5222d; font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#ffe8e6'" onmouseout="this.style.background='#fff1f0'">Delete</button>
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
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                ${window.currentDashboardParent ? '<button id="btnDashboardBack" class="icon-button" style="background: #eee; border-radius: 50%; width: 24px; height: 24px; font-size: 14px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; cursor: pointer;">←</button>' : ''}
                <span>${parentNode ? parentNode.Name : `${category} Assets`}</span>
                ${window.currentSearchQuery ? `<span style="background: #e7f3ff; color: #0078d4; padding: 2px 8px; border-radius: 12px; font-size: 11px; display: flex; align-items: center; gap: 5px; border: 1px solid #0078d4;">🔍 "${window.currentSearchQuery}" <span id="btnClearSearch" style="cursor: pointer; font-weight: bold;">&times;</span></span>` : ''}
                <button id="btnHierarchyDebug" style="background: #6c757d; color: white; border: none; border-radius: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer; margin-left: auto; opacity: 0.6;">Debug</button>
            </div>
        `;
        
        // Add Clear Search Handler
        const btnClearSearch = document.getElementById('btnClearSearch');
        if (btnClearSearch) {
            btnClearSearch.onclick = (e) => {
                e.stopPropagation();
                window.currentSearchQuery = '';
                const searchInput = document.getElementById('dashboardSearch');
                if (searchInput) searchInput.value = '';
                renderDashboard(window.allAssets, filteredAssets);
            };
        }
        
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
    let overviewTitle = '';

    if (!parentNode) {
        // "All Assets" view: Show Tier 1 categories as cards
        displayNodes = manager.getModuleTree(category);
        console.log(`[Dashboard] Root nodes for ${category}:`, displayNodes.length);
        
        // In "All Assets" view, we want to show the overview for the entire category
        // We filter manually to ensure we get the full breakdown, ignoring any grid-specific status filters
        recursiveAssets = assets.filter(a => a.Category === category);
        console.log(`[Dashboard] All Assets view - recursiveAssets count: ${recursiveAssets.length}`);
        overviewTitle = `${category} Assets`;
        
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
        // Include both kinds and folders in the match list
        // This ensures that if an asset has a Type matching a Folder name (e.g. 'Hardware'), it still shows up
        const descendantKindNames = descendants.map(d => d.Name);
            
        console.log(`[Dashboard] Selected Node: ${parentNode.Name} (${parentNode.type})`);
        console.log(`[Dashboard] Descendant Kinds:`, descendantKindNames);
        
        recursiveAssets = assets.filter(a => {
            if (a.Category !== category) return false;
            
            const assetType = (a.Type || '').toLowerCase().trim();
            const assetName = (a.Name || '').toLowerCase().trim();
            
            return descendantKindNames.some(kindName => {
                const k = kindName.toLowerCase().trim();
                const t = assetType;
                
                // 1. Exact match
                if (t === k) return true;
                
                // 2. Standard plural 's' (Laptop <-> Laptops)
                if (t === k + 's' || t + 's' === k) return true;
                
                // 3. Plural 'es' (Box <-> Boxes)
                if (t === k + 'es' || t + 'es' === k) return true;
                
                // 4. Plural 'ies' <-> 'y' (Battery <-> Batteries)
                if (k.endsWith('y') && t === k.slice(0, -1) + 'ies') return true;
                if (t.endsWith('y') && k === t.slice(0, -1) + 'ies') return true;

                // 5. Name fallback
                if (assetName === k) return true;
                
                return false;
            });
        });
        console.log(`[Dashboard] Filtered recursiveAssets: ${recursiveAssets.length}`);
        
        overviewTitle = `${parentNode.Name} Assets`;
    }

    // --- KANBAN VIEW LOGIC (Moved after hierarchy filtering) ---
    if (isAssetKanbanActive) {
        if (assetGrid) assetGrid.style.display = 'none';
        if (assetGridWrapper) assetGridWrapper.style.display = 'none';
        if (projectsGrid) projectsGrid.style.display = 'none'; 
        if (assetKanban) {
            assetKanban.classList.remove('hidden');
            assetKanban.style.display = 'flex'; 
        }

        // Apply search filter to the HIERARCHY-FILTERED assets
        // We use 'recursiveAssets' which is already filtered by current hierarchy node
        let kanbanAssets = recursiveAssets; 
        if (window.currentSearchQuery) {
            kanbanAssets = recursiveAssets.filter(a => matchesQuery(a, window.currentSearchQuery));
        }
        
        renderAssetKanban(kanbanAssets);
        return;
    } else {
        // Ensure standard view elements are visible if we are not in Kanban mode
        if (assetGrid) assetGrid.style.display = 'grid';
        if (assetGridWrapper) assetGridWrapper.style.display = 'block';
        if (assetKanban) {
            assetKanban.classList.add('hidden');
            assetKanban.style.display = 'none';
        }
        
        if (projectsGrid) {
             projectsGrid.style.display = 'none';
        }
    }

    // Render Asset Health Widget (Filtered by Hierarchy)
    // Always show it unless explicitly hidden by search query
    const toggleBtn = document.getElementById('btnToggleHealth');
    if (!window.currentSearchQuery) {
        renderAssetHealthWidget(recursiveAssets, overviewTitle);
        if (toggleBtn) toggleBtn.style.display = 'inline-flex';
    } else {
        const healthWidget = document.getElementById('assetHealthWidget');
        if (healthWidget) healthWidget.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
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

        // If we have a search query, show individual matching assets that don't fit into categories
    const query = window.currentSearchQuery;
    if (query && assetsToRender.length > 0) {
        const searchResultsHeader = document.createElement('div');
        searchResultsHeader.style = 'grid-column: 1 / -1; margin: 20px 0 10px 0; padding: 10px; background: #e9f5ff; border-radius: 4px; font-weight: bold; color: #007bff; display: flex; align-items: center; gap: 10px;';
        searchResultsHeader.innerHTML = `<span>🔍 Search Results for "${query}"</span> <span style="font-weight: normal; font-size: 12px; color: #666;">(${assetsToRender.length} matches)</span>`;
        assetGrid.appendChild(searchResultsHeader);

        // Show top 20 matches as individual items if they are not many, or just show them
        const topMatches = assetsToRender.slice(0, 50);
        topMatches.forEach(asset => {
            const item = document.createElement('div');
            item.className = 'asset-card search-result-card';
            // Use minimal inline styles, rely on .search-result-card CSS
            item.style = 'grid-column: 1 / -1; cursor: pointer; gap: 15px; position: relative;';
            item.onclick = (e) => {
                e.stopPropagation();
                if (typeof editAsset === 'function') {
                    editAsset(asset);
                } else {
                    console.error('editAsset function not found');
                }
            };

            const isNoQr = asset.NoQR === 1 || asset.NoQR === true;
            const statusColor = getStatusColor(asset.Status);
            
            item.innerHTML = `
                <div style="position: absolute; top: 0; left: 0; bottom: 0; width: 4px; background: ${statusColor}; border-top-left-radius: 4px; border-bottom-left-radius: 4px;"></div>
                <div style="font-size: 24px; width: 40px; text-align: center; margin-left: 5px; flex-shrink: 0;">
                    ${(asset.Icon && (asset.Icon.startsWith('/') || asset.Icon.startsWith('http'))) 
                        ? `<img src="${asset.Icon}" style="width: 32px; height: 32px; object-fit: contain;">`
                        : (asset.Icon || '📦')}
                </div>
                <div class="search-result-info">
                    <div class="search-result-title">${asset.ItemName}</div>
                    <div class="search-result-subtitle">
                        ID: ${asset.ID} • ${asset.Type} • ${asset.CurrentLocation || 'No Location'} ${isNoQr ? '<span style="color: #f5222d; font-weight: bold;">(No QR)</span>' : ''}
                        ${(asset.is_quantity_tracked === 1 || asset.quantity_unit || asset.quantity_total) ? ` • <span style="color: #0078d4; font-weight: 600;">⚖️ ${asset.quantity_total ?? 0} ${asset.quantity_unit || ''}</span>` : ''}
                        • <a href="/api/quantity/events/${encodeURIComponent(asset.ID)}" target="_blank" onclick="event.stopPropagation()" style="margin-left: 5px; color: #0056b3; font-weight: 700; text-decoration: none; background: #e7f3ff; padding: 1px 5px; border-radius: 3px; border: 1px solid #b3d7ff; font-size: 9px; display: inline-flex; align-items: center; gap: 2px;">🔗 Qty API</a>
                    </div>
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                    <span class="status-badge" style="font-size: 10px; padding: 2px 6px; background: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}40; border-radius: 4px;">${asset.Status || 'Owned'}</span>
                </div>
            `;
            // item.style.position = 'relative'; // Already set above
            assetGrid.appendChild(item);
        });

        if (assetsToRender.length > 50) {
            const more = document.createElement('div');
            more.style = 'grid-column: 1 / -1; text-align: center; padding: 10px; color: #999; font-size: 12px;';
            more.textContent = `... and ${assetsToRender.length - 50} more results. Use the Sheet View for a full list.`;
            assetGrid.appendChild(more);
        }

        const separator = document.createElement('hr');
        separator.style = 'grid-column: 1 / -1; border: none; border-top: 1px solid #eee; margin: 20px 0;';
        assetGrid.appendChild(separator);

        const categoryHeader = document.createElement('div');
        categoryHeader.style = 'grid-column: 1 / -1; margin-bottom: 10px; font-weight: bold; color: #666;';
        categoryHeader.textContent = 'Browse by Category';
        assetGrid.appendChild(categoryHeader);
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
            const isComp = a.isComponent === true || a.isComponent === 'true' || a.isComponent === 1 || a.isComponent === '1';
            const isPlaceholder = p === true || p === 'true' || p === 1 || p === '1';
            return !isPlaceholder && !isComp;
        });
        
        const total = realAssets.length;
        
        // Calculate aggregate quantity for root assets in this kind/category
        let aggregateQty = 0;
        let qtyUnit = '';
        let hasQuantityTracking = false;
        
        realAssets.forEach(a => {
            if (a.quantity_unit) {
                hasQuantityTracking = true;
                if (!qtyUnit) qtyUnit = a.quantity_unit;
                
                // Only aggregate if units match to avoid confusing mixed units
                if (a.quantity_unit.toLowerCase() === qtyUnit.toLowerCase()) {
                    aggregateQty += Number(a.quantity_total || 0);
                }
            }
        });



        const assetCard = document.createElement('div');
        assetCard.classList.add('asset-card');
        assetCard.style.position = 'relative'; // Ensure absolute children (like add button) stay within card
        assetCard.setAttribute('data-kind', nodeName); // For global listener fallback
        if (isSelectionMode) assetCard.classList.add('selection-mode');
        
        assetCard.style.cursor = 'pointer';
        // Add color ribbon for categories based on dominant status if needed, or just generic brand color
        // For categories, we'll use a subtle top border instead of a side ribbon
        assetCard.style.borderTop = `3px solid ${total > 0 ? '#007bff' : '#ddd'}`;
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

        const displayImg = node.DisplayImage || node.Icon;
        const isUrl = displayImg && (displayImg.startsWith('/') || displayImg.startsWith('http'));

        assetCard.innerHTML = `
            ${isKind ? `<button class="asset-card-add-button" data-kind="${nodeName}" title="Add ${nodeName}">+</button>` : ''}
            <div class="asset-card-icon">
                ${isUrl 
                    ? `<img src="${displayImg}" style="width: 48px; height: 48px; object-fit: contain;">`
                    : (displayImg || (isKind ? '📦' : '📂'))}
            </div>
            <div class="asset-card-header">
                <span class="asset-card-title">${nodeName} (${total})</span>
                ${hasQuantityTracking ? `
                    <div style="font-size: 11px; color: #0078d4; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 12px;">⚖️</span> 
                        <span>${aggregateQty.toLocaleString()} ${qtyUnit}</span>
                    </div>
                ` : ''}
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

    // Ensure Kanban is handled separately and correctly
    if (isAssetKanbanActive) {
        // Clear grid and show kanban
        assetGrid.innerHTML = '';
        renderAssetKanban(assetsToRender);
    }
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
        
        // Reset modal title
        const modalTitle = modal.querySelector('h2');
        if (modalTitle) modalTitle.textContent = 'Add New Asset Category';

        // Reset the form
        const form = document.getElementById('addAssetKindForm');
        if (form) form.reset();
        
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
                    const icon = (f.Icon && (f.Icon.startsWith('/') || f.Icon.startsWith('http'))) ? '📁' : (f.Icon || '📁');
                    opt.textContent = `${icon} ${f.Name}`;
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
                    const icon = (k.Icon && (k.Icon.startsWith('/') || k.Icon.startsWith('http'))) ? '📦' : (k.Icon || '📦');
                    opt.textContent = `${icon} ${k.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }
        }
    } else {
        console.error('CRITICAL: addAssetKindModal NOT found in DOM');
    }
}

export function openEditKindModal(node) {
    console.log('openEditKindModal() called for:', node);
    const modal = document.getElementById('addAssetKindModal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Change modal title
        const modalTitle = modal.querySelector('h2');
        if (modalTitle) modalTitle.textContent = 'Edit Asset Category';

        // Pre-populate fields
        const nameInput = document.getElementById('newKindName');
        const iconInput = document.getElementById('newKindIcon');
        const parentSelect = document.getElementById('newKindParent');
        const imageInput = document.getElementById('newKindImage');
        const identifierInput = document.getElementById('newKindIdentifier');
        
        if (nameInput) nameInput.value = node.Name || '';
        if (iconInput) iconInput.value = node.Icon || '';
        if (imageInput) imageInput.value = node.DisplayImage || '';
        if (identifierInput) identifierInput.value = node.Identifier || '';
        
        // Populate the Parent Kind dropdown
        if (parentSelect) {
            const currentCategory = localStorage.getItem('selectedAssetCategory') || 'IT';
            const allKinds = window.allAssetKinds || [];
            const allFolders = window.allFolders || [];
            
            const filteredKinds = allKinds.filter(k => k.Module === currentCategory && k.Name !== node.Name);
            const filteredFolders = allFolders.filter(f => f.Module === currentCategory);
            
            parentSelect.innerHTML = '<option value="">None (Top Level)</option>';
            
            if (filteredFolders.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Folders';
                filteredFolders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.Name;
                    opt.textContent = `${(f.Icon && f.Icon.startsWith('/') ? '📁' : (f.Icon || '📁'))} ${f.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }

            if (filteredKinds.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Existing Categories';
                filteredKinds.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k.Name;
                    opt.textContent = `${(k.Icon && k.Icon.startsWith('/') ? '📦' : (k.Icon || '📦'))} ${k.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }
            
            parentSelect.value = node.ParentID || node.ParentName || '';
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
            if (form) {
                form.reset();
                if (window.updateIconPreview) window.updateIconPreview('📦');
            }
        const assetDbId = document.getElementById('assetDbId');
        if (assetDbId) assetDbId.value = '';

        const qtyUnit = document.getElementById('itemQtyUnit');
        const qtyTotal = document.getElementById('itemQtyTotal');
        const qtyPrecision = document.getElementById('itemQtyPrecision');
        const qtyNote = document.getElementById('itemQtyNote');
        if (qtyUnit) qtyUnit.disabled = false;
        if (qtyTotal) qtyTotal.disabled = false;
        if (qtyPrecision) qtyPrecision.disabled = false;
        if (qtyNote) qtyNote.disabled = false;

        const convUnit = document.getElementById('itemConvUnit');
        const convFactor = document.getElementById('itemConvFactor');
        const btnApplyConv = document.getElementById('btnApplyConversion');
        if (convUnit) {
            convUnit.value = '';
            convUnit.disabled = false;
        }
        if (convFactor) {
            convFactor.value = '';
            convFactor.disabled = false;
        }
        if (btnApplyConv) {
            btnApplyConv.disabled = false;
        }

        // Ensure conversion UI is set up
        setupConversionUI();

        const qtyHint = document.getElementById('qtyEditHint');
        if (qtyHint) {
            qtyHint.style.display = 'none';
            qtyHint.textContent = '';
        }

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
                
                // Update identifier display
                const selectedKind = allKinds.find(k => k.Name === kindSelect.value);
                const idDisplay = document.getElementById('kindIdentifierDisplay');
                const idValue = document.getElementById('kindIdentifierValue');
                if (idDisplay && idValue) {
                    if (selectedKind && selectedKind.Identifier) {
                        idValue.textContent = selectedKind.Identifier;
                        idDisplay.style.display = 'block';
                    } else {
                        idDisplay.style.display = 'none';
                    }
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
                
                // Update identifier display for initial kind
                const selectedKind = allKinds.find(k => k.Name === kind);
                const idDisplay = document.getElementById('kindIdentifierDisplay');
                const idValue = document.getElementById('kindIdentifierValue');
                if (idDisplay && idValue) {
                    if (selectedKind && selectedKind.Identifier) {
                        idValue.textContent = selectedKind.Identifier;
                        idDisplay.style.display = 'block';
                    } else {
                        idDisplay.style.display = 'none';
                    }
                }
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
    const submitBtn = document.querySelector('#addAssetItemForm button[type="submit"]');
    if (title) title.textContent = `Edit Asset: ${asset.ID}`;
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    
    // Fill the hidden ID
    const assetDbId = document.getElementById('assetDbId');
    if (assetDbId) assetDbId.value = asset.ID;

    // Fill basic fields
    document.getElementById('itemKind').value = asset.Type || '';
    document.getElementById('itemName').value = asset.ItemName || '';
    const iconVal = asset.Icon || '';
    document.getElementById('itemIcon').value = iconVal;
    if (window.updateIconPreview) window.updateIconPreview(iconVal);
    
    document.getElementById('itemStatus').value = asset.Status || 'Owned';
    document.getElementById('itemMake').value = asset.Make || '';
    document.getElementById('itemModel').value = asset.Model || '';
    document.getElementById('itemSrNo').value = asset.SrNo || '';
    document.getElementById('itemLocation').value = asset.CurrentLocation || '';
    
    if (asset.DispatchReceiveDt) {
        // Handle date format if needed
        document.getElementById('itemDate').value = asset.DispatchReceiveDt;
    }
    
    document.getElementById('itemPurchase').value = asset.PurchaseDetails || '';
    document.getElementById('itemRemarks').value = asset.Remarks || '';
    document.getElementById('itemAssignedTo').value = asset.AssignedTo || '';
    document.getElementById('itemParentId').value = asset.ParentId || '';

    const qtyUnit = document.getElementById('itemQtyUnit');
    const qtyTotal = document.getElementById('itemQtyTotal');
    const qtyPrecision = document.getElementById('itemQtyPrecision');
    const qtyNote = document.getElementById('itemQtyNote');
    if (qtyUnit) qtyUnit.value = asset.quantity_unit || '';
    if (qtyTotal) qtyTotal.value = (asset.quantity_total ?? '') === null ? '' : (asset.quantity_total ?? '');
    if (qtyPrecision) qtyPrecision.value = (asset.quantity_precision ?? 0);
    if (qtyNote) qtyNote.value = asset.quantity_note || '';
    if (qtyUnit) qtyUnit.disabled = !!(asset.quantity_root_id && String(asset.quantity_root_id) !== String(asset.ID));
    if (qtyTotal) qtyTotal.disabled = !!(asset.quantity_root_id && String(asset.quantity_root_id) !== String(asset.ID));
    if (qtyPrecision) qtyPrecision.disabled = !!(asset.quantity_root_id && String(asset.quantity_root_id) !== String(asset.ID));
    if (qtyNote) qtyNote.disabled = !!(asset.quantity_root_id && String(asset.quantity_root_id) !== String(asset.ID));

    const convUnit = document.getElementById('itemConvUnit');
    const convFactor = document.getElementById('itemConvFactor');
    const convMode = document.getElementById('itemConvMode');
    const btnApplyConv = document.getElementById('btnApplyConversion');

    if (convUnit) convUnit.value = asset.conversion_unit || '';
    if (convFactor) convFactor.value = (asset.conversion_factor ?? '') === null ? '' : (asset.conversion_factor ?? '');
    if (convMode) convMode.value = asset.conversion_mode || 'multiply';
    
    const isConvDisabled = !!(asset.quantity_root_id && asset.quantity_root_id !== asset.ID);
    if (convUnit) convUnit.disabled = isConvDisabled;
    if (convFactor) convFactor.disabled = isConvDisabled;
    if (convMode) convMode.disabled = isConvDisabled;
    if (btnApplyConv) btnApplyConv.disabled = isConvDisabled;
 
     // Ensure conversion UI is set up
     setupConversionUI();

    // Populate quantity tracking toggle
    const isQtyTrackedToggle = document.getElementById('itemIsQtyTracked');
    const qtyFieldsContainer = document.getElementById('qtyFieldsContainer');
    if (isQtyTrackedToggle && qtyFieldsContainer) {
      isQtyTrackedToggle.checked = asset.is_quantity_tracked === 1;
      // Show/hide quantity fields based on toggle state
      qtyFieldsContainer.style.display = isQtyTrackedToggle.checked ? 'grid' : 'none';
      // Add event listener for toggle changes to handle UI visibility
      isQtyTrackedToggle.onchange = () => {
        qtyFieldsContainer.style.display = isQtyTrackedToggle.checked ? 'grid' : 'none';
      };
    }
    
    const isRootAsset = !!(asset.quantity_root_id && String(asset.quantity_root_id) === String(asset.ID));
    const qtyHint = document.getElementById('qtyEditHint');
    if (qtyHint) {
        if (asset.quantity_root_id && !isRootAsset) {
            qtyHint.style.display = 'block';
            qtyHint.style.background = '#fff7ed';
            qtyHint.style.border = '1px solid #ffedd5';
            qtyHint.style.color = '#9a3412';
            qtyHint.innerHTML = `Quantity setup can’t be edited here. Use <a href="/asset/${encodeURIComponent(asset.ID)}" target="_blank" style="color: #9a3412; text-decoration: underline; font-weight: 800;">Asset Details</a> to Split / Issue / Consume.`;
        } else if (isRootAsset) {
            qtyHint.style.display = 'block';
            qtyHint.style.background = '#f0fdf4';
            qtyHint.style.border = '1px solid #dcfce7';
            qtyHint.style.color = '#166534';
            qtyHint.innerHTML = `<span style="font-weight: 600;">Root Asset:</span> You can update the base unit and total quantity here using the conversion tool.`;
        } else {
            qtyHint.style.display = 'block';
            qtyHint.style.background = '#f8fafc';
            qtyHint.style.border = '1px solid #e2e8f0';
            qtyHint.style.color = '#64748b';
            qtyHint.innerHTML = `<span style="font-style: italic;">Quantity tracking is not yet enabled for this asset. Fill the fields above to initialize it.</span>`;
        }
    }

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

    const warrantyTrackingToggle = document.getElementById('itemWarrantyTracking');
    if (warrantyTrackingToggle) {
        // Default to true if the field doesn't exist (legacy assets)
        warrantyTrackingToggle.checked = asset.warranty_tracking !== 0 && asset.warranty_tracking !== false;
    }

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
            
            // Populate quantity history timeline
            const historySection = document.getElementById('qtyHistorySection');
            const timelineContainer = document.getElementById('qtyHistoryTimeline');
            
            if (historySection) {
                 // Always try to add the link to the header if possible, or ensure it's there
                 const historyHeader = historySection.querySelector('h4');
                 if (historyHeader) {
                     historyHeader.innerHTML = `Quantity History & Timeline 
                         <a href="/api/quantity/events/${encodeURIComponent(asset.ID)}" target="_blank" 
                            style="float: right; font-size: 11px; color: #0056b3; background: #e7f3ff; padding: 2px 8px; border-radius: 4px; text-decoration: none; border: 1px solid #b3d7ff;">
                            🔗 Qty API
                         </a>`;
                 }
            }

            if (historySection) {
                historySection.style.display = 'block';
                if (timelineContainer) {
                    if (data.quantityEvents && data.quantityEvents.length > 0) {
                        timelineContainer.innerHTML = data.quantityEvents.map(e => {
                            const date = new Date(e.timestamp).toLocaleString();
                            const color = e.type === 'ISSUE' ? '#3b82f6' : 
                                         e.type === 'CONSUME' ? '#ef4444' : 
                                         e.type === 'ADJUST' ? '#f59e0b' : 
                                         e.type === 'SPLIT' ? '#8b5cf6' : '#0078d4';
                            
                            const icon = e.type === 'ISSUE' ? '📤' : 
                                        e.type === 'CONSUME' ? '🔥' : 
                                        e.type === 'ADJUST' ? '🛠️' : 
                                        e.type === 'SPLIT' ? '✂️' : '⚖️';
                            
                            return `
                                <div style="padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; border-left: 4px solid ${color}; background: #fff; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <span>${icon}</span>
                                            <span style="font-weight: 800; color: ${color}; text-transform: uppercase; font-size: 11px;">${e.type}</span>
                                        </div>
                                        <span style="color: #64748b; font-size: 11px;">${date}</span>
                                    </div>
                                    <div style="color: #1e293b; font-weight: 700; margin-bottom: 2px;">By ${e.actor}</div>
                                    ${e.note ? `<div style="color: #475569; font-style: italic; margin-top: 4px; padding: 4px 8px; background: #f8fafc; border-radius: 4px; border-left: 2px solid #cbd5e1;">"${e.note}"</div>` : ''}
                                    ${e.metadata ? `
                                        <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0; font-family: monospace; font-size: 11px; color: #475569;">
                                            ${Object.entries(e.metadata).map(([k, v]) => `<div><b style="color: #1e293b;">${k}:</b> ${v}</div>`).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('');
                    } else {
                        timelineContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No quantity history recorded yet.</div>';
                    }
                }
            }

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
    let assets = (window.allAssets || []).filter(a => {
        // Robust matching logic (synced with renderDashboard)
        const assetType = (a.Type || '').toLowerCase().trim();
        const assetName = (a.Name || '').toLowerCase().trim();
        
        const typeMatch = nodeKindNames.some(kindName => {
            const k = kindName.toLowerCase().trim();
            const t = assetType;
            
            if (t === k) return true;
            if (t === k + 's' || t + 's' === k) return true;
            if (t === k + 'es' || t + 'es' === k) return true;
            if (k.endsWith('y') && t === k.slice(0, -1) + 'ies') return true;
            if (t.endsWith('y') && k === t.slice(0, -1) + 'ies') return true;
            if (assetName === k) return true;
            return false;
        });

        const isPlaceholder = (a.isPlaceholder === true || a.isPlaceholder === 1 || a.isPlaceholder === 'true');
        return typeMatch && !isPlaceholder;
    });

    // Apply search filter if present
    if (query) {
        assets = assets.filter(a => matchesQuery(a, query));
    }
    
    if (assets.length === 0) {
        body.innerHTML = `<tr><td colspan="13" style="text-align:center;">No ${query ? 'matching ' : ''}assets found for this kind.</td></tr>`;
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
                    ${(a.Icon && (a.Icon.startsWith('/') || a.Icon.startsWith('http'))) 
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
                <td>
                    <div style="font-size: 11px;">
                        ${(a.is_quantity_tracked === 1 || a.quantity_unit || a.quantity_total) ? `
                            <strong style="color: #0078d4;">⚖️ ${a.quantity_total ?? 0}</strong> ${a.quantity_unit || ''}
                            ${a.quantity_available !== undefined ? `<br><span style="color: #666;">Avail: ${a.quantity_available}</span>` : ''}
                        ` : ''}
                        <br><a href="/api/quantity/events/${encodeURIComponent(a.ID)}" target="_blank" onclick="event.stopPropagation()" style="color: #0056b3; font-weight: 700; text-decoration: none; background: #e7f3ff; padding: 2px 5px; border-radius: 4px; border: 1px solid #b3d7ff; font-size: 9px; display: inline-flex; align-items: center; gap: 3px; margin-top: 5px;">🔗 Qty API</a>
                    </div>
                </td>
                <td>${a.ParentId || '-'}</td>
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

window.updateIconPreview = (val) => {
    const preview = document.getElementById('itemIconPreview');
    if (!preview) return;
    
    if (val && (val.startsWith('/') || val.startsWith('http'))) {
        preview.innerHTML = `<img src="${val}" style="width: 100%; height: 100%; object-fit: contain;">`;
    } else {
        preview.innerHTML = val || '📦';
    }
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
                const input = document.getElementById(currentIconTargetId);
                input.value = result.path;
                window.updateIconPreview(result.path);
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
                                renderDashboard(window.allAssets, window.getFilteredAssets || (() => window.allAssets));
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
                    PurchaseDate: formData.get('itemPurchaseDate'),
                    warranty_tracking: document.getElementById('itemWarrantyTracking')?.checked ? 1 : 0,
                    is_quantity_tracked: document.getElementById('itemIsQtyTracked')?.checked ? 1 : 0
                };

                // FormData ignores disabled fields, so we get values directly from DOM
                const qtyUnitEl = document.getElementById('itemQtyUnit');
                const qtyTotalEl = document.getElementById('itemQtyTotal');
                const qtyPrecisionEl = document.getElementById('itemQtyPrecision');
                
                const qtyUnitValue = qtyUnitEl ? qtyUnitEl.value.trim() : '';
                const qtyTotalValue = qtyTotalEl ? qtyTotalEl.value.trim() : '';
                const qtyPrecisionValue = qtyPrecisionEl ? qtyPrecisionEl.value.trim() : '';
                const qtyNote = String(formData.get('itemQtyNote') || '').trim();

                console.log('Collected Qty Values:', {
                    qtyUnitValue,
                    qtyTotalValue,
                    qtyPrecisionValue,
                    qtyNote,
                    formDataQtyUnit: formData.get('itemQtyUnit')
                });

                const isQtyTracked = document.getElementById('itemIsQtyTracked')?.checked;

                if (isQtyTracked) {
                    // Validation
                    if (!qtyUnitValue) throw new Error('Quantity unit is required when quantity tracking is enabled.');
                    const qtyTotal = Number(qtyTotalValue);
                    if (!Number.isFinite(qtyTotal) || qtyTotal <= 0) throw new Error('Quantity total must be a number > 0.');
                    const qtyPrecision = qtyPrecisionValue === '' ? 0 : Number(qtyPrecisionValue);
                    if (!Number.isFinite(qtyPrecision) || qtyPrecision < 0) throw new Error('Quantity precision must be a number >= 0.');

                    asset.quantity_unit = qtyUnitValue;
                    asset.quantity_total = qtyTotal;
                    asset.quantity_precision = Math.floor(qtyPrecision);
                    if (qtyNote) asset.quantity_note = qtyNote;

                    console.log('Asset object with quantity:', asset);

                    // Also include conversion unit/factor if they are disabled (inherited)
                    // but we might want to update them if they were part of the conversion
                    const convUnitEl = document.getElementById('itemConvUnit');
                    const convFactorEl = document.getElementById('itemConvFactor');
                    const convModeEl = document.getElementById('itemConvMode');
                    
                    if (convUnitEl) asset.conversion_unit = convUnitEl.value.trim();
                    if (convFactorEl) {
                        const cfValue = convFactorEl.value.trim();
                        if (cfValue !== '') {
                            const cf = parseFloat(cfValue);
                            asset.conversion_factor = isNaN(cf) ? null : cf;
                        } else {
                            asset.conversion_factor = null;
                        }
                    }
                    if (convModeEl) asset.conversion_mode = convModeEl.value;
                } else {
                    // If tracking is disabled, we might want to explicitly set fields to null/0
                    // or just leave them as they are. Given the user's request, 
                    // disabling tracking should probably hide the info.
                    asset.quantity_unit = null;
                    asset.quantity_total = 0;
                    asset.quantity_available = 0;
                    asset.is_quantity_tracked = 0;
                }

                // Collect conversion fields independently if they are NOT disabled (for non-root assets or initial setup)
                // This ensures fields are captured if hasAnyQty logic is skipped
                const convUnitEl = document.getElementById('itemConvUnit');
                if (convUnitEl && !convUnitEl.disabled && !asset.conversion_unit) {
                    const convUnit = String(formData.get('itemConvUnit') || '').trim();
                    const convFactorRaw = String(formData.get('itemConvFactor') || '').trim();
                    const convMode = formData.get('itemConvMode') || 'multiply';
                    
                    asset.conversion_unit = convUnit;
                    asset.conversion_mode = convMode;
                    
                    if (convFactorRaw !== '') {
                        const convFactor = Number(convFactorRaw);
                        if (Number.isFinite(convFactor) && convFactor > 0) {
                            asset.conversion_factor = convFactor;
                        }
                    } else {
                        asset.conversion_factor = null;
                    }
                }

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
                    const id = row.querySelector('.child-id').value;
                    if (name) {
                        components.push({
                            ID: id || undefined,
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
        window.uploadKindImage = async (input) => {
            if (!input.files || !input.files[0]) return;
            
            const formData = new FormData();
            formData.append('image', input.files[0]);
            
            try {
                const response = await fetch('/api/asset_kinds/upload-image', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const result = await response.json();
                    document.getElementById('newKindImage').value = result.url;
                } else {
                    alert('Failed to upload image');
                }
            } catch (err) {
                console.error('Image upload error:', err);
                alert('Error uploading image');
            }
        };

        kindForm.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(kindForm);
            const category = localStorage.getItem('selectedAssetCategory') || 'IT';
            
            const kindData = {
                Name: formData.get('newKindName'),
                Icon: formData.get('newKindIcon'),
                ParentID: formData.get('newKindParent'),
                DisplayImage: formData.get('newKindImage'),
                Identifier: formData.get('newKindIdentifier'),
                Module: category
            };

            try {
                const response = await fetch('/api/asset_kinds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(kindData)
                });
                
                if (response.ok) {
                    alert('Category saved successfully!');
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
            const reportType = confirm('Would you like to generate a Category Summary Report?\n\n(Click "Cancel" for a Detailed Asset Report)') ? 'kind' : 'asset';
            
            const category = localStorage.getItem('selectedAssetCategory') || 'IT';
            const parent = window.currentDashboardParent;
            const parentName = parent ? parent.Name : 'All Assets';
            
            let assetsToReport = [];
            
            // Handle Temporary Assets View specifically
            if (parent && parent.ID === 'TEMP_VIEW') {
                assetsToReport = window.currentTempAssets || [];
                if (assetsToReport.length === 0) {
                    alert('No temporary assets to report.');
                    return;
                }
                
                console.log(`Generating report for ${assetsToReport.length} temporary assets`);
                
                const headers = ['ID', 'ItemName', 'ProjectId', 'Quantity', 'EstimatedPrice', 'Currency', 'Make', 'Model', 'Status'];
                const csvContent = [
                    headers.join(','),
                    ...assetsToReport.map(a => [
                        a.ID,
                        `"${a.ItemName || ''}"`,
                        `"${a.ProjectId || ''}"`,
                        a.Quantity || 0,
                        a.EstimatedPrice || 0,
                        `"${a.Currency || 'INR'}"`,
                        `"${a.Make || ''}"`,
                        `"${a.Model || ''}"`,
                        `"${a.Status || 'Temporary'}"`
                    ].join(','))
                ].join('\n');

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.setAttribute('href', url);
                link.setAttribute('download', `TemporaryAssetsReport_${new Date().toISOString().split('T')[0]}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                return;
            }

            if (reportType === 'kind') {
                generateKindSummaryReport(category);
                return;
            }

            // Get current assets in view for detailed report
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
            
            // Standard Detailed Asset Report (Excel)
            const reportData = assetsToReport.map(a => {
                // Get components if any
                const components = (window.allAssets || []).filter(comp => comp.ParentId === a.ID).map(comp => comp.ItemName).join(', ');
                
                return {
                    'ID': a.ID,
                    'Item Name': a.ItemName || '',
                    'Type': a.Type || '',
                    'Status': a.Status || 'Owned',
                    'Make': a.Make || '',
                    'Model': a.Model || '',
                    'Serial No': a.SrNo || '',
                    'Current Location': a.CurrentLocation || '',
                    'Assigned To': a.AssignedTo || '',
                    'Purchase Details': a.PurchaseDetails || '',
                    'Purchase Date': a.PurchaseDate || '',
                    'Warranty (Months)': a.warranty_months || 0,
                    'AMC (Months)': a.amc_months || 0,
                    'Asset Value': a.asset_value || 0,
                    'Currency': a.Currency || 'INR',
                    'Components': components || 'None'
                };
            });

            try {
                const ws = XLSX.utils.json_to_sheet(reportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Asset Report");
                XLSX.writeFile(wb, `AssetReport_${category}_${parentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
            } catch (err) {
                console.error('Error generating detailed asset report:', err);
                // Fallback to CSV if XLSX fails
                const headers = Object.keys(reportData[0]);
                const csvContent = [
                    headers.join(','),
                    ...reportData.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
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
            }
        };
    }

function generateKindSummaryReport(moduleCategory) {
    const kinds = window.allAssetKinds || [];
    const assets = window.allAssets || [];
    const moduleKinds = kinds.filter(k => k.Category === moduleCategory);
    
    const reportData = moduleKinds.map(kind => {
        const kindAssets = assets.filter(a => a.Type === kind.Name && a.Category === moduleCategory);
        const total = kindAssets.length;
        
        const stats = {
            'Category': kind.Name,
            'Total Assets': total,
            'Owned': kindAssets.filter(a => a.Status === 'Owned').length,
            'Sold': kindAssets.filter(a => a.Status === 'Sold').length,
            'Demo': kindAssets.filter(a => a.Status === 'Demo').length,
            'In-Use': kindAssets.filter(a => a.Status === 'In-Use').length,
            'Rental': kindAssets.filter(a => a.Status === 'Rental').length,
            'Stand By': kindAssets.filter(a => a.Status === 'Stand By').length,
            'In-Repair': kindAssets.filter(a => a.Status === 'In-Repair').length,
            'Scraped': kindAssets.filter(a => a.Status === 'Scraped').length
        };
        return stats;
    });

    try {
        const ws = XLSX.utils.json_to_sheet(reportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Category Summary");
        XLSX.writeFile(wb, `CategorySummary_${moduleCategory}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
        console.error('Error generating category report:', err);
        // Fallback to CSV if XLSX fails
        const headers = Object.keys(reportData[0]);
        const csvContent = [
            headers.join(','),
            ...reportData.map(row => headers.map(h => row[h]).join(','))
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `CategorySummary_${moduleCategory}.csv`;
        link.click();
    }
}

window.generateKindSummaryReport = generateKindSummaryReport;

    const btnReportSheet = document.getElementById('btnReportSheet');
    if (btnReportSheet) {
        btnReportSheet.onclick = () => {
            if (window.tabulatorInstance) {
                const category = localStorage.getItem('selectedAssetCategory') || 'IT';
                const parent = window.currentDashboardParent;
                let filename = `AssetSheet_${category}_${new Date().toISOString().split('T')[0]}.xlsx`;
                
                if (parent && parent.ID === 'TEMP_VIEW') {
                    filename = `TemporaryAssetsSheet_${new Date().toISOString().split('T')[0]}.xlsx`;
                } else if (parent && parent.Name) {
                    filename = `AssetSheet_${category}_${parent.Name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
                }

                window.tabulatorInstance.download("xlsx", filename, { sheetName: "Assets" });
            } else {
                alert('Sheet view is not initialized.');
            }
        };
    }
}

// QR Code Modal Functions
window.showQRModal = function(id, name) {
    const modal = document.getElementById('qrModal');
    const img = document.getElementById('qrModalImage');
    const title = document.getElementById('qrModalTitle');
    const idText = document.getElementById('qrModalId');
    
    if (!modal || !img) return;
    
    title.textContent = name || 'QR Code';
    img.src = `/api/qr/${encodeURIComponent(id)}`;
    idText.textContent = id;
    
    modal.style.display = 'flex';
};

window.printQR = function() {
    const img = document.getElementById('qrModalImage');
    if (!img) return;
    
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Print QR Code</title>');
    printWindow.document.write('</head><body style="text-align:center; padding: 50px;">');
    printWindow.document.write(`<h2 style="font-family: sans-serif; margin-bottom: 20px;">${document.getElementById('qrModalTitle').textContent}</h2>`);
    printWindow.document.write(`<img src="${img.src}" style="width: 400px; height: 400px;">`);
    printWindow.document.write(`<p style="font-family: monospace; font-size: 24px; margin-top: 20px;">${document.getElementById('qrModalId').textContent}</p>`);
    printWindow.document.write('</body></html>');
    
    printWindow.document.close();
    printWindow.focus();
    // Wait for image to load before printing
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
};

// --- QR SCANNER LOGIC REMOVED ---

/**
 * Shows the Quantity History Modal for a given asset
 * Fetches events from /api/quantity/events/:id
 */
async function showQuantityHistoryModal(assetId) {
    const modal = document.getElementById('qtyHistoryModal');
    const loading = document.getElementById('qtyHistoryLoading');
    const content = document.getElementById('qtyHistoryContent');
    const tbody = document.getElementById('qtyHistoryTableBody');
    
    if (!modal || !loading || !content || !tbody) {
        console.error('Quantity Modal elements not found');
        return;
    }

    // Reset and show modal
    modal.style.display = 'block';
    loading.style.display = 'block';
    content.style.display = 'none';
    tbody.innerHTML = '';
    
    // Reset Header
    document.getElementById('qtyModalAssetName').textContent = 'Loading...';
    document.getElementById('qtyModalAssetId').textContent = assetId;
    document.getElementById('qtyModalCurrentStock').textContent = '-';

    try {
        const response = await fetch(`/api/quantity/events/${encodeURIComponent(assetId)}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch events');
        }

        // Update Header
        const asset = (window.allAssets || []).find(a => a.ID === assetId);
        if (asset) {
            document.getElementById('qtyModalAssetName').textContent = asset.ItemName;
            document.getElementById('qtyModalAssetIcon').innerHTML = (asset.Icon && (asset.Icon.startsWith('/') || asset.Icon.startsWith('http'))) 
                ? `<img src="${asset.Icon}" style="width: 24px; height: 24px; object-fit: contain;">`
                : (asset.Icon || '📦');
            
            const unit = asset.quantity_unit || '';
            const total = asset.quantity_total ?? 0;
            document.getElementById('qtyModalCurrentStock').textContent = `${total} ${unit}`;
        } else {
             document.getElementById('qtyModalAssetName').textContent = `Asset ${assetId}`;
        }

        // Render Events
        if (!data.events || data.events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">No quantity events found.</td></tr>';
        } else {
            // Sort by timestamp descending
            const events = data.events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            tbody.innerHTML = events.map(e => {
                const date = new Date(e.timestamp).toLocaleString();
                const meta = e.metadata || {};
                
                // Calculate net change for this asset from lines
                const myLines = (e.lines || []).filter(l => l.asset_id === assetId);
                let changeStr = '';
                
                if (myLines.length > 0) {
                    changeStr = myLines.map(l => {
                        const val = l.delta_total !== 0 ? l.delta_total : l.delta_available;
                        const color = val > 0 ? 'green' : (val < 0 ? 'red' : 'gray');
                        const sign = val > 0 ? '+' : '';
                        return `<span style="color:${color}; font-weight:600;">${sign}${val} ${l.unit}</span>`;
                    }).join('<br>');
                } else {
                    changeStr = '<span style="color:#999;">-</span>';
                }

                // Format metadata
                let metaStr = '';
                if (e.note) metaStr += `<div>${escapeHtml(e.note)}</div>`;
                if (meta.orderNo) metaStr += `<div style="font-size:11px; color:#666;">Order: ${escapeHtml(meta.orderNo)}</div>`;
                if (meta.ref) metaStr += `<div style="font-size:11px; color:#666;">Ref: ${escapeHtml(meta.ref)}</div>`;

                return `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 10px; font-size: 12px;">${date}</td>
                        <td style="padding: 10px; font-size: 12px;">
                            <span class="badge ${getEventTypeClass(e.type)}">${e.type}</span>
                        </td>
                        <td style="padding: 10px; font-size: 12px;">${escapeHtml(e.actor || 'System')}</td>
                        <td style="padding: 10px; font-size: 12px;">${changeStr}</td>
                        <td style="padding: 10px; font-size: 12px;">${metaStr}</td>
                    </tr>
                `;
            }).join('');
        }

    } catch (err) {
        console.error('Error fetching quantity history:', err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: red; padding: 20px;">Error loading history: ${err.message}</td></tr>`;
    } finally {
        loading.style.display = 'none';
        content.style.display = 'block';
    }
}

function getEventTypeClass(type) {
    switch(type) {
        case 'ISSUE': return 'badge-warning'; 
        case 'CONSUME': return 'badge-danger'; 
        case 'RECEIVE': return 'badge-success'; 
        case 'ADJUST': return 'badge-info'; 
        default: return 'badge-secondary'; 
    }
}

// Helper for CSS classes if not already defined
const style = document.createElement('style');
style.textContent = `
    .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .badge-warning { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
    .badge-danger { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .badge-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .badge-info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
    .badge-secondary { background: #e2e3e5; color: #383d41; border: 1px solid #d6d8db; }
`;
document.head.appendChild(style);

window.showQuantityHistoryModal = showQuantityHistoryModal;

document.addEventListener('DOMContentLoaded', () => {
    const btnFetchFromProject = document.getElementById('btnFetchFromProject');
    if (btnFetchFromProject) {
        btnFetchFromProject.onclick = (e) => {
            e.preventDefault();
            window.showProjectSelectionModal();
        };
    }
});

window.showProjectSelectionModal = async function() {
    let modal = document.getElementById('dcProjectSelectModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dcProjectSelectModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <span class="close-modal" onclick="document.getElementById('dcProjectSelectModal').style.display='none'">&times;</span>
                <h3>Select Project</h3>
                <input type="text" id="dcProjectSearchInput" placeholder="Search projects..." class="form-input" style="width: 100%; margin-bottom: 15px; padding: 10px;">
                <div id="dcProjectList" style="max-height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px;">
                    <div style="padding: 20px; text-align: center; color: #999;">Loading...</div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Add search listener
        document.getElementById('dcProjectSearchInput').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.dc-project-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(term) ? 'block' : 'none';
            });
        });
    }

    const list = document.getElementById('dcProjectList');
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Loading...</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('Failed to load projects');
        const projects = await res.json();

        if (projects.length === 0) {
            list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No projects found</div>';
            return;
        }

        list.innerHTML = projects.map(p => `
            <div class="dc-project-item" onclick="selectProjectForDC('${p.ID}')" style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; transition: background 0.2s;">
                <div style="font-weight: 600; color: #333;">${p.Name || p.ProjectName}</div>
                <div style="font-size: 12px; color: #666;">${p.ClientName || 'No Client'} • ${p.Location || 'No Location'}</div>
            </div>
        `).join('');
        
        // Add hover effect via JS since it's dynamic
        list.querySelectorAll('.dc-project-item').forEach(item => {
            item.onmouseover = () => item.style.background = '#f8f9fa';
            item.onmouseout = () => item.style.background = 'transparent';
        });

    } catch (err) {
        console.error(err);
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">Failed to load projects</div>';
    }
};

window.selectProjectForDC = async function(projectId) {
    try {
        // Fetch full details including new fields
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error('Failed to load project details');
        const project = await res.json();

        // Check for orders
        const ordersRes = await fetch(`/api/projects/${projectId}/orders`);
        let orders = [];
        if (ordersRes.ok) {
            orders = await ordersRes.json();
        }

        if (orders.length > 0) {
            // Show Order Selection Modal
            let orderModal = document.getElementById('dcOrderSelectModal');
            if (!orderModal) {
                orderModal = document.createElement('div');
                orderModal.id = 'dcOrderSelectModal';
                orderModal.className = 'modal';
                orderModal.style.zIndex = '10002';
                orderModal.innerHTML = `
                    <div class="modal-content" style="max-width: 600px;">
                        <span class="close-modal" onclick="document.getElementById('dcOrderSelectModal').style.display='none'">&times;</span>
                        <h3>Select Order / Consignee</h3>
                        <div style="margin-bottom: 15px; font-size: 13px; color: #666;">
                            This project has multiple orders. Please select one to populate the Delivery Challan.
                        </div>
                        <div id="dcOrderList" style="max-height: 400px; overflow-y: auto; display: grid; gap: 10px;"></div>
                    </div>
                `;
                document.body.appendChild(orderModal);
            }

            const list = document.getElementById('dcOrderList');
            
            // Add "Default Project Details" as first option
            let html = `
                <div class="card-panel" onclick="window.confirmDCProjectSelection('default')" 
                     style="cursor: pointer; border-left: 4px solid #3b82f6; padding: 10px; transition: background 0.2s;">
                    <div style="font-weight: 600; color: #333;">Default Project Details</div>
                    <div style="font-size: 12px; color: #666;">Use the default Consignee and Buyer configured in the project.</div>
                </div>
            `;

            html += orders.map((o, idx) => `
                <div class="card-panel" onclick="window.confirmDCProjectSelection(${idx})" 
                     style="cursor: pointer; border-left: 4px solid #10b981; padding: 10px; transition: background 0.2s;">
                    <div style="display: flex; justify-content: space-between;">
                        <div style="font-weight: 600; color: #333;">Order: ${o.OrderNo || 'N/A'}</div>
                        <div style="font-size: 12px; color: #666;">${o.OrderDate || ''}</div>
                    </div>
                    <div style="margin-top: 5px; font-size: 12px;">
                        <span style="font-weight: 500;">Consignee:</span> ${o.ConsigneeName || 'Same as Project'}
                    </div>
                    <div style="font-size: 11px; color: #666;">${o.ConsigneeAddress || ''}</div>
                </div>
            `).join('');

            list.innerHTML = html;
            
            // Hover effects
            list.querySelectorAll('.card-panel').forEach(el => {
                el.onmouseover = () => el.style.background = '#f8fafc';
                el.onmouseout = () => el.style.background = 'white';
            });

            // Store temp data for selection
            window.tempDCProjectData = { project, orders };
            
            document.getElementById('dcProjectSelectModal').style.display = 'none'; // Hide project list
            orderModal.style.display = 'flex'; // Show order list

        } else {
            // No orders, just use project default
            window.tempDCProjectData = { project, orders: [] };
            window.confirmDCProjectSelection('default');
        }

    } catch (err) {
        console.error(err);
        alert('Error populating details: ' + err.message);
    }
};

window.confirmDCProjectSelection = function(index) {
    const { project, orders } = window.tempDCProjectData;
    const modal = document.getElementById('dcOrderSelectModal');
    
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    if (index === 'default') {
        // Use project default
        setVal('dcConsigneeName', project.ConsigneeName || project.ClientName || '');
        setVal('dcConsigneeAddress', project.ConsigneeAddress || project.Location || ''); 
        setVal('dcConsigneeGST', project.ConsigneeGSTIN || '');
        setVal('dcConsigneeState', project.ConsigneeState || '');
        setVal('dcConsigneeStateCode', project.ConsigneeStateCode || '');

        setVal('dcBuyerName', project.BuyerName || project.ClientName || '');
        setVal('dcBuyerAddress', project.BuyerAddress || '');
        setVal('dcBuyerGST', project.BuyerGSTIN || '');
        setVal('dcBuyerState', project.BuyerState || '');
        setVal('dcBuyerStateCode', project.BuyerStateCode || '');
        setVal('dcBuyerOrderNo', ''); // No order no
        
        if (typeof showToast === 'function') showToast('DC details populated from project default', 'success');

    } else {
        // Use selected order
        const order = orders[index];

        // Use Order Consignee if present, else Project Consignee
        setVal('dcConsigneeName', order.ConsigneeName || project.ConsigneeName || '');
        setVal('dcConsigneeAddress', order.ConsigneeAddress || project.ConsigneeAddress || ''); 
        setVal('dcConsigneeGST', order.ConsigneeGSTIN || project.ConsigneeGSTIN || '');
        setVal('dcConsigneeState', order.ConsigneeState || project.ConsigneeState || '');
        setVal('dcConsigneeStateCode', order.ConsigneeStateCode || project.ConsigneeStateCode || '');

        // Use Project Buyer (as requested, Buyer remains same)
        setVal('dcBuyerName', project.BuyerName || '');
        setVal('dcBuyerAddress', project.BuyerAddress || '');
        setVal('dcBuyerGST', project.BuyerGSTIN || '');
        setVal('dcBuyerState', project.BuyerState || '');
        setVal('dcBuyerStateCode', project.BuyerStateCode || '');
        
        setVal('dcBuyerOrderNo', order.OrderNo || '');
        
        // Try to set date if field exists (assuming standard HTML5 date input)
        const refDateEl = document.getElementById('dcRefDate'); 
        if (refDateEl && order.OrderDate) refDateEl.value = order.OrderDate;

        if (typeof showToast === 'function') showToast('DC details populated from order', 'success');
    }
    
    // Also set customer name if empty
    const customerEl = document.getElementById('dcCustomerName');
    if (customerEl && !customerEl.value) {
        customerEl.value = project.ClientName || '';
    }

    if (modal) modal.style.display = 'none';
    document.getElementById('dcProjectSelectModal').style.display = 'none';
};

// --- Load Database Dropdowns for DC ---
async function loadDCDropdowns() {
    const companySearch = document.getElementById('dcCompanySearch');
    const companyList = document.getElementById('dcCompanyList');
    
    const consigneeSearch = document.getElementById('dcConsigneeSearch');
    const consigneeList = document.getElementById('dcConsigneeList');
    
    const buyerSearch = document.getElementById('dcBuyerSearch');
    const buyerList = document.getElementById('dcBuyerList');
    
    if (!companySearch && !consigneeSearch && !buyerSearch) return;
    
    try {
        const res = await fetch('/api/projects');
        if (!res.ok) return;
        const projects = await res.json();
        
        // Extract Unique Data
        const consignees = new Map();
        const buyers = new Map();
        const companies = new Map();

        projects.forEach(p => {
            // Consignee Logic
            const cName = (p.ConsigneeName || p.ClientName || '').trim();
            if (cName && !consignees.has(cName)) {
                consignees.set(cName, {
                    name: cName,
                    address: p.ConsigneeAddress || p.Location || '',
                    gstin: p.ConsigneeGSTIN || '',
                    state: p.ConsigneeState || '',
                    stateCode: p.ConsigneeStateCode || ''
                });
            }

            // Buyer Logic
            const bName = (p.BuyerName || p.ClientName || '').trim();
            if (bName && !buyers.has(bName)) {
                buyers.set(bName, {
                    name: bName,
                    address: p.BuyerAddress || '',
                    gstin: p.BuyerGSTIN || '',
                    state: p.BuyerState || '',
                    stateCode: p.BuyerStateCode || ''
                });
            }

            // Company Logic
            const compName = (p.ClientName || '').trim();
            if (compName && !companies.has(compName)) {
                companies.set(compName, {
                    name: compName,
                    address: p.Location || '',
                    gstin: p.BuyerGSTIN || '', // Fallback
                    state: p.BuyerState || '',
                    stateCode: p.BuyerStateCode || ''
                });
            }
        });

        // Setup Searchable Dropdown
        const setupDropdown = (input, list, map, type) => {
            if (!input || !list) return;
            
            const allItems = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
            
            const renderList = (items) => {
                if (items.length === 0) {
                    list.innerHTML = '<div style="padding: 8px; color: #999; font-size: 11px;">No matches found</div>';
                } else {
                    list.innerHTML = items.map(item => `
                        <div class="dropdown-item" data-details='${JSON.stringify(item).replace(/'/g, "&apos;")}' style="padding: 8px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px;">
                            <div style="font-weight: 600;">${item.name}</div>
                            <div style="font-size: 10px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.address || 'No Address'}</div>
                        </div>
                    `).join('');
                    
                    // Add click handlers
                    list.querySelectorAll('.dropdown-item').forEach(el => {
                        el.onmouseover = () => el.style.background = '#f0f7ff';
                        el.onmouseout = () => el.style.background = 'white';
                        el.onclick = () => {
                            const data = JSON.parse(el.getAttribute('data-details'));
                            input.value = ''; // Clear search
                            list.style.display = 'none'; // Hide list
                            
                            // Populate Fields
                            if (type === 'Company') {
                                document.getElementById('dcCompanyName').value = data.name;
                                document.getElementById('dcCompanyAddress').value = data.address;
                                document.getElementById('dcCompanyGST').value = data.gstin;
                                document.getElementById('dcCompanyState').value = data.state;
                                document.getElementById('dcCompanyStateCode').value = data.stateCode;
                            } else if (type === 'Consignee') {
                                document.getElementById('dcConsigneeName').value = data.name;
                                document.getElementById('dcConsigneeAddress').value = data.address;
                                document.getElementById('dcConsigneeGST').value = data.gstin;
                                document.getElementById('dcConsigneeState').value = data.state;
                                document.getElementById('dcConsigneeStateCode').value = data.stateCode;
                            } else if (type === 'Buyer') {
                                document.getElementById('dcBuyerName').value = data.name;
                                document.getElementById('dcBuyerAddress').value = data.address;
                                document.getElementById('dcBuyerGST').value = data.gstin;
                                document.getElementById('dcBuyerState').value = data.state;
                                document.getElementById('dcBuyerStateCode').value = data.stateCode;
                            }
                        };
                    });
                }
                list.style.display = 'block';
            };

            // Focus: Show top 10
            input.onfocus = () => {
                renderList(allItems.slice(0, 10));
            };
            
            // Input: Filter
            input.oninput = (e) => {
                const term = e.target.value.toLowerCase();
                if (!term) {
                    renderList(allItems.slice(0, 10));
                    return;
                }
                
                const matches = allItems.filter(item => 
                    item.name.toLowerCase().includes(term) || 
                    (item.address && item.address.toLowerCase().includes(term))
                ).slice(0, 10);
                
                renderList(matches);
            };

            // Click outside to close
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !list.contains(e.target)) {
                    list.style.display = 'none';
                }
            });
        };

        setupDropdown(companySearch, companyList, companies, 'Company');
        setupDropdown(consigneeSearch, consigneeList, consignees, 'Consignee');
        setupDropdown(buyerSearch, buyerList, buyers, 'Buyer');

    } catch (err) {
        console.error('Failed to load DC dropdowns', err);
    }
}

window.showQuantityHistoryModal = showQuantityHistoryModal;
