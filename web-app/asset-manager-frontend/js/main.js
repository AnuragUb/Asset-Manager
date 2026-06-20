console.log('MAIN.JS: Entry point (v6.48)');
import { showView } from './utils.js?v=6.48';
import { renderDashboard, setupDashboard, setupDashboardFormHandlers, renderSidebarTree, editAsset } from './dashboard.js?v=6.48';
// import { initScannerView } from './networkScanner.js?v=5.50';
import { renderItAssets } from './itAssets.js?v=6.48';
import { setupAuth, checkSession } from './auth.js?v=6.48';
import { HierarchyManager } from './hierarchy.js?v=6.48';
import { initEmployeeView, loadEmployees } from './employees.js?v=6.48';
// import { setupOcr } from './ocr.js?v=5.50';
import { initWarrantyView } from './warranty.js?v=6.48';
import { initProjectsView } from './projects.js?v=6.48';
import { initSettingsView } from './settings.js?v=6.48';
import { initCompanyTemplates } from './companyTemplates.js?v=6.48';
import { initDCProjectFetcher, initDCAliasLogic } from './dcProjectFetcher.js?v=6.48';
import { initLoginAnimations, initLoginModuleSelector, initSignupModal } from './loginAnimations.js?v=6.48';
import { initFormAutosave } from './formAutosave.js?v=6.48';
import { initContextMenu } from './contextMenu.js?v=6.48';

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
initCompanyTemplates();

// Initialize DC Project Fetcher
initDCProjectFetcher();
initDCAliasLogic();

// Initialize Form Autosave
initFormAutosave();

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

        // Populate parent dropdown in modal
        const parentSelect = document.getElementById('newKindParent');
        if (parentSelect) {
            const currentCategory = localStorage.getItem('selectedAssetCategory');
            const filteredKinds = assetKinds.filter(k => k.Module === currentCategory);
            const filteredFolders = folders.filter(f => f.Module === currentCategory);
            
            // Keep the "None" option
            parentSelect.innerHTML = '<option value="">None (Top Level)</option>';
            
            // Add Folders first as potential parents
            if (filteredFolders.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Folders';
                filteredFolders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.Name;
                    const icon = (f.Icon && (f.Icon.startsWith('/') || f.Icon.startsWith('http'))) ? '📁' : (f.Icon || '📁');
                    opt.textContent = `${icon} ${f.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }

            // Add Kinds
            if (filteredKinds.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Existing Categories';
                filteredKinds.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k.Name;
                    const icon = (k.Icon && (k.Icon.startsWith('/') || k.Icon.startsWith('http'))) ? '📦' : (k.Icon || '📦');
                    opt.textContent = `${icon} ${k.Name}`;
                    group.appendChild(opt);
                });
                parentSelect.appendChild(group);
            }
        }
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
    console.log('saveAsset() payload:', JSON.stringify(asset, null, 2));
    const username = currentUser ? currentUser.username : (localStorage.getItem('username') || 'web');
    
    // Determine if this is an update or a new asset
    // Assets from the database will have an ID
    const isUpdate = asset.ID || asset.Id;
    const method = isUpdate ? 'PUT' : 'POST';
    const url = isUpdate ? `/api/assets/${asset.ID || asset.Id}` : '/api/assets';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'x-user': username
            },
            body: JSON.stringify(asset)
        });
        
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
            const errText = await response.text();
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
    
    // Ensure login view is shown first
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
            // --- SMART DEFAULT VIEW (RBAC AWARE) ---
            const userPermissions = (user && user.permissions) ? user.permissions : [];
            const isSuper = (user && user.role === 'superuser');
            const canViewDashboard = isSuper || userPermissions.includes('view.dashboard');

            if (canViewDashboard) {
                console.log('Found dashboardView and permission ok, switching...');
                showView('dashboardView');
                
                // Set nav-dashboard as active
                document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                document.getElementById('nav-dashboard')?.classList.add('active');

                // Show home-view subview by default
                const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view', 'scanner-view', 'projects-view', 'ocr-view', 'warranty-view', 'settings-view'];
                subViews.forEach(sv => {
                    const el = document.getElementById(sv);
                    if (el) {
                        if (sv === 'home-view') {
                            el.classList.remove('hidden');
                            el.style.display = 'flex';
                            el.style.flexDirection = 'column'; // Stack header and content vertically
                        } else {
                            el.classList.add('hidden');
                            el.style.display = 'none';
                            // Still set flexDirection so it's ready when the view is shown
                            if (sv === 'dc-view' || sv === 'warranty-view') {
                                el.style.flexDirection = 'column';
                            }
                        }
                    }
                });

                // Render sidebar tree AFTER showView to ensure container is visible and ready
                console.log('Rendering sidebar tree. Kinds:', (window.allAssetKinds || []).length);
                await renderSidebarTree();
                
                setupDashboard();
                setupDashboardFormHandlers();
                renderDashboard(assets, filteredAssets);
            } else {
                // Dashboard restricted - Find first available tab based on RBAC
                console.log('Dashboard restricted. Finding alternative landing tab...');
                const availableTabs = [
                    { id: 'nav-projects', view: 'dashboardView', sub: 'projects-view' },
                    { id: 'nav-dc', view: 'dashboardView', sub: 'dc-view' },
                    { id: 'nav-warranty', view: 'dashboardView', sub: 'warranty-view' },
                    { id: 'nav-releases', view: 'dashboardView', sub: 'releases-view' }
                ];

                const target = availableTabs.find(t => {
                    const perm = t.id.replace('nav-', 'view.');
                    return userPermissions.includes(perm);
                });

                if (target) {
                    console.log(`Redirecting to: ${target.id}`);
                    const el = document.getElementById(target.id);
                    if (el) el.click(); // Trigger the standard click handler
                } else {
                    console.warn('No accessible tabs found for this user.');
                    showView('dashboardView'); // Fallback
                }
            }
            // ----------------------------------------

            // Check for edit parameter in URL
            const urlParams = new URLSearchParams(window.location.search);
            const editId = urlParams.get('edit');
            if (editId) {
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
            
            // Ensure default view has a hash if none exists
            if (!window.location.hash) {
                window.history.replaceState({ subView: 'home-view' }, '', '#home-view');
            }
        } else {
            console.error('Could NOT find dashboardView element!');
            alert('Error: Dashboard view not found in the page.');
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
            if (!user.category) {
                let savedCategory = localStorage.getItem('selectedAssetCategory');
                // Validate category - prevent UUIDs or invalid strings
                if (savedCategory && (savedCategory.length > 20 || savedCategory.includes('-'))) {
                    console.warn('Invalid category in localStorage:', savedCategory);
                    localStorage.removeItem('selectedAssetCategory');
                    savedCategory = null;
                }
                user.category = savedCategory || 'IT';
            }
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
    'home-view': { id: 'home-view', navId: 'nav-dashboard', sidebar: true, default: true },
    'sheet-view': { id: 'sheet-view', navId: 'nav-sheet', sidebar: true },
    'employee-view': { id: 'employee-view', navId: 'nav-employees', sidebar: false },
    'dc-view': { id: 'dc-view', navId: 'nav-dc', sidebar: true },
    'releases-view': { id: 'releases-view', navId: 'nav-releases', sidebar: false },
    'scanner-view': { id: 'scanner-view', navId: 'nav-scanner', sidebar: false },
    'projects-view': { id: 'projects-view', navId: 'nav-projects', sidebar: true },
    'ocr-view': { id: 'ocr-view', navId: 'nav-ocr', sidebar: false },
    'warranty-view': { id: 'warranty-view', navId: 'nav-warranty', sidebar: true },
    'settings-view': { id: 'settings-view', navId: 'nav-settings', sidebar: true },
    'admin-view': { id: 'admin-view', navId: 'nav-admin', sidebar: false }
};

// Expose for external access if needed
window.APP_VIEWS = APP_VIEWS;

// Helper to get all view IDs
const ALL_VIEW_IDS = Object.values(APP_VIEWS).map(v => v.id);
const SIDEBAR_VIEW_IDS = Object.values(APP_VIEWS).filter(v => v.sidebar).map(v => v.id);

function switchDashboardSubView(subViewName) {
    console.log(`Switching dashboard subview to: ${subViewName}`);
    
    // Validate view name
    if (!APP_VIEWS[subViewName]) {
        console.warn(`Unknown view: ${subViewName}, defaulting to home-view`);
        subViewName = 'home-view';
    }

    // Update browser history
    // Only push state if it's different from current hash
    const targetHash = '#' + subViewName;
    if (window.location.hash !== targetHash) {
        window.history.pushState({ subView: subViewName }, '', targetHash);
    }

    // Show/Hide Sidebar based on configuration
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        if (APP_VIEWS[subViewName].sidebar) {
            sidebar.classList.remove('hidden');
            sidebar.style.display = 'block';
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
}

// Initialize Context Menu
initContextMenu();

// Mark modules as loaded for watchdog
window.mainLoaded = true;
console.log('MAIN.JS: All modules initialized and loaded.');
window.switchDashboardSubView = switchDashboardSubView;

// Handle Browser Back/Forward Navigation
window.addEventListener('popstate', (event) => {
    console.log('Popstate event triggered:', event.state);
    if (event.state && event.state.subView) {
        const subViewName = event.state.subView;
        
        // Validate view name
        if (!APP_VIEWS[subViewName]) return;

        // Show/Hide Sidebar based on configuration
        const sidebar = document.getElementById('app-sidebar');
        if (sidebar) {
            if (APP_VIEWS[subViewName].sidebar) {
                sidebar.classList.remove('hidden');
                sidebar.style.display = 'block';
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
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
        const navId = APP_VIEWS[subViewName].navId;
        if (navId) {
            document.getElementById(navId)?.classList.add('active');
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
    const navLinks = {
        'nav-dashboard': { 
            view: 'dashboardView', 
            subView: 'home-view', 
            init: () => {
                console.log('nav-dashboard init');
                // Reset "Ghost" views (Retired, Temporary) when navigating via sidebar
                if (window.currentDashboardParent && (window.currentDashboardParent.ID === 'RETIRED_VIEW' || window.currentDashboardParent.ID === 'TEMP_VIEW')) {
                    console.log(`[Navigation] Resetting ghost view: ${window.currentDashboardParent.ID}`);
                    window.currentDashboardParent = null;
                }
                if (typeof renderDashboard === 'function') {
                    renderDashboard(assets, filteredAssets);
                }
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
                                    import('./rbac.js').then(module => {
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
                            const availableRoles = body.roles || [];
                            
                            // Update the "Create User" role dropdown too
                            const newUserRoleSelect = document.getElementById('adminNewRole');
                            if (newUserRoleSelect && availableRoles.length > 0) {
                                newUserRoleSelect.innerHTML = availableRoles.map(r => {
                                    const rName = r.Name || r.name;
                                    return `<option value="${rName}">${rName}</option>`;
                                }).join('');
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
                                
                                // Build role options dynamically from DB roles
                                if (availableRoles.length > 0) {
                                    availableRoles.forEach(r => {
                                        const rName = r.Name || r.name;
                                        html += `<option value="${rName}" ${role === rName ? 'selected' : ''}>${rName}</option>`;
                                    });
                                } else {
                                    // Fallback to defaults if no roles in DB
                                    const roleMap = {
                                        'user': 'User',
                                        'manager': 'Manager',
                                        'admin': 'Admin',
                                        'it_manager': 'IT Admin',
                                        'superuser': 'Superuser'
                                    };
                                    Object.keys(roleMap).forEach(r => {
                                        html += '<option value="' + r + '"' + (role === r ? ' selected' : '') + '>' + roleMap[r] + '</option>';
                                    });
                                }
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
            if (window.innerWidth <= 768) {
                return s.classList.contains('mobile-open');
            }
            return !s.classList.contains('collapsed');
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
                console.log('Toggle Click - Top Bar');
                toggleTopBar();
                
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
    const userPermissions = (currentUser && currentUser.permissions) ? currentUser.permissions : [];
    const isSuper = (currentUser && currentUser.role === 'superuser');

    const checkTabPermission = (perm) => isSuper || userPermissions.includes(perm);

    const navVisibility = {
        'nav-dashboard': checkTabPermission('view.dashboard'),
        'nav-projects': checkTabPermission('view.projects'),
        'nav-dc': checkTabPermission('view.dc'),
        'nav-employees': checkTabPermission('user.manage'), // Map Employees tab to user.manage permission
        'nav-warranty': checkTabPermission('view.warranty'),
        'nav-releases': checkTabPermission('view.releases'),
        'nav-admin': checkTabPermission('view.admin')
    };

    Object.entries(navVisibility).forEach(([id, isVisible]) => {
        const el = document.getElementById(id);
        if (el) {
            if (isVisible) {
                el.style.display = '';
                el.classList.remove('hidden-by-rbac');
            } else {
                el.style.display = 'none';
                el.classList.add('hidden-by-rbac');
            }
        }
    });
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
                e.preventDefault();
                console.log(`[CLICK EVENT] Element ${id} clicked!`);
                
                try {
                    // 1. Show main view
                    console.log(`Showing main view: ${config.view}`);
                    showView(config.view);

                    // 2. Handle sub-views within dashboard
                    if (config.view === 'dashboardView') {
                        switchDashboardSubView(config.subView);

                        // THEORY TEST: Show sidebar ONLY on Home/Dashboard sub-view
                        const sidebar = document.getElementById('app-sidebar');
                        if (sidebar) {
                            if (config.subView === 'home-view' || config.subView === 'dashboard') {
                                sidebar.classList.remove('hidden');
                                sidebar.classList.remove('collapsed');
                                sidebar.style.setProperty('display', 'flex', 'important');
                                sidebar.style.setProperty('width', '250px', 'important');
                                sidebar.style.setProperty('opacity', '1', 'important');
                            } else {
                                sidebar.classList.add('hidden');
                                sidebar.classList.add('collapsed');
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
                    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                    el.classList.add('active');

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


