export function showView(viewName) {
    console.log(`showView('${viewName}') called`);

    // --- REFINED SECURITY GUARD: SANCTITY ENFORCEMENT ---
    // We only restrict views AFTER login is established. 
    // Login and Public views are always allowed.
    const PUBLIC_VIEWS = ['loginView', 'public-view'];
    const RESTRICTED_VIEWS = ['settings-view', 'admin-view'];
    
    const token = localStorage.getItem('token');
    const userJson = localStorage.getItem('currentUser');
    const user = userJson ? JSON.parse(userJson) : null;
    const role = user ? (user.role || '').toLowerCase() : '';

    // 1. If trying to access a non-public view without a token, force login
    if (!PUBLIC_VIEWS.includes(viewName) && !token) {
        console.warn(`SECURITY: Unauthorized access attempt to ${viewName}. Redirecting to login.`);
        return showView('loginView');
    }

    // 2. If trying to access restricted admin views without admin privileges
    if (RESTRICTED_VIEWS.includes(viewName) && (role !== 'admin' && role !== 'superuser')) {
        console.error(`SECURITY: Access denied to ${viewName} for role: ${role}`);
        if (typeof window.showToast === 'function') {
            window.showToast('Access Restricted: Administrator privileges required.', 'error');
        }
        return; // Block the switch
    }
    // --------------------------------------------------

    try {
        // Execute cleanup for the current active view before switching
        const currentActive = document.querySelector('#main-content > .view.active');
        if (currentActive) {
            const currentViewId = currentActive.id;
            if (viewCleanupRegistry[currentViewId]) {
                console.log(`Executing cleanup for ${currentViewId}`);
                try {
                    viewCleanupRegistry[currentViewId]();
                } catch (cleanupErr) {
                    console.error(`Error cleaning up view ${currentViewId}:`, cleanupErr);
                }
            }
        }

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
            
            // Reset dashboard hierarchy state if switching to a non-dashboard view
            // to ensure it starts fresh when returning
            if (viewName !== 'dashboardView' && window.currentDashboardParent) {
                console.log('Resetting currentDashboardParent for non-dashboard view');
                window.currentDashboardParent = null;
            }
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
 * RBAC Helper: Check if current user has a specific permission
 * @param {string} permissionKey 
 * @returns {boolean}
 */
export function hasPermission(permissionKey) {
    const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const permissions = user.permissions || [];
    const role = user.role || '';
    
    // Superusers and Admins bypass all checks
    if (role === 'superuser' || role === 'admin') return true;
    
    return permissions.includes(permissionKey);
}

/**
 * RBAC Helper: Check if user can view asset pricing
 */
export function canViewPrice() {
    return hasPermission('asset.view_price');
}

/**
 * RBAC Helper: Check if user can edit asset pricing
 */
export function canEditPrice() {
    return hasPermission('asset.edit_price');
}

/**
 * Apply UI restrictions based on user permissions
 * @param {object} user 
 */
export function applyRbacUiRestrictions(user) {
    console.log('[RBAC] Applying UI restrictions for:', user.role);
    
    const permissions = user.permissions || [];
    const role = user.role || '';
    const isAdmin = role === 'admin' || role === 'superuser';
    const canViewPrice = isAdmin || permissions.includes('asset.view_price');
    const canEditPrice = isAdmin || permissions.includes('asset.edit_price');
    const canManageUsers = isAdmin || permissions.includes('user.manage');

    // 1. Price Visibility
    if (!canViewPrice) {
        document.querySelectorAll('.can-view-price').forEach(el => {
            el.style.display = 'none';
        });
        console.log('[RBAC] Hidden price fields/columns');
    }

    // 2. Price Editing
    if (!canEditPrice) {
        const priceInputs = ['itemValue', 'itemCurrency', 'itemUnitPrice'];
        priceInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.disabled = true;
                el.title = 'You do not have permission to edit price information.';
            }
        });
        console.log('[RBAC] Disabled price editing');
    }

    // 3. User Management
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin && !canManageUsers) {
        navAdmin.style.display = 'none';
    }

    // 4. Settings Module
    const navSettings = document.getElementById('nav-settings');
    if (navSettings && !isAdmin && !permissions.includes('module.settings.access')) {
        navSettings.style.display = 'none';
    }

    // 5. Category Management
    const btnAddCategory = document.getElementById('btnAddCategory');
    if (btnAddCategory && !isAdmin && !permissions.includes('category.create')) {
        btnAddCategory.style.display = 'none';
    }
}
window.applyRbacUiRestrictions = applyRbacUiRestrictions;

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Should allow fallback to alert if container missing?

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <span style="font-size: 1.2em;">${icon}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 290);
    }, 3000);
}

// Expose to window for legacy code
window.showToast = showToast;

/**
 * View Cleanup Registry
 * Allows modules to register cleanup functions that run when leaving a view.
 */
const viewCleanupRegistry = {};

export function registerViewCleanup(viewId, cleanupFn) {
    if (typeof cleanupFn === 'function') {
        viewCleanupRegistry[viewId] = cleanupFn;
        console.log(`Registered cleanup for view: ${viewId}`);
    } else {
        console.warn(`Invalid cleanup function for view: ${viewId}`);
    }
}

/**
 * Standard Tabulator Configuration and Redraw Logic
 */
export const TABULATOR_BASE_CONFIG = {
    layout: "fitColumns",
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
