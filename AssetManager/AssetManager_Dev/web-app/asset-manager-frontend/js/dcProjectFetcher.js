// dcProjectFetcher.js

const API_PROJECT_SEARCH = '/api/projects/search';
const API_PROJECT_ORDERS = (id) => `/api/projects/${id}/orders`;

export function initDCProjectFetcher() {
    const searchInput = document.getElementById('dcProjectSearch');
    const resultsContainer = document.getElementById('dcProjectSearchResults');
    const consigneeSelect = document.getElementById('dcConsigneeSelect');

    if (!searchInput || !resultsContainer || !consigneeSelect) {
        console.warn('DC Project Fetcher: Elements not found');
        return;
    }

    let debounceTimer;
    let projectOrders = []; // Store fetched orders to reuse data

    // Handle Consignee Selection
    consigneeSelect.addEventListener('change', (e) => {
        const orderId = e.target.value;
        if (!orderId) {
            // Clear fields if no selection
            setVal('dcConsigneeName', '');
            setVal('dcConsigneeAddress', '');
            setVal('dcConsigneeGST', '');
            setVal('dcConsigneeState', '');
            setVal('dcConsigneeStateCode', '');
            return;
        }

        const order = projectOrders.find(o => String(o.ID) === String(orderId));
        if (order) {
            setVal('dcConsigneeName', order.ConsigneeName);
            setVal('dcConsigneeAddress', order.ConsigneeAddress);
            setVal('dcConsigneeGST', order.ConsigneeGSTIN);
            setVal('dcConsigneeState', order.ConsigneeState);
            setVal('dcConsigneeStateCode', order.ConsigneeStateCode);
            
            // Populate Buyer Order No and Date from the selected Order
            setVal('dcBuyerOrderNo', order.OrderNo);
            
            // If there's an Order Date, try to set it
            if (order.OrderDate) {
                // If there is a specific field for Order Date (often reused or specific like dcRefDate)
                // In dashboard.js logic we saw window.tempDCOrderDate being used
                if (window) window.tempDCOrderDate = order.OrderDate;
                
                // Also try to set visual fields if they exist
                setVal('dcRefDate', order.OrderDate); 
            }
        }
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);
        
        if (query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchProjects(query);
        }, 300);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    async function fetchProjects(query) {
        try {
            const token = localStorage.getItem('token');
            const headers = {};
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_PROJECT_SEARCH}?q=${encodeURIComponent(query)}`, { headers });
            const data = await response.json();

            if (data.success) {
                renderResults(data.projects);
            } else {
                console.error('Error fetching projects:', data.error);
            }
        } catch (err) {
            console.error('Error fetching projects:', err);
        }
    }

    function renderResults(projects) {
        resultsContainer.innerHTML = '';
        if (projects.length === 0) {
            resultsContainer.style.display = 'none';
            return;
        }

        projects.forEach(p => {
            const div = document.createElement('div');
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid #eee';
            div.style.fontSize = '13px';
            div.innerHTML = `<strong>${p.ProjectName}</strong> <span style="color:#666; font-size:11px;">(ID: ${p.ID})</span><br>
                             <span style="color:#888; font-size:11px;">Buyer: ${p.BuyerName || 'N/A'}</span>`;
            
            div.addEventListener('mouseenter', () => div.style.background = '#f0f0f0');
            div.addEventListener('mouseleave', () => div.style.background = 'white');
            
            div.onclick = () => {
                populateDCFromProject(p);
                resultsContainer.style.display = 'none';
                searchInput.value = ''; // Clear search after selection
            };
            
            resultsContainer.appendChild(div);
        });

        resultsContainer.style.display = 'block';
    }

    async function populateDCFromProject(project) {
        // Buyer Details (Auto-fill)
        setVal('dcBuyerName', project.BuyerName);
        setVal('dcBuyerAddress', project.BuyerAddress);
        setVal('dcBuyerGST', project.BuyerGSTIN);
        setVal('dcBuyerState', project.BuyerState);
        setVal('dcBuyerStateCode', project.BuyerStateCode);

        // References
        setVal('dcRefNo', project.ProjectName); 
        
        // Fetch Orders for Consignee Dropdown
        await fetchProjectOrders(project.ID);
        
        console.log(`Populated DC from Project: ${project.ProjectName} (${project.ID})`);
    }

    async function fetchProjectOrders(projectId) {
        try {
            const token = localStorage.getItem('token');
            const headers = {};
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(API_PROJECT_ORDERS(projectId), { headers });
            const data = await response.json();

            consigneeSelect.innerHTML = '<option value="">-- Select Consignee from Project Orders --</option>';
            
            if (data.success && data.orders.length > 0) {
                projectOrders = data.orders;
                data.orders.forEach(order => {
                    const opt = document.createElement('option');
                    opt.value = order.ID;
                    opt.textContent = `Order #${order.OrderNo || 'N/A'} - ${order.ConsigneeName || 'Unknown Consignee'}`;
                    consigneeSelect.appendChild(opt);
                });
                consigneeSelect.style.display = 'block';
                
                // If there's only one order, auto-select it for convenience
                if (data.orders.length === 1) {
                    consigneeSelect.value = data.orders[0].ID;
                    consigneeSelect.dispatchEvent(new Event('change'));
                }
            } else {
                consigneeSelect.style.display = 'none';
                console.log('No orders found for this project.');
            }
        } catch (err) {
            console.error('Error fetching project orders:', err);
            consigneeSelect.style.display = 'none';
        }
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) {
            el.value = val || '';
            el.dispatchEvent(new Event('input'));
            el.dispatchEvent(new Event('change'));
        }
    }
}

// White Labeling (Alias) Logic
let dcAssetAliases = {}; // ID -> { name, desc }

export function initDCAliasLogic() {
    console.log('[DC Alias] Initializing...');
    const assetInput = document.getElementById('dcAssetIds');
    const aliasModal = document.getElementById('dcAliasModal');
    const saveBtn = document.getElementById('btnSaveDcAlias');

    if (!assetInput || !aliasModal || !saveBtn) return;

    // Listen for changes to Asset IDs to show "Edit Alias" icons
    assetInput.addEventListener('change', renderAliasButtons);
    assetInput.addEventListener('input', renderAliasButtons);

    saveBtn.onclick = () => {
        const assetId = aliasModal.dataset.assetId;
        const name = document.getElementById('aliasCustomName').value;
        const desc = document.getElementById('aliasCustomDescription').value;
        
        if (name || desc) {
            dcAssetAliases[assetId] = { name, desc };
        } else {
            delete dcAssetAliases[assetId];
        }
        
        aliasModal.style.display = 'none';
        showToast(`Alias updated for ${assetId}`, 'success');
        
        // Update the payload if applicable
        if (window.updateDCPayload) window.updateDCPayload(dcAssetAliases);
    };
}

function renderAliasButtons() {
    const assetInput = document.getElementById('dcAssetIds');
    const container = document.getElementById('dcAliasButtonsContainer');
    if (!container) {
        const div = document.createElement('div');
        div.id = 'dcAliasButtonsContainer';
        div.style.marginTop = '10px';
        div.style.display = 'flex';
        div.style.flexWrap = 'wrap';
        div.style.gap = '8px';
        assetInput.parentNode.appendChild(div);
    }
    
    const ids = assetInput.value.split(/[\s,]+/).filter(id => id.length > 0);
    const containerRef = document.getElementById('dcAliasButtonsContainer');
    containerRef.innerHTML = '';
    
    ids.forEach(id => {
        const btn = document.createElement('button');
        const hasAlias = dcAssetAliases[id];
        btn.type = 'button';
        btn.innerHTML = `🏷️ Edit DC Label: ${id} ${hasAlias ? '✅' : ''}`;
        btn.style.padding = '4px 10px';
        btn.style.fontSize = '11px';
        btn.style.background = hasAlias ? '#f0fdf4' : '#f8fafc';
        btn.style.color = hasAlias ? '#166534' : '#475569';
        btn.style.border = `1px solid ${hasAlias ? '#bbf7d0' : '#e2e8f0'}`;
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        
        btn.onclick = () => {
            const aliasModal = document.getElementById('dcAliasModal');
            aliasModal.dataset.assetId = id;
            document.getElementById('aliasInternalName').value = id;
            document.getElementById('aliasCustomName').value = hasAlias ? hasAlias.name : '';
            document.getElementById('aliasCustomDescription').value = hasAlias ? hasAlias.desc : '';
            aliasModal.style.display = 'flex';
        };
        
        containerRef.appendChild(btn);
    });
}

// Expose aliases to global scope for the final DC generation
if (window) window.getDCAliases = () => dcAssetAliases;
