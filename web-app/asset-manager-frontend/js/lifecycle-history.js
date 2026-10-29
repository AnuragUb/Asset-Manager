/**
 * Lifecycle History workspace — human-readable events from existing APIs.
 */
import { showToast, canOpenAppView } from './utils.js?v=7.39';
import {
    lifecycleApi,
    escapeHtml,
    dash,
    formatQty,
    formatWhen,
    emptyState,
    consumeOpen,
    toastOperatorError,
    go
} from './lifecycle.js?v=7.48';

function el(id) {
    return document.getElementById(id);
}

function humanAction(type) {
    const t = String(type || '').toUpperCase();
    const map = {
        CREATED: 'Record created',
        POSTED: 'Posted',
        CANCELLED: 'Cancelled',
        REVERSED: 'Receipt reversed',
        RESERVE: 'Reservation created',
        RELEASED: 'Reservation released',
        TRANSFERRED: 'Reservation transferred',
        ALLOCATED: 'Set allocated',
        DEALLOCATED: 'Set deallocated',
        SET_CREATED: 'Set created',
        DISBANDED: 'Set disbanded',
        IMPORTED: 'PO imported',
        REFRESHED: 'Refreshed from Zoho',
        PUBLISHED: 'Product published to Zoho',
        LINKED: 'Product linked to Zoho',
        INVENTORY_TO_ASSET: 'Inventory → Asset',
        ASSET_TO_INVENTORY: 'Asset → Inventory',
        BREAK: 'Break quantity',
        MAKE_INDIVIDUAL: 'Make individual',
        PHYSICAL_INTAKE_CREATED: 'Physical Intake registered',
        PHYSICAL_INTAKE_ASSET_CREATED: 'Asset registered by Physical Intake',
        PHYSICAL_INTAKE_INVENTORY_CREATED: 'Inventory registered by Physical Intake',
        PO_EXPECTED: 'Purchase Order expected later',
        PO_LINKED: 'Purchase Order linked',
        PRODUCT_LINKED: 'Product linked to Zoho',
        PO_IMPORTED: 'PO imported',
        UPDATED: 'Updated',
        VOIDED: 'Voided',
        PHYSICAL_ALLOCATED: 'Physical allocated to Purchase Book',
        PHYSICAL_RELEASED: 'Physical released from Purchase Book',
        DC_CONSUMED: 'Purchase Book qty used on DC',
        DC_RELEASED: 'Purchase Book DC consumption released',
        DC_CREATED: 'Added to Delivery Challan',
        DC_ADDED: 'Added to Delivery Challan',
        DC_REMOVED: 'Removed from Delivery Challan',
        DC_DISPATCHED: 'Dispatched on Delivery Challan',
        DC_RETURNED: 'Brought back from Delivery Challan'
    };
    return map[t] || String(type || 'Event').replace(/_/g, ' ');
}

function histCell(value) {
    const text = value == null ? '' : String(value).trim();
    return text ? escapeHtml(text) : '<span class="hist-empty">—</span>';
}

function historyRow(ev) {
    const qty = ev.qty != null && ev.qty !== '' ? escapeHtml(formatQty(ev.qty)) : '<span class="hist-empty">—</span>';
    const ref = ev.ref
        ? `<button type="button" class="lc-crumb-link" data-lc-go="${escapeHtml(ev.refView || '')}" data-lc-open="${escapeHtml(ev.ref)}">${escapeHtml(ev.ref)}</button>`
        : '<span class="hist-empty">—</span>';
    const tech = ev.tech
        ? `<details class="hist-tech"><summary>Details</summary><pre>${escapeHtml(ev.tech)}</pre></details>`
        : '<span class="hist-empty">—</span>';
    return `<tr>
        <td class="hist-when">${escapeHtml(formatWhen(ev.when))}</td>
        <td>${escapeHtml(ev.action || '')}</td>
        <td>${histCell(ev.actor)}</td>
        <td class="hist-num">${qty}</td>
        <td>${histCell(ev.source)}</td>
        <td>${histCell(ev.dest)}</td>
        <td>${(ev.holdings || []).length ? escapeHtml(ev.holdings.join(', ')) : '<span class="hist-empty">—</span>'}</td>
        <td class="hist-ref">${ref}</td>
        <td>${tech}</td>
    </tr>`;
}

function historySheet(rows) {
    return `<div class="hist-sheet-wrap">
        <table class="hist-sheet">
            <thead>
                <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>By</th>
                    <th>Qty</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Asset / Inventory</th>
                    <th>Reference</th>
                    <th>Technical details</th>
                </tr>
            </thead>
            <tbody>${rows.map(historyRow).join('')}</tbody>
        </table>
    </div>`;
}

function pushEvent(list, ev) {
    if (!ev || !ev.when) return;
    const ts = Date.parse(ev.when);
    if (!Number.isFinite(ts)) return;
    list.push({ ...ev, _ts: ts });
}

function feedSort(events) {
    return events.sort((a, b) => (b._ts || 0) - (a._ts || 0));
}

function poActivityAction(po) {
    if (po.source === 'LOCAL') return 'Legacy local PO (contained)';
    const synced = po.lastSyncedAt ? Date.parse(po.lastSyncedAt) : NaN;
    const created = po.createdAt ? Date.parse(po.createdAt) : NaN;
    if (Number.isFinite(synced) && Number.isFinite(created) && synced - created > 5000) {
        return 'PO refreshed from Zoho';
    }
    return 'PO imported';
}

function syncEventAction(operation) {
    const op = String(operation || '').toUpperCase();
    if (op.includes('IMPORT')) return 'PO imported';
    if (op.includes('REFRESH') || op.includes('SYNC') || op.includes('UPDATE')) return 'PO refreshed from Zoho';
    return humanAction(op || 'REFRESHED');
}

const FEED_MODULE_VIEWS = {
    conversions: 'home-view',
    reservations: 'reservations-view',
    receipts: 'receipts-view',
    pos: 'purchase-orders-view',
    intakes: 'physical-intakes-view',
    products: 'products-view',
    books: 'purchase-books-view',
    dc: 'dc-view'
};

function allowFeedModule(module) {
    const view = FEED_MODULE_VIEWS[module];
    if (!view) return false;
    return canOpenAppView(view);
}

export async function gatherLifecycleFeed({ limit = 80 } = {}) {
    const events = [];
    const [conv, rsv, receipts, pos, intakes, products, poSync, pbEvents, dcEvents] = await Promise.all([
        allowFeedModule('conversions')
            ? lifecycleApi('/api/conversions?limit=50').catch(() => ({ conversions: [] }))
            : Promise.resolve({ conversions: [] }),
        allowFeedModule('reservations')
            ? lifecycleApi('/api/reservations?limit=50').catch(() => ({ reservations: [] }))
            : Promise.resolve({ reservations: [] }),
        allowFeedModule('receipts')
            ? lifecycleApi('/api/receipt-notes?limit=50').catch(() => ({ receiptNotes: [] }))
            : Promise.resolve({ receiptNotes: [] }),
        allowFeedModule('pos')
            ? lifecycleApi('/api/procurement/pos?limit=50').catch(() => ({ purchaseOrders: [] }))
            : Promise.resolve({ purchaseOrders: [] }),
        allowFeedModule('intakes')
            ? lifecycleApi('/api/physical-intakes?limit=50').catch(() => ({ intakes: [] }))
            : Promise.resolve({ intakes: [] }),
        allowFeedModule('products')
            ? lifecycleApi('/api/products?limit=50').catch(() => ({ products: [] }))
            : Promise.resolve({ products: [] }),
        allowFeedModule('pos')
            ? lifecycleApi('/api/procurement/sync-events?limit=40').catch(() => ({ events: [] }))
            : Promise.resolve({ events: [] }),
        allowFeedModule('books')
            ? lifecycleApi('/api/purchase-books/recent-events?limit=40').catch(() => ({ events: [] }))
            : Promise.resolve({ events: [] }),
        allowFeedModule('dc')
            ? lifecycleApi('/api/dc/recent-events?limit=40').catch(() => ({ events: [] }))
            : Promise.resolve({ events: [] })
    ]);

    (conv.conversions || []).forEach((c) => {
        pushEvent(events, {
            when: c.createdAt || c.created_at,
            actor: c.createdBy || c.actor,
            action: humanAction(c.direction),
            qty: c.quantityOriginal || c.quantity,
            source: c.sourceId || c.source_id,
            dest: (c.assets && c.assets[0] && c.assets[0].id) || c.destinationId || '',
            ref: c.id,
            refView: 'home-view',
            module: 'conversions',
            tech: c.id ? `Operation ${c.id}` : ''
        });
    });
    (rsv.reservations || []).forEach((r) => {
        pushEvent(events, {
            when: r.createdAt,
            actor: r.createdBy,
            action: humanAction(r.status === 'RELEASED' ? 'RELEASED' : 'RESERVE'),
            qty: r.quantityOriginal || r.quantity,
            source: r.resourceId,
            dest: r.ownerId,
            ref: r.id,
            refView: 'reservations-view',
            module: 'reservations'
        });
    });
    (receipts.receiptNotes || []).forEach((n) => {
        const posted = String(n.status).toUpperCase() === 'POSTED';
        pushEvent(events, {
            when: n.postedAt || n.receivedAt || n.createdAt,
            actor: n.postedBy || n.createdBy,
            action: posted ? 'Receipt posted' : humanAction(n.status),
            qty: n.acceptedQuantity,
            source: n.poNumber || n.poId,
            dest: n.id,
            ref: n.id,
            refView: 'receipts-view',
            module: 'receipts'
        });
    });
    const syncPoIds = new Set();
    (poSync.events || []).forEach((ev) => {
        const poId = ev.procurementPoId || ev.procurement_po_id;
        if (poId) syncPoIds.add(String(poId));
        pushEvent(events, {
            when: ev.createdAt || ev.created_at,
            actor: ev.actor,
            action: syncEventAction(ev.operation),
            source: ev.zohoPoId || ev.zoho_po_id,
            dest: ev.poNumber || poId,
            ref: poId,
            refView: 'purchase-orders-view',
            module: 'pos',
            tech: ev.id ? `Sync ${ev.id} · ${ev.status || ''}`.trim() : ''
        });
    });
    (pos.purchaseOrders || []).forEach((po) => {
        // Prefer discrete sync events when available; otherwise one row from sync/create time.
        if (syncPoIds.has(String(po.id))) return;
        const when = po.lastSyncedAt || po.updatedAt || po.createdAt || po.importedAt || null;
        pushEvent(events, {
            when,
            actor: po.updatedBy || po.createdBy || po.importedBy,
            action: poActivityAction(po),
            source: po.zohoPoId,
            dest: po.poNumber || po.id,
            ref: po.id,
            refView: 'purchase-orders-view',
            module: 'pos'
        });
    });
    (intakes.intakes || []).forEach((intake) => {
        const out = (intake.outputs || [])[0] || {};
        pushEvent(events, {
            when: intake.createdAt,
            actor: intake.actor,
            action: humanAction('PHYSICAL_INTAKE_CREATED'),
            qty: intake.quantity,
            source: intake.intakeType,
            dest: out.resourceId,
            ref: intake.id,
            refView: 'physical-intakes-view',
            module: 'intakes',
            tech: `Origin NON-PROCUREMENT INTAKE · ${intake.productId || ''}`
        });
    });
    (products.products || []).forEach((p) => {
        pushEvent(events, {
            when: p.created_at || p.createdAt,
            actor: p.created_by || p.createdBy,
            action: 'Product created',
            ref: p.id,
            refView: 'products-view',
            module: 'products',
            dest: p.name
        });
    });
    (pbEvents.events || []).forEach((ev) => {
        const type = String(ev.type || '').toUpperCase();
        const actionMap = {
            CREATED: 'Purchase Book created',
            UPDATED: 'Purchase Book updated',
            POSTED: 'Purchase Book posted',
            VOIDED: 'Purchase Book voided',
            PHYSICAL_ALLOCATED: 'Physical allocated to Purchase Book',
            PHYSICAL_RELEASED: 'Physical released from Purchase Book',
            DC_CONSUMED: 'Purchase Book qty used on DC',
            DC_RELEASED: 'Purchase Book DC consumption released'
        };
        pushEvent(events, {
            when: ev.timestamp || ev.createdAt,
            actor: ev.actor,
            action: actionMap[type] || humanAction(ev.type),
            source: ev.procurementPoId || null,
            dest: ev.vendorInvoiceNo || ev.purchaseBookId,
            ref: ev.purchaseBookId,
            refView: 'purchase-books-view',
            module: 'books',
            tech: ev.note || (ev.id ? `PB event ${ev.id}` : '')
        });
    });
    (dcEvents.events || []).forEach((ev) => {
        const meta = ev.metadata || {};
        pushEvent(events, {
            when: ev.timestamp || ev.createdAt,
            actor: ev.actor,
            action: ({
                CREATED: 'Delivery Challan created',
                READY: 'Delivery Challan reserved',
                DISPATCHED: 'Delivery Challan posted',
                RETURNED: 'Delivery Challan return posted',
                UPDATED: 'Delivery Challan updated',
                VOIDED: 'Delivery Challan voided'
            })[ev.type] || humanAction(ev.type),
            source: meta.customerName || null,
            dest: ev.challanNo || meta.challanNo || ev.deliveryChallanId,
            holdings: ev.holdings || [],
            ref: ev.deliveryChallanId,
            refView: 'dc-view',
            module: 'dc',
            tech: ev.note || (ev.id ? `DC event ${ev.id}` : '')
        });
    });

    return feedSort(events).slice(0, limit).map(({ _ts, ...rest }) => rest);
}

async function gatherFeed() {
    return gatherLifecycleFeed({ limit: 200 });
}

async function lookupHistory(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const upper = key.toUpperCase();
    const tries = [];
    if (upper.startsWith('PRD') || upper.includes('PRODUCT')) tries.push({ path: `/api/products/${encodeURIComponent(key)}`, view: 'products-view' });
    if (upper.startsWith('RN') || upper.includes('RECEIPT')) tries.push({ path: `/api/receipt-notes/${encodeURIComponent(key)}/history`, view: 'receipts-view' });
    if (upper.startsWith('PBK') || upper.startsWith('PBL')) tries.push({ path: `/api/purchase-books/${encodeURIComponent(key)}/history`, view: 'purchase-books-view' });
    if (upper.startsWith('DC') || /^\d{2}\/\d{4}$/.test(upper)) tries.push({ path: `/api/dc/${encodeURIComponent(key)}/history`, view: 'dc-view' });
    if (upper.startsWith('SET') || upper.startsWith('MS')) tries.push({ path: `/api/sets/${encodeURIComponent(key)}/history`, view: 'sets-view' });
    if (upper.startsWith('RSV') || upper.startsWith('RES')) tries.push({ path: `/api/reservations/${encodeURIComponent(key)}`, view: 'reservations-view' });
    if (upper.startsWith('CONV')) tries.push({ path: `/api/conversions/${encodeURIComponent(key)}`, view: 'history-view' });
    if (upper.startsWith('INTAKE')) tries.push({ path: `/api/physical-intakes/${encodeURIComponent(key)}/history`, view: 'physical-intakes-view' });
    tries.push({ path: `/api/procurement/pos/${encodeURIComponent(key)}/history`, view: 'purchase-orders-view' });
    tries.push({ path: `/api/purchase-books/${encodeURIComponent(key)}/history`, view: 'purchase-books-view' });
    tries.push({ path: `/api/dc/${encodeURIComponent(key)}/history`, view: 'dc-view' });
    tries.push({ path: `/api/assets/${encodeURIComponent(key)}/history`, view: 'home-view' });
    tries.push({ path: `/api/receipt-notes/${encodeURIComponent(key)}/history`, view: 'receipts-view' });
    tries.push({ path: `/api/sets/${encodeURIComponent(key)}/history`, view: 'sets-view' });
    tries.push({ path: `/api/reservations/${encodeURIComponent(key)}`, view: 'reservations-view' });

    for (const t of tries) {
        try {
            const data = await lifecycleApi(t.path);
            return { data, view: t.view, id: key };
        } catch (_err) {
            /* try next */
        }
    }
    return null;
}

function eventsFromLookup(result) {
    if (!result) return [];
    const data = result.data || {};
    const list = data.events || data.history || [];
    if (Array.isArray(list) && list.length) {
        return list.map((ev) => ({
            when: ev.timestamp || ev.createdAt || ev.created_at,
            actor: ev.actor || ev.createdBy || ev.user,
            action: humanAction(ev.type || ev.action || ev.operation),
            qty: ev.quantity,
            source: ev.resourceId || ev.sourceId,
            dest: ev.destinationId,
            holdings: (Array.isArray(ev.holdings) && ev.holdings.length)
                ? ev.holdings
                : (ev.assetid || ev.AssetID || ev.assetId
                    ? [`ASSET ${ev.assetid || ev.AssetID || ev.assetId}`]
                    : (result.view === 'home-view' && result.id ? [`ASSET ${result.id}`] : [])),
            ref: result.id,
            refView: result.view,
            tech: ev.id ? `Operation ${ev.id}` : ''
        }));
    }
    if (data.reservation) {
        return [{
            when: data.reservation.createdAt,
            actor: data.reservation.createdBy,
            action: humanAction(data.reservation.status),
            qty: data.reservation.quantity,
            source: data.reservation.resourceId,
            dest: data.reservation.ownerId,
            ref: data.reservation.id,
            refView: 'reservations-view'
        }];
    }
    if (data.conversion || data.id) {
        const c = data.conversion || data;
        return [{
            when: c.createdAt,
            actor: c.createdBy,
            action: humanAction(c.direction),
            qty: c.quantityOriginal || c.quantity,
            source: c.sourceId,
            dest: c.destinationId,
            tech: c.id ? `Operation ${c.id}` : ''
        }];
    }
    return [];
}

let historyPage = 0;
const HISTORY_PAGE_SIZE = 15;
let lastHistoryEvents = [];
let lastHistoryQuery = '';

function renderHistoryPager(total) {
    const pages = Math.max(1, Math.ceil(Number(total || 0) / HISTORY_PAGE_SIZE));
    if (historyPage > pages - 1) historyPage = pages - 1;
    if (historyPage < 0) historyPage = 0;
    const from = total ? historyPage * HISTORY_PAGE_SIZE + 1 : 0;
    const to = Math.min(total, (historyPage + 1) * HISTORY_PAGE_SIZE);
    return `<div class="prd-pager hist-pager" role="navigation" aria-label="History pages">
        <span class="prd-pager-meta">${total ? `${from}–${to} of ${total}` : '0 events'}</span>
        <div class="prd-pager-actions">
            <button type="button" class="action-button grey prd-pager-btn" id="btnHistoryPagePrev" ${historyPage <= 0 ? 'disabled' : ''}>Previous</button>
            <span class="prd-pager-page">Page ${historyPage + 1} of ${pages}</span>
            <button type="button" class="action-button grey prd-pager-btn" id="btnHistoryPageNext" ${historyPage >= pages - 1 ? 'disabled' : ''}>Next</button>
        </div>
    </div>`;
}

function bindHistoryPager() {
    const total = lastHistoryEvents.length;
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    el('btnHistoryPagePrev')?.addEventListener('click', () => {
        if (historyPage <= 0) return;
        historyPage -= 1;
        paintHistoryPage();
    });
    el('btnHistoryPageNext')?.addEventListener('click', () => {
        if (historyPage >= pages - 1) return;
        historyPage += 1;
        paintHistoryPage();
    });
}

function paintHistoryPage() {
    const host = el('historyContent');
    if (!host) return;
    const total = lastHistoryEvents.length;
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    if (historyPage > pages - 1) historyPage = Math.max(0, pages - 1);
    const start = historyPage * HISTORY_PAGE_SIZE;
    const slice = lastHistoryEvents.slice(start, start + HISTORY_PAGE_SIZE);
    const heading = lastHistoryQuery
        ? `<p class="lc-muted">History for <span class="lc-mono">${escapeHtml(lastHistoryQuery)}</span></p>`
        : '';
    host.innerHTML = `${heading}${historySheet(slice)}${renderHistoryPager(total)}`;
    bindHistoryPager();
}

async function renderHistory(query, { resetPage = true } = {}) {
    const host = el('historyContent');
    if (!host) return;
    if (resetPage) historyPage = 0;
    lastHistoryQuery = String(query || '').trim();
    if (lastHistoryQuery) {
        host.innerHTML = '<p class="lc-muted">Looking up…</p>';
        const found = await lookupHistory(lastHistoryQuery);
        const events = eventsFromLookup(found);
        if (!found || !events.length) {
            lastHistoryEvents = [];
            host.innerHTML = emptyState({
                title: 'No history for that reference.',
                body: 'Try a Product, PO, Receipt Note, Asset, Inventory, Reservation, or Set ID.',
                actionLabel: 'Show recent activity',
                actionView: 'history-view'
            });
            return;
        }
        lastHistoryEvents = events;
        paintHistoryPage();
        return;
    }
    const events = await gatherFeed();
    if (!events.length) {
        lastHistoryEvents = [];
        host.innerHTML = emptyState({
            title: 'No lifecycle events yet.',
            body: 'History appears as Products are linked, POs imported, Purchase Books posted, DCs created, receipts posted, and stock reserved or assembled.',
            actionLabel: 'Open Dashboard',
            actionView: 'operations-view'
        });
        return;
    }
    lastHistoryEvents = events;
    paintHistoryPage();
}

let bound = false;
export function initHistoryView() {
    if (!bound) {
        bound = true;
        el('btnReloadHistory')?.addEventListener('click', () => {
            const q = el('historySearch')?.value || '';
            renderHistory(q, { resetPage: true }).catch((err) => toastOperatorError(err));
        });
        el('historySearch')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                renderHistory(el('historySearch').value, { resetPage: true }).catch((err) => toastOperatorError(err));
            }
        });
    }
    const pending = consumeOpen('history-view');
    const q = (pending && pending.open) || (pending && pending.extra && pending.extra.q) || '';
    if (el('historySearch') && q) el('historySearch').value = q;
    renderHistory(q, { resetPage: true }).catch((err) => {
        toastOperatorError(err);
        showToast(err.message, 'error');
    });
    void go;
    void dash;
}

window.initHistoryView = initHistoryView;
window.gatherLifecycleFeed = gatherLifecycleFeed;
