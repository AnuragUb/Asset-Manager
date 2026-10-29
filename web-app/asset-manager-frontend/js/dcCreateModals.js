// DC creation: the Challan Details form and the Asset / Inventory Selection live in two
// pop-ups; the page shows a summary card for each. Summaries are read from the form
// fields and the items table, so dashboard.js keeps owning all DC state.

const MODALS = { details: 'dcDetailsModal', items: 'dcItemsModal' };
const DEFAULT_FOCUS = { details: 'dcCustomerName', items: 'dcAssetSearch' };
let initialized = false;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const fieldValue = (id) => String(document.getElementById(id)?.value || '').trim();

function selectedOptionText(id) {
    const select = document.getElementById(id);
    if (!select || !select.value) return '';
    return String(select.options[select.selectedIndex]?.text || select.value).trim();
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function summaryRow(label, value, placeholder = '—') {
    const shown = value ? esc(value) : `<span class="dc-sum-empty">${esc(placeholder)}</span>`;
    return `<div class="dc-sum-row"><span class="dc-sum-label">${esc(label)}</span><span class="dc-sum-value">${shown}</span></div>`;
}

function renderDetailsSummary() {
    const host = document.getElementById('dcDetailsSummary');
    if (!host) return;

    const customer = fieldValue('dcCustomerName');
    const reason = selectedOptionText('dcDispatchReason');
    const destinationWrap = document.getElementById('dcTransferDestinationWrap');
    const destination = destinationWrap && destinationWrap.style.display !== 'none' ? fieldValue('dcTransferDestination') : '';
    const references = [fieldValue('dcRefNo'), fieldValue('dcBuyerOrderNo')].filter(Boolean).join(' · ');

    const missing = [];
    if (!customer) missing.push('Customer');
    if (!reason) missing.push('Dispatch reason');

    host.innerHTML = `
        ${summaryRow('Customer', customer + (customer && fieldValue('dcZohoAccountId') ? ' (Zoho account)' : ''), 'Not set')}
        ${summaryRow('Consignee', fieldValue('dcConsigneeName'))}
        ${summaryRow('Buyer', fieldValue('dcBuyerName'))}
        ${summaryRow('Delivery date', formatDate(fieldValue('dcDate')))}
        ${summaryRow('Dispatch reason', reason + (destination ? ` → ${destination}` : ''), 'Not selected')}
        ${summaryRow('References', references)}
        ${summaryRow('Company', fieldValue('dcCompanyName'))}
        ${missing.length ? `<div class="dc-sum-warn">Still needed: ${esc(missing.join(', '))}</div>` : ''}`;
}

function renderItemsSummary() {
    const host = document.getElementById('dcItemsSummary');
    const body = document.getElementById('dcSelectedAssetsBody');
    if (!host || !body) return;

    const names = Array.from(body.querySelectorAll('input[data-dc-field="description"]'))
        .map((input) => String(input.value || '').trim() || 'Untitled line');
    const kits = body.querySelectorAll('button[onclick^="removeSetGroupFromDC"]').length;
    const total = Array.from(body.querySelectorAll('span[data-dc-field="amount"]'))
        .map((span) => Number(String(span.textContent || '').replace(/,/g, '')))
        .filter((n) => Number.isFinite(n))
        .reduce((sum, n) => sum + n, 0);

    const mode = document.querySelector('input.dc-link-mode:checked')?.value || 'PO_LINKED';
    const poLinked = document.getElementById('dcPoLinked');
    const poLabel = poLinked && poLinked.style.display !== 'none'
        ? String(document.getElementById('dcPoLinkedLabel')?.textContent || '').trim()
        : '';
    const source = mode === 'HOLDINGS' ? 'No PO — in-store holdings' : (poLabel ? `PO ${poLabel}` : 'Link to PO (no PO fetched)');

    if (!names.length) {
        host.innerHTML = `
            ${summaryRow('Line source', source)}
            <div class="dc-sum-empty-block">No items yet. Use <strong>Select items</strong> to add assets, inventory or a Set.</div>`;
        return;
    }

    const preview = names.slice(0, 6).map((name) => `<li>${esc(name)}</li>`).join('');
    const more = names.length > 6 ? `<li class="dc-sum-more">+ ${names.length - 6} more</li>` : '';
    host.innerHTML = `
        ${summaryRow('Line source', source)}
        ${summaryRow('Lines', `${names.length}${kits ? ` (incl. ${kits} Set${kits === 1 ? '' : 's'})` : ''}`)}
        ${total > 0 ? summaryRow('Total amount', total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : ''}
        <ul class="dc-sum-list">${preview}${more}</ul>`;
}

export function refreshDcSummaries() {
    renderDetailsSummary();
    renderItemsSummary();
}

export function openDcCreateModal(which, focusId) {
    const modal = document.getElementById(MODALS[which]);
    if (!modal) return;
    Object.values(MODALS).forEach((id) => {
        if (id !== modal.id) closeModal(document.getElementById(id));
    });
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    const target = document.getElementById(focusId || DEFAULT_FOCUS[which]);
    if (target) setTimeout(() => target.focus(), 0);
}

function closeModal(modal) {
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    refreshDcSummaries();
}

export function initDcCreateModals() {
    refreshDcSummaries();
    if (initialized) return;
    initialized = true;

    Object.values(MODALS).forEach((id) => {
        const modal = document.getElementById(id);
        if (!modal) return;
        // Fixed overlays must not sit under a transformed/overflow-clipped view container.
        if (modal.parentElement !== document.body) document.body.appendChild(modal);

        let pendingRefresh = null;
        const scheduleRefresh = () => {
            clearTimeout(pendingRefresh);
            pendingRefresh = setTimeout(refreshDcSummaries, 120);
        };
        modal.addEventListener('input', scheduleRefresh);
        modal.addEventListener('change', scheduleRefresh);

        let pressedOnBackdrop = false;
        modal.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === modal; });
        modal.addEventListener('click', (e) => {
            if (e.target === modal && pressedOnBackdrop) closeModal(modal);
            if (e.target.closest('[data-dc-modal-close]')) closeModal(modal);
        });
    });

    document.getElementById('btnDcEditDetails')?.addEventListener('click', () => openDcCreateModal('details'));
    document.getElementById('btnDcEditItems')?.addEventListener('click', () => openDcCreateModal('items'));

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = Object.values(MODALS).map((id) => document.getElementById(id)).find((m) => m && m.classList.contains('is-open'));
        // Only when focus is inside our pop-up, so Escape in a pop-up opened on top (e.g. the Set picker) closes just that one.
        if (open && (open.contains(document.activeElement) || document.activeElement === document.body)) closeModal(open);
    });

    const itemsBody = document.getElementById('dcSelectedAssetsBody');
    if (itemsBody) {
        let pending = null;
        new MutationObserver(() => {
            clearTimeout(pending);
            pending = setTimeout(renderItemsSummary, 50);
        }).observe(itemsBody, { childList: true, subtree: true, characterData: true });
    }
}

window.openDcCreateModal = openDcCreateModal;
window.refreshDcSummaries = refreshDcSummaries;
