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
                <span class="menu-icon">📁</span> Add Parent Folder
            </div>
            <div class="menu-item" data-action="add-category">
                <span class="menu-icon">📂</span> Add Category
            </div>
            <div class="menu-divider"></div>
            <div class="menu-item" data-action="refresh">
                <span class="menu-icon">🔄</span> Refresh Hierarchy
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
        
        console.log(`[ContextMenu] Clicked on: ${menu.dataset.contextType} (${menu.dataset.contextName}) ID: ${menu.dataset.contextId}`);
    });

    // Handle Menu Item Clicks
    menu.onclick = async (e) => {
        const item = e.target.closest('.menu-item');
        if (!item) return;

        const action = item.dataset.action;
        const contextType = menu.dataset.contextType;
        const contextName = menu.dataset.contextName;

        console.log(`[ContextMenu] Executing action: ${action} on ${contextType}`);

        if (action === 'add-folder') {
            if (typeof window.openAddFolderModal === 'function') {
                window.openAddFolderModal();
            } else {
                const modal = document.getElementById('addFolderModal');
                if (modal) modal.style.display = 'flex';
            }
        } else if (action === 'add-category') {
            // If we clicked on a folder, we can pre-select it in the modal
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
        } else if (action === 'refresh') {
            if (window.loadAssetKinds) {
                await window.loadAssetKinds();
            }
            if (window.renderSidebarTree) {
                window.renderSidebarTree();
            }
            if (typeof showToast === 'function') {
                showToast('Hierarchy refreshed', 'success');
            }
        }

        menu.style.display = 'none';
    };
}
