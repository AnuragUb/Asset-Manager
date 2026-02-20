/**
 * Shared Quantity History Modal Logic
 * Used by: Asset View, Project View, and potentially Dashboard
 * 
 * Responsibilities:
 * 1. Injects Modal CSS and HTML into the DOM if missing.
 * 2. Exposes window.showQuantityHistoryModal(assetId).
 * 3. Intercepts clicks on /api/quantity/events/:id links to show modal instead of raw JSON.
 */

(function() {
    // --- Styles ---
    const MODAL_CSS = `
        .qty-modal {
            display: none;
            position: fixed;
            z-index: 2000; /* Higher than other modals */
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0,0,0,0.4);
            backdrop-filter: blur(2px);
        }
        .qty-modal-content {
            background-color: #fff;
            margin: 5% auto;
            padding: 0;
            border: 1px solid #888;
            width: 90%;
            max-width: 800px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            animation: qtyModalSlideIn 0.3s ease-out;
        }
        @keyframes qtyModalSlideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .qty-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #eee;
            padding: 15px 20px;
            background: #f8fafc;
            border-radius: 12px 12px 0 0;
        }
        .qty-modal-title {
            margin: 0;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.1rem;
            color: #333;
        }
        .qty-close {
            cursor: pointer;
            font-size: 24px;
            line-height: 1;
            color: #999;
            transition: color 0.2s;
        }
        .qty-close:hover { color: #333; }
        .qty-loading {
            text-align: center;
            padding: 40px;
            display: none;
        }
        .qty-spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        .qty-modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 0;
        }
        .qty-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .qty-table th {
            text-align: left;
            padding: 12px 15px;
            background: #f1f5f9;
            border-bottom: 1px solid #e2e8f0;
            font-weight: 600;
            color: #475569;
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .qty-table td {
            padding: 10px 15px;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
            vertical-align: top;
        }
        .qty-table tr:hover { background: #f8fafc; }
        .qty-modal-footer {
            border-top: 1px solid #eee;
            padding: 15px 20px;
            text-align: right;
            background: #fff;
            border-radius: 0 0 12px 12px;
        }
        .qty-btn {
            padding: 8px 16px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            color: #475569;
            transition: all 0.2s;
        }
        .qty-btn:hover { background: #e2e8f0; color: #1e293b; }
        
        /* Badge Styles */
        .qty-badge { padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .badge-warning { background: #fffbeb; color: #92400e; border: 1px solid #fcd34d; }
        .badge-danger { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
        .badge-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
        .badge-info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
        .badge-secondary { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }
    `;

    // --- HTML Structure ---
    const MODAL_HTML = `
        <div id="sharedQtyHistoryModal" class="qty-modal">
            <div class="qty-modal-content">
                <div class="qty-modal-header">
                    <h3 class="qty-modal-title">
                        <span>📊</span>
                        <span>Quantity History</span>
                        <span id="sharedQtyHistoryAssetName" style="font-size: 0.8em; color: #666; font-weight: normal; margin-left: 8px;"></span>
                    </h3>
                    <span class="qty-close" onclick="document.getElementById('sharedQtyHistoryModal').style.display='none'">&times;</span>
                </div>
                <div id="sharedQtyHistoryLoading" class="qty-loading">
                    <div class="qty-spinner"></div>
                    <p style="color: #666; margin-top: 10px; font-size: 13px;">Loading transaction history...</p>
                </div>
                <div id="sharedQtyHistoryBody" class="qty-modal-body">
                    <table class="qty-table">
                        <thead>
                            <tr>
                                <th style="width: 140px;">Date</th>
                                <th style="width: 80px;">Type</th>
                                <th style="width: 100px;">Actor</th>
                                <th>Change</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody id="sharedQtyHistoryTableBody"></tbody>
                    </table>
                    <div id="sharedQtyHistoryEmpty" style="text-align: center; padding: 40px; color: #94a3b8; display: none;">
                        <div style="font-size: 24px; margin-bottom: 8px;">📭</div>
                        No quantity history recorded for this asset.
                    </div>
                </div>
                <div class="qty-modal-footer">
                    <button class="qty-btn" onclick="document.getElementById('sharedQtyHistoryModal').style.display='none'">Close</button>
                </div>
            </div>
        </div>
    `;

    // --- Initialization ---
    function init() {
        if (document.getElementById('sharedQtyHistoryModal')) return;

        // Inject Styles
        const styleSheet = document.createElement("style");
        styleSheet.innerText = MODAL_CSS;
        document.head.appendChild(styleSheet);

        // Inject HTML
        const container = document.createElement('div');
        container.innerHTML = MODAL_HTML;
        document.body.appendChild(container.firstElementChild);
    }

    // --- Helper Functions ---
    function getEventTypeClass(type) {
        switch(type) {
            case 'ISSUE': return 'badge-warning';
            case 'CONSUME': return 'badge-danger';
            case 'RECEIVE': return 'badge-success';
            case 'ADJUST': return 'badge-info';
            case 'INIT': return 'badge-secondary';
            case 'SPLIT': return 'badge-info';
            default: return 'badge-secondary';
        }
    }

    function formatDate(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return isoString; }
    }

    // --- Main Logic ---
    window.showQuantityHistoryModal = async function(assetId) {
        init(); // Ensure modal exists
        
        const modal = document.getElementById('sharedQtyHistoryModal');
        const loading = document.getElementById('sharedQtyHistoryLoading');
        const body = document.getElementById('sharedQtyHistoryBody');
        const tbody = document.getElementById('sharedQtyHistoryTableBody');
        const empty = document.getElementById('sharedQtyHistoryEmpty');
        const titleName = document.getElementById('sharedQtyHistoryAssetName');

        if (!modal) return;

        // Reset State
        titleName.textContent = `(ID: ${assetId})`;
        modal.style.display = 'block';
        loading.style.display = 'block';
        body.style.display = 'none';
        tbody.innerHTML = '';
        empty.style.display = 'none';

        try {
            const response = await fetch(`/api/quantity/events/${encodeURIComponent(assetId)}`);
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const payload = await response.json();
            const events = Array.isArray(payload?.events) ? payload.events : [];
            if (events.length === 0) {
                loading.style.display = 'none';
                body.style.display = 'block';
                empty.style.display = 'block';
                return;
            }

            // Render Rows
            tbody.innerHTML = events.map(e => {
                const lines = Array.isArray(e.lines) ? e.lines : [];
                const myLines = lines.filter(l => String(l.asset_id || l.assetId) === String(assetId));
                let changeStr = '';
                if (myLines.length > 0) {
                    changeStr = myLines.map(l => {
                        const val = (typeof l.delta_total === 'number' && l.delta_total !== 0) ? l.delta_total : (l.delta_available || 0);
                        const color = val > 0 ? '#16a34a' : (val < 0 ? '#dc2626' : '#64748b');
                        const sign = val > 0 ? '+' : '';
                        return `<span style="color:${color}; font-weight:600;">${sign}${val} ${l.unit || ''}</span>`;
                    }).join('<br>');
                } else {
                    changeStr = '<span style="color:#64748b;">-</span>';
                }
                const metaObj = e.metadata ?? (e.metadata_json ? (() => { try { return JSON.parse(e.metadata_json); } catch { return null; } })() : null);
                const metaHtml = metaObj ? Object.entries(metaObj)
                    .filter(([k]) => k !== 'prev_quantity' && k !== 'new_quantity')
                    .map(([k, v]) => `<div><strong style="color: #475569">${k}:</strong> ${v}</div>`)
                    .join('') : '';
                return `
                  <tr>
                    <td style="white-space: nowrap; color: #64748b; font-size: 11px;">${formatDate(e.timestamp)}</td>
                    <td><span class="qty-badge ${getEventTypeClass(e.type)}">${e.type}</span></td>
                    <td style="font-weight: 500;">${e.actor || '-'}</td>
                    <td>${changeStr}</td>
                    <td style="font-size: 11px; color: #64748b;">
                        ${e.note ? `<div style="font-weight: 600;">${e.note}</div>` : ''}
                        ${metaHtml}
                    </td>
                  </tr>
                `;
            }).join('');

            loading.style.display = 'none';
            body.style.display = 'block';

        } catch (err) {
            console.error('Error loading history:', err);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #ef4444; padding: 20px;">Error loading history: ${err.message}</td></tr>`;
            loading.style.display = 'none';
            body.style.display = 'block';
        }
    };

    // --- Global Interceptor ---
    document.addEventListener('click', (e) => {
        // Find closest anchor tag with the specific href pattern
        const link = e.target.closest('a[href^="/api/quantity/events/"]');
        if (link) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return; // Allow new tab

            e.preventDefault();
            e.stopPropagation();
            
            const href = link.getAttribute('href');
            const assetId = href.split('/').pop();
            if (assetId) {
                window.showQuantityHistoryModal(assetId);
            }
        }
    });

    // Auto-init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
