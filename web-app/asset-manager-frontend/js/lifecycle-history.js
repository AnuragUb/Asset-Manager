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
        POSTED: 'Receipt posted',
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
        PO_IMPORTED: 'PO imported'
    };
    return map[t] || String(type || 'Event').replace(/_/g, ' ');
}

function eventCard(ev) {
    return `<article class="lc-event-card">
        <div class="lc-event-when">${formatWhen(ev.when)}</div>
        <div class="lc-event-action">${escapeHtml(ev.action)}</div>
        <div class="lc-event-meta">
            ${ev.actor ? `<span>By ${escapeHtml(ev.actor)}</span>` : ''}
            ${ev.qty != null && ev.qty !== '' ? `<span>Qty ${formatQty(ev.qty)}</span>` : ''}
            ${ev.source ? `<span>From ${escapeHtml(ev.source)}</span>` : ''}
            ${ev.dest ? `<span>To ${escapeHtml(ev.dest)}</span>` : ''}
            ${ev.ref ? `<button type="button" class="lc-crumb-link" data-lc-go="${escapeHtml(ev.refView || '')}" data-lc-open="${escapeHtml(ev.ref)}">${escapeHtml(ev.ref)}</button>` : ''}
        </div>
        ${ev.tech ? `<details class="lc-tech"><summary>Technical details</summary><pre>${escapeHtml(ev.tech)}</pre></details>` : ''}
    </article>`;
}

function pushEvent(list, ev) {
    if (!ev || !ev.when) return;
    list.push(ev);
}

const FEED_MODULE_VIEWS = {
    conversions: 'home-view',
    reservations: 'reservations-view',
    receipts: 'receipts-view',
    pos: 'purchase-orders-view',
    intakes: 'physical-intakes-view',
    products: 'products-view'
};

function allowFeedModule(module) {
    const view = FEED_MODULE_VIEWS[module];
    if (!view) return false;
    return canOpenAppView(view);
}

export async function gatherLifecycleFeed({ limit = 80 } = {}) {
    const events = [];
    const [conv, rsv, receipts, pos, intakes, products] = await Promise.all([
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
            : Promise.resolve({ products: [] })
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
    (pos.purchaseOrders || []).forEach((po) => {
        pushEvent(events, {
            when: po.importedAt || po.updatedAt || po.createdAt || po.poDate,
            actor: po.importedBy,
            action: po.source === 'LOCAL' ? 'Legacy local PO (contained)' : 'PO imported',
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
            when: p.created_at,
            actor: p.created_by,
            action: 'Product created',
            ref: p.id,
            refView: 'products-view',
            module: 'products',
            dest: p.name
        });
    });

    events.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    return events.slice(0, limit);
}

async function gatherFeed() {
    return gatherLifecycleFeed({ limit: 80 });
}

async function lookupHistory(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const upper = key.toUpperCase();
    const tries = [];
    if (upper.startsWith('PRD') || upper.includes('PRODUCT')) tries.push({ path: `/api/products/${encodeURIComponent(key)}`, view: 'products-view' });
    if (upper.startsWith('RN') || upper.includes('RECEIPT')) tries.push({ path: `/api/receipt-notes/${encodeURIComponent(key)}/history`, view: 'receipts-view' });
    if (upper.startsWith('SET') || upper.startsWith('MS')) tries.push({ path: `/api/sets/${encodeURIComponent(key)}/history`, view: 'sets-view' });
    if (upper.startsWith('RSV') || upper.startsWith('RES')) tries.push({ path: `/api/reservations/${encodeURIComponent(key)}`, view: 'reservations-view' });
    if (upper.startsWith('CONV')) tries.push({ path: `/api/conversions/${encodeURIComponent(key)}`, view: 'history-view' });
    if (upper.startsWith('INTAKE')) tries.push({ path: `/api/physical-intakes/${encodeURIComponent(key)}/history`, view: 'physical-intakes-view' });
    tries.push({ path: `/api/procurement/pos/${encodeURIComponent(key)}/history`, view: 'purchase-orders-view' });
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

async function renderHistory(query) {
    const host = el('historyContent');
    if (!host) return;
    if (query) {
        host.innerHTML = '<p class="lc-muted">Looking up…</p>';
        const found = await lookupHistory(query);
        const events = eventsFromLookup(found);
        if (!found || !events.length) {
            host.innerHTML = emptyState({
                title: 'No history for that reference.',
                body: 'Try a Product, PO, Receipt Note, Asset, Inventory, Reservation, or Set ID.',
                actionLabel: 'Show recent activity',
                actionView: 'history-view'
            });
            return;
        }
        host.innerHTML = `<p class="lc-muted">History for <span class="lc-mono">${escapeHtml(query)}</span></p>
            ${events.map(eventCard).join('')}`;
        return;
    }
    const events = await gatherFeed();
    if (!events.length) {
        host.innerHTML = emptyState({
            title: 'No lifecycle events yet.',
            body: 'History appears as Products are linked, POs imported, receipts posted, and stock reserved or assembled.',
            actionLabel: 'Open Dashboard',
            actionView: 'operations-view'
        });
        return;
    }
    host.innerHTML = events.map(eventCard).join('');
}

let bound = false;
export function initHistoryView() {
    if (!bound) {
        bound = true;
        el('btnReloadHistory')?.addEventListener('click', () => {
            const q = el('historySearch')?.value || '';
            renderHistory(q).catch((err) => toastOperatorError(err));
        });
        el('historySearch')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                renderHistory(el('historySearch').value).catch((err) => toastOperatorError(err));
            }
        });
    }
    const pending = consumeOpen('history-view');
    const q = (pending && pending.open) || (pending && pending.extra && pending.extra.q) || '';
    if (el('historySearch') && q) el('historySearch').value = q;
    renderHistory(q).catch((err) => {
        toastOperatorError(err);
        showToast(err.message, 'error');
    });
    void go;
    void dash;
}

window.initHistoryView = initHistoryView;
window.gatherLifecycleFeed = gatherLifecycleFeed;
