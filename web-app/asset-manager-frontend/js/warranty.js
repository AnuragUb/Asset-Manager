
console.log('WARRANTY.JS: Module loaded');
// Warranty and AMC Management Module

let warrantyChart = null;
let warrantyRanges = [];

const defaultRanges = [
    { label: 'Expired', min: -999, color: '#000000' },
    { label: '< 3 Months', min: 0, color: '#ff0000' },
    { label: '3-6 Months', min: 3, color: '#ff8c00' },
    { label: '6-12 Months', min: 6, color: '#ffd700' },
    { label: '1-2 Years', min: 12, color: '#90ee90' },
    { label: '2+ Years', min: 24, color: '#006400' }
];

export function initWarrantyView() {
    console.log('WARRANTY: initWarrantyView() called');
    const summaryBody = document.getElementById('warrantySummaryBody');
    if (summaryBody) {
        summaryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #0078d4; font-weight: bold;">🔄 Initializing view...</td></tr>';
    }

    try {
        loadRanges();
        renderRangesTable();
        
        // Use a small timeout to allow DOM to settle and global state to be verified
        setTimeout(() => {
            console.log('WARRANTY: Calling updateWarrantyChart/Table');
            updateWarrantyChart();
            updateWarrantySummaryTable();
        }, 50);

        populateWarrantyFilter();
        
        // Setup event listeners for range management
        const manageBtn = document.getElementById('btnManageWarrantyRanges');
        if (manageBtn) {
            manageBtn.onclick = () => {
                const modal = document.getElementById('warrantyRangeModal');
                if (modal) {
                    resetRangeForm();
                    modal.style.display = 'block';
                }
            };
        }

        const filterSelect = document.getElementById('warrantyFilterSelect');
        if (filterSelect) {
            filterSelect.onchange = (e) => {
                const rangeLabel = e.target.value;
                if (rangeLabel === 'all') {
                    // Maybe show all assets or clear?
                    // For now, let's show all assets in the category
                    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
                    const assets = (window.allAssets || []).filter(a => a.Category === category && !a.isPlaceholder);
                    showAssetsInModal(assets, `All ${category} Assets`);
                } else {
                    const range = warrantyRanges.find(r => r.label === rangeLabel);
                    if (range) {
                        const assets = filterAssetsByRange(range);
                        showAssetsInModal(assets, `Assets: ${range.label}`);
                    }
                }
            };
        }

        const addRangeForm = document.getElementById('addRangeForm');
        if (addRangeForm) {
            addRangeForm.onsubmit = (e) => {
                e.preventDefault();
                saveRange();
                populateWarrantyFilter();
            };
        }

        const closeModal = document.querySelector('#warrantyRangeModal .close-modal');
        if (closeModal) {
            closeModal.onclick = () => {
                document.getElementById('warrantyRangeModal').style.display = 'none';
            };
        }
        console.log('initWarrantyView() - Initialization complete');
    } catch (err) {
        console.error('CRITICAL ERROR in initWarrantyView:', err);
    }
}

function populateWarrantyFilter() {
    const filterSelect = document.getElementById('warrantyFilterSelect');
    if (!filterSelect) return;

    const currentValue = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">All Assets</option>' + 
        warrantyRanges.map(r => `<option value="${r.label}">${r.label}</option>`).join('');
    
    filterSelect.value = currentValue || 'all';
}

function filterAssetsByRange(range) {
    const assets = window.allAssets || [];
    const category = localStorage.getItem('selectedAssetCategory') || 'IT';
    
    // Find the index of this range to know its boundaries
    const rangeIndex = warrantyRanges.findIndex(r => r.label === range.label);
    const nextRange = warrantyRanges[rangeIndex + 1];
    const maxMonths = nextRange ? nextRange.min : 9999;

    return assets.filter(asset => {
        if (asset.isPlaceholder || asset.Category !== category) return false;
        const months = calculateMonthsRemaining(asset.PurchaseDate, asset.warranty_months);
        return months >= range.min && months < maxMonths;
    });
}

function showAssetsInModal(assets, titleText) {
    const modal = document.getElementById('assetListModal');
    const title = document.getElementById('assetListTitle');
    const body = document.getElementById('tblBodyAssetList');
    
    if (!modal || !body) return;
    
    title.textContent = titleText;
    body.innerHTML = '';
    
    if (assets.length === 0) {
        body.innerHTML = `<tr><td colspan="16" style="text-align:center; padding: 20px;">No assets found in this warranty range.</td></tr>`;
    } else {
        assets.forEach(a => {
            const months = calculateMonthsRemaining(a.PurchaseDate, a.warranty_months);
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td>${a.ID || '-'}</td>
                <td style="text-align: center; font-size: 20px;">
                    ${(a.Icon && a.Icon.startsWith('/icons/')) 
                        ? `<img src="${a.Icon}" style="width: 24px; height: 24px; object-fit: contain;">`
                        : (a.Icon || '📦')}
                </td>
                <td>${a.ItemName || '-'}</td>
                <td><span class="status-badge ${(a.Status || '').toLowerCase().replace(' ', '-')}">${a.Status || 'In Store'}</span></td>
                <td>${a.Make || '-'}</td>
                <td>${a.Model || '-'}</td>
                <td>${a.SrNo || '-'}</td>
                <td>${a.CurrentLocation || '-'}</td>
                <td>${a.AssignedTo || '-'}</td>
                <td>
                    <div style="font-weight: 600;">${a.warranty_months || 0} Mo.</div>
                    <div style="font-size: 10px; color: ${months < 0 ? '#dc3545' : '#28a745'}">
                        ${months < 0 ? 'Expired' : `${Math.round(months)} mo. left`}
                    </div>
                </td>
                <td>${a.ParentId || '-'}</td>
                <td>${a.IN || '0'}</td>
                <td>${a.OUT || '0'}</td>
                <td>${a.Balance || '0'}</td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <button class="edit-asset-btn" data-id="${a.ID}" style="background: #0078d4; color: white; border: none; border-radius: 3px; padding: 4px 8px; cursor: pointer; font-size: 12px;">Edit</button>
                    </div>
                </td>
                <td>
                    <img src="/api/qr/${encodeURIComponent(a.ID)}" style="width: 40px; height: 40px;">
                </td>
            `;
            body.appendChild(tr);
        });

        // Add edit handlers
        body.querySelectorAll('.edit-asset-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-id');
                const asset = assets.find(as => as.ID === id);
                if (asset && window.editAsset) {
                    window.editAsset(asset);
                }
            };
        });
    }
    
    modal.style.display = 'block';
}

function loadRanges() {
    const saved = localStorage.getItem('warranty_ranges');
    if (saved) {
        try {
            warrantyRanges = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse saved ranges', e);
            warrantyRanges = [...defaultRanges];
        }
    } else {
        warrantyRanges = [...defaultRanges];
    }
    // Ensure ranges are sorted by min
    warrantyRanges.sort((a, b) => a.min - b.min);
}

function saveRanges() {
    localStorage.setItem('warranty_ranges', JSON.stringify(warrantyRanges));
}

function resetRangeForm() {
    document.getElementById('rangeIndex').value = '-1';
    document.getElementById('rangeLabel').value = '';
    document.getElementById('rangeMinMonths').value = '';
    document.getElementById('rangeColor').value = '#006400';
    document.getElementById('rangeFormTitle').innerText = 'Add New Range';
    document.getElementById('btnSaveRange').innerText = 'Add Range';
}

function renderRangesTable() {
    const body = document.getElementById('warrantyRangesBody');
    if (!body) return;

    body.innerHTML = warrantyRanges.map((range, index) => `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px;"><div style="width: 20px; height: 20px; background: ${range.color}; border-radius: 50%; border: 1px solid #ccc;"></div></td>
            <td style="padding: 10px;">${range.label}</td>
            <td style="padding: 10px;">${range.min}</td>
            <td style="padding: 10px;">
                <button class="icon-button" onclick="window.editWarrantyRange(${index})" title="Edit">✏️</button>
                <button class="icon-button" onclick="window.deleteWarrantyRange(${index})" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

window.editWarrantyRange = (index) => {
    const range = warrantyRanges[index];
    document.getElementById('rangeIndex').value = index;
    document.getElementById('rangeLabel').value = range.label;
    document.getElementById('rangeMinMonths').value = range.min;
    document.getElementById('rangeColor').value = range.color;
    document.getElementById('rangeFormTitle').innerText = 'Edit Range';
    document.getElementById('btnSaveRange').innerText = 'Save Changes';
    document.getElementById('warrantyRangeModal').style.display = 'block';
};

window.deleteWarrantyRange = (index) => {
    if (confirm('Are you sure you want to delete this range?')) {
        warrantyRanges.splice(index, 1);
        saveRanges();
        renderRangesTable();
        updateWarrantyChart();
    }
};

function saveRange() {
    const index = parseInt(document.getElementById('rangeIndex').value);
    const range = {
        label: document.getElementById('rangeLabel').value,
        min: parseFloat(document.getElementById('rangeMinMonths').value),
        color: document.getElementById('rangeColor').value
    };

    if (index === -1) {
        warrantyRanges.push(range);
    } else {
        warrantyRanges[index] = range;
    }

    warrantyRanges.sort((a, b) => a.min - b.min);
    saveRanges();
    renderRangesTable();
    updateWarrantyChart();
    resetRangeForm();
}

function calculateMonthsRemaining(purchaseDate, warrantyMonths) {
    if (!purchaseDate || isNaN(parseInt(warrantyMonths))) return -999;
    
    const pDate = new Date(purchaseDate);
    const expiryDate = new Date(pDate);
    expiryDate.setMonth(pDate.getMonth() + parseInt(warrantyMonths));
    
    const now = new Date();
    const diffTime = expiryDate - now;
    const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30.44); // Average month length
    
    return diffMonths;
}

export function updateWarrantyChart() {
    console.log('updateWarrantyChart() called');
    
    // 1. Pie Chart
    const ctx = document.getElementById('warrantyPieChart')?.getContext('2d');
    const legendContainer = document.getElementById('warrantyLegend');
    
    if (ctx) {
        const category = localStorage.getItem('selectedAssetCategory') || 'IT';
        const assets = (window.allAssets || []).filter(a => a.Category === category);
        const counts = warrantyRanges.map(() => 0);

        assets.forEach(asset => {
            if (asset.isPlaceholder) return;
            const months = calculateMonthsRemaining(asset.PurchaseDate, asset.warranty_months);
            
            let matchIndex = -1;
            for (let i = warrantyRanges.length - 1; i >= 0; i--) {
                if (months >= warrantyRanges[i].min) {
                    matchIndex = i;
                    break;
                }
            }
            if (matchIndex !== -1) {
                counts[matchIndex]++;
            }
        });

        if (warrantyChart) {
            warrantyChart.destroy();
        }

        warrantyChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: warrantyRanges.map(r => r.label),
                datasets: [{
                    data: counts,
                    backgroundColor: warrantyRanges.map(r => r.color),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Asset Warranty Status' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        // 2. Custom Legend
        if (legendContainer) {
            const total = counts.reduce((a, b) => a + b, 0);
            legendContainer.innerHTML = warrantyRanges.map((range, i) => `
                <div class="warranty-legend-item" data-index="${i}" style="display: flex; align-items: center; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid ${range.color}; cursor: pointer; transition: background 0.2s;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 14px;">${range.label}</div>
                        <div style="font-size: 12px; color: #666;">Min: ${range.min} months</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: bold; font-size: 16px;">${counts[i]}</div>
                        <div style="font-size: 11px; color: #888;">${total > 0 ? Math.round((counts[i] / total) * 100) : 0}%</div>
                    </div>
                </div>
            `).reverse().join('');

            legendContainer.querySelectorAll('.warranty-legend-item').forEach(item => {
                item.onclick = () => {
                    const index = parseInt(item.getAttribute('data-index'));
                    const range = warrantyRanges[index];
                    if (range) {
                        const filtered = filterAssetsByRange(range);
                        showAssetsInModal(filtered, `Assets: ${range.label}`);
                    }
                };
                item.onmouseover = () => { item.style.background = '#eef2f7'; };
                item.onmouseout = () => { item.style.background = '#f8f9fa'; };
            });
        }
    } else {
        console.warn('warrantyPieChart context not found');
    }

    // 3. Detailed Summary Table (Independent of chart)
    updateWarrantySummaryTable();
}

export function updateWarrantySummaryTable() {
    console.log('WARRANTY: updateWarrantySummaryTable() called');
    const summaryBody = document.getElementById('warrantySummaryBody');
    if (!summaryBody) {
        console.error('WARRANTY ERROR: warrantySummaryBody element not found in DOM');
        return;
    }

    // 1. Immediate visual feedback
    summaryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #0078d4; font-weight: bold;">🔄 Processing warranty data...</td></tr>';

    // Ensure we have assets
    const assets = window.allAssets || [];
    console.log(`WARRANTY: Processing ${assets.length} assets`);

    if (assets.length === 0) {
        console.warn('WARRANTY: No assets found in window.allAssets');
        summaryBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #666;">' +
            'No assets loaded. Please ensure you are logged in and have assets.<br>' +
            '<button class="action-button blue" onclick="location.reload()" style="margin-top:10px; height:auto; padding:5px 15px;">Reload App</button>' +
            '</td></tr>';
        return;
    }

    try {
        if (!warrantyRanges || warrantyRanges.length === 0) {
            console.log('WARRANTY: No ranges found, loading defaults');
            loadRanges();
        }

        const category = localStorage.getItem('selectedAssetCategory') || 'IT';
        console.log(`WARRANTY: Filtering for category: ${category}`);

        const rangesWithAssets = warrantyRanges.map((range, index) => {
            const nextRange = warrantyRanges[index + 1];
            const maxMonths = nextRange ? nextRange.min : 9999;
            
            const rangeAssets = assets.filter(asset => {
                if (asset.isPlaceholder || asset.Category !== category) return false;
                const months = calculateMonthsRemaining(asset.PurchaseDate, asset.warranty_months);
                return months >= range.min && months < maxMonths;
            });

            return { range, rangeAssets };
        });

        const html = rangesWithAssets.reverse().map(({ range, rangeAssets }) => {
            const assetLinks = rangeAssets.slice(0, 5).map(a => 
                `<span style="display:inline-block; background:#e7f3ff; color:#0078d4; padding:2px 8px; border-radius:12px; font-size:11px; margin:2px; border: 1px solid #cce5ff;">${a.ID || a.Id || 'N/A'}</span>`
            ).join('');
            
            const moreText = rangeAssets.length > 5 ? `<span style="font-size:11px; color:#999; margin-left:5px;">+${rangeAssets.length - 5} more</span>` : '';

            return `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 12px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="width:12px; height:12px; border-radius:50%; background:${range.color}; border: 1px solid rgba(0,0,0,0.1);"></div>
                            <span style="font-weight:600; color: #333;">${range.label}</span>
                        </div>
                    </td>
                    <td style="padding: 12px; text-align: center; font-weight: bold; color: #0078d4;">${rangeAssets.length}</td>
                    <td style="padding: 12px;">
                        <div style="display:flex; flex-wrap:wrap; align-items:center;">
                            ${rangeAssets.length > 0 ? assetLinks + moreText : '<span style="color:#ccc; font-style:italic;">No items found</span>'}
                        </div>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <button class="action-button blue" onclick="window.viewWarrantyAssetsByLabel('${range.label}')" style="font-size: 11px; padding: 4px 12px; height: auto; line-height: 1;">View All</button>
                    </td>
                </tr>
            `;
        }).join('');

        summaryBody.innerHTML = html;
        console.log('WARRANTY: Table updated successfully');

    } catch (err) {
        console.error('WARRANTY ERROR in updateWarrantySummaryTable:', err);
        summaryBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: red;">Error processing warranty data: ${err.message}</td></tr>`;
    }
}

// Global helper to view assets by range label from the table
window.viewWarrantyAssetsByLabel = (label) => {
    const range = warrantyRanges.find(r => r.label === label);
    if (range) {
        const assets = filterAssetsByRange(range);
        showAssetsInModal(assets, `Assets: ${range.label}`);
    }
};

window.initWarrantyView = initWarrantyView;
window.updateWarrantyChart = updateWarrantyChart;
window.updateWarrantySummaryTable = updateWarrantySummaryTable;
