/**
 * Small Dashboard helper: resolve a known entity to an existing app destination.
 * Does not invent IDs or views. Missing / inaccessible records return accessible: false.
 */
import { canOpenAppView } from './utils.js?v=7.39';

const TYPE_TO_VIEW = {
    PRODUCT: 'products-view',
    ASSET: 'home-view',
    INVENTORY: 'inventory-view',
    PURCHASE_ORDER: 'purchase-orders-view',
    PO: 'purchase-orders-view',
    RECEIPT_NOTE: 'receipts-view',
    RECEIPT: 'receipts-view',
    RESERVATION: 'reservations-view',
    SET: 'sets-view',
    PHYSICAL_INTAKE: 'physical-intakes-view',
    INTAKE: 'physical-intakes-view'
};

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value == null ? '' : value).trim();
        if (text) return text;
    }
    return '';
}

/**
 * @param {object} entity
 * @returns {{ type: string, view: string, open: string, hash: string, display: string, accessible: boolean, accessibleName: string } | null}
 */
export function getDashboardEntityLink(entity) {
    if (!entity || typeof entity !== 'object') return null;

    const type = firstNonEmpty(entity.type, entity.kind, entity.entityType).toUpperCase();
    const id = firstNonEmpty(entity.id, entity.ID, entity.Id, entity.open);
    if (!id) return null;

    const view = firstNonEmpty(entity.view, entity.refView, TYPE_TO_VIEW[type]);
    if (!view) return null;

    const display = firstNonEmpty(entity.ref, entity.code, id);
    const name = firstNonEmpty(entity.name);
    const typeLabel = type ? type.replace(/_/g, ' ').toLowerCase() : 'record';
    const accessible = typeof canOpenAppView !== 'function' || canOpenAppView(view);

    return {
        type: type || null,
        view,
        open: id,
        hash: `#${view}?id=${encodeURIComponent(id)}`,
        display,
        accessible,
        accessibleName: name
            ? `Open ${typeLabel} ${name} (${display})`
            : `Open ${typeLabel} ${display}`
    };
}

if (typeof window !== 'undefined') {
    window.getDashboardEntityLink = getDashboardEntityLink;
}
