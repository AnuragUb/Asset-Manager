import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.60';
import { consumeOpen, emptyState, crumb, toastOperatorError, canLogistics } from './lifecycle.js?v=7.52';

function el(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function canMutateSets() {
    return canLogistics();
}

function fmtSetQty(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : String(value ?? '');
}

/** Fills "N in stock" per component; silent when the user cannot see DC stock. */
async function loadSetStock(setId) {
    try {
        const data = await api(`/api/dc/sets/${encodeURIComponent(setId)}/pick-options?kits=1`);
        (data.requirements || []).forEach((r) => {
            const slot = document.querySelector(`[data-set-stock="${CSS.escape(r.id)}"]`);
            if (!slot) return;
            const ok = Number(r.inStock) >= Number(r.perKit);
            slot.innerHTML = `<span style="color:${ok ? '#15803d' : '#b91c1c'};">${escapeHtml(fmtSetQty(r.inStock))} ${escapeHtml(r.unit || '')} in stock</span>`;
        });
    } catch (_) { /* stock hint is optional */ }
}

async function api(path, options = {}) {
    const response = await fetchWithAuth(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.reasonCode = data.reasonCode;
        throw err;
    }
    return data;
}

function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function idempotencyKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function openManagedSet(id) {
    const nav = document.getElementById('nav-sets');
    if (nav) nav.click();
    setTimeout(() => openSetDetail(id).catch((err) => showToast(err.message, 'error')), 200);
}

export function paintManagedSetSection(container, managedSet) {
    if (!container) return;
    const ms = managedSet && (managedSet.id || managedSet.ID) ? managedSet : null;
    const name = ms ? escapeHtml(ms.name || '') : '';
    const code = ms ? escapeHtml(ms.setCode || ms.set_code || '') : '';
    const setId = ms ? escapeHtml(ms.id) : '';
    container.innerHTML = `
        <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:12px;margin:8px 0 16px;">
            <div style="font-size:11px;font-weight:700;color:#92400e;letter-spacing:.04em;">SET</div>
            ${ms ? `<div style="font-weight:700;margin-top:4px;">${name}</div>
                <div style="font-family:monospace;font-size:12px;color:#64748b;">${code}</div>
                <button type="button" class="action-button blue" data-open-managed-set="${setId}" style="margin-top:8px;">Open Set</button>`
            : `<div style="margin-top:4px;color:#667085;">Not assigned to a Set</div>`}
        </div>`;
    container.querySelector('[data-open-managed-set]')?.addEventListener('click', (e) => {
        e.preventDefault();
        openManagedSet(e.currentTarget.getAttribute('data-open-managed-set'));
    });
}

function statusChipClass(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'ACTIVE') return 'ms-chip ms-chip-active';
    if (s === 'ARCHIVED') return 'ms-chip ms-chip-archived';
    if (s === 'DISBANDED') return 'ms-chip ms-chip-disbanded';
    return 'ms-chip';
}

function completenessChipClass(value) {
    const s = String(value || '').toUpperCase();
    if (s === 'COMPLETE') return 'ms-chip ms-chip-complete';
    if (s === 'INCOMPLETE') return 'ms-chip ms-chip-incomplete';
    if (s === 'OVERCOMPLETE') return 'ms-chip ms-chip-overcomplete';
    return 'ms-chip';
}

async function renderSetList() {
    const host = el('setsContent');
    if (!host) return;
    const q = el('setSearch')?.value || '';
    const composition = el('setTypeFilter')?.value || '';
    const completeness = el('setCompletenessFilter')?.value || '';
    const status = el('setStatusFilter')?.value || 'ACTIVE';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (composition) params.set('composition', composition);
    if (completeness) params.set('completeness', completeness);
    if (status) params.set('status', status);
    const data = await api(`/api/sets?${params.toString()}`);
    const sets = data.sets || [];
    el('setCountBadge').textContent = `${sets.length} Sets`;
    if (!sets.length) {
        host.innerHTML = emptyState({
            title: 'No Sets in this view.',
            body: 'Create a Set, add Product requirements, then allocate Assets or Inventory. Completeness and composition are different: completeness is requirements vs allocated quantity; composition is the kinds of physical stock.',
            actionLabel: canMutateSets() ? 'Create Set' : '',
            actionView: 'sets-view',
            actionAttr: 'id="btnEmptyCreateSet"'
        });
        host.querySelector('#btnEmptyCreateSet')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCreateSetModal();
        });
        return;
    }
    host.innerHTML = `<div class="ms-grid">${sets.map(cardHtml).join('')}</div>`;
    host.querySelectorAll('[data-set-open]').forEach((btn) => {
        btn.addEventListener('click', () => openSetDetail(btn.getAttribute('data-set-open')));
    });
    host.querySelectorAll('[data-set-delete]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteSet(btn.getAttribute('data-set-delete'), btn.getAttribute('data-set-name'));
        });
    });
}

function canDeleteSet(set) {
    return canMutateSets() && String(set?.status || '').toUpperCase() !== 'ARCHIVED';
}

async function deleteSet(id, name) {
    const label = name ? `"${name}"` : 'this Set';
    if (!confirm(`Delete ${label}?\n\nThis removes the Set recipe from the list.\nIt does NOT delete Assets, Inventory, or Products.\nAny Set reservations are released.`)) return;
    try {
        await api(`/api/sets/${encodeURIComponent(id)}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('delete') },
            body: JSON.stringify({})
        });
        showToast('Set deleted. Physical records were kept.', 'success');
        const modal = el('setDetailModal');
        if (modal) modal.style.display = 'none';
        await renderSetList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cardHtml(set) {
    const legacy = set.engine === 'LEGACY_MANAGED';
    return `
        <article class="ms-card">
            <div class="ms-card-top">
                <span class="${statusChipClass(set.status)}">${escapeHtml(set.status)}</span>
                <span class="ms-chip ms-chip-type">${escapeHtml(set.composition || 'EMPTY')}</span>
                ${legacy ? '<span class="ms-chip ms-chip-legacy">Manual review</span>' : ''}
            </div>
            <h4 class="ms-card-name">${escapeHtml(set.name)}</h4>
            <div class="ms-mono">${escapeHtml(set.id)}</div>
            <div class="ms-card-foot">
                <span class="ms-card-count">${legacy ? 'Legacy Managed Set' : `${(set.requirements || []).length} requirement${(set.requirements || []).length === 1 ? '' : 's'}`}</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                    ${canDeleteSet(set) ? `<button type="button" class="ms-btn ms-btn-xs ms-btn-danger" data-set-delete="${escapeHtml(set.id)}" data-set-name="${escapeHtml(set.name)}">Delete</button>` : ''}
                    <button type="button" class="ms-btn ms-btn-primary" data-set-open="${escapeHtml(set.id)}">Open</button>
                </div>
            </div>
        </article>`;
}

let createDraftRequirements = [];

function renderCreateRequirements() {
    const host = el('newSetRequirements');
    if (!host) return;
    if (!createDraftRequirements.length) {
        host.innerHTML = '<div class="ms-empty">Add at least one Product requirement. Requirements freeze after create.</div>';
        return;
    }
    host.innerHTML = createDraftRequirements.map((r, idx) => `
        <div class="ms-row">
            <div class="ms-row-main">
                <div class="ms-row-name">${escapeHtml(r.name)} <span class="ms-mono">${escapeHtml(r.productId)}</span></div>
                <div class="ms-row-sub">
                    <span>Qty ${escapeHtml(r.quantity)}</span>
                    <span>Unit ${escapeHtml(r.unit || '—')}</span>
                </div>
            </div>
            <div class="ms-row-actions">
                <button type="button" class="ms-btn ms-btn-xs ms-btn-danger" data-remove-req="${idx}">Remove</button>
            </div>
        </div>`).join('');
    host.querySelectorAll('[data-remove-req]').forEach((btn) => {
        btn.addEventListener('click', () => {
            createDraftRequirements.splice(Number(btn.getAttribute('data-remove-req')), 1);
            renderCreateRequirements();
        });
    });
}

function wireCreateProductSearch() {
    const input = el('newSetProductSearch');
    const results = el('newSetProductResults');
    if (!input || !results) return;
    const hint = (text) => { results.innerHTML = `<div class="ms-result-hint">${escapeHtml(text)}</div>`; };
    hint('Search a Product, then enter quantity.');
    const search = debounce(async () => {
        const q = input.value.trim();
        if (!q) {
            hint('Search a Product, then enter quantity.');
            return;
        }
        hint('Searching...');
        try {
            const data = await api(`/api/products?status=ACTIVE&limit=25&q=${encodeURIComponent(q)}`);
            const products = data.products || [];
            if (!products.length) {
                hint('No Products match.');
                return;
            }
            results.innerHTML = products.map((p) => `
                <div class="ms-result" style="align-items:center;">
                    <span class="ms-row-main">
                        <span class="ms-row-name">${escapeHtml(p.name || p.id)}</span>
                        <span class="ms-row-sub">
                            <span class="ms-mono">${escapeHtml(p.id)}</span>
                            ${p.make || p.model ? `<span>${escapeHtml([p.make, p.model].filter(Boolean).join(' '))}</span>` : ''}
                            <span>Unit ${escapeHtml(p.unit || '—')}</span>
                        </span>
                    </span>
                    <span class="ms-inline" style="flex:0 0 auto;">
                        <input type="number" class="ms-input ms-qty" min="0.000001" step="any" value="1" data-qty-for="${escapeHtml(p.id)}">
                        <button type="button" class="ms-btn ms-btn-xs ms-btn-primary" data-add-product="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name || p.id)}" data-unit="${escapeHtml(p.unit || 'Nos')}">Add</button>
                    </span>
                </div>`).join('');
            results.querySelectorAll('[data-add-product]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const productId = btn.getAttribute('data-add-product');
                    if (createDraftRequirements.some((r) => r.productId === productId)) {
                        showToast('Duplicate Product in the same Set is not allowed', 'error');
                        return;
                    }
                    const qtyInput = results.querySelector(`[data-qty-for="${CSS.escape(productId)}"]`);
                    const quantity = Number(qtyInput?.value);
                    if (!(quantity > 0)) {
                        showToast('Quantity must be greater than zero', 'error');
                        return;
                    }
                    createDraftRequirements.push({
                        productId,
                        name: btn.getAttribute('data-name'),
                        unit: btn.getAttribute('data-unit') || 'Nos',
                        quantity
                    });
                    input.value = '';
                    hint('Search a Product, then enter quantity.');
                    renderCreateRequirements();
                });
            });
        } catch (err) {
            hint(err.message);
        }
    }, 250);
    input.addEventListener('input', search);
}

function allocationsForRequirement(set, requirementId) {
    return (set.allocations || []).filter((a) => a.requirementId === requirementId && a.isActive !== false);
}

async function openSetDetail(id) {
    const data = await api(`/api/sets/${encodeURIComponent(id)}`);
    const set = data.set;
    const modal = el('setDetailModal');
    const body = el('setDetailModalBody');
    if (!modal || !body) return;
    const legacy = set.engine === 'LEGACY_MANAGED';
    const active = set.status === 'ACTIVE';
    const canOperate = canMutateSets() && active && !legacy;
    const reqs = set.requirements || [];

    body.innerHTML = `
        <header class="ms-detail-head">
            ${crumb([
                { label: 'Product', view: 'products-view', open: (reqs[0] && (reqs[0].productId || reqs[0].product_id)) || set.productId || '' },
                { label: 'Set' },
                { label: 'History', view: 'history-view', open: set.id }
            ])}
            <h3>${escapeHtml(set.name)}</h3>
            <div class="ms-mono">${escapeHtml(set.id)}</div>
            <div class="ms-meta">
                <span class="${statusChipClass(set.status)}">${escapeHtml(set.status)}</span>
                Composition: <span class="ms-chip ms-chip-type">${escapeHtml(set.composition)}</span>
            </div>
            ${set.description ? `<p class="ms-desc">${escapeHtml(set.description)}</p>` : ''}
            ${legacy ? '<p class="ms-desc">Legacy / Manual Review. This Managed Set has no Product requirements. It is not a canonical Set and cannot be allocated, disbanded, or archived through this engine.</p>' : ''}
        </header>
        ${!legacy ? `
        <div class="ms-section-title">Commercial Product</div>
        <div class="ms-rows" style="margin-bottom:12px;">
            ${set.productId ? `
                <div class="ms-row">
                    <div class="ms-row-main">
                        <div class="ms-row-name">Product <span class="ms-mono">${escapeHtml(set.productId)}</span></div>
                        <div class="ms-row-sub">Commercialization is metadata only. It does not allocate or reserve.</div>
                    </div>
                    <div class="ms-row-actions">
                        <button type="button" class="ms-btn ms-btn-xs" id="btnViewSetProduct">View Product</button>
                        ${canMutateSets() ? '<button type="button" class="ms-btn ms-btn-xs ms-btn-primary" id="btnPublishSetProduct">Publish to Zoho</button>' : ''}
                    </div>
                </div>
            ` : `
                <div class="ms-empty">No Product yet. Set create does not create a Product.</div>
                ${canMutateSets() && active ? '<button type="button" class="ms-btn ms-btn-primary" id="btnCommercializeSet">COMMERCIALIZE SET</button>' : ''}
            `}
        </div>
        <div id="commercializePreviewHost"></div>
        ` : ''}
        <div class="ms-section-title">Components <span class="ms-frozen">FROZEN</span></div>
        ${!legacy ? '<p class="ms-desc" style="margin:0 0 8px;">A Set is a product recipe. The physical units are picked when the Set is added to a Delivery Challan (DC → ＋ Add Set).</p>' : ''}
        <div class="ms-rows">
            ${reqs.map((r) => {
                const allocs = allocationsForRequirement(set, r.id);
                return `<div class="ms-row" style="flex-direction:column;align-items:stretch;">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                        <div class="ms-row-main">
                            <div class="ms-row-name">${escapeHtml(r.productName || r.productId)} × ${escapeHtml(fmtSetQty(r.quantity))} ${escapeHtml(r.unit || '')}</div>
                            <div class="ms-row-sub"><span class="ms-mono">${escapeHtml(r.productId)}</span><span data-set-stock="${escapeHtml(r.id)}"></span></div>
                        </div>
                    </div>
                    ${allocs.length ? `<div class="ms-rows" style="margin-top:6px;">
                        ${allocs.map((a) => `
                            <div class="ms-row">
                                <div class="ms-row-main">
                                    <div class="ms-row-name">${escapeHtml(a.label || a.resourceId)} <span class="ms-chip">earlier allocation</span></div>
                                    <div class="ms-row-sub">
                                        <span class="ms-mono">${escapeHtml(a.resourceId)}</span>
                                        <span>${escapeHtml(a.resourceType)}</span>
                                        <span>× ${escapeHtml(a.quantity)}</span>
                                    </div>
                                </div>
                                <div class="ms-row-actions">
                                    ${canOperate ? `<button type="button" class="ms-btn ms-btn-xs ms-btn-danger" data-remove-alc="${escapeHtml(a.id)}" title="Release this unit back to stock">Release</button>` : ''}
                                </div>
                            </div>`).join('')}
                    </div>` : ''}
                </div>`;
            }).join('') || '<div class="ms-empty">No requirements</div>'}
        </div>
        <div class="ms-section-title">Procurement (read-only)</div>
        <div id="setProcurementHost" class="ms-rows"><div class="ms-empty">Loading procurement need…</div></div>
        <div class="ms-section-title">History</div>
        <div id="setHistoryHost" class="ms-rows"><div class="ms-empty">Loading history…</div></div>
        ${canOperate || canDeleteSet(set) ? `
        <div class="ms-modal-actions">
            ${canOperate ? `
            <button type="button" class="ms-btn ms-btn-xs" id="btnSetArchive">Archive Set</button>
            <button type="button" class="ms-btn ms-btn-xs ms-btn-danger" id="btnSetDisband">Disband Set</button>
            ` : ''}
            ${canDeleteSet(set) ? '<button type="button" class="ms-btn ms-btn-xs ms-btn-danger" id="btnSetDelete">Delete Set</button>' : ''}
        </div>` : ''}
    `;
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';

    loadHistory(id);
    loadSetProcurementNeed(id);
    if (!legacy && active) loadSetStock(set.id);

    el('btnViewSetProduct')?.addEventListener('click', () => {
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('products-view', { open: set.productId });
            return;
        }
        if (typeof window.showView === 'function') window.showView('products-view');
        if (typeof window.initProductsView === 'function') window.initProductsView();
        if (typeof window.openProductDetail === 'function') {
            window.openProductDetail(set.productId);
        }
    });
    el('btnPublishSetProduct')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        if (!confirm('Publish the Set-derived Product to Zoho? This does not change allocations or reservations.')) return;
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Publishing…';
        try {
            const result = await api(`/api/products/${encodeURIComponent(set.productId)}/publish`, { method: 'POST' });
            showToast(result.skipped ? 'Already up to date in Zoho' : `Published ${result.zohoId}`, 'success');
            openSetDetail(id);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = label;
        }
    });
    el('btnCommercializeSet')?.addEventListener('click', async () => {
        const host = el('commercializePreviewHost');
        try {
            const data = await api(`/api/sets/${encodeURIComponent(id)}/commercialize/preview`);
            const preview = data.preview;
            const reuseOpts = (preview.reuseCandidates || []).map((p) =>
                `<label style="display:block;margin-top:6px;font-size:12px;">
                    <input type="checkbox" id="reuseSetProduct" data-reuse-id="${escapeHtml(p.id)}"> Reuse existing Product ${escapeHtml(p.id)} (identical composition only)
                </label>`
            ).join('');
            if (host) {
                host.innerHTML = `
                    <div class="ms-row" style="flex-direction:column;align-items:stretch;margin-bottom:12px;">
                        <div class="ms-row-name">Create Product from this Set?</div>
                        <div class="ms-row-sub">Set ${escapeHtml(preview.setId)} — ${escapeHtml(preview.setName)}</div>
                        <pre style="white-space:pre-wrap;font-size:12px;background:#f9fafb;padding:8px;border-radius:6px;">${escapeHtml(preview.description)}</pre>
                        <label style="font-size:12px;">Proposed Product name
                            <input id="commercializeName" value="${escapeHtml(preview.proposedName)}" style="width:100%;margin-top:4px;padding:6px;">
                        </label>
                        ${reuseOpts || '<div class="ms-row-sub">Reuse is offered only when an identical SET-origin Product already exists. Default is a new Product.</div>'}
                        <button type="button" class="ms-btn ms-btn-primary" id="btnConfirmCommercialize">Create Product</button>
                    </div>`;
            }
            el('btnConfirmCommercialize')?.addEventListener('click', async () => {
                const reuseBox = el('reuseSetProduct');
                const body = { name: el('commercializeName')?.value || preview.proposedName };
                if (reuseBox && reuseBox.checked) {
                    body.reuse = true;
                    body.reuseProductId = reuseBox.getAttribute('data-reuse-id');
                }
                try {
                    const result = await api(`/api/sets/${encodeURIComponent(id)}/commercialize`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    showToast(`Product ${result.product.id}`, 'success');
                    openSetDetail(id);
                    renderSetList();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    body.querySelectorAll('[data-allocate-req]').forEach((btn) => {
        btn.addEventListener('click', () => openAllocatePanel(set, btn.getAttribute('data-allocate-req')));
    });
    body.querySelectorAll('[data-remove-alc]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await api(`/api/sets/${encodeURIComponent(id)}/allocations/${encodeURIComponent(btn.getAttribute('data-remove-alc'))}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('dealloc') },
                    body: JSON.stringify({})
                });
                showToast('Unit released back to stock.', 'success');
                openSetDetail(id);
                renderSetList();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
    body.querySelectorAll('[data-replace-alc]').forEach((btn) => {
        btn.addEventListener('click', () => openReplacePanel(
            set,
            btn.getAttribute('data-req'),
            btn.getAttribute('data-replace-alc'),
            btn.getAttribute('data-type')
        ));
    });
    el('btnSetDisband')?.addEventListener('click', async () => {
        if (!confirm('This will release this Set\'s reservations.\nIt will NOT delete Assets or Inventory.')) return;
        try {
            await api(`/api/sets/${encodeURIComponent(id)}/disband`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('disband') },
                body: JSON.stringify({})
            });
            showToast('Set disbanded. Physical records preserved.', 'success');
            openSetDetail(id);
            renderSetList();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    el('btnSetDelete')?.addEventListener('click', () => deleteSet(id, set.name));
    el('btnSetArchive')?.addEventListener('click', async () => {
        if (!confirm('Archive this Set?')) return;
        try {
            await api(`/api/sets/${encodeURIComponent(id)}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('archive') },
                body: JSON.stringify({})
            });
            showToast('Set archived.', 'success');
            modal.style.display = 'none';
            renderSetList();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

async function loadSetProcurementNeed(setId) {
    const host = el('setProcurementHost');
    if (!host) return;
    try {
        const data = await api(`/api/sets/${encodeURIComponent(setId)}/procurement-need`);
        const lines = data.lines || [];
        if (!lines.length) {
            host.innerHTML = '<div class="ms-empty">No Product requirements — nothing to procure against.</div>';
            return;
        }
        host.innerHTML = lines.map((line) => `
            <div class="ms-row" style="flex-direction:column;align-items:stretch;">
                <div class="ms-row-name">${escapeHtml(line.productName || line.productId)}</div>
                <div class="ms-row-sub">
                    <span>Required ${escapeHtml(line.required)}</span>
                    <span>Allocated ${escapeHtml(line.allocated)}</span>
                    <span>Shortfall ${escapeHtml(line.shortfall)}</span>
                    <span>On Order ${escapeHtml(line.onOrder)}</span>
                    <span>Additional need ${escapeHtml(line.additionalNeed)}</span>
                </div>
                <div class="ms-row-sub">On Order is procurement information only. It is not a reservation, allocation, or physical stock.</div>
            </div>`).join('');
    } catch (err) {
        host.innerHTML = `<div class="ms-empty">${escapeHtml(err.message)}</div>`;
    }
}

async function loadHistory(setId) {
    const host = el('setHistoryHost');
    if (!host) return;
    try {
        const data = await api(`/api/sets/${encodeURIComponent(setId)}/history`);
        const events = data.events || [];
        if (!events.length) {
            host.innerHTML = '<div class="ms-empty">No events</div>';
            return;
        }
        host.innerHTML = events.slice().reverse().map((e) => `
            <div class="ms-row">
                <div class="ms-row-main">
                    <div class="ms-row-name">${escapeHtml(e.type)}</div>
                    <div class="ms-row-sub">
                        <span>${escapeHtml(e.timestamp || '')}</span>
                        ${e.actor ? `<span>${escapeHtml(e.actor)}</span>` : ''}
                        ${e.resourceId ? `<span class="ms-mono">${escapeHtml(e.resourceId)}</span>` : ''}
                        ${e.quantity != null ? `<span>× ${escapeHtml(e.quantity)}</span>` : ''}
                        ${e.productId ? `<span class="ms-mono">${escapeHtml(e.productId)}</span>` : ''}
                    </div>
                </div>
            </div>`).join('');
    } catch (err) {
        host.innerHTML = `<div class="ms-empty">${escapeHtml(err.message)}</div>`;
    }
}

function confirmOvercomplete(set, requirementId, extraQty) {
    const line = (set.completenessLines || []).find((l) => l.requirementId === requirementId);
    if (!line) return true;
    if ((Number(line.allocated) + Number(extraQty)) - Number(line.required) > 1e-9) {
        return confirm('This allocation will make this Set OVERCOMPLETE.\n\nThe requirement will not change.\n\nAllocate anyway?');
    }
    return true;
}

function openAllocatePanel(set, requirementId) {
    const panel = document.getElementById(`alloc-panel-${requirementId}`);
    if (!panel) return;
    panel.innerHTML = `
        <div class="ms-field" style="margin-top:8px;border:1px solid #e2e8f0;border-radius:6px;padding:8px;">
            <div class="ms-label">Allocate against this requirement</div>
            <div class="ms-inline" style="margin-bottom:6px;">
                <button type="button" class="ms-btn ms-btn-xs ms-btn-primary" data-alloc-domain="ASSET">Asset</button>
                <button type="button" class="ms-btn ms-btn-xs" data-alloc-domain="INVENTORY">Inventory</button>
            </div>
            <input type="text" class="ms-input" id="allocSearch-${requirementId}" placeholder="Search eligible records...">
            <div id="allocResults-${requirementId}" class="ms-results"></div>
        </div>`;
    let domain = 'ASSET';
    panel.querySelectorAll('[data-alloc-domain]').forEach((btn) => {
        btn.addEventListener('click', () => {
            domain = btn.getAttribute('data-alloc-domain');
            panel.querySelectorAll('[data-alloc-domain]').forEach((b) => {
                b.classList.toggle('ms-btn-primary', b === btn);
            });
            document.getElementById(`allocSearch-${requirementId}`).value = '';
            document.getElementById(`allocResults-${requirementId}`).innerHTML = '';
        });
    });
    const input = document.getElementById(`allocSearch-${requirementId}`);
    const results = document.getElementById(`allocResults-${requirementId}`);
    const search = debounce(async () => {
        const q = input.value.trim();
        results.innerHTML = '<div class="ms-result-hint">Searching…</div>';
        try {
            const path = domain === 'ASSET'
                ? `/api/sets/${encodeURIComponent(set.id)}/eligible-assets`
                : `/api/sets/${encodeURIComponent(set.id)}/eligible-inventory`;
            const params = new URLSearchParams({ requirementId, limit: '25' });
            if (q) params.set('q', q);
            const data = await api(`${path}?${params.toString()}`);
            const rows = data.eligible || [];
            if (!rows.length) {
                const reasons = (data.ineligible || []).slice(0, 5).map((r) => `${r.id}: ${r.reason || r.reasonCode}`).join(' · ');
                results.innerHTML = `<div class="ms-result-hint">No eligible ${domain.toLowerCase()} records.${reasons ? ` ${escapeHtml(reasons)}` : ''}</div>`;
                return;
            }
            results.innerHTML = rows.map((row) => {
                if (domain === 'ASSET') {
                    return `<button type="button" class="ms-result" data-pick="${escapeHtml(row.id)}">
                        <span class="ms-row-main">
                            <span class="ms-row-name">${escapeHtml(row.itemname || row.id)}</span>
                            <span class="ms-row-sub">
                                <span class="ms-mono">${escapeHtml(row.id)}</span>
                                <span>${escapeHtml(row.status || '')}</span>
                                ${row.make || row.model ? `<span>${escapeHtml([row.make, row.model].filter(Boolean).join(' '))}</span>` : ''}
                                <span class="ms-mono">${escapeHtml(row.productId || '')}</span>
                            </span>
                        </span>
                        <span class="ms-btn ms-btn-xs ms-btn-primary">Allocate</span>
                    </button>`;
                }
                return `<div class="ms-result" style="align-items:center;">
                    <span class="ms-row-main">
                        <span class="ms-row-name">${escapeHtml(row.itemname || row.id)}</span>
                        <span class="ms-row-sub">
                            <span class="ms-mono">${escapeHtml(row.id)}</span>
                            <span>Total ${escapeHtml(row.quantityTotal)}</span>
                            <span>Reserved ${escapeHtml(row.quantityReserved)}</span>
                            <span>Available ${escapeHtml(row.quantityAvailable)}</span>
                        </span>
                    </span>
                    <span class="ms-inline">
                        <input type="number" class="ms-input ms-qty" min="0.000001" step="any" value="1" data-qty="${escapeHtml(row.id)}">
                        <button type="button" class="ms-btn ms-btn-xs ms-btn-primary" data-pick="${escapeHtml(row.id)}">Allocate</button>
                    </span>
                </div>`;
            }).join('');
            results.querySelectorAll('[data-pick]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const resourceId = btn.getAttribute('data-pick');
                    let quantity = 1;
                    if (domain === 'INVENTORY') {
                        quantity = Number(results.querySelector(`[data-qty="${CSS.escape(resourceId)}"]`)?.value);
                        if (!(quantity > 0)) {
                            showToast('Enter a quantity greater than zero', 'error');
                            return;
                        }
                    }
                    if (!confirmOvercomplete(set, requirementId, quantity)) return;
                    const req = (set.requirements || []).find((r) => r.id === requirementId) || {};
                    const line = (set.completenessLines || []).find((l) => l.requirementId === requirementId) || {};
                    const availText = domain === 'INVENTORY'
                        ? (rows.find((x) => x.id === resourceId)?.quantityAvailable ?? '—')
                        : 'whole record';
                    if (!confirm(`This physical stock is being committed to this Set.\n\nProduct: ${req.name || req.productId || ''}\nRequirement: ${line.required ?? req.quantity ?? '—'}\nAvailable: ${availText}\nRequested: ${quantity}\n\nThis is allocation, not conversion or Break.`)) return;
                    try {
                        await api(`/api/sets/${encodeURIComponent(set.id)}/allocations`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('alloc') },
                            body: JSON.stringify({
                                requirement_id: requirementId,
                                resource_type: domain,
                                resource_id: resourceId,
                                quantity
                            })
                        });
                        showToast('Allocated. Stock is committed to this Set.', 'success');
                        openSetDetail(set.id);
                        renderSetList();
                    } catch (err) {
                        toastOperatorError(err);
                    }
                });
            });
        } catch (err) {
            results.innerHTML = `<div class="ms-result-hint">${escapeHtml(err.message)}</div>`;
        }
    }, 250);
    input.addEventListener('input', search);
    search();
}

function openReplacePanel(set, requirementId, allocationId, currentType) {
    const panel = document.getElementById(`alloc-panel-${requirementId}`);
    if (!panel) return;
    panel.innerHTML = `
        <div class="ms-field" style="margin-top:8px;border:1px solid #fde68a;border-radius:6px;padding:8px;background:#fffbeb;">
            <div class="ms-label">Replace physical allocation (same Product requirement)</div>
            <input type="text" class="ms-input" id="replaceSearch-${allocationId}" placeholder="Search replacement ${currentType === 'ASSET' ? 'Asset' : 'Inventory'}...">
            <div id="replaceResults-${allocationId}" class="ms-results"></div>
        </div>`;
    const input = document.getElementById(`replaceSearch-${allocationId}`);
    const results = document.getElementById(`replaceResults-${allocationId}`);
    const domain = currentType === 'INVENTORY' ? 'INVENTORY' : 'ASSET';
    const search = debounce(async () => {
        const q = input.value.trim();
        results.innerHTML = '<div class="ms-result-hint">Searching…</div>';
        try {
            const path = domain === 'ASSET'
                ? `/api/sets/${encodeURIComponent(set.id)}/eligible-assets`
                : `/api/sets/${encodeURIComponent(set.id)}/eligible-inventory`;
            const params = new URLSearchParams({ requirementId, limit: '25' });
            if (q) params.set('q', q);
            const data = await api(`${path}?${params.toString()}`);
            const rows = data.eligible || [];
            if (!rows.length) {
                results.innerHTML = '<div class="ms-result-hint">No eligible replacements with the same Product.</div>';
                return;
            }
            results.innerHTML = rows.map((row) => `<button type="button" class="ms-result" data-pick="${escapeHtml(row.id)}">
                <span class="ms-row-main">
                    <span class="ms-row-name">${escapeHtml(row.itemname || row.id)}</span>
                    <span class="ms-row-sub"><span class="ms-mono">${escapeHtml(row.id)}</span></span>
                </span>
                <span class="ms-btn ms-btn-xs ms-btn-primary">Replace</span>
            </button>`).join('');
            results.querySelectorAll('[data-pick]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    try {
                        await api(`/api/sets/${encodeURIComponent(set.id)}/allocations/${encodeURIComponent(allocationId)}/replace`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('sub') },
                            body: JSON.stringify({
                                resource_type: domain,
                                resource_id: btn.getAttribute('data-pick'),
                                quantity: domain === 'ASSET' ? 1 : undefined
                            })
                        });
                        showToast('Allocation replaced. Requirement unchanged.', 'success');
                        openSetDetail(set.id);
                        renderSetList();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            });
        } catch (err) {
            results.innerHTML = `<div class="ms-result-hint">${escapeHtml(err.message)}</div>`;
        }
    }, 250);
    input.addEventListener('input', search);
    search();
}

function closeCreateSetModal() {
    const modal = el('createSetModal');
    if (modal) modal.style.display = 'none';
}

function openCreateSetModal() {
    const modal = el('createSetModal');
    if (!modal) return;
    createDraftRequirements = [];
    if (el('newSetName')) el('newSetName').value = '';
    if (el('newSetDescription')) el('newSetDescription').value = '';
    if (el('newSetProductSearch')) el('newSetProductSearch').value = '';
    if (el('newSetProductResults')) el('newSetProductResults').innerHTML = '';
    if (el('newSetIdPreview')) el('newSetIdPreview').value = 'SET-MMYY-XXXXXX-C';
    renderCreateRequirements();
    modal.style.display = 'flex';
    setTimeout(() => el('newSetName')?.focus(), 50);
}

async function submitCreateSet() {
    const name = (el('newSetName')?.value || '').trim();
    const description = (el('newSetDescription')?.value || '').trim();
    if (!name) {
        showToast('Set Name is required', 'error');
        el('newSetName')?.focus();
        return;
    }
    if (!createDraftRequirements.length) {
        showToast('Add at least one Product requirement', 'error');
        return;
    }
    const button = el('btnConfirmCreateSet');
    if (button) button.disabled = true;
    try {
        const data = await api('/api/sets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description: description || undefined,
                requirements: createDraftRequirements.map((r) => ({
                    product_id: r.productId,
                    quantity: r.quantity
                }))
            })
        });
        showToast(`Set created ACTIVE: ${data.set?.id || ''}`, 'success');
        closeCreateSetModal();
        await renderSetList();
        if (data.set?.id) openSetDetail(data.set.id);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

let viewListenersBound = false;

export function initKitSetsView() {
    const pending = consumeOpen('sets-view');
    if (viewListenersBound) {
        if (pending && pending.open) {
            openSetDetail(pending.open).catch((err) => toastOperatorError(err));
            return;
        }
        renderSetList().catch((err) => toastOperatorError(err));
        return;
    }
    viewListenersBound = true;
    wireCreateProductSearch();
    el('btnCreateSet')?.addEventListener('click', () => openCreateSetModal());
    el('btnConfirmCreateSet')?.addEventListener('click', () => submitCreateSet());
    el('btnCancelCreateSet')?.addEventListener('click', () => closeCreateSetModal());
    el('closeCreateSetModal')?.addEventListener('click', () => closeCreateSetModal());
    el('createSetModal')?.addEventListener('click', (e) => {
        if (e.target === el('createSetModal')) closeCreateSetModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (el('createSetModal')?.style.display === 'flex') closeCreateSetModal();
        if (el('setDetailModal')?.style.display === 'flex') el('setDetailModal').style.display = 'none';
    });
    el('btnReloadSets')?.addEventListener('click', () => renderSetList().catch((e) => showToast(e.message, 'error')));
    el('setSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderSetList().catch((err) => showToast(err.message, 'error'));
    });
    el('setTypeFilter')?.addEventListener('change', () => renderSetList().catch((err) => showToast(err.message, 'error')));
    el('setCompletenessFilter')?.addEventListener('change', () => renderSetList().catch((err) => showToast(err.message, 'error')));
    el('setStatusFilter')?.addEventListener('change', () => renderSetList().catch((err) => showToast(err.message, 'error')));
    el('closeSetDetailModal')?.addEventListener('click', () => {
        const modal = el('setDetailModal');
        if (modal) modal.style.display = 'none';
    });
    if (pending && pending.open) {
        openSetDetail(pending.open).catch((err) => toastOperatorError(err));
        return;
    }
    renderSetList().catch((err) => toastOperatorError(err));
}

window.initKitSetsView = initKitSetsView;
window.openManagedSet = openManagedSet;
window.openSetDetail = openSetDetail;
window.paintManagedSetSection = paintManagedSetSection;
