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
    // console.log('[AssetView] Initializing loadAssetDetails...');
    const debugEl = document.getElementById('debug-log');

    const pathParts = window.location.pathname.split('/').filter(p => p);
    // Handle trailing slashes or extra segments if any
    let assetId = pathParts[pathParts.length - 1];
    
    // If the last part is empty or just 'asset', try the one before
    if ((!assetId || assetId === 'asset') && pathParts.length > 1) {
        assetId = pathParts[pathParts.length - 2];
    }
    
    // console.log('[AssetView] Detected ID:', assetId);

    if (!assetId || assetId === 'asset') {
        renderError('Invalid or missing Asset ID in URL');
        return;
    }

    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        const url = `/api/asset-details/${encodeURIComponent(assetId)}`;
        // console.log('[AssetView] Fetching:', url);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        // console.log('[AssetView] Data received', data);
        
        if (!data || !data.asset) {
            throw new Error('Invalid data format received');
        }

        renderAsset(data);
        
        // Hide loading
        if (loadingEl) loadingEl.style.display = 'none';
        const appEl = document.getElementById('app');
        if (appEl) appEl.style.display = 'block';

    } catch (err) {
        // console.error('[AssetView] Error:', err);
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

function renderAsset(data) {
    const { asset, children, parent } = data;
    const app = document.getElementById('app');
    
    // 1. Header Card (Basic Identity)
    let html = `
        <div class="header-card">
            <div style="font-size: 40px; margin-bottom: 10px;">${getIcon(asset.Icon)}</div>
            <h1 style="font-size: 24px; margin-bottom: 5px;">${safe(asset.ItemName)}</h1>
            <div style="opacity: 0.9; font-size: 14px; font-family: monospace;">${safe(asset.ID)}</div>
            <div class="status-pill" style="margin-top: 15px; background: rgba(255,255,255,0.25); padding: 5px 15px; border-radius: 20px; display: inline-block; font-weight: 600;">
                ${safe(asset.Status)}
            </div>
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
                ${renderField('Location', asset.CurrentLocation)}
                ${renderField('Category', asset.Category)}
            </div>
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
                        <div style="font-size: 11px; color: #2c7a7b; font-weight: bold; text-transform: uppercase;">Available</div>
                        <div style="font-size: 20px; font-weight: bold; color: #234e52;">${qtyAvailable} <span style="font-size: 12px;">${qtyUnit}</span></div>
                    </div>
                    <div style="flex: 1; text-align: center; padding: 10px; background: #ebf8ff; border-radius: 8px; border: 1px solid #bee3f8;">
                        <div style="font-size: 11px; color: #2b6cb0; font-weight: bold; text-transform: uppercase;">Total</div>
                        <div style="font-size: 20px; font-weight: bold; color: #2c5282;">${qtyTotal} <span style="font-size: 12px;">${qtyUnit}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

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
        html += `
            <div class="card">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Components (${children.length})</h3>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${children.map(c => `
                        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #f8f9fa; border-radius: 8px; border: 1px solid #eee;">
                            <div style="font-size: 20px;">${getIcon(c.Icon)}</div>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: 14px;">${safe(c.ItemName)}</div>
                                <div style="font-size: 11px; color: #666;">${safe(c.ID)} • ${safe(c.Status)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // 5. History Timeline (Merged & Simplified)
    // Combine standard audit history with quantity events if available
    const historyItems = [];
    
    if (data.history && Array.isArray(data.history)) {
        data.history.forEach(h => {
            historyItems.push({
                timestamp: h.Timestamp,
                action: h.Action,
                details: h.Details,
                user: h.User,
                type: 'AUDIT'
            });
        });
    }

    if (data.quantityEvents && Array.isArray(data.quantityEvents)) {
        data.quantityEvents.forEach(e => {
            let details = e.note || '';
            if (e.metadata && typeof e.metadata === 'object') {
                 details += ' ' + Object.entries(e.metadata).map(([k,v]) => `${k}: ${v}`).join(', ');
            }
            historyItems.push({
                timestamp: e.timestamp,
                action: e.type,
                details: details.trim(),
                user: e.actor,
                type: 'QTY'
            });
        });
    }

    if (historyItems.length > 0) {
        // Sort history by timestamp descending
        const sortedHistory = historyItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15);
        
        html += `
            <div class="card">
                <h3 style="margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Recent History</h3>
                <div style="position: relative; padding-left: 20px; border-left: 2px solid #e0e0e0; margin-left: 10px;">
                    ${sortedHistory.map(h => `
                        <div style="margin-bottom: 20px; position: relative;">
                            <div style="position: absolute; left: -26px; top: 0; width: 10px; height: 10px; background: ${h.type === 'QTY' ? '#28a745' : '#007bff'}; border-radius: 50%; border: 2px solid white;"></div>
                            <div style="font-size: 12px; color: #888;">${new Date(h.timestamp).toLocaleString()}</div>
                            <div style="font-weight: 600; font-size: 14px; margin-top: 2px; color: ${h.type === 'QTY' ? '#28a745' : '#333'}">
                                ${h.type === 'QTY' ? '[QTY] ' : ''}${safe(h.action)}
                            </div>
                            <div style="font-size: 13px; color: #555; margin-top: 2px;">${safe(h.details)}</div>
                            <div style="font-size: 11px; color: #888; margin-top: 2px;">by ${safe(h.user)}</div>
                        </div>
                    `).join('')}
                </div>
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

    app.innerHTML = html;
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
