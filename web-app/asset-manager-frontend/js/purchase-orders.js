import { fetchWithAuth } from './auth.js?v=7.30';
import { showToast, hasPermission } from './utils.js?v=6.61';
import {
    canLogistics,
    escapeHtml,
    dash,
    emptyState,
    crumb,
    section,
    consumeOpen,
    toastOperatorError,
    formatQty,
    formatIstDate,
    formatIstDateTime
} from './lifecycle.js?v=7.33';

function el(id) {
    return document.getElementById(id);
}

function canManageProcurement() {
    return canLogistics();
}

/** The PO name in AssetEngine is the Outbound PO Identifier. Subject stays the stored Zoho name. */
function poLabel(po) {
    const identifier = String(po?.outboundPoIdentifier || '').trim();
    if (identifier) return identifier;
    return 'No Outbound PO Identifier';
}

function poAccountLine(po) {
    const name = String(po?.accountName || '').trim() || 'No Zoho account';
    const projectId = String(po?.customerId || '').trim();
    return projectId ? `${name} · Project ${projectId}` : name;
}

function poStoredName(po) {
    return String(po?.subject || '').trim();
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
    const bg = s === 'CANCELLED' ? '#f3f4f6' : s === 'APPROVED' ? '#dcfce7' : s === 'DELIVERED' ? '#dbeafe' : s === 'CREATED' ? '#fef9c3' : s === 'POSTED' ? '#dcfce7' : s === 'OPEN' ? '#fef9c3' : s === 'VOID' || s === 'DRAFT' ? '#f3f4f6' : '#e5e7eb';
    const fg = s === 'CANCELLED' || s === 'VOID' || s === 'DRAFT' ? '#4b5563' : s === 'APPROVED' || s === 'POSTED' ? '#166534' : s === 'DELIVERED' ? '#1e40af' : s === 'CREATED' || s === 'OPEN' ? '#854d0e' : '#374151';
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${escapeHtml(s || '—')}</span>`;
}

function syncChip(status) {
    const s = String(status || '').toUpperCase();
    const bg = s === 'RECONCILIATION_REQUIRED' || s === 'FAILED' ? '#fee2e2'
        : s === 'CANCELLED' ? '#f3f4f6'
        : s === 'SYNCED' || s === 'IMPORTED' ? '#dcfce7'
        : s === 'NOT_IMPORTED' ? '#f3f4f6'
        : '#e0e7ff';
    const fg = s === 'RECONCILIATION_REQUIRED' || s === 'FAILED' ? '#991b1b'
        : s === 'CANCELLED' ? '#4b5563'
        : s === 'SYNCED' || s === 'IMPORTED' ? '#166534'
        : '#3730a3';
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${escapeHtml(s || '—')}</span>`;
}

function activePoLines(po) {
    return (po.lines || []).filter((line) => String(line.lineStatus || 'OPEN').toUpperCase() !== 'WITHDRAWN');
}

function receivingProgress(po) {
    const lines = activePoLines(po);
    if (!lines.length) return po.source === 'LOCAL' ? 'Legacy' : '—';
    const ordered = lines.reduce((sum, line) => sum + Number(line.ordered || 0), 0);
    const accepted = lines.reduce((sum, line) => sum + Number(line.accepted || 0), 0);
    return `${accepted} / ${ordered}`;
}

function lineItemCount(po) {
    return activePoLines(po).length;
}

function isWaitlistPo(po) {
    if (String(po.source || '').toUpperCase() === 'LOCAL') return false;
    if (po.reconciliationRequired || po.mappingRequired) return false;
    if (String(po.status || '').toUpperCase() === 'CANCELLED') return false;
    return activePoLines(po).some((line) => Number(line.outstanding || 0) > 0);
}

async function loadAeProductNames(productIds) {
    const unique = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const names = {};
    await Promise.all(unique.map(async (id) => {
        try {
            const data = await api(`/api/products/${encodeURIComponent(id)}`);
            const name = data.product && data.product.name ? String(data.product.name).trim() : '';
            if (name) names[id] = name;
        } catch (_err) {
            // Presentation only.
        }
    }));
    return names;
}

function productColumnHtml(line, names) {
    if (line.mappingRequired) {
        const zohoName = line.productName || line.zohoProductName || '';
        const zohoRef = line.zohoProductId
            ? `<div class="po-product-zoho">Zoho Product reference ${escapeHtml(String(line.zohoProductId))}</div>`
            : '';
        return `<span style="color:#991b1b;font-weight:700;">PRODUCT MAPPING REQUIRED</span>
            ${zohoName ? `<div class="po-product-name">${escapeHtml(zohoName)}</div>` : ''}
            ${zohoRef}`;
    }
    if (!line.productId) return dash(line.productId);
    const aeName = names[line.productId];
    const zohoName = line.productName || line.zohoProductName || '';
    return `<div class="po-product-cell">
        <button type="button" class="lc-crumb-link po-product-id" data-lc-go="products-view" data-lc-open="${escapeHtml(line.productId)}" aria-label="Open AssetEngine Product ${escapeHtml(line.productId)}">${escapeHtml(line.productId)}</button>
        ${aeName ? `<div class="po-product-name">${escapeHtml(aeName)}</div>` : (zohoName ? `<div class="po-product-name">${escapeHtml(zohoName)}</div>` : '')}
    </div>`;
}

const CAROUSEL_STEPS = [
    { id: 'po', label: 'PO' },
    { id: 'receipts', label: 'Receipts' },
    { id: 'books', label: 'Books' },
    { id: 'dc', label: 'DC' }
];

let viewListenersBound = false;
let selectedId = null;
let waitlistOnly = false;
let carousel = {
    open: false,
    poId: null,
    poSource: null,
    step: 0,
    po: null,
    cache: {}
};

function clearOperationContext() {
    window.__poCarouselContext = null;
    carousel = { open: false, poId: null, poSource: null, step: 0, po: null, cache: {} };
}

function setOperationContext(po) {
    window.__poCarouselContext = {
        poId: po.id,
        poNumber: poLabel(po),
        source: po.source || 'ZOHO'
    };
}

function ensureCarouselDom() {
    let overlay = el('poCarouselOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'poCarouselOverlay';
    overlay.className = 'po-carousel-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="po-carousel-backdrop" data-po-carousel-close="1"></div>
        <div class="po-carousel-modal" id="poCarouselModal" role="dialog" aria-modal="true" aria-labelledby="poCarouselTitle">
            <header class="po-carousel-header">
                <div class="po-carousel-header-main">
                    <h2 id="poCarouselTitle" class="po-carousel-title">PO</h2>
                    <div id="poCarouselSub" class="po-carousel-sub"></div>
                </div>
                <button type="button" class="po-carousel-close" data-po-carousel-close="1" aria-label="Close">×</button>
            </header>
            <nav class="po-carousel-steps" id="poCarouselSteps" aria-label="Lifecycle steps"></nav>
            <div class="po-carousel-metrics" id="poCarouselStrip" hidden></div>
            <div class="po-carousel-body" id="poCarouselBody"></div>
            <footer class="po-carousel-footer">
                <button type="button" class="action-button grey" id="poCarouselPrev">← Prev</button>
                <span class="po-carousel-step-label" id="poCarouselStepLabel"></span>
                <button type="button" class="action-button blue" id="poCarouselNext">Next →</button>
            </footer>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-po-carousel-close')) {
            closeCarousel();
        }
    });
    el('poCarouselPrev')?.addEventListener('click', () => {
        if (carousel.step > 0) {
            carousel.step -= 1;
            renderCarouselStep().catch((err) => toastOperatorError(err));
        }
    });
    el('poCarouselNext')?.addEventListener('click', () => {
        if (carousel.step >= CAROUSEL_STEPS.length - 1) {
            closeCarousel();
            return;
        }
        carousel.step += 1;
        renderCarouselStep().catch((err) => toastOperatorError(err));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !carousel.open) return;
        const nested = el('poNestedDialog');
        if (nested && !nested.hidden) {
            nested.hidden = true;
            return;
        }
        closeCarousel();
    });
    return overlay;
}

function closeCarousel() {
    const overlay = el('poCarouselOverlay');
    if (overlay) {
        overlay.classList.remove('po-carousel-open');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        const modal = el('poCarouselModal');
        modal?.classList.remove('po-carousel-expanded');
        const nested = el('poNestedDialog');
        if (nested) nested.hidden = true;
        const strip = el('poCarouselStrip');
        if (strip) {
            strip.hidden = true;
            strip.innerHTML = '';
        }
    }
    clearOperationContext();
    selectedId = null;
}

function isLoginVisible() {
    const login = document.getElementById('loginView');
    if (!login) return document.body.classList.contains('login-page');
    return login.classList.contains('active') || document.body.classList.contains('login-page');
}

async function openCarousel(poId, source, fromCardEl) {
    if (isLoginVisible()) {
        closeCarousel();
        return;
    }
    // Legacy local POs skip the commercial carousel — read-only detail only.
    if (String(source || '').toUpperCase() === 'LOCAL') {
        closeCarousel();
        selectedId = poId;
        await renderLegacyDetail(poId);
        return;
    }
    const overlay = ensureCarouselDom();
    const modal = el('poCarouselModal');
    carousel.open = true;
    carousel.poId = poId;
    carousel.poSource = source;
    carousel.step = 0;
    carousel.cache = {};
    selectedId = poId;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');

    // FLIP expand from card
    if (fromCardEl && modal) {
        const r = fromCardEl.getBoundingClientRect();
        modal.style.setProperty('--po-flip-x', `${r.left + r.width / 2}px`);
        modal.style.setProperty('--po-flip-y', `${r.top + r.height / 2}px`);
        modal.style.setProperty('--po-flip-sx', String(Math.max(0.12, r.width / Math.min(window.innerWidth * 0.92, 960))));
        modal.style.setProperty('--po-flip-sy', String(Math.max(0.12, r.height / Math.min(window.innerHeight * 0.88, 720))));
        modal.classList.remove('po-carousel-expanded');
    }

    requestAnimationFrame(() => {
        if (isLoginVisible()) {
            closeCarousel();
            return;
        }
        overlay.classList.add('po-carousel-open');
        modal?.classList.add('po-carousel-expanded');
    });

    await renderCarouselStep();
}

function renderStepNav() {
    const nav = el('poCarouselSteps');
    if (!nav) return;
    nav.innerHTML = CAROUSEL_STEPS.map((s, i) => `
        <button type="button" class="po-carousel-step-btn ${i === carousel.step ? 'active' : ''} ${i < carousel.step ? 'done' : ''}" data-step="${i}">
            <span class="po-carousel-step-num">${i + 1}</span>
            <span class="po-carousel-step-name">${escapeHtml(s.label)}</span>
        </button>
    `).join('<span class="po-carousel-step-sep" aria-hidden="true"></span>');
    nav.querySelectorAll('[data-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
            carousel.step = Number(btn.getAttribute('data-step')) || 0;
            renderCarouselStep().catch((err) => toastOperatorError(err));
        });
    });
    const prev = el('poCarouselPrev');
    const next = el('poCarouselNext');
    if (prev) prev.disabled = carousel.step <= 0;
    if (next) {
        next.disabled = carousel.step >= CAROUSEL_STEPS.length - 1;
        next.textContent = carousel.step >= CAROUSEL_STEPS.length - 1 ? 'Done' : 'Next →';
    }
    const label = el('poCarouselStepLabel');
    if (label) label.textContent = `Step ${carousel.step + 1} of ${CAROUSEL_STEPS.length}`;
}

async function loadCarouselPo(force = false) {
    if (!force && carousel.po && carousel.po.id === carousel.poId) return carousel.po;
    const data = await api(`/api/procurement/pos/${encodeURIComponent(carousel.poId)}`);
    carousel.po = data.purchaseOrder;
    setOperationContext(carousel.po);
    return carousel.po;
}

async function renderCarouselStep() {
    const body = el('poCarouselBody');
    if (!body) return;
    renderStepNav();
    body.innerHTML = '<p class="lc-muted" style="padding:24px;">Loading…</p>';
    const po = await loadCarouselPo();
    const stepId = CAROUSEL_STEPS[carousel.step].id;
    const logistics = canManageProcurement();
    el('poCarouselTitle').textContent = poLabel(po);

    if (stepId === 'po') {
        const ctx = await loadPoPhysicalContext(po);
        setStepChrome(po, `
            <span class="po-header-actions">
                ${logistics ? '<button type="button" class="action-button blue" id="btnCarPoRefresh">Refresh from Zoho</button>' : ''}
                ${logistics ? '<button type="button" class="action-button grey" id="btnCarVoidDocs">Void RN, Books, and DCs</button>' : ''}
                <button type="button" class="action-button grey" id="btnCarPoHistory">History</button>
                <button type="button" class="action-button grey" id="btnCarPoPhysical">Physical Outputs</button>
            </span>`, [
            { k: 'Receipt Notes', v: ctx.notes.length, muted: `Open ${ctx.openCount} · Posted ${ctx.postedCount}` },
            { k: 'Physical outputs', v: ctx.outputs.length, muted: 'Assets & Inventory' },
            { k: 'Lines', v: lineItemCount(po), muted: `Receiving ${receivingProgress(po)}` }
        ]);
        el('btnCarVoidDocs')?.addEventListener('click', async () => {
            const label = poLabel(po);
            const ok = confirm(
                `Void Receipt Notes, Purchase Books, and Delivery Challans created against ${label}?\n\nThey are marked void for the current version of this Purchase Order. Dispatched challans, and receipts whose stock is already in use, are left in place and listed.`
            );
            if (!ok) return;
            try {
                const result = await api(`/api/procurement/pos/${encodeURIComponent(po.id)}/void-documents`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: `Voided for ${label}, current Purchase Order version` })
                });
                const done = (result.voided || []).map((row) => `${row.kind} ${row.label} ${row.status}`).join(', ');
                const held = (result.blocked || []).map((row) => `${row.kind} ${row.label}: ${row.message}`).join('\n');
                if (held) {
                    showToast(done ? `Voided ${done}. Some documents were left: ${held}` : held, 'error');
                } else if (!done) {
                    showToast('Nothing open to void on this Purchase Order', 'success');
                } else {
                    showToast(`Voided for ${label}: ${done}`, 'success');
                }
                carousel.po = null;
                carousel.cache.physical = null;
                await renderCarouselStep();
            } catch (err) {
                toastOperatorError(err);
            }
        });
        el('btnCarPoRefresh')?.addEventListener('click', async () => {
            try {
                await api(`/api/purchase-orders/${encodeURIComponent(po.id)}/refresh-zoho`, { method: 'POST' });
                showToast('Refreshed from Zoho', 'success');
                carousel.po = null;
                carousel.cache.physical = null;
                await renderCarouselStep();
            } catch (err) {
                toastOperatorError(err);
            }
        });
        el('btnCarPoHistory')?.addEventListener('click', () => {
            openPoHistoryDialog(po).catch((err) => toastOperatorError(err));
        });
        el('btnCarPoPhysical')?.addEventListener('click', () => {
            openPhysicalOutputsDialog(ctx.outputs || []);
        });
        await renderStepPoOverview(body, po);
        return;
    }

    if (stepId === 'receipts') {
        await renderStepReceipts(body, po);
        return;
    }
    if (stepId === 'books') {
        await renderStepBooks(body, po);
        return;
    }
    await renderStepDc(body, po);
}

function setStepChrome(po, actionsHtml, metrics) {
    el('poCarouselSub').innerHTML = `
        ${statusChip(po.status)}
            <span class="po-carousel-meta">· ${escapeHtml(poStoredName(po) || 'No stored name')} · ${escapeHtml(poAccountLine(po))} · Receiving ${escapeHtml(receivingProgress(po))} · ${escapeHtml(formatIstDate(po.poDate))} → ${escapeHtml(formatIstDate(po.dueDate))}</span>
        ${actionsHtml || ''}`;
    renderStepMetrics(metrics);
}

function renderStepMetrics(metrics) {
    const host = el('poCarouselStrip');
    if (!host) return;
    const list = Array.isArray(metrics) ? metrics : [];
    if (!list.length) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    host.hidden = false;
    host.innerHTML = list.map((m) => `
        <div class="po-metric">
            <span class="po-metric-k">${escapeHtml(m.k)}</span>
            <strong>${escapeHtml(String(m.v ?? '—'))}</strong>
            ${m.muted ? `<span>${escapeHtml(String(m.muted))}</span>` : ''}
        </div>`).join('');
}

async function loadPoPhysicalContext(po) {
    if (carousel.cache.physical && carousel.cache.physical.poId === po.id) {
        return carousel.cache.physical;
    }
    let notes = [];
    let outputs = [];
    try {
        const data = await api(`/api/receipt-notes?poId=${encodeURIComponent(po.id)}&limit=50`);
        notes = data.receiptNotes || [];
        const posted = notes.filter((n) => String(n.status).toUpperCase() === 'POSTED');
        for (const n of posted.slice(0, 12)) {
            try {
                const detail = await api(`/api/receipt-notes/${encodeURIComponent(n.id)}`);
                (detail.outputs || []).forEach((o) => outputs.push({ ...o, receiptNoteId: n.id }));
            } catch (_err) { /* skip */ }
        }
    } catch (_err) { /* counters stay at zero */ }
    const ctx = {
        poId: po.id,
        notes,
        outputs,
        openCount: notes.filter((n) => String(n.status).toUpperCase() === 'OPEN').length,
        postedCount: notes.filter((n) => String(n.status).toUpperCase() === 'POSTED').length
    };
    carousel.cache.physical = ctx;
    return ctx;
}

function ensureNestedDialog() {
    let dlg = el('poNestedDialog');
    if (dlg) return dlg;
    const overlay = el('poCarouselOverlay') || document.body;
    dlg = document.createElement('div');
    dlg.id = 'poNestedDialog';
    dlg.className = 'po-nested-dialog';
    dlg.hidden = true;
    overlay.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('[data-po-nested-close]')) dlg.hidden = true;
    });
    return dlg;
}

function openPhysicalOutputsDialog(outputs) {
    const dlg = ensureNestedDialog();
    const assets = outputs.filter((o) => String(o.resourceType || '').toUpperCase() !== 'INVENTORY');
    const inventory = outputs.filter((o) => String(o.resourceType || '').toUpperCase() === 'INVENTORY');
    const rows = (list) => (list.length
        ? `<ul class="lc-event-list po-nested-list">${list.map((o) => {
            const view = String(o.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
            return `<li>
                <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(o.resourceId)}">${escapeHtml(o.resourceId)}</button>
                × ${escapeHtml(o.quantity)}
                ${o.receiptNoteId ? `<span class="po-strip-muted">via ${escapeHtml(o.receiptNoteId)}</span>` : ''}
            </li>`;
        }).join('')}</ul>`
        : '<p class="lc-muted">None linked yet.</p>');
    dlg.hidden = false;
    dlg.innerHTML = `
        <div class="po-nested-card" role="dialog" aria-modal="true" aria-label="Physical outputs">
            <header class="po-nested-head">
                <h3>Physical outputs</h3>
                <button type="button" class="po-carousel-close" data-po-nested-close="1" aria-label="Close">×</button>
            </header>
            <h4 class="po-carousel-section-title">Assets</h4>
            ${rows(assets)}
            <h4 class="po-carousel-section-title">Inventory</h4>
            ${rows(inventory)}
        </div>`;
}

async function openPoHistoryDialog(po) {
    const dlg = ensureNestedDialog();
    dlg.hidden = false;
    dlg.innerHTML = `
        <div class="po-nested-card" role="dialog" aria-modal="true" aria-label="PO history">
            <header class="po-nested-head">
                <h3>Sync history</h3>
                <button type="button" class="po-carousel-close" data-po-nested-close="1" aria-label="Close">×</button>
            </header>
            <p class="lc-muted">Loading…</p>
        </div>`;
    const hist = await api(`/api/procurement/pos/${encodeURIComponent(po.id)}/history`);
    const card = dlg.querySelector('.po-nested-card');
    if (!card) return;
    const events = hist.events || [];
    card.insertAdjacentHTML('beforeend', events.length
        ? events.map((ev) => `
            <div class="po-hist-row">
                <span class="po-mono">${formatIstDateTime(ev.createdAt)}</span>
                · ${escapeHtml(ev.operation)} · ${escapeHtml(ev.status)}
                ${ev.errorMessage ? ` · ${escapeHtml(ev.errorMessage)}` : ''}
            </div>`).join('')
        : '<p class="lc-muted">No history yet.</p>');
    card.querySelector('.lc-muted')?.remove();
}

async function renderStepPoOverview(body, po) {
    const productNames = await loadAeProductNames(
        activePoLines(po).filter((line) => line.productId && !line.mappingRequired).map((line) => line.productId)
    );

    let reconHtml = '';
    try {
        await api(`/api/procurement/pos/${encodeURIComponent(po.id)}/sync-reconciliations`, { method: 'POST', body: '{}' });
        const reconData = await api(`/api/procurement/reconciliations?poId=${encodeURIComponent(po.id)}&limit=20`);
        const openRecons = (reconData.reconciliations || []).filter((r) =>
            ['OPEN', 'RESOLUTION_SELECTED', 'RETURN_PENDING', 'RETAINED', 'RETURNED_TO_VENDOR'].includes(String(r.status))
            || Number(r.differenceQuantity) > 0
        );
        if (openRecons.length) {
            reconHtml = `
            <div class="po-recon-banner" id="poReconPanel">
                <strong>COMMERCIAL QUANTITY MISMATCH</strong>
                <p class="lc-muted" style="margin:6px 0 10px;">Physical stock is unchanged. Choose what happened to the excess.</p>
                ${openRecons.map((r) => `
                    <div class="po-recon-card" data-recon-id="${escapeHtml(r.id)}" style="background:#fff;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:10px;">
                        <div class="po-mono">${escapeHtml(r.id)}</div>
                        <div style="margin-top:6px;">Current PO: <strong>${escapeHtml(r.commercialQuantity)}</strong>
                         · Physically Received: <strong>${escapeHtml(r.physicalReceivedQuantity)}</strong>
                         · Returned: ${escapeHtml(r.physicallyReturnedQuantity)}
                         · Retained: ${escapeHtml(r.retainedQuantity)}
                         · Difference: <strong>${escapeHtml(r.differenceQuantity)}</strong></div>
                        <div style="margin-top:4px;">Status: <strong>${escapeHtml(r.status)}</strong></div>
                        ${Number(r.differenceQuantity) > 0 ? `
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            <button type="button" class="action-button green btn-recon-return" data-id="${escapeHtml(r.id)}">Return ${escapeHtml(r.differenceQuantity)} to Vendor</button>
                            <button type="button" class="action-button grey btn-recon-retain" data-id="${escapeHtml(r.id)}">Retain ${escapeHtml(r.differenceQuantity)} in Cineom</button>
                        </div>` : ''}
                    </div>
                `).join('')}
            </div>`;
        } else if (po.reconciliationRequired) {
            reconHtml = `<div class="po-recon-banner"><strong>RECONCILIATION REQUIRED</strong><br>Further receiving is blocked. Refresh the PO or open reconciliation actions after sync.</div>`;
        }
    } catch (_) {
        if (po.reconciliationRequired) {
            reconHtml = `<div class="po-recon-banner"><strong>RECONCILIATION REQUIRED</strong><br>Further receiving is blocked until the physical excess is resolved.</div>`;
        }
    }

    body.innerHTML = `
        ${reconHtml}
        ${po.mappingRequired ? `<div class="po-map-banner"><strong>PRODUCT MAPPING REQUIRED</strong><br>Link Zoho products to AssetEngine Products before receiving.</div>` : ''}
        <h3 class="po-carousel-section-title">Product lines</h3>
        <div class="po-carousel-table-wrap">
            <table class="data-table po-carousel-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Description</th>
                        <th>Ordered</th>
                        <th>Accepted</th>
                        <th>Outstanding</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${activePoLines(po).map((line) => `
                        <tr class="${line.reconciliationRequired ? 'po-row-recon' : ''}">
                            <td class="po-product-td">${productColumnHtml(line, productNames)}</td>
                            <td class="po-desc-cell">${dash(line.description)}</td>
                            <td>${escapeHtml(line.ordered)}</td>
                            <td>${escapeHtml(line.accepted)}</td>
                            <td>${escapeHtml(line.outstanding)}</td>
                            <td>${syncChip(line.reconciliationStatus || (line.mappingRequired ? 'MAPPING' : 'OK'))}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="6" class="lc-muted">No lines</td></tr>'}
                </tbody>
            </table>
        </div>
    `;

    body.querySelectorAll('.btn-recon-retain').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Retain excess physical stock in Cineom?\n\nPhysical quantity will NOT be reduced. Commercial reconciliation will close for this difference.')) return;
            try {
                await api(`/api/procurement/reconciliations/${encodeURIComponent(id)}/retain`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                showToast('Excess retained in Cineom — physical stock unchanged', 'success');
                await renderStepPoOverview(body, po);
            } catch (err) {
                toastOperatorError(err);
            }
        });
    });

    body.querySelectorAll('.btn-recon-return').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const reconId = btn.getAttribute('data-id');
            try {
                const detail = await api(`/api/procurement/reconciliations/${encodeURIComponent(reconId)}`);
                const r = detail.reconciliation;
                const eligible = await api(`/api/vendor-returns/eligible/${encodeURIComponent(r.procurementPoLineId)}`);
                const holdings = eligible.holdings || [];
                if (!holdings.length) {
                    showToast('No eligible physical holdings available to return', 'error');
                    return;
                }
                // Prefer inventory for qty-based excess; else first N assets matching difference
                const need = Number(r.differenceQuantity);
                const lines = [];
                let remaining = need;
                for (const h of holdings) {
                    if (remaining <= 1e-9) break;
                    if (h.resourceType === 'INVENTORY') {
                        const q = Math.min(remaining, Number(h.quantity));
                        lines.push({
                            resourceType: 'INVENTORY',
                            resourceId: h.resourceId,
                            quantity: q,
                            procurementPoLineId: r.procurementPoLineId,
                            productId: h.productId
                        });
                        remaining -= q;
                    } else if (h.resourceType === 'ASSET' && remaining >= 1 - 1e-9) {
                        lines.push({
                            resourceType: 'ASSET',
                            resourceId: h.resourceId,
                            quantity: 1,
                            serialNumber: h.serialSnapshot || undefined,
                            procurementPoLineId: r.procurementPoLineId,
                            productId: h.productId
                        });
                        remaining -= 1;
                    }
                }
                if (!lines.length || remaining > 1e-9) {
                    showToast(`Could not select holdings for full difference (${need}). Available holdings insufficient or asset-only mismatch.`, 'error');
                    return;
                }
                if (!confirm(`Create Vendor Return for ${need} unit(s)?\n\nStock is NOT removed until you READY → DISPATCH.`)) return;
                const created = await api('/api/vendor-returns', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        procurementPoId: r.procurementPoId,
                        procurementReconciliationId: r.id,
                        lines
                    })
                });
                const vrId = created.vendorReturn?.id;
                await api(`/api/vendor-returns/${encodeURIComponent(vrId)}/ready`, { method: 'POST', body: '{}' });
                if (!confirm(`Vendor Return ${vrId} is READY.\n\nDISPATCH now? This removes physical stock from Cineom.`)) {
                    showToast(`Vendor Return ${vrId} created READY — dispatch when ready`, 'success');
                    await renderStepPoOverview(body, po);
                    return;
                }
                await api(`/api/vendor-returns/${encodeURIComponent(vrId)}/dispatch`, { method: 'POST', body: '{}' });
                showToast(`Vendor Return ${vrId} DISPATCHED — physical stock exited`, 'success');
                await renderStepPoOverview(body, po);
            } catch (err) {
                toastOperatorError(err);
            }
        });
    });

    void formatQty;
    void section;
    void crumb;
}

async function renderStepReceipts(body, po) {
    const logistics = canManageProcurement();
    let notes = [];
    try {
        const data = await api(`/api/receipt-notes?poId=${encodeURIComponent(po.id)}&limit=100`);
        notes = data.receiptNotes || [];
    } catch (err) {
        setStepChrome(po, '', []);
        body.innerHTML = `<p class="lc-muted">${escapeHtml(err.message)}</p>`;
        return;
    }

    const openCount = notes.filter((n) => String(n.status).toUpperCase() === 'OPEN').length;
    const postedCount = notes.filter((n) => String(n.status).toUpperCase() === 'POSTED').length;
    const acceptedTotal = notes.reduce((s, n) => s + Number(n.acceptedQuantity || 0), 0);

    setStepChrome(po, `
        <span class="po-header-actions">
            ${logistics ? '<button type="button" class="action-button green" id="btnCarCreateRn">Create Receipt Note</button>' : ''}
            <button type="button" class="action-button grey" id="btnCarViewAllRn">Open Receipts</button>
        </span>`, [
        { k: 'Receipt Notes', v: notes.length, muted: `Open ${openCount} · Posted ${postedCount}` },
        { k: 'Accepted qty', v: acceptedTotal, muted: 'Across notes' },
        { k: 'Lines', v: lineItemCount(po), muted: `Receiving ${receivingProgress(po)}` }
    ]);

    body.innerHTML = `
        <p class="lc-muted">Receipt Notes create physical stock for this PO. They are not Purchase Books.</p>
        ${notes.length
            ? `<div class="po-carousel-table-wrap"><table class="data-table po-carousel-table">
                <thead><tr><th>Receipt</th><th>Status</th><th>Accepted</th><th>Vendor invoice</th><th>Created</th></tr></thead>
                <tbody>
                    ${notes.map((n) => `
                        <tr class="po-car-rn-row" data-rn-id="${escapeHtml(n.id)}" style="cursor:pointer;">
                            <td class="po-mono">${escapeHtml(n.id)}</td>
                            <td>${statusChip(n.status)}</td>
                            <td>${escapeHtml(String(n.acceptedQuantity ?? '—'))}</td>
                            <td>${dash(n.vendorInvoiceNo)}</td>
                            <td>${formatIstDateTime(n.createdAt)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table></div>`
            : '<p class="lc-muted">No Receipt Notes yet for this PO.</p>'}
    `;

    el('btnCarCreateRn')?.addEventListener('click', () => {
        closeCarousel();
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('receipts-view', { createFromPo: po.id, poId: po.id });
        }
    });
    el('btnCarViewAllRn')?.addEventListener('click', () => {
        closeCarousel();
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('receipts-view', { poId: po.id });
        }
    });
    body.querySelectorAll('.po-car-rn-row').forEach((row) => {
        row.addEventListener('click', () => {
            const id = row.getAttribute('data-rn-id');
            closeCarousel();
            if (typeof window.lifecycleGo === 'function') {
                window.lifecycleGo('receipts-view', { open: id, poId: po.id });
            }
        });
    });
}

async function renderStepBooks(body, po) {
    const logistics = canManageProcurement();
    let books = [];
    let capacity = null;
    try {
        const data = await api(`/api/purchase-books?poId=${encodeURIComponent(po.id)}&limit=100`);
        books = data.purchaseBooks || [];
        try {
            capacity = await api(`/api/purchase-books/po-capacity/${encodeURIComponent(po.id)}`);
        } catch (_err) { /* optional */ }
    } catch (err) {
        setStepChrome(po, '', []);
        body.innerHTML = `<p class="lc-muted">${escapeHtml(err.message)}</p>`;
        return;
    }

    const posted = books.filter((b) => String(b.status).toUpperCase() === 'POSTED').length;
    const draft = books.filter((b) => String(b.status).toUpperCase() === 'DRAFT').length;
    const bookedTotal = Array.isArray(capacity?.lines)
        ? capacity.lines.reduce((s, l) => s + Number(l.bookedQty || 0), 0)
        : '—';
    const orderedTotal = Array.isArray(capacity?.lines)
        ? capacity.lines.reduce((s, l) => s + Number(l.orderedQty || 0), 0)
        : '—';

    setStepChrome(po, `
        <span class="po-header-actions">
            ${logistics ? '<button type="button" class="action-button green" id="btnCarCreateBook">Create Purchase Book</button>' : ''}
            <button type="button" class="action-button grey" id="btnCarViewBooks">Open Books</button>
        </span>`, [
        { k: 'Purchase Books', v: books.length, muted: `Posted ${posted} · Draft ${draft}` },
        { k: 'Booked / ordered', v: `${bookedTotal} / ${orderedTotal}`, muted: 'Across PO lines' },
        { k: 'Receiving', v: receivingProgress(po), muted: 'Physical (RN)' }
    ]);

    body.innerHTML = `
        <p class="lc-muted">Purchase Book = vendor Tax Invoice commercial book (≤ ordered). Independent of Receipt Note physical qty.</p>
        ${books.length
            ? `<div class="po-carousel-table-wrap"><table class="data-table po-carousel-table">
                <thead><tr><th>Invoice</th><th>Status</th><th>Kind</th><th>Date</th><th>Book</th></tr></thead>
                <tbody>
                    ${books.map((b) => `
                        <tr class="po-car-book-row" data-book-id="${escapeHtml(b.id)}" style="cursor:pointer;">
                            <td>
                                <div class="po-book-invoice">${dash(b.vendorInvoiceNo)}</div>
                                <div class="po-mono">${escapeHtml(b.id)}</div>
                            </td>
                            <td>${statusChip(b.status)}</td>
                            <td>${escapeHtml(b.documentKind || 'INVOICE')}</td>
                            <td>${formatIstDate(b.invoiceDate)}</td>
                            <td class="po-mono">${escapeHtml(b.id)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table></div>`
            : '<p class="lc-muted">No Purchase Books yet. Create one to book a vendor invoice against this PO.</p>'}
    `;

    el('btnCarCreateBook')?.addEventListener('click', () => {
        closeCarousel();
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('purchase-books-view', { createFromPo: po.id });
        }
    });
    el('btnCarViewBooks')?.addEventListener('click', () => {
        closeCarousel();
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('purchase-books-view', { poId: po.id });
        }
    });
    body.querySelectorAll('.po-car-book-row').forEach((row) => {
        row.addEventListener('click', () => {
            const id = row.getAttribute('data-book-id');
            closeCarousel();
            if (typeof window.lifecycleGo === 'function') {
                window.lifecycleGo('purchase-books-view', { open: id });
            }
        });
    });
}

function parseDcPayload(dc) {
    const raw = dc.PayloadJSON || dc.payloadjson || dc.payload || null;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (_e) { return null; }
}

function dcLinkedToPo(dc, po, bookIds) {
    const payload = parseDcPayload(dc);
    const poNumber = String(po.poNumber || '').trim();
    const poId = String(po.id || '').trim();
    if (payload) {
        const consumptions = payload.meta?.purchaseBookConsumptions || [];
        if (consumptions.some((c) => bookIds.has(String(c.purchaseBookId || c.purchase_book_id || '')))) return true;
        const buyer = String(payload.meta?.buyerOrderNo || payload.meta?.referenceNo || payload.buyer?.orderNo || '').trim();
        if (poNumber && buyer && (buyer === poNumber || buyer.includes(poNumber))) return true;
        if (payload.meta?.procurementPoId && String(payload.meta.procurementPoId) === poId) return true;
    }
    const ref = dc.POReference || dc.poreference;
    if (ref && typeof ref === 'object') {
        if (ref.ProcurementPoId && String(ref.ProcurementPoId) === poId) return true;
        if (ref.PONumber && poNumber && String(ref.PONumber) === poNumber) return true;
    }
    return false;
}

async function renderStepDc(body, po) {
    const logistics = canManageProcurement();
    let dcBooks = [];
    let books = [];
    let dcs = [];
    try {
        const [dcBookData, bookData, dcList] = await Promise.all([
            api(`/api/purchase-books/po-dc-books/${encodeURIComponent(po.id)}`).catch(() => ({ purchaseBooks: [] })),
            api(`/api/purchase-books?poId=${encodeURIComponent(po.id)}&limit=100`).catch(() => ({ purchaseBooks: [] })),
            api('/api/dc').catch(() => [])
        ]);
        dcBooks = dcBookData.purchaseBooks || [];
        books = bookData.purchaseBooks || [];
        const allDcs = Array.isArray(dcList) ? dcList : (dcList.deliveryChallans || dcList.dcs || []);
        const bookIds = new Set(books.map((b) => String(b.id)));
        dcs = allDcs.filter((dc) => dcLinkedToPo(dc, po, bookIds));
    } catch (err) {
        setStepChrome(po, '', []);
        body.innerHTML = `<p class="lc-muted">${escapeHtml(err.message)}</p>`;
        return;
    }

    const remainingDcQty = dcBooks.reduce((s, b) => s + Number(b.remainingDcQty || 0), 0);
    const postedBooks = books.filter((b) => String(b.status).toUpperCase() === 'POSTED');
    const a2Ready = remainingDcQty > 0 && postedBooks.length > 0;

    setStepChrome(po, `
        <span class="po-header-actions">
            ${logistics ? `<button type="button" class="action-button green" id="btnCarDcA2" ${a2Ready ? '' : 'disabled'} title="${a2Ready ? 'Create DC from Purchase Books' : 'Needs posted books with remaining DC-able qty'}">DC from Books</button>` : ''}
            ${logistics ? '<button type="button" class="action-button blue" id="btnCarDcA1">DC from PO</button>' : ''}
            <button type="button" class="action-button grey" id="btnCarOpenDc">Open DC</button>
        </span>`, [
        { k: 'DCs on this PO', v: dcs.length, muted: 'Linked / book-consuming' },
        { k: 'DC-able qty', v: remainingDcQty, muted: 'Booked − consumed' },
        { k: 'Posted books', v: postedBooks.length, muted: 'A2 pool' }
    ]);

    body.innerHTML = `
        ${!postedBooks.length
            ? '<div class="po-map-banner">No posted Purchase Books yet. Mode A2 is blocked until you post a book. You can still create a PO-linked DC without a book (A1).</div>'
            : (remainingDcQty <= 0
                ? '<div class="po-zoho-banner">Posted books exist but remaining DC-able qty is 0 (fully consumed). Void a DC to release book qty, or use A1 for PO-only lines.</div>'
                : '')}
        <p class="lc-muted">This step is PO-scoped. Mode B (free holdings, no PO) stays in the DC module — not here.</p>
        <h3 class="po-carousel-section-title">Delivery Challans</h3>
        ${dcs.length
            ? `<div class="po-carousel-table-wrap"><table class="data-table po-carousel-table">
                <thead><tr><th>Challan</th><th>Customer</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                    ${dcs.slice(0, 40).map((dc) => {
                        const id = dc.ID || dc.id;
                        const no = dc.ChallanNo || dc.challanno || id;
                        const cust = dc.CustomerName || dc.customername || '—';
                        const date = dc.DeliveryDate || dc.deliverydate || dc.Timestamp || dc.timestamp;
                        const st = dc.Status || dc.status || '—';
                        return `<tr class="po-car-dc-row" data-dc-id="${escapeHtml(id)}" style="cursor:pointer;">
                            <td class="po-mono">${escapeHtml(no)}</td>
                            <td>${escapeHtml(cust)}</td>
                            <td>${formatIstDate(date)}</td>
                            <td>${statusChip(st)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>`
            : '<p class="lc-muted">No Delivery Challans linked to this PO / its books yet.</p>'}
        ${dcBooks.length
            ? `<h3 class="po-carousel-section-title">Books available for DC (A2)</h3>
                <ul class="lc-event-list">${dcBooks.map((b) => `
                    <li><strong>${escapeHtml(b.vendorInvoiceNo || b.id)}</strong>
                    · remaining ${escapeHtml(String(b.remainingDcQty ?? 0))}
                    <span class="po-mono">${escapeHtml(b.id)}</span></li>
                `).join('')}</ul>`
            : ''}
    `;

    const goDc = (mode) => {
        closeCarousel();
        window.__poCarouselDcIntent = {
            poId: po.id,
            poNumber: poLabel(po),
            mode, // A2 | A1
            source: po.source || 'ZOHO'
        };
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('dc-view');
        } else if (typeof window.switchDashboardSubView === 'function') {
            window.switchDashboardSubView('dc-view');
        }
        setTimeout(() => {
            const intent = window.__poCarouselDcIntent;
            if (!intent) return;
            window.__poCarouselDcIntent = null;
            const radio = document.querySelector('input.dc-link-mode[value="PO_LINKED"]');
            if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (typeof window.linkDcToProcurementPo === 'function') {
                window.linkDcToProcurementPo({
                    id: intent.poId,
                    poNumber: intent.poNumber,
                    source: intent.source || 'ZOHO'
                }, { preferBooks: intent.mode === 'A2' });
            } else {
                showToast(`Open DC and link PO ${intent.poNumber}`, 'info');
            }
        }, 250);
    };

    el('btnCarDcA2')?.addEventListener('click', () => goDc('A2'));
    el('btnCarDcA1')?.addEventListener('click', () => goDc('A1'));
    el('btnCarOpenDc')?.addEventListener('click', () => {
        closeCarousel();
        if (typeof window.lifecycleGo === 'function') window.lifecycleGo('dc-view');
    });
    body.querySelectorAll('.po-car-dc-row').forEach((row) => {
        row.addEventListener('click', () => {
            const id = row.getAttribute('data-dc-id');
            closeCarousel();
            if (typeof window.lifecycleGo === 'function') {
                window.lifecycleGo('dc-view', { open: id });
            }
        });
    });
}

async function renderPoList() {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    const q = el('poSearch')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', '200');
    const data = await api(`/api/procurement/pos?${params.toString()}`);
    let rows = data.purchaseOrders || [];
    if (waitlistOnly) {
        rows = rows.filter(isWaitlistPo);
    }
    if (el('poCountBadge')) {
        el('poCountBadge').textContent = waitlistOnly
            ? `${rows.length} waiting for a Receipt Note`
            : `${rows.length} Purchase Orders`;
    }
    if (!rows.length) {
        host.innerHTML = emptyState({
            title: waitlistOnly ? 'No Purchase Orders waiting for a Receipt Note.' : 'No Purchase Orders imported.',
            body: waitlistOnly
                ? 'Waitlist means receivable Zoho PO lines with outstanding quantity. It is not the full Purchase Order list.'
                : 'Purchase Orders are created and managed in Zoho. Import a Purchase Order from Zoho to receive against it here.',
            actionLabel: canManageProcurement() && !waitlistOnly ? 'Import from Zoho' : '',
            actionView: 'purchase-orders-view',
            actionAttr: 'id="btnEmptyImportPo"'
        });
        host.querySelector('#btnEmptyImportPo')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderImportForm().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        ${waitlistOnly ? '<p class="lc-muted">Showing Purchase Orders waiting to become Receipt Notes (receivable lines with outstanding quantity).</p>' : ''}
        <div class="po-card-grid">
            ${rows.map((po) => {
                const items = lineItemCount(po);
                const legacy = po.source === 'LOCAL';
                return `
                <button type="button" class="po-op-card ${selectedId === po.id ? 'selected' : ''} ${legacy ? 'po-op-card-legacy' : ''}"
                    data-po-id="${escapeHtml(po.id)}" data-po-source="${escapeHtml(po.source || '')}">
                    ${legacy ? '<span class="po-op-legacy-chip">LEGACY</span>' : ''}
                    <div class="po-op-number">${escapeHtml(poLabel(po))}</div>
                    <div class="po-op-meta">${escapeHtml(poStoredName(po) || 'No stored name')}</div>
                    ${legacy ? '' : `<div class="po-op-meta">${escapeHtml(poAccountLine(po))}</div>`}
                    <div class="po-op-meta">${items} item${items === 1 ? '' : 's'}</div>
                    <div class="po-op-meta">Receiving ${escapeHtml(receivingProgress(po))}</div>
                    <div class="po-op-dates">
                        <span>Order ${escapeHtml(formatIstDate(po.poDate))}</span>
                        <span>Expected ${escapeHtml(formatIstDate(po.dueDate))}</span>
                    </div>
                </button>`;
            }).join('')}
        </div>`;
    host.querySelectorAll('.po-op-card').forEach((card) => {
        card.addEventListener('click', () => {
            const id = card.getAttribute('data-po-id');
            const source = card.getAttribute('data-po-source');
            openCarousel(id, source, card).catch((err) => toastOperatorError(err));
        });
    });
}

async function renderLegacyDetail(id) {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    const order = await api(`/api/orders/${encodeURIComponent(id)}`);
    const po = order.orders?.[0] || order.data?.[0] || order;
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoBack">← Purchase Orders</button>
            <h3 style="margin:0;">${escapeHtml(po.PONumber || po.ponumber || id)}</h3>
        </div>
        <div class="po-legacy-banner">LEGACY local Purchase Order. This document was not imported from Zoho. Commercial editing is closed. Historical Receipt Notes remain linked.</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0;">
            <div><div class="po-label">Local ID</div><div class="po-mono">${escapeHtml(po.ID || po.id || id)}</div></div>
            <div><div class="po-label">Status</div><div>${statusChip(po.Status || po.status)}</div></div>
            <div><div class="po-label">Classification</div><div>LEGACY</div></div>
        </div>
        <div class="view-actions" style="display:flex;gap:8px;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoViewReceipts">View Receipts</button>
        </div>`;
    el('btnPoBack')?.addEventListener('click', () => renderPoList().catch((err) => showToast(err.message, 'error')));
    el('btnPoViewReceipts')?.addEventListener('click', () => {
        if (typeof window.lifecycleGo === 'function') {
            window.lifecycleGo('receipts-view');
        } else if (typeof window.initReceiptsView === 'function') {
            window.initReceiptsView();
        }
    });
}

async function renderImportForm() {
    const host = el('purchaseOrdersContent');
    if (!host) return;
    if (!canManageProcurement()) {
        showToast('Sales cannot import Purchase Orders', 'error');
        return;
    }
    host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <button type="button" class="action-button grey" id="btnPoBack">← Purchase Orders</button>
            <h3 style="margin:0;">Import from Zoho</h3>
        </div>
        <div class="po-zoho-banner">Purchase Orders are created and managed in Zoho. Enter the OPO ID (Outbound PO Identifier) to preview, then import a read-only mirror. This does not create a Receipt Note or physical stock.</div>
        <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;">
            <label style="font-size:12px;font-weight:700;">OPO ID</label>
            <div style="display:flex;gap:8px;margin-top:6px;">
                <input id="zohoPoIdInput" placeholder="Outbound PO Identifier" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;">
                <button type="button" class="action-button grey" id="btnPoPreview">Preview</button>
            </div>
        </div>
        <div id="poPreviewHost" style="margin-top:12px;"></div>`;
    el('btnPoBack')?.addEventListener('click', () => renderPoList().catch((err) => showToast(err.message, 'error')));
    el('btnPoPreview')?.addEventListener('click', previewZohoPo);
}

async function previewZohoPo() {
    const zohoPoId = el('zohoPoIdInput')?.value?.trim();
    const host = el('poPreviewHost');
    if (!zohoPoId || !host) {
        showToast('Enter an OPO ID', 'error');
        return;
    }
    try {
        const data = await api(`/api/purchase-orders/preview-zoho?opoId=${encodeURIComponent(zohoPoId)}`);
        const po = data.purchaseOrder;
        const mapping = data.mappingRequired;
        host.innerHTML = `
            ${mapping ? '<div class="po-map-banner"><strong>PRODUCT MAPPING REQUIRED</strong><br>Link each Zoho Product to an AssetEngine Product before receiving. Import still stores the commercial snapshot.</div>' : ''}
            ${data.alreadyImported ? `<div class="po-zoho-banner">Already imported as ${escapeHtml(data.existingId)}. Import will refresh the same local PO.</div>` : ''}
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fff;">
                <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(poLabel(po))}</div>
                <div style="font-size:13px;margin-bottom:10px;">${escapeHtml(poStoredName(po) || 'No stored name')} · ${escapeHtml(poAccountLine(po))} · Status ${statusChip(po.status)} · Zoho ${dash(po.zohoPoId)}</div>
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="text-align:left;color:#667085;border-bottom:1px solid #e5e7eb;">
                            <th style="padding:8px;">Product</th>
                            <th style="padding:8px;">Description</th>
                            <th style="padding:8px;">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(po.lines || []).map((line) => `
                            <tr style="border-bottom:1px solid #f3f4f6;">
                                <td style="padding:8px;">
                                    ${line.mappingRequired ? '<span style="color:#991b1b;font-weight:700;">PRODUCT MAPPING REQUIRED</span>' : dash(line.productId)}
                                    ${line.productName || line.zohoProductName ? `<div class="po-product-name">${escapeHtml(line.productName || line.zohoProductName)}</div>` : ''}
                                </td>
                                <td style="padding:8px;">${dash(line.description)}</td>
                                <td style="padding:8px;">${escapeHtml(line.orderedQty)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top:12px;">
                    <button type="button" class="action-button green" id="btnPoImportConfirm">Import from Zoho</button>
                </div>
            </div>`;
        el('btnPoImportConfirm')?.addEventListener('click', async () => {
            try {
                const result = await api('/api/purchase-orders/import-zoho', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ opoId: zohoPoId })
                });
                showToast(`Imported ${poLabel(result.po || {})}`, 'success');
                selectedId = result.po?.id;
                await renderPoList();
                if (result.po?.id) {
                    await openCarousel(result.po.id, 'ZOHO', null);
                }
            } catch (err) {
                showToast(err.reasonCode ? `${err.reasonCode}: ${err.message}` : err.message, 'error');
            }
        });
    } catch (err) {
        host.innerHTML = `<div class="po-recon-banner">${escapeHtml(err.reasonCode ? `${err.reasonCode}: ${err.message}` : err.message)}</div>`;
    }
}

export function initPurchaseOrdersView() {
    if (el('btnImportZohoPo')) {
        el('btnImportZohoPo').style.display = canManageProcurement() ? '' : 'none';
    }
    if (el('btnSyncZohoAccounts')) {
        el('btnSyncZohoAccounts').style.display = hasPermission('zoho.sync') ? '' : 'none';
    }
    if (el('btnSyncDealProjects')) {
        el('btnSyncDealProjects').style.display = hasPermission('zoho.sync') ? '' : 'none';
    }
    if (!viewListenersBound) {
        viewListenersBound = true;
        el('btnReloadPos')?.addEventListener('click', () => renderPoList().catch((e) => showToast(e.message, 'error')));
        el('poSearch')?.addEventListener('input', () => renderPoList().catch((e) => showToast(e.message, 'error')));
        el('btnImportZohoPo')?.addEventListener('click', () => renderImportForm().catch((e) => showToast(e.message, 'error')));
        el('btnSyncZohoAccounts')?.addEventListener('click', async () => {
            const btn = el('btnSyncZohoAccounts');
            if (btn) btn.disabled = true;
            try {
                const data = await api('/api/zoho/sync-accounts', { method: 'POST' });
                showToast(data.message || `Synced ${data.upserted || 0} Zoho accounts`, 'success');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
        el('btnSyncDealProjects')?.addEventListener('click', async () => {
            const btn = el('btnSyncDealProjects');
            if (btn) btn.disabled = true;
            try {
                const data = await api('/api/zoho/sync-deal-projects', { method: 'POST' });
                showToast(data.message || `Synced ${data.upserted || 0} Deal Projects`, 'success');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }
    const pending = consumeOpen('purchase-orders-view');
    waitlistOnly = String(pending?.extra?.waitlist || '') === '1' || pending?.extra?.waitlist === true;
    renderPoList().then(() => {
        if (pending && pending.open) {
            selectedId = pending.open;
            const src = String(pending.extra?.source || pending.extra?.poSource || 'ZOHO').toUpperCase();
            return openCarousel(pending.open, src, null);
        }
    }).catch((err) => toastOperatorError(err));
}

window.initPurchaseOrdersView = initPurchaseOrdersView;
window.openPurchaseOrderImport = () => {
    renderImportForm().catch((err) => showToast(err.message, 'error'));
};
window.openPurchaseOrderDetail = (id, source) => {
    selectedId = id;
    const src = String(source || 'ZOHO').toUpperCase();
    openCarousel(id, src, null).catch((err) => showToast(err.message, 'error'));
};
window.closePoCarousel = closeCarousel;
