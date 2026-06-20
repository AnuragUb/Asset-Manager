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
        const folderItem = e.target.closest('.tree-node[data-type="folder"]');
        const kindItem = e.target.closest('.tree-node[data-type="kind"]');

        // Store context data for actions
        menu.dataset.contextType = folderItem ? 'folder' : (kindItem ? 'kind' : 'none');
        menu.dataset.contextName = folderItem ? folderItem.dataset.name : (kindItem ? kindItem.dataset.name : '');
        
        console.log(`[ContextMenu] Clicked on: ${menu.dataset.contextType} (${menu.dataset.contextName})`);
    });

    // Handle Menu Item Clicks
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.menu-item');
        if (!item) return;

        const action = item.dataset.action;
        const contextType = menu.dataset.contextType;
        const contextName = menu.dataset.contextName;

        switch (action) {
            case 'add-folder':
                const addFolderBtn = document.getElementById('btnAddAssetFolder');
                if (addFolderBtn) addFolderBtn.click();
                break;

            case 'add-category':
                // If we clicked on a folder, we can pre-select it in the modal
                if (contextType === 'folder' && contextName) {
                    console.log(`[ContextMenu] Pre-selecting folder: ${contextName}`);
                    // We'll need a way to pass this to the modal
                    window.contextMenuTargetFolder = contextName;
                }
                const addCategoryBtn = document.getElementById('btnAddAssetKind');
                if (addCategoryBtn) addCategoryBtn.click();
                break;

            case 'refresh':
                if (window.loadFolders) window.loadFolders();
                break;
        }

        menu.style.display = 'none';
    });
}
