/**
 * Settings → DC Dispatch Reasons (PHYSICAL_TALLY_AUTHORITY_ADR §9).
 * Visible to roles holding dc.reason.manage.
 */
import { fetchWithAuth } from './auth.js?v=7.29';
import { hasPermission, showToast } from './utils.js?v=7.42';

const BEHAVIOUR_HINTS = {
    RETURNABLE: 'Stock goes out and comes back through a Return Inward. Counted under "Out on DC" in the Stock Tally.',
    RETURNABLE_DESTINATION: 'Like Returnable, but the DC records a destination location. On receipt, assets move to that location.',
    SALE_EXIT: 'Stock leaves ownership as a sale. Counted under "Out · DC Sale".',
    OTHER_EXIT: 'Stock leaves ownership without a sale (e.g. FOC, replacement). Counted under "Out · Other DC exit".',
    VENDOR_EXIT: 'Stock goes back to a supplier. Counted under "Out · Vendor Rtn".'
};

let state = { reasons: [], behaviours: [], editing: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function notify(msg, type = 'success') {
    if (typeof showToast === 'function') showToast(msg, type);
    else alert(msg);
}

async function api(path, options = {}) {
    const res = await fetchWithAuth(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
}

function refreshDcFormDropdown() {
    if (typeof window.populateDcDispatchReasonSelect === 'function') {
        window.populateDcDispatchReasonSelect(true);
    }
}

function renderTable() {
    const body = document.getElementById('dcReasonsBody');
    if (!body) return;
    if (!state.reasons.length) {
        body.innerHTML = '<tr><td colspan="9" style="padding: 12px; color: #94a3b8;">No reasons configured.</td></tr>';
        return;
    }
    body.innerHTML = state.reasons.map((r) => `
        <tr style="border-bottom: 1px solid #f1f5f9;${r.isActive ? '' : ' opacity: 0.55;'}">
            <td style="padding: 8px;">${esc(r.label)}${r.isSystem ? ' <span style="font-size:10px;color:#64748b;border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;">built-in</span>' : ''}</td>
            <td style="padding: 8px; font-family: monospace; font-size: 12px;">${esc(r.code)}</td>
            <td style="padding: 8px;">${esc(r.behaviourLabel)}</td>
            <td style="padding: 8px;">${esc(r.assetStatus || '—')}</td>
            <td style="padding: 8px;">${esc(r.tallyColumn)}</td>
            <td style="padding: 8px; text-align: right;">${esc(r.sortOrder)}</td>
            <td style="padding: 8px; text-align: right;">${esc(r.inUse ?? 0)}</td>
            <td style="padding: 8px;">
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" data-reason-toggle="${esc(r.code)}" ${r.isActive ? 'checked' : ''}>
                    ${r.isActive ? 'Active' : 'Inactive'}
                </label>
            </td>
            <td style="padding: 8px;"><button type="button" class="action-button" style="padding: 4px 10px; font-size: 12px;" data-reason-edit="${esc(r.code)}">Edit</button></td>
        </tr>`).join('');
}

function renderBehaviourOptions() {
    const select = document.getElementById('dcReasonBehaviour');
    if (!select) return;
    const current = select.value;
    select.innerHTML = state.behaviours
        .map((b) => `<option value="${esc(b.code)}">${esc(b.label)}</option>`)
        .join('');
    if (current) select.value = current;
    syncHint();
}

function syncHint() {
    const hint = document.getElementById('dcReasonBehaviourHint');
    const b = document.getElementById('dcReasonBehaviour')?.value;
    if (hint) hint.textContent = BEHAVIOUR_HINTS[b] || '';
}

function resetForm() {
    state.editing = null;
    const form = document.getElementById('dcReasonForm');
    if (form) form.reset();
    document.getElementById('dcReasonEditCode').value = '';
    document.getElementById('dcReasonFormTitle').textContent = 'Add a reason';
    document.getElementById('dcReasonSubmit').textContent = 'Add Reason';
    document.getElementById('dcReasonCancel').style.display = 'none';
    document.getElementById('dcReasonSort').value = '500';
    document.getElementById('dcReasonBehaviour').disabled = false;
    document.getElementById('dcReasonAssetStatus').disabled = false;
    syncHint();
}

function startEdit(code) {
    const r = state.reasons.find((x) => x.code === code);
    if (!r) return;
    state.editing = r;
    document.getElementById('dcReasonEditCode').value = r.code;
    document.getElementById('dcReasonLabel').value = r.label;
    document.getElementById('dcReasonBehaviour').value = r.behaviour;
    document.getElementById('dcReasonAssetStatus').value = r.assetStatus || '';
    document.getElementById('dcReasonSort').value = r.sortOrder;
    // Built-in or already-used reasons keep behaviour and asset status (server enforces too).
    const locked = r.isSystem || Number(r.inUse || 0) > 0;
    document.getElementById('dcReasonBehaviour').disabled = locked;
    document.getElementById('dcReasonAssetStatus').disabled = locked;
    document.getElementById('dcReasonFormTitle').textContent = locked
        ? `Edit ${r.label} (behaviour and asset status are locked)`
        : `Edit ${r.label}`;
    document.getElementById('dcReasonSubmit').textContent = 'Save Changes';
    document.getElementById('dcReasonCancel').style.display = 'inline-block';
    syncHint();
    document.getElementById('dcReasonForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadReasons() {
    try {
        const data = await api('/api/dc/reasons?manage=1');
        state.reasons = data.data || [];
        state.behaviours = data.behaviours || [];
        renderBehaviourOptions();
        renderTable();
    } catch (err) {
        const body = document.getElementById('dcReasonsBody');
        if (body) body.innerHTML = `<tr><td colspan="9" style="padding: 12px; color: #b91c1c;">${esc(err.message)}</td></tr>`;
    }
}

async function onSubmit(e) {
    e.preventDefault();
    const code = document.getElementById('dcReasonEditCode').value;
    const body = {
        label: document.getElementById('dcReasonLabel').value.trim(),
        sortOrder: Number(document.getElementById('dcReasonSort').value || 500)
    };
    const behaviourEl = document.getElementById('dcReasonBehaviour');
    const statusEl = document.getElementById('dcReasonAssetStatus');
    if (!behaviourEl.disabled) body.behaviour = behaviourEl.value;
    if (!statusEl.disabled) body.assetStatus = statusEl.value.trim();

    const submit = document.getElementById('dcReasonSubmit');
    submit.disabled = true;
    try {
        if (code) {
            await api(`/api/dc/reasons/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) });
            notify(`Reason "${body.label}" updated`);
        } else {
            const created = await api('/api/dc/reasons', { method: 'POST', body: JSON.stringify(body) });
            notify(`Reason "${created.data.label}" added (${created.data.code})`);
        }
        resetForm();
        await loadReasons();
        refreshDcFormDropdown();
    } catch (err) {
        notify(err.message, 'error');
    } finally {
        submit.disabled = false;
    }
}

async function onToggle(code, active, checkbox) {
    checkbox.disabled = true;
    try {
        await api(`/api/dc/reasons/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ isActive: active }) });
        notify(`Reason ${active ? 'activated' : 'deactivated'}`);
        await loadReasons();
        refreshDcFormDropdown();
    } catch (err) {
        checkbox.checked = !active;
        notify(err.message, 'error');
    } finally {
        checkbox.disabled = false;
    }
}

export function initDcReasonsSettings() {
    const card = document.getElementById('dcReasonsCard');
    if (!card) return;
    if (!hasPermission('dc.reason.manage')) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';

    if (!card.dataset.bound) {
        card.dataset.bound = '1';
        document.getElementById('dcReasonForm').addEventListener('submit', onSubmit);
        document.getElementById('dcReasonCancel').addEventListener('click', resetForm);
        document.getElementById('dcReasonBehaviour').addEventListener('change', syncHint);
        card.addEventListener('click', (e) => {
            const editCode = e.target?.dataset?.reasonEdit;
            if (editCode) startEdit(editCode);
        });
        card.addEventListener('change', (e) => {
            const toggleCode = e.target?.dataset?.reasonToggle;
            if (toggleCode) onToggle(toggleCode, e.target.checked, e.target);
        });
    }
    loadReasons();
}
