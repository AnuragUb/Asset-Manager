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
} from './lifecycle.js?v=7.76';

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

async function createAgainstZohoProduct(zohoProductId, { confirmed = false } = {}) {
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
        if (!confirmed) {
            await openCreateFromZohoModal(zohoProductId);
            return;
        }
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
let selectedCatalogZohoId = null;
let catalogCache = null;
let catalogMappingByZohoId = null;
let catalogSearchTimer = null;
let productSearchTimer = null;
let viewMode = sessionStorage.getItem('ae.products.view') === 'list' ? 'list' : 'cards';
let statusFilter = '';
let linkedFilter = '';
let unsyncedFilter = '';
let lastProducts = [];
let lastUnlinkedRefs = [];
let lastQuery = '';
let lastTotal = 0;
let productPage = 0;
const PRODUCT_CARD_PAGE_SIZE = 16; // 4 columns × 4 rows
const PRODUCT_LIST_PAGE_SIZE = 8; // 8 list rows per page
const RECENT_CARD_COUNT = 4;

function productPageSize() {
    return viewMode === 'list' ? PRODUCT_LIST_PAGE_SIZE : PRODUCT_CARD_PAGE_SIZE;
}

function productSourceLabel(product) {
    const origin = String(product.origin || '').toUpperCase();
    if (origin === 'ZOHO') return 'ZOHO-DERIVED';
    if (origin === 'ASSETENGINE') return 'STANDALONE AE';
    return origin || 'STANDALONE AE';
}

function isZohoUnsyncedFilter() {
    return String(el('productSourceFilter')?.value || '') === 'ZOHO_UNSYNCED' || unsyncedFilter === '1';
}

function setZohoUnsyncedFilter(on) {
    unsyncedFilter = on ? '1' : '';
    if (on) {
        statusFilter = '';
        linkedFilter = '';
        if (el('productSourceFilter')) el('productSourceFilter').value = 'ZOHO_UNSYNCED';
    } else if (el('productSourceFilter')?.value === 'ZOHO_UNSYNCED') {
        el('productSourceFilter').value = '';
    }
}

function relativeCreatedLabel(iso) {
    if (!iso) return '';
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const startThat = new Date(ts);
    startThat.setHours(0, 0, 0, 0);
    const days = Math.round((startToday - startThat) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 14) return `${days} days ago`;
    return formatWhen(iso);
}

function zohoMapLabel(product) {
    const status = String(product.sync_status || (product.zoho_external_id ? 'LINKED' : 'UNLINKED')).toUpperCase();
    if (status === 'UNLINKED') return 'Not Linked';
    if (status === 'FAILED' || status === 'CONFLICT') return 'Sync Issue';
    return 'Linked';
}

function syncHealthLabel(product) {
    const status = String(product.sync_status || '').toUpperCase();
    if (!status || status === 'UNLINKED') return 'Not synchronized';
    if (status === 'SYNCED') return 'Synced';
    if (status === 'LINKED') return 'Sync pending';
    if (status === 'FAILED' || status === 'CONFLICT') return 'Sync issue';
    return status;
}

function filtersActive() {
    return Boolean(
        String(el('productSearch')?.value || '').trim()
        || statusFilter
        || linkedFilter
        || unsyncedFilter
        || String(el('productSourceFilter')?.value || '').trim()
    );
}

function setViewMode(mode) {
    viewMode = mode === 'list' ? 'list' : 'cards';
    sessionStorage.setItem('ae.products.view', viewMode);
    el('btnProductViewCards')?.classList.toggle('is-on', viewMode === 'cards');
    el('btnProductViewList')?.classList.toggle('is-on', viewMode === 'list');
    el('btnProductViewCards')?.setAttribute('aria-pressed', viewMode === 'cards' ? 'true' : 'false');
    el('btnProductViewList')?.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
}

function syncFilterChips() {
    const unsyncedOn = isZohoUnsyncedFilter();
    document.querySelectorAll('#products-view [data-prd-status]').forEach((btn) => {
        const on = !unsyncedOn && String(btn.getAttribute('data-prd-status') || '') === String(statusFilter || '');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#products-view [data-prd-linked]').forEach((btn) => {
        const on = !unsyncedOn && linkedFilter === '1';
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#products-view [data-prd-unsynced]').forEach((btn) => {
        btn.classList.toggle('is-on', unsyncedOn);
        btn.setAttribute('aria-pressed', unsyncedOn ? 'true' : 'false');
    });
    if (unsyncedOn && el('productSourceFilter') && el('productSourceFilter').value !== 'ZOHO_UNSYNCED') {
        el('productSourceFilter').value = 'ZOHO_UNSYNCED';
    }
}

function closeProductCreateModal() {
    const modal = el('productCreateModal');
    if (modal) modal.style.display = 'none';
}

function openProductCreateModal(title, bodyHtml) {
    const modal = el('productCreateModal');
    const titleEl = el('productCreateModalTitle');
    const body = el('productCreateModalBody');
    if (!modal || !body) return;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = bodyHtml;
    modal.style.display = 'flex';
    const focusable = body.querySelector('input, select, textarea, button');
    focusable?.focus();
}

function catalogSearchNeedle(row) {
    return [
        row.product_name,
        row.sku,
        row.make,
        row.model,
        row.hsn_code,
        row.usage_unit,
        row.created_by,
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
                                <th style="padding:8px;">Created By</th>
                                <th style="padding:8px;">Usage</th>
                                <th style="padding:8px;">HSN</th>
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
                                    <td style="padding:8px;">${dash(row.created_by)}</td>
                                    <td style="padding:8px;">${dash(row.usage_unit)}</td>
                                    <td style="padding:8px;">${dash(row.hsn_code)}</td>
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
                openCreateFromZohoModal(btn.getAttribute('data-create-against')).catch((err) => toastOperatorError(err));
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
            ${catalogDetailFieldsHtml(row)}
            ${fieldRow('Zoho Product ID', `<span class="lc-mono">${escapeHtml(row.zoho_product_id)}</span>`)}
            ${fieldRow('Description', dash(row.description))}
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
        openCreateFromZohoModal(row.zoho_product_id).catch((err) => toastOperatorError(err));
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

function catalogFactsRows(row) {
    return [
        ['Make', row.make],
        ['Model', row.model],
        ['Created By', row.created_by],
        ['Usage', row.usage_unit],
        ['HSN Code', row.hsn_code]
    ];
}

function catalogCardFactsHtml(row) {
    return `<dl class="prd-card-facts">${catalogFactsRows(row).map(([label, value]) => `
        <div class="prd-card-fact">
            <dt>${escapeHtml(label)}</dt>
            <dd>${dash(value)}</dd>
        </div>`).join('')}</dl>`;
}

function catalogDetailFieldsHtml(row) {
    return catalogFactsRows(row).map(([label, value]) => fieldRow(label, dash(value))).join('');
}

function productCardHtml(product, { recent = false } = {}) {
    const selected = selectedId === product.id;
    const linked = Boolean(product.zoho_external_id);
    const desc = String(product.description || '').trim();
    const match = product.matched_on ? `<div class="prd-match-hint">Matched: ${escapeHtml(product.matched_on)}</div>` : '';
    const when = recent ? relativeCreatedLabel(product.created_at || product.createdAt) : '';
    return `<button type="button" class="prd-card ops-glossy-surface ops-lift${selected ? ' is-selected' : ''}" data-product-open="${escapeHtml(product.id)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="AssetEngine Product ${escapeHtml(product.id)}. ${escapeHtml(product.name || '')}">
        <div class="prd-card-top">
            ${product.origin === 'ZOHO' ? zohoProvPill() : aeProvPill()}
            ${when ? `<span class="prd-card-when">${escapeHtml(when)}</span>` : ''}
        </div>
        <div class="prd-card-name">${dash(product.name)}</div>
        ${catalogCardFactsHtml({
            make: product.make,
            model: product.model,
            created_by: product.created_by,
            usage_unit: product.unit,
            hsn_code: product.hsn_code
        })}
        <div class="prd-card-id lc-mono">${escapeHtml(product.id)}</div>
        ${desc ? `<div class="prd-card-desc">${escapeHtml(desc.length > 120 ? `${desc.slice(0, 117)}…` : desc)}</div>` : ''}
        <div class="prd-card-zoho">${linked
            ? `<span class="prd-id-cell">${zohoProvPill()} <span class="lc-mono">${escapeHtml(product.zoho_external_id)}</span></span>`
            : mapChip('Not Linked', 'none')}</div>
        <div class="prd-card-foot">${statusChip(product.status)} ${mapChip(zohoMapLabel(product), linked ? 'linked' : 'none')}</div>
        ${match}
    </button>`;
}

function catalogRefCardHtml(row) {
    const logistics = canLogistics();
    const selected = String(selectedCatalogZohoId || '') === String(row.zoho_product_id || '');
    return `<button type="button" class="prd-card prd-card-ref ops-glossy-surface${selected ? ' is-selected' : ''}" data-catalog-ref-open="${escapeHtml(row.zoho_product_id)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="Zoho Reference ${escapeHtml(row.product_name || row.zoho_product_id || '')}">
        <div class="prd-card-top">${zohoProvPill()} <span class="prd-match-hint">Zoho Reference</span></div>
        <div class="prd-card-name">${dash(row.product_name)}</div>
        ${catalogCardFactsHtml(row)}
        <div class="prd-card-id lc-mono">Zoho Product ID: ${escapeHtml(row.zoho_product_id)}</div>
        <div class="prd-card-foot">${mapChip('Reference Only', 'ref')}
            ${logistics ? `<span class="action-button blue" data-create-against="${escapeHtml(row.zoho_product_id)}" role="button">Create AssetEngine Product</span>` : ''}
        </div>
        ${row.matched_on ? `<div class="prd-match-hint">Matched: ${escapeHtml(row.matched_on)}</div>` : ''}
    </button>`;
}

function openCatalogRefDetail(row) {
    selectedId = null;
    selectedCatalogZohoId = row ? String(row.zoho_product_id || '') : null;
    document.querySelectorAll('#products-view [data-product-open]').forEach((node) => {
        node.classList.remove('is-selected');
        node.setAttribute('aria-pressed', 'false');
        if (node.tagName === 'TR') node.style.background = '';
    });
    document.querySelectorAll('#products-view [data-catalog-ref-open]').forEach((node) => {
        const on = String(node.getAttribute('data-catalog-ref-open')) === String(selectedCatalogZohoId || '');
        node.classList.toggle('is-selected', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const panel = el('productDetailPanel');
    if (!panel) return;
    if (!row) {
        panel.innerHTML = '<p class="lc-muted prd-detail-placeholder">Select a Zoho Reference to inspect.</p>';
        return;
    }
    const logistics = canLogistics();
    panel.innerHTML = `
        ${section('Zoho Product Catalog', `
            <div class="prd-id-cell" style="margin-bottom:6px;">${zohoProvPill()} ${mapChip('Reference Only', 'ref')}</div>
            <p class="lc-muted" style="margin-top:0;" title="${escapeHtml(ZOHO_PROV_TITLE)}">Read-only reference from Zoho. Not an AssetEngine Product.</p>
            <h3 style="margin:6px 0 4px;">${dash(row.product_name)}</h3>
            ${fieldRow('Product Code', dash(row.sku))}
            ${catalogDetailFieldsHtml(row)}
            ${fieldRow('Zoho Product ID', `<span class="lc-mono">${escapeHtml(row.zoho_product_id)}</span>`)}
            ${fieldRow('Description', dash(row.description))}
            ${fieldRow('AssetEngine Product', 'None — awaiting sync')}
            ${logistics
                ? '<button type="button" class="action-button blue" id="btnCreateFromCatalogDetail" aria-label="Create Against Zoho Products" style="margin-top:12px;">Create Against Zoho Products</button>'
                : ''}
        `)}
    `;
    el('btnCreateFromCatalogDetail')?.addEventListener('click', () => {
        openCreateFromZohoModal(row.zoho_product_id).catch((err) => toastOperatorError(err));
    });
}

function bindProductOpeners(root) {
    root.querySelectorAll('[data-product-open]').forEach((node) => {
        const id = node.getAttribute('data-product-open');
        const open = () => {
            selectedCatalogZohoId = null;
            openProductDetail(id).catch((err) => toastOperatorError(err));
        };
        node.addEventListener('click', open);
        if (node.tagName === 'TR' || node.getAttribute('role') === 'button') {
            node.setAttribute('tabindex', '0');
            node.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
        }
    });
    root.querySelectorAll('[data-catalog-ref-open]').forEach((node) => {
        const zohoId = node.getAttribute('data-catalog-ref-open');
        const open = () => {
            const row = (lastUnlinkedRefs || []).find((item) => String(item.zoho_product_id) === String(zohoId));
            if (row) openCatalogRefDetail(row);
        };
        node.addEventListener('click', (event) => {
            if (event.target.closest('[data-create-against]')) return;
            open();
        });
        node.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                if (event.target.closest('[data-create-against]')) return;
                event.preventDefault();
                open();
            }
        });
    });
    root.querySelectorAll('[data-create-against]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openCreateFromZohoModal(btn.getAttribute('data-create-against')).catch((err) => toastOperatorError(err));
        });
    });
}

function renderPager(total) {
    const pageSize = productPageSize();
    const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
    if (productPage > pages - 1) productPage = pages - 1;
    if (productPage < 0) productPage = 0;
    const from = total ? productPage * pageSize + 1 : 0;
    const to = Math.min(total, (productPage + 1) * pageSize);
    return `<div class="prd-pager" role="navigation" aria-label="Product pages">
        <span class="prd-pager-meta">${total ? `${from}–${to} of ${total}` : (isZohoUnsyncedFilter() ? '0 Zoho references' : '0 products')}</span>
        <div class="prd-pager-actions">
            <button type="button" class="action-button grey prd-pager-btn" id="btnProductPagePrev" ${productPage <= 0 ? 'disabled' : ''}>Previous</button>
            <span class="prd-pager-page">Page ${productPage + 1} of ${pages}</span>
            <button type="button" class="action-button grey prd-pager-btn" id="btnProductPageNext" ${productPage >= pages - 1 ? 'disabled' : ''}>Next</button>
        </div>
    </div>`;
}

function bindPager(host, total) {
    const pageSize = productPageSize();
    const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
    el('btnProductPagePrev')?.addEventListener('click', () => {
        if (productPage <= 0) return;
        productPage -= 1;
        renderProductList().catch((err) => toastOperatorError(err));
    });
    el('btnProductPageNext')?.addEventListener('click', () => {
        if (productPage >= pages - 1) return;
        productPage += 1;
        renderProductList().catch((err) => toastOperatorError(err));
    });
}

function renderBrowserBody(products, unlinkedRefs) {
    const catalogOnly = isZohoUnsyncedFilter();
    let pageProducts = products;
    let pageRefs = unlinkedRefs;
    if (catalogOnly) {
        const size = productPageSize();
        const start = productPage * size;
        pageProducts = [];
        pageRefs = unlinkedRefs.slice(start, start + size);
    } else {
        pageRefs = productPage === 0 ? unlinkedRefs : [];
    }
    if (viewMode === 'list') {
        return `<div class="prd-browser-pane">
            <div class="prd-browser-scroll">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                        <th style="padding:8px;">Product</th>
                        <th style="padding:8px;">Make</th>
                        <th style="padding:8px;">Model</th>
                        <th style="padding:8px;">Created By</th>
                        <th style="padding:8px;">Usage</th>
                        <th style="padding:8px;">HSN</th>
                        <th style="padding:8px;">Source</th>
                        <th style="padding:8px;">Status</th>
                        <th style="padding:8px;">Zoho</th>
                        ${lastQuery ? '<th style="padding:8px;">Matched</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${pageProducts.map((p) => `
                        <tr data-product-open="${escapeHtml(p.id)}" role="button" style="cursor:pointer;border-bottom:1px solid #f3f4f6;${selectedId === p.id ? 'background:#eff6ff;' : ''}">
                            <td class="prd-name-td">
                                <div class="prd-id-cell"><span class="lc-mono">${escapeHtml(p.id)}</span> ${p.origin === 'ZOHO' ? zohoProvPill() : aeProvPill()}</div>
                                ${aeProductNameCellHtml(p)}
                            </td>
                            <td style="padding:8px;">${dash(p.make)}</td>
                            <td style="padding:8px;">${dash(p.model)}</td>
                            <td style="padding:8px;">${dash(p.created_by)}</td>
                            <td style="padding:8px;">${dash(p.unit)}</td>
                            <td style="padding:8px;">${dash(p.hsn_code)}</td>
                            <td style="padding:8px;">${escapeHtml(productSourceLabel(p))}</td>
                            <td style="padding:8px;">${statusChip(p.status)}</td>
                            <td style="padding:8px;">${mapChip(zohoMapLabel(p), p.zoho_external_id ? 'linked' : 'none')}${p.zoho_external_id ? `<div class="lc-mono" style="font-size:11px;margin-top:2px;">${escapeHtml(p.zoho_external_id)}</div>` : ''}</td>
                            ${lastQuery ? `<td style="padding:8px;"><span class="prd-match-hint">${escapeHtml(p.matched_on || '—')}</span></td>` : ''}
                        </tr>`).join('')}
                    ${pageRefs.map((row) => `
                        <tr data-catalog-ref-open="${escapeHtml(row.zoho_product_id)}" role="button" style="cursor:pointer;border-bottom:1px solid #f3f4f6;background:${String(selectedCatalogZohoId || '') === String(row.zoho_product_id) ? '#eef2f6' : '#f8fafc'};">
                            <td class="prd-name-td">
                                <div class="prd-id-cell">${zohoProvPill()} <span class="lc-mono">${escapeHtml(row.zoho_product_id)}</span></div>
                                <div class="prd-name">${dash(row.product_name)}</div>
                                <div class="prd-desc">Zoho Reference · Not an AssetEngine Product</div>
                            </td>
                            <td style="padding:8px;">${dash(row.make)}</td>
                            <td style="padding:8px;">${dash(row.model)}</td>
                            <td style="padding:8px;">${dash(row.created_by)}</td>
                            <td style="padding:8px;">${dash(row.usage_unit)}</td>
                            <td style="padding:8px;">${dash(row.hsn_code)}</td>
                            <td style="padding:8px;">ZOHO REFERENCE</td>
                            <td style="padding:8px;">—</td>
                            <td style="padding:8px;">${mapChip('Reference Only', 'ref')}
                                ${canLogistics() ? `<button type="button" class="action-button blue" data-create-against="${escapeHtml(row.zoho_product_id)}" style="margin-top:6px;">Create AssetEngine Product</button>` : ''}
                            </td>
                            ${lastQuery ? `<td style="padding:8px;"><span class="prd-match-hint">${escapeHtml(row.matched_on || '—')}</span></td>` : ''}
                        </tr>`).join('')}
                </tbody>
            </table>
            </div>
            ${renderPager(lastTotal)}
        </div>`;
    }
    return `<div class="prd-browser-pane">
        <div class="prd-browser-scroll">
            <div class="prd-card-grid">
                ${pageProducts.map((p) => productCardHtml(p)).join('')}
                ${pageRefs.map((row) => catalogRefCardHtml(row)).join('')}
            </div>
        </div>
        ${renderPager(lastTotal)}
    </div>`;
}

async function renderRecentlyAdded() {
    const host = el('productsRecentlyAdded');
    if (!host) return;
    if (filtersActive()) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    try {
        const data = await api(`/api/products?limit=${RECENT_CARD_COUNT}&status=ACTIVE`);
        const rows = data.products || [];
        if (!rows.length) {
            host.hidden = true;
            host.innerHTML = '';
            return;
        }
        host.hidden = false;
        host.innerHTML = `
            <div class="prd-browser-head"><div class="lc-section-label" style="margin:0;">Recently Added</div></div>
            <div class="prd-recent-strip">${rows.map((p) => productCardHtml(p, { recent: true })).join('')}</div>`;
        bindProductOpeners(host);
    } catch (_err) {
        host.hidden = true;
    }
}

async function renderProductList({ resetPage = false } = {}) {
    const host = el('productsContent');
    if (!host) return;
    if (resetPage) productPage = 0;
    const q = el('productSearch')?.value || '';
    lastQuery = String(q || '').trim();
    const catalogOnly = isZohoUnsyncedFilter();
    if (catalogOnly) {
        unsyncedFilter = '1';
        if (el('productSourceFilter')) el('productSourceFilter').value = 'ZOHO_UNSYNCED';
        const data = await api('/api/zoho/catalog?unlinked=1');
        let rows = data.catalog || [];
        if (lastQuery) rows = filterCatalogRows(rows, lastQuery);
        lastProducts = [];
        lastUnlinkedRefs = rows;
        lastTotal = rows.length;
        const pages = Math.max(1, Math.ceil(lastTotal / productPageSize()) || 1);
        if (productPage > pages - 1 && lastTotal > 0) {
            productPage = pages - 1;
            return renderProductList();
        }
        if (el('productCountBadge')) {
            el('productCountBadge').textContent = `${lastTotal} Not Yet Synced`;
        }
        const browserHead = document.querySelector('#products-view .prd-ae-section .prd-browser-head .lc-section-label');
        if (browserHead) browserHead.textContent = 'Zoho Product Catalog · Not Yet Synced';
        await renderRecentlyAdded();
        if (!rows.length) {
            host.innerHTML = emptyState({
                title: 'No Zoho products waiting to sync.',
                body: 'Every Zoho Product Catalog item already has an AssetEngine Product, or the catalog has not been pulled yet.',
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
            <div class="prd-split">
                ${renderBrowserBody([], rows)}
                <aside id="productDetailPanel" class="prd-detail-pane" aria-label="Product detail inspector">
                    <p class="lc-muted prd-detail-placeholder">Select a Zoho Product Catalog card to inspect Make, Model, Created By, Usage, and HSN.</p>
                </aside>
            </div>`;
        bindProductOpeners(host);
        bindPager(host, lastTotal);
        if (selectedCatalogZohoId) {
            const selected = rows.find((row) => String(row.zoho_product_id) === String(selectedCatalogZohoId));
            if (selected) openCatalogRefDetail(selected);
        }
        return;
    }

    const source = el('productSourceFilter')?.value || '';
    const params = new URLSearchParams();
    if (lastQuery) params.set('q', lastQuery);
    if (statusFilter) params.set('status', statusFilter);
    if (source) params.set('source', source);
    if (linkedFilter) params.set('linked', linkedFilter);
    params.set('limit', String(productPageSize()));
    params.set('offset', String(productPage * productPageSize()));
    const data = await api(`/api/products?${params.toString()}`);
    const products = data.products || [];
    const unlinkedRefs = lastQuery ? (data.unlinked_catalog_refs || []) : [];
    lastProducts = products;
    lastUnlinkedRefs = unlinkedRefs;
    lastTotal = Number(data.total ?? products.length) || 0;
    const pages = Math.max(1, Math.ceil(lastTotal / productPageSize()));
    if (productPage > pages - 1 && lastTotal > 0) {
        productPage = pages - 1;
        return renderProductList();
    }
    if (el('productCountBadge')) {
        el('productCountBadge').textContent = `${lastTotal} AssetEngine Products`;
    }
    const browserHead = document.querySelector('#products-view .prd-ae-section .prd-browser-head .lc-section-label');
    if (browserHead) browserHead.textContent = 'All Products';
    await renderRecentlyAdded();
    if (!products.length && !unlinkedRefs.length) {
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
        <div class="prd-split">
            ${renderBrowserBody(products, unlinkedRefs)}
            <aside id="productDetailPanel" class="prd-detail-pane" aria-label="Product detail inspector">
                <p class="lc-muted prd-detail-placeholder">Select a Product to inspect.</p>
            </aside>
        </div>`;
    bindProductOpeners(host);
    bindPager(host, lastTotal);
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
    document.querySelectorAll('#products-view [data-product-open]').forEach((node) => {
        const on = String(node.getAttribute('data-product-open')) === String(id);
        node.classList.toggle('is-selected', on);
        if (node.tagName === 'TR') node.style.background = on ? '#eff6ff' : '';
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
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
        ${section('Product Overview', `
            <div class="prd-id-cell" style="margin-bottom:6px;">${aeProvPill()} ${aeMappingHtml(p)}</div>
            <p class="lc-muted" style="margin:0 0 8px;" title="${escapeHtml(AE_PROV_TITLE)}">AssetEngine Product = authoritative Product identity. Description is descriptive metadata, not identity.</p>
            <h3 style="margin:6px 0 4px;">${dash(p.name)}</h3>
            <div class="lc-mono">${escapeHtml(p.id)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;">${statusChip(p.status)} <span class="lc-chip">${escapeHtml(productSourceLabel(p))}</span></div>
            ${editable ? `
                ${inputField('prdEditName', 'Name', p.name, { note: 'Co-managed with Zoho. Conflicts use the existing resolve workflow.' })}
                ${inputField('prdEditDescription', 'Description', p.description, { note: 'Descriptive metadata · AssetEngine is authoritative.', type: 'textarea' })}
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
                    ${inputField('prdEditCode', 'OEM SKU / Product code', p.product_code, { note: 'Optional identity attribute' })}
                    ${inputField('prdEditHsn', 'HSN Code', p.hsn_code, { note: 'Logistics-owned' })}
                    ${inputField('prdEditUnit', 'Usage', p.unit, { note: 'Logistics-owned (Usage Unit)' })}
                    ${fieldRow('Created By', dash(p.created_by))}
                ` : `
                    ${fieldRow('Make', dash(p.make))}
                    ${fieldRow('Model', dash(p.model))}
                    ${fieldRow('Manufacturer', dash(p.manufacturer))}
                    ${fieldRow('OEM SKU', dash(p.product_code))}
                    ${fieldRow('HSN Code', dash(p.hsn_code))}
                    ${fieldRow('Usage', dash(p.unit))}
                    ${fieldRow('Created By', dash(p.created_by))}
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
            <p class="lc-muted">Zoho Product is commercial/reference identity — not the AssetEngine Product ID.</p>
            ${fieldRow('Zoho Product', zohoRef ? `<span class="prd-id-cell">${zohoProvPill()} <span class="lc-mono">${escapeHtml(zohoRef.external_id)}</span></span>` : 'Not Linked')}
            ${fieldRow('Zoho Product ID', zohoRef ? `<span class="lc-mono">${escapeHtml(zohoRef.external_id)}</span>` : '—')}
            ${fieldRow('Mapping', aeMappingHtml(p))}
            ${fieldRow('Sync', escapeHtml(syncHealthLabel(p)))}
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
                · ${statusChip(po.status)} · outstanding ${escapeHtml(String((po.lines || []).filter((l) => l.productId === p.id).map((l) => l.outstanding).join(', ') || '—'))}</li>
            `).join('')}</ul>
        ` : '<p class="lc-muted">No imported Purchase Orders for this Product.</p>')}
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
        ${section('Sets', `
            ${originatingSet ? `<p>Originating Set: <button type="button" class="lc-crumb-link" data-lc-go="sets-view" data-lc-open="${escapeHtml(originatingSet)}">${escapeHtml(originatingSet)}</button></p>` : ''}
            ${usedInSets.length ? `<ul class="lc-event-list">${usedInSets.map((s) => `
                <li>Requirement in <button type="button" class="lc-crumb-link" data-lc-go="sets-view" data-lc-open="${escapeHtml(s.id)}">${escapeHtml(s.name || s.id)}</button></li>
            `).join('')}</ul>` : '<p class="lc-muted">Not used as a Set requirement.</p>'}
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

async function openCreateFromZohoModal(preselectZohoId = null) {
    if (!canLogistics()) {
        showToast('Logistics role required to create AssetEngine Products.', 'error');
        return;
    }
    openProductCreateModal('Create AssetEngine Product from Zoho', '<p class="lc-muted">Loading unlinked Zoho References…</p>');
    const [data, mapping] = await Promise.all([
        api('/api/zoho/catalog?unlinked=1'),
        loadCatalogMapping(true)
    ]);
    const rows = (data.catalog || []).filter((row) => !mapping.get(String(row.zoho_product_id || '')));
    if (!rows.length) {
        openProductCreateModal('Create AssetEngine Product from Zoho', `
            <p class="lc-muted">No unlinked Zoho Reference Catalog records. Pull the catalog first, or use Standalone AE Product.</p>
            <button type="button" class="action-button grey" id="btnCreateModalClose">Close</button>
            <button type="button" class="action-button blue" id="btnCreateModalStandalone">Standalone AE Product</button>
        `);
        el('btnCreateModalClose')?.addEventListener('click', closeProductCreateModal);
        el('btnCreateModalStandalone')?.addEventListener('click', () => {
            closeProductCreateModal();
            createLocalProduct().catch((err) => toastOperatorError(err));
        });
        return;
    }
    const selected = preselectZohoId
        ? rows.find((r) => String(r.zoho_product_id) === String(preselectZohoId))
        : null;
    const paint = (row) => {
        if (!row) {
            openProductCreateModal('Create AssetEngine Product from Zoho', `
                <p class="lc-muted">This creates an AssetEngine Product. It does not create physical stock.</p>
                <label class="lc-own-note" for="prdCreateZohoPick">Select Zoho Reference</label>
                <select id="prdCreateZohoPick" style="width:100%;padding:8px;margin:6px 0 12px;">
                    <option value="">Choose…</option>
                    ${rows.map((r) => `<option value="${escapeHtml(r.zoho_product_id)}">${escapeHtml(r.product_name)} (${escapeHtml(r.zoho_product_id)})</option>`).join('')}
                </select>
                <div id="prdCreateZohoReview"></div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button type="button" class="action-button grey" id="btnCreateModalClose">Cancel</button>
                </div>
            `);
            el('btnCreateModalClose')?.addEventListener('click', closeProductCreateModal);
            el('prdCreateZohoPick')?.addEventListener('change', (e) => {
                const next = rows.find((r) => String(r.zoho_product_id) === String(e.target.value));
                if (next) paint(next);
            });
            return;
        }
        openProductCreateModal('Create AssetEngine Product from Zoho', `
            <p class="lc-muted">This creates an AssetEngine Product from the Zoho Reference. It does not create physical stock.</p>
            <div class="lc-kv">
                <div><div class="lc-k">Zoho Product ID</div><div class="lc-mono">${escapeHtml(row.zoho_product_id)}</div></div>
                <div><div class="lc-k">Product Name</div><div>${dash(row.product_name)}</div></div>
                <div><div class="lc-k">Make</div><div>${dash(row.make)}</div></div>
                <div><div class="lc-k">Model</div><div>${dash(row.model)}</div></div>
                <div><div class="lc-k">Created By</div><div>${dash(row.created_by)}</div></div>
                <div><div class="lc-k">Usage</div><div>${dash(row.usage_unit)}</div></div>
                <div><div class="lc-k">HSN Code</div><div>${dash(row.hsn_code)}</div></div>
                <div><div class="lc-k">SKU</div><div>${dash(row.sku)}</div></div>
                <div><div class="lc-k">Description</div><div>${dash(row.description)}</div></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
                <button type="button" class="action-button grey" id="btnCreateModalBack">Back</button>
                <button type="button" class="action-button grey" id="btnCreateModalClose">Cancel</button>
                <button type="button" class="action-button blue" id="btnConfirmCreateFromCatalog">Create AssetEngine Product</button>
            </div>
        `);
        el('btnCreateModalClose')?.addEventListener('click', closeProductCreateModal);
        el('btnCreateModalBack')?.addEventListener('click', () => paint(null));
        el('btnConfirmCreateFromCatalog')?.addEventListener('click', async () => {
            closeProductCreateModal();
            await createAgainstZohoProduct(row.zoho_product_id, { confirmed: true });
        });
    };
    paint(selected || null);
}

async function renderCatalogCreate() {
    return openCreateFromZohoModal(null);
}

async function createLocalProduct() {
    if (!canLogistics()) {
        showToast('Logistics role required to create AssetEngine Products.', 'error');
        return;
    }
    openProductCreateModal('Create Standalone AssetEngine Product', `
        <p class="lc-muted">Created directly in AssetEngine. Zoho mapping can be established later. This does not create physical stock.</p>
        ${inputField('prdNewName', 'Name', '', { note: 'Required' })}
        ${inputField('prdNewDescription', 'Description', '', { type: 'textarea' })}
        ${inputField('prdNewMake', 'Make', '')}
        ${inputField('prdNewModel', 'Model', '')}
        ${inputField('prdNewManufacturer', 'Manufacturer', '')}
        ${inputField('prdNewCode', 'OEM SKU / Product code', '')}
        ${inputField('prdNewHsn', 'HSN', '')}
        ${inputField('prdNewUnit', 'Unit', '')}
        ${inputField('prdNewPrice', 'Price', '')}
        <div style="display:flex;gap:8px;margin-top:14px;">
            <button type="button" class="action-button grey" id="btnCreateModalClose">Cancel</button>
            <button type="button" class="action-button blue" id="btnConfirmStandaloneProduct">Create Product</button>
        </div>
    `);
    el('btnCreateModalClose')?.addEventListener('click', closeProductCreateModal);
    el('btnConfirmStandaloneProduct')?.addEventListener('click', async () => {
        const name = String(el('prdNewName')?.value || '').trim();
        if (!name) {
            showToast('Name is required', 'error');
            return;
        }
        try {
            const priceRaw = el('prdNewPrice')?.value;
            const product = await api('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: el('prdNewDescription')?.value || null,
                    make: el('prdNewMake')?.value || null,
                    model: el('prdNewModel')?.value || null,
                    manufacturer: el('prdNewManufacturer')?.value || null,
                    product_code: el('prdNewCode')?.value || null,
                    hsn_code: el('prdNewHsn')?.value || null,
                    unit: el('prdNewUnit')?.value || null,
                    price: priceRaw === '' ? null : priceRaw
                })
            });
            showToast(`Created ${product.product.id}`, 'success');
            selectedId = product.product.id;
            closeProductCreateModal();
            await renderProductList();
        } catch (err) {
            toastOperatorError(err);
        }
    });
}

export function initProductsView() {
    const logistics = canLogistics();
    if (el('btnCreateProduct')) el('btnCreateProduct').style.display = logistics ? '' : 'none';
    if (el('btnCreateFromCatalog')) el('btnCreateFromCatalog').style.display = logistics ? '' : 'none';
    setViewMode(viewMode);
    syncFilterChips();
    const bootProducts = () => {
        const pending = consumeOpen('products-view');
        const openUnsynced = Boolean(
            (pending && pending.extra && pending.extra.zohoCatalog)
            || String(window.location.hash || '').includes('zohoCatalog=1')
        );
        if (openUnsynced) {
            setZohoUnsyncedFilter(true);
            setCatalogPanelOpen(false);
        }
        syncFilterChips();
        const jobs = [renderProductList({ resetPage: openUnsynced }).then(() => {
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
        createLocalProduct().catch((err) => toastOperatorError(err));
    });
    el('btnCreateFromCatalog')?.addEventListener('click', () => {
        renderCatalogCreate().catch((err) => toastOperatorError(err));
    });
    el('closeProductCreateModal')?.addEventListener('click', closeProductCreateModal);
    el('productCreateModal')?.addEventListener('click', (e) => {
        if (e.target === el('productCreateModal')) closeProductCreateModal();
    });
    el('btnProductViewCards')?.addEventListener('click', () => {
        setViewMode('cards');
        renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
    });
    el('btnProductViewList')?.addEventListener('click', () => {
        setViewMode('list');
        renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
    });
    document.querySelectorAll('#products-view [data-prd-status]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setZohoUnsyncedFilter(false);
            statusFilter = String(btn.getAttribute('data-prd-status') || '');
            syncFilterChips();
            renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
        });
    });
    document.querySelectorAll('#products-view [data-prd-linked]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setZohoUnsyncedFilter(false);
            linkedFilter = linkedFilter === '1' ? '' : '1';
            syncFilterChips();
            renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
        });
    });
    document.querySelectorAll('#products-view [data-prd-unsynced]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setZohoUnsyncedFilter(!isZohoUnsyncedFilter());
            syncFilterChips();
            renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
        });
    });
    el('productSourceFilter')?.addEventListener('change', () => {
        const value = String(el('productSourceFilter')?.value || '');
        if (value === 'ZOHO_UNSYNCED') {
            setZohoUnsyncedFilter(true);
        } else {
            unsyncedFilter = '';
        }
        syncFilterChips();
        renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
    });
    el('productSearch')?.addEventListener('input', () => {
        if (productSearchTimer) clearTimeout(productSearchTimer);
        productSearchTimer = setTimeout(() => {
            renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
        }, 300);
    });
    el('productSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (productSearchTimer) clearTimeout(productSearchTimer);
            renderProductList({ resetPage: true }).catch((err) => toastOperatorError(err));
        }
    });
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
window.focusZohoCatalogInProducts = focusZohoCatalogInProducts;
