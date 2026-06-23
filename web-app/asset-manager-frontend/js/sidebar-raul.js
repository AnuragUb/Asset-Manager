
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
        const sidebarContent = [document.getElementById('sidebar-tree'), document.getElementById('system-menu')];
        
        sidebarContent.forEach(container => {
            if (!container) return;
            
            // Hover Effects
            container.addEventListener('mouseover', (e) => {
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

            container.addEventListener('mouseout', (e) => {
                hoverBubble.style.opacity = '0';
            });

            // Click Effects
            container.addEventListener('click', (e) => {
                const wrapper = e.target.closest('.tree-item-wrapper, .menu-item-wrapper');
                if (wrapper) {
                    moveBubbleTo(activeBubble, wrapper);
                }
            });
        });

        // Override stub with real implementation
        window.syncSidebarBubbles = function() {
            // Look for active items in both tree and system menu
            const activeItem = sidebar.querySelector('.tree-item-wrapper.active, .menu-item-wrapper.active');
            
            if (activeItem) {
                // Check if the item's parent container is hidden
                const parentMenu = activeItem.closest('.sidebar-menu');
                if (parentMenu && parentMenu.classList.contains('hidden')) {
                    activeBubble.style.opacity = '0';
                } else {
                    moveBubbleTo(activeBubble, activeItem);
                }
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
