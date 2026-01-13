import { showView } from './utils.js?v=3.8';
import { renderDashboard, setupDashboard, renderSidebarTree } from './dashboard.js?v=3.8';
import { initScannerView } from './networkScanner.js?v=3.8';
import { renderAdmin } from './admin.js?v=3.8';
import { renderItAssets } from './itAssets.js?v=3.8';
import { setupAuth } from './auth.js?v=3.8';
import { setupQrGenerator } from './qr.js?v=3.8';
import { HierarchyManager } from './hierarchy.js?v=3.8';
import { initEmployeeView, loadEmployees } from './employees.js?v=3.8';
import { setupOcr } from './ocr.js?v=1.0';

// Expose showView to global scope for other modules
window.showView = showView;

// --- RELEASES VIEW RENDERING ---
export function renderReleases() {
    console.log('renderReleases() called');
    const content = document.getElementById('release-notes-content');
    if (!content) return;
    
    content.innerHTML = `
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
            
            // If we are in the dashboard view, re-render it
            const dashboardView = document.getElementById('dashboardView');
            if (dashboardView && dashboardView.style.display !== 'none') {
                renderDashboard(assets, filteredAssets);
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
    console.log('DOM Content Loaded (main.js)');
    const views = document.querySelectorAll('.view');
    console.log(`Found ${views.length} views`);
    
    setupQrGenerator();
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
        
        const dashboardView = document.getElementById('dashboardView');
        if (dashboardView) {
            console.log('Found dashboardView, switching...');
            showView('dashboardView');
            
            // Set nav-dashboard as active
            document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
            document.getElementById('nav-dashboard')?.classList.add('active');

            // Show home-view subview by default
            const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view', 'scanner-view', 'projects-view'];
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
                        if (sv === 'dc-view') {
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
                
                // Show projects-view subview
                const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view', 'scanner-view', 'projects-view'];
                subViews.forEach(sv => {
                    const el = document.getElementById(sv);
                    if (el) {
                        if (sv === 'projects-view') {
                        el.classList.remove('hidden');
                        el.style.display = 'flex';
                    } else {
                            el.classList.add('hidden');
                            el.style.display = 'none';
                        }
                    }
                });

                if (window.showProjectDetails) {
                    window.showProjectDetails(currentUser.projectId);
                }
                // Hide other nav links for clients
                document.querySelectorAll('.nav-link:not(#nav-projects)').forEach(link => link.style.display = 'none');
            }

            // Check for edit parameter in URL
            const urlParams = new URLSearchParams(window.location.search);
            const editId = urlParams.get('edit');
            if (editId) {
                const assetToEdit = assets.find(a => a.ID === editId);
                if (assetToEdit) {
                    import('./dashboard.js').then(module => {
                        module.editAsset(assetToEdit);
                    });
                }
                // Clear the parameter without reloading
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
            }

            // Add navigation listeners after setupDashboard to ensure they don't conflict
            setupNavigation();
        } else {
            console.error('Could NOT find dashboardView element!');
            alert('Error: Dashboard view not found in the page.');
        }
    });
});

function setupNavigation() {
    console.log('setupNavigation() called');
    
    const navLinks = {
        'nav-dashboard': { view: 'dashboardView', subView: 'home-view' },
        'nav-sheet': { view: 'dashboardView', subView: 'sheet-view', init: () => window.initSheetView?.() },
        'nav-employees': { view: 'dashboardView', subView: 'employee-view', init: () => initEmployeeView() },
        'nav-dc': { view: 'dashboardView', subView: 'dc-view', init: () => window.initDCView?.() },
        'nav-projects': { 
            view: 'dashboardView', 
            subView: 'projects-view', 
            init: () => {
                console.log('nav-projects init called');
                if (typeof window.initProjectsView === 'function') {
                    window.initProjectsView();
                } else {
                    console.warn('window.initProjectsView is not a function, retrying in 100ms...');
                    setTimeout(() => {
                        if (typeof window.initProjectsView === 'function') {
                            window.initProjectsView();
                        } else {
                            console.error('window.initProjectsView still not available after retry');
                        }
                    }, 100);
                }
            }
        },
        'nav-releases': { view: 'dashboardView', subView: 'releases-view', init: () => window.renderReleases?.() },
        'nav-scanner': { view: 'dashboardView', subView: 'scanner-view', init: () => initScannerView() },
        'nav-ocr': { view: 'dashboardView', subView: 'ocr-view' },
        'nav-admin': { view: 'adminView', init: () => typeof renderAdmin === 'function' && renderAdmin() },
        'navGenerateCode': { view: 'qrView', init: () => typeof setupQrGenerator === 'function' && setupQrGenerator() }
    };

    Object.entries(navLinks).forEach(([id, config]) => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log(`Navigation clicked: ${id}`);
            
            // 1. Show main view
            showView(config.view);

            // 2. Handle sub-views within dashboard
            if (config.view === 'dashboardView') {
                const subViews = ['home-view', 'sheet-view', 'employee-view', 'dc-view', 'releases-view', 'scanner-view', 'projects-view', 'ocr-view'];
                subViews.forEach(sv => {
                    const el = document.getElementById(sv);
                    if (el) {
                        if (sv === config.subView) {
                            el.classList.remove('hidden');
                            el.style.display = 'flex';
                            if (sv === 'home-view' || sv === 'dc-view') {
                                el.style.flexDirection = 'column';
                            }
                        } else {
                            el.classList.add('hidden');
                            el.style.display = 'none';
                        }
                    }
                });
            }

            // 3. Update active state
            document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
            e.currentTarget.classList.add('active');

            // 4. Run init function if any
            if (config.init) config.init();
        });
    });
}

function setupDashboardFormHandlers() {
    console.log('setupDashboardFormHandlers() called - Attaching listeners to forms');
    const addAssetKindForm = document.getElementById('addAssetKindForm');
    if (addAssetKindForm) {
        addAssetKindForm.onsubmit = async (e) => {
            e.preventDefault();
            console.log('addAssetKindForm submitted');
            const name = document.getElementById('newKindName').value;
            const icon = document.getElementById('newKindIcon').value || '📦';
            const parentName = document.getElementById('newKindParent').value || null;
            const category = localStorage.getItem('selectedAssetCategory');
            
            const newKind = {
                Name: name,
                Module: category,
                Icon: icon,
                ParentName: parentName
            };
            
            try {
                const response = await fetch('/api/asset_kinds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newKind)
                });
                
                if (response.ok) {
                    console.log('Asset kind saved successfully');
                    await loadAssets(); // Reload everything
                    await renderSidebarTree(); // Update sidebar with new kind
                    renderDashboard(assets, filteredAssets);
                    const modal = document.getElementById('addAssetKindModal');
                    if (modal) modal.style.display = 'none';
                    addAssetKindForm.reset();
                } else {
                    const errText = await response.text();
                    alert('Error saving asset kind: ' + errText);
                }
            } catch (err) {
                console.error('Failed to save asset kind:', err);
            }
        };
    }

    const addAssetItemForm = document.getElementById('addAssetItemForm');
    if (addAssetItemForm) {
        addAssetItemForm.onsubmit = async (e) => {
            e.preventDefault();
            console.log('Add Asset Form Submission Started');
            
            const assetDbId = document.getElementById('assetDbId').value;
            const kind = document.getElementById('itemKind').value;
            const name = document.getElementById('itemName').value;
            console.log('Form data:', { kind, name, assetDbId });
            const status = document.getElementById('itemStatus').value;
            const category = localStorage.getItem('selectedAssetCategory');
            
            // Get the icon from the form field, fallback to kind icon if empty
            let icon = document.getElementById('itemIcon')?.value;
            if (!icon) {
                const kindDef = (window.allAssetKinds || []).find(k => k.Name === kind);
                icon = kindDef ? kindDef.Icon : '📦';
            }

            // Add the new individual asset
            const newItem = {
                ID: assetDbId || undefined, // Include ID if editing
                Type: kind,
                ItemName: name,
                Status: status,
                Icon: icon,
                Category: category,
                Make: document.getElementById('itemMake')?.value || '',
                Model: document.getElementById('itemModel')?.value || '',
                SrNo: document.getElementById('itemSrNo')?.value || '',
                CurrentLocation: document.getElementById('itemLocation')?.value || '',
                IN: document.getElementById('itemIn')?.value || '0',
                OUT: document.getElementById('itemOut')?.value || '0',
                Balance: document.getElementById('itemBalance')?.value || '0',
                DispatchReceiveDt: document.getElementById('itemDate')?.value || '',
                PurchaseDetails: document.getElementById('itemPurchase')?.value || '',
                Remarks: document.getElementById('itemRemarks')?.value || '',
                AssignedTo: document.getElementById('itemAssignedTo')?.value || '',
                ParentId: document.getElementById('itemParentId')?.value || '',
                // IT Specific Fields
                MACAddress: document.getElementById('itemMAC')?.value || '',
                IPAddress: document.getElementById('itemIP')?.value || '',
                NetworkType: document.getElementById('itemNetworkType')?.value || '',
                PhysicalPort: document.getElementById('itemPhysicalPort')?.value || '',
                VLAN: document.getElementById('itemVLAN')?.value || '',
                SocketID: document.getElementById('itemSocketID')?.value || '',
                UserID: document.getElementById('itemUserID')?.value || ''
            };

            console.log('Saving asset item:', newItem);
            const result = await saveAsset(newItem);
            
            if (result && (result.success || result.id)) {
                const mainAssetId = result.id || assetDbId;
                
                // Handle Child Assets (No QR)
                const childRows = document.querySelectorAll('.child-asset-row');
                for (const row of childRows) {
                    const childName = row.querySelector('.child-name').value;
                    if (!childName) continue;

                    const childData = {
                        Type: 'Component',
                        ItemName: childName,
                        Make: row.querySelector('.child-make').value,
                        SrNo: row.querySelector('.child-srno').value,
                        Status: status,
                        Category: category,
                        ParentId: mainAssetId,
                        NoQR: 1,
                        Icon: '🧩'
                    };
                    await saveAsset(childData);
                }

                // Handle Linked Components (QR)
                const linkedTags = document.querySelectorAll('.linked-component-tag');
                for (const tag of linkedTags) {
                    const linkedId = tag.getAttribute('data-id');
                    // Find the full asset object to update it
                    const linkedAsset = (window.allAssets || []).find(a => a.ID === linkedId);
                    if (linkedAsset) {
                        const updatedLinked = { ...linkedAsset, ParentId: mainAssetId };
                        await saveAsset(updatedLinked);
                    }
                }

                const modal = document.getElementById('addAssetItemModal');
                if (modal) modal.style.display = 'none';
                addAssetItemForm.reset();
                document.getElementById('assetDbId').value = ''; // Clear the hidden ID
                
                // Final reload to ensure everything is in sync
                await loadAssets();
                renderDashboard(assets, filteredAssets);
            }
        };
    }
}
