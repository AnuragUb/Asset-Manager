import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.61';
import {
    canLogistics,
    escapeHtml,
    dash,
    emptyState,
    consumeOpen,
    toastOperatorError,
    formatQty,
    formatIstDate,
    formatIstDateTime
} from './lifecycle.js?v=7.33';

function el(id) {
    return document.getElementById(id);
}

function canManageBooks() {
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
    const cls = s === 'POSTED' ? 'pb-chip pb-chip-posted'
        : s === 'VOID' ? 'pb-chip pb-chip-void'
        : s === 'DRAFT' ? 'pb-chip pb-chip-draft'
        : 'pb-chip';
    return `<span class="${cls}">${escapeHtml(s || '—')}</span>`;
}

function kindChip(kind) {
    const k = String(kind || 'INVOICE').toUpperCase();
    return `<span class="pb-chip pb-chip-kind">${escapeHtml(k === 'CREDIT' ? 'Credit' : 'Invoice')}</span>`;
}

let viewListenersBound = false;
let selectedId = null;

function closeAllPhysPickers() {
    document.querySelectorAll('.pb-phys-picker-host').forEach((host) => {
        host.hidden = true;
        host.innerHTML = '';
    });
}

/**
 * Flatten holdings into selectable serial options (preferred) or whole-holding fallbacks.
 * Already-allocated (resourceId + serialSortOrder) pairs on this line are excluded.
 */
function buildSerialOptions(holdings, existingPhysicals = []) {
    const taken = new Set(
        (existingPhysicals || []).map((p) =>
            `${p.resourceType}|${p.resourceId}|${p.serialSortOrder == null ? '' : p.serialSortOrder}`
        )
    );
    const options = [];
    for (const h of holdings || []) {
        const serials = Array.isArray(h.serials) ? h.serials : [];
        if (serials.length) {
            for (const s of serials) {
                const key = `${h.resourceType}|${h.resourceId}|${s.sortOrder}`;
                if (taken.has(key)) continue;
                options.push({
                    key,
                    resourceType: h.resourceType,
                    resourceId: h.resourceId,
                    holdingLabel: h.label || h.resourceId,
                    serialSortOrder: s.sortOrder,
                    serialValue: s.serialValue,
                    searchText: `${s.serialValue} ${h.resourceId} ${h.label || ''} ${h.resourceType}`.toLowerCase()
                });
            }
        } else {
            const key = `${h.resourceType}|${h.resourceId}|`;
            if (taken.has(key)) continue;
            options.push({
                key,
                resourceType: h.resourceType,
                resourceId: h.resourceId,
                holdingLabel: h.label || h.resourceId,
                serialSortOrder: null,
                serialValue: null,
                searchText: `${h.resourceId} ${h.label || ''} ${h.resourceType} whole`.toLowerCase()
            });
        }
    }
    return options;
}

function renderPhysOptionList(listEl, options, filterText, onPick) {
    const q = String(filterText || '').trim().toLowerCase();
    const filtered = q
        ? options.filter((o) => o.searchText.includes(q))
        : options;
    if (!filtered.length) {
        listEl.innerHTML = `<li class="pb-phys-empty">${q ? 'No matching serials' : 'No available serials for this product'}</li>`;
        return;
    }
    listEl.innerHTML = filtered.map((o) => `
        <li>
            <button type="button" class="pb-phys-option" data-key="${escapeHtml(o.key)}">
                <span class="pb-phys-option-sn">${o.serialValue != null
                    ? escapeHtml(o.serialValue)
                    : `Whole holding · ${escapeHtml(o.resourceId)}`}</span>
                <span class="pb-phys-option-meta">${escapeHtml(o.resourceType)} · ${escapeHtml(o.resourceId)}${o.holdingLabel ? ` · ${escapeHtml(o.holdingLabel)}` : ''}${o.serialSortOrder != null ? ` · #${escapeHtml(o.serialSortOrder)}` : ''}</span>
            </button>
        </li>
    `).join('');
    listEl.querySelectorAll('.pb-phys-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const opt = options.find((o) => o.key === btn.getAttribute('data-key'));
            if (opt) onPick(opt);
        });
    });
}

async function openPhysAllocatePicker({ lineEl, lineId, productId, bookId, existingPhysicals }) {
    const host = lineEl.querySelector('.pb-phys-picker-host');
    if (!host) return;
    closeAllPhysPickers();
    host.hidden = false;
    host.innerHTML = `<div class="pb-phys-picker"><div class="pb-muted" style="font-size:12px;">Loading serials…</div></div>`;

    try {
        const data = await api(`/api/purchase-books/holdings-for-product/${encodeURIComponent(productId)}`);
        const options = buildSerialOptions(data.holdings || [], existingPhysicals);
        host.innerHTML = `
            <div class="pb-phys-picker">
                <label class="pb-phys-picker-label" for="pbPhysSearch_${escapeHtml(lineId)}">Search available serial numbers</label>
                <input type="search" class="pb-phys-search form-input" id="pbPhysSearch_${escapeHtml(lineId)}" placeholder="Type to filter serial / asset id…" autocomplete="off">
                <ul class="pb-phys-options" role="listbox"></ul>
                <div class="pb-phys-picker-actions">
                    <button type="button" class="action-button grey pb-phys-cancel" style="padding:4px 10px;font-size:11px;">Cancel</button>
                </div>
            </div>`;
        const search = host.querySelector('.pb-phys-search');
        const list = host.querySelector('.pb-phys-options');
        const paint = () => renderPhysOptionList(list, options, search.value, async (opt) => {
            try {
                await api('/api/purchase-books/physical', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        purchaseBookLineId: lineId,
                        resourceType: opt.resourceType,
                        resourceId: opt.resourceId,
                        serialSortOrder: opt.serialSortOrder,
                        qtyAllocated: 1
                    })
                });
                showToast(opt.serialValue ? `Allocated ${opt.serialValue}` : 'Allocated holding', 'success');
                await renderBookDetail(bookId);
            } catch (err) {
                toastOperatorError(err);
            }
        });
        paint();
        search.addEventListener('input', paint);
        search.focus();
        host.querySelector('.pb-phys-cancel')?.addEventListener('click', () => closeAllPhysPickers());
    } catch (err) {
        closeAllPhysPickers();
        toastOperatorError(err);
    }
}


async function renderBookList() {
    const host = el('purchaseBooksContent');
    if (!host) return;
    const q = el('pbSearch')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', '200');
    const data = await api(`/api/purchase-books?${params.toString()}`);
    const rows = data.purchaseBooks || [];
    if (el('pbCountBadge')) el('pbCountBadge').textContent = String(rows.length);
    if (!rows.length) {
        host.innerHTML = emptyState({
            title: 'No Purchase Books',
            body: 'Create one from a PO to book a vendor Tax Invoice.',
            actionLabel: canManageBooks() ? 'Create from PO' : '',
            actionView: 'purchase-books-view',
            actionAttr: 'id="btnEmptyCreatePb"'
        });
        host.querySelector('#btnEmptyCreatePb')?.addEventListener('click', (e) => {
            e.preventDefault();
            renderCreateForm().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        <table class="pb-table">
            <thead>
                <tr>
                    <th>Invoice</th>
                    <th>PO</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th class="pb-num">Created</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((b) => `
                    <tr class="pb-row" data-id="${escapeHtml(b.id)}">
                        <td>
                            <div class="pb-primary">${dash(b.vendorInvoiceNo)}</div>
                            <div class="pb-mono">${escapeHtml(b.id)}</div>
                        </td>
                        <td>
                            <div class="pb-primary">${dash(b.poNumber || b.procurementPoId)}</div>
                            <div class="pb-muted">${escapeHtml(b.vendorName || '')}</div>
                        </td>
                        <td>${kindChip(b.documentKind)}</td>
                        <td>${statusChip(b.status)}</td>
                        <td>${formatIstDate(b.invoiceDate)}</td>
                        <td class="pb-num pb-muted">${formatIstDateTime(b.createdAt)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    host.querySelectorAll('.pb-row').forEach((row) => {
        row.addEventListener('click', () => {
            selectedId = row.getAttribute('data-id');
            renderBookDetail(selectedId).catch((err) => toastOperatorError(err));
        });
    });
}

async function renderCreateForm(presetPoId) {
    const host = el('purchaseBooksContent');
    if (!host) return;
    const poList = await api('/api/procurement/pos?limit=200');
    const pos = (poList.purchaseOrders || []).filter((p) => String(p.source || '').toUpperCase() !== 'LOCAL');
    host.innerHTML = `
        <div class="pb-bar">
            <button type="button" class="action-button grey" id="btnPbBack">← Back</button>
            <strong>New book</strong>
            <span class="pb-spacer"></span>
            <button type="button" class="action-button green" id="btnPbCreateSave" ${canManageBooks() ? '' : 'disabled'}>Create draft</button>
        </div>
        <div class="pb-meta-row">
            <label>PO
                <select id="pbPoSelect" class="form-input">
                    <option value="">Select…</option>
                    ${pos.map((p) => `<option value="${escapeHtml(p.id)}" ${presetPoId === p.id ? 'selected' : ''}>${escapeHtml(p.poNumber || p.id)}${p.vendorName ? ` — ${escapeHtml(p.vendorName)}` : ''}</option>`).join('')}
                </select>
            </label>
            <label>Kind
                <select id="pbDocKind" class="form-input">
                    <option value="INVOICE">Invoice</option>
                    <option value="CREDIT">Credit</option>
                </select>
            </label>
            <label>Invoice #
                <input id="pbVendorInvoice" class="form-input" placeholder="Vendor invoice no">
            </label>
            <label>Date
                <input id="pbInvoiceDate" type="date" class="form-input">
            </label>
            <label class="pb-notes-field">Notes
                <input id="pbNotes" class="form-input" placeholder="Optional">
            </label>
        </div>
        <div id="pbCapacityHost" class="pb-cap-host"><span class="pb-muted">Select a PO</span></div>`;
    el('btnPbBack')?.addEventListener('click', () => renderBookList().catch((e) => showToast(e.message, 'error')));
    el('pbPoSelect')?.addEventListener('change', () => loadCapacityEditor().catch((e) => toastOperatorError(e)));
    el('btnPbCreateSave')?.addEventListener('click', () => createBookFromForm().catch((e) => toastOperatorError(e)));
    if (presetPoId) await loadCapacityEditor();
}

async function loadCapacityEditor() {
    const poId = el('pbPoSelect')?.value;
    const host = el('pbCapacityHost');
    if (!host) return;
    if (!poId) {
        host.innerHTML = '<span class="pb-muted">Select a PO</span>';
        return;
    }
    const data = await api(`/api/purchase-books/po-capacity/${encodeURIComponent(poId)}`);
    const lines = data.lines || [];
    if (!lines.length) {
        host.innerHTML = '<span class="pb-muted">No PO lines</span>';
        return;
    }
    host.innerHTML = `
        <table class="pb-table pb-table-edit">
            <thead>
                <tr>
                    <th class="pb-check"></th>
                    <th>Product / display</th>
                    <th class="pb-num">Ord</th>
                    <th class="pb-num">Booked</th>
                    <th class="pb-num">Left</th>
                    <th class="pb-num">Qty</th>
                    <th class="pb-num">Price</th>
                </tr>
            </thead>
            <tbody>
                ${lines.map((line) => {
                    const can = !line.mappingRequired && Number(line.remainingQty) > 0;
                    const name = line.zohoProductName || line.description || line.productId || '';
                    return `
                    <tr class="pb-cap-row${line.mappingRequired ? ' is-blocked' : ''}" data-po-line-id="${escapeHtml(line.poLineId)}">
                        <td class="pb-check"><input type="checkbox" class="pb-include" ${can ? 'checked' : 'disabled'}></td>
                        <td>
                            ${line.mappingRequired
                                ? '<span class="pb-warn">Map Product</span>'
                                : `<span class="pb-mono">${escapeHtml(line.productId || '')}</span>`}
                            <input type="text" class="pb-display-name form-input" value="${escapeHtml(name)}" placeholder="Display name" ${line.mappingRequired ? 'disabled' : ''}>
                            <input type="text" class="pb-display-desc form-input pb-desc" value="${escapeHtml(line.description || '')}" placeholder="Display description" ${line.mappingRequired ? 'disabled' : ''}>
                        </td>
                        <td class="pb-num">${escapeHtml(formatQty(line.orderedQty))}</td>
                        <td class="pb-num">${escapeHtml(formatQty(line.bookedQty))}</td>
                        <td class="pb-num">${escapeHtml(formatQty(line.remainingQty))}</td>
                        <td class="pb-num"><input type="number" min="0" step="any" class="pb-qty form-input" value="${can ? escapeHtml(line.remainingQty) : '0'}" ${line.mappingRequired ? 'disabled' : ''}></td>
                        <td class="pb-num"><input type="number" step="any" class="pb-unit-price form-input" value="${line.listPrice == null ? '' : escapeHtml(line.listPrice)}" ${line.mappingRequired ? 'disabled' : ''}></td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    host.querySelectorAll('.pb-qty').forEach((input) => {
        input.addEventListener('input', () => {
            const row = input.closest('.pb-cap-row');
            const box = row?.querySelector('.pb-include');
            if (box && !box.disabled) box.checked = Number(input.value) > 0;
        });
    });
}

function collectCreateLines() {
    return Array.from(document.querySelectorAll('#pbCapacityHost .pb-cap-row'))
        .filter((row) => row.querySelector('.pb-include')?.checked)
        .map((row) => ({
            poLineId: row.getAttribute('data-po-line-id'),
            qtyBooked: Number(row.querySelector('.pb-qty')?.value || 0),
            displayName: row.querySelector('.pb-display-name')?.value || null,
            displayDescription: row.querySelector('.pb-display-desc')?.value || null,
            unitPrice: row.querySelector('.pb-unit-price')?.value === ''
                ? null
                : Number(row.querySelector('.pb-unit-price')?.value)
        }));
}

async function createBookFromForm() {
    const poId = el('pbPoSelect')?.value;
    if (!poId) {
        showToast('Select a Purchase Order', 'error');
        return;
    }
    const lines = collectCreateLines().filter((l) => l.qtyBooked > 0);
    if (!lines.length) {
        showToast('Include at least one line with qty', 'error');
        return;
    }
    const data = await api('/api/purchase-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            procurementPoId: poId,
            documentKind: el('pbDocKind')?.value || 'INVOICE',
            vendorInvoiceNo: el('pbVendorInvoice')?.value || null,
            invoiceDate: el('pbInvoiceDate')?.value || null,
            notes: el('pbNotes')?.value || null,
            lines
        })
    });
    showToast('Draft created', 'success');
    selectedId = data.purchaseBook?.id;
    await renderBookDetail(selectedId);
}

async function renderBookDetail(id) {
    const host = el('purchaseBooksContent');
    if (!host) return;
    const data = await api(`/api/purchase-books/${encodeURIComponent(id)}`);
    const book = data.purchaseBook;
    const lines = data.lines || [];
    const mutate = canManageBooks();
    const isDraft = book.status === 'DRAFT';
    host.innerHTML = `
        <div class="pb-bar">
            <button type="button" class="action-button grey" id="btnPbBack">← Back</button>
            <span class="pb-mono">${escapeHtml(book.id)}</span>
            ${statusChip(book.status)}
            ${kindChip(book.documentKind)}
            <span class="pb-spacer"></span>
            ${isDraft && mutate ? '<button type="button" class="action-button blue" id="btnPbSave">Save</button>' : ''}
            ${isDraft && mutate ? '<button type="button" class="action-button green" id="btnPbPost">Post</button>' : ''}
            ${book.status !== 'VOID' && mutate ? '<button type="button" class="action-button grey" id="btnPbVoid">Void</button>' : ''}
            <button type="button" class="action-button grey" id="btnPbOpenPo">PO</button>
        </div>
        <div class="pb-meta-row pb-meta-detail">
            <label>PO
                <div class="pb-readonly">${dash(book.poNumber || book.procurementPoId)}</div>
            </label>
            <label>Vendor
                <div class="pb-readonly">${dash(book.vendorName)}</div>
            </label>
            <label>Invoice #
                ${isDraft && mutate
                    ? `<input id="pbEditInvoice" class="form-input" value="${escapeHtml(book.vendorInvoiceNo || '')}">`
                    : `<div class="pb-readonly">${dash(book.vendorInvoiceNo)}</div>`}
            </label>
            <label>Date
                ${isDraft && mutate
                    ? `<input id="pbEditDate" type="date" class="form-input" value="${escapeHtml((book.invoiceDate || '').slice(0, 10))}">`
                    : `<div class="pb-readonly">${formatIstDate(book.invoiceDate)}</div>`}
            </label>
            <label class="pb-notes-field">Notes
                ${isDraft && mutate
                    ? `<input id="pbEditNotes" class="form-input" value="${escapeHtml(book.notes || '')}">`
                    : `<div class="pb-readonly">${dash(book.notes)}</div>`}
            </label>
        </div>
        <table class="pb-table pb-table-edit">
            <thead>
                <tr>
                    <th>Product</th>
                    <th>Display</th>
                    <th class="pb-num">Qty</th>
                    <th class="pb-num">Price</th>
                    <th class="pb-num">Total</th>
                </tr>
            </thead>
            <tbody>
                ${lines.map((line) => `
                    <tr class="pb-edit-line" data-po-line-id="${escapeHtml(line.procurementPoLineId)}">
                        <td>
                            <span class="pb-mono">${escapeHtml(line.productId)}</span>
                            <div class="pb-muted">${escapeHtml(line.productName || '')}</div>
                        </td>
                        <td>
                            ${isDraft && mutate
                                ? `<input class="pb-line-name form-input" value="${escapeHtml(line.displayName || '')}">
                                   <input class="pb-line-desc form-input pb-desc" value="${escapeHtml(line.displayDescription || '')}">`
                                : `<div class="pb-primary">${escapeHtml(line.displayName || '—')}</div>
                                   <div class="pb-muted">${escapeHtml(line.displayDescription || '')}</div>`}
                        </td>
                        <td class="pb-num">${isDraft && mutate
                            ? `<input type="number" min="0" step="any" class="pb-line-qty form-input" value="${escapeHtml(line.qtyBooked)}">`
                            : escapeHtml(formatQty(line.qtyBooked))}</td>
                        <td class="pb-num">${isDraft && mutate
                            ? `<input type="number" step="any" class="pb-line-price form-input" value="${line.unitPrice == null ? '' : escapeHtml(line.unitPrice)}">`
                            : dash(line.unitPrice)}</td>
                        <td class="pb-num">${dash(line.lineTotal)}</td>
                    </tr>
                `).join('') || '<tr><td colspan="5" class="pb-muted">No lines</td></tr>'}
            </tbody>
        </table>
        <div class="pb-physical-section" style="margin-top:18px;">
            <h3 style="margin:0 0 8px;font-size:14px;">Physical allocation</h3>
            <p class="pb-muted" style="margin:0 0 12px;font-size:12px;">Pick available serial numbers for each book line. DC ships those linked serials.</p>
            ${lines.map((line) => {
                const phys = line.physicals || [];
                return `
                <div class="pb-phys-line" data-line-id="${escapeHtml(line.id)}" data-product-id="${escapeHtml(line.productId || '')}" style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:10px;background:#f8fafc;">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:8px;">
                        <div>
                            <strong>${escapeHtml(line.displayName || line.productName || line.productId || 'Line')}</strong>
                            <span class="pb-muted" style="font-size:11px;margin-left:6px;">${escapeHtml(line.id)}</span>
                        </div>
                        ${book.status !== 'VOID' && mutate
                            ? `<button type="button" class="action-button blue pb-phys-add" style="padding:4px 8px;font-size:11px;" data-line-id="${escapeHtml(line.id)}" data-product-id="${escapeHtml(line.productId || '')}">Allocate…</button>`
                            : ''}
                    </div>
                    ${phys.length
                        ? `<ul style="margin:0;padding-left:18px;font-size:12px;">${phys.map((p) => `
                            <li style="margin-bottom:4px;">
                                <span class="pb-mono">${escapeHtml(p.resourceId)}</span>
                                ${p.serialValue != null ? ` · SN <strong>${escapeHtml(p.serialValue)}</strong> (#${escapeHtml(p.serialSortOrder)})` : ' · whole holding'}
                                ${book.status !== 'VOID' && mutate
                                    ? ` <button type="button" class="action-button grey pb-phys-release" style="padding:1px 6px;font-size:10px;" data-phys-id="${escapeHtml(p.id)}">Release</button>`
                                    : ''}
                            </li>`).join('')}</ul>`
                        : '<div class="pb-muted" style="font-size:12px;">No serials linked yet.</div>'}
                    <div class="pb-phys-picker-host" hidden></div>
                </div>`;
            }).join('') || '<div class="pb-muted">No lines</div>'}
        </div>`;

    el('btnPbBack')?.addEventListener('click', () => renderBookList().catch((e) => showToast(e.message, 'error')));
    el('btnPbOpenPo')?.addEventListener('click', () => {
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('purchase-orders-view', { open: book.procurementPoId });
        }
    });
    el('btnPbSave')?.addEventListener('click', async () => {
        try {
            const lineRows = Array.from(document.querySelectorAll('.pb-edit-line')).map((row) => ({
                poLineId: row.getAttribute('data-po-line-id'),
                qtyBooked: Number(row.querySelector('.pb-line-qty')?.value || 0),
                displayName: row.querySelector('.pb-line-name')?.value || null,
                displayDescription: row.querySelector('.pb-line-desc')?.value || null,
                unitPrice: row.querySelector('.pb-line-price')?.value === ''
                    ? null
                    : Number(row.querySelector('.pb-line-price')?.value)
            })).filter((l) => l.qtyBooked > 0);
            await api(`/api/purchase-books/${encodeURIComponent(book.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorInvoiceNo: el('pbEditInvoice')?.value || null,
                    invoiceDate: el('pbEditDate')?.value || null,
                    notes: el('pbEditNotes')?.value || null,
                    lines: lineRows
                })
            });
            showToast('Saved', 'success');
            await renderBookDetail(book.id);
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnPbPost')?.addEventListener('click', async () => {
        if (!window.confirm('Post this book?')) return;
        try {
            await api(`/api/purchase-books/${encodeURIComponent(book.id)}/post`, { method: 'POST' });
            showToast('Posted', 'success');
            await renderBookDetail(book.id);
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnPbVoid')?.addEventListener('click', async () => {
        const reason = window.prompt('Void reason (optional)');
        if (reason === null) return;
        try {
            await api(`/api/purchase-books/${encodeURIComponent(book.id)}/void`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            showToast('Voided', 'success');
            await renderBookDetail(book.id);
        } catch (err) {
            toastOperatorError(err);
        }
    });

    host.querySelectorAll('.pb-phys-release').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const physId = btn.getAttribute('data-phys-id');
            if (!physId || !window.confirm('Release this physical allocation?')) return;
            try {
                await api(`/api/purchase-books/physical/${encodeURIComponent(physId)}/release`, { method: 'POST' });
                showToast('Released', 'success');
                await renderBookDetail(book.id);
            } catch (err) {
                toastOperatorError(err);
            }
        });
    });

    host.querySelectorAll('.pb-phys-add').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const lineId = btn.getAttribute('data-line-id');
            const productId = btn.getAttribute('data-product-id');
            const lineEl = btn.closest('.pb-phys-line');
            if (!lineId || !productId || !lineEl) {
                showToast('Line needs a product_id to list serials', 'warning');
                return;
            }
            const line = lines.find((l) => l.id === lineId);
            await openPhysAllocatePicker({
                lineEl,
                lineId,
                productId,
                bookId: book.id,
                existingPhysicals: line?.physicals || []
            });
        });
    });
}

export function initPurchaseBooksView() {
    if (el('btnCreatePurchaseBook')) {
        el('btnCreatePurchaseBook').style.display = canManageBooks() ? '' : 'none';
    }
    if (!viewListenersBound) {
        viewListenersBound = true;
        el('btnReloadPurchaseBooks')?.addEventListener('click', () => renderBookList().catch((e) => showToast(e.message, 'error')));
        el('pbSearch')?.addEventListener('input', () => renderBookList().catch((e) => showToast(e.message, 'error')));
        el('btnCreatePurchaseBook')?.addEventListener('click', () => renderCreateForm().catch((e) => toastOperatorError(e)));
    }
    const pending = consumeOpen('purchase-books-view');
    const createFromPo = pending?.createFromPo || pending?.extra?.createFromPo;
    if (createFromPo) {
        renderCreateForm(createFromPo).catch((e) => toastOperatorError(e));
        return;
    }
    if (pending?.open) {
        selectedId = pending.open;
        renderBookDetail(selectedId).catch((e) => toastOperatorError(e));
        return;
    }
    renderBookList().catch((e) => showToast(e.message, 'error'));
}

window.initPurchaseBooksView = initPurchaseBooksView;
