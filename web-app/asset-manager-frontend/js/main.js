console.log('MAIN.JS: Entry point (v7.61)');
import { showView, hasPermission, canOpenAppView } from './utils.js?v=7.43';
import { renderDashboard, setupDashboard, setupDashboardFormHandlers, renderSidebarTree, editAsset } from './dashboard.js?v=7.166';
import './dcDocumentView.js?v=2.3';
// import { initScannerView } from './networkScanner.js?v=5.50';
import { renderItAssets } from './itAssets.js?v=6.60';
import { setupAuth, checkSession } from './auth.js?v=7.31';
import { HierarchyManager } from './hierarchy.js?v=6.67';
import { initEmployeeView, loadEmployees } from './employees.js?v=6.60';
// import { setupOcr } from './ocr.js?v=5.50';
import { initWarrantyView } from './warranty.js?v=6.60';
import { initProjectsView } from './projects.js?v=7.27';
import { initInventoryView } from './inventory.js?v=7.120';
import { initKitSetsView } from './kitSets.js?v=7.56';
import { initReceiptsView } from './receipts.js?v=7.134';
import { initPurchaseOrdersView } from './purchase-orders.js?v=7.132';
import { initPurchaseBooksView } from './purchase-books.js?v=7.129';
import { initProductsView } from './products.js?v=7.131';
import { initOperationsView } from './operations.js?v=7.80';
import { initReservationsView } from './reservations.js?v=7.31';
import { initHistoryView } from './lifecycle-history.js?v=7.116';
import { initPhysicalIntakesView } from './physical-intakes.js?v=7.112';
import { initTallyView } from './tally.js?v=2.5';
import { initRecoveryCenterView, refreshRecoveryCenterBadge } from './recovery-center.js?v=7.07';
import { initSettingsView } from './settings.js?v=6.61';
import { initCompanyTemplates } from './companyTemplates.js?v=6.61';
// import { initAssetsReportView } from './assetsReport.js?v=6.60';  // file does not exist; dead import caused ES6 module graph abort
import { initLoginAnimations, initLoginModuleSelector, initSignupModal } from './loginAnimations.js?v=7.36';
import { initFormAutosave } from './formAutosave.js?v=6.60';
import { initContextMenu } from './contextMenu.js?v=7.48';
import { initServicePortal } from './servicePortal.js?v=6.60';
import { initDCProjectFetcher, initDCAliasLogic, initDCPoFetcher } from './dcProjectFetcher.js?v=7.116';
import { bindSerialIdentityPanel } from './serialIdentityUi.js?v=7.112';
import './lifecycle.js?v=7.33';
import './quantity-usage-modal.js?v=7.112';
import './hsn-history-modal.js?v=1.0';

// Mark the ES module graph as successfully evaluated. The index.html watchdog
// only means "main.js (or a dependency) failed to import" — not that every
// feature init finished. Set this immediately so slow/optional inits cannot
// false-trigger the red banner on other PCs/networks.
window.mainLoaded = true;
console.log('MAIN.JS: Module graph loaded (v7.93)');
try { bindSerialIdentityPanel(); } catch (e) { console.warn('[serials] bind failed', e); }

// Expose showView to global scope for other modules
window.showView = showView;

// Global diagnostic for Warranty
window.checkWarranty = () => {
    const nav = document.getElementById('nav-warranty');
    const view = document.getElementById('warranty-view');
    const initFn = typeof initWarrantyView === 'function' || typeof window.initWarrantyView === 'function';
    
    console.log('--- Warranty Diagnostic ---');
    console.log('Nav element:', nav);
    console.log('Nav display:', nav ? getComputedStyle(nav).display : 'N/A');
    console.log('Nav visibility:', nav ? getComputedStyle(nav).visibility : 'N/A');
    console.log('View element:', view);
    console.log('View classes:', view ? view.className : 'N/A');
    console.log('View display:', view ? getComputedStyle(view).display : 'N/A');
    console.log('Init function exists:', initFn);
    console.log('--- End Diagnostic ---');
    
    if (initFn) {
        console.log('Manually triggering click on Warranty nav...');
        nav.click();
    }
};

// Initialize Company Templates
try { initCompanyTemplates(); } catch (err) { console.error('initCompanyTemplates failed:', err); }

// Initialize DC Project Fetcher
try {
    initDCProjectFetcher();
    initDCPoFetcher();
    initDCAliasLogic();
} catch (err) {
    console.error('DC fetcher init failed:', err);
}

// Initialize Form Autosave
try { initFormAutosave(); } catch (err) { console.error('initFormAutosave failed:', err); }

// --- RELEASES VIEW RENDERING ---
export function renderReleases() {
    console.log('renderReleases() called');
    const content = document.getElementById('release-notes-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="release-item" style="margin-bottom: 20px; padding: 15px; background: #e7f3ff; border-left: 4px solid #0056b3; border-radius: 4px;">
            <h3 style="margin-top: 0; color: #0056b3;">Beta - Public Preview</h3>
            <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">Released: January 13, 2026</p>
            <ul style="padding-left: 20px;">
                <li><strong>Initial Beta Launch:</strong> Preparing for production release.</li>
                <li><strong>Performance:</strong> Optimized asset grid and OCR processing.</li>
            </ul>
        </div>
        <div class="release-item" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px;">
            <h3 style="margin-top: 0; color: #007bff;">v3.1 - Asset Manager Refinement</h3>
            <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">Released: January 2, 2026</p>
            <ul style="padding-left: 20px;">
                <li><strong>Centralized Navigation:</strong> Fixed view switching logic to prevent navigation breaks.</li>
                <li><strong>Hierarchy Manager:</strong> Improved sidebar with nested categories and drill-down dashboard.</li>
                <li><strong>Data Processor:</strong> Enhanced fuzzy mapping for IT-specific fields in Excel uploads.</li>
            </ul>
        </div>
        <div class="release-item" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-left: 4px solid #28a745; border-radius: 4px;">
            <h3 style="margin-top: 0; color: #28a745;">v3.0 - Modular Architecture</h3>
            <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">Released: December 2025</p>
            <ul style="padding-left: 20px;">
                <li>Complete refactor to ES6 modules.</li>
                <li>New dashboard card view with real-time stats.</li>
                <li>Unified asset management across IT and General categories.</li>
            </ul>
        </div>
    `;
}
window.renderReleases = renderReleases;

console.log('MAIN.JS: Module loading started (v3.0)');

// DIAGNOSTIC START
window.sidebarDiagnostic = function() {
    const s = document.getElementById('app-sidebar');
    const t = document.getElementById('sidebar-tree');
    console.log('--- SIDEBAR DIAGNOSTIC ---');
    console.log('Sidebar element:', s);
    console.log('Tree element:', t);
    console.log('Sidebar classes:', s ? s.className : 'N/A');
    console.log('Sidebar display style:', s ? s.style.display : 'N/A');
    console.log('Sidebar computed display:', s ? getComputedStyle(s).display : 'N/A');
    console.log('Sidebar offsetWidth:', s ? s.offsetWidth : 'N/A');
    console.log('--- END DIAGNOSTIC ---');
};
window.sidebarDiagnostic();
// DIAGNOSTIC END

let assets = [];
let assetKinds = [];
let folders = [];

// Instantiate Hierarchy Manager
window.hierarchyManager = new HierarchyManager();
window.loadFolders = loadAssetKinds; // Alias to refresh both kinds and folders
window.loadAssetKinds = loadAssetKinds;
window.loadAssets = loadAssets;

async function loadAssetKinds() {
    console.log('loadAssetKinds() called');
    try {
        const t = Date.now();
        const [kindsRes, foldersRes] = await Promise.all([
            fetch(`/api/asset_kinds?t=${t}`),
            fetch(`/api/folders?t=${t}`)
        ]);

        if (kindsRes.ok) {
            assetKinds = await kindsRes.json();
            window.allAssetKinds = assetKinds;
        }
        if (foldersRes.ok) {
            folders = await foldersRes.json();
            window.allFolders = folders;
        }

        console.log(`Loaded ${assetKinds.length} kinds and ${folders.length} folders`);
        
        // Initialize Hierarchy Manager with combined data using standardized mapping
        const combinedData = HierarchyManager.mapNodes(folders, assetKinds);
        window.hierarchyManager = new HierarchyManager(combinedData);
        console.log('HierarchyManager initialized with', combinedData.length, 'nodes');

        // Parent options for Category / Make are filled when the modal opens
        // (folder vs category vs make rules live in openAddKindModal).
    } catch (err) {
        console.error('Failed to load asset kinds/folders:', err);
    }
}

async function loadAssets() {
    console.log('loadAssets() called');
    
    // Show skeletons if we are in dashboard view
    const dashboardView = document.getElementById('dashboardView');
    if (dashboardView && !dashboardView.classList.contains('hidden')) {
        if (typeof window.renderSkeletons === 'function') {
            window.renderSkeletons();
        }
    }

    try {
        await Promise.all([
            loadAssetKinds(),
            loadEmployees()
        ]);
        
        let url = `/api/assets?all=true&t=${Date.now()}`;
        if (currentUser && currentUser.role === 'client' && currentUser.projectId) {
            url += `&projectId=${currentUser.projectId}`;
        }
        
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            // Handle both array (legacy/all) and paginated object (new)
            const assetsData = Array.isArray(data) ? data : (data.data || []);
            
            console.log('Raw assets from backend:', assetsData.length);
            // Map backend fields to frontend expected fields
            const processedAssets = assetsData.map(a => ({
                ...a,
                Name: a.Type || a.ItemName,
                Status: a.Status || 'In Store'
            }));
            assets = processedAssets;
            window.assets = processedAssets;
            window.allAssets = processedAssets; // Store globally for other views
            console.log('Processed assets:', assets.length);
        } else {
            console.error('Failed to load assets, status:', response.status);
        }
    } catch (err) {
        console.error('Failed to load assets:', err);
    }
}

async function saveAsset(asset) {
    if (asset && Object.prototype.hasOwnProperty.call(asset, 'ParentId')) {
        const normalizedParentId = String(asset.ParentId || '').trim();
        asset.ParentId = normalizedParentId === '' ? null : normalizedParentId;
    }
    console.log('saveAsset() payload:', JSON.stringify(asset, null, 2));
    const username = currentUser ? currentUser.username : (localStorage.getItem('username') || 'web');
    
    // Determine if this is an update or a new asset
    // Assets from the database will have an ID (API may send ID, Id, or id)
    const assetId = String(asset.ID || asset.Id || asset.id || '').trim();
    if (!assetId) {
        if (typeof showToast === 'function') {
            showToast('Procurement stock is created through Receipt Notes. Existing / non-procurement stock is registered with Physical Intake.', 'info');
        } else {
            alert('Procurement stock is created through Receipt Notes. Existing / non-procurement stock is registered with Physical Intake.');
        }
        return null;
    }
    const method = 'PUT';
    const url = `/api/assets/${encodeURIComponent(assetId)}`;

    try {
        const init = {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'x-user': username
            }
        };
        const response = typeof window.aeFetchWithOverride === 'function'
            ? await window.aeFetchWithOverride(url, init, asset)
            : await fetch(url, { ...init, body: JSON.stringify(asset) });
        if (!response) return false;
        
        if (response.ok) {
            const result = await response.json().catch(() => ({ success: true }));
            console.log('Asset saved successfully', result);
            
            // Clear autosave draft
            if (window.clearAssetDraft) window.clearAssetDraft();

            await loadAssets(); // Reload to get the latest state from DB
            await renderSidebarTree(); // Re-render sidebar to update counts and hierarchy
            
            // If we are in the dashboard view, re-render it
            const dashboardView = document.getElementById('dashboardView');
            if (dashboardView && dashboardView.style.display !== 'none') {
                console.log('Post-save dashboard re-render with assets count:', (window.allAssets || []).length);
                renderDashboard(window.allAssets, filteredAssets);
            }
            
            return result;
        } else {
            const errText = typeof window.aeReadResponseError === 'function'
                ? await window.aeReadResponseError(response)
                : await response.text();
            alert('Error saving asset: ' + errText);
            return false;
        }
    } catch (err) {
        alert('Error saving asset: ' + err.message);
        return false;
    }
}
window.loadAssets = loadAssets;
window.saveAsset = saveAsset;
window.editAsset = editAsset;

// Page-level info tips (.rn-info-tip--portal) render in one fixed #aeGhostTip on <body>,
// so they sit above every stacking context and never hide behind the top bar.
// Buttons already bound directly (products.js) are left to their own handler.
function setupGhostInfoTips() {
    const GAP = 10;
    const MARGIN = 8;
    const ensureTip = () => {
        let tip = document.getElementById('aeGhostTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'aeGhostTip';
            tip.className = 'ae-ghost-tip';
            tip.setAttribute('role', 'tooltip');
            document.body.appendChild(tip);
        }
        return tip;
    };
    const tipAnchor = (target) => {
        const btn = target && target.closest ? target.closest('.rn-info-tip--portal[data-tip]') : null;
        return btn && !btn.dataset.ghostTipBound ? btn : null;
    };
    const show = (btn) => {
        const tip = ensureTip();
        tip.textContent = btn.getAttribute('data-tip') || '';
        tip.style.left = '0px';
        tip.style.top = '0px';
        tip.classList.add('is-on');
        const a = btn.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const header = document.getElementById('app-header');
        const headerBottom = header && !header.classList.contains('hidden') ? header.getBoundingClientRect().bottom : 0;
        const minTop = Math.max(MARGIN, headerBottom + MARGIN);
        let left = a.right + GAP;
        if (left + t.width > window.innerWidth - MARGIN) left = a.left - GAP - t.width;
        let top = a.top + (a.height / 2) - (t.height / 2);
        if (left < MARGIN) {
            left = a.left + (a.width / 2) - (t.width / 2);
            top = a.bottom + GAP;
        }
        left = Math.max(MARGIN, Math.min(left, window.innerWidth - t.width - MARGIN));
        top = Math.max(minTop, Math.min(top, window.innerHeight - t.height - MARGIN));
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    };
    const hide = () => document.getElementById('aeGhostTip')?.classList.remove('is-on');

    document.addEventListener('mouseover', (e) => {
        const btn = tipAnchor(e.target);
        if (btn && !btn.contains(e.relatedTarget)) show(btn);
    });
    document.addEventListener('mouseout', (e) => {
        const btn = tipAnchor(e.target);
        if (btn && !btn.contains(e.relatedTarget)) hide();
    });
    document.addEventListener('focusin', (e) => {
        const btn = tipAnchor(e.target);
        if (btn) show(btn);
    });
    document.addEventListener('focusout', (e) => {
        if (tipAnchor(e.target)) hide();
    });
    document.addEventListener('click', (e) => {
        if (tipAnchor(e.target)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    window.addEventListener('scroll', hide, true);
}
setupGhostInfoTips();

function handleInitialUrl() {
    const hash = window.location.hash;
    console.log('[InitialURL] Checking hash:', hash);
    if (!hash) return;

    // Format: #view-name?id=XYZ
    const parts = hash.substring(1).split('?');
    const viewName = parts[0];
    const queryString = parts[1] || '';
    const params = new URLSearchParams(queryString);
    const id = params.get('id');

    console.log(`[InitialURL] Parsed View: ${viewName}, ID: ${id}`);

    if (viewName === 'projects-view' && id) {
        if (!canOpenAppView('projects-view')) return;
        console.log('[InitialURL] Triggering project details for:', id);
        // Switch to projects view first
        const navProjects = document.getElementById('nav-projects');
        if (navProjects) {
            navProjects.click();
            // Wait a bit for the view to initialize
            setTimeout(() => {
                if (window.showProjectDetails) {
                    window.showProjectDetails(id);
                } else {
                    console.error('[InitialURL] window.showProjectDetails not found');
                }
            }, 500);
        }
    } else if (viewName === 'dc-view' && id) {
        if (!canOpenAppView('dc-view')) return;
        const navDc = document.getElementById('nav-dc');
        if (navDc) {
            navDc.click();
            setTimeout(() => {
                if (window.openDeliveryChallan) {
                    window.openDeliveryChallan(id);
                }
            }, 500);
        }
    } else if (viewName === 'asset-details' && id) {
        console.log('[InitialURL] Triggering asset details for:', id);
        if (window.showAssetDetails) {
            window.showAssetDetails(id);
        }
    } else if (APP_VIEWS[viewName]) {
        if (!canOpenAppView(viewName)) {
            console.warn('[RBAC] blocked hash view:', viewName);
            const fallback = typeof findFirstAllowedLandingView === 'function'
                ? findFirstAllowedLandingView()
                : null;
            if (fallback) {
                if (typeof openLandingView === 'function') openLandingView(fallback);
                else if (typeof window.switchDashboardSubView === 'function') window.switchDashboardSubView(fallback);
            } else if (typeof showRbacNoAccessState === 'function') {
                showRbacNoAccessState();
            }
            return;
        }
        const navId = APP_VIEWS[viewName].navId;
        const navEl = navId ? document.getElementById(navId) : null;
        const hiddenByRbac = navEl && (navEl.classList.contains('hidden-by-rbac') || navEl.closest('.hidden-by-rbac'));
        if (navEl && !hiddenByRbac) {
            if (id) window.__lifecyclePending = { view: viewName, open: id, extra: Object.fromEntries(params.entries()) };
            navEl.click();
        } else if (typeof window.switchDashboardSubView === 'function') {
            if (id) window.__lifecyclePending = { view: viewName, open: id, extra: Object.fromEntries(params.entries()) };
            window.switchDashboardSubView(viewName);
        }
    }
}

// Handle hash changes (in-app navigation)
window.addEventListener('hashchange', handleInitialUrl);

let currentUser = null;
let filteredAssets = () => {
    const selectedCategory = localStorage.getItem('selectedAssetCategory');
    console.log('Filtering assets for category:', selectedCategory);
    
    // Exclude retired assets from the main view (unless specifically viewing them)
    let result = (assets || []).filter(a => {
        const isRetired = a.IsRetired == 1 || a.is_retired == 1;
        if (isRetired) console.log(`[Filter] Excluding retired asset: ${a.ID} (Status: ${a.Status})`);
        return !isRetired;
    });
    
    if (selectedCategory) {
        result = result.filter(a => a.Category === selectedCategory);
    }
    
    // Apply Status Filter (Raul Drunk Style)
    if (window.currentStatusFilter) {
        console.log('Applying status filter:', window.currentStatusFilter);
        result = result.filter(a => (a.Status || 'Owned') === window.currentStatusFilter);
    }
    
    console.log(`Found ${result.length} assets for category ${selectedCategory} and status ${window.currentStatusFilter || 'ALL'}`);
    return result;
}; 
window.getFilteredAssets = filteredAssets;
// Test if we can find the elements we need
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded (main.js) - Initializing navigation');
    const views = document.querySelectorAll('.view');
    console.log(`Found ${views.length} views`);
    
    // Setup navigation early, before auth
    setupNavigation();
    
    // Ensure login view is shown first — never leave PO carousel over auth
    if (typeof window.closePoCarousel === 'function') window.closePoCarousel();
    showView('loginView');
    
    // Initialize dynamic background
    initLoginAnimations();
    initLoginModuleSelector();
    initSignupModal();
    
    // setupOcr();
    
    // --- AUTHENTICATION & SESSION HANDLING ---
    const handleLoginSuccess = async (user) => {
        console.log('Login success callback triggered in main.js for user:', user.username);
        currentUser = user;
        window.currentUser = user; // Expose to window for global RBAC checks in other modules
        try {
            localStorage.setItem('currentUser', JSON.stringify({
                username: user.username,
                role: user.role,
                permissions: user.permissions || [],
                category: user.category || 'IT'
            }));
        } catch (_err) { /* ignore quota / private mode */ }
        localStorage.setItem('username', user.username); // Store for legacy module support
        if (window.location.hash) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
        
        // Update header title based on category
        const appTitle = document.querySelector('.app-title');
        if (appTitle && user.category) {
            // Extra validation to prevent UUID display
            let displayCategory = user.category;
            if (displayCategory.length > 20 || displayCategory.includes('-')) {
                 displayCategory = 'IT'; 
                 user.category = 'IT'; // correct the user object too
                 localStorage.setItem('selectedAssetCategory', 'IT');
            }
            
            // Map 'In-House' or 'SERVICE' to 'Service' for display
            if (displayCategory === 'In-House' || displayCategory === 'SERVICE') displayCategory = 'Service';
            
            appTitle.textContent = `${displayCategory} Asset Manager`;
        }

        // Update display username
        const userNameDisplay = document.getElementById('display-username');
        if (userNameDisplay && user.username) {
            userNameDisplay.textContent = user.username;
        }
        
        // Apply RBAC UI Restrictions (Price, Dept, etc.)
        if (typeof applyRbacUiRestrictions === 'function') {
            applyRbacUiRestrictions(user);
        } else {
            console.warn('applyRbacUiRestrictions not found, falling back to basic check');
            // Basic fallback if function isn't defined yet
            if (user.role === 'user' || user.role === 'client') {
                document.querySelectorAll('.can-view-price').forEach(el => el.style.display = 'none');
            }
        }
        
        await loadAssets();
        
        // Load temporary assets globally for search
        try {
            const tempRes = await fetch('/api/temporary-assets');
            if (tempRes.ok) {
                window.allTempAssets = await tempRes.json();
                console.log('Loaded global temp assets:', window.allTempAssets.length);
            }
        } catch (err) {
            console.error('Failed to load global temp assets:', err);
        }
        
        // Load employees globally so dropdowns are populated even if Employees tab isn't visited
        if (typeof loadEmployees === 'function') {
            await loadEmployees();
        }
        
        // setupNavigation() is already called, but we can call it again safely if we add checks
        setupNavigation();
        
        const dashboardView = document.getElementById('dashboardView');
        if (dashboardView) {
            // --- REDIRECT TO SERVICE PORTAL IF MODULE IS SERVICE ---
            if (user.category === 'SERVICE' || user.category === 'In-House') {
                console.log('[Login] Redirecting to Service Portal (arri-view)...');
                showView('arri-view');
                
                // Set nav-arri as active
                document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                const navArri = document.getElementById('nav-arri');
                if (navArri) navArri.classList.add('active');
                
                // We still want to load assets in the background, but the view is arri-view
                return; 
            }
            // ------------------------------------------------------

            // --- SMART DEFAULT VIEW (RBAC AWARE) ---
            // Page visibility uses canOpenAppView / hasPermission (superuser bypass centralized there).
            // Roles with zero page grants get an empty shell (no dashboard content).
            const landing = findFirstAllowedLandingView();
            if (!landing) {
                console.warn('[RBAC] No accessible pages for this role — showing blank state.');
                showRbacNoAccessState();
            } else if (landing === 'operations-view') {
                console.log('Found dashboardView and permission ok, switching...');
                showView('dashboardView');
                document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                syncTopNavActive('operations-view');
                hideAllDashboardSubviews();
                const ops = document.getElementById('operations-view');
                if (ops) {
                    ops.classList.remove('hidden');
                    ops.style.display = 'flex';
                    ops.style.flexDirection = 'column';
                }
                console.log('Rendering sidebar tree. Kinds:', (window.allAssetKinds || []).length);
                await renderSidebarTree();
                setupDashboard();
                setupDashboardFormHandlers();
                if (typeof initOperationsView === 'function') initOperationsView();
                renderDashboard(assets, filteredAssets);
            } else {
                console.log('[RBAC] Landing on allowed view:', landing);
                openLandingView(landing);
                if (landing === 'home-view' || landing === 'inventory-view') {
                    await renderSidebarTree();
                    setupDashboard();
                    setupDashboardFormHandlers();
                }
            }
            // ----------------------------------------

            // Check for edit parameter in URL
            const urlParams = new URLSearchParams(window.location.search);
            const editId = urlParams.get('edit');
            if (editId && canOpenAppView('home-view')) {
                const assetToEdit = assets.find(a => a.ID === editId);
                if (assetToEdit) {
                    editAsset(assetToEdit);
                }
                // Clear the parameter without reloading
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
            }

            // Handle hash-based routing and details (e.g. from QR scan)
            handleInitialUrl();
            
            // Ensure default view has a hash if none exists (and role may open a page)
            if (!window.location.hash && landing) {
                window.history.replaceState({ subView: landing }, '', '#' + landing);
            }
        } else {
            console.error('Could NOT find dashboardView element!');
            alert('Error: Assets view not found in the page.');
        }
    };

    setupAuth(handleLoginSuccess);

    // Check for existing session on load
    (async () => {
        console.log('Checking for existing session...');
        const user = await checkSession();
        if (user) {
            console.log('Session restored for:', user.username);
            // Restore category if missing
            if (!user.category || user.category === 'IT') {
                let savedCategory = localStorage.getItem('selectedAssetCategory');
                // Validate category - prevent UUIDs or invalid strings
                if (savedCategory && (savedCategory.length > 20 || savedCategory.includes('-'))) {
                    console.warn('Invalid category in localStorage:', savedCategory);
                    localStorage.removeItem('selectedAssetCategory');
                    savedCategory = null;
                }
                user.category = savedCategory || user.category || 'IT';
            }
            console.log(`[MainSessionRestore] Final category: ${user.category}`);
            handleLoginSuccess(user);
        } else {
            console.log('No active session found.');
            // Capture return URL if not at root
            if (window.location.pathname !== '/' || window.location.hash || window.location.search) {
                sessionStorage.setItem('returnTo', window.location.href);
            }
        }
    })();
});

// --- VIEW CONFIGURATION MODULE ---
const APP_VIEWS = {
    'operations-view': { id: 'operations-view', navId: 'nav-operations', sidebar: false, default: true },
    'home-view': { id: 'home-view', navId: 'nav-dashboard', sidebar: true },
    'sheet-view': { id: 'sheet-view', navId: 'nav-sheet', sidebar: true },
    'employee-view': { id: 'employee-view', navId: 'nav-employees', sidebar: true },
    'inventory-view': { id: 'inventory-view', navId: 'nav-inventory', sidebar: true },
    'physical-intakes-view': { id: 'physical-intakes-view', navId: 'nav-physical-intakes', sidebar: false },
    'sets-view': { id: 'sets-view', navId: 'nav-sets', sidebar: false },
    'receipts-view': { id: 'receipts-view', navId: 'nav-receipts', sidebar: false },
    'purchase-orders-view': { id: 'purchase-orders-view', navId: 'nav-purchase-orders', sidebar: false },
    'purchase-books-view': { id: 'purchase-books-view', navId: 'nav-purchase-books', sidebar: false },
    'products-view': { id: 'products-view', navId: 'nav-products', sidebar: false },
    'reservations-view': { id: 'reservations-view', navId: 'nav-reservations', sidebar: false },
    'history-view': { id: 'history-view', navId: 'nav-history', sidebar: false },
    'tally-view': { id: 'tally-view', navId: 'nav-tally', sidebar: false },
    'dc-view': { id: 'dc-view', navId: 'nav-dc', sidebar: false },
    'releases-view': { id: 'releases-view', navId: 'nav-releases', sidebar: true },
    'scanner-view': { id: 'scanner-view', navId: 'nav-scanner', sidebar: false },
    'projects-view': { id: 'projects-view', navId: 'nav-projects', sidebar: false },
    'ocr-view': { id: 'ocr-view', navId: 'nav-ocr', sidebar: false },
    'warranty-view': { id: 'warranty-view', navId: 'nav-warranty', sidebar: false },
    'settings-view': { id: 'settings-view', navId: 'nav-settings', sidebar: true },
    'recovery-center-view': { id: 'recovery-center-view', navId: 'nav-recovery-center', sidebar: true },
    'admin-view': { id: 'admin-view', navId: 'nav-admin', sidebar: true },
    'arri-view': { id: 'arri-view', navId: 'nav-arri', sidebar: false }
};

function hideAllDashboardSubviews() {
    const ids = [
        'rbac-no-access-view',
        'operations-view', 'home-view', 'sheet-view', 'employee-view', 'inventory-view',
        'sets-view', 'receipts-view', 'purchase-orders-view', 'purchase-books-view',
        'products-view', 'reservations-view', 'history-view', 'tally-view', 'physical-intakes-view',
        'dc-view', 'releases-view', 'scanner-view', 'projects-view', 'ocr-view',
        'warranty-view', 'settings-view', 'recovery-center-view', 'admin-view', 'arri-view'
    ];
    ids.forEach((sv) => {
        const el = document.getElementById(sv);
        if (!el) return;
        el.classList.add('hidden');
        el.style.display = 'none';
    });
}

/** Preferred landing order when the role has at least one page grant. */
const RBAC_LANDING_ORDER = [
    'operations-view',
    'home-view',
    'products-view',
    'inventory-view',
    'purchase-orders-view',
    'purchase-books-view',
    'receipts-view',
    'reservations-view',
    'history-view',
    'sets-view',
    'dc-view',
    'physical-intakes-view',
    'warranty-view',
    'releases-view',
    'settings-view',
    'recovery-center-view',
    'admin-view',
    'employee-view',
    'arri-view'
];

function findFirstAllowedLandingView() {
    return RBAC_LANDING_ORDER.find((id) => canOpenAppView(id)) || null;
}

function showRbacNoAccessState() {
    showView('dashboardView');
    hideAllDashboardSubviews();
    const panel = document.getElementById('rbac-no-access-view');
    if (panel) {
        panel.classList.remove('hidden');
        panel.style.display = 'flex';
    }
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        sidebar.classList.add('hidden');
        sidebar.style.display = 'none';
    }
    document.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
    if (window.location.hash) {
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
}

function openLandingView(viewId) {
    if (!viewId) {
        showRbacNoAccessState();
        return;
    }
    if (viewId === 'arri-view') {
        showView('arri-view');
        document.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
        document.getElementById('nav-arri')?.classList.add('active');
        return;
    }
    showView('dashboardView');
    if (typeof window.switchDashboardSubView === 'function') {
        window.switchDashboardSubView(viewId);
        return;
    }
    hideAllDashboardSubviews();
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'flex';
        if (viewId === 'dc-view' || viewId === 'warranty-view' || viewId === 'operations-view') {
            target.style.flexDirection = 'column';
        }
    }
    const navId = APP_VIEWS[viewId]?.navId;
    document.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
    if (navId) document.getElementById(navId)?.classList.add('active');
    window.history.replaceState({ subView: viewId }, '', '#' + viewId);
}

const LOGISTICS_NAV_IDS = ['nav-operations', 'nav-products', 'nav-history', 'nav-tally', 'nav-reservations', 'nav-purchase-orders', 'nav-purchase-books', 'nav-receipts', 'nav-dc'];

function closeLogisticsMenu() {
    const item = document.getElementById('nav-logistics-item');
    const toggle = document.getElementById('nav-logistics');
    const menu = document.getElementById('nav-logistics-menu');
    if (item) item.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
}

function positionLogisticsMenu() {
    const toggle = document.getElementById('nav-logistics');
    const menu = document.getElementById('nav-logistics-menu');
    if (!toggle || !menu || menu.hidden) return;
    const rect = toggle.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.left = `${Math.round(rect.left)}px`;
}

function openLogisticsMenu() {
    const item = document.getElementById('nav-logistics-item');
    const toggle = document.getElementById('nav-logistics');
    const menu = document.getElementById('nav-logistics-menu');
    if (!item || !toggle || !menu) return;
    // Portal to body so fixed z-index escapes nav stacking (bubbles/ul) and
    // still clears sticky view toolbars — without raising #app-header over modals.
    if (menu.parentElement !== document.body) {
        document.body.appendChild(menu);
    }
    item.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    positionLogisticsMenu();
}

function syncTopNavActive(subViewName) {
    document.querySelectorAll('.nav-link').forEach((n) => {
        n.classList.remove('active');
        n.classList.remove('is-current');
        n.removeAttribute('aria-current');
    });
    document.querySelectorAll('.menu-item-wrapper').forEach((w) => w.classList.remove('active'));
    const navId = APP_VIEWS[subViewName] && APP_VIEWS[subViewName].navId;
    const navLink = navId ? document.getElementById(navId) : null;
    if (!navLink) return;
    navLink.classList.add('is-current');
    navLink.setAttribute('aria-current', 'page');
    if (LOGISTICS_NAV_IDS.includes(navId)) {
        document.getElementById('nav-logistics')?.classList.add('active');
    } else if (navId === 'nav-physical-intakes') {
        navLink.classList.add('active');
        document.getElementById('nav-logistics')?.classList.add('active');
    } else {
        navLink.classList.add('active');
        const wrapper = navLink.closest('.menu-item-wrapper');
        if (wrapper) wrapper.classList.add('active');
    }
}

function setupLogisticsMenu() {
    const toggle = document.getElementById('nav-logistics');
    const item = document.getElementById('nav-logistics-item');
    if (!toggle || !item || toggle.dataset.navAttached) return;
    toggle.dataset.navAttached = 'true';
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.classList.contains('open')) closeLogisticsMenu();
        else openLogisticsMenu();
    });
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('nav-logistics-menu');
        if (item.contains(e.target) || (menu && menu.contains(e.target))) return;
        closeLogisticsMenu();
    });
    window.addEventListener('resize', () => {
        if (item.classList.contains('open')) positionLogisticsMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && item.classList.contains('open')) {
            closeLogisticsMenu();
            toggle.focus();
        }
    });
}

// Expose for external access if needed
window.APP_VIEWS = APP_VIEWS;

// Helper to get all view IDs
const ALL_VIEW_IDS = Object.values(APP_VIEWS).map(v => v.id);
const SIDEBAR_VIEW_IDS = Object.values(APP_VIEWS).filter(v => v.sidebar).map(v => v.id);

function switchDashboardSubView(subViewName) {
    console.log(`Switching dashboard subview to: ${subViewName}`);
    const rawName = String(subViewName || '').split('?')[0];
    subViewName = rawName;
    
    // Validate view name
    if (!APP_VIEWS[subViewName]) {
        console.warn(`Unknown view: ${subViewName}, defaulting to operations-view`);
        subViewName = 'operations-view';
    }

        if (!canOpenAppView(subViewName)) {
            console.warn('[RBAC] blocked view switch:', subViewName);
            if (subViewName !== 'operations-view' && canOpenAppView('operations-view')) {
                subViewName = 'operations-view';
            } else if (canOpenAppView('arri-view')) {
                subViewName = 'arri-view';
            } else {
                return;
            }
        }

    // Update browser history — keep querystring when already on this view
    const currentHash = String(window.location.hash || '').replace(/^#/, '');
    const currentView = currentHash.split('?')[0];
    const targetHash = currentView === subViewName && currentHash.includes('?')
        ? '#' + currentHash
        : '#' + subViewName;
    if (window.location.hash !== targetHash && currentView !== subViewName) {
        window.history.pushState({ subView: subViewName }, '', '#' + subViewName);
    }

    // Show/Hide Sidebar based on configuration
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        if (APP_VIEWS[subViewName].sidebar) {
            sidebar.classList.remove('hidden');
            sidebar.style.display = 'block';

            // Revert to correct sidebar mode
            const tree = document.getElementById('sidebar-tree');
            const systemMenu = document.getElementById('system-menu');
            if (tree && systemMenu) {
                if (['admin-view', 'settings-view', 'releases-view', 'recovery-center-view', 'employee-view'].includes(subViewName)) {
                    tree.classList.add('hidden');
                    systemMenu.classList.remove('hidden');
                } else {
                    tree.classList.remove('hidden');
                    systemMenu.classList.add('hidden');
                }
            }
        } else {
            sidebar.classList.add('hidden');
            sidebar.style.display = 'none';
        }
    }

    ALL_VIEW_IDS.forEach(sv => {
        const subEl = document.getElementById(sv);
        if (subEl) {
            if (sv === subViewName) {
                subEl.classList.remove('hidden');
                subEl.classList.add('active');
                subEl.style.display = 'flex';
                subEl.style.flexDirection = 'column';
                subEl.style.flex = '1';
            } else {
                subEl.classList.add('hidden');
                subEl.classList.remove('active');
                subEl.style.display = 'none';
            }
        }
    });

    // Update active nav link using configuration map
    syncTopNavActive(subViewName);

    if (window.syncSidebarBubbles) window.syncSidebarBubbles();
    if (typeof refreshRecoveryCenterBadge === 'function') {
        refreshRecoveryCenterBadge().catch(() => {});
    } else if (window.refreshRecoveryCenterBadge) {
        window.refreshRecoveryCenterBadge().catch(() => {});
    }

    // pushState does not fire hashchange — keep global search scoped to the active module
    if (typeof window.syncGlobalSearchPlaceholder === 'function') {
        window.syncGlobalSearchPlaceholder();
    }
    const searchInputEl = document.getElementById('globalSidebarSearch')
        || document.querySelector('.sidebar-search input');
    if (searchInputEl && typeof searchInputEl.oninput === 'function') {
        searchInputEl.dispatchEvent(new Event('input'));
    }
}

// --- GLOBAL QoL: ESC KEY TO CLOSE MODALS ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLogisticsMenu();
        console.log('[QoL] Esc key pressed, checking for open modals...');
        // Find all visible modals
        const modals = Array.from(document.querySelectorAll('.modal, .login-modal-overlay'));
        const visibleModals = modals.filter(m => {
            const style = window.getComputedStyle(m);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });

        if (visibleModals.length > 0) {
            // Sort by z-index to close the top-most one if multiple are open
            visibleModals.sort((a, b) => {
                const zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
                const zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
                return zB - zA;
            });

            const topModal = visibleModals[0];
            console.log('[QoL] Closing top-most modal:', topModal.id || 'unnamed-modal');
            
            // 1. Check if there's a cancel/close button inside and click it (to trigger any cleanup logic)
            const closeBtn = topModal.querySelector('.close-modal, .close, .cancel-button, .action-button.grey, .action-button.light-grey');
            if (closeBtn) {
                closeBtn.click();
            } else {
                // 2. Fallback: just hide it
                topModal.style.display = 'none';
            }
        }
    }
});

// Initialize Context Menu
try { initContextMenu(); } catch (err) { console.error('initContextMenu failed:', err); }

    // Initialize Service Portal
try { initServicePortal(); } catch (err) { console.error('initServicePortal failed:', err); }

console.log('MAIN.JS: Feature inits finished.');
window.switchDashboardSubView = switchDashboardSubView;

// Handle Browser Back/Forward Navigation
window.addEventListener('popstate', (event) => {
    console.log('Popstate event triggered:', event.state);
    if (event.state && event.state.subView) {
        const subViewName = event.state.subView;
        
        // Validate view name
        if (!APP_VIEWS[subViewName]) return;
        if (!canOpenAppView(subViewName)) {
            const fallback = canOpenAppView('operations-view')
                ? 'operations-view'
                : (canOpenAppView('arri-view') ? 'arri-view' : null);
            if (fallback) switchDashboardSubView(fallback);
            return;
        }

        // Show/Hide Sidebar based on configuration
        const sidebar = document.getElementById('app-sidebar');
        if (sidebar) {
            if (APP_VIEWS[subViewName].sidebar) {
                sidebar.classList.remove('hidden');
                sidebar.style.display = 'block';

                // Revert to correct sidebar mode
                const tree = document.getElementById('sidebar-tree');
                const systemMenu = document.getElementById('system-menu');
                if (tree && systemMenu) {
                    if (['admin-view', 'settings-view', 'releases-view', 'recovery-center-view', 'employee-view'].includes(subViewName)) {
                        tree.classList.add('hidden');
                        systemMenu.classList.remove('hidden');
                    } else {
                        tree.classList.remove('hidden');
                        systemMenu.classList.add('hidden');
                    }
                }
            } else {
                sidebar.classList.add('hidden');
                sidebar.style.display = 'none';
            }
        }

        ALL_VIEW_IDS.forEach(sv => {
            const subEl = document.getElementById(sv);
            if (subEl) {
                if (sv === subViewName) {
                    subEl.classList.remove('hidden');
                    subEl.classList.add('active');
                    subEl.style.display = 'flex';
                    subEl.style.flexDirection = 'column';
                    subEl.style.flex = '1';
                } else {
                    subEl.classList.add('hidden');
                    subEl.classList.remove('active');
                    subEl.style.display = 'none';
                }
            }
        });
        
        // Update active nav link using configuration map
        syncTopNavActive(subViewName);

        if (window.syncSidebarBubbles) window.syncSidebarBubbles();
        if (typeof refreshRecoveryCenterBadge === 'function') {
            refreshRecoveryCenterBadge().catch(() => {});
        }

    } else {
        // Fallback if no state (e.g. initial load or empty hash)
        // Check hash
        const hash = window.location.hash.substring(1);
        if (hash && APP_VIEWS[hash]) {
             // Let handleInitialUrl take care or switch manually if needed
        }
    }
});

function setupNavigation() {
    console.log('setupNavigation() called - Diagnostic Check');
    setupLogisticsMenu();
    const navLinks = {
        'nav-operations': {
            view: 'dashboardView',
            subView: 'operations-view',
            init: () => typeof initOperationsView === 'function' && initOperationsView()
        },
        'nav-dashboard': { 
            view: 'dashboardView', 
            subView: 'home-view', 
            init: () => {
                console.log('nav-dashboard init');
                window.currentDashboardParent = null;
                const assetList = Array.isArray(window.assets)
                    ? window.assets
                    : (Array.isArray(window.allAssets) ? window.allAssets : []);
                window.assets = assetList;
                window.filteredAssets = [...assetList];
                
                if (typeof renderDashboard === 'function') {
                    renderDashboard(assetList, () => assetList);
                }
                
                switchDashboardSubView('home-view');
                const pending = window.__lifecyclePending;
                const hashId = new URLSearchParams(String(window.location.hash || '').split('?')[1] || '').get('id');
                const openId = (pending && pending.view === 'home-view' && pending.open) || hashId;
                if (pending && pending.view === 'home-view') window.__lifecyclePending = null;
                if (openId && typeof editAsset === 'function') {
                    setTimeout(() => editAsset(openId), 200);
                }
            } 
        },
        'nav-arri': {
            view: 'dashboardView',
            subView: 'arri-view',
            init: () => {
                console.log('nav-arri init');
                if (typeof initServicePortal === 'function') initServicePortal();
            }
        },
/* 
        'nav-sheet': { 
            view: 'dashboardView', 
            subView: 'sheet-view', 
            init: () => {
                if (typeof setupDashboard === 'function') setupDashboard();
                if (window.initSheetView) window.initSheetView();
            }
        },
*/
        'nav-employees': { 
            view: 'dashboardView', 
            subView: 'employee-view', 
            init: () => typeof initEmployeeView === 'function' && initEmployeeView() 
        },
        'nav-inventory': {
            view: 'dashboardView',
            subView: 'inventory-view',
            init: () => typeof initInventoryView === 'function' && initInventoryView()
        },
        'nav-sets': {
            view: 'dashboardView',
            subView: 'sets-view',
            init: () => typeof initKitSetsView === 'function' && initKitSetsView()
        },
        'nav-receipts': {
            view: 'dashboardView',
            subView: 'receipts-view',
            init: () => typeof initReceiptsView === 'function' && initReceiptsView()
        },
        'nav-purchase-orders': {
            view: 'dashboardView',
            subView: 'purchase-orders-view',
            init: () => typeof initPurchaseOrdersView === 'function' && initPurchaseOrdersView()
        },
        'nav-purchase-books': {
            view: 'dashboardView',
            subView: 'purchase-books-view',
            init: () => typeof initPurchaseBooksView === 'function' && initPurchaseBooksView()
        },
        'nav-products': {
            view: 'dashboardView',
            subView: 'products-view',
            init: () => typeof initProductsView === 'function' && initProductsView()
        },
        'nav-reservations': {
            view: 'dashboardView',
            subView: 'reservations-view',
            init: () => typeof initReservationsView === 'function' && initReservationsView()
        },
        'nav-history': {
            view: 'dashboardView',
            subView: 'history-view',
            init: () => typeof initHistoryView === 'function' && initHistoryView()
        },
        'nav-tally': {
            view: 'dashboardView',
            subView: 'tally-view',
            init: () => typeof initTallyView === 'function' && initTallyView()
        },
        'nav-physical-intakes': {
            view: 'dashboardView',
            subView: 'physical-intakes-view',
            init: () => typeof initPhysicalIntakesView === 'function' && initPhysicalIntakesView()
        },
        'nav-dc': { 
            view: 'dashboardView', 
            subView: 'dc-view',
            init: () => {
                if (window.initDCView) window.initDCView();
            }
        },
        'nav-projects': { 
            view: 'dashboardView', 
            subView: 'projects-view', 
            init: () => {
                console.log('nav-projects init');
                if (typeof initProjectsView === 'function') initProjectsView();
                if (typeof renderSidebarTree === 'function') {
                    renderSidebarTree();
                }
            } 
        },
        'nav-releases': { 
            view: 'dashboardView', 
            subView: 'releases-view',
            init: () => typeof renderReleases === 'function' && renderReleases()
        },
/* 
        'nav-scanner': { 
            view: 'dashboardView', 
            subView: 'scanner-view', 
            init: () => typeof initScannerView === 'function' && initScannerView() 
        },
        'nav-ocr': { 
            view: 'dashboardView', 
            subView: 'ocr-view', 
            init: () => typeof setupOcr === 'function' && setupOcr() 
        },
*/
        'nav-warranty': { 
            view: 'dashboardView', 
            subView: 'warranty-view', 
            init: () => {
                console.log('nav-warranty init called');
                // Ensure assets are loaded before initializing warranty view
                if (!window.allAssets || window.allAssets.length === 0) {
                    console.log('nav-warranty: No assets found, reloading...');
                    loadAssets().then(() => {
                        if (typeof initWarrantyView === 'function') initWarrantyView();
                    });
                } else {
                    if (typeof initWarrantyView === 'function') {
                        initWarrantyView();
                    } else if (window.initWarrantyView) {
                        window.initWarrantyView();
                    }
                }
            } 
        },
        'nav-admin': {
            view: 'dashboardView',
            subView: 'admin-view',
            init: () => {
                // Initialize Admin Sub-Tabs
                const tabButtons = document.querySelectorAll('.admin-tab-btn');
                const tabContents = document.querySelectorAll('.admin-tab-content');

                tabButtons.forEach(btn => {
                    if (btn.dataset.bound) return;
                    btn.addEventListener('click', () => {
                        const targetId = btn.dataset.target;

                        // Update Buttons
                        tabButtons.forEach(b => {
                            b.classList.remove('active');
                            b.style.background = '#f1f5f9';
                            b.style.color = '#475569';
                        });
                        btn.classList.add('active');
                        btn.style.background = '#3b82f6';
                        btn.style.color = 'white';

                        // Update Contents
                        tabContents.forEach(content => {
                            if (content.id === targetId) {
                                content.classList.remove('hidden');
                                // Special init for RBAC
                                if (targetId === 'admin-rbac-tab') {
                                    import('./rbac.js?v=7.42').then(module => {
                                        module.renderRBAC();
                                    });
                                }
                            } else {
                                content.classList.add('hidden');
                            }
                        });
                    });
                    btn.dataset.bound = 'true';
                });

                const container = document.getElementById('admin-users-container');
                if (!container) return;

                const form = document.getElementById('admin-create-user-form');
                if (form && !form.dataset.bound) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const usernameEl = document.getElementById('adminNewUsername');
                        const fullnameEl = document.getElementById('adminNewFullname');
                        const passwordEl = document.getElementById('adminNewPassword');
                        const roleEl = document.getElementById('adminNewRole');
                        const employeeEl = document.getElementById('adminNewEmployeeId');

                        const username = usernameEl ? usernameEl.value.trim() : '';
                        const fullname = fullnameEl ? fullnameEl.value.trim() : '';
                        const password = passwordEl ? passwordEl.value : '';
                        const role = roleEl ? roleEl.value : 'user';
                        const employeeId = employeeEl ? employeeEl.value.trim() : '';

                        if (!username || !password) {
                            alert('Username and password are required');
                            return;
                        }

                        try {
                            const res = await fetch('/api/tenant/users', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username, fullname, password, role, employeeId })
                            });
                            const body = await res.json().catch(() => ({}));
                            if (!res.ok || !body.ok) {
                                const msg = (body && (body.message || body.error)) || 'Failed to create user';
                                alert(msg);
                                return;
                            }
                            if (usernameEl) usernameEl.value = '';
                            if (fullnameEl) fullnameEl.value = '';
                            if (passwordEl) passwordEl.value = '';
                            if (employeeEl) employeeEl.value = '';
                            loadUsers();
                        } catch (err) {
                            console.error('Error creating tenant user:', err);
                            alert('Error connecting to server while creating user');
                        }
                    });
                    form.dataset.bound = 'true';
                }

                if (!container.dataset.bound) {
                    container.addEventListener('change', async (e) => {
                        const select = e.target.closest('.admin-role-select');
                        if (!select) return;
                        const username = select.dataset.username;
                        const role = select.value;
                        if (!username || !role) return;
                        try {
                            const res = await fetch('/api/tenant/users/' + encodeURIComponent(username) + '/role', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ role })
                            });
                            const body = await res.json().catch(() => ({}));
                            if (!res.ok || !body.ok) {
                                const msg = (body && (body.message || body.error)) || 'Failed to update role';
                                alert(msg);
                                loadUsers();
                            }
                        } catch (err) {
                            console.error('Error updating tenant user role:', err);
                            alert('Error connecting to server while updating role');
                            loadUsers();
                        }
                    });

                    container.addEventListener('click', async (e) => {
                        const btn = e.target.closest('.admin-delete-user-btn');
                        if (!btn) return;
                        const username = btn.dataset.username;
                        if (!username) return;
                        if (!window.confirm('Delete user "' + username + '"?')) {
                            return;
                        }
                        try {
                            const res = await fetch('/api/tenant/users/' + encodeURIComponent(username), {
                                method: 'DELETE'
                            });
                            const body = await res.json().catch(() => ({}));
                            if (!res.ok || !body.ok) {
                                const msg = (body && (body.message || body.error)) || 'Failed to delete user';
                                alert(msg);
                            }
                            loadUsers();
                        } catch (err) {
                            console.error('Error deleting tenant user:', err);
                            alert('Error connecting to server while deleting user');
                            loadUsers();
                        }
                    });

                    container.dataset.bound = 'true';
                }

                function loadUsers() {
                    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Loading users...</div>';
                    fetch('/api/tenant/users')
                        .then(res => res.json().then(body => ({ ok: res.ok, body })))
                        .then(({ ok, body }) => {
                            if (!ok || !body || !body.ok) {
                                const msg = (body && (body.message || body.error)) || 'Failed to load users';
                                container.innerHTML = '<p style="padding: 20px; color: #c00;">' + msg + '</p>';
                                return;
                            }
                            const users = body.users || [];
                            const teamOptions = [
                                { value: 'logistics', label: 'Logistics' },
                                { value: 'procurement', label: 'Procurement' },
                                { value: 'sales', label: 'Sales' },
                                { value: 'HR', label: 'HR' },
                                { value: 'it', label: 'IT' }
                            ];
                            const privilegedOptions = [
                                { value: 'director', label: 'Director' },
                                { value: 'admin', label: 'Admin' },
                                { value: 'it_manager', label: 'IT Admin' },
                                { value: 'superuser', label: 'Super User' }
                            ];
                            function teamSelectHtml(selected) {
                                let html = '<optgroup label="Teams">';
                                teamOptions.forEach((opt) => {
                                    html += `<option value="${opt.value}"${selected === opt.value ? ' selected' : ''}>${opt.label}</option>`;
                                });
                                html += '</optgroup><optgroup label="Privileged">';
                                privilegedOptions.forEach((opt) => {
                                    html += `<option value="${opt.value}"${selected === opt.value ? ' selected' : ''}>${opt.label}</option>`;
                                });
                                html += '</optgroup>';
                                if (selected && !teamOptions.some((o) => o.value === selected) && !privilegedOptions.some((o) => o.value === selected)) {
                                    html += `<option value="${selected}" selected>${selected}</option>`;
                                }
                                return html;
                            }
                            const newUserRoleSelect = document.getElementById('adminNewRole');
                            if (newUserRoleSelect) {
                                newUserRoleSelect.innerHTML = teamSelectHtml(newUserRoleSelect.value || 'sales');
                            }
                            
                            if (!users.length) {
                                container.innerHTML = '<p style="padding: 20px; color: #999;">No users found for this company.</p>';
                                return;
                            }
                            let html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>';
                            html += '<th>Username</th><th>Full Name</th><th>Role</th><th>Actions</th>';
                            html += '</tr></thead><tbody>';
                            users.forEach(u => {
                                const username = u.username || '';
                                const fullname = u.fullname || '';
                                const role = u.role || 'user';
                                html += '<tr>';
                                html += '<td>' + username + '</td>';
                                html += '<td>' + fullname + '</td>';
                                html += '<td>';
                                html += '<select class="admin-role-select raul-role-select" data-username="' + username + '">';
                                html += teamSelectHtml(role);
                                html += '</select>';
                                html += '</td>';
                                html += '<td><button type="button" class="admin-delete-user-btn" data-username="' + username + '">Delete</button></td>';
                                html += '</tr>';
                            });
                            html += '</tbody></table></div>';
                            container.innerHTML = html;
                        })
                        .catch(err => {
                            console.error('Error loading tenant users:', err);
                            container.innerHTML = '<p style="padding: 20px; color: #c00;">Error connecting to server.</p>';
                        });
                }

                loadUsers();
            }
        },
        'nav-settings': {
            view: 'dashboardView',
            subView: 'settings-view',
            init: () => {
                console.log('nav-settings init called');
                if (typeof initSettingsView === 'function') {
                    initSettingsView();
                }
            }
        },
        'nav-recovery-center': {
            view: 'dashboardView',
            subView: 'recovery-center-view',
            init: () => {
                if (typeof initRecoveryCenterView === 'function') {
                    initRecoveryCenterView();
                } else if (window.initRecoveryCenterView) {
                    window.initRecoveryCenterView();
                }
            }
        }
    };

    // --- Mobile Sidebar & Animated Toggle Logic ---
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        // Clone to remove old listeners
        const newToggle = sidebarToggle.cloneNode(true);
        sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
        
        let startY = 0;
        let currentStage = 0;
        let isDragging = false;
        let dragStartTime = 0;

        const setStage = (stage) => {
            newToggle.classList.remove('stage-0', 'stage-1', 'stage-2', 'stage-3', 'stage-4');
            newToggle.classList.add(`stage-${stage}`);
            currentStage = stage;
        };
        
        const isSidebarOpen = () => {
            const s = document.getElementById('app-sidebar');
            if (!s) return false;
            if (s.classList.contains('hidden')) return false;
            if (window.innerWidth <= 768) {
                return s.classList.contains('mobile-open');
            }
            return !s.classList.contains('collapsed');
        };

        const syncSidebarToggleAria = () => {
            newToggle.setAttribute('aria-expanded', isSidebarOpen() ? 'true' : 'false');
        };

        const updateCompactLayout = () => {
            const appHeader = document.getElementById('app-header');
            const container = document.getElementById('app-container');
            if (!appHeader || !container) return;
            const headerCompact = appHeader.classList.contains('top-bar-collapsed');
            container.classList.toggle('layout-tight-top', headerCompact && isSidebarOpen());
        };

        const sidebar = document.getElementById('app-sidebar');
        if (isSidebarOpen()) {
             setStage(4);
        }
        syncSidebarToggleAria();

        const toggleTopBar = () => {
            const appHeader = document.getElementById('app-header');
            const titleEl = document.querySelector('.app-title');
            if (!appHeader) return;

            const willCollapse = !appHeader.classList.contains('top-bar-collapsed');
            appHeader.classList.toggle('top-bar-collapsed');

            const navCenter = appHeader.querySelector('.nav-center');
            const headerRight = appHeader.querySelector('.header-right');
            const pill = appHeader.querySelector('.top-bar-pill');
            const headerLeft = appHeader.querySelector('.header-left');
            const burger = appHeader.querySelector('.burger-container');

            if (titleEl) {
                titleEl.style.display = willCollapse ? 'none' : '';
            }

            if (willCollapse) {
                appHeader.style.display = 'inline-flex';
                appHeader.style.width = 'auto';
                appHeader.style.maxWidth = 'none';
                appHeader.style.padding = '6px 12px';
                appHeader.style.margin = '16px 0 10px 16px';
                appHeader.style.borderRadius = '999px';
                appHeader.style.background = '#000';
                appHeader.style.alignSelf = 'flex-start';
                appHeader.style.justifyContent = 'center';

                if (navCenter) navCenter.style.display = 'none';
                if (headerRight) headerRight.style.display = 'none';

                if (headerLeft) headerLeft.style.margin = '0';
                if (burger) burger.style.marginLeft = '0';

                if (pill) {
                    pill.style.background = 'transparent';
                    pill.style.boxShadow = 'none';
                    pill.style.padding = '0';
                    pill.style.margin = '0';
                }
            } else {
                appHeader.style.display = '';
                appHeader.style.width = '';
                appHeader.style.maxWidth = '';
                appHeader.style.padding = '';
                appHeader.style.margin = '';
                appHeader.style.borderRadius = '';
                appHeader.style.background = '';
                appHeader.style.alignSelf = '';
                appHeader.style.justifyContent = '';

                if (navCenter) navCenter.style.display = '';
                if (headerRight) headerRight.style.display = '';

                if (headerLeft) headerLeft.style.margin = '';
                if (burger) burger.style.marginLeft = '';

                if (pill) {
                    pill.style.background = '';
                    pill.style.boxShadow = '';
                    pill.style.padding = '';
                    pill.style.margin = '';
                }
            }

            updateCompactLayout();
        };

        const toggleSidebar = () => {
            const sidebar = document.getElementById('app-sidebar');
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                sidebar.classList.toggle('mobile-open');
                let backdrop = document.querySelector('.mobile-backdrop');
                if (!backdrop) {
                    backdrop = document.createElement('div');
                    backdrop.className = 'mobile-backdrop';
                    document.body.appendChild(backdrop);
                    backdrop.addEventListener('click', () => {
                        sidebar.classList.remove('mobile-open');
                        backdrop.classList.remove('active');
                        setStage(0);
                        updateCompactLayout();
                        syncSidebarToggleAria();
                    });
                }
                if (isSidebarOpen()) {
                    backdrop.classList.add('active');
                    setStage(4);
                } else {
                    backdrop.classList.remove('active');
                    setStage(0);
                }
            } else {
                sidebar.classList.toggle('collapsed');
                if (isSidebarOpen()) {
                    setStage(4);
                } else {
                    setStage(0);
                }
            }

            updateCompactLayout();
            syncSidebarToggleAria();
        };

        window.toggleSystemMenu = () => {
            const sidebar = document.getElementById('app-sidebar');
            const tree = document.getElementById('sidebar-tree');
            const systemMenu = document.getElementById('system-menu');
            
            if (!sidebar || !tree || !systemMenu) return;

            // Handle the case where sidebar is physically hidden (e.g. on DC/Warranty tab)
            if (sidebar.classList.contains('hidden')) {
                sidebar.classList.remove('hidden');
                sidebar.style.display = 'block';
                sidebar.classList.remove('collapsed'); // Ensure it starts expanded
                tree.classList.add('hidden');
                systemMenu.classList.remove('hidden');
                setStage(4);
                if (window.syncSidebarBubbles) window.syncSidebarBubbles();
                updateCompactLayout();
                syncSidebarToggleAria();
                return;
            }

            const isCollapsed = sidebar.classList.contains('collapsed');
            const isSystemMenuVisible = !systemMenu.classList.contains('hidden');

            if (isCollapsed) {
                // Open sidebar and show system menu
                sidebar.classList.remove('collapsed');
                tree.classList.add('hidden');
                systemMenu.classList.remove('hidden');
                setStage(4);
            } else {
                if (isSystemMenuVisible) {
                    // Already in system menu? Close sidebar or revert?
                    // User said: "clicking on it should hide the hierarchy pane... and open a list of pages"
                    // If we click again, we probably want to close it or revert to tree if on a tree view.
                    const currentView = (window.location.hash.replace('#', '') || 'operations-view').split('?')[0];
                    const viewConfig = window.APP_VIEWS[currentView];
                    
                    if (viewConfig && viewConfig.sidebar) {
                        // Revert to tree
                        tree.classList.remove('hidden');
                        systemMenu.classList.add('hidden');
                    } else {
                        // Close sidebar
                        sidebar.classList.add('collapsed');
                        setStage(0);
                    }
                } else {
                    // In tree mode, switch to system menu
                    tree.classList.add('hidden');
                    systemMenu.classList.remove('hidden');
                }
            }
            
            if (window.syncSidebarBubbles) window.syncSidebarBubbles();
            if (typeof refreshRecoveryCenterBadge === 'function') {
                refreshRecoveryCenterBadge().catch(() => {});
            }
            updateCompactLayout();
            syncSidebarToggleAria();
        };

        const onStart = (y) => {
            startY = y;
            isDragging = false;
            dragStartTime = Date.now();
        };

        const onMove = (y) => {
            if (!startY) return;
            const deltaY = y - startY;
            
            // Fix: Any significant movement counts as dragging, preventing the click
            if (Math.abs(deltaY) > 2) isDragging = true;
            
            // Only engage drag animation if pulling DOWN
            if (deltaY > 0) {
                // 2px per stage
                let stage = Math.floor(deltaY / 2); // 2px per stage as requested
                if (stage > 4) stage = 4;
                
                if (stage !== currentStage) {
                    setStage(stage);
                }
            }
        };

        const onEnd = (e) => {
            if (!startY) return;
            const timeElapsed = Date.now() - dragStartTime;
            
            if (!isDragging && timeElapsed < 300) {
                console.log('Toggle Click - System Menu');
                // Toggle the System Menu in the Sidebar
                if (typeof toggleSystemMenu === 'function') {
                    toggleSystemMenu();
                } else {
                    // Fallback to old behavior if not defined
                    toggleTopBar();
                }
                
                if (isSidebarOpen()) {
                    setStage(4);
                } else {
                    setStage(0);
                }
            } else {
                if (currentStage >= 4) {
                    console.log('Pull Down Complete - Toggle Sidebar');
                    toggleSidebar();
                } else {
                    if (isSidebarOpen()) {
                        setStage(4);
                    } else {
                        setStage(0);
                    }
                }
            }
            startY = 0;
            isDragging = false;
            syncSidebarToggleAria();
        };

        // Prevent default click behavior to avoid conflicts
        newToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Mouse Events
        newToggle.addEventListener('mousedown', (e) => onStart(e.clientY));
        // Attach move/up to window to handle drag out
        window.addEventListener('mousemove', (e) => { if (startY) onMove(e.clientY); });
        window.addEventListener('mouseup', (e) => { if (startY) onEnd(e); });

        // Touch Events
        newToggle.addEventListener('touchstart', (e) => {
            onStart(e.touches[0].clientY);
            // e.preventDefault(); // Prevent scroll? Maybe not, as we want to allow scroll if not pulling?
        }, { passive: true });
        
        newToggle.addEventListener('touchmove', (e) => {
            if (startY) onMove(e.touches[0].clientY);
        }, { passive: true });
        
        newToggle.addEventListener('touchend', (e) => onEnd(e));
    }

    // --- RBAC TAB VISIBILITY ENFORCEMENT ---
    const userCategory = (currentUser && currentUser.category) ? currentUser.category : 'IT';
    const checkTabPermission = (perm) => hasPermission(perm);

    const navVisibility = {
        'nav-operations': checkTabPermission('dashboard.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-dashboard': checkTabPermission('asset.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-arri': userCategory === 'SERVICE' || userCategory === 'In-House',
        'nav-projects': false,
        'nav-dc': checkTabPermission('dc.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-employees': checkTabPermission('user.manage') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-inventory': checkTabPermission('inventory.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-sets': checkTabPermission('set.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-receipts': checkTabPermission('receipt_note.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-purchase-orders': checkTabPermission('purchase_order.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-purchase-books': (checkTabPermission('purchase_book.view') || checkTabPermission('purchase_order.view')) && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-products': checkTabPermission('product.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-reservations': checkTabPermission('reservation.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-history': checkTabPermission('history.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-tally': checkTabPermission('dashboard.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-physical-intakes': checkTabPermission('physical_intake.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-warranty': checkTabPermission('warranty.view') && (userCategory !== 'SERVICE' && userCategory !== 'In-House'),
        'nav-releases': checkTabPermission('release.view'),
        'nav-admin': checkTabPermission('admin.view'),
        'nav-settings': checkTabPermission('settings.view'),
        'nav-recovery-center': checkTabPermission('recovery.view'),
        'nav-scanner': false
    };

    Object.entries(navVisibility).forEach(([id, isVisible]) => {
        const el = document.getElementById(id);
        if (el) {
            const parentLi = el.closest('li');
            const target = parentLi || el;
            
            if (isVisible) {
                target.style.display = '';
                target.classList.remove('hidden-by-rbac');
                target.classList.remove('hidden');
            } else {
                target.style.display = 'none';
                target.classList.add('hidden-by-rbac');
            }
        }
    });

    const logisticsChildIds = ['nav-operations', 'nav-products', 'nav-history', 'nav-tally', 'nav-reservations', 'nav-purchase-orders', 'nav-purchase-books', 'nav-receipts', 'nav-dc'];
    const logisticsItem = document.getElementById('nav-logistics-item');
    if (logisticsItem) {
        const anyChild = logisticsChildIds.some((id) => {
            const child = document.getElementById(id);
            if (!child) return false;
            const li = child.closest('#nav-logistics-menu li') || child.closest('li');
            return li && li.style.display !== 'none' && !li.classList.contains('hidden-by-rbac') && !li.classList.contains('hidden');
        });
        logisticsItem.style.display = anyChild ? '' : 'none';
        logisticsItem.classList.toggle('hidden-by-rbac', !anyChild);
    }
    // ----------------------------------------

    Object.entries(navLinks).forEach(([id, config]) => {
        const el = document.getElementById(id);
        if (el) {
            // Avoid duplicate listeners
            if (el.dataset.navAttached) {
                console.log(`Listener already attached to ${id}, skipping.`);
                return;
            }
            
            console.log(`Successfully attached listener to ${id}`);
            el.dataset.navAttached = "true";
            
            // Explicitly set pointer cursor
            el.style.cursor = 'pointer';

            el.addEventListener('click', (e) => {
                // Check if this is a system menu link
                const wrapper = el.closest('.menu-item-wrapper');
                if (wrapper) {
                    // Update active state on wrappers for Raul Drunk Bubbles
                    document.querySelectorAll('.menu-item-wrapper').forEach(w => w.classList.remove('active'));
                    wrapper.classList.add('active');
                }

                e.preventDefault();
                console.log(`[CLICK EVENT] Element ${id} clicked!`);
                if (config.subView && !canOpenAppView(config.subView)) {
                    console.warn('[RBAC] blocked nav click:', id, config.subView);
                    return;
                }
                
                try {
                    // 1. Show main view
                    console.log(`Showing main view: ${config.view}`);
                    showView(config.view);

                    // 2. Handle sub-views within dashboard
                    if (config.view === 'dashboardView') {
                        switchDashboardSubView(config.subView);

                        // Respect APP_VIEWS sidebar configuration
                        const sidebar = document.getElementById('app-sidebar');
                        if (sidebar) {
                            const viewConfig = APP_VIEWS[config.subView];
                            if (viewConfig && viewConfig.sidebar) {
                                // Only show it if it wasn't manually collapsed by the user
                                if (!sidebar.classList.contains('collapsed')) {
                                    sidebar.classList.remove('hidden');
                                    sidebar.style.removeProperty('display');
                                    sidebar.style.removeProperty('width');
                                    sidebar.style.removeProperty('opacity');
                                }
                            } else {
                                sidebar.classList.add('hidden');
                                sidebar.style.setProperty('display', 'none', 'important');
                            }
                        }
                    } else {
                        // For non-dashboard views, hide sidebar
                        const sidebar = document.getElementById('app-sidebar');
                        if (sidebar) {
                            sidebar.classList.add('hidden');
                            sidebar.style.setProperty('display', 'none', 'important');
                        }
                    }

                    // 3. Update active state in nav
                    syncTopNavActive(config.subView);
                    closeLogisticsMenu();

                    // 4. Run initialization
                    if (config.init) {
                        console.log(`Running init for ${id}...`);
                        try {
                            config.init();
                        } catch (initErr) {
                            console.error(`Init failed for ${id}:`, initErr);
                        }
                    }
                } catch (err) {
                    console.error(`Error during navigation for ${id}:`, err);
                }
            });
        }
    });
}


