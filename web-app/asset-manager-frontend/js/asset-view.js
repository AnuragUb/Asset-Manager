import { checkSession, fetchWithAuth } from './auth.js?v=6.41';

// Asset View Module
// Handles fetching and displaying asset details
// Minimal implementation to fix mobile loading issues

console.log('[AssetView] Module loaded');

// Global Error Handler
window.onerror = function(msg, url, line, col, error) {
    console.error('Global Error:', msg, url, line, col, error);
    const debugEl = document.getElementById('debug-log');
    if (debugEl) {
        debugEl.style.display = 'block';
        debugEl.innerHTML += `<div style="color:red; border-bottom:1px solid #ccc; padding:4px;">ERROR: ${msg} (${line}:${col})</div>`;
    }
};

// Main function to load asset details
async function loadAssetDetails() {
    console.log('[AssetView] Initializing loadAssetDetails...');
    const debugEl = document.getElementById('debug-log');

    const pathParts = window.location.pathname.split('/').filter(p => p);
    let assetId = pathParts[pathParts.length - 1];
    
    if ((!assetId || assetId === 'asset') && pathParts.length > 1) {
        assetId = pathParts[pathParts.length - 2];
    }

    if (assetId) {
        try {
            assetId = decodeURIComponent(assetId);
        } catch (e) {
            console.warn('Failed to decode assetId from URL:', assetId);
        }
    }
    
    console.log('[AssetView] Detected ID:', assetId);

    if (!assetId || assetId === 'asset') {
        renderError('Invalid or missing Asset ID in URL');
        return;
    }

    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        const url = `/api/asset-details/${encodeURIComponent(assetId)}`;
        console.log('[AssetView] Fetching:', url);
        
        const token = localStorage.getItem('token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const response = await fetchWithAuth(url, { headers });
        console.log('[AssetView] Response status:', response.status);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errText}`);
        }
        
        const data = await response.json();
        console.log('[AssetView] Data received:', data);
        
        if (!data || !data.asset) {
            console.error('[AssetView] Invalid data structure:', data);
            throw new Error('Invalid data format received from server');
        }

        await renderAsset(data);
        
        // Hide loading
        if (loadingEl) loadingEl.style.display = 'none';
        const appEl = document.getElementById('app');
        if (appEl) appEl.style.display = 'block';

    } catch (err) {
        console.error('[AssetView] Fatal Error:', err);
        if (debugEl) {
            debugEl.style.display = 'block';
            debugEl.innerHTML += `<div style="color:red">Fatal: ${err.message}</div>`;
        }
        renderError(err.message);
    }
}

function renderError(msg) {
    const app = document.getElementById('app');
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
    if (app) {
        app.style.display = 'block';
        app.innerHTML = `
            <div style="padding: 20px; text-align: center; color: red;">
                <h2>Error</h2>
                <p>${msg}</p>
                <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 10px;">Retry</button>
            </div>
        `;
    }
}

async function renderAsset(data) {
    console.log('[AssetView] Rendering asset data:', data);
    const { asset, children, parent } = data;
    const app = document.getElementById('app');
    
    if (!asset) {
        console.error('[AssetView] No asset object in data');
        renderError('Asset data is missing');
        return;
    }

    // Check user session for permissions
    let currentUser = null;
    try {
        currentUser = await checkSession();
    } catch (e) {
        console.warn('[AssetView] Session check failed, continuing as guest');
    }
    
    const canDelete = currentUser && (
        currentUser.role === 'admin' || 
        currentUser.role === 'superuser' ||
        (Array.isArray(currentUser.role) && (currentUser.role.includes('admin') || currentUser.role.includes('superuser'))) ||
        (typeof currentUser.role === 'string' && currentUser.role.startsWith('[') && (currentUser.role.includes('"admin"') || currentUser.role.includes('"superuser"')))
    );

    console.log('[AssetView] Current User:', currentUser ? currentUser.username : 'Guest', 'Can Delete:', canDelete);

    // 1. Header Card (Basic Identity)
    let html = `
        <div class="header-card">
            <div style="font-size: 40px; margin-bottom: 10px;">${getIcon(asset.Icon)}</div>
            <h1 style="font-size: 24px; margin-bottom: 5px;">${safe(asset.ItemName)}</h1>
            <div style="opacity: 0.9; font-size: 14px; font-family: monospace;">${safe(asset.ID)}</div>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 15px;">
                <div class="status-pill" style="background: rgba(255,255,255,0.25); padding: 5px 15px; border-radius: 20px; display: inline-block; font-weight: 600;">
                    ${safe(asset.Status)}
                </div>
                ${asset.IsSet ? `
                    <div class="set-pill" style="background: #fbbf24; color: #78350f; padding: 5px 15px; border-radius: 20px; display: inline-block; font-weight: 600; font-size: 12px; text-transform: uppercase;">
                        Set 📦
                    </div>
                ` : ''}
            </div>
            
            ${asset.ParentId ? `
                <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
                    <button id="btnUnsplitAssetView" class="action-button" 
                            style="background: #fff; color: #2563eb; border: none; padding: 6px 16px; border-radius: 20px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <span>🔗</span> Unsplit & Merge back to Parent
                    </button>
                    <button id="btnBreakSet" class="action-button" 
                            style="background: #fff; color: #ef4444; border: none; padding: 6px 16px; border-radius: 20px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <span>✂️</span> Break from Set
                    </button>
                </div>
            ` : ''}
        </div>
    `;

    // 2. Specifications (The "QRScan" Essentials)
    html += `
        <div class="card">
            <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Specifications</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                ${renderField('Make', asset.Make)}
                ${renderField('Model', asset.Model)}
                ${renderField('Serial No', asset.SrNo)}
                ${renderField('Type', asset.Type)}
                ${renderField('Weight', asset.Weight || asset.weight ? `${asset.Weight || asset.weight} kg` : 'N/A')}
                ${renderField('HSN / SAC', asset.HSNCode || asset.hsn_code || 'N/A')}
                ${renderField('Location', asset.CurrentLocation)}
                ${renderField('Category', asset.Category)}
                ${renderField('Purchase Date', formatDisplayDate(asset.PurchaseDate))}
                ${renderField('Warranty', asset.WarrantyMonths ? `${asset.WarrantyMonths} Months` : 'N/A')}
                ${renderField('Value', asset.AssetValue ? `${asset.AssetValue} ${asset.Currency || 'INR'}` : 'N/A')}
                ${renderField('Department', asset.Department)}
            </div>
            ${asset.Remarks ? `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                    <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Remarks</div>
                    <div style="font-size: 14px; margin-top: 4px;">${safe(asset.Remarks)}</div>
                </div>
            ` : ''}
            ${asset.ItemDescription ? `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                    <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Description</div>
                    <div style="font-size: 14px; margin-top: 4px;">${safe(asset.ItemDescription)}</div>
                </div>
            ` : ''}
        </div>
    `;

    // 2.5 Quantity Tracking (If Applicable)
    // Show if explicitly tracked OR if data exists
    const hasQuantity = !!(asset.is_quantity_tracked === 1 || asset.quantity_root_id || (data.quantity && data.quantity.available !== undefined) || (asset.quantity_total !== undefined && asset.quantity_total !== null));
    
    if (hasQuantity) {
        const qtyAvailable = asset.quantity_available ?? (data.quantity ? data.quantity.available : 0);
        const qtyTotal = asset.quantity_total ?? (data.quantity ? data.quantity.total : 0);
        const qtyUnit = asset.quantity_unit || (data.quantity ? data.quantity.unit : 'Units'); // Default to Units if missing

        
        html += `
            <div class="card">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Quantity</h3>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1; text-align: center; padding: 10px; background: #e6fffa; border-radius: 8px; border: 1px solid #b2f5ea;">
                        <div style="font-size: 11px; color: #2c7a7b; font-weight: bold; text-transform: uppercase;">Available Quantity</div>
                        <div style="font-size: 20px; font-weight: bold; color: #234e52;">${qtyAvailable} <span style="font-size: 12px;">${qtyUnit}</span></div>
                    </div>
                    <div style="flex: 1; text-align: center; padding: 10px; background: #ebf8ff; border-radius: 8px; border: 1px solid #bee3f8;">
                        <div style="font-size: 11px; color: #2b6cb0; font-weight: bold; text-transform: uppercase;">Total Quantity</div>
                        <div style="font-size: 20px; font-weight: bold; color: #2c5282;">${qtyTotal} <span style="font-size: 12px;">${qtyUnit}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    // 2.7 Barcode / Client Label (New)
    if (asset.client_label) {
        html += `
            <div class="card" style="text-align: center;">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Client Label & QR Verification</h3>
                <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 10px 0;">
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <svg id="barcode"></svg>
                        <div style="font-family: monospace; font-size: 16px; font-weight: bold; letter-spacing: 2px; margin-top: 5px;">
                            ${safe(asset.client_label)}
                        </div>
                    </div>
                    
                    <div style="border-top: 1px dashed #ddd; width: 100%; padding-top: 20px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 10px;">Scan for Public Specs & Verification</div>
                        <canvas id="client-qr" style="max-width: 150px;"></canvas>
                    </div>
                </div>
                
                <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
                    <button id="btnPrintBarcode" class="action-button small" style="background: #0078d4; color: white; padding: 8px 16px;">🖨️ Print Combined Label</button>
                </div>
            </div>
        `;
    }

    // 3. Internal QR Tag (The permanent tag)
    html += `
        <div class="card" style="text-align: center;">
            <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Internal QR Tag</h3>
            <div style="margin: 20px 0;">
                <canvas id="internal-qr" style="max-width: 150px;"></canvas>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: #334155; margin-top: 4px; letter-spacing: 0.5px; border: 1px dashed #cbd5e1; display: inline-block; padding: 2px 8px; border-radius: 4px; background: #f8fafc;">
                ${safe(asset.ID)}
            </div>
            <div style="font-size: 11px; color: #666; margin-top: 10px;">
                Permanent internal tracking ID
            </div>
        </div>
    `;

    // 3. Current Assignment (Crucial for knowing who has it)
    if (asset.AssignedTo) {
        html += `
            <div class="card">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Current Assignment</h3>
                <div style="display: flex; align-items: center; gap: 15px; background: #f0f9ff; padding: 15px; border-radius: 10px;">
                    <div style="width: 40px; height: 40px; background: #007bff; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px;">
                        ${asset.AssignedTo.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight: bold; font-size: 16px; color: #0056b3;">${safe(asset.AssignedTo)}</div>
                        <div style="font-size: 12px; color: #666;">Assigned User/Project</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 4. Components / Children (If any)
    if (children && children.length > 0) {
        const hasSplitChildren = children.some(c => c.isSplitChild);
        const title = hasSplitChildren ? 'Linked Assets / Components' : 'Components';
        html += `
            <div class="card">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">${title} (${children.length})</h3>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${children.map(c => `
                        <div onclick="window.location.href='/asset/${encodeURIComponent(c.ID || c.id)}'" style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #f8f9fa; border-radius: 8px; border: 1px solid #eee; cursor: pointer;">
                            <div style="font-size: 20px;">${getIcon(c.Icon)}</div>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: 14px;">${safe(c.ItemName || c.itemname)}</div>
                                <div style="font-size: 11px; color: #666;">${safe(c.ID || c.id)} • ${safe(c.Status || c.status)} ${c.isSplitChild ? '<span style="color:#0078d4; font-weight:bold;">(Split Part)</span>' : ''}</div>
                            </div>
                            <div style="font-size: 12px; color: #999;">View &rarr;</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // 5. History Timeline (Merged & Simplified)
    const historyItems = [];
    
    // 1. Add Structured History (Priority for detailed changes)
    if (data.structuredHistory && Array.isArray(data.structuredHistory)) {
        data.structuredHistory.forEach(h => {
            if (!h) return;
            const action = h.Action || h.action || 'Unknown';
            const timestamp = h.Timestamp || h.timestamp;
            const user = h.User || h.user || 'web';
            const details = h.Details || h.details || '';
            const fromVal = h.OldValue || h.oldvalue;
            const toVal = h.NewValue || h.newvalue;

            let actionLabel = action ? action.replace(/_/g, ' ') : 'Unknown Action';
            
            // Format From -> To values nicely
            const changeText = (fromVal || toVal) 
                ? `<div style="margin-top:4px; font-weight:500; color:#1e293b;">
                    ${fromVal ? `<span style="background:#fee2e2; color:#991b1b; padding:1px 4px; border-radius:3px;">${safe(fromVal)}</span> → ` : ''}
                    <span style="background:#dcfce7; color:#166534; padding:1px 4px; border-radius:3px;">${safe(toVal) || 'None'}</span>
                   </div>`
                : '';

            historyItems.push({
                timestamp: timestamp,
                action: actionLabel,
                details: details,
                changeHtml: changeText,
                user: user,
                type: 'STRUCTURED'
            });
        });
    }

    // 2. Add Audit Log (Filter out duplicates if they exist in structured history)
    const auditLog = data.auditHistory || data.history;
    if (auditLog && Array.isArray(auditLog)) {
        auditLog.forEach(h => {
            if (!h) return;
            const action = h.Action || h.action || 'Unknown';
            const timestamp = h.Timestamp || h.timestamp;
            const user = h.User || h.user || 'web';
            const details = h.Details || h.details || '';

            const isGenericUpdate = action === 'UPDATE';
            const hasStructuredMatch = isGenericUpdate && historyItems.some(sh => 
                sh.timestamp && timestamp && Math.abs(new Date(sh.timestamp) - new Date(timestamp)) < 2000
            );

            if (!hasStructuredMatch) {
                historyItems.push({
                    timestamp: timestamp,
                    action: action,
                    details: details,
                    user: user,
                    type: 'AUDIT'
                });
            }
        });
    }

    if (data.quantityEvents && Array.isArray(data.quantityEvents)) {
        data.quantityEvents.forEach(e => {
            if (!e) return;
            const action = e.type || e.Action || 'QTY_CHANGE';
            const timestamp = e.timestamp || e.Timestamp;
            const actor = e.actor || e.User || 'system';
            const note = e.note || e.Details || '';

            let details = note;
            if (e.metadata && typeof e.metadata === 'object') {
                 details += ' ' + Object.entries(e.metadata).map(([k,v]) => `${k}: ${v}`).join(', ');
            }
            historyItems.push({
                timestamp: timestamp,
                action: action,
                details: details.trim(),
                user: actor,
                type: 'QTY'
            });
        });
    }

    // 6. ZOHO SYNC (New Integration)
    // Temporarily removed to debug syntax error

    if (historyItems.length > 0) {
        // Sort history by timestamp descending
        const sortedHistory = historyItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
        
        html += `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    <h3 style="margin: 0;">Recent History</h3>
                    <button id="toggleHistory" class="action-button small" style="background: #64748b; color: white; padding: 4px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer;">Hide History</button>
                </div>
                <div id="historyContainer" style="position: relative; padding-left: 20px; border-left: 2px solid #e0e0e0; margin-left: 10px;">
                    ${sortedHistory.map(h => `
                        <div style="margin-bottom: 20px; position: relative;">
                            <div style="position: absolute; left: -26px; top: 0; width: 10px; height: 10px; background: ${h.type === 'QTY' ? '#28a745' : (h.type === 'STRUCTURED' ? '#007bff' : '#64748b')}; border-radius: 50%; border: 2px solid white;"></div>
                            <div style="font-size: 11px; color: #888;">${new Date(h.timestamp).toLocaleString()}</div>
                            <div style="font-weight: 600; font-size: 14px; margin-top: 2px; color: #333">
                                ${h.type === 'QTY' ? '[QTY] ' : ''}${safe(h.action)}
                            </div>
                            ${h.changeHtml || ''}
                            <div style="font-size: 13px; color: #555; margin-top: 4px;">${safe(h.details)}</div>
                            <div style="font-size: 11px; color: #888; margin-top: 4px;">by <strong>${safe(h.user)}</strong></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Actions (Delete) - Only show for authorized users
    if (canDelete) {
        html += `
            <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
                <button id="btnDeleteStandalone" style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px;">
                    🗑️ Delete Asset
                </button>
            </div>
        `;
    } else {
        html += `
            <div style="margin-top: 20px; text-align: center; color: #64748b; font-size: 13px;">
                <p>Login as Admin to perform administrative actions.</p>
            </div>
        `;
    }

    // Footer
    html += `
        <div style="margin: 30px 0; text-align: center;">
            <a href="/" style="color: #666; text-decoration: none; padding: 10px 20px; background: #eee; border-radius: 20px; font-size: 14px;">
                &larr; Return to Dashboard
            </a>
        </div>
    `;

    // Zoho Sync UI Block
    const canSyncToZoho = currentUser && (
        currentUser.role === 'admin' || 
        currentUser.role === 'superuser' ||
        currentUser.role === 'manager' ||
        (Array.isArray(currentUser.role) && (currentUser.role.includes('admin') || currentUser.role.includes('superuser') || currentUser.role.includes('manager')))
    );

    if (canSyncToZoho) {
        const zohoId = asset.zoho_product_id;
        html += `
            <div class="card" style="border-top: 4px solid #f59e0b;">
                <h3 style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">🦊</span>
                    Zoho CRM Integration
                </h3>
                <p style="font-size: 13px; color: #666; margin-bottom: 15px;">
                    ${zohoId 
                        ? 'This asset is linked to a Zoho Product. You can update its details and kit breakdown in Zoho.' 
                        : 'Push this asset to Zoho CRM as a Product. If it is a Box Set, the kit breakdown will be automatically added to the description.'}
                </p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <button id="btnSyncToZoho" style="background: #f59e0b; color: white; padding: 10px 20px; border-radius: 8px; font-weight: 600; flex: 1; border: none; cursor: pointer;">
                        ${zohoId ? '🔄 Update in Zoho' : '📤 Push to Zoho CRM'}
                    </button>
                    ${zohoId ? `
                        <a href="https://crm.zoho.in/crm/org60021949576/tab/Products/${zohoId}" target="_blank" style="background: #f3f4f6; color: #374151; padding: 10px; border-radius: 8px; text-decoration: none; display: flex; align-items: center; justify-content: center; min-width: 40px;" title="View in Zoho">
                            🔗
                        </a>
                    ` : ''}
                </div>
                <div id="zohoSyncStatus" style="margin-top: 10px; font-size: 12px; display: none; padding: 8px; border-radius: 4px; background: #fffbeb;"></div>
            </div>
        `;
    }

    app.innerHTML = html;

    // Initialize Barcode if element exists
    if (asset.client_label && typeof JsBarcode !== 'undefined') {
        try {
            JsBarcode("#barcode", asset.client_label, {
                format: "CODE128",
                lineColor: "#000",
                width: 2,
                height: 50,
                displayValue: false
            });

            // Initialize Client QR Code
            if (typeof QRCode !== 'undefined') {
                const publicUrl = `${window.location.origin}/public/asset/${encodeURIComponent(asset.client_label)}`;
                QRCode.toCanvas(document.getElementById('client-qr'), publicUrl, {
                    width: 150,
                    margin: 2,
                    color: { dark: '#000000', light: '#ffffff' }
                });
            }
        } catch (e) {
            console.error('Barcode/QR generation failed:', e);
        }
    }

    // Initialize Internal QR Code (The permanent tag)
    if (typeof QRCode !== 'undefined') {
        try {
            const internalUrl = `${window.location.origin}/asset/${encodeURIComponent(asset.ID)}`;
            QRCode.toCanvas(document.getElementById('internal-qr'), internalUrl, {
                width: 150,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (e) {
            console.error('Internal QR generation failed:', e);
        }
    }

    // Add event listener for unsplit button
    const btnUnsplit = document.getElementById('btnUnsplitAssetView');
    const pId = asset.ParentId || asset.parentid;
    const assetId = asset.ID || asset.id;

    if (btnUnsplit && pId) {
        btnUnsplit.onclick = async () => {
            if (!confirm(`Are you sure you want to merge this asset back into its parent batch/set (${pId})?`)) {
                return;
            }

            try {
                const token = localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const response = await fetchWithAuth('/api/assets/unsplit', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ childIds: [assetId] })
                });

                if (response.ok) {
                    alert('Asset successfully merged back to parent batch/set.');
                    // Redirect to parent asset page
                    window.location.href = `/asset/${encodeURIComponent(pId)}`;
                } else {
                    const err = await response.json();
                    alert('Unsplit failed: ' + (err.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('[AssetView] Unsplit error:', err);
                alert('Error processing unsplit request');
            }
        };
    }

    // Break Set Handler
    const btnBreakSet = document.getElementById('btnBreakSet');
    if (btnBreakSet && pId) {
        btnBreakSet.onclick = async () => {
            const newPrice = prompt(`Are you sure you want to break this item (${assetId}) out of its set?\n\nYou can optionally set a new individual price for this item below:`, asset.AssetValue || asset.asset_value || '');
            
            if (newPrice === null) return; // Cancelled

            try {
                const token = localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json', 'x-user': currentUser ? currentUser.username : 'web' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const response = await fetchWithAuth('/api/assets/break-set', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ 
                        childAssetId: assetId,
                        newPrice: newPrice ? parseFloat(newPrice) : null
                    })
                });

                if (response.ok) {
                    alert('Item successfully broken out of set.');
                    location.reload();
                } else {
                    const err = await response.json();
                    alert('Break Set failed: ' + (err.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('[AssetView] Break Set error:', err);
                alert('Error processing Break Set request');
            }
        };
    }

    // Attach Delete Handler
    const btnDelete = document.getElementById('btnDeleteStandalone');
    if (btnDelete) {
        btnDelete.onclick = async () => {
            const title = '⚠️  Permanent Deletion Warning';
            const body = `Are you SURE you want to DELETE this asset?

Asset ID:    ${asset.ID}
Asset Tag:   ${asset.AssetTag || asset.ID}
Name:        ${asset.Name || asset.ProductName || asset.ItemName || '(unnamed)'}

This will:
  • Mark the asset as deleted (soft-delete)
  • Hide it from the system
  • PERMANENTLY remove it after 30 days (no recovery)

This action CANNOT be undone once the 30-day window closes.`;
            const confirmFn = (typeof window !== 'undefined' && window.safeConfirm) ? window.safeConfirm : async (t, m, o) => confirm(t + '\n\n' + m);
            if (!(await confirmFn(title, body, { confirmBtnLabel: 'Yes, PERMANENTLY Mark Deleted' }))) return;
            
            try {
                const username = currentUser ? currentUser.username : 'web';
                const token = localStorage.getItem('token');
                const headers = { 'x-user': username };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const response = await fetchWithAuth(`/api/assets/${encodeURIComponent(asset.ID)}`, {
                    method: 'DELETE',
                    headers: headers
                });
                
                if (response.ok) {
                    alert('Asset marked for deletion (30-day grace period)');
                    window.location.href = '/';
                } else {
                    const err = await response.text();
                    alert('Error deleting asset: ' + err);
                }
            } catch (err) {
                console.error('Delete error:', err);
                alert('Failed to delete asset');
            }
        };
    }

    // Zoho Sync Handler
    const btnSyncToZoho = document.getElementById('btnSyncToZoho');
    if (btnSyncToZoho) {
        btnSyncToZoho.onclick = async () => {
            const statusEl = document.getElementById('zohoSyncStatus');
            const zohoId = asset.zoho_product_id;
            
            btnSyncToZoho.disabled = true;
            btnSyncToZoho.style.opacity = '0.5';
            btnSyncToZoho.textContent = '⏳ Syncing...';
            
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.color = '#92400e';
                statusEl.textContent = 'Connecting to Zoho CRM API...';
            }

            try {
                const token = localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const response = await fetchWithAuth(`/api/zoho/sync-asset/${encodeURIComponent(assetId)}`, {
                    method: 'POST',
                    headers: headers
                });

                const result = await response.json();

                if (response.ok) {
                    if (statusEl) {
                        statusEl.style.color = '#065f46';
                        statusEl.style.background = '#d1fae5';
                        statusEl.textContent = `✅ ${result.message}`;
                    }
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error(result.error || 'Sync failed');
                }
            } catch (err) {
                console.error('[ZohoSync] Error:', err);
                btnSyncToZoho.disabled = false;
                btnSyncToZoho.style.opacity = '1';
                btnSyncToZoho.textContent = zohoId ? '🔄 Update in Zoho' : '📤 Push to Zoho CRM';
                if (statusEl) {
                    statusEl.style.color = '#991b1b';
                    statusEl.style.background = '#fee2e2';
                    statusEl.textContent = `❌ Sync Failed: ${err.message}`;
                }
            }
        };
    }

    // History Toggle Logic
    const toggleBtn = document.getElementById('toggleHistory');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const container = document.getElementById('historyContainer');
            if (container) {
                const isHidden = container.style.display === 'none';
                container.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden ? 'Hide History' : 'Show History';
            }
        };
    }

    // Print Barcode Logic
    const printBtn = document.getElementById('btnPrintBarcode');
    if (printBtn) {
        printBtn.onclick = () => {
            const printWindow = window.open('', '_blank');
            const barcodeSvg = document.getElementById('barcode').outerHTML;
            const qrCanvas = document.getElementById('client-qr');
            const qrImage = qrCanvas.toDataURL("image/png");
            const clientLabel = asset.client_label;
            const itemName = asset.ItemName || asset.itemname;

            printWindow.document.write(`
                <html>
                <head>
                    <title>Print Label - ${clientLabel}</title>
                    <style>
                        @page { size: 100mm 50mm; margin: 0; }
                        body { 
                            font-family: 'Inter', sans-serif; 
                            margin: 0;
                            padding: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            width: 100mm;
                            height: 50mm;
                        }
                        .label-card {
                            width: 90mm;
                            height: 40mm;
                            border: 1px solid #eee;
                            display: flex;
                            padding: 2mm;
                            box-sizing: border-box;
                        }
                        .left-side {
                            flex: 1.5;
                            display: flex;
                            flex-direction: column;
                            justify-content: space-between;
                            padding-right: 2mm;
                        }
                        .right-side {
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            border-left: 1px dashed #ccc;
                        }
                        .item-name {
                            font-size: 11pt;
                            font-weight: bold;
                            text-transform: uppercase;
                            border-bottom: 1px solid #000;
                            padding-bottom: 1mm;
                        }
                        .barcode-area {
                            flex-grow: 1;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            padding: 1mm 0;
                        }
                        .label-text {
                            font-family: monospace;
                            font-size: 14pt;
                            font-weight: bold;
                            letter-spacing: 1.5px;
                            text-align: center;
                        }
                        .qr-image {
                            width: 32mm;
                            height: 32mm;
                        }
                        .qr-caption {
                            font-size: 7pt;
                            color: #666;
                            margin-top: 1mm;
                        }
                    </style>
                </head>
                <body>
                    <div class="label-card">
                        <div class="left-side">
                            <div class="item-name">${itemName}</div>
                            <div class="barcode-area">
                                ${barcodeSvg}
                                <div class="label-text">${clientLabel}</div>
                            </div>
                        </div>
                        <div class="right-side">
                            <img src="${qrImage}" class="qr-image">
                            <div class="qr-caption">Scan for Specs</div>
                        </div>
                    </div>
                    <script>
                        window.onload = () => {
                            setTimeout(() => {
                                window.print();
                                window.onafterprint = () => window.close();
                            }, 500);
                        };
                    </script>
                </body>
                </html>
            `);
            printWindow.document.close();
        };
    }
}

// --- UTILS ---
function formatDisplayDate(val) {
    if (!val) return '-';
    let date;
    if (val instanceof Date) date = val;
    else if (typeof val === 'string') date = new Date(val);
    else return val;
    if (isNaN(date.getTime())) return val;
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
}

// Helper: Safe String Rendering
function safe(str) {
    return str ? String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'N/A';
}

// Helper: Render a Field
function renderField(label, value) {
    return `
        <div style="display: flex; flex-direction: column;">
            <span style="font-size: 11px; color: #888; font-weight: bold; text-transform: uppercase;">${label}</span>
            <span style="font-size: 14px; font-weight: 500; color: #333;">${safe(value)}</span>
        </div>
    `;
}

// Helper: Icon
function getIcon(icon) {
    if (icon && (icon.startsWith('/') || icon.startsWith('http'))) {
        return `<img src="${icon}" style="width: 1em; height: 1em; object-fit: contain;">`;
    }
    return icon || '📦';
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAssetDetails);
} else {
    loadAssetDetails();
}
