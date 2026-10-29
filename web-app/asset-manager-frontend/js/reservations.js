/**
 * Reservation workspace — first-class Reserve board.
 * Uses reservationService via existing APIs. No duplicated quantity math.
 */
import { showToast } from './utils.js?v=6.60';
import {
    lifecycleApi,
    escapeHtml,
    dash,
    formatQty,
    formatWhen,
    statusChip,
    emptyState,
    crumb,
    go,
    consumeOpen,
    toastOperatorError,
    canLogistics,
    holdingKindLabel
} from './lifecycle.js?v=7.28';

function el(id) {
    return document.getElementById(id);
}

function ownerLabel(row) {
    const type = String(row.ownerType || '').toUpperCase();
    const id = row.ownerId || '';
    if (type === 'SET') return `Set ${id}`;
    if (type === 'MANUAL') return id ? `Manual · ${id}` : 'Manual';
    if (type === 'PROJECT') return `Project ${id}`;
    if (type === 'DC') return `DC ${id}`;
    return `${type || '—'} ${id}`.trim();
}

function remainingQty(row) {
    if (String(row.status || '').toUpperCase() !== 'ACTIVE') return '0';
    return formatQty(row.quantity);
}

function reservedForSetLabel(row) {
    if (String(row.ownerType || '').toUpperCase() !== 'SET' && !row.reservedForSet) return '—';
    const name = row.reservedForSetName;
    const code = row.reservedForSetCode;
    if (name && code) return `${name} (${code})`;
    if (name) return name;
    return row.reservedForSet || row.ownerId || '—';
}

async function renderBoard() {
    const host = el('reservationsContent');
    if (!host) return;
    const status = el('reservationStatusFilter')?.value || 'ACTIVE';
    const q = String(el('reservationSearch')?.value || '').trim();
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    params.set('limit', '200');
    const data = await lifecycleApi(`/api/reservations?${params.toString()}`);
    const rows = data.reservations || [];
    if (el('reservationCountBadge')) {
        el('reservationCountBadge').textContent = `${rows.length} Reservations`;
    }
    if (!rows.length) {
        host.innerHTML = emptyState({
            title: q
                ? 'No reservations match this search.'
                : (status === 'ACTIVE' || !status ? 'No active reservations.' : 'No reservations in this filter.'),
            body: q
                ? 'Try a reservation ID, asset/inventory resource ID, or Set ID/name.'
                : 'Reserve from an Asset or Inventory record when stock needs to be held for a Set or operator.',
            actionLabel: q ? '' : 'Open Stock — Assets',
            actionView: q ? '' : 'home-view'
        });
        return;
    }
    host.innerHTML = `
        <div style="overflow:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                        <th style="padding:8px;">Reservation</th>
                        <th style="padding:8px;">Resource</th>
                        <th style="padding:8px;">Quantity</th>
                        <th style="padding:8px;">Owner</th>
                        <th style="padding:8px;">Reserved for Set</th>
                        <th style="padding:8px;">Status</th>
                        <th style="padding:8px;">Created</th>
                        <th style="padding:8px;">Remaining</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r) => `
                        <tr class="lc-row" data-rsv-open="${escapeHtml(r.id)}" style="cursor:pointer;border-bottom:1px solid #f3f4f6;">
                            <td style="padding:8px;" class="lc-mono">${escapeHtml(r.id)}</td>
                            <td style="padding:8px;">
                                <div>${escapeHtml(holdingKindLabel(r.resourceType))}</div>
                                <div class="lc-mono">${escapeHtml(r.resourceId)}</div>
                            </td>
                            <td style="padding:8px;">${formatQty(r.quantityOriginal != null ? r.quantityOriginal : r.quantity)}</td>
                            <td style="padding:8px;">${escapeHtml(ownerLabel(r))}</td>
                            <td style="padding:8px;">${escapeHtml(reservedForSetLabel(r))}</td>
                            <td style="padding:8px;">${statusChip(r.status)}</td>
                            <td style="padding:8px;">${formatWhen(r.createdAt)}</td>
                            <td style="padding:8px;">${remainingQty(r)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    host.querySelectorAll('[data-rsv-open]').forEach((row) => {
        row.addEventListener('click', () => openReservationDetail(row.getAttribute('data-rsv-open')));
    });
}

async function openReservationDetail(id) {
    const host = el('reservationsContent');
    if (!host) return;
    const data = await lifecycleApi(`/api/reservations/${encodeURIComponent(id)}`);
    const r = data.reservation || data;
    const events = data.events || r.events || [];
    const resourceView = String(r.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
    const setView = String(r.ownerType).toUpperCase() === 'SET' ? 'sets-view' : '';
    const isActive = String(r.status).toUpperCase() === 'ACTIVE';
    const canRelease = canLogistics() && isActive;
    const original = Number(r.quantityOriginal);
    const remaining = isActive ? Number(r.quantity) : 0;
    const pct = original > 0 ? Math.max(0, Math.min(100, Math.round((remaining / original) * 100))) : 0;
    const eventLabel = (ev) => String(ev.type || ev.action || 'Event').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    host.innerHTML = `
        <div class="rsv-detail">
            <div class="rsv-topline">
                <button type="button" class="rsv-back" id="btnRsvBack">← All reservations</button>
                ${crumb([
                    { label: 'Stock', view: resourceView, open: r.resourceId },
                    { label: 'Reservation' },
                    setView ? { label: 'Set', view: 'sets-view', open: r.ownerId } : null,
                    { label: 'History', view: 'history-view', open: r.id }
                ])}
            </div>

            <section class="rsv-hero">
                <div class="rsv-hero-main">
                    <div class="rsv-eyebrow">Reservation ${statusChip(r.status)}</div>
                    <h3 class="rsv-title">Held for ${escapeHtml(ownerLabel(r))}</h3>
                    <div class="rsv-id">
                        <span class="lc-mono">${escapeHtml(r.id)}</span>
                        <button type="button" class="rn-info-tip rn-info-tip--portal" aria-label="About reservation IDs" data-tip="Reservation IDs are for audit. Operators work from the stock record and owner."><span aria-hidden="true">i</span></button>
                    </div>
                </div>
                <div class="rsv-hero-actions">
                    ${setView ? `<button type="button" class="action-button grey" data-lc-go="sets-view" data-lc-open="${escapeHtml(r.ownerId)}">Open Set</button>` : ''}
                    ${canRelease ? '<button type="button" class="action-button red" id="btnRsvRelease">Release</button>' : ''}
                </div>
            </section>

            <div class="rsv-stats">
                <div class="rsv-stat rsv-stat--primary">
                    <div class="rsv-stat-label">Quantity remaining</div>
                    <div class="rsv-stat-value">${formatQty(remaining)}</div>
                    <div class="rsv-meter" aria-hidden="true"><span style="width:${pct}%;"></span></div>
                </div>
                <div class="rsv-stat">
                    <div class="rsv-stat-label">Originally reserved</div>
                    <div class="rsv-stat-value">${formatQty(r.quantityOriginal)}</div>
                </div>
                <div class="rsv-stat">
                    <div class="rsv-stat-label">Created</div>
                    <div class="rsv-stat-value rsv-stat-value--sm">${formatWhen(r.createdAt)}</div>
                    <div class="rsv-stat-sub">by ${dash(r.createdBy)}</div>
                </div>
            </div>

            <div class="rsv-grid">
                <section class="rsv-card">
                    <div class="rsv-card-label">Resource</div>
                    <div class="rsv-card-sub">${escapeHtml(holdingKindLabel(r.resourceType))}</div>
                    <button type="button" class="rsv-pill-link" data-lc-go="${resourceView}" data-lc-open="${escapeHtml(r.resourceId)}">${escapeHtml(r.resourceId)} →</button>
                </section>
                <section class="rsv-card">
                    <div class="rsv-card-label">Owner</div>
                    <div class="rsv-card-main">${escapeHtml(ownerLabel(r))}</div>
                    ${r.reason ? `<div class="rsv-card-sub">Reason: ${escapeHtml(r.reason)}</div>` : ''}
                </section>
            </div>

            <section class="rsv-card">
                <div class="rsv-card-label">History</div>
                ${events.length ? `<ol class="rsv-timeline">${events.map((ev) => `
                    <li>
                        <span class="rsv-dot" aria-hidden="true"></span>
                        <div class="rsv-tl-title">${escapeHtml(eventLabel(ev))}${ev.quantity != null ? ` <span class="rsv-tl-qty">qty ${formatQty(ev.quantity)}</span>` : ''}</div>
                        <div class="rsv-tl-meta">${formatWhen(ev.createdAt || ev.timestamp)} · ${dash(ev.actor || ev.createdBy)}</div>
                    </li>
                `).join('')}</ol>` : '<p class="lc-muted" style="margin:0;">No events.</p>'}
            </section>
        </div>
    `;
    el('btnRsvBack')?.addEventListener('click', () => renderBoard().catch((err) => toastOperatorError(err)));
    el('btnRsvRelease')?.addEventListener('click', async () => {
        if (!confirm('Release this reservation? The stock becomes available again. This does not delete the Asset or Inventory record.')) return;
        try {
            await lifecycleApi(`/api/reservations/${encodeURIComponent(id)}/release`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            showToast('Reservation released', 'success');
            await openReservationDetail(id);
        } catch (err) {
            toastOperatorError(err);
        }
    });
}

function ensureReserveModal() {
    let modal = document.getElementById('reserveStockModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'reserveStockModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'reserveStockTitle');
    modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;width:92%;">
            <span class="close-modal" id="closeReserveStockModal" aria-label="Close">&times;</span>
            <div id="reserveStockBody"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#closeReserveStockModal').onclick = () => { modal.style.display = 'none'; };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') modal.style.display = 'none';
    });
    return modal;
}

export async function openReserveDialog({
    resourceType,
    resourceId,
    productId,
    productName,
    available,
    wholeRecord
} = {}) {
    if (!canLogistics()) {
        showToast('Logistics role required to reserve stock.', 'error');
        return;
    }
    const modal = ensureReserveModal();
    const body = document.getElementById('reserveStockBody');
    const isAsset = String(resourceType).toUpperCase() === 'ASSET';
    const avail = Number(available);
    body.innerHTML = `
        <h3 id="reserveStockTitle" style="margin:0 0 12px;">Reserve stock</h3>
        <p class="lc-muted">This holds quantity so it cannot be converted or received against until released or allocated.</p>
        <div class="lc-kv" style="margin:12px 0;">
            <div><div class="lc-k">Product</div><div>${dash(productName || productId)}</div></div>
            <div><div class="lc-k">Record</div><div class="lc-mono">${escapeHtml(resourceId)}</div></div>
            <div><div class="lc-k">Kind</div><div>${escapeHtml(holdingKindLabel(resourceType))}</div></div>
            <div><div class="lc-k">Available</div><div>${isAsset || wholeRecord ? 'Whole record' : formatQty(available)}</div></div>
        </div>
        ${isAsset || wholeRecord ? '<input type="hidden" id="rsvQty" value="1">' : `
            <label for="rsvQty">Requested quantity</label>
            <input type="number" id="rsvQty" min="0" step="any" value="" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
            <p class="lc-muted">Must be less than or equal to available (${formatQty(available)}).</p>
        `}
        <label for="rsvOwner">Owner (who this hold is for)</label>
        <input type="text" id="rsvOwner" value="${escapeHtml(window.currentUser?.username || 'operator')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        <label for="rsvReason" style="margin-top:8px;display:block;">Reason (optional)</label>
        <input type="text" id="rsvReason" placeholder="e.g. hold for kit" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button type="button" class="action-button grey" id="rsvCancel" style="flex:1;">Cancel</button>
            <button type="button" class="action-button blue" id="rsvConfirm" style="flex:1;">Reserve</button>
        </div>
    `;
    modal.style.display = 'flex';
    document.getElementById('rsvCancel').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('rsvConfirm').onclick = async () => {
        const qty = isAsset || wholeRecord ? undefined : Number(document.getElementById('rsvQty').value);
        if (!isAsset && !wholeRecord) {
            if (!(qty > 0)) {
                showToast('Enter a requested quantity greater than zero.', 'error');
                return;
            }
            if (Number.isFinite(avail) && qty > avail) {
                showToast('Requested quantity is more than what is available.', 'error');
                return;
            }
        }
        const ownerId = String(document.getElementById('rsvOwner').value || '').trim() || (window.currentUser?.username || 'operator');
        const reason = String(document.getElementById('rsvReason').value || '').trim();
        const btn = document.getElementById('rsvConfirm');
        btn.disabled = true;
        try {
            const payload = {
                resourceType: String(resourceType).toUpperCase(),
                resourceId,
                ownerType: 'MANUAL',
                ownerId,
                reason: reason || undefined,
                idempotencyKey: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `rsv-${Date.now()}`
            };
            if (!isAsset && !wholeRecord) payload.quantity = qty;
            const result = await lifecycleApi('/api/reservations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            modal.style.display = 'none';
            showToast('Stock reserved', 'success');
            const rid = result.reservation?.id || result.id;
            if (rid) go('reservations-view', { open: rid });
        } catch (err) {
            btn.disabled = false;
            toastOperatorError(err);
        }
    };
}

export function setupReserveUI({ resourceType, resourceId, productId, productName, available, wholeRecord, hostId } = {}) {
    const host = hostId ? document.getElementById(hostId) : null;
    if (!host) return;
    const mutate = canLogistics();
    host.style.display = 'block';
    host.innerHTML = `
        <h4 style="margin:0 0 8px;">Reserve</h4>
        <p class="lc-muted" style="margin:0 0 8px;">Hold this stock without converting or breaking it.</p>
        ${mutate
            ? '<button type="button" class="action-button blue" id="btnOpenReserve">Reserve</button>'
            : '<p class="lc-muted">View only. Logistics reserves stock.</p>'}
    `;
    document.getElementById('btnOpenReserve')?.addEventListener('click', () => {
        openReserveDialog({ resourceType, resourceId, productId, productName, available, wholeRecord });
    });
}

let bound = false;
export function initReservationsView() {
    if (!bound) {
        bound = true;
        el('btnReloadReservations')?.addEventListener('click', () => renderBoard().catch((e) => toastOperatorError(e)));
        el('reservationStatusFilter')?.addEventListener('change', () => renderBoard().catch((e) => toastOperatorError(e)));
        el('reservationSearch')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') renderBoard().catch((err) => toastOperatorError(err));
        });
    }
    const pending = consumeOpen('reservations-view');
    if (pending && pending.open) {
        openReservationDetail(pending.open).catch((err) => toastOperatorError(err));
        return;
    }
    renderBoard().catch((err) => toastOperatorError(err));
}

window.initReservationsView = initReservationsView;
window.openReservationDetail = openReservationDetail;
window.openReserveDialog = openReserveDialog;
window.setupReserveUI = setupReserveUI;
