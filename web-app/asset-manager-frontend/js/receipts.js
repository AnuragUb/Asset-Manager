import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.60';
import {
    canLogistics,
    escapeHtml,
    emptyState,
    crumb,
    consumeOpen,
    toastOperatorError,
    formatQty
} from './lifecycle.js?v=7.28';

function el(id) {
    return document.getElementById(id);
}

function canMutateReceipts() {
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

function idempotencyKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function statusChipClass(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'OPEN') return 'ms-chip ms-chip-incomplete';
    if (s === 'POSTED') return 'ms-chip ms-chip-complete';
    if (s === 'CANCELLED') return 'ms-chip ms-chip-archived';
    if (s === 'REVERSED') return 'ms-chip ms-chip-disbanded';
    return 'ms-chip';
}

function projectionChip(status) {
    const s = String(status || '—').toUpperCase();
    if (s === 'SKIPPED') return 'ms-chip ms-chip-legacy';
    if (s === 'SENT') return 'ms-chip ms-chip-complete';
    if (s === 'FAILED' || s === 'RETRY') return 'ms-chip ms-chip-overcomplete';
    if (s === 'PENDING') return 'ms-chip ms-chip-incomplete';
    return 'ms-chip';
}

let viewListenersBound = false;
let selectedPoBalance = null;
let productHits = [];

async function renderReceiptList() {
    const host = el('receiptsContent');
    if (!host) return;
    const q = el('receiptSearch')?.value || '';
    const status = el('receiptStatusFilter')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    params.set('limit', '100');
    const data = await api(`/api/receipt-notes?${params.toString()}`);
    const notes = data.receiptNotes || [];
    if (el('receiptCountBadge')) {
        el('receiptCountBadge').textContent = `${notes.length} Receipts`;
    }
    if (!notes.length) {
        host.innerHTML = emptyState({
            title: 'No Receipt Notes awaiting action.',
            body: 'Receive goods against an imported Purchase Order. Posting creates accepted physical stock.',
            actionLabel: canMutateReceipts() ? 'Receive against PO' : '',
            actionView: 'receipts-view',
            actionAttr: 'id="btnEmptyCreateReceipt"'
        });
        host.querySelector('#btnEmptyCreateReceipt')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderCreateForm().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                    <th style="padding:8px;">Receipt Note</th>
                    <th style="padding:8px;">PO</th>
                    <th style="padding:8px;">Vendor</th>
                    <th style="padding:8px;">Status</th>
                    <th style="padding:8px;">Received</th>
                    <th style="padding:8px;">Accepted</th>
                    <th style="padding:8px;">Projection</th>
                </tr>
            </thead>
            <tbody>
                ${notes.map((n) => `
                    <tr class="rn-row" data-id="${escapeHtml(n.id)}" style="border-bottom:1px solid #f1f5f9;cursor:pointer;">
                        <td style="padding:8px;" class="ms-mono">${escapeHtml(n.id)}</td>
                        <td style="padding:8px;">${escapeHtml(n.poNumber || n.poId || '—')}</td>
                        <td style="padding:8px;">${escapeHtml(n.vendorName || '—')}</td>
                        <td style="padding:8px;"><span class="${statusChipClass(n.status)}">${escapeHtml(n.status)}</span></td>
                        <td style="padding:8px;">${escapeHtml(n.receivedAt ? String(n.receivedAt).slice(0, 16) : '—')}</td>
                        <td style="padding:8px;">${escapeHtml(n.acceptedQuantity == null ? '—' : String(n.acceptedQuantity))}</td>
                        <td style="padding:8px;"><span class="${projectionChip(n.projectionStatus)}">${escapeHtml(n.projectionStatus || '—')}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    host.querySelectorAll('.rn-row').forEach((row) => {
        row.addEventListener('click', () => openReceiptDetail(row.getAttribute('data-id')));
    });
}

async function openReceiptDetail(id) {
    const host = el('receiptsContent');
    if (!host) return;
    const data = await api(`/api/receipt-notes/${encodeURIComponent(id)}`);
    const note = data.receiptNote;
    const lines = data.lines || [];
    const outputs = data.outputs || [];
    const events = data.events || [];
    const mutate = canMutateReceipts();
    const isOpen = note.status === 'OPEN';
    const isPosted = note.status === 'POSTED';
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
            <div>
                <button type="button" class="action-button grey" id="btnReceiptBack">← Receipts</button>
                <h3 style="margin:8px 0 0;">Receive goods</h3>
                ${crumb([
                    { label: 'Purchase Order', view: 'purchase-orders-view', open: note.poId || note.poNumber || '' },
                    { label: 'Receipt' },
                    { label: 'Stock', view: 'home-view' }
                ])}
                <div class="lc-mono">${escapeHtml(note.id)}</div>
                <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
                    <span class="${statusChipClass(note.status)}">${escapeHtml(note.status)}</span>
                    <span class="${projectionChip(note.projectionStatus)}">Projection ${escapeHtml(note.projectionStatus || '—')}</span>
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                ${isOpen && mutate ? '<button type="button" class="action-button green" id="btnReceiptPost">Post receipt</button>' : ''}
                ${isOpen && mutate ? '<button type="button" class="action-button grey" id="btnReceiptCancel">Cancel</button>' : ''}
                ${isPosted && mutate && note.canReverse ? '<button type="button" class="action-button grey" id="btnReceiptReverse">Reverse</button>' : ''}
            </div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
            <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.04em;">PO</div>
            <div style="font-weight:700;margin-top:4px;">${escapeHtml(note.poNumber || note.poId)}</div>
            <div style="color:#667085;font-size:13px;">Vendor: ${escapeHtml(note.vendorName || '—')} · Location: ${escapeHtml(note.receivedAtLocation || '—')}</div>
            ${note.projectionSkipReason ? `<div style="margin-top:8px;font-size:12px;color:#92400e;">Zoho projection skipped: ${escapeHtml(note.projectionSkipReason)}. No GRN exists.</div>` : ''}
        </div>
        ${lines.map((line) => `
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
                <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.04em;">PO LINE ${escapeHtml(line.poLineId)}</div>
                <div style="font-weight:700;margin-top:4px;">${escapeHtml(line.itemDescriptionSnapshot || '—')}</div>
                <div style="margin-top:4px;font-size:13px;">Product: ${line.productId ? `<span class="ms-mono">${escapeHtml(line.productId)}</span>` : '<span style="color:#b91c1c;font-weight:700;">Product Required</span>'}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:10px;font-size:13px;">
                    <div>Ordered<br><strong>${escapeHtml(line.orderedQtySnapshot)}</strong></div>
                    <div>Already accepted<br><strong>${escapeHtml(line.acceptedToDate ?? '—')}</strong></div>
                    <div>Outstanding<br><strong>${escapeHtml(line.outstanding ?? '—')}</strong></div>
                    <div>Received<br><strong>${escapeHtml(line.qtyReceived)}</strong></div>
                    <div>Accepted<br><strong>${escapeHtml(line.qtyAccepted)}</strong></div>
                    <div>Rejected<br><strong>${escapeHtml(line.qtyRejected)}</strong></div>
                    <div>Damaged<br><strong>${escapeHtml(line.qtyDamaged)}</strong></div>
                    <div>Mode<br><strong>${escapeHtml(line.creationMode || '—')}</strong></div>
                </div>
                <div style="margin-top:8px;font-size:12px;color:#667085;">Received ${escapeHtml(line.qtyReceived)} = accepted ${escapeHtml(line.qtyAccepted)} + damaged ${escapeHtml(line.qtyDamaged)} + rejected ${escapeHtml(line.qtyRejected)}</div>
            </div>
        `).join('')}
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
            <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.04em;">PHYSICAL RECORDS</div>
            ${outputs.length ? `<ul style="margin:8px 0 0;padding-left:18px;">${outputs.map((o) => {
                const view = String(o.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
                const qr = String(o.resourceType).toUpperCase() === 'INVENTORY'
                    ? `/api/qr/dynamic/inventory/${encodeURIComponent(o.resourceId)}`
                    : `/api/qr/${encodeURIComponent(o.resourceId)}`;
                return `<li>${escapeHtml(o.resourceType)}
                    <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(o.resourceId)}">${escapeHtml(o.resourceId)}</button>
                    × ${escapeHtml(o.quantity)}
                    · <a href="${qr}" target="_blank" rel="noopener">QR</a></li>`;
            }).join('')}</ul>` : '<p style="color:#667085;margin:8px 0 0;">None until POST.</p>'}
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;">
            <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.04em;">HISTORY</div>
            <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;">
                ${events.map((ev) => `<li>${escapeHtml(ev.type)} · ${escapeHtml(ev.actor || '—')} · ${escapeHtml(ev.timestamp ? String(ev.timestamp).slice(0, 19) : '')}</li>`).join('')}
            </ul>
        </div>`;
    el('btnReceiptBack')?.addEventListener('click', () => renderReceiptList().catch((err) => showToast(err.message, 'error')));
    el('btnReceiptPost')?.addEventListener('click', () => confirmAndPost(note, lines));
    el('btnReceiptCancel')?.addEventListener('click', async () => {
        if (!confirm('Cancel this OPEN Receipt Note? No physical stock will be created.')) return;
        try {
            await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-cancel') }, body: '{}' });
            showToast('Receipt cancelled', 'success');
            await openReceiptDetail(note.id);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    el('btnReceiptReverse')?.addEventListener('click', async () => {
        if (!confirm('Reverse this posted Receipt Note?\nPhysical identities are preserved. Quantity will be adjusted to zero if still reversible.')) return;
        try {
            await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-rev') }, body: '{}' });
            showToast('Receipt reversed. Physical IDs preserved.', 'success');
            await openReceiptDetail(note.id);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function previewHtml(note, lines) {
    return lines.map((line) => {
        const accepted = num(line.qtyAccepted);
        const mode = line.creationMode || '—';
        let physical = 'No physical stock (accepted = 0)';
        if (accepted > 0 && mode === 'INVENTORY') physical = `Inventory ×${accepted} (1 QR)`;
        else if (accepted > 0 && mode === 'ASSET_GROUPED') physical = `Grouped Asset ×${accepted} (1 QR)`;
        else if (accepted > 0 && mode === 'ASSET_INDIVIDUAL') physical = `Individual Assets ×${accepted} (${accepted} QR)`;
        return `${escapeHtml(line.itemDescriptionSnapshot || line.poLineId)}
Ordered ${escapeHtml(line.orderedQtySnapshot)} · Previously accepted ${escapeHtml(line.acceptedToDate ?? '—')}
This receipt: received ${escapeHtml(line.qtyReceived)} accepted ${escapeHtml(line.qtyAccepted)} damaged ${escapeHtml(line.qtyDamaged)} rejected ${escapeHtml(line.qtyRejected)}
Physical: ${physical}`;
    }).join('\n\n');
}

async function confirmAndPost(note, lines) {
    const missing = lines.filter((line) => num(line.qtyReceived) > 0 && !line.productId);
    if (missing.length) {
        showToast('Product Required on every received line before POST. Use the Product catalogue to create/link a Product first.', 'error');
        return;
    }
    const acceptedTotal = lines.reduce((s, line) => s + num(line.qtyAccepted), 0);
    const damagedTotal = lines.reduce((s, line) => s + num(line.qtyDamaged), 0);
    const rejectedTotal = lines.reduce((s, line) => s + num(line.qtyRejected), 0);
    const text = previewHtml(note, lines);
    if (!confirm(`Posting this Receipt Note will create the accepted physical stock.\n\nAccepted: ${acceptedTotal}\nDamaged: ${damagedTotal}\nRejected: ${rejectedTotal}\n\n${text}`)) return;
    try {
        const data = await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-post') },
            body: '{}'
        });
        showToast(`Posted ${data.receiptNote?.id || note.id}`, 'success');
        await openReceiptDetail(note.id);
    } catch (err) {
        toastOperatorError(err);
    }
}

function lineFormHtml(line, index) {
    const productMissing = !line.productId;
    return `
        <div class="rn-line-card" data-index="${index}" data-po-line-id="${escapeHtml(line.poLineId)}" style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
            <div style="font-size:11px;font-weight:700;color:#667085;">PO LINE</div>
            <div style="font-weight:700;margin-top:4px;">${escapeHtml(line.description || '—')}</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0;font-size:13px;">
                <div>Ordered<br><strong>${escapeHtml(line.ordered)}</strong></div>
                <div>Previously accepted<br><strong>${escapeHtml(line.acceptedToDate)}</strong></div>
                <div>Outstanding<br><strong>${escapeHtml(line.outstanding)}</strong></div>
            </div>
            <div style="margin:8px 0;">
                <label style="font-size:12px;font-weight:700;">Product${productMissing ? ' <span style="color:#b91c1c;">Required</span>' : ''}</label>
                <input type="text" class="rn-product-search" placeholder="Search Product ID or name..." style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-top:4px;">
                <input type="hidden" class="rn-product-id" value="${escapeHtml(line.productId || '')}">
                <div class="rn-product-hits" style="margin-top:4px;"></div>
                <div class="rn-product-chosen ms-mono" style="margin-top:4px;font-size:12px;color:#047857;">${escapeHtml(line.productId || '')}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                <label>Received<input type="number" min="0" step="1" class="rn-received" value="0" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
                <label>Accepted<input type="number" min="0" step="1" class="rn-accepted" value="0" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
                <label>Rejected<input type="number" min="0" step="1" class="rn-rejected" value="0" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
                <label>Damaged<input type="number" min="0" step="1" class="rn-damaged" value="0" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
            </div>
            <div class="rn-eq-msg" style="font-size:12px;margin-top:6px;color:#667085;"></div>
            <div style="margin-top:10px;">
                <div style="font-size:12px;font-weight:700;margin-bottom:4px;">Create as</div>
                <label style="margin-right:12px;"><input type="radio" name="rn-mode-${index}" class="rn-mode" value="INVENTORY" checked> Inventory</label>
                <label style="margin-right:12px;"><input type="radio" name="rn-mode-${index}" class="rn-mode" value="ASSET_GROUPED"> Grouped Asset</label>
                <label><input type="radio" name="rn-mode-${index}" class="rn-mode" value="ASSET_INDIVIDUAL"> Individual Assets</label>
            </div>
        </div>`;
}

function bindLineCard(card, poLine) {
    const received = card.querySelector('.rn-received');
    const accepted = card.querySelector('.rn-accepted');
    const rejected = card.querySelector('.rn-rejected');
    const damaged = card.querySelector('.rn-damaged');
    const msg = card.querySelector('.rn-eq-msg');
    const recast = () => {
        const r = num(received.value);
        const a = num(accepted.value);
        const j = num(rejected.value);
        const d = num(damaged.value);
        const sum = a + j + d;
        received.value = String(sum);
        if (a > num(poLine.outstanding)) {
            msg.style.color = '#b91c1c';
            msg.textContent = `That quantity exceeds the remaining PO quantity (${poLine.outstanding}).`;
        } else if (Math.abs(r - sum) > 1e-9) {
            msg.style.color = '#b91c1c';
            msg.textContent = 'Received must equal accepted + rejected + damaged.';
        } else {
            msg.style.color = '#667085';
            msg.textContent = `Received ${sum} = accepted ${a} + rejected ${j} + damaged ${d}. Outstanding after this line if posted: ${Math.max(0, num(poLine.outstanding) - a)}.`;
        }
    };
    [accepted, rejected, damaged].forEach((input) => input.addEventListener('input', recast));
    received.addEventListener('input', () => {
        accepted.value = received.value;
        rejected.value = '0';
        damaged.value = '0';
        recast();
    });
    recast();
    const search = card.querySelector('.rn-product-search');
    const hits = card.querySelector('.rn-product-hits');
    const hidden = card.querySelector('.rn-product-id');
    const chosen = card.querySelector('.rn-product-chosen');
    let timer = null;
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = search.value.trim();
            if (!q) { hits.innerHTML = ''; return; }
            try {
                const data = await api(`/api/products?q=${encodeURIComponent(q)}&status=ACTIVE&limit=8`);
                productHits = data.products || [];
                hits.innerHTML = productHits.map((p) => `<button type="button" class="action-button grey rn-pick-product" data-id="${escapeHtml(p.id)}" style="margin:2px 4px 2px 0;">${escapeHtml(p.id)} · ${escapeHtml(p.name)}</button>`).join('')
                    || '<span style="color:#667085;font-size:12px;">No Products. Create one in Products before posting.</span>';
                hits.querySelectorAll('.rn-pick-product').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        hidden.value = btn.getAttribute('data-id');
                        chosen.textContent = btn.getAttribute('data-id');
                    });
                });
            } catch (err) {
                hits.innerHTML = `<span style="color:#b91c1c;">${escapeHtml(err.message)}</span>`;
            }
        }, 250);
    });
}

function collectLinesFromForm() {
    return Array.from(document.querySelectorAll('.rn-line-card')).map((card) => ({
        poLineId: card.getAttribute('data-po-line-id'),
        productId: card.querySelector('.rn-product-id').value || null,
        qtyReceived: num(card.querySelector('.rn-received').value),
        qtyAccepted: num(card.querySelector('.rn-accepted').value),
        qtyRejected: num(card.querySelector('.rn-rejected').value),
        qtyDamaged: num(card.querySelector('.rn-damaged').value),
        creationMode: card.querySelector('.rn-mode:checked')?.value || 'INVENTORY'
    })).filter((line) => line.qtyReceived > 0);
}

async function renderCreateForm() {
    const host = el('receiptsContent');
    if (!host) return;
    if (!canMutateReceipts()) {
        showToast('Sales cannot create Receipt Notes', 'error');
        return;
    }
    const orders = await api('/api/procurement/pos?limit=200');
    const list = orders.purchaseOrders || [];
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnReceiptBackCreate">← Receipts</button>
            <h3 style="margin:0;">Create Receipt Note</h3>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
            <label style="font-size:12px;font-weight:700;">Purchase Order</label>
            <select id="rnPoSelect" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-top:4px;">
                <option value="">Select a PO…</option>
                ${list.map((o) => `<option value="${escapeHtml(o.id)}" data-po-source="${escapeHtml(o.source || 'LOCAL')}">${escapeHtml(o.poNumber || o.id)}${o.source === 'ZOHO' ? ' · Zoho' : ' · Legacy'}${o.status ? ` · ${escapeHtml(o.status)}` : ''}</option>`).join('')}
            </select>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;">
                <label>Vendor invoice<input id="rnVendorInvoice" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
                <label>Delivery note<input id="rnDeliveryNote" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
                <label>Location<input id="rnLocation" placeholder="Mumbai" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;"></label>
            </div>
        </div>
        <div id="rnPoLines"></div>
        <div id="rnPreview" style="border:1px dashed #cbd5e1;border-radius:8px;padding:14px;margin-bottom:12px;white-space:pre-wrap;font-size:13px;color:#334155;"></div>
        <button type="button" class="action-button green" id="btnReceiptCreatePost">Create OPEN receipt</button>`;
    el('btnReceiptBackCreate')?.addEventListener('click', () => renderReceiptList().catch((err) => showToast(err.message, 'error')));
    el('rnPoSelect')?.addEventListener('change', async () => {
        const poId = el('rnPoSelect').value;
        selectedPoBalance = null;
        const box = el('rnPoLines');
        if (!poId) { box.innerHTML = ''; return; }
        try {
            selectedPoBalance = await api(`/api/purchase-orders/${encodeURIComponent(poId)}/receipt-balance`);
            box.innerHTML = (selectedPoBalance.lines || []).map((line, i) => lineFormHtml(line, i)).join('');
            box.querySelectorAll('.rn-line-card').forEach((card, i) => bindLineCard(card, selectedPoBalance.lines[i]));
            updateCreatePreview();
            box.addEventListener('input', updateCreatePreview);
            box.addEventListener('change', updateCreatePreview);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    el('btnReceiptCreatePost')?.addEventListener('click', submitCreate);
}

function updateCreatePreview() {
    const preview = el('rnPreview');
    if (!preview || !selectedPoBalance) return;
    const lines = collectLinesFromForm();
    if (!lines.length) {
        preview.textContent = 'Enter this-receipt quantities to preview physical creation.';
        return;
    }
    preview.textContent = lines.map((line) => {
        const poLine = selectedPoBalance.lines.find((l) => String(l.poLineId) === String(line.poLineId));
        let physical = 'No physical stock';
        if (line.qtyAccepted > 0 && line.creationMode === 'INVENTORY') physical = `Inventory ×${line.qtyAccepted}`;
        if (line.qtyAccepted > 0 && line.creationMode === 'ASSET_GROUPED') physical = `Grouped Asset ×${line.qtyAccepted}`;
        if (line.qtyAccepted > 0 && line.creationMode === 'ASSET_INDIVIDUAL') physical = `Individual Assets ×${line.qtyAccepted}`;
        return `${poLine?.description || line.poLineId}
Ordered ${poLine?.ordered} · Previously accepted ${poLine?.acceptedToDate} · Outstanding ${poLine?.outstanding}
This receipt: received ${line.qtyReceived} accepted ${line.qtyAccepted} damaged ${line.qtyDamaged} rejected ${line.qtyRejected}
${line.productId ? `Product ${line.productId}` : 'Product Required'}
Physical: ${physical}`;
    }).join('\n\n');
}

async function submitCreate() {
    const poId = el('rnPoSelect')?.value;
    if (!poId) { showToast('Select a PO', 'error'); return; }
    const lines = collectLinesFromForm();
    if (!lines.length) { showToast('Enter received quantity on at least one line', 'error'); return; }
    const over = lines.find((line) => {
        const poLine = selectedPoBalance?.lines.find((l) => String(l.poLineId) === String(line.poLineId));
        return poLine && line.qtyAccepted > num(poLine.outstanding);
    });
    if (over) {
        showToast('Over-receipt is rejected. Reduce accepted quantity.', 'error');
        return;
    }
    const missingProduct = lines.find((line) => !line.productId);
    if (missingProduct) {
        showToast('Product Required. Link an AssetEngine Product before recording the receipt. Receiving will not create a Product.', 'error');
        return;
    }
    try {
        const created = await api('/api/receipt-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-create') },
            body: JSON.stringify({
                poId,
                poSource: el('rnPoSelect')?.selectedOptions?.[0]?.getAttribute('data-po-source') || 'LOCAL',
                vendorInvoiceNo: el('rnVendorInvoice')?.value || null,
                deliveryNoteNo: el('rnDeliveryNote')?.value || null,
                receivedAtLocation: el('rnLocation')?.value || null,
                lines
            })
        });
        showToast(`OPEN ${created.receiptNote?.id}`, 'success');
        const previewLines = created.lines || [];
        const text = previewHtml(created.receiptNote, previewLines);
        if (confirm(`POST RECEIPT now?\n\n${text}`)) {
            await api(`/api/receipt-notes/${encodeURIComponent(created.receiptNote.id)}/post`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-post') },
                body: '{}'
            });
            showToast('Receipt posted', 'success');
        }
        await openReceiptDetail(created.receiptNote.id);
    } catch (err) {
        toastOperatorError(err);
    }
}

export function initReceiptsView() {
    if (el('btnCreateReceipt')) {
        el('btnCreateReceipt').style.display = canMutateReceipts() ? '' : 'none';
    }
    const pending = consumeOpen('receipts-view');
    const start = async () => {
        if (pending && pending.open) {
            await openReceiptDetail(pending.open);
            return;
        }
        await renderReceiptList();
    };
    if (viewListenersBound) {
        start().catch((err) => toastOperatorError(err));
        return;
    }
    viewListenersBound = true;
    el('btnReloadReceipts')?.addEventListener('click', () => renderReceiptList().catch((e) => toastOperatorError(e)));
    el('btnCreateReceipt')?.addEventListener('click', () => renderCreateForm().catch((e) => toastOperatorError(e)));
    el('receiptSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderReceiptList().catch((err) => toastOperatorError(err));
    });
    el('receiptStatusFilter')?.addEventListener('change', () => renderReceiptList().catch((err) => toastOperatorError(err)));
    start().catch((err) => toastOperatorError(err));
}

window.initReceiptsView = initReceiptsView;
window.openReceiptDetail = openReceiptDetail;

