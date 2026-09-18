import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.61';
import {
    canLogistics,
    escapeHtml,
    dash,
    emptyState,
    crumb,
    section,
    consumeOpen,
    toastOperatorError,
    formatQty,
    formatIstDate,
    formatIstDateTime
} from './lifecycle.js?v=7.33';

function el(id) {
    return document.getElementById(id);
}

function canManageProcurement() {
    return canLogistics();
}

async function api(path, options = {}) {
    const response = await fetchWithAuth(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.reasonCode = data.reasonCode;
        err.details = data.details;
        throw err;
    }
    return data;
}

function statusChip(status) {
    const s = String(status || '').toUpperCase();
    const bg = s === 'CANCELLED' ? '#f3f4f6' : s === 'APPROVED' ? '#dcfce7' : s === 'DELIVERED' ? '#dbeafe' : s === 'CREATED' ? '#fef9c3' : '#e5e7eb';
    const fg = s === 'CANCELLED' ? '#4b5563' : s === 'APPROVED' ? '#166534' : s === 'DELIVERED' ? '#1e40af' : s === 'CREATED' ? '#854d0e' : '#374151';
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${escapeHtml(s || '—')}</span>`;
}

function syncChip(status) {
    const s = String(status || '').toUpperCase();
    const bg = s === 'RECONCILIATION_REQUIRED' || s === 'FAILED' ? '#fee2e2'
        : s === 'CANCELLED' ? '#f3f4f6'
        : s === 'SYNCED' || s === 'IMPORTED' ? '#dcfce7'
        : s === 'NOT_IMPORTED' ? '#f3f4f6'
        : '#e0e7ff';
    const fg = s === 'RECONCILIATION_REQUIRED' || s === 'FAILED' ? '#991b1b'
        : s === 'CANCELLED' ? '#4b5563'
        : s === 'SYNCED' || s === 'IMPORTED' ? '#166534'
        : '#3730a3';
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${escapeHtml(s || '—')}</span>`;
}

function receivingProgress(po) {
    const lines = po.lines || [];
    if (!lines.length) return po.source === 'LOCAL' ? 'Legacy' : '—';
    const ordered = lines.reduce((sum, line) => sum + Number(line.ordered || 0), 0);
    const accepted = lines.reduce((sum, line) => sum + Number(line.accepted || 0), 0);
    return `${accepted} / ${ordered}`;
}

function isWaitlistPo(po) {
    if (String(po.source || '').toUpperCase() === 'LOCAL') return false;
    if (po.reconciliationRequired || po.mappingRequired) return false;
    if (String(po.status || '').toUpperCase() === 'CANCELLED') return false;
    return (po.lines || []).some((line) => Number(line.outstanding || 0) > 0);
}

async function loadAeProductNames(productIds) {
    const unique = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const names = {};
    await Promise.all(unique.map(async (id) => {
        try {
            const data = await api(`/api/products/${encodeURIComponent(id)}`);
            const name = data.product && data.product.name ? String(data.product.name).trim() : '';
            if (name) names[id] = name;
        } catch (_err) {
            // Presentation only. Keep the Product ID if name lookup is denied or missing.
        }
    }));
    return names;
}

function productColumnHtml(line, names) {
    if (line.mappingRequired) {
        const zohoName = line.productName || line.zohoProductName || '';
        const zohoRef = line.zohoProductId
            ? `<div class="po-product-zoho">Zoho Product reference ${escapeHtml(String(line.zohoProductId))}</div>`
            : '';
        return `<span style="color:#991b1b;font-weight:700;">PRODUCT MAPPING REQUIRED</span>
            ${zohoName ? `<div class="po-product-name">${escapeHtml(zohoName)}</div>` : ''}
            ${zohoRef}`;
    }
    if (!line.productId) return dash(line.productId);
    const aeName = names[line.productId];
    const zohoName = line.productName || line.zohoProductName || '';
    return `<div class="po-product-cell">
        <button type="button" class="lc-crumb-link po-product-id" data-lc-go="products-view" data-lc-open="${escapeHtml(line.productId)}" aria-label="Open AssetEngine Product ${escapeHtml(line.productId)}">${escapeHtml(line.productId)}</button>
        ${aeName ? `<div class="po-product-name">${escapeHtml(aeName)}</div>` : (zohoName ? `<div class="po-product-name">${escapeHtml(zohoName)}</div>` : '')}
    </div>`;
}

let viewListenersBound = false;
let selectedId = null;
let waitlistOnly = false;

async function renderPoList() {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    const q = el('poSearch')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', '200');
    const data = await api(`/api/procurement/pos?${params.toString()}`);
    let rows = data.purchaseOrders || [];
    if (waitlistOnly) {
        rows = rows.filter(isWaitlistPo);
    }
    if (el('poCountBadge')) {
        el('poCountBadge').textContent = waitlistOnly
            ? `${rows.length} waiting for a Receipt Note`
            : `${rows.length} Purchase Orders`;
    }
    if (!rows.length) {
        host.innerHTML = emptyState({
            title: waitlistOnly ? 'No Purchase Orders waiting for a Receipt Note.' : 'No Purchase Orders imported.',
            body: waitlistOnly
                ? 'Waitlist means receivable Zoho PO lines with outstanding quantity. It is not the full Purchase Order list.'
                : 'Purchase Orders are created and managed in Zoho. Import a Purchase Order from Zoho to receive against it here.',
            actionLabel: canManageProcurement() && !waitlistOnly ? 'Import from Zoho' : '',
            actionView: 'purchase-orders-view',
            actionAttr: 'id="btnEmptyImportPo"'
        });
        host.querySelector('#btnEmptyImportPo')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderImportForm().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        ${waitlistOnly ? '<p class="lc-muted">Showing Purchase Orders waiting to become Receipt Notes (receivable lines with outstanding quantity).</p>' : ''}
        <div style="overflow:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                        <th style="padding:8px;">PO Number</th>
                        <th style="padding:8px;">Zoho PO ID</th>
                        <th style="padding:8px;">Status</th>
                        <th style="padding:8px;">Order Date</th>
                        <th style="padding:8px;">Expected Date</th>
                        <th style="padding:8px;">Receiving</th>
                        <th style="padding:8px;">Reconciliation</th>
                        <th style="padding:8px;">Source</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((po) => `
                        <tr class="po-row" data-po-id="${escapeHtml(po.id)}" data-po-source="${escapeHtml(po.source || '')}" style="border-bottom:1px solid #f3f4f6;cursor:pointer;${selectedId === po.id ? 'background:#eff6ff;' : ''}">
                            <td style="padding:8px;font-weight:600;">${dash(po.poNumber || po.id)}</td>
                            <td style="padding:8px;font-family:ui-monospace,monospace;font-size:12px;">${dash(po.zohoPoId)}</td>
                            <td style="padding:8px;">${statusChip(po.status)}</td>
                            <td style="padding:8px;">${formatIstDate(po.poDate)}</td>
                            <td style="padding:8px;">${formatIstDate(po.dueDate)}</td>
                            <td style="padding:8px;">${escapeHtml(receivingProgress(po))}</td>
                            <td style="padding:8px;">${syncChip(po.reconciliationRequired ? 'RECONCILIATION_REQUIRED' : po.syncStatus)}</td>
                            <td style="padding:8px;">${po.source === 'LOCAL' ? '<span class="lc-chip lc-chip-legacy">LEGACY</span>' : 'Zoho'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    host.querySelectorAll('.po-row').forEach((row) => {
        row.addEventListener('click', () => {
            selectedId = row.getAttribute('data-po-id');
            const source = row.getAttribute('data-po-source');
            if (source === 'LOCAL') {
                renderLegacyDetail(selectedId).catch((err) => showToast(err.message, 'error'));
            } else {
                renderPoDetail(selectedId).catch((err) => showToast(err.message, 'error'));
            }
        });
    });
}

async function renderLegacyDetail(id) {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    const order = await api(`/api/orders/${encodeURIComponent(id)}`);
    const po = order.orders?.[0] || order.data?.[0] || order;
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoBack">← Purchase Orders</button>
            <h3 style="margin:0;">${escapeHtml(po.PONumber || po.ponumber || id)}</h3>
        </div>
        <div class="po-legacy-banner">LEGACY local Purchase Order. This document was not imported from Zoho. Commercial editing is closed. Historical Receipt Notes remain linked.</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0;">
            <div><div class="po-label">Local ID</div><div class="po-mono">${escapeHtml(po.ID || po.id || id)}</div></div>
            <div><div class="po-label">Status</div><div>${statusChip(po.Status || po.status)}</div></div>
            <div><div class="po-label">Classification</div><div>LEGACY</div></div>
        </div>
        <div class="view-actions" style="display:flex;gap:8px;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoViewReceipts">View Receipts</button>
        </div>`;
    el('btnPoBack')?.addEventListener('click', () => renderPoList().catch((err) => showToast(err.message, 'error')));
    el('btnPoViewReceipts')?.addEventListener('click', () => {
        window.location.hash = '';
        if (typeof window.showView === 'function') window.showView('receipts-view');
        if (typeof window.initReceiptsView === 'function') window.initReceiptsView();
    });
}

async function renderPoDetail(id) {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    const data = await api(`/api/procurement/pos/${encodeURIComponent(id)}`);
    const po = data.purchaseOrder;
    const logistics = canManageProcurement();
    const reconLines = (po.lines || []).filter((line) => line.reconciliationRequired);
    const productNames = await loadAeProductNames(
        (po.lines || []).filter((line) => line.productId && !line.mappingRequired).map((line) => line.productId)
    );
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoBack">← Purchase Orders</button>
            <h3 style="margin:0;">${escapeHtml(po.poNumber || po.id)}</h3>
        </div>
        ${crumb([
            { label: 'Product', view: 'products-view', open: (po.lines || []).find((l) => l.productId)?.productId || '' },
            { label: 'Purchase Order' },
            { label: 'Receipt Notes', view: 'receipts-view' }
        ])}
        <p class="lc-muted">This Purchase Order is a commercial document. It does not create stock. Receive goods with a Receipt Note.</p>
        ${po.reconciliationRequired ? `<div class="po-recon-banner"><strong>RECONCILIATION REQUIRED</strong><br>This PO has less commercial quantity than has already been physically accepted. Further receiving is blocked. Resolve the commercial quantity in Zoho. AssetEngine will not reverse physical history.</div>` : ''}
        ${po.mappingRequired ? `<div class="po-map-banner"><strong>PRODUCT MAPPING REQUIRED</strong><br>One or more lines are not linked to an AssetEngine Product. Receiving is blocked until the Product is linked.</div>` : ''}
        ${po.status === 'CANCELLED' ? `<div class="po-recon-banner"><strong>CANCELLED</strong><br>New Receipt Notes are blocked. Historical receipts and physical stock remain.</div>` : ''}
        ${po.lastError ? `<div class="po-recon-banner">Last Zoho sync error: ${escapeHtml(po.lastError)}</div>` : ''}
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;margin-bottom:12px;">
            <div style="font-weight:700;margin-bottom:8px;">PURCHASE ORDER</div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;font-size:13px;">
                <div><div class="po-label">PO Number</div><div>${dash(po.poNumber)}</div></div>
                <div><div class="po-label">Zoho PO ID</div><div class="po-mono">${dash(po.zohoPoId)}</div></div>
                <div><div class="po-label">Status</div><div>${statusChip(po.status)}</div></div>
                <div><div class="po-label">Order Date</div><div>${formatIstDate(po.poDate)}</div></div>
                <div><div class="po-label">Expected Date</div><div>${formatIstDate(po.dueDate)}</div></div>
                <div><div class="po-label">Sync</div><div>${syncChip(po.syncStatus)}</div></div>
                <div><div class="po-label">Last synced</div><div>${formatIstDateTime(po.lastSyncedAt)}</div></div>
                <div><div class="po-label">Imported</div><div>${formatIstDateTime(po.createdAt)}</div></div>
            </div>
        </div>
        <div class="view-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
            ${logistics ? '<button type="button" class="action-button blue" id="btnPoRefresh">Refresh from Zoho</button>' : ''}
            ${logistics ? '<button type="button" class="action-button green" id="btnPoCreateBook">Create Purchase Book</button>' : ''}
            <button type="button" class="action-button grey" id="btnPoViewReceipts">View Receipts</button>
            <button type="button" class="action-button grey" id="btnPoHistory">History</button>
        </div>
        <div style="font-weight:700;margin-bottom:8px;">LINES</div>
        <div style="overflow:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                        <th style="padding:8px;">Product</th>
                        <th style="padding:8px;">Description</th>
                        <th style="padding:8px;">Ordered</th>
                        <th style="padding:8px;">Accepted</th>
                        <th style="padding:8px;">Rejected</th>
                        <th style="padding:8px;">Damaged</th>
                        <th style="padding:8px;">Outstanding</th>
                        <th style="padding:8px;">Reconciliation</th>
                    </tr>
                </thead>
                <tbody>
                    ${(po.lines || []).map((line) => `
                        <tr style="border-bottom:1px solid #f3f4f6;${line.reconciliationRequired ? 'background:#fef2f2;' : ''}">
                            <td class="po-product-td">${productColumnHtml(line, productNames)}</td>
                            <td style="padding:8px;">${dash(line.description)}</td>
                            <td style="padding:8px;">${escapeHtml(line.ordered)}</td>
                            <td style="padding:8px;">${escapeHtml(line.accepted)}</td>
                            <td style="padding:8px;">${escapeHtml(line.rejected)}</td>
                            <td style="padding:8px;">${escapeHtml(line.damaged)}</td>
                            <td style="padding:8px;">${escapeHtml(line.outstanding)}</td>
                            <td style="padding:8px;">${syncChip(line.reconciliationStatus)}</td>
                        </tr>
                        ${line.reconciliationRequired ? `<tr><td colspan="8" class="po-recon-line">Ordered: ${escapeHtml(line.ordered)} · Accepted: ${escapeHtml(line.accepted)}. This PO line has less commercial quantity than has already been physically accepted. Further receiving is blocked.</td></tr>` : ''}
                    `).join('') || '<tr><td colspan="8" style="padding:12px;color:#667085;">No lines</td></tr>'}
                </tbody>
            </table>
        </div>
        <div id="poReceiptsHost"></div>
        <div id="poPhysicalHost"></div>
        <div id="poHistoryHost"></div>`;
    el('btnPoBack')?.addEventListener('click', () => renderPoList().catch((err) => showToast(err.message, 'error')));
    el('btnPoRefresh')?.addEventListener('click', async () => {
        try {
            await api(`/api/purchase-orders/${encodeURIComponent(po.id)}/refresh-zoho`, { method: 'POST' });
            showToast('Refreshed from Zoho', 'success');
            await renderPoDetail(po.id);
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnPoCreateBook')?.addEventListener('click', () => {
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('purchase-books-view', { createFromPo: po.id });
        } else if (typeof window.initPurchaseBooksView === 'function') {
            window.initPurchaseBooksView();
        }
    });
    el('btnPoViewReceipts')?.addEventListener('click', () => {
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('receipts-view', { poId: po.id });
        } else if (typeof window.initReceiptsView === 'function') {
            window.initReceiptsView();
        }
    });
    loadPoRelated(po.id);
    el('btnPoHistory')?.addEventListener('click', async () => {
        try {
            const hist = await api(`/api/procurement/pos/${encodeURIComponent(po.id)}/history`);
            const box = el('poHistoryHost');
            if (!box) return;
            box.innerHTML = `
                <div style="font-weight:700;margin:16px 0 8px;">SYNC HISTORY</div>
                ${(hist.events || []).map((ev) => `
                    <div style="font-size:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
                        <span class="po-mono">${formatIstDateTime(ev.createdAt)}</span>
                        · ${escapeHtml(ev.operation)} · ${escapeHtml(ev.status)}
                        ${ev.errorMessage ? ` · ${escapeHtml(ev.errorMessage)}` : ''}
                    </div>
                `).join('') || '<p style="color:#667085;">No history yet.</p>'}`;
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    void reconLines;
    void formatQty;
    void section;
}

async function loadPoRelated(poId) {
    const receiptsHost = el('poReceiptsHost');
    const physicalHost = el('poPhysicalHost');
    try {
        const data = await api(`/api/receipt-notes?poId=${encodeURIComponent(poId)}&limit=50`);
        const notes = data.receiptNotes || [];
        if (receiptsHost) {
            receiptsHost.innerHTML = section('Receipts', notes.length
                ? `<ul class="lc-event-list">${notes.map((n) => `
                    <li><button type="button" class="lc-crumb-link" data-lc-go="receipts-view" data-lc-open="${escapeHtml(n.id)}">${escapeHtml(n.id)}</button>
                    · ${escapeHtml(n.status)} · accepted ${escapeHtml(String(n.acceptedQuantity ?? '—'))}</li>
                `).join('')}</ul>`
                : '<p class="lc-muted">No Receipt Notes yet. Receive goods to create physical stock.</p>');
        }
        const posted = notes.filter((n) => String(n.status).toUpperCase() === 'POSTED');
        const outputs = [];
        for (const n of posted.slice(0, 8)) {
            try {
                const detail = await api(`/api/receipt-notes/${encodeURIComponent(n.id)}`);
                (detail.outputs || []).forEach((o) => outputs.push(o));
            } catch (_err) { /* skip */ }
        }
        if (physicalHost) {
            physicalHost.innerHTML = section('Physical output', outputs.length
                ? `<ul class="lc-event-list">${outputs.map((o) => {
                    const view = String(o.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
                    return `<li>${escapeHtml(o.resourceType)}
                        <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(o.resourceId)}">${escapeHtml(o.resourceId)}</button>
                        × ${escapeHtml(o.quantity)}</li>`;
                }).join('')}</ul>`
                : '<p class="lc-muted">No Assets or Inventory from this PO yet. Post a Receipt Note to create stock.</p>');
        }
    } catch (err) {
        if (receiptsHost) receiptsHost.innerHTML = `<p class="lc-muted">${escapeHtml(err.message)}</p>`;
    }
}

async function renderImportForm() {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    if (!canManageProcurement()) {
        showToast('Sales cannot import Purchase Orders', 'error');
        return;
    }
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoBack">← Purchase Orders</button>
            <h3 style="margin:0;">Import from Zoho</h3>
        </div>
        <div class="po-zoho-banner">Purchase Orders are created and managed in Zoho. Enter a Zoho Purchase Order ID to preview, then import a read-only mirror. This does not create a Receipt Note or physical stock.</div>
        <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;">
            <label style="font-size:12px;font-weight:700;">Zoho PO ID</label>
            <div style="display:flex;gap:8px;margin-top:6px;">
                <input id="zohoPoIdInput" placeholder="Zoho record id" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;">
                <button type="button" class="action-button grey" id="btnPoPreview">Preview</button>
            </div>
        </div>
        <div id="poPreviewHost" style="margin-top:12px;"></div>`;
    el('btnPoBack')?.addEventListener('click', () => renderPoList().catch((err) => showToast(err.message, 'error')));
    el('btnPoPreview')?.addEventListener('click', previewZohoPo);
}

async function previewZohoPo() {
    const zohoPoId = el('zohoPoIdInput')?.value?.trim();
    const host = el('poPreviewHost');
    if (!zohoPoId || !host) {
        showToast('Enter a Zoho PO ID', 'error');
        return;
    }
    try {
        const data = await api(`/api/purchase-orders/preview-zoho?zohoPoId=${encodeURIComponent(zohoPoId)}`);
        const po = data.purchaseOrder;
        const mapping = data.mappingRequired;
        host.innerHTML = `
            ${mapping ? '<div class="po-map-banner"><strong>PRODUCT MAPPING REQUIRED</strong><br>Link each Zoho Product to an AssetEngine Product before receiving. Import still stores the commercial snapshot.</div>' : ''}
            ${data.alreadyImported ? `<div class="po-zoho-banner">Already imported as ${escapeHtml(data.existingId)}. Import will refresh the same local PO.</div>` : ''}
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;">
                <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(po.poNumber || po.zohoPoId)}</div>
                <div style="font-size:13px;margin-bottom:10px;">Status ${statusChip(po.status)} · Zoho ${dash(po.zohoPoId)}</div>
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="text-align:left;color:#667085;border-bottom:1px solid #e5e7eb;">
                            <th style="padding:8px;">Product</th>
                            <th style="padding:8px;">Description</th>
                            <th style="padding:8px;">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(po.lines || []).map((line) => `
                            <tr style="border-bottom:1px solid #f3f4f6;">
                                <td style="padding:8px;">
                                    ${line.mappingRequired ? '<span style="color:#991b1b;font-weight:700;">PRODUCT MAPPING REQUIRED</span>' : dash(line.productId)}
                                    ${line.productName || line.zohoProductName ? `<div class="po-product-name">${escapeHtml(line.productName || line.zohoProductName)}</div>` : ''}
                                </td>
                                <td style="padding:8px;">${dash(line.description)}</td>
                                <td style="padding:8px;">${escapeHtml(line.orderedQty)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top:12px;">
                    <button type="button" class="action-button green" id="btnPoImportConfirm">Import from Zoho</button>
                </div>
            </div>`;
        el('btnPoImportConfirm')?.addEventListener('click', async () => {
            try {
                const result = await api('/api/purchase-orders/import-zoho', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zohoPoId })
                });
                showToast(`Imported ${result.po?.poNumber || result.po?.id}`, 'success');
                selectedId = result.po?.id;
                await renderPoDetail(result.po.id);
            } catch (err) {
                showToast(err.reasonCode ? `${err.reasonCode}: ${err.message}` : err.message, 'error');
            }
        });
    } catch (err) {
        host.innerHTML = `<div class="po-recon-banner">${escapeHtml(err.reasonCode ? `${err.reasonCode}: ${err.message}` : err.message)}</div>`;
    }
}

export function initPurchaseOrdersView() {
    if (el('btnImportZohoPo')) {
        el('btnImportZohoPo').style.display = canManageProcurement() ? '' : 'none';
    }
    if (!viewListenersBound) {
        viewListenersBound = true;
        el('btnReloadPos')?.addEventListener('click', () => renderPoList().catch((e) => showToast(e.message, 'error')));
        el('poSearch')?.addEventListener('input', () => renderPoList().catch((e) => showToast(e.message, 'error')));
        el('btnImportZohoPo')?.addEventListener('click', () => renderImportForm().catch((e) => showToast(e.message, 'error')));
    }
    const pending = consumeOpen('purchase-orders-view');
    waitlistOnly = String(pending?.extra?.waitlist || '') === '1' || pending?.extra?.waitlist === true;
    renderPoList().then(() => {
        if (pending && pending.open) {
            selectedId = pending.open;
            return renderPoDetail(pending.open);
        }
    }).catch((err) => toastOperatorError(err));
}

window.initPurchaseOrdersView = initPurchaseOrdersView;
window.openPurchaseOrderImport = () => {
    renderImportForm().catch((err) => showToast(err.message, 'error'));
};
window.openPurchaseOrderDetail = (id) => {
    selectedId = id;
    renderPoDetail(id).catch((err) => showToast(err.message, 'error'));
};
