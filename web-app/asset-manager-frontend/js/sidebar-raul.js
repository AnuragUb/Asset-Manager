
/**
 * Sidebar Raul Drunk - Vertical Bubble Animation Logic
 */
(function() {
    // Define sync function globally early, so dashboard.js can call it even before full init
    window.syncSidebarBubbles = function() {
        console.log('Sidebar Raul Drunk: syncSidebarBubbles called (early stub)');
    };

    function init() {
        console.log('Sidebar Raul Drunk: Initializing...');

        const sidebar = document.getElementById('app-sidebar');
        if (!sidebar) {
            console.warn('Sidebar Raul Drunk: #app-sidebar not found yet, retrying...');
            setTimeout(init, 200);
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
            // Hover Effects
            treeContainer.addEventListener('mouseover', (e) => {
                const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
                if (wrapper) {
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

            // Click Effects
            treeContainer.addEventListener('mousedown', (e) => {
                const node = e.target.closest('.tree-node');
                if (node && !node.classList.contains('active')) {
                    node.classList.add('intermediate');
                }
            });

            treeContainer.addEventListener('mouseup', () => {
                document.querySelectorAll('.tree-node.intermediate').forEach(n => n.classList.remove('intermediate'));
            });

            treeContainer.addEventListener('click', (e) => {
                const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
                if (wrapper) {
                    moveBubbleTo(activeBubble, wrapper);
                }
            });
        }

        // Override stub with real implementation
        window.syncSidebarBubbles = function() {
            const activeItem = sidebar.querySelector('.tree-item-wrapper.active, .menu-item-wrapper.active, .nav-link.active');
            if (activeItem) {
                moveBubbleTo(activeBubble, activeItem);
            } else {
                activeBubble.style.opacity = '0';
            }
        };

        // Initial sync after short delay to allow rendering to complete
        setTimeout(window.syncSidebarBubbles, 500);
        console.log('Sidebar Raul Drunk: Full initialization complete.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
