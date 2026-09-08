/**
 * Dashboard — lifecycle overview. Uses existing list APIs only.
 */
import { showToast, canOpenAppView } from './utils.js?v=7.39';
import {
    lifecycleApi,
    escapeHtml,
    dash,
    go,
    consumeOpen,
    emptyState,
    toastOperatorError
} from './lifecycle.js?v=7.31';
import { gatherLifecycleFeed } from './lifecycle-history.js?v=7.33';
import { getDashboardEntityLink } from './dashboardEntityLink.js?v=7.40';

const NEW_PRODUCT_DAYS = 7;

function el(id) {
    return document.getElementById(id);
}

function stageCard(label, count, view, hint, extraAttr = '', extraClass = '') {
    return `<button type="button" class="ops-stage ops-glossy-surface ops-lift ${extraClass}" data-lc-go="${escapeHtml(view)}" ${extraAttr} aria-label="${escapeHtml(label)}: ${escapeHtml(count)}. ${escapeHtml(hint)}">
        <span class="ops-stage-label">${escapeHtml(label)}</span>
        <span class="ops-stage-count">${escapeHtml(count)}</span>
        <span class="ops-stage-hint">${escapeHtml(hint)}</span>
    </button>`;
}

function entityChipHtml(entity, missingLabel = '') {
    const link = getDashboardEntityLink(entity);
    if (!link) {
        const label = String(missingLabel || '').trim();
        if (!label) return '';
        return `<span class="ops-entity-chip ops-entity-chip-missing">${escapeHtml(label)}</span>`;
    }
    if (!link.accessible) {
        return `<span class="ops-entity-chip ops-entity-chip-missing" title="Not accessible">${escapeHtml(link.display)}</span>`;
    }
    return `<button type="button" class="ops-entity-chip" data-lc-go="${escapeHtml(link.view)}" data-lc-open="${escapeHtml(link.open)}" aria-label="${escapeHtml(link.accessibleName)}"><span class="ops-entity-id">${escapeHtml(link.display)}</span><span class="ops-entity-go" aria-hidden="true">↗</span></button>`;
}

function settled(promise) {
    return promise.then((data) => ({ ok: true, data })).catch((err) => ({ ok: false, err }));
}

function listFromResponse(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    if (data && Array.isArray(data.data)) return data.data;
    return [];
}

function isRetiredAsset(asset) {
    return asset.IsRetired == 1 || asset.is_retired == 1;
}

/** Holding-record count: non-retired Assets + current Inventory rows. Not quantity_total. */
function stockHoldings(assetRows, inventoryRows) {
    const assets = (assetRows || []).filter((asset) => !isRetiredAsset(asset)).length;
    const inventory = (inventoryRows || []).length;
    return { assets, inventory, total: assets + inventory };
}

function holdingProductId(row) {
    return String(row.product_id || row.productId || row.ProductId || '').trim();
}

function isWithinDays(iso, days) {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return (Date.now() - t) <= days * 86400000;
}

function productWhen(row) {
    return row.updated_at || row.created_at || '';
}

function mostUsedFromHoldings(productRows, assetRows, inventoryRows) {
    const counts = new Map();
    [...(assetRows || []), ...(inventoryRows || [])].forEach((row) => {
        const id = holdingProductId(row);
        if (!id) return;
        counts.set(id, (counts.get(id) || 0) + 1);
    });
    if (!counts.size) return { available: false, items: [] };
    const byId = new Map((productRows || []).map((p) => [String(p.id), p]));
    const items = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, 3)
        .map(([id, n]) => {
            const product = byId.get(id);
            return {
                id,
                name: (product && product.name) || id,
                count: n,
                record: product || null
            };
        });
    return { available: true, items };
}

function isReceivableWaitlistPo(po) {
    if (String(po.source || '').toUpperCase() === 'LOCAL') return false;
    if (po.reconciliationRequired || po.mappingRequired) return false;
    if (String(po.status || '').toUpperCase() === 'CANCELLED') return false;
    const lines = po.lines || [];
    return lines.some((line) => Number(line.outstanding || 0) > 0);
}

function waitlistLineCount(poRows) {
    let lines = 0;
    let pos = 0;
    (poRows || []).forEach((po) => {
        if (!isReceivableWaitlistPo(po)) return;
        const outstanding = (po.lines || []).filter((line) => Number(line.outstanding || 0) > 0);
        if (!outstanding.length) return;
        pos += 1;
        lines += outstanding.length;
    });
    return { lines, pos };
}

function productsCardHtml(productRows, assetRows, inventoryRows) {
    const total = (productRows || []).length;
    const created = (productRows || []).filter((p) => isWithinDays(p.created_at, NEW_PRODUCT_DAYS)).length;
    const recent = [...(productRows || [])]
        .sort((a, b) => String(productWhen(b)).localeCompare(String(productWhen(a))))
        .slice(0, 3);
    const used = mostUsedFromHoldings(productRows, assetRows, inventoryRows);
    const usedHtml = used.available
        ? used.items.map((item) => (
            item.record
                ? entityChipHtml({ type: 'PRODUCT', id: item.record.id, name: item.record.name, ref: item.record.id })
                : entityChipHtml(null, item.id)
        )).join('')
        : '<span class="ops-mini-hint">Usage is not a Product metric</span>';
    const recentHtml = recent.length
        ? recent.map((p) => (
            p && p.id
                ? entityChipHtml({ type: 'PRODUCT', id: p.id, name: p.name, ref: p.id })
                : ''
        )).join('')
        : '<span class="ops-mini-hint">None yet</span>';
    return `<div class="ops-stage ops-product-card ops-glossy-surface ops-lift">
        <button type="button" class="ops-product-head" data-lc-go="products-view" aria-label="Products: ${total} active. Open Products workspace.">
            <span class="ops-stage-label">Products</span>
            <span class="ops-stage-count">${escapeHtml(total)}</span>
            <span class="ops-stage-hint">Active catalogue</span>
        </button>
        <div class="ops-product-quad">
            <div class="ops-product-stat">
                <span class="ops-mini-label">Total</span>
                <strong>${escapeHtml(total)}</strong>
            </div>
            <div class="ops-product-stat">
                <span class="ops-mini-label">New</span>
                <strong>${escapeHtml(created)}</strong>
                <span class="ops-mini-hint">${NEW_PRODUCT_DAYS}d</span>
            </div>
            <div class="ops-product-stat ops-product-stat-refs">
                <span class="ops-mini-label">Most Used</span>
                <div class="ops-entity-row">${usedHtml}</div>
            </div>
            <div class="ops-product-stat ops-product-stat-refs">
                <span class="ops-mini-label">Recent</span>
                <div class="ops-entity-row">${recentHtml}</div>
            </div>
        </div>
    </div>`;
}

function activityCardHtml(events) {
    const rows = (events || []).slice(0, 5);
    const body = rows.length
        ? rows.map((ev) => {
            const dest = ev.refView && canOpenAppView(ev.refView) ? ev.refView : 'history-view';
            return `<button type="button" class="ops-activity-row ops-glossy-surface" data-lc-go="${escapeHtml(dest)}" data-lc-open="${escapeHtml(ev.ref || '')}" aria-label="${escapeHtml(ev.action || 'Event')} ${escapeHtml(ev.ref || ev.dest || '')}">
                <span class="ops-activity-when">${escapeHtml(ev.when ? String(ev.when).replace('T', ' ').slice(0, 16) : '')}</span>
                <span class="ops-activity-action">${escapeHtml(ev.action || 'Event')}</span>
                <span class="ops-activity-ref">${escapeHtml(ev.ref || ev.dest || '')}</span>
            </button>`;
        }).join('')
        : '<p class="lc-muted ops-activity-empty">No recent authorized activity.</p>';
    return `<div class="ops-stage ops-activity-card ops-glossy-well ops-lift">
        <button type="button" class="ops-activity-head ops-glossy-surface" data-lc-go="history-view" aria-label="Recent activity history. Open History workspace.">
            <span class="ops-stage-label">Recent Activity History</span>
            <span class="ops-stage-hint">Last ${rows.length} authorized events</span>
        </button>
        <div class="ops-activity-list">${body}</div>
    </div>`;
}

export async function renderOperations() {
    const host = el('operationsContent');
    if (!host) return;
    host.innerHTML = '<p class="lc-muted">Loading operations…</p>';
    try {
        const canProducts = canOpenAppView('products-view');
        const canPo = canOpenAppView('purchase-orders-view');
        const canReceipts = canOpenAppView('receipts-view');
        const canSets = canOpenAppView('sets-view');
        const canReservations = canOpenAppView('reservations-view');
        const canInventory = canOpenAppView('inventory-view');
        const canAssets = canOpenAppView('home-view');
        const canHistory = canOpenAppView('history-view');

        const [products, pos, openReceipts, allReceipts, sets, reservations, inventoryResult, assetsResult, activity] = await Promise.all([
            canProducts
                ? lifecycleApi('/api/products?status=ACTIVE&limit=500').catch(() => ({ products: [] }))
                : Promise.resolve({ products: [] }),
            canPo
                ? lifecycleApi('/api/procurement/pos?limit=200').catch(() => ({ purchaseOrders: [] }))
                : Promise.resolve({ purchaseOrders: [] }),
            canReceipts
                ? lifecycleApi('/api/receipt-notes?status=OPEN&limit=100').catch(() => ({ receiptNotes: [] }))
                : Promise.resolve({ receiptNotes: [] }),
            canReceipts
                ? lifecycleApi('/api/receipt-notes?limit=100').catch(() => ({ receiptNotes: [] }))
                : Promise.resolve({ receiptNotes: [] }),
            canSets
                ? lifecycleApi('/api/sets').catch(() => ({ sets: [] }))
                : Promise.resolve({ sets: [] }),
            canReservations
                ? lifecycleApi('/api/reservations?status=ACTIVE&limit=200').catch(() => ({ reservations: [] }))
                : Promise.resolve({ reservations: [] }),
            canInventory ? settled(lifecycleApi('/api/inventory/items')) : Promise.resolve({ ok: false, data: { items: [] } }),
            canAssets ? settled(lifecycleApi('/api/assets?all=true')) : Promise.resolve({ ok: false, data: [] }),
            canHistory
                ? gatherLifecycleFeed({ limit: 5 }).catch(() => [])
                : Promise.resolve([])
        ]);

        const inventory = inventoryResult.ok ? inventoryResult.data : { items: [] };
        const productRows = products.products || [];
        const poRows = pos.purchaseOrders || [];
        const openRn = openReceipts.receiptNotes || [];
        const setRows = sets.sets || [];
        const resRows = reservations.reservations || [];
        const assetRows = assetsResult.ok ? listFromResponse(assetsResult.data, 'data') : [];
        const inventoryRows = listFromResponse(inventory, 'items');
        const stockReady = Boolean(canAssets && canInventory && inventoryResult.ok && assetsResult.ok);
        const stock = stockReady ? stockHoldings(assetRows, inventoryRows) : null;
        const stockCount = stock ? stock.total : '—';
        const stockHint = stock
            ? `${stock.assets} ${stock.assets === 1 ? 'Asset' : 'Assets'} · ${stock.inventory} Inventory`
            : 'Unavailable';
        const waitlist = waitlistLineCount(poRows);

        const summary = [
            canProducts ? productsCardHtml(productRows, assetRows, inventoryRows) : '',
            canPo ? stageCard('PO Waitlist', waitlist.lines, 'purchase-orders-view', waitlist.pos === 1 ? '1 Purchase Order waiting for a Receipt Note' : `${waitlist.pos} Purchase Orders waiting for Receipt Notes`, 'data-lc-waitlist="1"') : '',
            canHistory ? activityCardHtml(activity) : ''
        ].filter(Boolean);

        const flow = [
            canReceipts ? stageCard('Receiving', openRn.length, 'receipts-view', `${(allReceipts.receiptNotes || []).length} notes`) : '',
            canReceipts && (canAssets || canInventory) ? '<span class="ops-flow-arrow" aria-hidden="true">→</span>' : '',
            (canAssets || canInventory) ? stageCard('Holdings', stockCount, canAssets ? 'home-view' : 'inventory-view', stockHint) : '',
            (canAssets || canInventory) && canReservations ? '<span class="ops-flow-arrow" aria-hidden="true">→</span>' : '',
            canReservations ? stageCard('Reservation', resRows.length, 'reservations-view', 'Active') : '',
            canReservations && canSets ? '<span class="ops-flow-arrow" aria-hidden="true">→</span>' : '',
            canSets ? stageCard('Set', setRows.length, 'sets-view', 'Assemble') : ''
        ].filter(Boolean);

        host.innerHTML = `
            <div class="ops-grid">
                <section class="lc-section ops-dashboard-section">
                    <div class="lc-section-label">Lifecycle Progress</div>
                    <div class="ops-flow" role="navigation" aria-label="Lifecycle stages">
                        ${flow.join('') || '<p class="lc-muted">No authorized lifecycle modules.</p>'}
                    </div>
                    <p class="lc-muted ops-caption">Procurement stock: Product → PO → Receipt → Stock. Non-procurement stock: Physical Intake → Stock. Both then reserve and allocate to Sets. Counts come from live lists. PO Waitlist is receivable lines with outstanding quantity — not the total Purchase Order list.</p>
                </section>
            </div>
            ${summary.length ? `<section class="ops-summary" aria-label="Lifecycle summary">${summary.join('')}</section>` : ''}
            <div class="ops-analytics-slot" aria-hidden="true"></div>
        `;
        void dash;
        void emptyState;
        void go;
    } catch (err) {
        host.innerHTML = `<div class="lc-empty"><h3>Operations could not load</h3><p>${escapeHtml(toastOperatorError(err))}</p></div>`;
    }
}

let bound = false;
export function initOperationsView() {
    if (!bound) {
        bound = true;
        el('btnReloadOperations')?.addEventListener('click', () => {
            renderOperations().catch((err) => showToast(err.message, 'error'));
        });
    }
    consumeOpen('operations-view');
    renderOperations().catch((err) => showToast(err.message, 'error'));
}

window.initOperationsView = initOperationsView;
