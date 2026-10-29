/**
 * Shared P1 lifecycle UI helpers.
 * Operator language, navigation, role checks. No engine logic.
 */
import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast, canOpenAppView } from './utils.js?v=7.43';

export const LIFECYCLE_CACHE = '7.53';

const OPERATOR_ERRORS = {
    OVER_RECEIPT: 'That quantity exceeds the remaining PO quantity.',
    PO_CANCELLED: 'This Purchase Order has been cancelled in Zoho. New receiving is blocked.',
    RECONCILIATION_REQUIRED: 'The PO quantity is lower than the quantity already received. Procurement must resolve this in Zoho.',
        PRODUCT_MAPPING_REQUIRED: 'This PO line is not linked to an AssetEngine Product yet.',
    ASSET_RESERVED: 'This Asset is currently reserved and cannot be converted.',
    RESOURCE_HAS_ACTIVE_RESERVATION: 'This stock is currently reserved and cannot be converted or inactivated.',
    PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED: 'New stock must be created through Receipt Notes (procurement) or Physical Intake (non-procurement).',
    PRODUCT_REQUIRED: 'Select an existing AssetEngine Product. Physical Intake will not create a Product.',
    INTAKE_TYPE_REQUIRED: 'Choose why this stock exists.',
    INTAKE_REASON_REQUIRED: 'A reason or source note is required for this intake type.',
    INTAKE_QUANTITY_INVALID: 'Enter a quantity greater than zero.',
    INTAKE_PERMISSION_DENIED: 'Sales cannot create Physical Intakes.',
    PO_STATUS_REQUIRED: 'Choose Purchase Order Status before registering this intake.',
    NOT_REQUIRED_AT_REGISTER: 'Mark No PO Required after the holding is registered, from Awaiting Adoption.',
    PO_LINE_REQUIRED: 'Select a Purchase Order and PO line before registering.',
    PRODUCT_MISMATCH: 'The intake Product does not match the Purchase Order line Product.',
    ALREADY_LINKED: 'This holding is already linked to a Purchase Order.',
    PROVENANCE_NOT_AWAITING: 'This holding is not waiting for a Purchase Order.',
    PO_NOT_ELIGIBLE: 'That Purchase Order cannot be linked.',
    PO_LINE_NOT_ELIGIBLE: 'That PO line cannot be linked.',
    PO_LINE_NOT_FOUND: 'That PO line was not found on the selected Purchase Order.',
    QUANTITY_NOT_WHOLE_HOLDING: 'Whole-holding linkage requires the current quantity to match the registered holding.',
    INTAKE_PRODUCT_MAPPING_REQUIRED: 'Map the PO line to an AssetEngine Product before linking this intake.',
    INTAKE_HOLDING_TYPE_REQUIRED: 'Choose Asset or Inventory.',
    LEGACY_SET_OPERATION_DISABLED: 'Legacy Make Set is disabled. Create a Set, add requirements, then allocate stock.',
    LEGACY_SPLIT_CONTAINED: 'Legacy serial Split is disabled. Use Break Quantity or Make Individual.',
    LEGACY_PHYSICAL_CREATE_CONTAINED: 'Temporary assets cannot be made permanent here. Receive stock through Receipt Notes.',
    LEGACY_ASSET_ZOHO_PUSH_CONTAINED: 'Assets are not published to Zoho. Use the Product workspace to map and publish.',
    LEGACY_UNSPLIT_HARD_DELETE: 'Legacy Unsplit is contained and will not delete child records.',
    DUPLICATE_MAPPING: 'That Zoho Product is already linked to another AssetEngine Product.',
    CATALOG_NOT_FOUND: 'That Zoho catalog row was not found. Pull the catalog first.',
    INVALID_QUANTITY: 'Enter a valid quantity.',
    INSUFFICIENT_AVAILABLE: 'Requested quantity is more than what is available.',
    INSUFFICIENT_QUANTITY: 'Requested quantity is more than what is available.',
    DC_HOLDING_NO_QUANTITY: 'Requested quantity is more than what is available on this item.',
    MISSING_ID: 'A required record ID is missing.',
    PO_NOT_FOUND: 'That Purchase Order was not found.',
    RECEIPT_NOT_OPEN: 'Only an open Receipt Note can be posted or edited.',
    SET_LEGACY_MANAGED: 'This is a legacy Managed Set. It is for review only and cannot be allocated here.'
};

const VIEW_NAV = {
    'operations-view': 'nav-operations',
    'home-view': 'nav-dashboard',
    'inventory-view': 'nav-inventory',
    'products-view': 'nav-products',
    'purchase-orders-view': 'nav-purchase-orders',
    'purchase-books-view': 'nav-purchase-books',
    'receipts-view': 'nav-receipts',
    'reservations-view': 'nav-reservations',
    'sets-view': 'nav-sets',
    'history-view': 'nav-history',
    'tally-view': 'nav-tally',
    'physical-intakes-view': 'nav-physical-intakes',
    'dc-view': 'nav-dc',
    'projects-view': 'nav-projects',
    'warranty-view': 'nav-warranty'
};

export function currentRole() {
    return String(window.currentUser?.role || '').toLowerCase();
}

export function canLogistics() {
    // RBAC V2: action permissions only (no role-name triad).
    if (typeof window !== 'undefined' && typeof window.hasPermission === 'function') {
        return (
            window.hasPermission('dc.create')
            || window.hasPermission('receipt_note.create')
            || window.hasPermission('purchase_order.import')
            || window.hasPermission('purchase_book.create')
            || window.hasPermission('reservation.create')
            || window.hasPermission('physical_intake.create')
        );
    }
    return false;
}

export function isSalesRole() {
    const role = currentRole();
    return role === 'sales' || role === 'user';
}

export function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function dash(value) {
    if (value == null || String(value).trim() === '') return '—';
    return escapeHtml(value);
}

export function formatQty(value) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(value);
    if (Number.isInteger(n)) return String(n);
    return String(n);
}

const IST_TZ = 'Asia/Kolkata';

function parseWhen(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value).trim();
    if (!text) return null;
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed);
}

/** Calendar date in IST (e.g. 05 Sep 2026). */
export function formatIstDate(value) {
    const dt = parseWhen(value);
    if (!dt) {
        if (value == null || String(value).trim() === '') return '—';
        return escapeHtml(value);
    }
    const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(dt);
    return escapeHtml(formatted);
}

/** Date + time in IST with explicit zone label (e.g. 05 Sep 2026, 05:30 IST). */
export function formatIstDateTime(value) {
    const dt = parseWhen(value);
    if (!dt) {
        if (value == null || String(value).trim() === '') return '—';
        return escapeHtml(value);
    }
    const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(dt);
    return escapeHtml(`${formatted} IST`);
}

export function formatWhen(value) {
    return formatIstDateTime(value);
}

export function operatorMessage(errOrCode, fallback) {
    const code = typeof errOrCode === 'string'
        ? errOrCode
        : (errOrCode && (errOrCode.reasonCode || errOrCode.reason_code)) || '';
    if (code === 'PRODUCT_MAPPING_REQUIRED' && errOrCode && errOrCode.message && /Map the PO line to an AssetEngine Product/.test(errOrCode.message)) {
        return errOrCode.message;
    }
    if (code && OPERATOR_ERRORS[code]) return OPERATOR_ERRORS[code];
    if (errOrCode && errOrCode.message) return errOrCode.message;
    return fallback || 'Something went wrong. Try again or open technical details.';
}

export function toastOperatorError(err) {
    const message = operatorMessage(err);
    showToast(message, 'error');
    return message;
}

export function technicalDetails(err) {
    if (!err) return '';
    const parts = [];
    if (err.reasonCode) parts.push(`Reason: ${err.reasonCode}`);
    if (err.status || err.statusCode) parts.push(`HTTP ${err.status || err.statusCode}`);
    if (err.details) {
        try { parts.push(JSON.stringify(err.details)); } catch (_e) { /* ignore */ }
    }
    return parts.join(' · ');
}

export async function lifecycleApi(path, options = {}) {
    const response = await fetchWithAuth(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.status = response.status;
        err.statusCode = data.statusCode || response.status;
        err.reasonCode = data.reasonCode;
        err.details = data.details;
        throw err;
    }
    return data;
}

export function statusChip(status, kind = '') {
    const s = String(status || '—').toUpperCase();
    const k = String(kind || s);
    let bg = '#e5e7eb';
    let fg = '#374151';
    if (['ACTIVE', 'OPEN', 'LINKED', 'SYNCED', 'IMPORTED', 'COMPLETE', 'POSTED'].includes(k) || s === 'ACTIVE' || s === 'OPEN' || s === 'LINKED' || s === 'SYNCED' || s === 'POSTED' || s === 'COMPLETE') {
        bg = '#dcfce7'; fg = '#166534';
    }
    if (['INCOMPLETE', 'UNLINKED', 'CREATED', 'PENDING'].includes(s)) {
        bg = '#fef9c3'; fg = '#854d0e';
    }
    if (['CONFLICT', 'FAILED', 'RECONCILIATION_REQUIRED', 'CANCELLED', 'OVERCOMPLETE', 'REVERSED'].includes(s)) {
        bg = '#fee2e2'; fg = '#991b1b';
    }
    if (['ARCHIVED', 'RELEASED', 'LEGACY', 'CONTAINED', 'MANUAL REVIEW'].includes(s)) {
        bg = '#f3f4f6'; fg = '#4b5563';
    }
    return `<span class="lc-chip" style="background:${bg};color:${fg};">${escapeHtml(s)}</span>`;
}

export function emptyState({ title, body, actionLabel, actionView, actionAttr }) {
    const btn = actionLabel
        ? `<button type="button" class="action-button blue" data-lc-go="${escapeHtml(actionView || '')}" ${actionAttr || ''}>${escapeHtml(actionLabel)}</button>`
        : '';
    return `<div class="lc-empty" role="status">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        ${btn}
    </div>`;
}

export function crumb(items) {
    const parts = (items || []).filter(Boolean).map((item, idx) => {
        if (item.view || item.on) {
            return `<button type="button" class="lc-crumb-link" data-lc-go="${escapeHtml(item.view || '')}" data-lc-open="${escapeHtml(item.open || '')}">${escapeHtml(item.label)}</button>`;
        }
        const current = idx === items.length - 1 ? ' aria-current="page"' : '';
        return `<span class="lc-crumb-current"${current}>${escapeHtml(item.label)}</span>`;
    });
    return `<nav class="lc-crumbs" aria-label="Lifecycle">${parts.join('<span class="lc-crumb-sep" aria-hidden="true">→</span>')}</nav>`;
}

export function section(title, body, extraClass = '') {
    return `<section class="lc-section ${extraClass}">
        <div class="lc-section-label">${escapeHtml(title)}</div>
        ${body}
    </section>`;
}

export function go(view, opts = {}) {
    if (view && typeof canOpenAppView === 'function' && !canOpenAppView(view)) {
        showToast('You are not authorized to open that page.', 'error');
        return;
    }
    window.__lifecyclePending = { view, open: opts.open || opts.id || '', extra: opts };
    const params = new URLSearchParams();
    if (opts.open || opts.id) params.set('id', opts.open || opts.id);
    if (opts.poId) params.set('poId', opts.poId);
    if (opts.q) params.set('q', opts.q);
    if (opts.waitlist) params.set('waitlist', '1');
    if (opts.awaiting) params.set('awaiting', '1');
    if (opts.zohoCatalog) params.set('zohoCatalog', '1');
    if (opts.aeUnlinked) params.set('aeUnlinked', '1');
    if (opts.status) params.set('status', String(opts.status));
    if (opts.createFromPo) params.set('createFromPo', opts.createFromPo);
    const qs = params.toString();
    const hash = qs ? `#${view}?${qs}` : `#${view}`;
    if (window.location.hash !== hash) {
        window.history.pushState({ subView: view }, '', hash);
    }
    if (typeof window.switchDashboardSubView === 'function') {
        window.switchDashboardSubView(view);
    }
    const navId = VIEW_NAV[view];
    const nav = navId ? document.getElementById(navId) : null;
    if (nav) {
        nav.click();
        return;
    }
    if (typeof window.switchDashboardSubView === 'function') {
        window.switchDashboardSubView(view);
    }
}

export function consumeOpen(view) {
    const pending = window.__lifecyclePending;
    if (pending && pending.view === view) {
        window.__lifecyclePending = null;
        return pending;
    }
    const hash = String(window.location.hash || '').replace(/^#/, '');
    const [viewName, query] = hash.split('?');
    if (viewName !== view) return null;
    const params = new URLSearchParams(query || '');
    const id = params.get('id') || params.get('open');
    const waitlist = params.get('waitlist');
    const status = params.get('status');
    const awaiting = params.get('awaiting');
    const zohoCatalog = params.get('zohoCatalog');
    const aeUnlinked = params.get('aeUnlinked');
    const period = params.get('period');
    const createFromPo = params.get('createFromPo');
    if (!id && !params.get('poId') && !params.get('q') && !waitlist && !status && !awaiting && !zohoCatalog && !aeUnlinked && !period && !createFromPo) return null;
    return { view, open: id, createFromPo, extra: { poId: params.get('poId'), q: params.get('q'), waitlist, status, awaiting, zohoCatalog, aeUnlinked, period, createFromPo } };
}

function lifecycleOptsFromEl(el) {
    return {
        open: el.getAttribute('data-lc-open') || '',
        waitlist: el.getAttribute('data-lc-waitlist') || undefined,
        status: el.getAttribute('data-lc-status') || undefined,
        awaiting: el.getAttribute('data-lc-awaiting') || undefined,
        zohoCatalog: el.getAttribute('data-lc-zoho-catalog') || undefined,
        aeUnlinked: el.getAttribute('data-lc-ae-unlinked') || undefined,
        period: el.getAttribute('data-lc-period') || undefined
    };
}

export function bindLifecycleClicks(root) {
    const host = root || document;
    host.querySelectorAll('[data-lc-go]').forEach((el) => {
        if (el.dataset.lcBound) return;
        el.dataset.lcBound = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const view = el.getAttribute('data-lc-go');
            if (view) go(view, lifecycleOptsFromEl(el));
        });
    });
}

export function holdingKindLabel(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'ASSET') return 'Asset (individually identified)';
    if (t === 'INVENTORY') return 'Inventory (quantity-tracked)';
    return t || '—';
}

function onDocumentClick(e) {
    const el = e.target.closest('[data-lc-go]');
    if (!el) return;
    const view = el.getAttribute('data-lc-go');
    if (!view) return;
    e.preventDefault();
    go(view, lifecycleOptsFromEl(el));
}

if (!window.__lifecycleClickBound) {
    window.__lifecycleClickBound = true;
    document.addEventListener('click', onDocumentClick);
}

window.lifecycleGo = go;
window.operatorMessage = operatorMessage;
window.toastOperatorError = toastOperatorError;
window.canLogistics = canLogistics;
