console.log('MAIN.JS: Entry point (v4.5)');
import { showView } from './utils.js?v=4.5';
import { renderDashboard, setupDashboard, setupDashboardFormHandlers, renderSidebarTree, editAsset } from './dashboard.js?v=4.5';
import { initScannerView } from './networkScanner.js?v=4.5';
import { renderItAssets } from './itAssets.js?v=4.5';
import { setupAuth } from './auth.js?v=4.5';
import { HierarchyManager } from './hierarchy.js?v=4.5';
import { initEmployeeView, loadEmployees } from './employees.js?v=4.5';
import { setupOcr } from './ocr.js?v=4.5';
import { initWarrantyView } from './warranty.js?v=4.5';
import { initSettingsView } from './settings.js?v=4.5';

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
    
    if (nav) {
        console.log('Manually triggering click on Warranty nav...');
        nav.click();
    }
};

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

// --- System Integrity Check ---
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 403) {
        const data = await response.clone().json().catch(() => ({}));
        if (data.error === 'SYSTEM_RESTRICTED') {
            document.body.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; font-family: sans-serif; text-align: center; padding: 20px;">
                    <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 500px;">
                        <div style="font-size: 60px; margin-bottom: 20px;">🔒</div>
                        <h1 style="color: #1a1a1a; margin-bottom: 15px;">System Restricted</h1>
                        <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
                            The license for this application instance has expired or has been revoked. 
                            Please contact the developer for payment and restoration of services.
                        </p>
                        <div style="font-size: 12px; color: #999; border-top: 1px solid #eee; pt-15px;">
                            Error Code: LIC-REVOKED-2026
                        </div>
                    </div>
                </div>
            `;
            throw new Error("SYSTEM_RESTRICTED");
        }
    }
    return response;
};

async function loadAssetKinds() {
    console.log('loadAssetKinds() called');
    try {
        const [kindsRes, foldersRes] = await Promise.all([
            fetch('/api/asset_kinds'),
            fetch('/api/folders')
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
                    opt.textContent = `${f.Icon || '📁'} ${f.Name}`;
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
                    opt.textContent = `${k.Icon || '📦'} ${k.Name}`;
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
    try {
        await Promise.all([
            loadAssetKinds(),
            loadEmployees()
        ]);
        
        let url = '/api/assets';
        if (currentUser && currentUser.role === 'client' && currentUser.projectId) {
            url += `?projectId=${currentUser.projectId}`;
        }
        
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            console.log('Raw assets from backend:', data.length);
            // Map backend fields to frontend expected fields
            const processedAssets = data.map(a => ({
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
            console.error('Failed to save asset, status:', response.status, errText);
            alert('Error saving asset: ' + errText);
            return false;
        }
    } catch (err) {
        console.error('Failed to save asset:', err);
        alert('Error saving asset: ' + err.message);
        return false;
    }
}
window.loadAssets = loadAssets;
window.saveAsset = saveAsset;
window.editAsset = editAsset;

let currentUser = null;
let filteredAssets = () => {
    const selectedCategory = localStorage.getItem('selectedAssetCategory');
    console.log('Filtering assets for category:', selectedCategory);
    if (!selectedCategory) return assets;
    const filtered = assets.filter(a => a.Category === selectedCategory);
    console.log(`Found ${filtered.length} assets for category ${selectedCategory}`);
    return filtered;
}; 

// Test if we can find the elements we need
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded (main.js) - Initializing navigation');
    const views = document.querySelectorAll('.view');
    console.log(`Found ${views.length} views`);
    
    // Setup navigation early, before auth
    setupNavigation();
    
    setupOcr();
    
    setupAuth(async (user) => {
        console.log('Login success callback triggered in main.js for user:', user.username);
        currentUser = user;
        
        // Update header title based on category
        const appTitle = document.querySelector('.app-title');
        if (appTitle && user.category) {
            appTitle.textContent = `${user.category} Asset Manager`;
        }

        // Update display username
        const userNameDisplay = document.getElementById('display-username');
        if (userNameDisplay && user.username) {
            userNameDisplay.textContent = user.username;
        }
        
        await loadAssets();
        
        // Load employees globally so dropdowns are populated even if Employees tab isn't visited
        if (typeof loadEmployees === 'function') {
            await loadEmployees();
        }
        
        // setupNavigation() is already called, but we can call it again safely if we add checks
        setupNavigation();
        
        const dashboardView = document.getElementById('dashboardView');
        if (dashboardView) {
            console.log('Found dashboardView, switching...');
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

            // Redirect client users to their project view
            if (currentUser && currentUser.role === 'client' && currentUser.projectId) {
                console.log('Client user detected, showing project details:', currentUser.projectId);
                
                // Show dashboard view first (which contains projects-view)
                showView('dashboardView');
                
                // Then show projects view specifically
                const projectsNav = document.getElementById('nav-projects');
                if (projectsNav) projectsNav.click();
            }

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
        } else {
            console.error('Could NOT find dashboardView element!');
            alert('Error: Dashboard view not found in the page.');
        }
    });
});

function setupNavigation() {
    console.log('setupNavigation() called - Diagnostic Check');
    const navLinks = {
        'nav-dashboard': { 
            view: 'dashboardView', 
            subView: 'home-view', 
            init: () => {
                console.log('nav-dashboard init');
                if (typeof renderDashboard === 'function') {
                    renderDashboard(assets, filteredAssets);
                }
            } 
        },
        'nav-sheet': { 
            view: 'dashboardView', 
            subView: 'sheet-view', 
            init: () => {
                if (typeof setupDashboard === 'function') setupDashboard();
                if (window.initSheetView) window.initSheetView();
            }
        },
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
                if (window.initProjectsView) window.initProjectsView();
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

    console.log('Nav items to attach:', Object.keys(navLinks));
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
                        const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view', 'scanner-view', 'projects-view', 'ocr-view', 'warranty-view', 'settings-view'];
                        console.log(`Switching to subview: ${config.subView}`);
                        
                        // Show/Hide Sidebar based on subview
                        const sidebar = document.getElementById('app-sidebar');
                        if (sidebar) {
                            // Show sidebar for core dashboard views
                            const showSidebarViews = ['home-view', 'sheet-view', 'dc-view', 'projects-view', 'warranty-view', 'settings-view'];
                            if (showSidebarViews.includes(config.subView)) {
                                sidebar.classList.remove('hidden');
                                sidebar.style.display = 'block';
                            } else {
                                sidebar.classList.add('hidden');
                                sidebar.style.display = 'none';
                            }
                        }

                        subViews.forEach(sv => {
                            const subEl = document.getElementById(sv);
                            if (subEl) {
                                if (sv === config.subView) {
                                    console.log(`Showing subview element: ${sv}`);
                                    subEl.classList.remove('hidden');
                                    subEl.classList.add('active'); // Add active class for CSS display: flex
                                    subEl.style.display = 'flex';
                                    subEl.style.flexDirection = 'column';
                                    subEl.style.flex = '1';
                                } else {
                                    subEl.classList.add('hidden');
                                    subEl.classList.remove('active'); // Remove active class
                                    subEl.style.display = 'none';
                                }
                            }
                        });
                    } else {
                        // For non-dashboard views (like adminView, qrView), hide sidebar
                        const sidebar = document.getElementById('app-sidebar');
                        if (sidebar) {
                            sidebar.classList.add('hidden');
                            sidebar.style.display = 'none';
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


