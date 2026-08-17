import { fetchWithAuth } from './auth.js?v=6.60';

/**
 * Context Menu Logic for Hierarchy Pane
 * Handles Right-Click actions for Folders and Categories
 */

export function initContextMenu() {
    console.log('[ContextMenu] Initializing...');

    const sidebarTree = document.getElementById('sidebar-tree');
    if (!sidebarTree) {
        console.warn('[ContextMenu] #sidebar-tree not found, retrying...');
        setTimeout(initContextMenu, 500);
        return;
    }

    // Create Context Menu Element
    let menu = document.getElementById('custom-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'custom-context-menu';
        menu.className = 'custom-context-menu';
        menu.innerHTML = `
            <div class="menu-item" data-action="add-folder">
                <span class="menu-icon">📁</span> <span class="menu-label">Add Parent Folder</span>
            </div>
            <div class="menu-item" data-action="add-category">
                <span class="menu-icon">📂</span> <span class="menu-label">Add Category</span>
            </div>
            <div class="menu-item" data-action="add-item" style="display: none;">
                <span class="menu-icon">➕</span> <span class="menu-label">Add Item</span>
            </div>
            <div class="menu-divider" data-section="zoho"></div>
            <div class="menu-item" data-action="sync-zoho-catalog">
                <span class="menu-icon">🦊</span> Sync Zoho Catalog
            </div>
            <div class="menu-item" data-action="zoho-status">
                <span class="menu-icon">🛡️</span> Integration Status
            </div>
            <div class="menu-divider" data-section="refresh"></div>
            <div class="menu-item" data-action="refresh">
                <span class="menu-icon">🔄</span> <span class="menu-label">Refresh Hierarchy</span>
            </div>
        `;
        document.body.appendChild(menu);
    }

    // Hide menu on any click outside
    document.addEventListener('click', () => {
        menu.style.display = 'none';
    });

    // Handle Right Click
    sidebarTree.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        
        const x = e.clientX;
        const y = e.clientY;

        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        menu.style.display = 'block';

        const isInventoryContext = !!e.target.closest('#sidebar-inventory-container');
        const contextModule = isInventoryContext ? 'inventory' : 'assets';

        // Check what we clicked on
        const treeItem = e.target.closest('.tree-item-wrapper');
        const nodeDiv = e.target.closest('.tree-node');
        
        const contextType = treeItem ? treeItem.dataset.type : (nodeDiv ? nodeDiv.dataset.type : 'none');
        const contextName = treeItem ? treeItem.dataset.name : (nodeDiv ? nodeDiv.dataset.name : '');
        const contextId = treeItem ? treeItem.dataset.id : (nodeDiv ? nodeDiv.dataset.id : '');

        // Store context data for actions
        menu.dataset.contextType = contextType || 'none';
        menu.dataset.contextName = contextName || '';
        menu.dataset.contextId = contextId || '';
        menu.dataset.contextModule = contextModule;

        const addFolderLabel = menu.querySelector('[data-action="add-folder"] .menu-label');
        const addCategoryLabel = menu.querySelector('[data-action="add-category"] .menu-label');
        const addItemNode = menu.querySelector('[data-action="add-item"]');
        const addItemLabel = menu.querySelector('[data-action="add-item"] .menu-label');
        const refreshLabel = menu.querySelector('[data-action="refresh"] .menu-label');
        const zohoDivider = menu.querySelector('[data-section="zoho"]');
        const zohoSync = menu.querySelector('[data-action="sync-zoho-catalog"]');
        const zohoStatus = menu.querySelector('[data-action="zoho-status"]');

        if (contextModule === 'inventory') {
            if (addFolderLabel) addFolderLabel.textContent = 'Add Inventory Folder';
            if (addCategoryLabel) addCategoryLabel.textContent = 'Add Inventory Category';
            if (addItemLabel) addItemLabel.textContent = 'Add Inventory Item';
            if (refreshLabel) refreshLabel.textContent = 'Refresh Inventory';
            if (addItemNode) addItemNode.style.display = 'block';
            if (zohoDivider) zohoDivider.style.display = 'none';
            if (zohoSync) zohoSync.style.display = 'none';
            if (zohoStatus) zohoStatus.style.display = 'none';
        } else {
            if (addFolderLabel) addFolderLabel.textContent = 'Add Parent Folder';
            if (addCategoryLabel) addCategoryLabel.textContent = 'Add Category';
            if (refreshLabel) refreshLabel.textContent = 'Refresh Hierarchy';
            if (addItemNode) addItemNode.style.display = 'none';
            if (zohoDivider) zohoDivider.style.display = 'block';
            if (zohoSync) zohoSync.style.display = 'block';
            if (zohoStatus) zohoStatus.style.display = 'block';
        }
        
        console.log(`[ContextMenu] Clicked on: ${menu.dataset.contextType} (${menu.dataset.contextName}) ID: ${menu.dataset.contextId}`);
    });

    // Handle Menu Item Clicks
    menu.onclick = async (e) => {
        const item = e.target.closest('.menu-item');
        if (!item) return;

        const action = item.dataset.action;
        const contextType = menu.dataset.contextType;
        const contextName = menu.dataset.contextName;
        const contextId = menu.dataset.contextId;
        const contextModule = menu.dataset.contextModule || 'assets';

        console.log(`[ContextMenu] Executing action: ${action} on ${contextType}`);

        if (action === 'add-folder') {
            if (contextModule === 'inventory') {
                document.getElementById('btnAddInventoryFolder')?.click();
            } else {
                if (typeof window.openAddFolderModal === 'function') {
                    window.openAddFolderModal();
                } else {
                    const modal = document.getElementById('addFolderModal');
                    if (modal) modal.style.display = 'flex';
                }
            }
        } else if (action === 'add-category') {
            if (contextModule === 'inventory') {
                if (contextType === 'folder' && contextId) {
                    window.contextMenuTargetInventoryFolderId = contextId;
                    window.contextMenuTargetInventoryParentKindId = null;
                } else if (contextType === 'kind' && contextId) {
                    window.contextMenuTargetInventoryParentKindId = contextId;
                    const kind = (window.allInventoryKinds || []).find(k => String(k.ID || k.id || '') === String(contextId));
                    const folderId = kind ? String(kind.FolderId || kind.folderid || '') : '';
                    window.contextMenuTargetInventoryFolderId = folderId || null;
                } else {
                    window.contextMenuTargetInventoryFolderId = null;
                    window.contextMenuTargetInventoryParentKindId = null;
                }
                document.getElementById('btnAddInventoryCategory')?.click();
            } else {
                if (contextType === 'folder' && contextName) {
                    console.log(`[ContextMenu] Pre-selecting folder: ${contextName}`);
                    window.contextMenuTargetFolder = contextName;
                }

                if (typeof window.openAddKindModal === 'function') {
                    window.openAddKindModal();
                } else {
                    const modal = document.getElementById('addAssetKindModal');
                    if (modal) modal.style.display = 'flex';
                }
            }
        } else if (action === 'add-item') {
            if (contextModule === 'inventory') {
                document.getElementById('btnAddInventoryItem')?.click();
            }
        } else if (action === 'sync-zoho-catalog') {
            if (window.syncZohoCatalog) {
                window.syncZohoCatalog();
            } else {
                const confirmSync = confirm('Do you want to import/update the product catalog from Zoho CRM?\n\nThis will pull all Products into the Reference Catalog.');
                if (!confirmSync) return;

                try {
                    const token = localStorage.getItem('token');
                    const headers = { 'Content-Type': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;

                    const response = await fetchWithAuth('/api/zoho/sync-products', {
                        method: 'POST',
                        headers: headers
                    });

                    const result = await response.json();

                    if (response.ok) {
                        alert(`✅ Sync Complete: ${result.message}`);
                        if (window.loadAssetKinds) await window.loadAssetKinds();
                        if (window.renderSidebarTree) window.renderSidebarTree();
                    } else {
                        alert(`❌ Sync Failed: ${result.error || 'Unknown error'}`);
                    }
                } catch (err) {
                    console.error('[ZohoSync] Catalog Error:', err);
                    alert('Error connecting to sync service');
                }
            }
        } else if (action === 'zoho-status') {
            showZohoStatusModal();
        } else if (action === 'refresh') {
            if (contextModule === 'inventory') {
                if (typeof window.loadInventoryWorkspace === 'function') {
                    await window.loadInventoryWorkspace();
                } else if (window.renderSidebarTree) {
                    window.renderSidebarTree();
                }
            } else {
                if (window.loadAssetKinds) {
                    await window.loadAssetKinds();
                }
                if (window.renderSidebarTree) {
                    window.renderSidebarTree();
                }
            }
            if (typeof showToast === 'function') {
                showToast('Hierarchy refreshed', 'success');
            }
        }

        menu.style.display = 'none';
    };
}

/**
 * Displays a modal with Zoho integration health, OAuth connect/disconnect, and recent logs.
 * Never displays tokens or secrets.
 */
async function showZohoStatusModal() {
    let modal = document.getElementById('zohoStatusModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'zohoStatusModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.zIndex = '1000';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="background: white; padding: 25px; border-radius: 12px; width: 640px; max-width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
                <h2 style="margin: 0; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">🛡️</span> Zoho CRM Integration
                </h2>
                <button type="button" id="btnCloseZohoStatus" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #666;">&times;</button>
            </div>

            <div id="zohoHealthStatus" style="padding: 15px; border-radius: 8px; margin-bottom: 16px; background: #f3f4f6; display: flex; align-items: center; gap: 15px;">
                <div class="spinner" style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite;"></div>
                Checking connection to Zoho CRM...
            </div>

            <div id="zohoOAuthActions" style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;"></div>

            <h3 style="font-size: 14px; text-transform: uppercase; color: #666; margin-bottom: 10px;">Recent Sync Activity</h3>
            <div id="zohoSyncLogs" style="font-size: 13px;">
                <p style="color: #999;">Loading activity logs...</p>
            </div>
        </div>
        <style>
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .log-item { padding: 10px; border-bottom: 1px solid #f3f4f6; }
            .log-item:last-child { border-bottom: none; }
            .status-tag { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        </style>
    `;

    document.getElementById('btnCloseZohoStatus')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    const statusLabel = (status) => {
        const map = {
            CONNECTED: 'Connected',
            NOT_CONFIGURED: 'Not configured',
            NOT_AUTHORIZED: 'Not authorized',
            TOKEN_REFRESH_FAILED: 'Token refresh failed',
            ZOHO_UNREACHABLE: 'Zoho unreachable',
            API_ERROR: 'API error',
            DISCONNECTED: 'Disconnected'
        };
        return map[status] || status || 'Unknown';
    };

    const statusTone = (status) => {
        if (status === 'CONNECTED') return { bg: '#ecfdf5', color: '#065f46', icon: '✅' };
        if (status === 'NOT_AUTHORIZED' || status === 'NOT_CONFIGURED') return { bg: '#fffbeb', color: '#92400e', icon: '⚠️' };
        return { bg: '#fef2f2', color: '#991b1b', icon: '❌' };
    };

    try {
        const response = await fetchWithAuth('/api/zoho/status');
        const data = await response.json();
        const health = data.health || {};
        const tone = statusTone(health.status);
        const checkedAt = health.timestamp ? new Date(health.timestamp).toLocaleString() : '—';

        if (data.crmUi) {
            window.__zohoCrmUi = data.crmUi;
        }

        const healthEl = document.getElementById('zohoHealthStatus');
        healthEl.style.background = tone.bg;
        healthEl.style.color = tone.color;
        healthEl.innerHTML = `
            <span style="font-size: 20px;">${tone.icon}</span>
            <div>
                <strong>${statusLabel(health.status)}</strong><br>
                <span style="font-size: 12px; opacity: 0.85;">${health.message || ''}</span><br>
                <span style="font-size: 11px; opacity: 0.7;">Last check: ${checkedAt}</span>
            </div>
        `;

        const actions = document.getElementById('zohoOAuthActions');
        const canManageOAuth = (() => {
            try {
                const u = window.currentUser || JSON.parse(localStorage.getItem('user') || 'null');
                const role = u?.role;
                return role === 'admin' || role === 'superuser' || (Array.isArray(role) && (role.includes('admin') || role.includes('superuser')));
            } catch {
                return false;
            }
        })();

        if (actions) {
            if (!canManageOAuth) {
                actions.innerHTML = '<p style="font-size:12px;color:#6b7280;margin:0;">Admin authorization required to connect or disconnect Zoho.</p>';
            } else if (health.status === 'NOT_CONFIGURED') {
                actions.innerHTML = '<p style="font-size:12px;color:#92400e;margin:0;">Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REDIRECT_URL on the server, then reconnect.</p>';
            } else {
                const parts = [];
                if (health.status !== 'CONNECTED') {
                    parts.push(`<a id="btnZohoConnect" class="action-button" href="/api/zoho/oauth/authorize" style="background:#f59e0b;color:white;text-decoration:none;display:inline-flex;align-items:center;padding:8px 14px;border-radius:6px;font-weight:600;">Connect Zoho</a>`);
                }
                if (health.status === 'CONNECTED' || health.config?.tokenFile === 'PRESENT' || health.status === 'TOKEN_REFRESH_FAILED') {
                    parts.push(`<button type="button" id="btnZohoDisconnect" class="action-button" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">Disconnect Zoho</button>`);
                }
                if (health.status === 'CONNECTED') {
                    parts.push(`<span style="font-size:12px;color:#6b7280;align-self:center;">Disconnect removes OAuth tokens only. Catalog and local Zoho IDs are kept.</span>`);
                } else {
                    parts.push(`<span style="font-size:12px;color:#6b7280;align-self:center;">Opens Zoho authorization (India). Tokens never appear in the browser.</span>`);
                }
                actions.innerHTML = parts.join('\n');
            }

            document.getElementById('btnZohoDisconnect')?.addEventListener('click', async () => {
                if (!confirm('Disconnect Zoho authorization? Local catalog and asset Zoho IDs will be preserved.')) return;
                try {
                    const r = await fetchWithAuth('/api/zoho/oauth/disconnect', { method: 'POST' });
                    const body = await r.json();
                    if (!r.ok) throw new Error(body.error || 'Disconnect failed');
                    await showZohoStatusModal();
                } catch (e) {
                    alert(e.message || 'Disconnect failed');
                }
            });
        }

        const logsEl = document.getElementById('zohoSyncLogs');
        if (data.logs && data.logs.length > 0) {
            logsEl.innerHTML = data.logs.map(log => `
                <div class="log-item">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <strong>${String(log.operation || '').replace(/_/g, ' ')}</strong>
                        <span class="status-tag" style="background: ${log.status === 'SUCCESS' ? '#d1fae5' : '#fee2e2'}; color: ${log.status === 'SUCCESS' ? '#065f46' : '#991b1b'};">
                            ${log.status}
                        </span>
                    </div>
                    <div style="color: #666; font-size: 11px; display: flex; gap: 10px;">
                        <span>${new Date(log.created_at).toLocaleString()}</span>
                        ${log.zoho_id ? `<span>Zoho ID: ...${String(log.zoho_id).slice(-6)}</span>` : ''}
                    </div>
                    ${log.error_message ? `<div style="color: #991b1b; margin-top: 5px; font-family: monospace; font-size: 11px; background: #fff1f2; padding: 5px; border-radius: 4px;">${log.error_message}</div>` : ''}
                </div>
            `).join('');
        } else {
            logsEl.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No sync activity recorded yet.</p>';
        }
    } catch (err) {
        const healthEl = document.getElementById('zohoHealthStatus');
        if (healthEl) healthEl.innerHTML = 'Error loading status';
    }
}

/** Build Zoho Product UI URL using optional server-provided org template. */
function buildZohoProductUiUrl(zohoProductId) {
    const id = String(zohoProductId || '').trim();
    if (!id) return null;
    const tpl = window.__zohoCrmUi?.productUrlTemplate;
    if (tpl && tpl.includes('{id}')) return tpl.replace('{id}', encodeURIComponent(id));
    const orgId = window.__zohoCrmUi?.orgId || '60021949576';
    return `https://crm.zoho.in/crm/org${orgId}/tab/Products/${encodeURIComponent(id)}`;
}

window.buildZohoProductUiUrl = buildZohoProductUiUrl;
window.showZohoStatusModal = showZohoStatusModal;
