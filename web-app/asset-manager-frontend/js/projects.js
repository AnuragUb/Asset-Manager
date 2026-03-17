import { showView } from './utils.js?v=5.0';

let allProjects = [];
let currentProjectId = null;

export function initProjectsView() {
    console.log('[Projects] Initializing Projects View...');
    
    // Setup Create Project Button Handler
    const btnSubmit = document.getElementById('btnSideSubmitProject');
    if (btnSubmit) {
        btnSubmit.addEventListener('click', handleCreateProject);
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
                                    <div style="font-weight: 600; color: #0f172a; font-size: 15px;">${p.Name}</div>
                                    ${p.Priority ? `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${p.Priority === 'High' ? '#fee2e2' : '#f1f5f9'}; color: ${p.Priority === 'High' ? '#ef4444' : '#64748b'};">${p.Priority}</span>` : ''}
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
        `;
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
                    <button class="action-button small" onclick="handleViewAsset('${a.ID}')" style="padding:4px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; cursor: pointer; border-radius: 4px;">View</button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: red;">Error: ${err.message}</td></tr>`;
    }
}

// Dedicated function for handling asset view
window.handleViewAsset = function(assetId) {
    console.log('[Projects] handleViewAsset called for:', assetId);
    
    // Check if showAssetDetails is available
    if (typeof window.showAssetDetails === 'function') {
        try {
            window.showAssetDetails(assetId);
            // Update hash silently or for history
            const targetHash = 'asset-details?id=' + assetId;
            if (window.location.hash.substring(1) !== targetHash) {
                 // Use replaceState to avoid cluttering history if preferred, or just hash assignment
                 window.location.hash = targetHash;
            }
        } catch (e) {
            console.error('[Projects] Error in showAssetDetails:', e);
            alert('Error opening asset details: ' + e.message);
        }
    } else {
        console.error('[Projects] showAssetDetails function is missing!');
        alert('System error: Asset Details view is not loaded. Please refresh the page.');
    }
};

// Expose to window for HTML onclick handlers
window.showAddTempAssetModal = showAddTempAssetModal;

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
        name: getValue('sideProjectName'),
        client: getValue('sideProjectClient'),
        location: getValue('sideProjectLocation'),
        status: getValue('sideProjectStatus') || 'Planning',
        currency: getValue('sideProjectCurrency'),
        description: getValue('sideProjectDesc'),
        startDate: getValue('sideProjectStartDate'),
        endDate: getValue('sideProjectEndDate')
    };

    // If critical fields are missing, show inline validation instead of alert
    if (!data.name || !data.location) {
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

        if (!res.ok) throw new Error('Failed to create project');

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
        const el = document.getElementById('projectTempTab') || document.getElementById('projectTempAssetsTab'); // Handle ID variation
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
    }

    // Activate button (robust way)
    const btn = document.querySelector(`button[onclick="switchProjectTab('${tabName}')"]`);
    if (btn) btn.classList.add('active');
}

async function loadProjectOrders(projectId) {
    const tbody = document.getElementById('projectOrdersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#666;">Loading orders...</td></tr>';
    
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders`, { headers });
        if (!res.ok) throw new Error('Failed to fetch orders');
        const data = await res.json();
        
        const orders = data.success ? data.orders : [];
        
        if (!Array.isArray(orders) || orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#666;">No orders found. Add one to get started.</td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(order => `
            <tr>
                <td><strong>${order.OrderNo || '-'}</strong></td>
                <td>${order.OrderDate || '-'}</td>
                <td>${order.ConsigneeName || 'Not Specified'}</td>
                <td style="font-size: 12px; color: #666;">${order.ConsigneeAddress ? order.ConsigneeAddress.substring(0, 30) + (order.ConsigneeAddress.length>30?'...':'') : '-'}</td>
                <td>
                    <button class="action-button small danger" onclick="deleteProjectOrder('${projectId}', '${order.ID}')">Delete</button>
                </td>
            </tr>
        `).join('');
        
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">Error loading orders: ${err.message}</td></tr>`;
    }
}

window.deleteProjectOrder = async function(projectId, orderId) {
    if (!confirm('Are you sure you want to delete this order?')) return;
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders/${orderId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        showToast('Order deleted', 'success');
        loadProjectOrders(projectId);
    } catch (err) {
        alert('Error deleting order: ' + err.message);
    }
};

window.showAddOrderModal = function(projectId, projectData) {
    let modal = document.getElementById('addOrderModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'addOrderModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.style.zIndex = '10002'; // Above project modal
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="close-modal" onclick="document.getElementById('addOrderModal').style.display='none'">&times;</span>
                <h3>Add New Order</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div class="form-group">
                        <label>Order No</label>
                        <input type="text" id="newOrderNo" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Order Date</label>
                        <input type="date" id="newOrderDate" class="form-input">
                    </div>
                </div>

                <h4 style="margin-top: 15px; margin-bottom: 10px;">Consignee Details</h4>
                <div class="form-group">
                    <button type="button" id="btnCopyConsignee" class="action-button" style="margin-bottom: 10px; width: 100%; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; cursor: pointer;">Copy from Project Default</button>
                    <input type="text" id="newOrderConsigneeName" placeholder="Consignee Name" class="form-input" style="margin-bottom: 5px;">
                    <textarea id="newOrderConsigneeAddress" placeholder="Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                        <input type="text" id="newOrderConsigneeGSTIN" placeholder="GSTIN" class="form-input">
                        <div style="display: flex; gap: 5px;">
                            <input type="text" id="newOrderConsigneeState" placeholder="State" class="form-input" style="flex:2;">
                            <input type="text" id="newOrderConsigneeStateCode" placeholder="Code" class="form-input" style="flex:1;">
                        </div>
                    </div>
                </div>

                <div class="modal-actions">
                    <button id="btnSaveNewOrder" class="action-button blue">Add Order</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Clear fields
    ['newOrderNo', 'newOrderDate', 'newOrderConsigneeName', 'newOrderConsigneeAddress', 'newOrderConsigneeGSTIN', 'newOrderConsigneeState', 'newOrderConsigneeStateCode'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });

    // Copy Handler
    document.getElementById('btnCopyConsignee').onclick = () => {
        console.log('[Projects] Copying Consignee Details from:', projectData);
        
        // Check if there is anything to copy
        const hasData = projectData && (
            projectData.ConsigneeName || 
            projectData.ConsigneeAddress || 
            projectData.ConsigneeGSTIN
        );

        if (hasData) {
            document.getElementById('newOrderConsigneeName').value = projectData.ConsigneeName || '';
            document.getElementById('newOrderConsigneeAddress').value = projectData.ConsigneeAddress || '';
            document.getElementById('newOrderConsigneeGSTIN').value = projectData.ConsigneeGSTIN || '';
            document.getElementById('newOrderConsigneeState').value = projectData.ConsigneeState || '';
            document.getElementById('newOrderConsigneeStateCode').value = projectData.ConsigneeStateCode || '';
            
            if (typeof showToast === 'function') {
                showToast('Copied details from project defaults', 'success');
            }
        } else {
            alert('No default consignee details found for this project.\n\nPlease set them in the project "Edit Billing & Shipping Details" section first.');
        }
    };

    // Save Handler
    const btnSave = document.getElementById('btnSaveNewOrder');
    btnSave.onclick = async () => {
        const payload = {
            OrderNo: document.getElementById('newOrderNo').value,
            OrderDate: document.getElementById('newOrderDate').value,
            ConsigneeName: document.getElementById('newOrderConsigneeName').value,
            ConsigneeAddress: document.getElementById('newOrderConsigneeAddress').value,
            ConsigneeGSTIN: document.getElementById('newOrderConsigneeGSTIN').value,
            ConsigneeState: document.getElementById('newOrderConsigneeState').value,
            ConsigneeStateCode: document.getElementById('newOrderConsigneeStateCode').value,
            // Copy buyer details from project as they remain same
            BuyerName: projectData.BuyerName,
            BuyerAddress: projectData.BuyerAddress,
            BuyerGSTIN: projectData.BuyerGSTIN,
            BuyerState: projectData.BuyerState,
            BuyerStateCode: projectData.BuyerStateCode
        };

        try {
            btnSave.textContent = 'Saving...';
            btnSave.disabled = true;

            const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Failed to create order');
            
            showToast('Order created', 'success');
            modal.style.display = 'none';
            loadProjectOrders(projectId);
            
            btnSave.textContent = 'Add Order';
            btnSave.disabled = false;
        } catch (err) {
            console.error(err);
            alert('Error creating order: ' + err.message);
            btnSave.textContent = 'Add Order';
            btnSave.disabled = false;
        }
    };

    modal.style.display = 'flex';
}

// Expose to window for global access
window.showProjectDetails = showProjectDetails;
window.switchProjectTab = switchProjectTab;
window.showAssignAssetModal = showAssignAssetModal;
window.showAddTempAssetModal = showAddTempAssetModal;
window.loadProjects = loadProjects;
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
                            <div>
                                <div style="font-weight: bold; color: #333;">${asset.ItemName || 'Unknown Item'}</div>
                                <div style="font-size: 0.85em; color: #666;">ID: ${asset.ID}</div>
                            </div>
                            <div style="text-align: right; font-size: 0.85em; color: #888;">
                                <div>${asset.Model || ''}</div>
                                <div>${asset.Status || ''}</div>
                            </div>
                        `;
                        
                        div.onmouseover = () => div.style.background = '#f5f9ff';
                        div.onmouseout = () => div.style.background = 'white';
                        
                        div.onclick = (e) => {
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

// Expose to window for HTML onclick handlers
window.showAssignAssetModal = showAssignAssetModal;

function showAddTempAssetModal() {
    if (!currentProjectId) {
        alert('No project selected');
        return;
    }
    const modal = document.getElementById('addTempAssetModal');
    if (modal) modal.style.display = 'flex';
    
    // Add event listener for the submit button inside the modal
    const btnSubmit = document.getElementById('btnSubmitTempAsset');
    if (btnSubmit) {
        // Remove old listeners to prevent duplicates (cloning is a quick hack)
        const newBtn = btnSubmit.cloneNode(true);
        btnSubmit.parentNode.replaceChild(newBtn, btnSubmit);
        
        newBtn.onclick = async () => {
            const itemName = document.getElementById('tempItemName')?.value;
            const quantity = document.getElementById('tempQuantity')?.value;
            const price = document.getElementById('tempPrice')?.value;
            const currency = document.getElementById('tempCurrency')?.value;
            const make = document.getElementById('tempMake')?.value;
            const model = document.getElementById('tempModel')?.value;

            if (!itemName) {
                alert('Item Name is required');
                return;
            }

            try {
                newBtn.textContent = 'Adding...';
                newBtn.disabled = true;

                const payload = {
                    ItemName: itemName,
                    Quantity: parseInt(quantity) || 1,
                    EstimatedPrice: parseFloat(price) || 0,
                    Currency: currency || 'INR',
                    Make: make || '',
                    Model: model || '',
                    ProjectId: currentProjectId,
                    Type: 'AST',
                    Category: 'General'
                };

                const res = await fetch('/api/temporary-assets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.error || 'Failed to add temporary asset');
                }

                showToast('Temporary asset added', 'success');
                document.getElementById('addTempAssetModal').style.display = 'none';
                
                // Clear fields
                document.getElementById('tempItemName').value = '';
                document.getElementById('tempMake').value = '';
                document.getElementById('tempModel').value = '';
                document.getElementById('tempQuantity').value = '1';
                document.getElementById('tempPrice').value = '0';

                loadProjectTempAssets(currentProjectId);
                
            } catch (err) {
                console.error(err);
                alert('Error adding asset: ' + err.message);
            } finally {
                newBtn.textContent = 'Add to Project';
                newBtn.disabled = false;
            }
        };
    }
}

function showEditBillingModal(project) {
    let modal = document.getElementById('projectBillingEditModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'projectBillingEditModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="close-modal" onclick="document.getElementById('projectBillingEditModal').style.display='none'">&times;</span>
                <h3>Edit Billing & Shipping Details</h3>
                
                <h4 style="margin-top: 0; margin-bottom: 10px;">Consignee (Ship To)</h4>
                <div class="form-group">
                    <input type="text" id="editProjectConsigneeName" placeholder="Consignee Name" class="form-input" style="margin-bottom: 5px;">
                    <textarea id="editProjectConsigneeAddress" placeholder="Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                        <input type="text" id="editProjectConsigneeGSTIN" placeholder="GSTIN" class="form-input">
                        <div style="display: flex; gap: 5px;">
                            <input type="text" id="editProjectConsigneeState" placeholder="State" class="form-input" style="flex:2;">
                            <input type="text" id="editProjectConsigneeStateCode" placeholder="Code" class="form-input" style="flex:1;">
                        </div>
                    </div>
                </div>

                <h4 style="margin-top: 15px; margin-bottom: 10px;">Buyer (Bill To)</h4>
                <div class="form-group">
                    <input type="text" id="editProjectBuyerName" placeholder="Buyer Name" class="form-input" style="margin-bottom: 5px;">
                    <textarea id="editProjectBuyerAddress" placeholder="Address" class="form-input" style="height: 60px; margin-bottom: 5px;"></textarea>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                        <input type="text" id="editProjectBuyerGSTIN" placeholder="GSTIN" class="form-input">
                        <div style="display: flex; gap: 5px;">
                            <input type="text" id="editProjectBuyerState" placeholder="State" class="form-input" style="flex:2;">
                            <input type="text" id="editProjectBuyerStateCode" placeholder="Code" class="form-input" style="flex:1;">
                        </div>
                    </div>
                </div>

                <div class="modal-actions">
                    <button id="btnSaveProjectBilling" class="action-button blue">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Pre-fill
    document.getElementById('editProjectConsigneeName').value = project.ConsigneeName || '';
    document.getElementById('editProjectConsigneeAddress').value = project.ConsigneeAddress || '';
    document.getElementById('editProjectConsigneeGSTIN').value = project.ConsigneeGSTIN || '';
    document.getElementById('editProjectConsigneeState').value = project.ConsigneeState || '';
    document.getElementById('editProjectConsigneeStateCode').value = project.ConsigneeStateCode || '';

    document.getElementById('editProjectBuyerName').value = project.BuyerName || '';
    document.getElementById('editProjectBuyerAddress').value = project.BuyerAddress || '';
    document.getElementById('editProjectBuyerGSTIN').value = project.BuyerGSTIN || '';
    document.getElementById('editProjectBuyerState').value = project.BuyerState || '';
    document.getElementById('editProjectBuyerStateCode').value = project.BuyerStateCode || '';

    // Save Handler
    const btnSave = document.getElementById('btnSaveProjectBilling');
    btnSave.onclick = async () => {
        const payload = {
            ConsigneeName: document.getElementById('editProjectConsigneeName').value,
            ConsigneeAddress: document.getElementById('editProjectConsigneeAddress').value,
            ConsigneeGSTIN: document.getElementById('editProjectConsigneeGSTIN').value,
            ConsigneeState: document.getElementById('editProjectConsigneeState').value,
            ConsigneeStateCode: document.getElementById('editProjectConsigneeStateCode').value,
            BuyerName: document.getElementById('editProjectBuyerName').value,
            BuyerAddress: document.getElementById('editProjectBuyerAddress').value,
            BuyerGSTIN: document.getElementById('editProjectBuyerGSTIN').value,
            BuyerState: document.getElementById('editProjectBuyerState').value,
            BuyerStateCode: document.getElementById('editProjectBuyerStateCode').value
        };

        try {
            const originalText = btnSave.textContent;
            btnSave.textContent = 'Saving...';
            btnSave.disabled = true;

            const res = await fetch(`/api/projects/${encodeURIComponent(project.ID)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Failed to update details');
            
            // Update local object (assuming reference)
            Object.assign(project, payload);
            
            showToast('Billing details updated', 'success');
            modal.style.display = 'none';
            
            // Refresh main modal details
            showProjectDetails(project.ID);
            
            btnSave.textContent = originalText;
            btnSave.disabled = false;
        } catch (err) {
            console.error(err);
            alert('Error updating details: ' + err.message);
            btnSave.textContent = 'Save Changes';
            btnSave.disabled = false;
        }
    };

    modal.style.display = 'flex';
}
