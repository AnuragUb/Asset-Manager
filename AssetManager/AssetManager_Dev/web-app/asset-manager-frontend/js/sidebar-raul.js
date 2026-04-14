
/**
 * Sidebar Raul Drunk - Vertical Bubble Animation Logic
 */
(function() {
    console.log('Sidebar Raul Drunk: Initializing...');

    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) {
        console.error('Sidebar Raul Drunk: #app-sidebar not found');
        return;
    }

    // Create Bubbles
    let activeBubble = document.querySelector('.sidebar-bubble.active-bubble');
    let hoverBubble = document.querySelector('.sidebar-bubble.hover-bubble');

    if (!activeBubble) {
        activeBubble = document.createElement('div');
        activeBubble.className = 'sidebar-bubble active-bubble';
        sidebar.appendChild(activeBubble);
    }

    if (!hoverBubble) {
        hoverBubble = document.createElement('div');
        hoverBubble.className = 'sidebar-bubble hover-bubble';
        sidebar.appendChild(hoverBubble);
    }

    // Helper to move bubble to element
    function moveBubbleTo(bubble, element) {
        if (!element || !bubble) return;
        
        // Calculate position relative to sidebar using getBoundingClientRect
        // This is necessary because intermediate elements (like .tree-node) might be positioned,
        // breaking the simple offsetTop chain.
        const sidebarRect = sidebar.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        const top = elementRect.top - sidebarRect.top + sidebar.scrollTop;
        const height = elementRect.height;
        
        bubble.style.top = `${top}px`;
        bubble.style.height = `${height}px`;
        bubble.style.opacity = '1';
    }

    // Event Delegation
    const treeContainer = document.getElementById('sidebar-tree');
    if (treeContainer) {
        // --- TOUCH SUPPORT FOR MOBILE BUBBLES ---
        // On mobile, "touch" acts like a temporary hover.
        treeContainer.addEventListener('touchstart', (e) => {
            const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
            if (wrapper) {
                 // Move hover bubble to touched item immediately
                 moveBubbleTo(hoverBubble, wrapper);
            }
        }, { passive: true });

        // Hover Effects (Mouse)
        treeContainer.addEventListener('mouseover', (e) => {
            const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
            if (wrapper) {
                // If this is the active item, don't show hover bubble over it (optional)
                if (wrapper.classList.contains('active')) {
                    hoverBubble.style.opacity = '0';
                } else {
                    moveBubbleTo(hoverBubble, wrapper);
                }
            } else {
                hoverBubble.style.opacity = '0';
            }
        });

        treeContainer.addEventListener('mouseout', (e) => {
            hoverBubble.style.opacity = '0';
        });

        // Click Effects (Active State)
        treeContainer.addEventListener('click', (e) => {
            const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
            if (wrapper) {
                // Remove active class from all others (handled by existing logic, but we need to track it)
                // Existing logic in main.js/hierarchy.js handles class toggling.
                // We just need to follow the active element.
                
                // Slight delay to allow existing logic to update classes if necessary, 
                // but ideally we just move to the clicked element immediately.
                moveBubbleTo(activeBubble, wrapper);
            }
        });
    }

    // Sync Active Bubble on Load / Tree Render
    function syncActiveBubble() {
        const activeItem = sidebar.querySelector('.tree-item-wrapper.active, .menu-item-wrapper.active');
        if (activeItem) {
            moveBubbleTo(activeBubble, activeItem);
        } else {
            activeBubble.style.opacity = '0';
        }
    }

    // Observer to handle dynamic tree updates (expansion, filtering, re-rendering)
    const observer = new MutationObserver((mutations) => {
        // If tree structure changes (nodes added/removed) or classes change (active)
        syncActiveBubble();
    });

    if (treeContainer) {
        observer.observe(treeContainer, { 
            childList: true, 
            subtree: true, 
            attributes: true, 
            attributeFilter: ['class', 'style', 'hidden'] 
        });
    }

    // Initial Sync
    setTimeout(syncActiveBubble, 500); // Wait for initial render
    
    // Also expose sync function globally if needed
    window.syncSidebarBubble = syncActiveBubble;

})();
