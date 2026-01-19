export function showView(viewName) {
    console.log(`showView('${viewName}') called`);
    try {
        // Only target top-level views to avoid hiding sub-views unintentionally
        const views = document.querySelectorAll('#main-content > .view');
        console.log(`Found ${views.length} top-level views to manage`);
        
        views.forEach(view => {
            view.classList.add('hidden');
            view.classList.remove('active');
        });

        const targetView = document.getElementById(viewName);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
            console.log(`Switched to view: ${viewName}`);
        } else {
            console.warn(`View not found: ${viewName}`);
        }

        // Header/Sidebar handling
        const header = document.querySelector('header');
        const sidebar = document.querySelector('aside');
        
        if (viewName === 'loginView') {
            if (header) header.classList.add('hidden');
            if (sidebar) sidebar.classList.add('hidden');
            document.body.classList.add('login-page');
        } else {
            if (header) header.classList.remove('hidden');
            
            if (sidebar) {
                sidebar.classList.remove('hidden');
                
                // Ensure sidebar toggle works
                const toggleBtn = document.getElementById('sidebarToggle');
                if (toggleBtn) {
                    toggleBtn.onclick = () => {
                        sidebar.classList.toggle('collapsed');
                    };
                }
            }
            document.body.classList.remove('login-page');
        }

        // Trigger redraw for any visible Tabulator instances
        try {
            redrawAllVisibleTabulators();
        } catch (re) {
            console.warn('Tabulator redraw failed (non-critical):', re);
        }
    } catch (err) {
        console.error(`CRITICAL ERROR in showView('${viewName}'):`, err);
    }
}

/**
 * Standard Tabulator Configuration and Redraw Logic
 */
export const TABULATOR_BASE_CONFIG = {
    layout: "fitData",
    height: "100%",
    resizableColumnFit: false,
    movableColumns: true,
    history: true,
    pagination: "local",
    paginationSize: 50,
    columnDefaults: {
        tooltip: true,
        vertAlign: "middle",
        hozAlign: "left",
        headerFilter: "input"
    }
};

const tabulatorRegistry = new Set();

/**
 * Register a Tabulator instance for global management (e.g. redrawing on view change)
 */
export function registerTabulator(table) {
    if (table) tabulatorRegistry.add(table);
}

/**
 * Redraw all registered Tabulator instances that are currently visible in the DOM
 */
export function redrawAllVisibleTabulators() {
    tabulatorRegistry.forEach(table => {
        // Only redraw if the element is actually visible in the DOM
        if (table && table.element && table.element.offsetParent !== null) {
            robustRedraw(table);
        }
    });
}

/**
 * Robust redraw for Tabulator instances.
 * Handles initial flexbox rendering issues and container visibility changes.
 * Includes safety checks to prevent "offsetWidth of null" errors during redraw.
 */
export function robustRedraw(table) {
    if (!table || !table.element) return;
    
    const safeRedraw = () => {
        try {
            // Only redraw if the element is still in the DOM and has a parent (is visible)
            if (table.element && table.element.offsetParent !== null) {
                table.redraw();
            }
        } catch (err) {
            console.warn('Tabulator redraw suppressed:', err.message);
        }
    };

    // 1. Immediate attempt
    safeRedraw();
    
    // 2. Short delay to catch view transitions
    setTimeout(safeRedraw, 50);
    
    // 3. Longer delay for complex flexbox stabilization
    setTimeout(safeRedraw, 250);
}
