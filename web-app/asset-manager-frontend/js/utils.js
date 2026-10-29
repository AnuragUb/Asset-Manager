export function showView(viewName) {
    console.log(`showView('${viewName}') called`);
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
            // PO carousel is body-level — must not cover the login form
            if (typeof window.closePoCarousel === 'function') {
                window.closePoCarousel();
            } else {
                const overlay = document.getElementById('poCarouselOverlay');
                if (overlay) {
                    overlay.classList.remove('po-carousel-open');
                    overlay.hidden = true;
                }
            }
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
 * Session user for RBAC. Prefer the live login object — localStorage
 * `currentUser` is not written by the login path.
 */
export function currentAuthUser() {
    if (typeof window !== 'undefined' && window.currentUser && (window.currentUser.role || window.currentUser.permissions)) {
        return window.currentUser;
    }
    try {
        return JSON.parse(localStorage.getItem('currentUser') || '{}');
    } catch (_err) {
        return {};
    }
}

/** Legacy view.* → canonical resource.view (must match backend permissionCatalog). */
const PERMISSION_ALIASES = {
    'view.assets': 'asset.view',
    'view.inventory': 'inventory.view',
    'view.products': 'product.view',
    'view.purchase_orders': 'purchase_order.view',
    'view.purchase_books': 'purchase_book.view',
    'view.receipt_notes': 'receipt_note.view',
    'view.physical_intake': 'physical_intake.view',
    'view.reservations': 'reservation.view',
    'view.sets': 'set.view',
    'view.dc': 'dc.view',
    'view.projects': 'project.view',
    'view.warranty': 'warranty.view',
    'view.dashboard': 'dashboard.view',
    'view.history': 'history.view',
    'view.settings': 'settings.view',
    'view.recovery': 'recovery.view',
    'view.scanner': 'scanner.view',
    'view.admin': 'admin.view',
    'view.releases': 'release.view'
};

function permissionEquivalents(key) {
    const k = String(key || '');
    const canon = PERMISSION_ALIASES[k] || k;
    const set = new Set([k, canon]);
    Object.entries(PERMISSION_ALIASES).forEach(([legacy, target]) => {
        if (target === canon) set.add(legacy);
    });
    return [...set];
}

export { permissionEquivalents, PERMISSION_ALIASES };

/**
 * Canonical page-visibility keys. view.dashboard is Dashboard only.
 * Unknown views are fail-closed in canOpenAppView().
 */
export const APP_VIEW_PERMISSIONS = {
    'operations-view': 'dashboard.view',
    'home-view': 'asset.view',
    'inventory-view': 'inventory.view',
    'sets-view': 'set.view',
    'receipts-view': 'receipt_note.view',
    'purchase-orders-view': 'purchase_order.view',
    'purchase-books-view': ['purchase_book.view', 'purchase_order.view'],
    'products-view': 'product.view',
    'reservations-view': 'reservation.view',
    'history-view': 'history.view',
    'tally-view': 'dashboard.view',
    'physical-intakes-view': 'physical_intake.view',
    'dc-view': 'dc.view',
    'employee-view': 'user.manage',
    'warranty-view': 'warranty.view',
    'releases-view': 'release.view',
    'admin-view': 'admin.view',
    'settings-view': 'settings.view',
    'recovery-center-view': 'recovery.view'
};

/** Retired from the product UI. Nav and hash routes stay closed for every role. */
export const RETIRED_APP_VIEWS = new Set(['projects-view', 'scanner-view']);

/** RBAC Settings tickers: page label → permission key that actually gates the page. */
export const PAGE_ACCESS_PERMISSIONS = [
    { page: 'Dashboard', key: 'dashboard.view' },
    { page: 'Products', key: 'product.view' },
    { page: 'Inventory', key: 'inventory.view' },
    { page: 'Assets', key: 'asset.view' },
    { page: 'History', key: 'history.view' },
    { page: 'Reservations', key: 'reservation.view' },
    { page: 'Purchase Orders', key: 'purchase_order.view' },
    { page: 'Purchase Books', key: 'purchase_book.view' },
    { page: 'Receipt Notes', key: 'receipt_note.view' },
    { page: 'Sets', key: 'set.view' },
    { page: 'Create DC', key: 'dc.view' },
    { page: 'Warranty', key: 'warranty.view' },
    { page: 'Settings', key: 'settings.view' },
    { page: 'Recovery', key: 'recovery.view' },
    { page: 'Physical Intake', key: 'physical_intake.view' },
    { page: 'Admin', key: 'admin.view' },
    { page: 'Releases', key: 'release.view' }
];

const SERVICE_PORTAL_HIDDEN_VIEWS = new Set([
    'operations-view',
    'home-view',
    'inventory-view',
    'sets-view',
    'receipts-view',
    'purchase-orders-view',
    'purchase-books-view',
    'products-view',
    'reservations-view',
    'history-view',
    'tally-view',
    'physical-intakes-view',
    'projects-view',
    'dc-view',
    'employee-view',
    'warranty-view'
]);

/**
 * RBAC Helper: Check if current user has a specific permission.
 * Superuser bypass is centralized here only — admin uses stored ticks.
 * @param {string} permissionKey
 * @returns {boolean}
 */
export function hasPermission(permissionKey) {
    const user = currentAuthUser();
    const permissions = user.permissions || [];
    const role = user.role || '';

    if (role === 'superuser') return true;

    return permissionEquivalents(permissionKey).some((k) => permissions.includes(k));
}

/**
 * Canonical frontend permission check (alias of hasPermission).
 */
export function can(permissionKey) {
    return hasPermission(permissionKey);
}

/**
 * Can this session open a named app view? Matches nav visibility, including
 * admin/superuser bypass via hasPermission(). Unknown views are denied.
 */
export function canOpenAppView(viewId) {
    const raw = String(viewId || '').split('?')[0];
    if (!raw) return false;
    if (RETIRED_APP_VIEWS.has(raw)) return false;
    const user = currentAuthUser();
    const category = user.category || 'IT';
    const servicePortal = category === 'SERVICE' || category === 'In-House';
    if (raw === 'arri-view') return servicePortal;
    if (servicePortal && SERVICE_PORTAL_HIDDEN_VIEWS.has(raw)) return false;
    const perm = APP_VIEW_PERMISSIONS[raw];
    if (!perm) return false;
    if (Array.isArray(perm)) return perm.some((key) => hasPermission(key));
    return hasPermission(perm);
}

if (typeof window !== 'undefined') {
    window.hasPermission = hasPermission;
    window.can = can;
    window.canOpenAppView = canOpenAppView;
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
    
    // Use canonical hasPermission (superuser-only bypass). Admin uses stored ticks.
    const canViewPrice = hasPermission('asset.view_price');
    const canEditPrice = hasPermission('asset.edit_price');
    const canManageUsers = hasPermission('user.manage');

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

    // 3. User Management / Admin nav
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin && !hasPermission('admin.view') && !canManageUsers) {
        navAdmin.style.display = 'none';
    }

    // 4. Settings / Recovery / Scanner page visibility
    const navSettings = document.getElementById('nav-settings');
    if (navSettings && !hasPermission('settings.view')) {
        const wrap = navSettings.closest('li') || navSettings.closest('.menu-item-wrapper') || navSettings;
        wrap.style.display = 'none';
    }
    const navRecovery = document.getElementById('nav-recovery-center');
    if (navRecovery && !hasPermission('recovery.view')) {
        const wrap = navRecovery.closest('li') || navRecovery.closest('.menu-item-wrapper') || navRecovery;
        wrap.style.display = 'none';
    }
    ['nav-scanner', 'nav-projects'].forEach((navId) => {
        const nav = document.getElementById(navId);
        if (!nav) return;
        const wrap = nav.closest('li') || nav.closest('.menu-item-wrapper') || nav;
        wrap.style.display = 'none';
        wrap.classList.add('hidden');
    });

    // 5. Category Management
    const btnAddCategory = document.getElementById('btnAddCategory');
    if (btnAddCategory && !hasPermission('category.create')) {
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
