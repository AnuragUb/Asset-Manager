import { showView } from './utils.js?v=5.50';

console.log('[Projects] Module loading... (v5.50)');

let allProjects = [];
let currentProjectId = null;

// --- GLOBAL PO MANAGEMENT FUNCTIONS (TOP-LEVEL FOR RELIABLE ACCESS) ---

window.downloadPOExcel = async function(orderId) {
    try {
        console.log(`[PO] Initiating download for: ${orderId}`);
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const order = data.orders?.[0] || data.data?.[0] || data;
        
        if (!order || !order.ID) throw new Error('PO data not found');

        const header = [
            ['Purchase Order Details'],
            ['PO Number', order.PONumber || '-'],
            ['PO Date', order.PODate || '-'],
            ['Vendor', order.VendorName || '-'],
            ['Total Amount', order.TotalAmount || 0],
            ['Status', order.Status || 'Active'],
            [''],
            ['Line Items'],
            ['Sr No', 'Item Description', 'Due Date', 'Quantity', 'UOM', 'Unit Price', 'Total', 'Status']
        ];

        const rows = (order.items || []).map(i => [
            i.SrNo, i.ItemDescription, i.DueDate, i.QtyOrdered, i.UOM, i.UnitPrice, i.Total, i.Status
        ]);

        const worksheet = XLSX.utils.aoa_to_sheet([...header, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'PO_Details');
        
        XLSX.writeFile(workbook, `PO_${order.PONumber || order.ID}.xlsx`);
        showToast('PO downloaded successfully', 'success');
    } catch (err) {
        console.error('[PO Download] Error:', err);
        alert('Error downloading PO: ' + err.message);
    }
};

window.showPreviousPOFetcher = async function() {
    let modal = document.getElementById('previousPOFetcherModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'previousPOFetcherModal';
        modal.className = 'modal';
        modal.style.zIndex = '10005';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <span class="close-modal" onclick="document.getElementById('previousPOFetcherModal').style.display='none'">&times;</span>
            <h3>Search Previous POs</h3>
            <div style="margin-bottom: 15px;">
                <input type="text" id="poSearchInput" class="form-input" placeholder="Search PO Number, Vendor..." oninput="window.searchPreviousPOs(this.value)">
            </div>
            <div id="poSearchResults" style="max-height: 400px; overflow-y: auto;">
                <p style="text-align: center; color: #64748b;">Type at least 2 characters to search...</p>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    document.getElementById('poSearchInput').focus();
};

window.searchPreviousPOs = async function(query) {
    if (!query || query.length < 2) {
        document.getElementById('poSearchResults').innerHTML = '<p style="text-align: center; color: #64748b;">Type at least 2 characters to search...</p>';
        return;
    }
    const results = document.getElementById('poSearchResults');
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        console.log(`[PO Search] Fetching for: "${query}"`);
        const res = await fetch(`/api/orders?search=${encodeURIComponent(query)}`, { headers });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || `Server returned ${res.status}`);
        }

        const data = await res.json();
        const orders = data.orders || [];
        
        console.log(`[PO Search] Received ${orders.length} results`);

        if (orders.length === 0) {
            results.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: #64748b; margin-bottom: 10px;">No matching POs found for "${query}".</p>
                    <p style="font-size: 11px; color: #94a3b8;">Try searching by Vendor name or a partial PO number.</p>
                </div>
            `;
            return;
        }

        results.innerHTML = orders.map(o => `
            <div onclick="window.loadPOFromPrevious('${o.ID}')" style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s; background: #fff;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="font-weight: 600; color: #1e293b;">${o.PONumber || o.OrderNo || 'No Number'}</div>
                    <div style="font-size: 10px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #475569;">${o.Status || 'Active'}</div>
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                    <div><strong>Vendor:</strong> ${o.VendorName || 'N/A'}</div>
                    <div><strong>Consignee:</strong> ${o.ConsigneeName || 'N/A'}</div>
                    <div style="display: flex; justify-content: space-between; margin-top: 4px; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
                        <span><strong>Date:</strong> ${o.PODate || o.OrderDate || 'N/A'}</span>
                        <span style="color: #2563eb; font-weight: 600;">₹${(o.TotalAmount || 0).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('[PO Search] Error:', err);
        results.innerHTML = `<p style="text-align: center; color: #ef4444; padding: 10px;">Error searching POs: ${err.message}</p>`;
    }
};

window.loadPOFromPrevious = async function(orderId) {
    try {
        console.log(`[PO Fetch] Loading details for: ${orderId}`);
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`/api/orders/${orderId}`, { headers });
        if (!res.ok) throw new Error(`Failed to fetch PO details (${res.status})`);
        
        const data = await res.json();
        // Handle variations in response structure
        const order = data.orders?.[0] || data.data?.[0] || (data.PONumber ? data : null);
        
        if (!order) {
            console.error('[PO Fetch] Data structure mismatch:', data);
            throw new Error('PO data not found in response');
        }

        console.log('[PO Fetch] Populating fields for:', order.PONumber);

        // 1. Ensure the PO Modal is initialized and visible
        if (!document.getElementById('newPOVendor')) {
            console.log('[PO Fetch] Initializing PO Modal content...');
            // Use currentProjectId and current project data
            window.showAddOrderModal(currentProjectId, window.currentProjectData || {});
        } else {
            // If it exists but is hidden, show it
            const poModal = document.getElementById('addOrderModal');
            if (poModal) poModal.style.display = 'flex';
        }

        // 2. Populate Header Fields (excluding PO Number/Date to avoid duplicates)
        const fields = {
            'newPOVendor': order.VendorName,
            'poConsigneeName': order.ConsigneeName,
            'poConsigneeAddress': order.ConsigneeAddress,
            'poConsigneeGSTIN': order.ConsigneeGSTIN,
            'poConsigneeState': order.ConsigneeState,
            'poConsigneeStateCode': order.ConsigneeStateCode,
            'poBuyerName': order.BuyerName,
            'poBuyerAddress': order.BuyerAddress,
            'poBuyerGSTIN': order.BuyerGSTIN,
            'poBuyerState': order.BuyerState,
            'poBuyerStateCode': order.BuyerStateCode
        };

        let populatedCount = 0;
        for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val || '';
                // Trigger events so any listeners (like auto-save or validation) catch the change
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                populatedCount++;
            } else {
                console.warn(`[PO Fetch] Field not found: ${id}`);
            }
        }

        // 3. Populate Line Items
        const tbody = document.getElementById('poItemsBody');
        if (tbody) {
            tbody.innerHTML = '';
            const items = order.items || [];
            console.log(`[PO Fetch] Adding ${items.length} line items`);
            
            if (items.length > 0) {
                items.forEach(item => {
                    // We call the global addPOLineItem function
                    if (typeof window.addPOLineItem === 'function') {
                        // Create a clean copy without existing database IDs to ensure they are treated as NEW items for this project
                        const newItem = { ...item };
                        delete newItem.ID; 
                        delete newItem.OrderID;
                        window.addPOLineItem(newItem);
                    }
                });
            }
        } else {
            console.error('[PO Fetch] Table body "poItemsBody" not found');
        }

        // 4. Close search modal
        const searchModal = document.getElementById('previousPOFetcherModal');
        if (searchModal) searchModal.style.display = 'none';
        
        showToast(`Imported ${populatedCount} fields and ${order.items?.length || 0} items`, 'success');
    } catch (err) {
        console.error('[PO Fetch] Error:', err);
        alert('Error loading PO details: ' + err.message);
    }
};

window.deleteProject = async function(projectId) {
    if (!confirm(`Are you sure you want to delete this project? \n\nThis will mark the project as deleted and hide it from the system. It will be PERMANENTLY removed from the database after 30 days.`)) return;

    try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
            method: 'DELETE',
            headers: headers
        });

        if (response.ok) {
            showToast('Project marked for deletion', 'success');
            // Close modal if open
            const modal = document.getElementById('projectDetailsModal');
            if (modal) modal.style.display = 'none';
            // Refresh list
            loadProjects();
        } else {
            const data = await response.json();
            alert('Failed to delete project: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Delete project error:', err);
        alert('Error deleting project');
    }
};

export function initProjectsView() {
    console.log('[Projects] Initializing Projects View...');
    
    // Setup Create Project Button Handler
    const btnSubmit = document.getElementById('btnSideSubmitProject');
    if (btnSubmit) {
        btnSubmit.addEventListener('click', handleCreateProject);
    }

    // Setup "Same as Buyer" checkbox
    const chkSame = document.getElementById('chkSameAsBuyer');
    if (chkSame) {
        chkSame.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.getElementById('sideConsigneeName').value = document.getElementById('sideBuyerName').value;
                document.getElementById('sideConsigneeAddress').value = document.getElementById('sideBuyerAddress').value;
                document.getElementById('sideConsigneeGSTIN').value = document.getElementById('sideBuyerGSTIN').value;
                document.getElementById('sideConsigneeState').value = document.getElementById('sideBuyerState').value;
                document.getElementById('sideConsigneeStateCode').value = document.getElementById('sideBuyerStateCode').value;
            }
        });
    }

    // Setup Search Handler
    const searchInput = document.getElementById('projectSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allProjects.filter(p => 
                (p.Name && p.Name.toLowerCase().includes(term)) ||
                (p.ClientName && p.ClientName.toLowerCase().includes(term)) ||
                (p.Location && p.Location.toLowerCase().includes(term))
            );
            renderProjectsKanban(filtered);
        });
    }

    // Add Refresh Button if not exists
    const actionsDiv = document.querySelector('#projects-view .view-actions > div');
    if (actionsDiv && !document.getElementById('btnRefreshProjects')) {
        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'btnRefreshProjects';
        refreshBtn.className = 'action-button';
        refreshBtn.style.background = '#64748b';
        refreshBtn.innerHTML = '🔄';
        refreshBtn.title = 'Refresh Projects';
        refreshBtn.onclick = loadProjects;
        actionsDiv.insertBefore(refreshBtn, actionsDiv.firstChild);
    }

    loadProjects();
}

async function loadProjects() {
    console.log('[Projects] Loading projects...');
    const grid = document.getElementById('projectsGrid');
    if (grid) {
        grid.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #64748b; flex-direction: column; gap: 10px;">
                <div class="spinner" style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite;"></div>
                <div>Loading projects...</div>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
    }

    try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('Failed to load projects');
        const rawProjects = await res.json();
        
        // Normalize field names (Backend uses ProjectName, Frontend uses Name)
        allProjects = rawProjects.map(p => ({
            ...p,
            Name: p.Name || p.ProjectName || 'Untitled Project',
            ClientName: p.ClientName || p.client || 'Unknown Client',
            Status: p.Status || 'Active'
        }));

        console.log('[Projects] Loaded:', allProjects.length);
        if (allProjects.length > 0) {
            console.log('[Projects] Sample Data:', allProjects[0]);
        }

        const countEl = document.getElementById('projectCount');
        if (countEl) countEl.textContent = `${allProjects.length} Projects`;
        
        renderProjectsKanban(allProjects);
    } catch (err) {
        console.error(err);
        const grid = document.getElementById('projectsGrid');
        if (grid) grid.innerHTML = `
            <div style="text-align:center; color: #ef4444;">
                <p>Failed to load projects</p>
                <button onclick="loadProjects()" style="padding: 6px 12px; cursor: pointer;">Retry</button>
            </div>
        `;
    }
}

function renderProjectsKanban(projects) {
    console.log('[Projects] Rendering Kanban for', projects.length, 'projects');
    const grid = document.getElementById('projectsGrid');
    if (!grid) {
        console.error('[Projects] Grid element not found!');
        return;
    }

    // DEBUG: Force visibility
    grid.style.border = '2px solid transparent'; 
    grid.style.display = 'block';

    if (projects.length === 0) {
        grid.innerHTML = `
            <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: #94a3b8;">
                <div style="font-size: 48px; margin-bottom: 10px;">📋</div>
                <div style="font-size: 16px; font-weight: 500;">No projects found</div>
                <div style="font-size: 13px; margin-bottom: 15px;">Create a new project or adjust your filters.</div>
                <button onclick="loadProjects()" class="action-button small" style="background: #64748b;">🔄 Refresh</button>
            </div>
        `;
        return;
    }

    const statuses = ['Planning', 'Active', 'On Hold', 'Completed'];
    
    // Check if we have matching statuses
    statuses.forEach(s => {
        const count = projects.filter(p => p.Status === s).length;
        console.log(`[Projects] Status ${s}: ${count}`);
    });

    grid.style.display = 'flex';
    grid.style.gap = '20px';
    grid.style.overflowX = 'auto';
    grid.style.paddingBottom = '20px';
    grid.style.height = '100%';
    grid.style.alignItems = 'flex-start';
    grid.style.minHeight = '400px';

    grid.innerHTML = statuses.map(status => {
                const statusProjects = projects.filter(p => p.Status === status);
                return `
                <div class="project-column" style="flex: 1; min-width: 300px; max-width: 400px; background: #f8fafc; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; height: 100%; max-height: 100%; border: 1px solid #e2e8f0; scroll-snap-align: start; flex-shrink: 0;">
                    <div style="font-weight: 600; color: #475569; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${getStatusColor(status)};"></span>
                            ${status}
                        </span>
                        <span style="background: #e2e8f0; padding: 2px 8px; border-radius: 12px; font-size: 12px; color: #64748b;">${statusProjects.length}</span>
                    </div>
                    <div class="kanban-column" 
                         ondragover="projectsAllowDrop(event)" 
                         ondragleave="projectsDragLeave(event)" 
                         ondrop="projectsDropProject(event, '${status}')"
                         style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; min-height: 50px;">
                        ${statusProjects.length > 0 ? statusProjects.map(p => `
                            <div class="project-card" draggable="true" ondragstart="projectsDragProject(event, '${p.ID}')" onclick="window.showProjectDetails('${p.ID}')" style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); cursor: grab; border: 1px solid #e2e8f0; transition: all 0.2s;">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                    <div style="font-weight: 600; color: #0f172a; font-size: 15px; flex: 1;">${p.Name}</div>
                                    <div style="display: flex; gap: 6px; align-items: center;">
                                        ${p.Priority ? `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${p.Priority === 'High' ? '#fee2e2' : '#f1f5f9'}; color: ${p.Priority === 'High' ? '#ef4444' : '#64748b'};">${p.Priority}</span>` : ''}
                                        <button onclick="event.stopPropagation(); window.deleteProject('${p.ID}')" title="Delete Project" style="background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.6; padding: 0;">🗑️</button>
                                    </div>
                                </div>
                                <div style="font-size: 13px; color: #64748b; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                                    ${p.ClientName}
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 8px;">
                                    <span style="display: flex; align-items: center; gap: 4px;">
                                        📍 ${p.Location || 'N/A'}
                                    </span>
                                    <span>${p.StartDate ? new Date(p.StartDate).toLocaleDateString() : ''}</span>
                                </div>
                            </div>
                        `).join('') : `
                            <div style="border: 2px dashed #e2e8f0; border-radius: 8px; padding: 20px; text-align: center; color: #94a3b8; font-size: 13px;">
                                No projects
                            </div>
                        `}
                    </div>
                </div>
            `}).join('');
}

function getStatusColor(status) {
    switch(status) {
        case 'Planning': return '#3b82f6';
        case 'Active': return '#22c55e';
        case 'On Hold': return '#f59e0b';
        case 'Completed': return '#64748b';
        default: return '#cbd5e1';
    }
}

window.projectsDragProject = function (ev, projectId) {
    try {
        ev.dataTransfer.setData('text/projectId', projectId);
    } catch (e) {
        console.error('[Projects] Failed to start drag:', e);
    }
};

window.projectsAllowDrop = function (ev) {
    ev.preventDefault();
    const target = ev.currentTarget;
    if (target && target.classList.contains('kanban-column')) {
        target.style.borderColor = '#bfdbfe';
        target.style.backgroundColor = '#eff6ff';
    }
};

window.projectsDragLeave = function (ev) {
    const target = ev.currentTarget;
    if (target && target.classList.contains('kanban-column')) {
        target.style.borderColor = '#e2e8f0';
        target.style.backgroundColor = 'transparent';
    }
};

window.projectsDropProject = async function (ev, newStatus) {
    ev.preventDefault();
    const target = ev.currentTarget;
    if (target && target.classList.contains('kanban-column')) {
        target.style.borderColor = '#e2e8f0';
        target.style.backgroundColor = 'transparent';
    }

    let projectId = '';
    try {
        projectId = ev.dataTransfer.getData('text/projectId');
    } catch (e) {
        console.error('[Projects] Failed to read dragged project ID:', e);
        return;
    }

    if (!projectId) return;

    try {
        if (typeof window.updateProjectStatus === 'function') {
            await window.updateProjectStatus(projectId, newStatus);
        } else {
            const res = await fetch(`/api/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            if (!res.ok) {
                throw new Error(`Failed to update project status (${res.status})`);
            }
        }
        await loadProjects();
    } catch (err) {
        console.error('[Projects] Failed to update status via Kanban drag:', err);
        alert('Error updating project status. Please try again.');
    }
};

async function showProjectDetails(id) {
    console.log('[Projects] showing details for:', id);
    currentProjectId = id;
    let project = allProjects.find(p => p.ID === id);
    
    if (!project) {
        try {
            const res = await fetch(`/api/projects/${id}`);
            if (!res.ok) throw new Error('Project not found');
            project = await res.json();
        } catch (err) {
            console.error(err);
            alert('Error loading project details');
            return;
        }
    }

    const modal = document.getElementById('projectDetailsModal');
    if (!modal) return;

    const titleEl = document.getElementById('modalProjectTitle');
    if (titleEl) titleEl.textContent = project.Name || project.ProjectName || 'Project Details';
    
    const clientInfo = document.getElementById('projectClientInfo');
    if (clientInfo) {
        clientInfo.innerHTML = `
            <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Client</div>
            <div style="font-weight: 600; font-size: 16px; color: #0f172a;">${project.ClientName || 'N/A'}</div>
            <div style="font-size: 13px; color: #334155; margin-top: 8px;">
                ${project.Description || 'No description provided.'}
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed #e2e8f0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: #475569;">Billing & Shipping</div>
                    <button id="btnEditBilling" class="action-button small" style="padding:2px 8px; font-size:10px; background: #f1f5f9; color: #0078d4; border: 1px solid #0078d4; cursor: pointer;">Edit Details</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">Buyer</div>
                        <div style="font-size: 12px; font-weight: 500;">${project.BuyerName || 'N/A'}</div>
                        <div style="font-size: 11px; color: #64748b; line-height: 1.4;">${project.BuyerAddress || ''}</div>
                        ${project.BuyerGSTIN ? `<div style="font-size: 11px; color: #64748b;">GST: ${project.BuyerGSTIN}</div>` : ''}
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">Consignee</div>
                        <div style="font-size: 12px; font-weight: 500;">${project.ConsigneeName || 'N/A'}</div>
                        <div style="font-size: 11px; color: #64748b; line-height: 1.4;">${project.ConsigneeAddress || ''}</div>
                        ${project.ConsigneeGSTIN ? `<div style="font-size: 11px; color: #64748b;">GST: ${project.ConsigneeGSTIN}</div>` : ''}
                    </div>
                </div>
            </div>
        `;

        const btnEditBilling = document.getElementById('btnEditBilling');
        if (btnEditBilling) {
            btnEditBilling.onclick = () => showEditBillingModal(project);
        }
    }

    const stats = document.getElementById('projectStats');
    if (stats) {
        const safeLocation = project.Location || '';
        const locationDisplay = safeLocation || 'N/A';
        stats.innerHTML = `
            <div>
                <div style="font-size: 11px; color: #64748b;">Location</div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span id="projectLocationValue" style="font-weight: 500;">${locationDisplay}</span>
                    <button id="btnEditProjectLocation" class="action-button small" style="padding:2px 8px; font-size:10px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; cursor: pointer;">Edit</button>
                </div>
            </div>
            <div>
                <div style="font-size: 11px; color: #64748b;">Status</div>
                <div style="font-weight: 500;">${project.Status || 'Active'}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: #64748b;">Currency</div>
                <div style="font-weight: 500;">${project.Currency || 'INR'}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: #64748b;">Date</div>
                <div style="font-weight: 500;">${project.StartDate ? project.StartDate.split('T')[0] : 'N/A'}</div>
            </div>
            <div style="grid-column: span 2; margin-top: 10px; text-align: center; border-top: 1px solid #eee; padding-top: 10px;">
                <img src="/api/qr/dynamic/project/${encodeURIComponent(project.ID)}" style="width: 120px; height: 120px; object-fit: contain;" alt="Project QR" onerror="this.style.display='none'">
                <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Project QR Code (Dynamic)</div>
                <div style="font-size: 13px; font-weight: 600; color: #334155; margin-top: 4px; letter-spacing: 0.5px; border: 1px dashed #cbd5e1; display: inline-block; padding: 2px 8px; border-radius: 4px; background: #f8fafc;">${project.ID}</div>
            </div>
        `;

        const editBtn = document.getElementById('btnEditProjectLocation');
        if (editBtn) {
            editBtn.onclick = async () => {
                const currentText = safeLocation || '';
                const newLocation = prompt('Update project location', currentText);
                if (newLocation === null) return;
                const trimmed = newLocation.trim();
                if (!trimmed) {
                    alert('Location cannot be empty');
                    return;
                }
                try {
                    const response = await fetch(`/api/projects/${encodeURIComponent(project.ID)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ Location: trimmed })
                    });
                    if (!response.ok) {
                        const errorBody = await response.json().catch(() => ({}));
                        throw new Error(errorBody.error || `Failed to update location (${response.status})`);
                    }
                    project.Location = trimmed;
                    const valueEl = document.getElementById('projectLocationValue');
                    if (valueEl) valueEl.textContent = trimmed;
                    if (typeof showToast === 'function') {
                        showToast('Project location updated', 'success');
                    }
                    loadProjects();
                } catch (err) {
                    console.error('Failed to update project location:', err);
                    alert('Error updating location: ' + err.message);
                }
            };
        }
    }

    // Set current project for orders
    window.currentProjectForOrders = project.ID;
    window.currentProjectData = project;

    const btnAddOrder = document.getElementById('btnAddProjectOrder');
    if (btnAddOrder) {
        btnAddOrder.onclick = () => showAddOrderModal(project.ID, project);
    }
    
    // Reset tabs - always start with assets tab unless specified otherwise
    if (typeof switchProjectTab === 'function') switchProjectTab('assets');

    modal.style.display = 'flex';
    loadProjectAssets(id);
}

async function unassignAssetFromProject(projectId, assetId) {
    if (!confirm(`Are you sure you want to unassign ${assetId} from this project?`)) return;

    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/unassign-asset/${encodeURIComponent(assetId)}`, {
            method: 'DELETE',
            headers: headers
        });

        if (res.ok) {
            showToast('Asset unassigned successfully', 'success');
            loadProjectAssets(projectId);
            if (window.loadAssets) window.loadAssets();
        } else {
            const err = await res.json();
            alert('Failed to unassign: ' + (err.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Unassign error:', err);
        alert('Error unassigning asset');
    }
}
window.unassignAssetFromProject = unassignAssetFromProject;

async function loadProjectAssets(projectId) {
    const tbody = document.getElementById('projectAssetsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading assets...</td></tr>';

    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`);
        if (!res.ok) throw new Error('Failed to load assets');
        const assets = await res.json();

        if (assets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #94a3b8;">No assets assigned to this project</td></tr>';
            return;
        }

        tbody.innerHTML = assets.map(a => `
            <tr>
                <td>${a.ID}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>${a.Icon || '📦'}</span>
                        <span>${a.ItemName}</span>
                    </div>
                </td>
                <td><span style="padding: 2px 8px; border-radius: 10px; font-size: 12px; background: #f1f5f9; color: #475569;">${a.Status}</span></td>
                <td>${a.Category || '-'}</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="action-button small" onclick="event.preventDefault(); window.showAssetDetails('${a.ID}'); window.location.hash = 'asset-details?id=${a.ID}';" style="padding:4px 8px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; cursor: pointer; border-radius: 4px;">View</button>
                        <button class="action-button small" onclick="unassignAssetFromProject('${projectId}', '${a.ID}')" style="padding:4px 8px; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; cursor: pointer; border-radius: 4px;">Unassign</button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: red;">Error: ${err.message}</td></tr>`;
    }
}
// Expose to window for HTML onclick handlers
window.showAddTempAssetModal = showAddTempAssetModal;

async function showEditBillingModal(project) {
    let modal = document.getElementById('editBillingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'editBillingModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.style.zIndex = '10001';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <span class="close-modal" onclick="document.getElementById('editBillingModal').style.display='none'">&times;</span>
                <h3>Edit Billing & Shipping Details</h3>
                
                <div style="margin-top: 15px;">
                    <h4 style="margin-bottom: 10px; color: #0078d4;">Billing Details (Buyer)</h4>
                    <div class="form-group">
                        <input type="text" id="editBuyerName" placeholder="Buyer Name" class="form-input" style="margin-bottom: 5px;">
                        <textarea id="editBuyerAddress" placeholder="Buyer Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px;">
                            <input type="text" id="editBuyerGSTIN" placeholder="GSTIN" class="form-input">
                            <input type="text" id="editBuyerState" placeholder="State" class="form-input">
                            <input type="text" id="editBuyerStateCode" placeholder="Code" class="form-input">
                        </div>
                    </div>

                    <h4 style="margin: 15px 0 10px 0; color: #0078d4; display: flex; justify-content: space-between; align-items: center;">
                        Shipping Details (Consignee)
                    </h4>
                    <div class="form-group">
                        <input type="text" id="editConsigneeName" placeholder="Consignee Name" class="form-input" style="margin-bottom: 5px;">
                        <textarea id="editConsigneeAddress" placeholder="Consignee Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px;">
                            <input type="text" id="editConsigneeGSTIN" placeholder="GSTIN" class="form-input">
                            <input type="text" id="editConsigneeState" placeholder="State" class="form-input">
                            <input type="text" id="editConsigneeStateCode" placeholder="Code" class="form-input">
                        </div>
                    </div>

                    <h4 style="margin: 15px 0 10px 0; color: #0078d4;">Project Contacts</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="form-group">
                            <label style="font-size: 11px;">Owner Email</label>
                            <input type="email" id="editOwnerEmail" placeholder="owner@client.com" class="form-input">
                        </div>
                        <div class="form-group">
                            <label style="font-size: 11px;">Coordinator Email</label>
                            <input type="email" id="editCoordinatorEmail" placeholder="coord@client.com" class="form-input">
                        </div>
                    </div>
                </div>

                <div class="modal-actions" style="margin-top: 20px;">
                    <button id="btnSaveBillingDetails" class="action-button blue">Save Details</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Populate fields
    document.getElementById('editBuyerName').value = project.BuyerName || '';
    document.getElementById('editBuyerAddress').value = project.BuyerAddress || '';
    document.getElementById('editBuyerGSTIN').value = project.BuyerGSTIN || '';
    document.getElementById('editBuyerState').value = project.BuyerState || '';
    document.getElementById('editBuyerStateCode').value = project.BuyerStateCode || '';
    
    document.getElementById('editConsigneeName').value = project.ConsigneeName || '';
    document.getElementById('editConsigneeAddress').value = project.ConsigneeAddress || '';
    document.getElementById('editConsigneeGSTIN').value = project.ConsigneeGSTIN || '';
    document.getElementById('editConsigneeState').value = project.ConsigneeState || '';
    document.getElementById('editConsigneeStateCode').value = project.ConsigneeStateCode || '';
    
    document.getElementById('editOwnerEmail').value = project.OwnerEmail || '';
    document.getElementById('editCoordinatorEmail').value = project.CoordinatorEmail || '';

    // Save Handler
    document.getElementById('btnSaveBillingDetails').onclick = async () => {
        const updates = {
            BuyerName: document.getElementById('editBuyerName').value,
            BuyerAddress: document.getElementById('editBuyerAddress').value,
            BuyerGSTIN: document.getElementById('editBuyerGSTIN').value,
            BuyerState: document.getElementById('editBuyerState').value,
            BuyerStateCode: document.getElementById('editBuyerStateCode').value,
            ConsigneeName: document.getElementById('editConsigneeName').value,
            ConsigneeAddress: document.getElementById('editConsigneeAddress').value,
            ConsigneeGSTIN: document.getElementById('editConsigneeGSTIN').value,
            ConsigneeState: document.getElementById('editConsigneeState').value,
            ConsigneeStateCode: document.getElementById('editConsigneeStateCode').value,
            OwnerEmail: document.getElementById('editOwnerEmail').value,
            CoordinatorEmail: document.getElementById('editCoordinatorEmail').value
        };

        try {
            const res = await fetch(`/api/projects/${encodeURIComponent(project.ID)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!res.ok) throw new Error('Failed to update details');
            
            showToast('Billing details updated', 'success');
            modal.style.display = 'none';
            
            // Refresh details view
            Object.assign(project, updates);
            showProjectDetails(project.ID);
            loadProjects();
        } catch (err) {
            alert('Error updating details: ' + err.message);
        }
    };

    modal.style.display = 'flex';
}

async function handleCreateProject(e) {
    if (e) e.preventDefault();
    console.log('[Projects] handleCreateProject triggered by:', e ? e.target : 'unknown');
    
    ['sideProjectName', 'sideProjectLocation'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });

    // Helper to safely get value
    const getValue = (id) => {
        const el = document.getElementById(id);
        const val = el ? el.value : '';
        console.log(`[Projects] getValue('${id}'):`, val, el ? '(found)' : '(not found)');
        return val;
    };

    const data = {
        ProjectName: getValue('sideProjectName'),
        ClientName: getValue('sideProjectClient'),
        Location: getValue('sideProjectLocation'),
        Status: getValue('sideProjectStatus') || 'Planning',
        Currency: getValue('sideProjectCurrency'),
        Description: getValue('sideProjectDesc'),
        StartDate: getValue('sideProjectStartDate'),
        EndDate: getValue('sideProjectEndDate'),
        BuyerName: getValue('sideBuyerName'),
        BuyerAddress: getValue('sideBuyerAddress'),
        BuyerGSTIN: getValue('sideBuyerGSTIN'),
        BuyerState: getValue('sideBuyerState'),
        BuyerStateCode: getValue('sideBuyerStateCode'),
        ConsigneeName: getValue('sideConsigneeName'),
        ConsigneeAddress: getValue('sideConsigneeAddress'),
        ConsigneeGSTIN: getValue('sideConsigneeGSTIN'),
        ConsigneeState: getValue('sideConsigneeState'),
        ConsigneeStateCode: getValue('sideConsigneeStateCode'),
        OwnerEmail: getValue('sideOwnerEmail'),
        CoordinatorEmail: getValue('sideCoordinatorEmail')
    };

    // If critical fields are missing, show inline validation instead of alert
    if (!data.ProjectName || !data.Location) {
        const nameEl = document.getElementById('sideProjectName');
        const locEl = document.getElementById('sideProjectLocation');
        if (nameEl) nameEl.classList.add('input-error');
        if (locEl) locEl.classList.add('input-error');
        return;
    }

    const btn = document.getElementById('btnSideSubmitProject');
    const originalText = btn.textContent;
    btn.textContent = 'Creating...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to create project');
        }

        // Success
        document.getElementById('createProjectModal').style.display = 'none';
        loadProjects(); // Reload
        
        // Clear form
        document.getElementById('sideProjectName').value = '';
        const clientInput = document.getElementById('sideProjectClient');
        if (clientInput) clientInput.value = '';
        document.getElementById('sideProjectLocation').value = 'MUMBAI';
        document.getElementById('sideProjectDesc').value = '';
        document.getElementById('sideProjectStartDate').value = '';
        document.getElementById('sideProjectEndDate').value = '';
        ['sideBuyerName', 'sideBuyerAddress', 'sideBuyerGSTIN', 'sideBuyerState', 'sideBuyerStateCode', 
         'sideConsigneeName', 'sideConsigneeAddress', 'sideConsigneeGSTIN', 'sideConsigneeState', 'sideConsigneeStateCode',
         'sideOwnerEmail', 'sideCoordinatorEmail'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const chkSame = document.getElementById('chkSameAsBuyer');
        if (chkSame) chkSame.checked = false;
    } catch (err) {
        console.error(err);
        alert('Error creating project: ' + err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function switchProjectTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.project-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // Show selected
    if (tabName === 'assets') {
        const el = document.getElementById('projectAssetsTab');
        if (el) el.style.display = 'block';
    } else if (tabName === 'temp') {
        const el = document.getElementById('projectTempTab') || document.getElementById('projectTempAssetsTab'); 
        if (el) el.style.display = 'block';
    } else if (tabName === 'bom') {
        const el = document.getElementById('projectBomTab');
        if (el) el.style.display = 'block';
    } else if (tabName === 'orders') {
        const el = document.getElementById('projectOrdersTab');
        if (el) {
            el.style.display = 'block';
            if (window.currentProjectForOrders) {
                loadProjectOrders(window.currentProjectForOrders);
            }
        }
    } else if (tabName === 'workspace') {
        const el = document.getElementById('projectWorkspaceTab');
        if (el) {
            el.style.display = 'block';
            initProjectWorkspace(currentProjectId);
            // Ensure inventory is fresh
            loadWorkspaceInventory();
        }
    }

    // Activate button (robust way)
    const btn = document.querySelector(`button[onclick="switchProjectTab('${tabName}')"]`);
    if (btn) btn.classList.add('active');
}

async function loadProjectOrders(projectId) {
    const tbody = document.getElementById('projectOrdersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">Loading POs...</td></tr>';
    
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders`, { headers });
        if (!res.ok) throw new Error('Failed to fetch POs');
        const responseData = await res.json();
        
        // QA Resilience: Handle both plain array and {success, orders} object
        const orders = Array.isArray(responseData) ? responseData : (responseData.orders || responseData.data || []);
        
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">No Purchase Orders found. Create one to get started.</td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(order => {
            const poNum = order.PONumber || order.OrderNo || '-';
            const poDate = order.PODate || order.OrderDate || '-';
            return `
                <tr>
                    <td><strong>${poNum}</strong></td>
                    <td>${poDate}</td>
                    <td>${order.VendorName || '-'}</td>
                    <td>${(order.TotalAmount || 0).toLocaleString()}</td>
                    <td><span class="status-badge" style="background:${order.Status==='Active'?'#e6fffa':'#f7fafc'}; color:${order.Status==='Active'?'#2c7a7b':'#4a5568'};">${order.Status}</span></td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-button small blue" onclick="window.showEditOrderModal('${projectId}', '${order.ID}')">Edit</button>
                            <button class="action-button small" onclick="window.downloadPOExcel('${order.ID}')" style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;">Download</button>
                            <button class="action-button small" onclick="window.viewDCsForOrder('${poNum}')" style="background: #eff6ff; color: #2563eb; border: 1px solid #dbeafe;">View DCs</button>
                            <button class="action-button small green" onclick="window.createDCFromPO('${projectId}', '${order.ID}')">Create DC</button>
                            <button class="action-button small red" onclick="deleteProjectOrder('${projectId}', '${order.ID}')">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Error loading POs: ${err.message}</td></tr>`;
    }
}

window.showEditOrderModal = async function(projectId, orderId) {
    try {
        console.log(`[PO] Edit requested for PO: ${orderId} in Project: ${projectId}`);
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!res.ok) {
            const errText = await res.text();
            console.error(`[PO] Fetch failed: ${res.status} ${errText}`);
            throw new Error(`Failed to fetch PO details (${res.status})`);
        }
        const order = await res.json();
        window.showAddOrderModal(projectId, { ...window.currentProjectData, existingOrder: order });
    } catch (err) {
        alert('Error: ' + err.message);
    }
};

window.deleteProjectOrder = async function(projectId, orderId) {
    if (!confirm('Are you sure you want to delete this PO and all its line items?')) return;
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders/${orderId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        showToast('PO deleted', 'success');
        loadProjectOrders(projectId);
    } catch (err) {
        alert('Error deleting PO: ' + err.message);
    }
};

window.viewDCsForOrder = async function(poNumber) {
    try {
        console.log(`[PO] Fetching DCs for PO: ${poNumber}`);
        const res = await fetch(`/api/dc?search=${encodeURIComponent(poNumber)}`);
        if (!res.ok) throw new Error('Failed to fetch DCs');
        const result = await res.json();
        const dcs = Array.isArray(result) ? result : (result.data || []);

        let modal = document.getElementById('poDCsListModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'poDCsListModal';
            modal.className = 'modal';
            modal.style.zIndex = '10005';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <span class="close-modal" onclick="document.getElementById('poDCsListModal').style.display='none'">&times;</span>
                <h3>DCs generated for PO: ${poNumber}</h3>
                <div style="margin-top: 20px; overflow-x: auto;">
                    <table class="data-table" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>Challan No</th>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dcs.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding:20px;">No DCs found for this PO reference.</td></tr>' : 
                                dcs.map(dc => `
                                    <tr>
                                        <td><strong>${dc.ChallanNo}</strong></td>
                                        <td>${dc.DeliveryDate}</td>
                                        <td>${dc.CustomerName}</td>
                                        <td><span class="status-badge">${dc.Status}</span></td>
                                        <td>
                                            <button onclick="window.showDCPreviewById('${dc.ID}')" 
                                                    style="background: #2563eb !important; color: #ffffff !important; border: none !important; padding: 6px 12px !important; border-radius: 4px !important; cursor: pointer !important; font-size: 11px !important; font-weight: 600 !important; display: inline-block !important; width: auto !important; min-width: 80px !important;">
                                                View DC
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    } catch (err) {
        alert('Error loading DCs: ' + err.message);
    }
};

window.showDCPreviewById = async function(id) {
    console.log(`[DC] Navigating to DC view for: ${id}`);
    
    // 1. Close all open modals first to prevent overlay issues
    const modals = ['poDCsListModal', 'projectDetailsModal'];
    modals.forEach(mId => {
        const m = document.getElementById(mId);
        if (m) m.style.display = 'none';
    });

    // 2. Use the existing robust function from dashboard.js
    if (typeof window.openDeliveryChallan === 'function') {
        window.openDeliveryChallan(id);
    } else {
        // Fallback if the function isn't available for some reason
        if (typeof window.showView === 'function') window.showView('dc-view');
        alert('Navigating to DC tab. Please enter the DC ID manually if it doesn\'t load: ' + id);
    }
};

window.createDCFromPO = async function(projectId, orderId) {
    try {
        console.log(`[PO] DC creation requested from PO: ${orderId}`);
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!res.ok) {
            const errText = await res.text();
            console.error(`[PO] Fetch failed for DC: ${res.status} ${errText}`);
            throw new Error(`Failed to fetch PO details (${res.status})`);
        }
        const order = await res.json();
        
        // 1. Close Project Modal
        const projectModal = document.getElementById('projectDetailsModal');
        if (projectModal) projectModal.style.display = 'none';

        // 2. Switch to DC View correctly using Dashboard SubView logic
        if (typeof window.switchDashboardSubView === 'function') {
            window.switchDashboardSubView('dc-view');
        } else {
            // Fallback for direct view switching
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const dcView = document.getElementById('dc-view');
            if (dcView) {
                dcView.classList.remove('hidden');
                dcView.classList.add('active');
                dcView.style.display = 'flex';
            }
        }

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
        const navDc = document.getElementById('nav-dc');
        if (navDc) navDc.classList.add('active');

        // 3. Initialize DC View if needed
        if (typeof window.initDCView === 'function') {
            window.initDCView();
        }

        // 4. Populate DC Form fields from PO data
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val || '';
                el.dispatchEvent(new Event('input'));
                el.dispatchEvent(new Event('change'));
            }
        };

        // Customer Name is now the Consignee Name from PO
        setVal('dcCustomerName', order.ConsigneeName);
        setVal('dcBuyerOrderNo', order.PONumber);
        setVal('dcRefDate', order.PODate || order.OrderDate);

        // Consignee Details from PO
        setVal('dcConsigneeName', order.ConsigneeName);
        setVal('dcConsigneeAddress', order.ConsigneeAddress);
        setVal('dcConsigneeGST', order.ConsigneeGSTIN);
        setVal('dcConsigneeState', order.ConsigneeState);
        setVal('dcConsigneeStateCode', order.ConsigneeStateCode);
        
        // Buyer Details from PO
        setVal('dcBuyerName', order.BuyerName);
        setVal('dcBuyerAddress', order.BuyerAddress);
        setVal('dcBuyerGST', order.BuyerGSTIN);
        setVal('dcBuyerState', order.BuyerState);
        setVal('dcBuyerStateCode', order.BuyerStateCode);
        
        // Fill Project Reference
        setVal('dcRefNo', order.ProjectName || '');

        // Store PO reference globally for the DC session
        window.currentDC_POReference = {
            OrderID: order.ID,
            PONumber: order.PONumber,
            ProjectID: projectId
        };

        showToast(`DC Form pre-filled from PO: ${order.PONumber}`, 'success');
        
    } catch (err) {
        alert('Error creating DC from PO: ' + err.message);
    }
};

window.showAddOrderModal = function(projectId, projectData) {
    const existingOrder = projectData.existingOrder || null;
    console.log('[PO] Opening PO modal. Existing order:', existingOrder);
    let modal = document.getElementById('addOrderModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'addOrderModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.style.zIndex = '10002';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 1000px; width: 95%;">
                <span class="close-modal" onclick="document.getElementById('addOrderModal').style.display='none'">&times;</span>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 id="poModalTitle" style="margin: 0;">Create Purchase Order</h3>
                    <button class="action-button small" onclick="window.showPreviousPOFetcher()" style="background: #fff; color: #2563eb; border: 1px solid #2563eb; font-weight: 600;">🔍 Fetch from Previous PO</button>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 8px;">
                    <div class="form-group">
                        <label>PO Number</label>
                        <input type="text" id="newPONumber" class="form-input" placeholder="e.g. PO/2024/001">
                    </div>
                    <div class="form-group">
                        <label>PO Date</label>
                        <input type="date" id="newPODate" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Vendor Name</label>
                        <input type="text" id="newPOVendor" class="form-input" placeholder="Vendor Name">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                    <div style="background: #fff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h4 style="margin: 0; color: #0078d4;">Consignee Details</h4>
                            <button class="action-button small" onclick="window.copyProjectConsigneeToPO()" style="padding: 4px 10px; font-size: 11px; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-weight: 600;">Copy Default</button>
                        </div>
                        <input type="text" id="poConsigneeName" placeholder="Consignee Name" class="form-input" style="margin-bottom: 5px;">
                        <textarea id="poConsigneeAddress" placeholder="Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px;">
                            <input type="text" id="poConsigneeGSTIN" placeholder="GSTIN" class="form-input">
                            <input type="text" id="poConsigneeState" placeholder="State" class="form-input">
                            <input type="text" id="poConsigneeStateCode" placeholder="Code" class="form-input">
                        </div>
                    </div>
                    <div style="background: #fff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h4 style="margin: 0; color: #0078d4;">Buyer Details</h4>
                            <button class="action-button small" onclick="window.copyProjectBuyerToPO()" style="padding: 4px 10px; font-size: 11px; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-weight: 600;">Copy Default</button>
                        </div>
                        <input type="text" id="poBuyerName" placeholder="Buyer Name" class="form-input" style="margin-bottom: 5px;">
                        <textarea id="poBuyerAddress" placeholder="Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px;">
                            <input type="text" id="poBuyerGSTIN" placeholder="GSTIN" class="form-input">
                            <input type="text" id="poBuyerState" placeholder="State" class="form-input">
                            <input type="text" id="poBuyerStateCode" placeholder="Code" class="form-input">
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin: 0;">Line Items (Excel View)</h4>
                    <div style="display: flex; gap: 10px;">
                        <button class="action-button small" onclick="window.downloadPOTemplate()" style="background: #fff; color: #475569; border: 1px solid #cbd5e1;">📥 Download Template</button>
                        <button class="action-button small" onclick="document.getElementById('poExcelInput').click()" style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;">📎 Import Excel</button>
                        <input type="file" id="poExcelInput" style="display: none;" accept=".xlsx, .xls" onchange="window.importPOFromExcel(this)">
                        <button class="action-button small" onclick="window.addPOLineItem()" style="background: #edf2f7; color: #2d3748; border: 1px solid #cbd5e1;">+ Add Row</button>
                    </div>
                </div>

                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 4px; margin-bottom: 20px;">
                    <table class="data-table" style="margin: 0; min-width: 900px;" id="poItemsTable">
                        <thead style="background: #f1f5f9;">
                            <tr>
                                <th style="width: 50px;">Sr</th>
                                <th>Item Description</th>
                                <th style="width: 100px;">Status</th>
                                <th style="width: 120px;">Due Date</th>
                                <th style="width: 80px;">Qty</th>
                                <th style="width: 80px;">UOM</th>
                                <th style="width: 120px;">Unit Price</th>
                                <th style="width: 120px;">Total</th>
                                <th style="width: 40px;"></th>
                            </tr>
                        </thead>
                        <tbody id="poItemsBody"></tbody>
                        <tfoot style="background: #f8fafc; font-weight: bold;">
                            <tr>
                                <td colspan="7" style="text-align: right; padding-right: 15px;">Grand Total:</td>
                                <td id="poGrandTotal">0.00</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="modal-actions">
                    <button id="btnSavePO" class="action-button blue">Save Purchase Order</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('poModalTitle').textContent = existingOrder ? 'Edit Purchase Order' : 'Create Purchase Order';
    document.getElementById('btnSavePO').textContent = existingOrder ? 'Update Purchase Order' : 'Save Purchase Order';

    // Set Header Data
    document.getElementById('newPONumber').value = existingOrder ? existingOrder.PONumber : '';
    document.getElementById('newPODate').value = existingOrder ? existingOrder.PODate : new Date().toISOString().split('T')[0];
    document.getElementById('newPOVendor').value = existingOrder ? existingOrder.VendorName : '';

    // Set Consignee & Buyer Data
    document.getElementById('poConsigneeName').value = existingOrder ? (existingOrder.ConsigneeName || '') : '';
    document.getElementById('poConsigneeAddress').value = existingOrder ? (existingOrder.ConsigneeAddress || '') : '';
    document.getElementById('poConsigneeGSTIN').value = existingOrder ? (existingOrder.ConsigneeGSTIN || '') : '';
    document.getElementById('poConsigneeState').value = existingOrder ? (existingOrder.ConsigneeState || '') : '';
    document.getElementById('poConsigneeStateCode').value = existingOrder ? (existingOrder.ConsigneeStateCode || '') : '';

    document.getElementById('poBuyerName').value = existingOrder ? (existingOrder.BuyerName || '') : '';
    document.getElementById('poBuyerAddress').value = existingOrder ? (existingOrder.BuyerAddress || '') : '';
    document.getElementById('poBuyerGSTIN').value = existingOrder ? (existingOrder.BuyerGSTIN || '') : '';
    document.getElementById('poBuyerState').value = existingOrder ? (existingOrder.BuyerState || '') : '';
    document.getElementById('poBuyerStateCode').value = existingOrder ? (existingOrder.BuyerStateCode || '') : '';

    window.copyProjectConsigneeToPO = () => {
        const p = window.currentProjectData;
        if (!p) return;
        document.getElementById('poConsigneeName').value = p.ConsigneeName || '';
        document.getElementById('poConsigneeAddress').value = p.ConsigneeAddress || '';
        document.getElementById('poConsigneeGSTIN').value = p.ConsigneeGSTIN || '';
        document.getElementById('poConsigneeState').value = p.ConsigneeState || '';
        document.getElementById('poConsigneeStateCode').value = p.ConsigneeStateCode || '';
        showToast('Consignee details copied', 'success');
    };

    window.copyProjectBuyerToPO = () => {
        const p = window.currentProjectData;
        if (!p) return;
        document.getElementById('poBuyerName').value = p.BuyerName || '';
        document.getElementById('poBuyerAddress').value = p.BuyerAddress || '';
        document.getElementById('poBuyerGSTIN').value = p.BuyerGSTIN || '';
        document.getElementById('poBuyerState').value = p.BuyerState || '';
        document.getElementById('poBuyerStateCode').value = p.BuyerStateCode || '';
        showToast('Buyer details copied', 'success');
    };

    window.downloadPOTemplate = () => {
        try {
            const data = [
                ['Sr No', 'Item Description', 'Due Date (YYYY-MM-DD)', 'Quantity', 'UOM', 'Unit Price'],
                [1, 'Sample Item Name', new Date().toISOString().split('T')[0], 10, 'Nos', 500]
            ];
            
            const worksheet = XLSX.utils.aoa_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'PO_Template');
            
            // Set column widths
            const wscols = [
                { wch: 8 },  // Sr No
                { wch: 40 }, // Description
                { wch: 20 }, // Due Date
                { wch: 10 }, // Qty
                { wch: 10 }, // UOM
                { wch: 15 }  // Price
            ];
            worksheet['!cols'] = wscols;
            
            XLSX.writeFile(workbook, 'PO_Import_Template.xlsx');
            showToast('Template downloaded', 'success');
        } catch (err) {
            console.error('Download template error:', err);
            alert('Error downloading template');
        }
    };

    window.importPOFromExcel = (input) => {
        const file = input.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet);
                
                if (rows.length === 0) throw new Error('Excel file is empty');
                
                const headers = Object.keys(rows[0]);
                window.showExcelMapper(headers, rows);
            } catch (err) {
                alert('Error reading Excel: ' + err.message);
            } finally {
                input.value = ''; 
            }
        };
        reader.readAsArrayBuffer(file);
    };

    window.showExcelMapper = (headers, rows) => {
        let mapperModal = document.getElementById('excelMapperModal');
        if (!mapperModal) {
            mapperModal = document.createElement('div');
            mapperModal.id = 'excelMapperModal';
            mapperModal.className = 'modal';
            mapperModal.style.zIndex = '10005';
            document.body.appendChild(mapperModal);
        }

        const fields = [
            { id: 'SrNo', label: 'Sr No' },
            { id: 'ItemDescription', label: 'Item Description' },
            { id: 'DueDate', label: 'Due Date' },
            { id: 'QtyOrdered', label: 'Quantity' },
            { id: 'UOM', label: 'UOM' },
            { id: 'UnitPrice', label: 'Unit Price' }
        ];

        // Automatic guesser logic
        const guess = (label) => {
            const l = label.toLowerCase().replace(/[\s_-]/g, '');
            if (l.includes('srno') || l === 'sr' || l === 'sno') return 'SrNo';
            if (l.includes('desc') || l.includes('item') || l === 'particulars') return 'ItemDescription';
            if (l.includes('due') || l.includes('date')) return 'DueDate';
            if (l.includes('qty') || l.includes('quant') || l === 'q') return 'QtyOrdered';
            if (l.includes('uom') || l === 'unit') return 'UOM';
            if (l.includes('price') || l.includes('rate') || l === 'unitcost') return 'UnitPrice';
            return '';
        };

        const fieldOptions = fields.map(f => `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 6px;">
                <div style="flex: 1; font-weight: 600; color: #475569;">${f.label}</div>
                <div style="flex: 1.5;">
                    <select class="mapper-select" data-field="${f.id}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;">
                        <option value="">-- Skip Field --</option>
                        ${headers.map(h => `<option value="${h}" ${guess(h) === f.id ? 'selected' : ''}>Excel: ${h}</option>`).join('')}
                    </select>
                </div>
            </div>
        `).join('');

        mapperModal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; padding: 30px;">
                <h3 style="margin-top: 0; margin-bottom: 20px;">Excel Column Mapper</h3>
                <p style="font-size: 13px; color: #64748b; margin-bottom: 20px;">Assign which Excel column corresponds to our PO fields.</p>
                
                <div id="mapperFieldsContainer">
                    ${fieldOptions}
                </div>

                <div style="display: flex; gap: 10px; margin-top: 30px;">
                    <button class="action-button" onclick="document.getElementById('excelMapperModal').style.display='none'" style="flex: 1; background: #f1f5f9; color: #475569;">Cancel</button>
                    <button id="btnConfirmImport" class="action-button blue" style="flex: 1;">Confirm Import</button>
                </div>
            </div>
        `;

        document.getElementById('btnConfirmImport').onclick = () => {
            const mapping = {};
            mapperModal.querySelectorAll('.mapper-select').forEach(sel => {
                if (sel.value) mapping[sel.getAttribute('data-field')] = sel.value;
            });

            // Clear existing rows
            const tbody = document.getElementById('poItemsBody');
            tbody.innerHTML = '';

            rows.forEach((row, idx) => {
                const item = {
                    SrNo: row[mapping.SrNo] || (idx + 1),
                    ItemDescription: row[mapping.ItemDescription] || '',
                    Status: 'Pending',
                    DueDate: row[mapping.DueDate] || '',
                    QtyOrdered: parseFloat(row[mapping.QtyOrdered]) || 1,
                    UOM: row[mapping.UOM] || 'Nos',
                    UnitPrice: parseFloat(row[mapping.UnitPrice]) || 0,
                    Total: 0
                };
                item.Total = item.QtyOrdered * item.UnitPrice;
                window.addPOLineItem(item);
            });

            window.calculatePOTotals();
            showToast(`Imported ${rows.length} items with custom mapping`, 'success');
            mapperModal.style.display = 'none';
        };

        mapperModal.style.display = 'flex';
    };

    // Set Items
    const poItemsBody = document.getElementById('poItemsBody');
    poItemsBody.innerHTML = '';
    
    if (existingOrder && existingOrder.items && existingOrder.items.length > 0) {
        console.log(`[PO] Loading ${existingOrder.items.length} existing items:`, existingOrder.items);
        existingOrder.items.forEach(item => {
            console.log(`[PO] Adding Item: ${item.ItemDescription}, Status: ${item.Status}`);
            window.addPOLineItem(item);
        });
    } else {
        // Add 3 empty rows by default for new PO
        for(let i=0; i<3; i++) window.addPOLineItem();
    }

    window.calculatePOTotals();

    // Save Handler
    const btnSave = document.getElementById('btnSavePO');
    btnSave.onclick = async () => {
        const items = [];
        const itemRows = document.querySelectorAll('#poItemsBody .po-item-row');
        console.log(`[PO] Collecting items from ${itemRows.length} rows`);
        
        itemRows.forEach((row, index) => {
            const desc = row.querySelector('.item-desc').value;
            const checkbox = row.querySelector('.item-checklist-toggle');
            
            // DIRECT READ: Force exactly 'Shipped' or 'Pending' string
            const status = (checkbox && checkbox.checked) ? 'Shipped' : 'Pending';
            
            console.log(`[PO SAVE] Row ${index + 1}: desc="${desc}", checkbox_checked=${checkbox ? checkbox.checked : 'N/A'} -> SAVING STATUS: "${status}"`);
            
            if (desc.trim()) {
                const itemData = {
                    SrNo: index + 1,
                    ItemDescription: desc,
                    Status: status, // Uppercase S to match backend expectations
                    status: status, // Lowercase s as a fallback
                    DueDate: row.querySelector('.item-due').value,
                    QtyOrdered: parseFloat(row.querySelector('.item-qty').value) || 0,
                    UOM: row.querySelector('.item-uom').value,
                    UnitPrice: parseFloat(row.querySelector('.item-price').value) || 0,
                    Total: parseFloat(row.querySelector('.item-total').textContent.replace(/,/g, '')) || 0
                };
                
                // Add AssetID if it exists in the row's data
                const linkedAssetEl = row.querySelector('div[style*="color: #0078d4"]');
                if (linkedAssetEl) {
                    const match = linkedAssetEl.textContent.match(/🔗 Linked: (.*)/);
                    if (match) itemData.AssetID = match[1];
                }
                
                items.push(itemData);
            }
        });

        if (items.length === 0) {
            alert('Please add at least one line item with a description.');
            return;
        }

        const payload = {
            PONumber: document.getElementById('newPONumber').value,
            PODate: document.getElementById('newPODate').value,
            VendorName: document.getElementById('newPOVendor').value,
            TotalAmount: parseFloat(document.getElementById('poGrandTotal').textContent.replace(/,/g, '')),
            Status: 'Active',
            items: items,
            ConsigneeName: document.getElementById('poConsigneeName').value,
            ConsigneeAddress: document.getElementById('poConsigneeAddress').value,
            ConsigneeGSTIN: document.getElementById('poConsigneeGSTIN').value,
            ConsigneeState: document.getElementById('poConsigneeState').value,
            ConsigneeStateCode: document.getElementById('poConsigneeStateCode').value,
            BuyerName: document.getElementById('poBuyerName').value,
            BuyerAddress: document.getElementById('poBuyerAddress').value,
            BuyerGSTIN: document.getElementById('poBuyerGSTIN').value,
            BuyerState: document.getElementById('poBuyerState').value,
            BuyerStateCode: document.getElementById('poBuyerStateCode').value
        };

        console.log('[PO] Final Payload to Send:', JSON.stringify(payload, null, 2));

        try {
            btnSave.disabled = true;
            const url = existingOrder ? `/api/orders/${existingOrder.ID}` : `/api/projects/${encodeURIComponent(projectId)}/orders`;
            const method = existingOrder ? 'PUT' : 'POST';
            
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Failed to save PO');
            
            showToast(existingOrder ? 'PO Updated' : 'PO Created', 'success');
            modal.style.display = 'none';
            loadProjectOrders(projectId);
            // Also refresh workspace if active
            if (currentProjectId === projectId) {
                loadWorkspacePO(projectId);
            }
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btnSave.disabled = false;
        }
    };

    modal.style.display = 'flex';
};

window.addPOLineItem = function(data = null) {
    const tbody = document.getElementById('poItemsBody');
    const sr = tbody.children.length + 1;
    const row = document.createElement('tr');
    row.className = 'po-item-row';
    if (data && data.ID) {
        row.dataset.poItemId = data.ID;
    }
    
    // Status Logic for Standalone Checklist
    const status = (data && data.Status) ? data.Status : 'Pending';
    // Match exactly 'Shipped' (case-sensitive) as defined in backend/checklist
    const isShipped = status === 'Shipped';
    
    console.log(`[PO UI] Rendering Item Row. Desc: ${data ? data.ItemDescription : 'Empty'}, Status: ${status}, isShipped: ${isShipped}`);
    
    row.innerHTML = `
        <td class="item-sr" style="text-align: center; vertical-align: middle;">${sr}</td>
        <td>
            <input type="text" class="form-input item-desc" value="${data ? data.ItemDescription : ''}" 
                   style="width: 100%; border: none; background: transparent; padding: 8px; 
                   ${isShipped ? 'text-decoration: line-through; color: #94a3b8;' : ''}"
                   placeholder="Item Description">
            ${data && data.AssetID ? `<div style="font-size: 10px; color: #0078d4; margin-top: 2px; padding-left: 8px;">🔗 Linked: ${data.AssetID}</div>` : ''}
        </td>
        <td style="text-align: center; vertical-align: middle;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 5px;">
                <input type="checkbox" class="item-checklist-toggle" ${isShipped ? 'checked' : ''} 
                       style="width: 18px; height: 18px; cursor: pointer;">
                <input type="hidden" class="item-status" value="${status}">
                <span class="status-label" style="font-size: 11px; font-weight: 600; min-width: 50px; 
                      ${isShipped ? 'color: #10b981;' : 'color: #64748b;'}">
                    ${isShipped ? 'Shipped' : status}
                </span>
            </div>
        </td>
        <td><input type="date" class="form-input item-due" value="${data ? data.DueDate : ''}" style="width: 100%; border: none; background: transparent; padding: 8px;"></td>
        <td><input type="number" class="form-input item-qty" value="${data ? data.QtyOrdered : '1'}" oninput="window.calculatePOTotals()" style="width: 100%; border: none; background: transparent; text-align: center; padding: 8px;"></td>
        <td><input type="text" class="form-input item-uom" value="${data ? data.UOM : 'Nos'}" style="width: 100%; border: none; background: transparent; text-align: center; padding: 8px;"></td>
        <td><input type="number" class="form-input item-price" value="${data ? data.UnitPrice : '0'}" oninput="window.calculatePOTotals()" style="width: 100%; border: none; background: transparent; text-align: right; padding: 8px;"></td>
        <td class="item-total" style="text-align: right; padding: 8px;">${data ? (data.Total || 0).toFixed(2) : '0.00'}</td>
        <td style="text-align: center; vertical-align: middle;">
            <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                <button onclick="window.convertPOItemToAsset(this)" 
                        style="border:none; background:#f0f9ff; color:#0369a1; cursor:pointer; font-size: 14px; padding: 4px 8px; border-radius: 4px; border: 1px solid #bae6fd;" 
                        title="Convert to Asset">📦+</button>
                <button onclick="this.closest('tr').remove(); window.calculatePOTotals();" 
                        style="border:none; background:none; color:#ef4444; cursor:pointer; font-size: 18px;" 
                        title="Remove Item">&times;</button>
            </div>
        </td>
    `;
    
    // Checklist Toggle Logic
    const checkbox = row.querySelector('.item-checklist-toggle');
    const statusInput = row.querySelector('.item-status');
    const statusLabel = row.querySelector('.status-label');
    const descInput = row.querySelector('.item-desc');
    
    checkbox.onchange = () => {
        const isChecked = checkbox.checked;
        statusInput.value = isChecked ? 'Shipped' : 'Pending';
        statusLabel.textContent = statusInput.value;
        
        if (isChecked) {
            statusLabel.style.color = '#10b981';
            descInput.style.textDecoration = 'line-through';
            descInput.style.color = '#94a3b8';
        } else {
            statusLabel.style.color = '#64748b';
            descInput.style.textDecoration = 'none';
            descInput.style.color = 'inherit';
        }
    };
    
    tbody.appendChild(row);
};

window.convertPOItemToAsset = function(btn) {
    const row = btn.closest('tr');
    if (!row) return;

    // Extract data from the row
    const itemDescription = row.querySelector('.item-desc').value;
    const qty = row.querySelector('.item-qty').value;
    const uom = row.querySelector('.item-uom').value;
    const price = row.querySelector('.item-price').value;
    const poNumber = document.getElementById('newPONumber')?.value || '';
    const poDate = document.getElementById('newPODate')?.value || '';
    const vendor = document.getElementById('newPOVendor')?.value || '';

    // Create prefill object
    const prefill = {
        linked_po_item_id: row.dataset.poItemId || null,
        ItemName: itemDescription,
        PurchaseDetails: `Purchased via PO: ${poNumber} from ${vendor} on ${poDate}`,
        AssetValue: price,
        Currency: 'INR',
        PurchaseDate: poDate,
        UOM: uom,
        QtyOrdered: qty,
        BoughtAgainstPO: poNumber,
        Remarks: `PO Item conversion. Original Qty: ${qty} ${uom}`
    };

    console.log('[PO -> Asset] Prefilling modal with:', prefill);

    // Hide the PO modal if it's open
    const poModal = document.getElementById('purchaseOrderModal');
    if (poModal) poModal.style.display = 'none';

    // Open the Add Asset modal
    if (typeof window.openAddItemModal === 'function') {
        window.openAddItemModal(null, prefill);
    } else {
        console.error('window.openAddItemModal not found');
        alert('Could not open Add Asset modal. Please ensure you are on the dashboard.');
    }
};

window.calculatePOTotals = function() {
    let grandTotal = 0;
    document.querySelectorAll('.po-item-row').forEach((row, index) => {
        row.querySelector('.item-sr').textContent = index + 1;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const total = qty * price;
        row.querySelector('.item-total').textContent = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        grandTotal += total;
    });
    document.getElementById('poGrandTotal').textContent = grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Expose to window for global access
    window.showProjectDetails = showProjectDetails;
    window.switchProjectTab = switchProjectTab;
    window.showAssignAssetModal = showAssignAssetModal;
    window.showAddTempAssetModal = showAddTempAssetModal;
    window.loadProjects = loadProjects;
    window.showEditBillingModal = showEditBillingModal;
    console.log('[Projects] Global functions exposed');

async function loadProjectTempAssets(projectId) {
    const tbody = document.getElementById('projectTempAssetsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading temporary assets...</td></tr>';

    try {
        const res = await fetch(`/api/temporary-assets`); // This returns ALL temp assets. We need to filter.
        // Ideally backend should support /api/projects/:id/temporary-assets
        // But for now let's use the existing endpoint and filter client side if needed, 
        // OR better: check if there is a query param support.
        // Looking at server.js: app.get('/api/temporary-assets', ...) returns all where IsPermanent = 0.
        // It doesn't filter by project.
        
        if (!res.ok) throw new Error('Failed to load temporary assets');
        const allTempAssets = await res.json();
        
        const projectTempAssets = allTempAssets.filter(a => a.ProjectId === projectId);

        if (projectTempAssets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: #94a3b8;">No temporary assets added</td></tr>';
            return;
        }

        tbody.innerHTML = projectTempAssets.map(a => `
            <tr>
                <td>${a.ID}</td>
                <td>${a.ItemName}</td>
                <td>${a.Make} ${a.Model}</td>
                <td>${a.Quantity}</td>
                <td>${a.Currency} ${a.EstimatedPrice}</td>
                <td>
                    <button class="action-button small" onclick="convertTempAsset('${a.ID}')" title="Convert to Permanent">Convert</button>
                    <button class="action-button small danger" onclick="deleteTempAsset('${a.ID}')" title="Delete">Del</button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: red;">Error: ${err.message}</td></tr>`;
    }
}

// Expose these for onclick handlers
window.convertTempAsset = async function(id) {
    if (!confirm('Convert this temporary asset to a permanent asset?')) return;
    try {
        const res = await fetch(`/api/temporary-assets/${id}/make-permanent`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to convert');
        showToast('Asset converted to permanent', 'success');
        loadProjectTempAssets(currentProjectId);
        // Also refresh assets tab if needed
        loadProjectAssets(currentProjectId);
    } catch (err) {
        alert('Error converting asset: ' + err.message);
    }
};

window.deleteTempAsset = async function(id) {
    if (!confirm('Delete this temporary asset?')) return;
    try {
        // We need a DELETE endpoint. 
        // Checking server.js... it might not have one explicit for temp assets?
        // Let's assume /api/temporary-assets/:id based on convention, if not we might need to add it.
        // Wait, server.js snippet didn't show DELETE /api/temporary-assets/:id.
        // It showed GET and POST. 
        // If it's missing, we need to add it to backend.
        
        const res = await fetch(`/api/temporary-assets/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        showToast('Temporary asset deleted', 'success');
        loadProjectTempAssets(currentProjectId);
    } catch (err) {
        alert('Error deleting asset: ' + err.message);
    }
};;

async function showAssignAssetModal() {
    console.log('[Projects] showAssignAssetModal called (V3 - Dynamic Injection)');
    
    if (!currentProjectId) {
        console.error('[Projects] No currentProjectId set');
        alert('No project selected');
        return;
    }
    
    // Check if modal exists, if not, create it
    let modal = document.getElementById('assignAssetModal_v2');
    
    if (!modal) {
        console.warn('[Projects] Modal element #assignAssetModal_v2 not found in DOM. Injecting dynamically...');
        
        const modalHtml = `
            <div id="assignAssetModal_v2" class="modal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.4); align-items: center; justify-content: center;">
                <div class="modal-content" style="background-color: #fefefe; margin: auto; padding: 20px; border: 1px solid #888; width: 90%; max-width: 900px; min-height: 400px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); position: relative; display: flex; flex-direction: column;">
                    <span class="close-modal" id="btnCloseAssignAsset_v2" style="color: #aaa; float: right; font-size: 28px; font-weight: bold; cursor: pointer;">&times;</span>
                    <h3 style="margin-top: 0; color: #333;">Assign Asset to Project</h3>
                    <div class="form-group" style="margin-bottom: 20px; position: relative; flex-grow: 1;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Asset ID</label>
                        <input type="text" id="assignAssetInput_v2" class="form-input" placeholder="Enter Asset ID or Scan..." style="width: 100%; padding: 12px; font-size: 1.1em; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;" autocomplete="off">
                        <div id="assignAssetSearchResults" style="display: none; position: absolute; top: 75px; left: 0; right: 0; background: white; border: 1px solid #ddd; border-top: none; max-height: 300px; overflow-y: auto; z-index: 1001; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"></div>
                        <div style="margin-top: 5px; font-size: 12px; color: #666;">Enter the Asset ID manually or scan its QR code.</div>
                    </div>
                    <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="action-button" id="btnCancelAssignAsset_v2" style="padding: 8px 16px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer;">Cancel</button>
                        <button id="btnConfirmAssignAsset_v2" class="action-button blue" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Assign to Project</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('assignAssetModal_v2');
        
        // Add close listeners for the new modal
        document.getElementById('btnCloseAssignAsset_v2').onclick = () => modal.style.display = 'none';
        document.getElementById('btnCancelAssignAsset_v2').onclick = () => modal.style.display = 'none';
        
        // Close on outside click
        window.addEventListener('click', (event) => {
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        });
    }

    const input = document.getElementById('assignAssetInput_v2');
    const resultsContainer = document.getElementById('assignAssetSearchResults');
    
    console.log('[Projects] Modal element (V3):', modal);
    console.log('[Projects] Input element (V3):', input);

    // Autocomplete Logic
    let debounceTimer;
    input.oninput = () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        
        if (query.length < 2) {
            if(resultsContainer) resultsContainer.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            if(!resultsContainer) return;
            try {
                const response = await fetch(`/api/assets/search?q=${encodeURIComponent(query)}&size=10`);
                if (!response.ok) throw new Error('Search failed');
                const data = await response.json();
                
                resultsContainer.innerHTML = '';
                if (data.data && data.data.length > 0) {
                    data.data.forEach(asset => {
                        const div = document.createElement('div');
                        div.style.padding = '10px';
                        div.style.cursor = 'pointer';
                        div.style.borderBottom = '1px solid #eee';
                        div.style.display = 'flex';
                        div.style.justifyContent = 'space-between';
                        
                        div.innerHTML = `
                            <div style="flex-grow: 1;">
                                <div style="font-weight: bold; color: #333;">${asset.ItemName || 'Unknown Item'}</div>
                                <div style="font-size: 0.85em; color: #666;">ID: ${asset.ID}</div>
                                ${asset.is_batch ? `<div style="font-size: 0.75em; color: #2563eb; font-weight: 600; margin-top: 2px;">📦 BATCH (Qty: ${asset.quantity_available || 0})</div>` : ''}
                            </div>
                            <div style="text-align: right; font-size: 0.85em; color: #888; min-width: 100px;">
                                <div>${asset.Model || ''}</div>
                                <div>${asset.Status || ''}</div>
                                ${asset.is_batch ? `<button class="split-assign-btn" style="margin-top: 5px; padding: 2px 8px; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; border-radius: 4px; font-size: 10px; cursor: pointer;">Split & Assign</button>` : ''}
                            </div>
                        `;
                        
                        div.onmouseover = () => div.style.background = '#f5f9ff';
                        div.onmouseout = () => div.style.background = 'white';
                        
                        div.onclick = (e) => {
                            if (e.target.classList.contains('split-assign-btn')) {
                                e.stopPropagation();
                                handleProjectBatchSplit(asset, currentProjectId);
                                return;
                            }
                            e.stopPropagation();
                            input.value = asset.ID;
                            resultsContainer.style.display = 'none';
                        };
                        
                        resultsContainer.appendChild(div);
                    });
                    resultsContainer.style.display = 'block';
                } else {
                    resultsContainer.innerHTML = '<div style="padding:10px; color:#888;">No assets found</div>';
                    resultsContainer.style.display = 'block';
                }
            } catch (err) {
                console.error('Search error:', err);
            }
        }, 300);
    };

    // Close dropdown handler
    if (input._closeHandler) {
        document.removeEventListener('click', input._closeHandler);
    }
    input._closeHandler = (e) => {
        if (resultsContainer && e.target !== input && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    };
    document.addEventListener('click', input._closeHandler);

    if (!modal) {
        console.error('[Projects] CRITICAL: Modal could not be created');
        alert('System Error: Could not create assignment modal');
        return;
    }
    
    if (!input) {
         console.error('[Projects] Input element #assignAssetInput_v2 not found in injected modal');
         return;
    }

    input.value = ''; // Clear previous input
    modal.style.display = 'flex';
    console.log('[Projects] Modal display set to flex');
    
    setTimeout(() => {
        input.focus();
        console.log('[Projects] Input focus attempted');
    }, 100);

    // Setup Confirm Button
    const btnConfirm = document.getElementById('btnConfirmAssignAsset_v2');
    console.log('[Projects] Confirm button (V3):', btnConfirm);
    
    if (btnConfirm) {
        // Use cloneNode to wipe previous listeners and ensure clean slate
        const newBtn = btnConfirm.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
        
        newBtn.onclick = async () => {
            console.log('[Projects] Assign button clicked');
            const assetId = input.value.trim();
            console.log('[Projects] Asset ID to assign:', assetId);
            
            if (!assetId) {
                alert('Please enter an Asset ID');
                return;
            }
            
            try {
                // Call backend endpoint to assign asset
                const token = localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                console.log(`[Projects] Sending POST to /api/projects/${currentProjectId}/assign-asset`);
                const response = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/assign-asset`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ AssetID: assetId, Type: 'Permanent' })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to assign asset');
                }

                console.log('[Projects] Assignment successful');
                showToast('Asset assigned successfully', 'success');
                modal.style.display = 'none';
                
                // Refresh assets list if currently viewing assets tab
                const activeTab = document.querySelector('.tab-btn.active');
                if (activeTab && activeTab.textContent.toLowerCase().includes('asset')) {
                    loadProjectAssets(currentProjectId);
                } else {
                     // Force reload anyway just in case
                     loadProjectAssets(currentProjectId);
                }
            } catch (err) {
                console.error('[Projects] Error assigning asset:', err);
                alert('Error assigning asset: ' + err.message);
            }
        };
    } else {
        console.error('[Projects] Confirm button #btnConfirmAssignAsset_v2 not found');
    }
}

async function handleProjectBatchSplit(asset, projectId) {
    console.log('[Projects] Batch split for project called:', asset.ID, projectId);
    
    // Create a mini modal to pick serial numbers
    let splitModal = document.getElementById('projectBatchSplitModal');
    if (!splitModal) {
        splitModal = document.createElement('div');
        splitModal.id = 'projectBatchSplitModal';
        splitModal.className = 'modal';
        splitModal.style.zIndex = '10001';
        splitModal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; padding: 0; border-radius: 12px; overflow: hidden;">
                <div style="background: #f8fafc; padding: 15px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 16px; color: #1e293b;">Select S/N to Split & Assign</h3>
                    <span class="close-modal" onclick="document.getElementById('projectBatchSplitModal').style.display='none'">&times;</span>
                </div>
                <div id="projectBatchSnList" style="padding: 15px; max-height: 300px; overflow-y: auto;"></div>
                <div class="modal-actions" style="padding: 15px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">
                    <button onclick="document.getElementById('projectBatchSplitModal').style.display='none'" style="padding: 6px 12px; border-radius: 4px; border: 1px solid #ddd; background: #fff; cursor: pointer;">Cancel</button>
                    <button id="btnConfirmProjectSplit" class="action-button green" style="padding: 6px 16px; background: #166534; color: white; border: none; border-radius: 4px; cursor: pointer;">Split & Assign</button>
                </div>
            </div>
        `;
        document.body.appendChild(splitModal);
    }

    const snContainer = document.getElementById('projectBatchSnList');
    const serials = (asset.SrNo || '').split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    snContainer.innerHTML = serials.map(sn => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px; border-bottom: 1px solid #edf2f7;">
            <input type="checkbox" class="proj-batch-sn-cb" value="${sn}" style="width: 16px; height: 16px;">
            <span style="font-family: monospace; font-size: 13px;">${sn}</span>
        </div>
    `).join('');

    splitModal.style.display = 'flex';

    document.getElementById('btnConfirmProjectSplit').onclick = async () => {
        const selected = Array.from(snContainer.querySelectorAll('.proj-batch-sn-cb:checked')).map(cb => cb.value);
        if (selected.length === 0) {
            alert('Please select at least one Serial Number');
            return;
        }

        try {
            const response = await fetch('/api/assets/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    parentId: asset.ID, 
                    serials: selected,
                    projectId: projectId 
                })
            });

            if (response.ok) {
                const data = await response.json();
                showToast(`Split & assigned ${data.count} unit(s) to project`, 'success');
                splitModal.style.display = 'none';
                document.getElementById('assignAssetModal_v2').style.display = 'none';
                
                // Refresh project assets
                loadProjectAssets(projectId);
            } else {
                const err = await response.json();
                alert('Split failed: ' + (err.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Project split error:', err);
            alert('Error processing split');
        }
    };
}

// --- PROJECT WORKSPACE LOGIC ---
let workspaceStagedAssets = [];
let workspaceProjectPOs = [];

async function initProjectWorkspace(projectId) {
    console.log('[Workspace] Initializing for:', projectId);
    workspaceStagedAssets = [];
    const stagingArea = document.getElementById('workspaceStagingArea');
    if (stagingArea) {
        stagingArea.innerHTML = '<div class="empty-state" style="text-align: center; color: #94a3b8; margin-top: 100px;"><div style="font-size: 40px; margin-bottom: 10px;">📥</div><div>Drop assets here to stage for shipping</div></div>';
        
        // Setup Drop Zone
        stagingArea.ondragover = (e) => {
            e.preventDefault();
            stagingArea.style.borderColor = '#2563eb';
            stagingArea.style.background = '#eff6ff';
        };
        stagingArea.ondragleave = () => {
            stagingArea.style.borderColor = '#e2e8f0';
            stagingArea.style.background = '#fafafa';
        };
        stagingArea.ondrop = (e) => {
            e.preventDefault();
            stagingArea.style.borderColor = '#e2e8f0';
            stagingArea.style.background = '#fafafa';
            try {
                const assetData = JSON.parse(e.dataTransfer.getData('application/json'));
                handleWorkspaceDrop(assetData);
            } catch (err) {
                console.error('[Workspace] Drop error:', err);
            }
        };
    }
    
    // Setup Search
    const searchInput = document.getElementById('workspaceSearch');
    if (searchInput) {
        searchInput.oninput = (e) => loadWorkspaceInventory(e.target.value);
    }

    // One-Click DC Handler
    const btnDC = document.getElementById('btnWorkspaceGenerateDC');
    if (btnDC) btnDC.onclick = handleWorkspaceGenerateDC;

    // Load Data
    await loadWorkspaceInventory();
    await loadWorkspacePO(projectId);
    updateWorkspacePoProgress();
}

async function loadWorkspaceInventory(term = '') {
    const list = document.getElementById('workspaceInventoryList');
    if (!list) return;
    
    console.log(`[Workspace] Searching inventory for: "${term}"`);
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#666; font-size:12px;">Searching...</div>';
    
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Fetch "Available" assets from server (In Store, Owned, Demo)
        const url = `/api/assets?search=${encodeURIComponent(term)}&status=In Store,Owned,Demo&limit=100`;
        const res = await fetch(url, { headers });
        const result = await res.json();
        
        const assets = Array.isArray(result) ? result : (result.data || []);
        console.log(`[Workspace] Server returned ${assets.length} matching assets`);

        if (assets.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8; font-size:12px;">
                No available assets found${term ? ` matching "${term}"` : ''}.
                <br><br>
                <button onclick="loadWorkspaceInventory('${term}')" style="background:none; border:1px solid #ddd; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer; color:#666;">🔄 Refresh</button>
            </div>`;
            return;
        }

        list.innerHTML = assets.map(asset => `
            <div class="workspace-asset-card" draggable="true" 
                 style="padding: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; cursor: grab; user-select: none; margin-bottom: 8px;"
                 data-asset='${JSON.stringify(asset).replace(/'/g, "&apos;")}'>
                <div style="font-weight: 600; font-size: 13px; color: #1e293b;">${asset.ItemName}</div>
                <div style="font-size: 11px; color: #64748b; font-family: monospace;">${asset.ID}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                    <span style="font-size: 10px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${asset.Type}</span>
                    ${asset.is_batch ? `<span style="font-size: 10px; color: #2563eb; font-weight: 700;">📦 BATCH</span>` : ''}
                </div>
            </div>
        `).join('');

        // Add drag handlers
        list.querySelectorAll('.workspace-asset-card').forEach(card => {
            card.ondragstart = (e) => {
                e.dataTransfer.setData('application/json', card.getAttribute('data-asset'));
                card.style.opacity = '0.5';
            };
            card.ondragend = () => card.style.opacity = '1';
        });

    } catch (err) {
        list.innerHTML = '<div style="text-align:center; color:red; font-size:11px;">Error loading inventory</div>';
    }
}

async function loadWorkspacePO(projectId) {
    const summary = document.getElementById('workspacePoSummary');
    const badge = document.getElementById('workspacePoBadge');
    if (!summary) return;
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders`, { headers });
        const ordersResult = await res.json();
        
        // Handle both { success: true, orders: [...] } and direct array
        workspaceProjectPOs = Array.isArray(ordersResult) ? ordersResult : (ordersResult.orders || ordersResult.data || []);
        
        console.log(`[Workspace] Loaded ${workspaceProjectPOs.length} POs for project ${projectId}`);
        
        if (workspaceProjectPOs.length > 0) {
            // Sort by timestamp DESC to get latest first if not sorted by backend
            workspaceProjectPOs.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
            
            const po = workspaceProjectPOs[0]; // Take latest PO
            summary.innerHTML = `Linked to PO: <strong>${po.PONumber || po.OrderNo}</strong> (${po.VendorName || 'No Vendor'})`;
            if (badge) {
                badge.textContent = po.PONumber || po.OrderNo;
                badge.style.display = 'inline-block';
                badge.style.background = '#e0f2fe';
                badge.style.color = '#0369a1';
            }
        } else {
            summary.innerHTML = '<span style="color: #94a3b8;">No Purchase Order linked to this project.</span>';
            if (badge) {
                badge.textContent = 'No PO';
                badge.style.background = '#f1f5f9';
                badge.style.color = '#64748b';
            }
        }
        renderWorkspacePoChecklist();
        updateWorkspacePoProgress();
    } catch (err) {
        console.error('[Workspace] PO Load Error:', err);
        summary.innerHTML = '<span style="color: #ef4444;">Error loading PO data.</span>';
    }
}

function renderWorkspacePoChecklist() {
    const container = document.getElementById('workspacePoChecklist');
    if (!container) return;

    if (workspaceProjectPOs.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #94a3b8; margin-top: 100px; font-size: 13px;">No active PO found for this project.</div>';
        return;
    }

    let html = '';
    workspaceProjectPOs.forEach(po => {
        if (po.items && Array.isArray(po.items)) {
            html += `<div style="margin-bottom: 15px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span>PO: ${po.PONumber || po.OrderNo}</span>
                    <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${po.Status === 'Shipped' ? '#f0fdf4' : '#fff7ed'}; color: ${po.Status === 'Shipped' ? '#166534' : '#9a3412'}; border: 1px solid ${po.Status === 'Shipped' ? '#bbf7d0' : '#ffedd5'};">
                        ${po.Status || 'Active'}
                    </span>
                </div>`;
            
            po.items.forEach(item => {
                const required = parseFloat(item.QtyOrdered) || 0;
                
                // --- ROBUST LOGIC: Use server-calculated fulfilledQty ---
                // We add local workspaceStagedAssets that are tagged to this item but not yet in the DB
                const localFulfilled = workspaceStagedAssets.filter(a => a.linkedPoItemId === item.ID).length;
                const totalFulfilled = (item.fulfilledQty || 0) + localFulfilled;
                
                const isDone = (totalFulfilled >= required && required > 0) || item.Status === 'Shipped';
                
                html += `
                    <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-radius: 8px; background: ${isDone ? '#f0fdf4' : '#fff'}; border: 1px solid ${isDone ? '#bbf7d0' : '#f1f5f9'}; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                        <div style="font-size: 18px; color: ${isDone ? '#10b981' : '#cbd5e1'}; margin-top: 2px;">
                            ${isDone ? '✅' : '⭕'}
                        </div>
                        <div style="flex-grow: 1;">
                            <div style="font-size: 13px; font-weight: 600; color: ${isDone ? '#166534' : '#1e293b'};">${item.ItemDescription || 'No Description'}</div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                <div style="font-size: 11px; color: ${isDone ? '#10b981' : '#64748b'};">
                                    Status: <strong>${isDone ? 'Shipped' : (totalFulfilled > 0 ? 'Partially Fulfilled' : 'Pending')}</strong> (${totalFulfilled} / ${required} ${item.UOM || 'units'})
                                </div>
                                ${isDone ? `<button onclick="window.viewDCsForOrder('${po.PONumber || po.OrderNo}')" 
                                            style="font-size: 10px; padding: 2px 8px; background: #fff; border: 1px solid #bbf7d0; color: #166534; border-radius: 4px; cursor: pointer; font-weight: 600;">
                                            View DC
                                           </button>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
    });

    if (!html) {
        container.innerHTML = '<div style="text-align: center; color: #94a3b8; margin-top: 100px; font-size: 13px;">PO has no line items.</div>';
    } else {
        container.innerHTML = html;
    }
}

async function handleWorkspaceDrop(asset) {
    // If batch, we need to split
    if (asset.is_batch) {
        handleProjectBatchSplit(asset, currentProjectId);
        return;
    }

    // Check if already staged
    if (workspaceStagedAssets.some(a => a.ID === asset.ID)) {
        showToast('Asset already in staging', 'info');
        return;
    }

    // Step 1: Assign to Project via existing API
    try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        console.log(`[Workspace] Sending POST to /api/projects/${currentProjectId}/assign-asset`);
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/assign-asset`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ AssetID: asset.ID, Type: 'Permanent' })
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Assignment failed');
        }

        // Step 2: Add to local staging list
        workspaceStagedAssets.push(asset);
        renderStagingArea();
        updateWorkspacePoProgress();
        showToast(`Staged: ${asset.ItemName}`, 'success');
        
        // Refresh project asset list in background
        loadProjectAssets(currentProjectId);
        // Refresh inventory list
        loadWorkspaceInventory(document.getElementById('workspaceSearch').value);

    } catch (err) {
        alert('Failed to stage asset: ' + err.message);
    }
}

function renderStagingArea() {
    const stagingArea = document.getElementById('workspaceStagingArea');
    if (!stagingArea) return;
    
    if (workspaceStagedAssets.length === 0) {
        stagingArea.innerHTML = '<div class="empty-state" style="text-align: center; color: #cbd5e1; margin-top: 100px;"><div style="font-size: 32px; margin-bottom: 10px;">📦</div><div style="font-size: 12px;">Drag items here to stage for DC</div></div>';
        return;
    }

    // Get all PO items for the dropdown
    let poOptions = '<option value="">-- Select PO Line Item --</option>';
    workspaceProjectPOs.forEach(po => {
        if (po.items) {
            po.items.forEach(item => {
                poOptions += `<option value="${item.ID}">${item.ItemDescription} (${item.QtyOrdered} ${item.UOM})</option>`;
            });
        }
    });

    stagingArea.innerHTML = workspaceStagedAssets.map((asset, index) => `
        <div style="padding: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                <div style="font-size: 20px;">📦</div>
                <div style="flex-grow: 1;">
                    <div style="font-weight: 600; font-size: 13px; color: #1e293b;">${asset.ItemName}</div>
                    <div style="font-size: 11px; color: #64748b; font-family: monospace;">${asset.ID}</div>
                </div>
                <button onclick="removeFromWorkspaceStaging(${index})" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px;">&times;</button>
            </div>
            
            <div style="border-top: 1px solid #f1f5f9; padding-top: 8px;">
                <label style="display: block; font-size: 10px; color: #94a3b8; margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">Matches PO Requirement:</label>
                <select onchange="tagAssetToPoItem(${index}, this.value)" style="width: 100%; padding: 5px; font-size: 11px; border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc;">
                    ${poOptions.replace(`value="${asset.linkedPoItemId || ''}"`, `value="${asset.linkedPoItemId || ''}" selected`)}
                </select>
            </div>
        </div>
    `).join('');
}

window.tagAssetToPoItem = async (assetIndex, poItemId) => {
    const asset = workspaceStagedAssets[assetIndex];
    console.log('[Workspace] Tagging asset', asset.ID, 'to PO item', poItemId);
    
    try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/assets/${encodeURIComponent(asset.ID)}/link-po-item`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ poItemId: poItemId ? parseInt(poItemId) : null })
        });

        if (res.ok) {
            asset.linkedPoItemId = poItemId ? parseInt(poItemId) : null;
            // IMPORTANT: Refresh PO data from server to get updated fulfilledQty
            await loadWorkspacePO(currentProjectId);
            updateWorkspacePoProgress();
            // Refresh orders tab if visible
            if (typeof loadProjectOrders === 'function') loadProjectOrders(currentProjectId);
        } else {
            const err = await res.json();
            alert('Failed to save link: ' + (err.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Link PO error:', err);
        alert('Error linking asset to PO');
    }
};

window.removeFromWorkspaceStaging = (index) => {
    workspaceStagedAssets.splice(index, 1);
    renderStagingArea();
    updateWorkspacePoProgress();
};

function updateWorkspacePoProgress() {
    const bar = document.getElementById('workspacePoBar');
    const percentText = document.getElementById('workspacePoPercent');
    const summary = document.getElementById('workspacePoSummary');
    if (!bar || !percentText) return;
    
    // Refresh the checklist UI
    renderWorkspacePoChecklist();

    if (workspaceProjectPOs.length > 0) {
        let totalRequired = 0;
        let totalFulfilled = 0;

        workspaceProjectPOs.forEach(po => {
            if (po.items && Array.isArray(po.items)) {
                po.items.forEach(item => {
                    const req = (parseFloat(item.QtyOrdered) || 0);
                    totalRequired += req;
                    
                    // Sum up server-side fulfillment + local staged tagging
                    const local = workspaceStagedAssets.filter(a => a.linkedPoItemId === item.ID).length;
                    totalFulfilled += Math.min(req, (item.fulfilledQty || 0) + local);
                });
            }
        });

        if (totalRequired > 0) {
            const progress = Math.min(100, Math.round((totalFulfilled / totalRequired) * 100));
            bar.style.width = `${progress}%`;
            percentText.textContent = `${progress}%`;
            
            if (summary) {
                summary.innerHTML = `<strong>${totalFulfilled}</strong> / <strong>${totalRequired}</strong> items fulfilled`;
            }
        } else {
            bar.style.width = '0%';
            percentText.textContent = '0%';
            if (summary) summary.innerHTML = '0 / 0 items fulfilled';
        }
    } else {
        bar.style.width = '0%';
        percentText.textContent = '0%';
        if (summary) summary.innerHTML = '0 / 0 items fulfilled';
    }
}

async function handleWorkspaceGenerateDC() {
    if (workspaceStagedAssets.length === 0) {
        alert('Please stage at least one asset first');
        return;
    }

    const project = allProjects.find(p => p.ID === currentProjectId);
    if (!project) return;

    // 1. Switch View to DC
    if (typeof window.showView === 'function') {
        window.showView('dc-view');
    } else {
        // Fallback for manual tab switching
        const dcView = document.getElementById('dc-view');
        if (dcView) {
            document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');
            dcView.style.display = 'block';
        }
    }

    // 2. Update Sidebar UI
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.id === 'nav-dc' || link.getAttribute('onclick')?.includes('dc-view')) {
            link.classList.add('active');
        }
    });

    // 3. Pre-fill DC form
    setTimeout(() => {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val || '';
                el.dispatchEvent(new Event('input'));
                el.dispatchEvent(new Event('change'));
            }
        };

        // Fill Project Reference
        setVal('dcRefNo', project.ProjectName);

        // Fill Asset IDs into the selected assets table
        if (typeof window.clearDCAssets === 'function' && typeof window.addAssetToDC === 'function') {
            window.clearDCAssets();
            workspaceStagedAssets.forEach(asset => {
                window.addAssetToDC(asset);
            });
        }
        
        // If a PO exists, link it and override fields with PO data
        if (workspaceProjectPOs.length > 0) {
            const po = workspaceProjectPOs[0];
            
            // Customer Name is Consignee Name from PO
            setVal('dcCustomerName', po.ConsigneeName);
            setVal('dcBuyerOrderNo', po.PONumber || po.OrderNo);
            setVal('dcRefDate', po.PODate || po.OrderDate);

            // Consignee Details from PO
            setVal('dcConsigneeName', po.ConsigneeName);
            setVal('dcConsigneeAddress', po.ConsigneeAddress);
            setVal('dcConsigneeGST', po.ConsigneeGSTIN);
            setVal('dcConsigneeState', po.ConsigneeState);
            setVal('dcConsigneeStateCode', po.ConsigneeStateCode);
            
            // Buyer Details from PO
            setVal('dcBuyerName', po.BuyerName);
            setVal('dcBuyerAddress', po.BuyerAddress);
            setVal('dcBuyerGST', po.BuyerGSTIN);
            setVal('dcBuyerState', po.BuyerState);
            setVal('dcBuyerStateCode', po.BuyerStateCode);
            
            // Link PO for status updates
            window.currentDC_POReference = {
                OrderID: po.ID,
                PONumber: po.PONumber || po.OrderNo
            };

            // Trigger project fetcher if exists
            const projectSearch = document.getElementById('dcProjectSearch');
            if (projectSearch) {
                projectSearch.value = project.ProjectName;
                projectSearch.dispatchEvent(new Event('input'));
            }
        } else {
            // Fallback to project info if no PO linked
            setVal('dcBuyerName', project.BuyerName);
            setVal('dcBuyerAddress', project.BuyerAddress);
            setVal('dcBuyerGST', project.BuyerGSTIN);
            setVal('dcBuyerState', project.BuyerState);
            setVal('dcBuyerStateCode', project.BuyerStateCode);
        }
        
        // Remove the automatic Mark as Shipped call here
        // The status will now be updated ONLY when the DC is actually saved in the backend.

        if (typeof showToast === 'function') {
            showToast('DC Form pre-filled from Workspace', 'success');
        }
    }, 500);
}

async function showAddTempAssetModal() {
    console.log('[Projects] showAddTempAssetModal called');
    
    if (!currentProjectId) {
        alert('Please select a project first');
        return;
    }

    let modal = document.getElementById('addTempAssetModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'addTempAssetModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.style.zIndex = '10001';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <span class="close-modal" onclick="document.getElementById('addTempAssetModal').style.display='none'">&times;</span>
                <h3>Add Temporary Asset</h3>
                <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Add an item that is not yet in the inventory.</p>
                
                <div class="form-group">
                    <label>Item Name *</label>
                    <input type="text" id="tempItemName" class="form-input" placeholder="e.g. Dell Monitor 24 inch">
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="form-group">
                        <label>Make</label>
                        <input type="text" id="tempMake" class="form-input" placeholder="e.g. Dell">
                    </div>
                    <div class="form-group">
                        <label>Model</label>
                        <input type="text" id="tempModel" class="form-input" placeholder="e.g. U2415">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="form-group">
                        <label>Quantity *</label>
                        <input type="number" id="tempQuantity" class="form-input" value="1" min="1">
                    </div>
                    <div class="form-group">
                        <label>Estimated Price</label>
                        <div style="display: flex; gap: 5px;">
                            <select id="tempCurrency" class="form-input" style="width: 70px;">
                                <option value="INR">₹</option>
                                <option value="USD">$</option>
                            </select>
                            <input type="number" id="tempPrice" class="form-input" placeholder="0.00">
                        </div>
                    </div>
                </div>

                <div class="modal-actions">
                    <button id="btnSubmitTempAsset" class="action-button blue">Add to Project</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Clear fields
    document.getElementById('tempItemName').value = '';
    document.getElementById('tempMake').value = '';
    document.getElementById('tempModel').value = '';
    document.getElementById('tempQuantity').value = '1';
    document.getElementById('tempPrice').value = '';

    // Submit Handler
    document.getElementById('btnSubmitTempAsset').onclick = async () => {
        const data = {
            ProjectId: currentProjectId,
            ItemName: document.getElementById('tempItemName').value,
            Make: document.getElementById('tempMake').value,
            Model: document.getElementById('tempModel').value,
            Quantity: parseInt(document.getElementById('tempQuantity').value),
            EstimatedPrice: parseFloat(document.getElementById('tempPrice').value) || 0,
            Currency: document.getElementById('tempCurrency').value
        };

        if (!data.ItemName || !data.Quantity) {
            alert('Please fill required fields');
            return;
        }

        try {
            const res = await fetch('/api/temporary-assets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) throw new Error('Failed to add temporary asset');
            
            showToast('Temporary asset added', 'success');
            modal.style.display = 'none';
            loadProjectTempAssets(currentProjectId);
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    modal.style.display = 'flex';
}
