import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.61';
import {
    canLogistics,
    escapeHtml,
    dash,
    formatQty,
    formatWhen,
    statusChip,
    emptyState,
    crumb,
    section,
    consumeOpen,
    toastOperatorError,
    lifecycleApi,
    go
} from './lifecycle.js?v=7.31';

function el(id) {
    return document.getElementById(id);
}

async function api(path, options = {}) {
    try {
        return await lifecycleApi(path, options);
    } catch (err) {
        throw err;
    }
}

function fieldRow(label, value, extra = '') {
    return `<div style="margin-bottom:10px;">
        <div class="lc-k">${escapeHtml(label)}</div>
        <div style="margin-top:2px;${extra}">${value}</div>
    </div>`;
}

function confirmAction(message) {
    return window.confirm(message);
}

const AE_PROV_TITLE = 'Authoritative Product record in AssetEngine.';
const ZOHO_PROV_TITLE = 'Read-only reference from Zoho. Not an AssetEngine Product.';

function aeProvPill() {
    return `<span class="prd-prov-pill prd-prov-ae" title="${escapeHtml(AE_PROV_TITLE)}" aria-label="AssetEngine Product. ${AE_PROV_TITLE}">AssetEngine</span>`;
}

function zohoProvPill() {
    return `<span class="prd-prov-pill prd-prov-zoho" title="${escapeHtml(ZOHO_PROV_TITLE)}" aria-label="Zoho Reference. ${ZOHO_PROV_TITLE}">ZOHO</span>`;
}

function mapChip(text, tone) {
    let bg = '#e2e8f0';
    let fg = '#334155';
    if (tone === 'linked') {
        bg = '#dcfce7';
        fg = '#166534';
    } else if (tone === 'none') {
        bg = '#fef9c3';
        fg = '#854d0e';
    }
    return `<span class="lc-chip" style="background:${bg};color:${fg};">${escapeHtml(text)}</span>`;
}

function aeMappingHtml(product) {
    const status = String(product.sync_status || (product.zoho_external_id ? 'LINKED' : 'UNLINKED')).toUpperCase();
    if (status === 'UNLINKED') return mapChip('Not Linked', 'none');
    const linked = mapChip('ZOHO Linked', 'linked');
    if (status === 'LINKED' || status === 'SYNCED') return linked;
    return `${linked} ${statusChip(status)}`;
}

function catalogStatusHtml(link, zohoId, { allowCreate = false } = {}) {
    if (link.linked) {
        return `<div class="prd-map-cell">${mapChip('ZOHO Linked', 'linked')}<button type="button" class="lc-crumb-link" data-open-prd="${escapeHtml(link.productId)}" aria-label="Open AssetEngine Product ${escapeHtml(link.productId)}">${escapeHtml(link.productId)}</button></div>`;
    }
    const createBtn = allowCreate
        ? `<button type="button" class="action-button blue" data-create-against="${escapeHtml(zohoId)}" aria-label="Create Against Zoho Products">Create Against Zoho Products</button>`
        : '';
    return `<div class="prd-map-cell">${mapChip('Reference Only', 'ref')}${createBtn}</div>`;
}

const LOGO_SRC = '/static/logo.png?v=6.44';

function aeProductNameCellHtml(product) {
    const name = String(product.name || '').trim();
    const description = String(product.description || '').trim();
    return `<div class="prd-name-cell">
        <div class="prd-name">${name ? escapeHtml(name) : dash(name)}</div>
        ${description ? `<div class="prd-desc">${escapeHtml(description)}</div>` : ''}
    </div>`;
}

let createAgainstInFlight = false;

async function existingProductForZoho(zohoProductId) {
    const mapping = await loadCatalogMapping(true);
    return mapping.get(String(zohoProductId || '')) || null;
}

async function createAgainstZohoProduct(zohoProductId) {
    if (createAgainstInFlight) return;
    createAgainstInFlight = true;
    try {
        const existing = await existingProductForZoho(zohoProductId);
        if (existing) {
            showToast(`${existing.id} already exists for this Zoho Reference`, 'info');
            selectedId = existing.id;
            await Promise.all([
                renderProductList(),
                renderZohoCatalogPanel({ force: false })
            ]);
            await openProductDetail(existing.id);
            return;
        }
        if (!confirmAction(`Create Against Zoho Products: ${zohoProductId}?\n\nThis creates an AssetEngine Product from the Zoho Reference. No Inventory or Assets will be created.`)) return;
        try {
            const created = await api('/api/products/from-catalog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_product_id: zohoProductId })
            });
            const pid = created.product?.id;
            showToast(`Created ${pid}`, 'success');
            selectedId = pid;
            catalogMappingByZohoId = null;
            await Promise.all([
                renderProductList(),
                renderZohoCatalogPanel({ force: false })
            ]);
            if (pid) await openProductDetail(pid);
        } catch (err) {
            if (err.reasonCode === 'DUPLICATE_MAPPING') {
                const linked = await existingProductForZoho(zohoProductId);
                if (linked) {
                    showToast(`${linked.id} already exists for this Zoho Reference`, 'info');
                    selectedId = linked.id;
                    await Promise.all([
                        renderProductList(),
                        renderZohoCatalogPanel({ force: true })
                    ]);
                    await openProductDetail(linked.id);
                    return;
                }
            }
            toastOperatorError(err);
        }
    } finally {
        createAgainstInFlight = false;
    }
}

let viewListenersBound = false;
let selectedId = null;
let catalogCache = null;
let catalogMappingByZohoId = null;
let selectedCatalogZohoId = null;
let catalogSearchTimer = null;

function catalogSearchNeedle(row) {
    return [
        row.product_name,
        row.sku,
        row.make,
        row.model,
        row.zoho_product_id
    ].map((value) => String(value || '').toLowerCase()).join('\n');
}

function filterCatalogRows(rows, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((row) => catalogSearchNeedle(row).includes(q));
}

async function loadCatalogRows(force = false) {
    if (!force && Array.isArray(catalogCache)) return catalogCache;
    const data = await api('/api/zoho/catalog');
    catalogCache = data.catalog || [];
    return catalogCache;
}

async function loadCatalogMapping(force = false) {
    if (!force && catalogMappingByZohoId) return catalogMappingByZohoId;
    const data = await api('/api/products?limit=500');
    const map = new Map();
    (data.products || []).forEach((product) => {
        const zohoId = product.zoho_external_id;
        if (zohoId) {
            map.set(String(zohoId), {
                id: product.id,
                name: product.name,
                sync_status: product.sync_status
            });
        }
    });
    catalogMappingByZohoId = map;
    return map;
}

function catalogLinkInfo(row, mapping) {
    const linked = mapping.get(String(row.zoho_product_id || ''));
    if (linked) {
        return { linked: true, productId: linked.id, productName: linked.name, label: 'ZOHO Linked' };
    }
    return { linked: false, productId: '', productName: '', label: 'Reference Only' };
}

async function renderZohoCatalogPanel({ force = false } = {}) {
    const host = el('zohoCatalogContent');
    if (!host) return;
    if (!catalogPanelIsOpen()) return;
    const query = el('zohoCatalogSearch')?.value || '';
    const needsFetch = force || !Array.isArray(catalogCache) || !catalogMappingByZohoId;
    if (needsFetch) host.innerHTML = '<p class="lc-muted">Loading Zoho Reference Catalog…</p>';
    try {
        const [rows, mapping] = await Promise.all([
            loadCatalogRows(force),
            loadCatalogMapping(force)
        ]);
        const visible = filterCatalogRows(rows, query);
        const logistics = canLogistics();
        if (el('zohoCatalogCountBadge')) {
            el('zohoCatalogCountBadge').textContent = `${visible.length} Zoho References`;
        }
        if (!visible.length) {
            const noQuery = !String(query || '').trim();
            host.innerHTML = emptyState({
                title: noQuery ? 'No Zoho Reference Catalog records found.' : 'No matching Zoho Reference Catalog records found.',
                body: noQuery
                    ? 'Pull the Zoho Reference Catalog first. This panel is reference only and is not an AssetEngine Product list.'
                    : 'Try another name, product code, make, or model. AssetEngine Products were not searched.'
            });
            return;
        }
        host.innerHTML = `
            <div style="display:flex;gap:16px;align-items:flex-start;min-height:0;">
                <div style="flex:1;min-width:0;overflow:auto;">
                    <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                                <th style="padding:8px;">Name</th>
                                <th style="padding:8px;">Product Code</th>
                                <th style="padding:8px;">Make</th>
                                <th style="padding:8px;">Model</th>
                                <th style="padding:8px;">Mapping</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${visible.map((row) => {
                                const link = catalogLinkInfo(row, mapping);
                                const selected = String(selectedCatalogZohoId || '') === String(row.zoho_product_id || '');
                                return `<tr data-catalog-open="${escapeHtml(row.zoho_product_id)}" style="cursor:pointer;border-bottom:1px solid #f3f4f6;${selected ? 'background:#eef2f6;' : ''}">
                                    <td style="padding:8px;"><div class="prd-id-cell">${zohoProvPill()} ${dash(row.product_name)}</div></td>
                                    <td style="padding:8px;" class="lc-mono">${dash(row.sku)}</td>
                                    <td style="padding:8px;">${dash(row.make)}</td>
                                    <td style="padding:8px;">${dash(row.model)}</td>
                                    <td style="padding:8px;">${catalogStatusHtml(link, row.zoho_product_id, { allowCreate: logistics && !link.linked })}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div id="zohoCatalogDetailPanel" style="width:min(420px,40%);flex-shrink:0;"></div>
            </div>
        `;
        host.querySelectorAll('[data-catalog-open]').forEach((rowEl) => {
            const row = visible.find((item) => String(item.zoho_product_id) === String(rowEl.getAttribute('data-catalog-open')));
            const link = row ? catalogLinkInfo(row, mapping) : { label: '' };
            rowEl.setAttribute('tabindex', '0');
            rowEl.setAttribute('aria-label', `Zoho Reference ${row ? row.product_name : ''}. ${link.label}${link.productId ? ` ${link.productId}` : ''}`);
            rowEl.addEventListener('click', () => {
                selectedCatalogZohoId = rowEl.getAttribute('data-catalog-open');
                host.querySelectorAll('[data-catalog-open]').forEach((elRow) => {
                    elRow.style.background = String(elRow.getAttribute('data-catalog-open')) === String(selectedCatalogZohoId) ? '#eef2f6' : '';
                });
                renderCatalogDetail(row, mapping);
            });
            rowEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    rowEl.click();
                }
            });
        });
        host.querySelectorAll('[data-open-prd]').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openProductDetail(btn.getAttribute('data-open-prd')).catch((err) => toastOperatorError(err));
            });
        });
        host.querySelectorAll('[data-create-against]').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                createAgainstZohoProduct(btn.getAttribute('data-create-against')).catch((err) => toastOperatorError(err));
            });
        });
        if (selectedCatalogZohoId) {
            renderCatalogDetail(visible.find((row) => String(row.zoho_product_id) === String(selectedCatalogZohoId)), mapping);
        } else {
            renderCatalogDetail(null, mapping);
        }
    } catch (err) {
        host.innerHTML = `<div class="lc-empty" role="status"><h3>Zoho Reference Catalog could not load</h3><p>${escapeHtml(toastOperatorError(err))}</p></div>`;
    }
}

function renderCatalogDetail(row, mapping) {
    const panel = el('zohoCatalogDetailPanel');
    if (!panel) return;
    if (!row) {
        panel.innerHTML = '<p class="lc-muted">Select a Zoho Reference to inspect. This does not create an AssetEngine Product.</p>';
        return;
    }
    const link = catalogLinkInfo(row, mapping);
    const logistics = canLogistics();
    panel.innerHTML = `
        ${section('Zoho Reference', `
            <div class="prd-id-cell" style="margin-bottom:6px;">${zohoProvPill()} ${mapChip(link.linked ? 'ZOHO Linked' : 'Reference Only', link.linked ? 'linked' : 'ref')}${link.linked ? ` <button type="button" class="lc-crumb-link" id="btnOpenLinkedProduct" aria-label="Open AssetEngine Product ${escapeHtml(link.productId)}">${escapeHtml(link.productId)}</button>` : ''}</div>
            <p class="lc-muted" style="margin-top:0;" title="${escapeHtml(ZOHO_PROV_TITLE)}">Read-only reference from Zoho. Not an AssetEngine Product.</p>
            <h3 style="margin:6px 0 4px;">${dash(row.product_name)}</h3>
            ${fieldRow('Product Code', dash(row.sku))}
            ${fieldRow('Make', dash(row.make))}
            ${fieldRow('Model', dash(row.model))}
            ${fieldRow('Zoho Product ID', `<span class="lc-mono">${escapeHtml(row.zoho_product_id)}</span>`)}
            ${link.linked
                ? ''
                : fieldRow('AssetEngine Product', 'None — reference only')}
            ${logistics && !link.linked
                ? '<button type="button" class="action-button blue" id="btnCreateFromCatalogRow" aria-label="Create Against Zoho Products" style="margin-top:12px;">Create Against Zoho Products</button>'
                : ''}
        `)}
    `;
    el('btnOpenLinkedProduct')?.addEventListener('click', () => {
        if (link.productId) openProductDetail(link.productId).catch((err) => toastOperatorError(err));
    });
    el('btnCreateFromCatalogRow')?.addEventListener('click', () => {
        createAgainstZohoProduct(row.zoho_product_id).catch((err) => toastOperatorError(err));
    });
}

function scheduleCatalogSearch() {
    if (catalogSearchTimer) clearTimeout(catalogSearchTimer);
    catalogSearchTimer = setTimeout(() => {
        renderZohoCatalogPanel().catch((err) => toastOperatorError(err));
    }, 300);
}

function catalogPanelIsOpen() {
    const sectionEl = el('zohoCatalogSection');
    return Boolean(sectionEl && !sectionEl.classList.contains('hidden'));
}

function setCatalogPanelOpen(open) {
    const sectionEl = el('zohoCatalogSection');
    const btn = el('btnOpenZohoCatalog');
    if (!sectionEl) return;
    sectionEl.classList.toggle('hidden', !open);
    if (open) sectionEl.removeAttribute('hidden');
    else {
        sectionEl.setAttribute('hidden', '');
        const host = el('zohoCatalogContent');
        if (host) host.innerHTML = '';
    }
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
        if (typeof sectionEl.scrollIntoView === 'function') {
            sectionEl.scrollIntoView({ block: 'start' });
        }
        el('zohoCatalogSearch')?.focus();
        renderZohoCatalogPanel().catch((err) => toastOperatorError(err));
    }
}

export function focusZohoCatalogInProducts() {
    setCatalogPanelOpen(true);
}

window.focusZohoCatalogInProducts = focusZohoCatalogInProducts;

async function renderProductList() {
    const host = el('productsContent');
    if (!host) return;
    const q = el('productSearch')?.value || '';
    const status = el('productStatusFilter')?.value || '';
    const origin = el('productOriginFilter')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (origin) params.set('origin', origin);
    params.set('limit', '200');
    const data = await api(`/api/products?${params.toString()}`);
    const products = data.products || [];
    if (el('productCountBadge')) {
        el('productCountBadge').textContent = `${data.total ?? products.length} AssetEngine Products`;
    }
    if (!products.length) {
        host.innerHTML = emptyState({
            title: 'No AssetEngine Products found.',
            body: 'AssetEngine Products define what we buy and track. Create Against Zoho Products, or add a Standalone AE Product and link it later.',
            actionLabel: canLogistics() ? 'Create Against Zoho Products' : '',
            actionView: canLogistics() ? 'products-view' : '',
            actionAttr: 'id="btnEmptyCreateCatalog"'
        });
        host.querySelector('#btnEmptyCreateCatalog')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderCatalogCreate().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        <div style="display:flex;gap:16px;align-items:flex-start;min-height:0;">
            <div style="flex:1;min-width:0;overflow:auto;">
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                            <th style="padding:8px;">Product ID</th>
                            <th style="padding:8px;">Name</th>
                            <th style="padding:8px;">Make</th>
                            <th style="padding:8px;">Model</th>
                            <th style="padding:8px;">Status</th>
                            <th style="padding:8px;">Zoho mapping</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map((p) => `
                            <tr data-product-open="${escapeHtml(p.id)}" style="cursor:pointer;border-bottom:1px solid #f3f4f6;${selectedId === p.id ? 'background:#eff6ff;' : ''}">
                                <td class="prd-id-td"><div class="prd-id-cell"><span class="lc-mono">${escapeHtml(p.id)}</span> ${aeProvPill()}</div></td>
                                <td class="prd-name-td">${aeProductNameCellHtml(p)}</td>
                                <td style="padding:8px;">${dash(p.make)}</td>
                                <td style="padding:8px;">${dash(p.model)}</td>
                                <td style="padding:8px;">${statusChip(p.status)}</td>
                                <td style="padding:8px;">${aeMappingHtml(p)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div id="productDetailPanel" style="width:min(520px,42%);flex-shrink:0;max-height:calc(100vh - 220px);overflow:auto;"></div>
        </div>
    `;
    host.querySelectorAll('[data-product-open]').forEach((row) => {
        const id = row.getAttribute('data-product-open');
        const product = products.find((item) => String(item.id) === String(id));
        const name = product && product.name ? String(product.name).trim() : '';
        const description = product && product.description ? String(product.description).trim() : '';
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        row.setAttribute(
            'aria-label',
            `AssetEngine Product ${id}${name ? `. ${name}` : ''}${description ? `. ${description}` : ''}`
        );
        row.addEventListener('click', () => openProductDetail(id));
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                row.click();
            }
        });
    });
    if (selectedId) {
        openProductDetail(selectedId).catch((err) => toastOperatorError(err));
    }
}

function inputField(id, label, value, { note, type = 'text' } = {}) {
    return `<label class="lc-own-note" for="${id}">${escapeHtml(label)}</label>
        ${note ? `<div class="lc-own-note">${escapeHtml(note)}</div>` : ''}
        ${type === 'textarea'
            ? `<textarea id="${id}" rows="3" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;">${escapeHtml(value || '')}</textarea>`
            : `<input id="${id}" value="${escapeHtml(value == null ? '' : value)}" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;">`}`;
}

async function openProductDetail(id) {
    selectedId = id;
    const panel = el('productDetailPanel');
    if (!panel) return;
    const [productRes, refsRes, conflictsRes, posRes, setsRes, invRes] = await Promise.all([
        api(`/api/products/${encodeURIComponent(id)}`),
        api(`/api/products/${encodeURIComponent(id)}/external-refs`),
        api(`/api/products/${encodeURIComponent(id)}/conflicts`).catch(() => ({ conflicts: [] })),
        api('/api/procurement/pos?limit=200').catch(() => ({ purchaseOrders: [] })),
        api('/api/sets').catch(() => ({ sets: [] })),
        api('/api/inventory/items').catch(() => ({ items: [] }))
    ]);
    const p = productRes.product;
    const refs = refsRes.refs || [];
    const zohoRef = refs.find((r) => r.system === 'ZOHO_CRM' && r.module === 'Products') || refs[0] || null;
    const logistics = canLogistics();
    const editable = logistics && p.status === 'ACTIVE';
    const openConflict = (conflictsRes.conflicts || []).find((c) => c.status === 'OPEN') || p.open_conflict || null;
    const relatedPos = (posRes.purchaseOrders || []).filter((po) =>
        (po.lines || []).some((line) => String(line.productId || '') === String(p.id))
    );
    const outstanding = relatedPos.reduce((sum, po) => {
        return sum + (po.lines || [])
            .filter((line) => String(line.productId || '') === String(p.id))
            .reduce((s, line) => s + Number(line.outstanding || 0), 0);
    }, 0);
    const usedInSets = (setsRes.sets || []).filter((set) =>
        (set.requirements || []).some((r) => String(r.productId || r.product_id) === String(p.id))
        || String(set.productId || '') === String(p.id)
    );
    const originatingSet = p.origin === 'SET' ? p.origin_ref : null;
    const assets = (window.allAssets || window.assets || []).filter((a) =>
        String(a.product_id || a.productId || '') === String(p.id)
    );
    const inventory = (invRes.items || []).filter((item) =>
        String(item.product_id || item.productId || '') === String(p.id)
    );

    const lastSync = zohoRef
        ? (zohoRef.last_pushed_at || zohoRef.last_pulled_at || zohoRef.updated_at || p.updated_at)
        : null;

    panel.innerHTML = `
        ${crumb([
            { label: 'Product' },
            { label: 'Purchase Orders', view: 'purchase-orders-view' },
            { label: 'Stock', view: 'home-view' }
        ])}
        ${section('AssetEngine Product', `
            <div class="prd-id-cell" style="margin-bottom:6px;">${aeProvPill()} ${aeMappingHtml(p)}</div>
            <h3 style="margin:6px 0 4px;">${dash(p.name)}</h3>
            <div class="lc-mono" title="${escapeHtml(AE_PROV_TITLE)}">${escapeHtml(p.id)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;">${statusChip(p.status)}</div>
            ${editable ? `
                ${inputField('prdEditName', 'Name', p.name, { note: 'Co-managed with Zoho. Conflicts use the existing resolve workflow.' })}
                ${inputField('prdEditDescription', 'Description', p.description, { note: 'AssetEngine is authoritative.', type: 'textarea' })}
            ` : `
                ${fieldRow('Name', dash(p.name))}
                ${fieldRow('Description', dash(p.description))}
            `}
            <div class="lc-field-group">
                <div class="lc-section-label">Logistics identity</div>
                ${editable ? `
                    ${inputField('prdEditMake', 'Make', p.make, { note: 'Logistics-owned' })}
                    ${inputField('prdEditModel', 'Model', p.model, { note: 'Logistics-owned' })}
                    ${inputField('prdEditManufacturer', 'Manufacturer', p.manufacturer, { note: 'Logistics-owned' })}
                    ${inputField('prdEditHsn', 'HSN', p.hsn_code, { note: 'Logistics-owned' })}
                    ${inputField('prdEditUnit', 'Unit', p.unit, { note: 'Logistics-owned' })}
                    ${inputField('prdEditCode', 'SKU / Product code', p.product_code, { note: 'Optional' })}
                ` : `
                    ${fieldRow('Make', dash(p.make))}
                    ${fieldRow('Model', dash(p.model))}
                    ${fieldRow('Manufacturer', dash(p.manufacturer))}
                    ${fieldRow('HSN', dash(p.hsn_code))}
                    ${fieldRow('Unit', dash(p.unit))}
                    ${fieldRow('SKU', dash(p.product_code))}
                    ${fieldRow('Category / origin', dash(p.origin))}
                `}
            </div>
            <div class="lc-field-group">
                <div class="lc-section-label">Price</div>
                ${editable
                    ? inputField('prdEditPrice', 'Price', p.price, { note: 'Manual. Not auto-synced to Zoho.' })
                    : fieldRow('Price', dash(p.price))}
            </div>
            ${editable ? `
                <button type="button" class="action-button blue" id="btnSaveProduct" style="margin-top:12px;">Save logistics fields</button>
                <button type="button" class="action-button grey" id="btnArchiveProduct" style="margin-top:12px;">Archive</button>
            ` : (p.status === 'ARCHIVED' && logistics ? '<button type="button" class="action-button green" id="btnRestoreProduct" style="margin-top:12px;">Restore</button>' : '')}
            ${!logistics ? '<p class="lc-muted">Sales can view commercial fields. Logistics owns mapping, identity, and publish.</p>' : ''}
        `)}
        ${section('Commercial / Zoho', `
            ${fieldRow('Zoho Reference', zohoRef ? `<span class="prd-id-cell">${zohoProvPill()} <span class="lc-mono">${escapeHtml(zohoRef.external_id)}</span></span>` : 'Not Linked')}
            ${fieldRow('Mapping', aeMappingHtml(p))}
            ${fieldRow('Last sync', formatWhen(lastSync))}
            ${openConflict ? `
                <div style="margin:12px 0;padding:12px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;">
                    <div class="lc-section-label" style="color:#991b1b;">Name conflict</div>
                    ${fieldRow('AssetEngine', dash(openConflict.ae_name))}
                    ${fieldRow('Zoho', dash(openConflict.zoho_name))}
                    ${logistics ? `
                        <button type="button" class="action-button blue" id="btnConflictAe" style="margin-top:8px;">Use AssetEngine Name</button>
                        <button type="button" class="action-button grey" id="btnConflictZoho" style="margin-top:8px;">Use Zoho Name</button>
                    ` : ''}
                </div>
            ` : ''}
            ${logistics && p.status === 'ACTIVE' ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
                    ${!zohoRef ? '<button type="button" class="action-button blue" id="btnLinkZoho">Link to Zoho Reference</button>' : ''}
                    <button type="button" class="action-button green" id="btnPublishZoho">Publish to Zoho</button>
                    ${zohoRef ? '<button type="button" class="action-button grey" id="btnRefreshZoho">Refresh from Zoho</button>' : ''}
                </div>
            ` : ''}
            <div id="productLinkWizard" style="margin-top:12px;"></div>
        `)}
        ${section('Procurement', relatedPos.length ? `
            <div class="lc-muted">Outstanding on imported POs: <strong>${formatQty(outstanding)}</strong></div>
            <ul class="lc-event-list">${relatedPos.map((po) => `
                <li><button type="button" class="lc-crumb-link" data-lc-go="purchase-orders-view" data-lc-open="${escapeHtml(po.id)}">${escapeHtml(po.poNumber || po.id)}</button>
                · ${statusChip(po.status)} · receiving ${escapeHtml(String((po.lines || []).filter((l) => l.productId === p.id).map((l) => l.outstanding).join(', ') || '—'))}</li>
            `).join('')}</ul>
        ` : '<p class="lc-muted">No imported Purchase Orders for this Product.</p>')}
        ${section('Sets', `
            ${originatingSet ? `<p>Originating Set: <button type="button" class="lc-crumb-link" data-lc-go="sets-view" data-lc-open="${escapeHtml(originatingSet)}">${escapeHtml(originatingSet)}</button></p>` : ''}
            ${usedInSets.length ? `<ul class="lc-event-list">${usedInSets.map((s) => `
                <li>Requirement in <button type="button" class="lc-crumb-link" data-lc-go="sets-view" data-lc-open="${escapeHtml(s.id)}">${escapeHtml(s.name || s.id)}</button></li>
            `).join('')}</ul>` : '<p class="lc-muted">Not used as a Set requirement.</p>'}
        `)}
        ${section('Physical', `
            <p class="lc-muted">Physical stock is not the Product. Assets are identified holdings. Inventory is quantity-tracked.</p>
            <div class="lc-kv">
                <div><div class="lc-k">Assets</div><div>${assets.length
                    ? assets.slice(0, 8).map((a) => `<div><button type="button" class="lc-crumb-link" data-lc-go="home-view" data-lc-open="${escapeHtml(a.ID || a.id)}">${escapeHtml(a.ID || a.id)}</button></div>`).join('')
                    : '—'}</div></div>
                <div><div class="lc-k">Inventory</div><div>${inventory.length
                    ? inventory.slice(0, 8).map((item) => `<div><button type="button" class="lc-crumb-link" data-lc-go="inventory-view" data-lc-open="${escapeHtml(item.id || item.ID)}">${escapeHtml(item.id || item.ID)}</button></div>`).join('')
                    : '—'}</div></div>
            </div>
        `)}
        ${section('History', `<button type="button" class="action-button grey" data-lc-go="history-view" data-lc-open="${escapeHtml(p.id)}">Open lifecycle history</button>
            <p class="lc-muted" style="margin-top:8px;">Updated ${formatWhen(p.updated_at)} · ${dash(p.updated_by)}</p>`)}
    `;

    el('btnSaveProduct')?.addEventListener('click', async () => {
        try {
            const priceRaw = el('prdEditPrice')?.value;
            await api(`/api/products/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: el('prdEditName')?.value,
                    description: el('prdEditDescription')?.value,
                    make: el('prdEditMake')?.value,
                    model: el('prdEditModel')?.value,
                    manufacturer: el('prdEditManufacturer')?.value,
                    hsn_code: el('prdEditHsn')?.value,
                    unit: el('prdEditUnit')?.value,
                    product_code: el('prdEditCode')?.value,
                    price: priceRaw === '' ? null : priceRaw
                })
            });
            showToast('Product updated', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnArchiveProduct')?.addEventListener('click', async () => {
        try {
            await api(`/api/products/${encodeURIComponent(id)}/archive`, { method: 'POST' });
            showToast('Product archived', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnRestoreProduct')?.addEventListener('click', async () => {
        try {
            await api(`/api/products/${encodeURIComponent(id)}/restore`, { method: 'POST' });
            showToast('Product restored', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnPublishZoho')?.addEventListener('click', async () => {
        if (!confirmAction('Publish this AssetEngine Product to Zoho? Price is not sent.')) return;
        try {
            const result = await api(`/api/products/${encodeURIComponent(id)}/publish`, { method: 'POST' });
            showToast(result.skipped ? 'Publish skipped (unchanged)' : `Published (${result.mode}) ${result.zohoId}`, 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnRefreshZoho')?.addEventListener('click', async () => {
        try {
            await api(`/api/products/${encodeURIComponent(id)}/refresh-zoho`, { method: 'POST' });
            showToast('Refreshed from Zoho', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnLinkZoho')?.addEventListener('click', () => openLinkWizard(id));
    el('btnConflictAe')?.addEventListener('click', async () => {
        if (!confirmAction('Use the AssetEngine name and update the shared baseline?')) return;
        try {
            await api(`/api/products/${encodeURIComponent(id)}/conflicts/${encodeURIComponent(openConflict.id)}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution: 'AE_WINS' })
            });
            showToast('Conflict resolved: AssetEngine name', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnConflictZoho')?.addEventListener('click', async () => {
        if (!confirmAction('Replace the AssetEngine name with the Zoho name?')) return;
        try {
            await api(`/api/products/${encodeURIComponent(id)}/conflicts/${encodeURIComponent(openConflict.id)}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution: 'ZOHO_WINS' })
            });
            showToast('Conflict resolved: Zoho name', 'success');
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
}

async function openLinkWizard(productId) {
    const host = el('productLinkWizard');
    if (!host) return;
    host.innerHTML = '<div class="lc-muted">Loading unlinked Zoho Reference Catalog…</div>';
    try {
        const data = await api('/api/zoho/catalog?unlinked=1');
        const rows = data.catalog || [];
        if (!rows.length) {
            host.innerHTML = '<div class="lc-muted">No unlinked Zoho Reference Catalog records. Pull the catalog first, or publish this AssetEngine Product.</div>';
            return;
        }
        host.innerHTML = `
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
                <div class="lc-section-label">Link unmapped Zoho Reference</div>
                <select id="prdLinkCatalog" style="width:100%;margin-top:8px;padding:6px;">
                    ${rows.map((r) => `<option value="${escapeHtml(r.zoho_product_id)}">${escapeHtml(r.product_name)} (${escapeHtml(r.zoho_product_id)})</option>`).join('')}
                </select>
                <button type="button" class="action-button blue" id="btnConfirmLink" style="margin-top:8px;">Link selected</button>
            </div>
        `;
        el('btnConfirmLink')?.addEventListener('click', async () => {
            const zohoId = el('prdLinkCatalog')?.value;
            if (!zohoId) return;
            if (!confirmAction(`Link this AssetEngine Product to Zoho Reference ${zohoId}?`)) return;
            try {
                await api(`/api/products/${encodeURIComponent(productId)}/external-refs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system: 'ZOHO_CRM',
                        module: 'Products',
                        external_id: String(zohoId),
                        link_origin: 'PULL'
                    })
                });
                showToast('Linked to Zoho Reference', 'success');
                await renderProductList();
            } catch (err) {
                toastOperatorError(err);
            }
        });
    } catch (err) {
        host.innerHTML = `<div style="color:#991b1b;font-size:12px;">${escapeHtml(err.message)}</div>`;
    }
}

async function renderCatalogCreate() {
    const host = el('productsContent');
    if (!host) return;
    if (!canLogistics()) {
        showToast('Logistics role required to create AssetEngine Products.', 'error');
        return;
    }
    host.innerHTML = '<p class="lc-muted">Loading unlinked Zoho References…</p>';
    const [data, mapping] = await Promise.all([
        api('/api/zoho/catalog?unlinked=1'),
        loadCatalogMapping(true)
    ]);
    const rows = (data.catalog || []).filter((row) => !mapping.get(String(row.zoho_product_id || '')));
    if (!rows.length) {
        host.innerHTML = `
            <button type="button" class="action-button grey" id="btnCatalogBack">← AssetEngine Products</button>
            ${emptyState({
                title: 'No unlinked Zoho Reference Catalog records found.',
                body: 'Every listed Zoho Reference already has an AssetEngine Product, or the catalog has not been pulled. Use Standalone AE Product to create one without a Zoho Reference.',
                actionLabel: '',
                actionView: 'products-view',
                actionAttr: 'id="btnEmptyLocalProduct"'
            })}
            ${standaloneProductButton('btnEmptyLocalProduct')}`;
        el('btnCatalogBack')?.addEventListener('click', () => renderProductList().catch((e) => toastOperatorError(e)));
        el('btnEmptyLocalProduct')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            createLocalProduct().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        <div class="lc-detail-head" style="margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnCatalogBack">← AssetEngine Products</button>
        </div>
        <h3 style="margin:0 0 8px;">Create Against Zoho Products</h3>
        <p class="lc-muted">Only Zoho References without an AssetEngine Product are listed. Review a row, then create. This does not create Inventory or Assets.</p>
        <div id="catalogStepList">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                        <th style="padding:8px;">Zoho Reference</th>
                        <th style="padding:8px;">Name</th>
                        <th style="padding:8px;">Make</th>
                        <th style="padding:8px;">Model</th>
                        <th style="padding:8px;">SKU</th>
                        <th style="padding:8px;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r) => `
                        <tr style="border-bottom:1px solid #f3f4f6;">
                            <td style="padding:8px;"><div class="prd-id-cell">${zohoProvPill()} <span class="lc-mono">${escapeHtml(r.zoho_product_id)}</span></div></td>
                            <td style="padding:8px;">${dash(r.product_name)}</td>
                            <td style="padding:8px;">${dash(r.make)}</td>
                            <td style="padding:8px;">${dash(r.model)}</td>
                            <td style="padding:8px;">${dash(r.sku)}</td>
                            <td style="padding:8px;"><button type="button" class="action-button blue" data-catalog-review="${escapeHtml(r.zoho_product_id)}">Review</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div id="catalogReviewHost"></div>
    `;
    el('btnCatalogBack')?.addEventListener('click', () => renderProductList().catch((e) => toastOperatorError(e)));
    host.querySelectorAll('[data-catalog-review]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const zohoId = btn.getAttribute('data-catalog-review');
            const row = rows.find((r) => String(r.zoho_product_id) === String(zohoId));
            const review = el('catalogReviewHost');
            if (!row || !review) return;
            review.innerHTML = section('Review mapping', `
                <p>This Zoho Reference will become an AssetEngine Product. Physical stock is not created.</p>
                <div class="lc-kv">
                    <div><div class="lc-k">Zoho Reference</div><div class="lc-mono">${escapeHtml(row.zoho_product_id)}</div></div>
                    <div><div class="lc-k">Name</div><div>${dash(row.product_name)}</div></div>
                    <div><div class="lc-k">Make</div><div>${dash(row.make)}</div></div>
                    <div><div class="lc-k">Model</div><div>${dash(row.model)}</div></div>
                    <div><div class="lc-k">HSN</div><div>${dash(row.hsn_code)}</div></div>
                    <div><div class="lc-k">SKU</div><div>${dash(row.sku)}</div></div>
                </div>
                <button type="button" class="action-button blue" id="btnConfirmCreateFromCatalog" aria-label="Create Against Zoho Products" style="margin-top:12px;">Create Against Zoho Products</button>
            `);
            el('btnConfirmCreateFromCatalog')?.addEventListener('click', () => {
                createAgainstZohoProduct(row.zoho_product_id).catch((err) => toastOperatorError(err));
            });
        });
    });
}

async function createLocalProduct() {
    const name = window.prompt('Standalone AE Product name');
    if (!name || !String(name).trim()) return;
    const product = await api('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: String(name).trim() })
    });
    showToast(`Created ${product.product.id}`, 'success');
    selectedId = product.product.id;
    await renderProductList();
}

export function initProductsView() {
    const logistics = canLogistics();
    if (el('btnCreateProduct')) el('btnCreateProduct').style.display = logistics ? '' : 'none';
    if (el('btnCreateFromCatalog')) el('btnCreateFromCatalog').style.display = logistics ? '' : 'none';
    const bootProducts = () => {
        const pending = consumeOpen('products-view');
        const jobs = [renderProductList().then(() => {
            if (pending && pending.open) return openProductDetail(pending.open);
        })];
        if (catalogPanelIsOpen()) jobs.push(renderZohoCatalogPanel());
        return Promise.all(jobs);
    };
    if (viewListenersBound) {
        bootProducts().catch((err) => toastOperatorError(err));
        return;
    }
    viewListenersBound = true;
    el('btnReloadProducts')?.addEventListener('click', () => {
        catalogCache = null;
        catalogMappingByZohoId = null;
        const jobs = [renderProductList()];
        if (catalogPanelIsOpen()) jobs.push(renderZohoCatalogPanel({ force: true }));
        Promise.all(jobs).catch((e) => toastOperatorError(e));
    });
    el('btnOpenZohoCatalog')?.addEventListener('click', () => {
        setCatalogPanelOpen(!catalogPanelIsOpen());
    });
    el('btnCloseZohoCatalog')?.addEventListener('click', () => {
        setCatalogPanelOpen(false);
    });
    el('btnCreateProduct')?.addEventListener('click', () => {
        if (!canLogistics()) {
            showToast('Logistics role required', 'error');
            return;
        }
        createLocalProduct().catch((err) => toastOperatorError(err));
    });
    el('btnCreateFromCatalog')?.addEventListener('click', () => {
        renderCatalogCreate().catch((err) => toastOperatorError(err));
    });
    el('productSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderProductList().catch((err) => toastOperatorError(err));
    });
    el('productStatusFilter')?.addEventListener('change', () => renderProductList().catch((err) => toastOperatorError(err)));
    el('productOriginFilter')?.addEventListener('change', () => renderProductList().catch((err) => toastOperatorError(err)));
    el('zohoCatalogSearch')?.addEventListener('input', () => {
        if (!catalogPanelIsOpen()) return;
        scheduleCatalogSearch();
    });
    el('zohoCatalogSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (catalogSearchTimer) clearTimeout(catalogSearchTimer);
            renderZohoCatalogPanel().catch((err) => toastOperatorError(err));
        }
    });
    bootProducts().catch((err) => toastOperatorError(err));
    void fetchWithAuth;
    void go;
}

window.initProductsView = initProductsView;
window.openProductDetail = openProductDetail;
window.openProductCatalogCreate = () => renderCatalogCreate().catch((err) => toastOperatorError(err));
