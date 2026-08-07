import { showToast } from './utils.js?v=6.60';
import { HierarchyManager } from './hierarchy.js?v=6.60';

const state = {
    initialized: false,
    folders: [],
    kinds: [],
    items: [],
    selectedNodeId: null,
    catalogMode: false,
    catalog: [],
    pageSize: 12,
    pageByKey: {}
};

window.currentInventorySidebar = window.currentInventorySidebar || null;

function isInventoryPreviewEnabled() {
    return true; // Always enabled on frontend; backend uses FEATURE_INVENTORY_ENABLED to opt-out globally.
}

function getEl(id) {
    return document.getElementById(id);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (err) {
            data = { message: text };
        }
    }
    if (!response.ok) {
        throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
    }
    return data;
}

function ensureModalShell() {
    if (getEl('inventoryCrudModal')) return;

    const modal = document.createElement('div');
    modal.id = 'inventoryCrudModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 560px;">
            <span class="close-modal" id="closeInventoryCrudModal">&times;</span>
            <div id="inventoryCrudModalBody"></div>
        </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = getEl('closeInventoryCrudModal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

function buildHierarchyManager() {
    const mappedFolders = state.folders.map(folder => ({
        ...folder,
        ID: folder.ID || folder.id,
        Name: folder.Name || folder.name,
        ParentID: folder.ParentId || folder.parentid || null,
        Module: 'Inventory',
        Icon: folder.Icon || folder.icon || '📁',
        type: 'folder'
    }));

    const mappedKinds = state.kinds.map(kind => ({
        ...kind,
        ID: kind.ID || kind.id,
        Name: kind.Name || kind.name,
        ParentID: kind.ParentId || kind.parentid || kind.FolderId || kind.folderid || null,
        Module: 'Inventory',
        Icon: kind.Icon || kind.icon || '📦',
        type: 'kind'
    }));

    return new HierarchyManager([...mappedFolders, ...mappedKinds]);
}

function renderInventoryTree() {
    const treeHost = getEl('inventoryHierarchyTree');
    if (!treeHost) return;

    const manager = buildHierarchyManager();
    const activeId = state.selectedNodeId;
    const treeHtml = manager.generateSidebarHTML(manager.tree, 0, activeId);

    treeHost.innerHTML = `
        <div class="tree-node" style="user-select: none;">
            <div class="tree-item-wrapper ${!activeId && !state.catalogMode ? 'active' : ''}" data-role="inventory-root" style="padding-left: 12px;">
                <span class="tree-icon">📦</span>
                <span class="tree-link ${!activeId && !state.catalogMode ? 'active' : ''}" data-role="inventory-root">All Inventory</span>
            </div>
        </div>
        ${treeHtml || '<div style="padding: 12px; color: #666;">No inventory folders or categories yet.</div>'}
    `;

    const rootLink = treeHost.querySelector('[data-role="inventory-root"]');
    if (rootLink) {
        rootLink.onclick = (event) => {
            event.preventDefault();
            state.selectedNodeId = null;
            state.catalogMode = false;
            renderInventoryTree();
            renderInventoryItems();
        };
    }

    treeHost.querySelectorAll('.tree-link[data-id], .tree-item-wrapper[data-id]').forEach(node => {
        if (node.dataset.inventoryBound === 'true') return;
        node.dataset.inventoryBound = 'true';
        node.addEventListener('click', (event) => {
            event.preventDefault();
            const id = node.dataset.id;
            if (!id) return;
            state.selectedNodeId = id;
            state.catalogMode = false;
            renderInventoryTree();
            renderInventoryItems();
        });
    });
}

function renderInventoryOverviewWidget(items, title) {
    const inventoryView = getEl('inventory-view');
    const content = getEl('inventoryContent');
    if (!inventoryView || !content) return;

    let widget = getEl('inventoryOverviewWidget');
    if (!widget) {
        widget = document.createElement('div');
        widget.id = 'inventoryOverviewWidget';
        widget.style.display = 'none';
        widget.style.marginBottom = '18px';
        widget.style.padding = '15px';
        widget.style.background = '#f8f9fa';
        widget.style.borderRadius = '8px';
        widget.style.border = '1px solid #e0e0e0';

        if (content.parentElement) {
            content.parentElement.insertBefore(widget, content);
        } else {
            inventoryView.appendChild(widget);
        }
    }

    const totalItems = items.length;
    const totalQty = items.reduce((sum, item) => sum + Number(item.QuantityTotal || item.quantity_total || 0), 0);
    const availableQty = items.reduce((sum, item) => sum + Number(item.QuantityAvailable || item.quantity_available || 0), 0);
    const inStore = items.filter(i => String(i.Status || i.status || '').toLowerCase() === 'in store').length;
    const inUse = items.filter(i => ['in use', 'in-use'].includes(String(i.Status || i.status || '').toLowerCase())).length;
    const inProject = items.filter(i => ['in project', 'project'].includes(String(i.Status || i.status || '').toLowerCase())).length;
    const sets = items.filter(i => Number(i.IsSet ?? i.is_set ?? 0) === 1).length;

    widget.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px;">
            <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #007bff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: 700;">${escapeHtml(title)} Items</div>
                <div style="font-size: 26px; font-weight: 800; color: #1e293b; margin-top: 6px;">${totalItems.toLocaleString()}</div>
            </div>
            <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #36b37e; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: 700;">Total Qty</div>
                <div style="font-size: 26px; font-weight: 800; color: #1e293b; margin-top: 6px;">${totalQty.toLocaleString()}</div>
            </div>
            <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: 700;">Available Qty</div>
                <div style="font-size: 26px; font-weight: 800; color: #1e293b; margin-top: 6px;">${availableQty.toLocaleString()}</div>
            </div>
            <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #7e22ce; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 11px; color: #666; text-transform: uppercase; font-weight: 700;">Sets</div>
                <div style="font-size: 26px; font-weight: 800; color: #1e293b; margin-top: 6px;">${sets.toLocaleString()}</div>
            </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px;">
            <span style="background: #eef6ff; color: #0f5ea8; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 12px;">In Store: ${inStore}</span>
            <span style="background: #eef2ff; color: #4338ca; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 12px;">In Use: ${inUse}</span>
            <span style="background: #fff7e6; color: #b76a00; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 12px;">In Project: ${inProject}</span>
        </div>
    `;
}

function setWorkspaceChrome(mode = 'inventory') {
    const workspaceTitle = getEl('inventoryWorkspaceTitle');
    const workspaceBadge = getEl('inventoryWorkspaceBadge');
    const actions = getEl('inventoryWorkspaceActions');
    const showItemsBtn = getEl('btnInventoryShowItems');
    const addFolderBtn = getEl('btnAddInventoryFolder');
    const addCategoryBtn = getEl('btnAddInventoryCategory');
    const addItemBtn = getEl('btnAddInventoryItem');

    if (mode === 'catalog') {
        if (workspaceTitle) workspaceTitle.textContent = 'Zoho Product Catalog';
        if (workspaceBadge) workspaceBadge.textContent = 'Read Only';
        if (workspaceBadge) workspaceBadge.style.background = '#fffbeb';
        if (workspaceBadge) workspaceBadge.style.color = '#b76a00';
        if (actions) actions.style.display = 'flex';
        if (showItemsBtn) showItemsBtn.style.display = '';
        if (addFolderBtn) addFolderBtn.style.display = 'none';
        if (addCategoryBtn) addCategoryBtn.style.display = 'none';
        if (addItemBtn) addItemBtn.style.display = 'none';
        return;
    }

    if (workspaceTitle) workspaceTitle.textContent = 'Inventory Workspace';
    if (workspaceBadge) workspaceBadge.textContent = 'Inventory';
    if (workspaceBadge) workspaceBadge.style.background = '#eef6ff';
    if (workspaceBadge) workspaceBadge.style.color = '#0f5ea8';
    if (actions) actions.style.display = 'flex';
    if (showItemsBtn) showItemsBtn.style.display = '';
    if (addFolderBtn) addFolderBtn.style.display = '';
    if (addCategoryBtn) addCategoryBtn.style.display = '';
    if (addItemBtn) addItemBtn.style.display = '';
}

function getSelectedNode() {
    if (!state.selectedNodeId) return null;
    const manager = buildHierarchyManager();
    return manager.findNode(state.selectedNodeId);
}

function getFilteredInventoryItems() {
    if (!state.selectedNodeId) return [...state.items];

    const manager = buildHierarchyManager();
    const selectedNode = manager.findNode(state.selectedNodeId);
    if (!selectedNode) return [...state.items];

    const descendants = manager.getDescendants(selectedNode.ID, true);
    const folderIds = descendants.filter(node => node.type === 'folder').map(node => String(node.ID));
    const kindIds = descendants.filter(node => node.type === 'kind').map(node => String(node.ID));

    return state.items.filter(item => {
        const folderId = String(item.FolderId || item.folderid || '');
        const kindId = String(item.KindId || item.kindid || '');
        if (selectedNode.type === 'folder') {
            return folderIds.includes(folderId) || kindIds.includes(kindId);
        }
        return kindIds.includes(kindId);
    });
}

function getNodeLabel(node) {
    if (!node) return 'All Inventory';
    return node.Name || node.name || 'Inventory';
}

function getPageForKey(key) {
    return Math.max(1, Number(state.pageByKey[key] || 1));
}

function setPageForKey(key, page) {
    state.pageByKey[key] = Math.max(1, Number(page || 1));
}

function resetPagination(prefix = '') {
    if (!prefix) {
        state.pageByKey = {};
        return;
    }
    Object.keys(state.pageByKey).forEach(key => {
        if (key.startsWith(prefix)) {
            delete state.pageByKey[key];
        }
    });
}

function paginateRows(items, key) {
    const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
    const currentPage = Math.min(getPageForKey(key), totalPages);
    setPageForKey(key, currentPage);
    const start = (currentPage - 1) * state.pageSize;
    return {
        pageItems: items.slice(start, start + state.pageSize),
        currentPage,
        totalPages,
        totalItems: items.length,
        key
    };
}

function renderPaginationControls(meta, label = 'items') {
    if (!meta || meta.totalPages <= 1) return '';
    return `
        <div class="inventory-pagination" data-pagination-key="${escapeHtml(meta.key)}" style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 14px;">
            <button class="action-button grey inventory-page-btn" data-pagination-key="${escapeHtml(meta.key)}" data-page="${meta.currentPage - 1}" ${meta.currentPage <= 1 ? 'disabled' : ''}>Prev</button>
            <span style="font-size: 12px; color: #667085; font-weight: 600;">Page ${meta.currentPage} of ${meta.totalPages} · ${meta.totalItems} ${label}</span>
            <button class="action-button blue inventory-page-btn" data-pagination-key="${escapeHtml(meta.key)}" data-page="${meta.currentPage + 1}" ${meta.currentPage >= meta.totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatInventoryStatus(status) {
    const normalized = String(status || 'In Store').trim();
    if (normalized.toLowerCase() === 'in store') return 'in-store';
    if (normalized.toLowerCase() === 'in use' || normalized.toLowerCase() === 'in-use') return 'in-use';
    if (normalized.toLowerCase() === 'in project' || normalized.toLowerCase() === 'project') return 'project';
    if (normalized.toLowerCase() === 'under inspection') return 'under-inspection';
    return 'others';
}

function populateInventoryHierarchyInSharedModal(existingItem = null) {
    const folderSelect = getEl('itemFolder');
    const kindSelect = getEl('itemKind');
    const brandSelect = getEl('itemBrandCategory');
    const idDisplay = getEl('kindIdentifierDisplay');

    if (!folderSelect || !kindSelect || !brandSelect) return;

    const folders = state.folders.map(folder => ({
        id: String(folder.ID || folder.id || ''),
        name: String(folder.Name || folder.name || '')
    })).filter(folder => folder.id && folder.name);

    const kinds = state.kinds.map(kind => ({
        id: String(kind.ID || kind.id || ''),
        name: String(kind.Name || kind.name || ''),
        folderid: String(kind.FolderId || kind.folderid || '')
    })).filter(kind => kind.id && kind.name);

    const selectedFolderId = String(existingItem?.FolderId || existingItem?.folderid || '');
    const selectedKindId = String(existingItem?.KindId || existingItem?.kindid || '');

    const rebuildKinds = (folderId, preferredKindId = '') => {
        kindSelect.innerHTML = '<option value="" disabled selected>Select Category...</option>';
        kinds.filter(kind => kind.folderid === String(folderId || '')).forEach(kind => {
            const opt = document.createElement('option');
            opt.value = kind.id;
            opt.textContent = kind.name;
            kindSelect.appendChild(opt);
        });
        kindSelect.disabled = !folderId;
        if (preferredKindId) kindSelect.value = preferredKindId;
    };

    folderSelect.innerHTML = '<option value="" disabled selected>Select Folder...</option>';
    folders.forEach(folder => {
        const opt = document.createElement('option');
        opt.value = folder.id;
        opt.textContent = folder.name;
        folderSelect.appendChild(opt);
    });
    folderSelect.value = selectedFolderId;

    brandSelect.innerHTML = '<option value="" selected>Generic / Default</option>';
    brandSelect.disabled = true;
    if (idDisplay) idDisplay.style.display = 'none';

    rebuildKinds(selectedFolderId, selectedKindId);

    folderSelect.onchange = () => {
        rebuildKinds(folderSelect.value, '');
    };
    kindSelect.onchange = () => {
        brandSelect.innerHTML = '<option value="" selected>Generic / Default</option>';
        brandSelect.disabled = true;
    };
}

function openInventorySharedModal(existingItem = null) {
    if (typeof window.openAddItemModal !== 'function') {
        showToast('Shared asset modal is not available.', 'error');
        return;
    }

    window.openAddItemModal('Inventory');

    const form = getEl('addAssetItemForm');
    const modal = getEl('addAssetItemModal');
    const title = getEl('addItemModalTitle');
    const submitBtn = form?.querySelector('button[type="submit"]');
    const assetDbId = getEl('assetDbId');
    const editActions = getEl('editAssetActions');
    const childrenSection = getEl('childrenSection');
    const splitAssetsSection = getEl('splitAssetsSection');
    const qtyHistorySection = getEl('qtyHistorySection');
    const bulkActions = document.querySelector('#addAssetItemModal form > div[style*="position: sticky"] div:last-child');
    const btnOpenQtyHistory = getEl('btnOpenQtyHistory');
    const qtyFieldsContainer = getEl('qtyFieldsContainer');
    const qtyToggle = getEl('itemIsQtyTracked');
    const qtyTotalEl = getEl('itemQtyTotal');

    if (!form || !modal) return;

    const itemId = String(existingItem?.ID || existingItem?.id || '').trim();
    const isEdit = !!itemId;

    // ---------- 📅 INLINE QTY HISTORY BUTTON (next to Quantity Total) ----------
    const showInlineHistoryBtn = (visible) => {
        if (!btnOpenQtyHistory) return;
        btnOpenQtyHistory.style.display = (visible && isEdit) ? 'inline-flex' : 'none';
    };
    const updateHistoryBtnVisibility = () => {
        if (!qtyToggle) { showInlineHistoryBtn(true); return; }
        showInlineHistoryBtn(qtyToggle.checked);
    };
    if (btnOpenQtyHistory) {
        btnOpenQtyHistory.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isEdit) return;
            if (typeof window.showQuantityHistoryModal === 'function') {
                window.showQuantityHistoryModal(itemId);
            } else {
                import('./quantity-history-modal.js?v=6.93').then(m => {
                    if (m && m.showQuantityHistoryModal) m.showQuantityHistoryModal(itemId);
                    else if (window.showQuantityHistoryModal) window.showQuantityHistoryModal(itemId);
                }).catch(err => console.error('[QTY-HISTORY-BTN] import err', err));
            }
        };
    }
    if (qtyToggle) {
        qtyToggle.addEventListener('change', updateHistoryBtnVisibility);
    }
    // Show immediately by default on edit (since qty tracking default on)
    updateHistoryBtnVisibility();

    window.__inventoryModalActive = true;
    form.dataset.entity = 'inventory';
    delete form.dataset.catalogZohoProductId;
    delete form.dataset.catalogUuid;
    form.dataset.inventoryEditId = itemId;
    form.dataset.inventoryPriorTotal = existingItem
        ? String(existingItem?.QuantityTotal ?? existingItem?.quantity_total ?? existingItem?.QtyOrdered ?? '')
        : '';
    form.dataset.inventoryAvailableCurrent = existingItem
        ? String(existingItem?.QuantityAvailable ?? existingItem?.quantity_available ?? 0)
        : '';
    form.dataset.inventoryWasQtyTracked = existingItem
        ? String(Number(existingItem?.IsQuantityTracked ?? existingItem?.is_quantity_tracked ?? 0))
        : '0';

    if (title) title.textContent = existingItem ? `Edit Inventory: ${existingItem.ID || existingItem.id}` : 'Add Inventory Item';
    if (submitBtn) submitBtn.textContent = existingItem ? 'Save Inventory Item' : 'Add Inventory Item';
    if (assetDbId) assetDbId.value = '';
    if (editActions) {
        editActions.style.display = isEdit ? 'flex' : 'none';
        const viewHistoryFullBtn = getEl('btnViewAssetHistory');
        if (viewHistoryFullBtn && isEdit) {
            viewHistoryFullBtn.href = `/asset/${encodeURIComponent(itemId)}`;
            viewHistoryFullBtn.textContent = '📜 View Full Inventory Details';
            viewHistoryFullBtn.target = '_blank';
        }
    }
    if (childrenSection) childrenSection.style.display = 'block';
    if (splitAssetsSection) splitAssetsSection.style.display = 'none';
    if (qtyHistorySection) qtyHistorySection.style.display = isEdit ? 'block' : 'none';
    if (bulkActions) bulkActions.style.display = 'none';

    populateInventoryHierarchyInSharedModal(existingItem);

    resetInventoryChildrenUI(existingItem);
    // Pre-render empty placeholder (will populate after API fetch below)
    renderInventoryQtyTimeline(existingItem, []);

    const setVal = (id, value) => {
        const el = getEl(id);
        if (el) el.value = value ?? '';
    };
    const setChecked = (id, checked) => {
        const el = getEl(id);
        if (el) el.checked = !!checked;
    };

    setVal('itemName', existingItem?.ItemName || existingItem?.itemname || '');
    setVal('itemDescription', existingItem?.ItemDescription || existingItem?.itemdescription || '');
    setVal('itemIcon', existingItem?.Icon || existingItem?.icon || '📦');
    if (window.updateIconPreview) window.updateIconPreview(existingItem?.Icon || existingItem?.icon || '📦');
    setVal('itemStatus', existingItem?.Status || existingItem?.status || 'In Store');
    setVal('itemMake', existingItem?.Make || existingItem?.make || '');
    setVal('itemModel', existingItem?.Model || existingItem?.model || '');
    setVal('itemSrNo', existingItem?.SrNo || existingItem?.srno || '');
    setVal('itemLocation', existingItem?.CurrentLocation || existingItem?.currentlocation || 'Mumbai');
    setVal('itemDate', existingItem?.DispatchReceiveDt || existingItem?.dispatchreceivedt || '');
    setVal('itemPurchase', existingItem?.PurchaseDetails || existingItem?.purchasedetails || '');
    setVal('itemHsnCode', existingItem?.HSNCode || existingItem?.hsn_code || '');
    setVal('itemRemarks', existingItem?.Remarks || existingItem?.remarks || '');
    setVal('itemWeight', existingItem?.Weight || existingItem?.weight || '');
    setVal('itemWarranty', existingItem?.warranty_months || 0);
    setVal('itemAMC', existingItem?.amc_months || 0);
    setVal('itemValue', existingItem?.AssetValue || existingItem?.asset_value || 0);
    setVal('itemCurrency', existingItem?.Currency || existingItem?.currency || 'INR');
    setVal('itemPurchaseDate', existingItem?.PurchaseDate || existingItem?.purchasedate || '');
    setVal('itemPurpose', existingItem?.Purpose || existingItem?.purpose || 'Owned');
    setVal('itemParentId', existingItem?.ParentId || existingItem?.parentid || '');
    setVal('itemQtyUnit', existingItem?.quantity_unit || 'Nos');
    setVal('itemQtyTotal', existingItem?.QuantityTotal ?? existingItem?.quantity_total ?? '1');
    setVal('itemQtyPrecision', existingItem?.QuantityPrecision ?? existingItem?.quantity_precision ?? 0);
    setVal('itemQtyNote', existingItem?.quantity_note || '');
    setVal('itemConvUnit', existingItem?.conversion_unit || '');
    setVal('itemConvFactor', existingItem?.conversion_factor ?? '');
    setVal('itemConvMode', existingItem?.conversion_mode || 'multiply');
    setVal('itemMAC', existingItem?.MACAddress || existingItem?.macaddress || '');
    setVal('itemIP', existingItem?.IPAddress || existingItem?.ipaddress || '');
    setVal('itemNetworkType', existingItem?.NetworkType || existingItem?.networktype || 'DHCP');
    setVal('itemPhysicalPort', existingItem?.PhysicalPort || existingItem?.physicalport || '');
    setVal('itemVLAN', existingItem?.VLAN || existingItem?.vlan || '');
    setVal('itemSocketID', existingItem?.SocketID || existingItem?.socketid || '');
    setVal('itemUserID', existingItem?.UserID || existingItem?.userid || '');

    setChecked('itemWarrantyTracking', (existingItem?.warranty_tracking ?? 1) !== 0);
    const existingTracked = Number(existingItem?.IsQuantityTracked ?? existingItem?.is_quantity_tracked ?? 1) !== 0;
    setChecked('itemIsQtyTracked', existingTracked);
    setChecked('itemIsSet', Number(existingItem?.IsSet ?? existingItem?.is_set ?? 0) === 1);

    if (qtyToggle) {
        qtyToggle.disabled = false;
        const onToggle = () => {
            if (qtyFieldsContainer) qtyFieldsContainer.style.display = qtyToggle.checked ? 'grid' : 'none';
            if (qtyToggle.checked) {
                const qtyUnitEl = getEl('itemQtyUnit');
                const qtyPrecisionEl = getEl('itemQtyPrecision');
                if (qtyUnitEl && !String(qtyUnitEl.value || '').trim()) qtyUnitEl.value = 'Nos';
                if (qtyTotalEl && !String(qtyTotalEl.value || '').trim()) qtyTotalEl.value = String(Math.max(1, Number(existingItem?.QuantityTotal ?? existingItem?.quantity_total ?? 1)));
                if (qtyPrecisionEl && !String(qtyPrecisionEl.value || '').trim()) qtyPrecisionEl.value = '0';
            }
            updateHistoryBtnVisibility();
        };
        qtyToggle.onchange = onToggle;
        onToggle();
    }

    const srNoInput = getEl('itemSrNo');
    const srNoBatch = getEl('itemSrNoBatch');
    const batchList = getEl('batchSnListContainer');
    const btnToggleBatch = getEl('btnToggleBatchMode');
    const isBatch = Number(existingItem?.IsBatch ?? existingItem?.is_batch ?? 0) === 1;
    if (srNoInput && srNoBatch && btnToggleBatch) {
        if (isBatch) {
            srNoInput.style.display = 'none';
            srNoBatch.style.display = 'block';
            srNoBatch.value = existingItem?.SrNo || existingItem?.srno || '';
            if (batchList) {
                batchList.style.display = 'none';
                batchList.innerHTML = '';
            }
            btnToggleBatch.style.display = 'block';
            btnToggleBatch.textContent = 'Disable Batch S/N';
        } else {
            srNoInput.style.display = 'block';
            srNoBatch.style.display = 'none';
            btnToggleBatch.style.display = 'block';
            btnToggleBatch.textContent = 'Enable Batch S/N';
        }
    }

    modal.style.display = 'flex';

    if (isEdit) {
        // ---------- LOAD QTY HISTORY EVENTS + CHILDREN ----------
        // Primary: /api/inventory/item-details/:id  (if server endpoint added later)
        // Fallback: /api/quantity/events?asset_id=<ID> (ALREADY EXISTS, used by showQuantityHistoryModal!)
        const primaryPromise = (async () => {
            try {
                const res = await fetch(`/api/inventory/item-details/${encodeURIComponent(itemId)}`, {
                    method: 'GET',
                    headers: { 'x-user': window.currentUser || window.username || '' }
                });
                if (!res.ok) return null;
                return await res.json();
            } catch (e) {
                return null;
            }
        })();

        const fallbackQtyPromise = (async () => {
            try {
                const res = await fetch(`/api/quantity/events?asset_id=${encodeURIComponent(itemId)}&limit=50`, {
                    method: 'GET',
                    headers: { 'x-user': window.currentUser || window.username || '' }
                });
                if (!res.ok) return [];
                const data = await res.json();
                const arr = data?.events || data?.rows || data?.data || data || [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) {
                return [];
            }
        })();

        Promise.all([primaryPromise, fallbackQtyPromise]).then(([primaryData, fallbackQty]) => {
            // ---------- CHILDREN (from primary response only) ----------
            if (primaryData) {
                const children = Array.isArray(primaryData?.children) ? primaryData.children : [];
                resetInventoryChildrenUI(existingItem);
                const noQrChildren = children.filter(c => c.NoQR === 1 || c.NoQR === true || c.noqr === 1);
                const linkedChildren = children.filter(c => !(c.NoQR === 1 || c.NoQR === true || c.noqr === 1));
                noQrChildren.forEach(child => addInventoryChildField(child));
                linkedChildren.forEach(child => addInventoryLinkedItem(child));
            }

            // ---------- QTY EVENTS (primary > fallback) ----------
            const eventsFromPrimary = Array.isArray(primaryData?.quantityEvents) ? primaryData.quantityEvents : null;
            const qtyEvents = (eventsFromPrimary && eventsFromPrimary.length > 0)
                ? eventsFromPrimary
                : fallbackQty || [];

            renderInventoryQtyTimeline(existingItem, qtyEvents);
        }).catch(err => {
            console.warn('[Inventory Edit] Failed to load details/qty history:', err);
        });
    }
}
window.openInventorySharedModal = openInventorySharedModal;

function resetInventoryChildrenUI(existingItem = null) {
    const childrenContainer = getEl('childrenListContainer');
    const linkedList = getEl('linkedComponentsList');
    const searchInput = getEl('linkComponentSearch');
    const resultsContainer = getEl('linkComponentResults');
    const btnAddChild = getEl('btnAddChildField');

    if (childrenContainer) childrenContainer.innerHTML = '';
    if (linkedList) linkedList.innerHTML = '';
    if (searchInput) searchInput.value = '';
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
    }

    if (btnAddChild) {
        btnAddChild.onclick = () => addInventoryChildField();
    }

    if (searchInput && resultsContainer && linkedList) {
        const currentId = String(existingItem?.ID || existingItem?.id || '');
        searchInput.oninput = () => {
            const query = String(searchInput.value || '').toLowerCase().trim();
            if (query.length < 2) {
                resultsContainer.style.display = 'none';
                return;
            }

            const matches = (state.items || []).filter(it => {
                const id = String(it.ID || it.id || '').toLowerCase();
                const name = String(it.ItemName || it.itemname || '').toLowerCase();
                const srno = String(it.SrNo || it.srno || '').toLowerCase();
                const make = String(it.Make || it.make || '').toLowerCase();
                const model = String(it.Model || it.model || '').toLowerCase();
                const parentId = String(it.ParentId || it.parentid || '');

                if (!id || id === String(currentId || '').toLowerCase()) return false;

                const hit = id.includes(query) || name.includes(query) || srno.includes(query) || make.includes(query) || model.includes(query);
                if (!hit) return false;

                if (parentId && parentId !== currentId) return false;
                return true;
            }).slice(0, 10);

            if (matches.length === 0) {
                resultsContainer.innerHTML = '<div style="padding: 5px 10px; font-size: 12px; color: #999;">No results</div>';
                resultsContainer.style.display = 'block';
                return;
            }

            resultsContainer.innerHTML = matches.map(m => {
                const id = escapeHtml(m.ID || m.id || '');
                const name = escapeHtml(m.ItemName || m.itemname || '');
                const sr = escapeHtml(m.SrNo || m.srno || '');
                return `
                    <div class="search-result-item" data-id="${id}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px; display: flex; flex-direction: column; line-height: 1.3;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: bold;">${name}</span>
                            <span style="color: #666; font-size: 11px;">${sr || 'No Serial'}</span>
                        </div>
                        <div style="font-size: 10px; color: #999;">ID: ${id}</div>
                    </div>
                `;
            }).join('');
            resultsContainer.style.display = 'block';

            resultsContainer.querySelectorAll('.search-result-item').forEach(node => {
                node.onclick = () => {
                    const id = node.getAttribute('data-id');
                    const match = matches.find(m => String(m.ID || m.id || '') === String(id || ''));
                    if (match) addInventoryLinkedItem(match);
                    searchInput.value = '';
                    resultsContainer.style.display = 'none';
                };
            });
        };

        if (!window.__inventoryChildrenSearchCloserBound) {
            window.__inventoryChildrenSearchCloserBound = true;
            document.addEventListener('click', (e) => {
                const currentSearch = document.getElementById('linkComponentSearch');
                const currentResults = document.getElementById('linkComponentResults');
                if (!currentSearch || !currentResults) return;
                if (!currentSearch.contains(e.target) && !currentResults.contains(e.target)) {
                    currentResults.style.display = 'none';
                }
            });
        }
    }
}

function addInventoryLinkedItem(item) {
    const linkedList = getEl('linkedComponentsList');
    if (!linkedList) return;

    const id = String(item?.ID || item?.id || '').trim();
    if (!id) return;
    const existing = Array.from(linkedList.querySelectorAll('.linked-component-tag')).some(el => el.getAttribute('data-id') === id);
    if (existing) return;

    const tag = document.createElement('div');
    tag.className = 'linked-component-tag';
    tag.setAttribute('data-id', id);
    tag.style = 'background: #e7f3ff; color: #0078d4; padding: 4px 10px; border-radius: 12px; font-size: 11px; display: flex; align-items: center; gap: 8px; border: 1px solid #0078d4;';

    const displayName = String(item.ItemName || item.itemname || 'Component');
    const displaySr = item.SrNo || item.srno ? `(${item.SrNo || item.srno})` : '';

    tag.innerHTML = `
        <div style="display: flex; flex-direction: column; line-height: 1.2;">
            <span style="font-weight: bold;">${escapeHtml(displayName)} ${escapeHtml(displaySr)}</span>
            <span style="font-size: 9px; opacity: 0.7;">ID: ${escapeHtml(id)}</span>
        </div>
        <span class="remove-link" style="cursor: pointer; font-weight: bold; font-size: 14px;">&times;</span>
    `;

    tag.querySelector('.remove-link').onclick = () => tag.remove();
    linkedList.appendChild(tag);
}

function addInventoryChildField(data = null) {
    const container = getEl('childrenListContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'child-asset-row';
    row.style = 'display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 8px; align-items: center; background: #f8f9fa; padding: 8px; border-radius: 4px; border: 1px solid #e9ecef;';

    const compId = data?.ID || data?.id || '';

    row.innerHTML = `
        <input type="hidden" class="child-id" value="${escapeHtml(compId)}">
        <input type="text" class="child-name" placeholder="Component Name (e.g. RAM)" value="${escapeHtml(data?.ItemName || data?.itemname || '')}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <input type="text" class="child-make" placeholder="Make" value="${escapeHtml(data?.Make || data?.make || '')}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <input type="text" class="child-model" placeholder="Model" value="${escapeHtml(data?.Model || data?.model || '')}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <input type="text" class="child-srno" placeholder="Serial No" value="${escapeHtml(data?.SrNo || data?.srno || '')}" style="padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
        <button type="button" class="remove-child-btn" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">&times;</button>
    `;

    row.querySelector('.remove-child-btn').onclick = () => row.remove();
    container.appendChild(row);
}

function renderInventoryQtyTimeline(existingItem, events) {
    const historySection = getEl('qtyHistorySection');
    const timelineContainer = getEl('qtyHistoryTimeline');

    if (!historySection) return;
    historySection.style.display = 'block';

    const itemId = String(existingItem?.ID || existingItem?.id || '').trim();
    const historyHeader = historySection.querySelector('h4');
    if (historyHeader) {
        if (itemId) {
            const openHistoryFnExists = (typeof window.showQuantityHistoryModal === 'function');
            historyHeader.innerHTML = `Quantity History & Timeline 
                <a href="#" onclick="${openHistoryFnExists ? `window.showQuantityHistoryModal('${escapeAttr(itemId)}');` : ''} return false;" 
                   style="float: right; font-size: 11px; color: #0056b3; background: #e7f3ff; padding: 2px 8px; border-radius: 4px; text-decoration: none; border: 1px solid #b3d7ff; cursor: ${openHistoryFnExists ? 'pointer' : 'not-allowed'}; opacity: ${openHistoryFnExists ? 1 : 0.55};">
                   � Open Full History
                </a>`;
        } else {
            historyHeader.textContent = 'Quantity History & Timeline';
        }
    }

    if (!timelineContainer) return;

    const safeEvents = Array.isArray(events) ? events : [];
    if (safeEvents.length === 0) {
        timelineContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8; font-style: italic;">No quantity history recorded yet.</div>';
        return;
    }

    timelineContainer.innerHTML = safeEvents.map(e => {
        const date = new Date(e.timestamp || e.Timestamp || '').toLocaleString();
        const type = String(e.type || e.Type || '').toUpperCase();
        const actor = e.actor || e.Actor || '-';
        const note = e.note || e.Note || '';
        const metadata = e.metadata || null;

        const color = type === 'ISSUE' ? '#3b82f6' :
            type === 'CONSUME' ? '#ef4444' :
            type === 'ADJUST' ? '#f59e0b' :
            type === 'SPLIT' ? '#8b5cf6' : '#0078d4';

        const icon = type === 'ISSUE' ? '📤' :
            type === 'CONSUME' ? '🔥' :
            type === 'ADJUST' ? '🛠️' :
            type === 'SPLIT' ? '✂️' : '⚖️';

        return `
            <div style="padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; border-left: 4px solid ${color}; background: #fff; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span>${icon}</span>
                        <span style="font-weight: 800; color: ${color}; text-transform: uppercase; font-size: 11px;">${escapeHtml(type)}</span>
                    </div>
                    <span style="color: #64748b; font-size: 11px;">${escapeHtml(date)}</span>
                </div>
                <div style="color: #1e293b; font-weight: 700; margin-bottom: 2px;">By ${escapeHtml(actor)}</div>
                ${note ? `<div style="color: #475569; font-style: italic; margin-top: 4px; padding: 4px 8px; background: #f8fafc; border-radius: 4px; border-left: 2px solid #cbd5e1;">"${escapeHtml(note)}"</div>` : ''}
                ${metadata ? `
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0; font-family: monospace; font-size: 11px; color: #475569;">
                        ${Object.entries(metadata).map(([k, v]) => `<div><b style="color: #1e293b;">${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function normalizeDisplayIcon(icon, fallbackEmoji = '📦') {
    const displayImg = String(icon || '').trim();
    if (!displayImg) return { type: 'emoji', value: fallbackEmoji };
    const isUrl = displayImg.startsWith('/') || displayImg.startsWith('http');
    if (isUrl) return { type: 'url', value: displayImg };
    const isEmoji = /[^\x00-\x7F]/.test(displayImg);
    if (isEmoji) return { type: 'emoji', value: displayImg };
    const isMaterialIcon = /^[a-z0-9_]+$/i.test(displayImg);
    if (isMaterialIcon) return { type: 'material', value: displayImg };
    return { type: 'emoji', value: displayImg };
}

function renderIconHtml(icon, fallbackEmoji) {
    const normalized = normalizeDisplayIcon(icon, fallbackEmoji);
    if (normalized.type === 'url') {
        return `<img src="${escapeHtml(normalized.value)}" style="width: 48px; height: 48px; object-fit: contain;" onerror="this.src='/static/icons/package.svg';">`;
    }
    if (normalized.type === 'material') {
        return `<i class="material-icons" style="font-size: 48px; color: #007bff;">${escapeHtml(normalized.value)}</i>`;
    }
    return `<span style="font-size: 40px; line-height: 48px; display: block; text-align: center;">${escapeHtml(normalized.value)}</span>`;
}

function computeNodeStats(node, manager) {
    const nodeDescendants = manager.getDescendants(node.ID, true);
    const folderIds = nodeDescendants.filter(d => d.type === 'folder').map(d => String(d.ID));
    const kindIds = nodeDescendants.filter(d => d.type === 'kind').map(d => String(d.ID));

    const items = state.items.filter(item => {
        const folderId = String(item.FolderId || item.folderid || '');
        const kindId = String(item.KindId || item.kindid || '');
        if (node.type === 'folder') {
            return folderIds.includes(folderId) || kindIds.includes(kindId);
        }
        return kindIds.includes(kindId);
    });

    return {
        itemCount: items.length,
        totalQty: items.reduce((sum, item) => sum + Number(item.QuantityTotal || item.quantity_total || 0), 0),
        availableQty: items.reduce((sum, item) => sum + Number(item.QuantityAvailable || item.quantity_available || 0), 0)
    };
}

function renderInventoryNodeCards(nodes, manager) {
    if (!nodes.length) return '';

    return nodes.map(node => {
        const stats = computeNodeStats(node, manager);
        const borderColor = stats.itemCount > 0 ? '#007bff' : '#ddd';
        const isKind = node.type === 'kind';
        const fallbackEmoji = isKind ? '📦' : '📂';
        const iconHtml = renderIconHtml(node.DisplayImage || node.Icon, fallbackEmoji);

        return `
            <div class="asset-card inventory-node-card" data-node-id="${escapeHtml(node.ID)}" style="position: relative; cursor: pointer; border-top: 3px solid ${borderColor};">
                <div class="asset-card-icon">
                    ${iconHtml}
                </div>
                <div class="asset-card-header">
                    <span class="asset-card-title">${escapeHtml(node.Name)} (${stats.itemCount})</span>
                    <div style="font-size: 11px; color: #0078d4; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="font-size: 12px;">⚖️</span> ${stats.totalQty.toLocaleString()}</span>
                        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="font-size: 12px;">✅</span> ${stats.availableQty.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderInventoryItemCards(items) {
    if (!items.length) return '';

    return items.map(item => {
        const itemName = escapeHtml(item.ItemName || item.itemname || '-');
        const status = escapeHtml(item.Status || item.status || 'In Store');
        const statusClass = formatInventoryStatus(status);
        const iconHtml = renderIconHtml(item.Icon, '📦');

        const total = Number(item.QuantityTotal || item.quantity_total || 0);
        const available = Number(item.QuantityAvailable || item.quantity_available || 0);
        const fromCatalog = String(item.zoho_product_id || item.ZohoProductId || '').trim() !== '' || String(item.catalog_uuid || item.CatalogUUID || '').trim() !== '';

        return `
            <div class="asset-card inventory-item-card" data-item-id="${escapeHtml(item.ID || item.id || '')}" style="cursor: pointer;">
                <div class="asset-card-icon" style="font-size: 24px;">
                    ${iconHtml.replace('48px', '32px').replace('40px', '24px').replace('48px', '32px')}
                </div>
                <div class="asset-card-header">
                    <span class="asset-card-title">${itemName}</span>
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
                        <span class="status-badge ${statusClass}">${status}</span>
                        ${fromCatalog ? `<span class="status-badge" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a;">Catalog</span>` : ''}
                    </div>
                    <div style="font-size: 11px; color: #666; margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
                        <span><strong>Total:</strong> ${total}</span>
                        <span><strong>Available:</strong> ${available}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderInventoryItems() {
    const title = getEl('inventoryPanelTitle');
    const subtitle = getEl('inventoryPanelSubtitle');
    const stats = getEl('inventoryStats');
    const content = getEl('inventoryContent');
    if (!title || !subtitle || !stats || !content) return;

    if (state.catalogMode) {
        renderCatalogView();
        return;
    }

    setWorkspaceChrome('inventory');
    const selectedNode = getSelectedNode();
    const manager = buildHierarchyManager();
    const items = getFilteredInventoryItems().sort((a, b) => String(a.ItemName || a.itemname || '').localeCompare(String(b.ItemName || b.itemname || '')));

    title.textContent = getNodeLabel(selectedNode);
    subtitle.textContent = selectedNode
        ? 'Inventory records linked to this hierarchy node.'
        : 'Standalone inventory workspace for 9090.';

    const widget = getEl('inventoryOverviewWidget');
    const widgetVisible = widget && widget.style.display !== 'none';
    const arrow = widgetVisible ? '▲' : '▼';
    const bg = widgetVisible ? '#f0f7ff' : 'white';
    const color = widgetVisible ? '#007bff' : '#555';
    const border = widgetVisible ? '#b3d7ff' : '#e0e0e0';
    stats.innerHTML = `
        <div id="btnToggleInventoryOverview" style="
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
        ">
            <span style="font-weight: 600; font-size: 11px;">Inventory Overview</span>
            <span id="toggleInventoryArrow" style="font-size: 9px; color: #777;">${arrow}</span>
        </div>
    `;

    renderInventoryOverviewWidget(items, title.textContent || 'Inventory');
    const toggle = getEl('btnToggleInventoryOverview');
    if (toggle) {
        toggle.onclick = (e) => {
            e.stopPropagation();
            const w = getEl('inventoryOverviewWidget');
            if (!w) return;
            const isHidden = w.style.display === 'none';
            w.style.display = isHidden ? 'block' : 'none';
            renderInventoryItems();
        };
    }

    const displayNodes = selectedNode ? (selectedNode.children || []) : (manager.tree || []);
    const isLeafKind = selectedNode && selectedNode.type === 'kind' && (!selectedNode.children || selectedNode.children.length === 0);

    const nodePageMeta = paginateRows(displayNodes, `nodes:${selectedNode ? selectedNode.ID : 'root'}`);
    const nodeCardsHtml = nodePageMeta.pageItems.length ? renderInventoryNodeCards(nodePageMeta.pageItems, manager) : '';
    const uncategorized = !selectedNode
        ? items.filter(item => !String(item.FolderId || item.folderid || '').trim() && !String(item.KindId || item.kindid || '').trim())
        : [];
    const itemPageMeta = isLeafKind ? paginateRows(items, `items:${selectedNode?.ID || 'root'}`) : null;
    const itemCardsHtml = itemPageMeta ? renderInventoryItemCards(itemPageMeta.pageItems) : '';
    const uncategorizedPageMeta = uncategorized.length ? paginateRows(uncategorized, 'uncategorized:root') : null;
    const uncategorizedHtml = uncategorizedPageMeta ? renderInventoryItemCards(uncategorizedPageMeta.pageItems) : '';

    if (!nodeCardsHtml && !itemCardsHtml && !uncategorizedHtml) {
        content.innerHTML = `
            <div class="card-panel" style="padding: 30px; text-align: center; color: #667085;">
                No inventory folders, categories, or items yet.
            </div>
        `;
        return;
    }

    content.innerHTML = `
        ${nodeCardsHtml ? `<div><div class="asset-grid" style="height: auto; width: 100%;">${nodeCardsHtml}</div>${renderPaginationControls(nodePageMeta, 'nodes')}</div>` : ''}
        ${itemCardsHtml ? `<div style="margin-top: 18px;"><div class="asset-grid" style="height: auto; width: 100%;">${itemCardsHtml}</div>${renderPaginationControls(itemPageMeta, 'items')}</div>` : ''}
        ${uncategorizedHtml ? `
            <div style="margin-top: 18px;">
                <div style="margin: 0 0 10px 0; font-weight: 700; color: #475569; font-size: 13px;">Uncategorized Inventory Items</div>
                <div class="asset-grid" style="height: auto; width: 100%;">${uncategorizedHtml}</div>
                ${renderPaginationControls(uncategorizedPageMeta, 'items')}
            </div>
        ` : ''}
    `;

    content.querySelectorAll('.inventory-node-card').forEach(card => {
        card.addEventListener('click', async () => {
            const nodeId = card.getAttribute('data-node-id');
            if (!nodeId) return;
            if (typeof window.openInventoryNode === 'function') {
                await window.openInventoryNode(nodeId);
            } else {
                state.selectedNodeId = nodeId;
                renderInventoryItems();
            }
            if (typeof window.renderSidebarTree === 'function') {
                await window.renderSidebarTree();
            }
        });
    });

    content.querySelectorAll('.inventory-item-card').forEach(card => {
        card.addEventListener('click', () => {
            const itemId = card.getAttribute('data-item-id');
            if (!itemId) return;
            const item = state.items.find(entry => String(entry.ID || entry.id) === String(itemId));
            if (!item) return;
            openInventorySharedModal(item);
        });
    });

    content.querySelectorAll('.inventory-page-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const key = button.getAttribute('data-pagination-key');
            const page = Number(button.getAttribute('data-page') || 1);
            if (!key || Number.isNaN(page) || page < 1) return;
            setPageForKey(key, page);
            renderInventoryItems();
        });
    });
}

async function renderCatalogView(forceReload = false) {
    const title = getEl('inventoryPanelTitle');
    const subtitle = getEl('inventoryPanelSubtitle');
    const stats = getEl('inventoryStats');
    const content = getEl('inventoryContent');
    if (!title || !subtitle || !stats || !content) return;

    setWorkspaceChrome('catalog');
    title.textContent = 'Zoho Reference Catalog';
    subtitle.textContent = 'Catalog products open in a read-only view and can be converted into inventory.';

    if (!state.catalog.length || forceReload) {
        const data = await fetchJson('/api/zoho/catalog');
        state.catalog = data.catalog || [];
    }

    stats.innerHTML = `
        <span style="background: #fffbeb; color: #b76a00; padding: 4px 10px; border-radius: 999px; font-weight: 600;">${state.catalog.length} Catalog Products</span>
    `;

    const catalogPageMeta = paginateRows(state.catalog || [], 'catalog');

    content.innerHTML = `
        <div class="asset-grid" style="height: auto; width: 100%;">
            ${(catalogPageMeta.pageItems || []).map(item => `
                <div class="asset-card catalog-item" data-zoho-product-id="${escapeHtml(item.zoho_product_id || '')}" style="cursor: pointer; border-top: 3px solid #f59e0b; min-height: 140px; display: flex; flex-direction: column; justify-content: flex-start;">
                    <div class="asset-card-icon" style="font-size: 28px; background: #fffbeb; color: #b76a00;">🏷️</div>
                    <div class="asset-card-header" style="margin-top: 12px; min-width: 0;">
                        <span class="asset-card-title" style="white-space: normal; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;" title="${escapeHtml(item.product_name || '')}">
                            ${escapeHtml(item.product_name || '')}
                        </span>
                    </div>
                </div>
            `).join('')}
        </div>
        ${renderPaginationControls(catalogPageMeta, 'catalog items')}
    `;

    content.querySelectorAll('.catalog-item').forEach(card => {
        card.addEventListener('click', () => {
            const zohoProductId = String(card.getAttribute('data-zoho-product-id') || '').trim();
            const item = (state.catalog || []).find(p => String(p.zoho_product_id || '') === zohoProductId);
            if (!item) return;
            openCatalogProductModal(item);
        });
    });

    content.querySelectorAll('.inventory-page-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            const key = button.getAttribute('data-pagination-key');
            const page = Number(button.getAttribute('data-page') || 1);
            if (!key || Number.isNaN(page) || page < 1) return;
            setPageForKey(key, page);
            await renderCatalogView(false);
        });
    });
}

function ensureCatalogProductModal() {
    if (getEl('catalogProductModal')) return;

    const modal = document.createElement('div');
    modal.id = 'catalogProductModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 720px;">
            <span class="close-modal" id="closeCatalogProductModal">&times;</span>
            <div id="catalogProductModalBody"></div>
        </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = getEl('closeCatalogProductModal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
    modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.style.display = 'none';
    });
}

function openCatalogProductModal(item) {
    ensureCatalogProductModal();
    const modal = getEl('catalogProductModal');
    const body = getEl('catalogProductModalBody');
    if (!modal || !body) return;

    const zohoId = String(item?.zoho_product_id || '');
    const sku = String(item?.sku || '');
    const productName = String(item?.product_name || '');
    const make = String(item?.make || '');
    const model = String(item?.model || '');
    const hsn = String(item?.hsn_code || '');
    const description = String(item?.description || '');
    const unitPrice = Number(item?.unit_price || 0);

    body.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px;">
            <div style="min-width: 0;">
                <div style="font-weight: 900; font-size: 18px; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(productName)}
                </div>
                <div style="margin-top: 4px; font-size: 12px; color: #6b7280; font-family: monospace;">
                    SKU: ${escapeHtml(sku || 'N/A')} • Zoho Record ID: ${escapeHtml(zohoId || 'N/A')}
                </div>
            </div>
            <div style="font-weight: 900; color: #059669; font-size: 18px; white-space: nowrap;">
                ₹${Number(unitPrice || 0).toLocaleString()}
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
                <label>Make</label>
                <input type="text" value="${escapeHtml(make)}" disabled>
            </div>
            <div class="form-group">
                <label>Model</label>
                <input type="text" value="${escapeHtml(model)}" disabled>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
                <label>HSN Code</label>
                <input type="text" value="${escapeHtml(hsn)}" disabled>
            </div>
            <div class="form-group">
                <label>Unit Price</label>
                <input type="text" value="₹${Number(unitPrice || 0).toLocaleString()}" disabled>
            </div>
        </div>

        <div class="form-group">
            <label>Description</label>
            <textarea rows="4" disabled style="resize: vertical;">${escapeHtml(description)}</textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
            <button class="action-button grey" id="btnCloseCatalogProduct">Close</button>
            <button class="action-button" id="btnViewCatalogInZoho" style="background: #f3f4f6; color: #4b5563;">View in Zoho</button>
            <button class="action-button blue" id="btnCreateInventoryFromCatalog">Create Inventory</button>
        </div>
    `;

    getEl('btnCloseCatalogProduct')?.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'none';
    });

    getEl('btnViewCatalogInZoho')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!zohoId) return;
        window.open(`https://crm.zoho.in/crm/org60021949576/tab/Products/${zohoId}`, '_blank');
    });

    getEl('btnCreateInventoryFromCatalog')?.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'none';
        openInventoryFromCatalog({
            zoho_product_id: zohoId,
            product_name: productName,
            make,
            model,
            unit_price: unitPrice,
            description,
            sku,
            hsn_code: hsn
        });
    });

    modal.style.display = 'flex';
}

function openInventoryFromCatalog(catalogItem) {
    openInventorySharedModal(null);

    const form = getEl('addAssetItemForm');
    const modal = getEl('addAssetItemModal');
    const title = getEl('addItemModalTitle');
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (form) {
        form.dataset.entity = 'inventory';
        form.dataset.catalogZohoProductId = String(catalogItem?.zoho_product_id || '');
        form.dataset.catalogUuid = catalogItem?.zoho_product_id ? `ZCAT-${String(catalogItem.zoho_product_id)}` : '';
    }

    const setVal = (id, value) => {
        const el = getEl(id);
        if (el) el.value = value ?? '';
    };
    const setChecked = (id, checked) => {
        const el = getEl(id);
        if (el) el.checked = !!checked;
    };

    setVal('itemName', catalogItem?.product_name || '');
    setVal('itemDescription', catalogItem?.description || '');
    setVal('itemMake', catalogItem?.make || '');
    setVal('itemModel', catalogItem?.model || '');
    setVal('itemHsnCode', catalogItem?.hsn_code || '');
    setVal('itemValue', Number(catalogItem?.unit_price || 0));

    setVal('itemQtyTotal', '1');
    setVal('itemQtyUnit', 'Nos');
    setVal('itemQtyPrecision', '0');
    setChecked('itemIsQtyTracked', false);

    const folderSelect = getEl('itemFolder');
    const kindSelect = getEl('itemKind');
    if (folderSelect && kindSelect) {
        const inboxFolder = (state.folders || []).find(f => String(f.ID || f.id) === 'IF-INBOX');
        const miscKind = (state.kinds || []).find(k => String(k.ID || k.id) === 'IK-MISC');

        if (inboxFolder) {
            folderSelect.value = String(inboxFolder.ID || inboxFolder.id);
            folderSelect.dispatchEvent(new Event('change'));
        }
        if (miscKind) {
            kindSelect.value = String(miscKind.ID || miscKind.id);
        }
    }

    if (form) form.dataset.entity = 'inventory';
    if (title) title.textContent = 'Add Inventory Item from Zoho Catalog';
    if (submitBtn) submitBtn.textContent = 'Add Inventory Item';
}

function openCrudModal(type, existingItem = null) {
    ensureModalShell();
    const modal = getEl('inventoryCrudModal');
    const body = getEl('inventoryCrudModalBody');
    if (!modal || !body) return;

    const folderList = state.folders.map(folder => ({
        id: String(folder.ID || folder.id || ''),
        name: String(folder.Name || folder.name || '')
    })).filter(f => f.id && f.name);

    const kindList = state.kinds.map(kind => ({
        id: String(kind.ID || kind.id || ''),
        name: String(kind.Name || kind.name || ''),
        folderid: String(kind.FolderId || kind.folderid || '')
    })).filter(k => k.id && k.name);

    const getContextDefaults = () => {
        const nodeId = window.currentInventorySidebar?.type === 'node' ? window.currentInventorySidebar.id : state.selectedNodeId;
        if (!nodeId) return { folderId: '', kindId: '' };

        const folderMatch = folderList.find(f => f.id === String(nodeId));
        if (folderMatch) return { folderId: folderMatch.id, kindId: '' };

        const kindMatch = kindList.find(k => k.id === String(nodeId));
        if (kindMatch) return { folderId: kindMatch.folderid, kindId: kindMatch.id };

        return { folderId: '', kindId: '' };
    };

    const buildFolderOptions = (selectedId = '') => {
        const placeholder = `<option value="">-- Select Folder --</option>`;
        return placeholder + folderList.map(folder => {
            const selected = String(selectedId) === folder.id ? ' selected' : '';
            return `<option value="${folder.id}"${selected}>${escapeHtml(folder.name)}</option>`;
        }).join('');
    };

    const buildKindOptions = (selectedFolderId = '', selectedKindId = '') => {
        const placeholder = `<option value="">-- Select Category --</option>`;
        const filtered = selectedFolderId
            ? kindList.filter(k => k.folderid === String(selectedFolderId))
            : [];

        return placeholder + filtered.map(kind => {
            const selected = String(selectedKindId) === kind.id ? ' selected' : '';
            return `<option value="${kind.id}"${selected}>${escapeHtml(kind.name)}</option>`;
        }).join('');
    };

    if (type === 'folder') {
        const folderOptions = ['<option value="">None</option>']
            .concat(folderList.map(folder => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`))
            .join('');

        body.innerHTML = `
            <h3>Add Inventory Folder</h3>
            <form id="inventoryCrudForm">
                <div class="form-group">
                    <label for="inventoryFolderName">Folder Name</label>
                    <input type="text" id="inventoryFolderName" required>
                </div>
                <div class="form-group">
                    <label for="inventoryFolderParent">Parent Folder</label>
                    <select id="inventoryFolderParent">${folderOptions}</select>
                </div>
                <div class="form-group">
                    <label for="inventoryFolderIcon">Icon</label>
                    <input type="text" id="inventoryFolderIcon" value="📦">
                </div>
                <button type="submit" class="action-button blue" style="width: 100%;">Save Folder</button>
            </form>
        `;
    } else if (type === 'kind') {
        const folderOptions = buildFolderOptions('');
        const kindOptions = ['<option value="">None</option>']
            .concat(kindList.map(kind => `<option value="${kind.id}">${escapeHtml(kind.name)}</option>`))
            .join('');

        body.innerHTML = `
            <h3>Add Inventory Category</h3>
            <form id="inventoryCrudForm">
                <div class="form-group">
                    <label for="inventoryKindName">Category Name</label>
                    <input type="text" id="inventoryKindName" required>
                </div>
                <div class="form-group">
                    <label for="inventoryKindFolder">Folder</label>
                    <select id="inventoryKindFolder" required>${folderOptions}</select>
                </div>
                <div class="form-group">
                    <label for="inventoryKindParent">Parent Category</label>
                    <select id="inventoryKindParent">${kindOptions}</select>
                </div>
                <div class="form-group">
                    <label for="inventoryKindIcon">Icon</label>
                    <input type="text" id="inventoryKindIcon" value="📦">
                </div>
                <button type="submit" class="action-button blue" style="width: 100%;">Save Category</button>
            </form>
        `;

        const forcedParentKindId = String(window.contextMenuTargetInventoryParentKindId || '');
        const forcedFolderIdDirect = String(window.contextMenuTargetInventoryFolderId || '');
        const forcedParent = forcedParentKindId ? kindList.find(k => k.id === forcedParentKindId) : null;
        const forcedFolderId = forcedFolderIdDirect || (forcedParent ? forcedParent.folderid : '');

        const folderSelect = getEl('inventoryKindFolder');
        const parentSelect = getEl('inventoryKindParent');
        if (folderSelect && forcedFolderId) folderSelect.value = forcedFolderId;
        if (parentSelect && forcedParentKindId) parentSelect.value = forcedParentKindId;
        window.contextMenuTargetInventoryFolderId = null;
        window.contextMenuTargetInventoryParentKindId = null;
    } else {
        const defaults = existingItem
            ? {
                folderId: String(existingItem.FolderId || existingItem.folderid || ''),
                kindId: String(existingItem.KindId || existingItem.kindid || '')
            }
            : getContextDefaults();
        const folderOptions = buildFolderOptions(defaults.folderId);
        const kindOptions = buildKindOptions(defaults.folderId, defaults.kindId);
        const itemId = existingItem ? escapeHtml(existingItem.ID || existingItem.id || '') : '';
        const itemNameValue = escapeHtml(existingItem?.ItemName || existingItem?.itemname || '');
        const itemDescriptionValue = escapeHtml(existingItem?.ItemDescription || existingItem?.itemdescription || '');
        const itemMakeValue = escapeHtml(existingItem?.Make || existingItem?.make || '');
        const itemModelValue = escapeHtml(existingItem?.Model || existingItem?.model || '');
        const itemLocationValue = escapeHtml(existingItem?.CurrentLocation || existingItem?.currentlocation || 'Mumbai');
        const itemStatusValue = String(existingItem?.Status || existingItem?.status || 'In Store');
        const itemTotalValue = Number(existingItem?.QuantityTotal || existingItem?.quantity_total || 1);
        const itemAvailableValue = Number(existingItem?.QuantityAvailable || existingItem?.quantity_available || 1);
        const itemTrackedValue = Number(existingItem?.IsQuantityTracked ?? existingItem?.is_quantity_tracked ?? 1);
        const itemSetValue = Number(existingItem?.IsSet ?? existingItem?.is_set ?? 0);

        body.innerHTML = `
            <h3>${existingItem ? 'Edit Inventory Item' : 'Add Inventory Item'}</h3>
            <form id="inventoryCrudForm">
                ${existingItem ? `
                    <div class="form-group">
                        <label for="inventoryItemId">Inventory ID</label>
                        <input type="text" id="inventoryItemId" value="${itemId}" readonly style="background: #f8fafc; color: #64748b; font-family: monospace;">
                    </div>
                ` : ''}
                <div class="form-group">
                    <label for="inventoryItemName">Item Name</label>
                    <input type="text" id="inventoryItemName" value="${itemNameValue}" required>
                </div>
                <div class="form-group">
                    <label for="inventoryItemDescription">Description</label>
                    <input type="text" id="inventoryItemDescription" value="${itemDescriptionValue}">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="inventoryItemFolder">Folder</label>
                        <select id="inventoryItemFolder" required>${folderOptions}</select>
                    </div>
                    <div class="form-group">
                        <label for="inventoryItemKind">Category</label>
                        <select id="inventoryItemKind" required>${kindOptions}</select>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="inventoryItemMake">Make</label>
                        <input type="text" id="inventoryItemMake" value="${itemMakeValue}">
                    </div>
                    <div class="form-group">
                        <label for="inventoryItemModel">Model</label>
                        <input type="text" id="inventoryItemModel" value="${itemModelValue}">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="inventoryItemLocation">Current Location</label>
                        <input type="text" id="inventoryItemLocation" value="${itemLocationValue}">
                    </div>
                    <div class="form-group">
                        <label for="inventoryItemStatus">Status</label>
                        <select id="inventoryItemStatus">
                            <option value="In Store" ${itemStatusValue === 'In Store' ? 'selected' : ''}>In Store</option>
                            <option value="In Use" ${itemStatusValue === 'In Use' ? 'selected' : ''}>In Use</option>
                            <option value="In Project" ${itemStatusValue === 'In Project' ? 'selected' : ''}>In Project</option>
                        </select>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="inventoryItemTotal">Quantity Total</label>
                        <input type="number" id="inventoryItemTotal" min="0" step="1" value="${itemTotalValue}">
                    </div>
                    <div class="form-group">
                        <label for="inventoryItemAvailable">Quantity Available</label>
                        <input type="number" id="inventoryItemAvailable" min="0" step="1" value="${itemAvailableValue}">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="inventoryItemTracked">Quantity Tracked</label>
                        <select id="inventoryItemTracked">
                            <option value="1" ${itemTrackedValue === 1 ? 'selected' : ''}>Yes</option>
                            <option value="0" ${itemTrackedValue === 0 ? 'selected' : ''}>No</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="inventoryItemSet">Inventory Set</label>
                        <select id="inventoryItemSet">
                            <option value="0" ${itemSetValue === 0 ? 'selected' : ''}>No</option>
                            <option value="1" ${itemSetValue === 1 ? 'selected' : ''}>Yes</option>
                        </select>
                    </div>
                </div>
                <button type="submit" class="action-button blue" style="width: 100%;">${existingItem ? 'Save Inventory Item' : 'Add Inventory Item'}</button>
            </form>
        `;
    }

    const form = getEl('inventoryCrudForm');
    if (form) {
        const folderSelect = getEl('inventoryItemFolder');
        const kindSelect = getEl('inventoryItemKind');
        if (type === 'item' && folderSelect && kindSelect) {
            folderSelect.addEventListener('change', () => {
                const selectedFolderId = folderSelect.value;
                kindSelect.innerHTML = buildKindOptions(selectedFolderId, '');
            });
        }

        form.onsubmit = async (event) => {
            event.preventDefault();
            try {
                if (type === 'folder') {
                    await fetchJson('/api/inventory/folders', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            Name: getEl('inventoryFolderName')?.value,
                            ParentID: getEl('inventoryFolderParent')?.value || null,
                            Icon: getEl('inventoryFolderIcon')?.value || '📦'
                        })
                    });
                } else if (type === 'kind') {
                    const folderValue = getEl('inventoryKindFolder')?.value || '';
                    if (!folderValue) {
                        showToast('Folder is required.', 'error');
                        return;
                    }
                    await fetchJson('/api/inventory/kinds', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            Name: getEl('inventoryKindName')?.value,
                            FolderID: folderValue,
                            ParentID: getEl('inventoryKindParent')?.value || null,
                            Icon: getEl('inventoryKindIcon')?.value || '📦'
                        })
                    });
                } else {
                    const folderValue = getEl('inventoryItemFolder')?.value || '';
                    const kindValue = getEl('inventoryItemKind')?.value || '';
                    if (!folderValue) {
                        showToast('Folder is required.', 'error');
                        return;
                    }
                    if (!kindValue) {
                        showToast('Category is required.', 'error');
                        return;
                    }
                    await fetchJson(existingItem ? `/api/inventory/items/${encodeURIComponent(existingItem.ID || existingItem.id)}` : '/api/inventory/items', {
                        method: existingItem ? 'PUT' : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ItemName: getEl('inventoryItemName')?.value,
                            ItemDescription: getEl('inventoryItemDescription')?.value || '',
                            FolderID: folderValue,
                            KindID: kindValue,
                            Make: getEl('inventoryItemMake')?.value || '',
                            Model: getEl('inventoryItemModel')?.value || '',
                            CurrentLocation: getEl('inventoryItemLocation')?.value || 'Mumbai',
                            Status: getEl('inventoryItemStatus')?.value || 'In Store',
                            QuantityTotal: Number(getEl('inventoryItemTotal')?.value || 0),
                            QuantityAvailable: Number(getEl('inventoryItemAvailable')?.value || 0),
                            IsQuantityTracked: Number(getEl('inventoryItemTracked')?.value || 0),
                            IsSet: Number(getEl('inventoryItemSet')?.value || 0)
                        })
                    });
                }

                modal.style.display = 'none';
                showToast(existingItem ? 'Inventory item updated' : `Inventory ${type} saved`, 'success');
                await loadInventoryWorkspace();
            } catch (error) {
                showToast(error.message, 'error');
            }
        };
    }

    modal.style.display = 'flex';
}

async function loadInventoryWorkspace() {
    if (!isInventoryPreviewEnabled()) return;

    const [foldersData, kindsData, itemsData] = await Promise.all([
        fetchJson('/api/inventory/folders'),
        fetchJson('/api/inventory/kinds'),
        fetchJson('/api/inventory/items')
    ]);

    state.folders = foldersData.folders || [];
    state.kinds = kindsData.kinds || [];
    state.items = itemsData.items || [];
    window.allInventoryFolders = state.folders;
    window.allInventoryKinds = state.kinds;
    window.allInventoryItems = state.items;

    if (typeof window.renderSidebarTree === 'function') {
        await window.renderSidebarTree();
    }
    setWorkspaceChrome('inventory');
    renderInventoryTree();
    await renderInventoryItems();
}

export function initInventoryView() {
    if (!isInventoryPreviewEnabled()) return;

    const navInventory = getEl('nav-inventory');
    if (navInventory) navInventory.style.display = '';

    if (state.initialized) {
        loadInventoryWorkspace().catch(err => showToast(err.message, 'error'));
        return;
    }

    state.initialized = true;
    ensureModalShell();

    getEl('btnInventoryReload')?.addEventListener('click', () => {
        loadInventoryWorkspace().catch(err => showToast(err.message, 'error'));
    });
    getEl('btnInventoryShowItems')?.addEventListener('click', () => {
        state.catalogMode = false;
        renderInventoryTree();
        renderInventoryItems();
    });
    getEl('btnAddInventoryFolder')?.addEventListener('click', () => openCrudModal('folder'));
    getEl('btnAddInventoryCategory')?.addEventListener('click', () => openCrudModal('kind'));
    getEl('btnAddInventoryItem')?.addEventListener('click', () => openInventorySharedModal());

    loadInventoryWorkspace().catch(err => showToast(err.message, 'error'));
}

window.loadInventoryWorkspace = loadInventoryWorkspace;
window.openInventoryItemModal = openInventorySharedModal;
window.initInventoryView = initInventoryView;
window.openInventoryRoot = async () => {
    if (!isInventoryPreviewEnabled()) return;
    if (!state.initialized) initInventoryView();
    state.catalogMode = false;
    state.selectedNodeId = null;
    resetPagination();
    window.currentInventorySidebar = { type: 'root' };
    await loadInventoryWorkspace();
};
window.openInventoryNode = async (nodeId) => {
    if (!isInventoryPreviewEnabled()) return;
    if (!state.initialized) initInventoryView();
    state.catalogMode = false;
    state.selectedNodeId = nodeId || null;
    resetPagination('items:');
    resetPagination('nodes:');
    window.currentInventorySidebar = { type: 'node', id: nodeId || null };
    await loadInventoryWorkspace();
};
window.refreshInventoryCatalog = async () => {
    if (!isInventoryPreviewEnabled()) return;
    state.catalogMode = true;
    resetPagination('catalog');
    window.currentInventorySidebar = { type: 'catalog' };
    await renderCatalogView(true);
};
window.openInventoryCatalog = async () => {
    if (!isInventoryPreviewEnabled()) return;
    if (!state.initialized) initInventoryView();
    state.selectedNodeId = null;
    state.catalogMode = true;
    resetPagination('catalog');
    window.currentInventorySidebar = { type: 'catalog' };
    await renderCatalogView();
};
