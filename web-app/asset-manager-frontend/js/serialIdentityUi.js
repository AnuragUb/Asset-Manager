/**
 * Manufacturer serials as notations under a holding (resource_type + resource_id + sort_order).
 * Edit panel on forms + browse/search modal for list tables.
 */
import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.61';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseLegacySerialCount(raw) {
    if (raw == null || raw === '' || raw === '-') return 0;
    const parts = String(raw).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    return parts.length;
}

/** Compact table cell: count / first SN + open browse modal (scales for multi-serial). */
export function serialsTableCellHtml(resourceType, resourceId, rawSrno) {
    const type = String(resourceType || 'ASSET').toUpperCase();
    const id = String(resourceId || '').trim();
    const count = parseLegacySerialCount(rawSrno);
    if (!id) return '<span style="color:#94a3b8;">—</span>';
    if (!count) {
        return `<button type="button" class="serials-browse-btn" data-resource-type="${escapeHtml(type)}" data-resource-id="${escapeHtml(id)}"
            title="View serial numbers" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;">None · view</button>`;
    }
    if (count === 1) {
        const one = String(rawSrno).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)[0];
        return `<button type="button" class="serials-browse-btn" data-resource-type="${escapeHtml(type)}" data-resource-id="${escapeHtml(id)}"
            title="View serial numbers" style="border:1px solid #e2e8f0;background:#fff;color:#0f172a;border-radius:6px;padding:3px 8px;font-size:11px;font-family:ui-monospace,monospace;cursor:pointer;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(one)}</button>`;
    }
    return `<button type="button" class="serials-browse-btn" data-resource-type="${escapeHtml(type)}" data-resource-id="${escapeHtml(id)}"
        title="View / search ${count} serial numbers" style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;cursor:pointer;">${count} serials ▾</button>`;
}

export function bindSerialsBrowseButtons(root = document) {
    (root.querySelectorAll ? root : document).querySelectorAll('.serials-browse-btn').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const type = btn.getAttribute('data-resource-type');
            const id = btn.getAttribute('data-resource-id');
            showSerialsBrowseModal(type, id);
        });
    });
}

function ensureBrowseModal() {
    if (document.getElementById('sharedSerialsBrowseModal')) return;
    const style = document.createElement('style');
    style.textContent = `
        .serials-browse-modal{display:none;position:fixed;z-index:10002;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}
        .serials-browse-content{background:#fff;margin:5% auto;width:92%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:12px;box-shadow:0 12px 40px rgba(15,23,42,.25);overflow:hidden}
        .serials-browse-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
        .serials-browse-title{margin:0;font-size:1.05rem;color:#0f172a}
        .serials-browse-sub{margin:4px 0 0;font-size:12px;color:#64748b}
        .serials-browse-close{border:0;background:transparent;font-size:22px;color:#94a3b8;cursor:pointer;line-height:1}
        .serials-browse-close:hover{color:#0f172a}
        .serials-browse-body{padding:14px 20px 20px;overflow:auto;flex:1}
        .serials-browse-search{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-bottom:10px}
        .serials-browse-list{list-style:none;margin:0;padding:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
        .serials-browse-list li{padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}
        .serials-browse-list li:last-child{border-bottom:0}
        .serials-browse-sn{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;color:#0f172a}
        .serials-browse-meta{font-size:11px;color:#94a3b8}
        .serials-browse-empty{padding:24px;text-align:center;color:#94a3b8;font-size:13px}
        .serials-browse-footer{padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end}
    `;
    document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div id="sharedSerialsBrowseModal" class="serials-browse-modal" role="dialog" aria-modal="true">
            <div class="serials-browse-content">
                <div class="serials-browse-header">
                    <div>
                        <h3 class="serials-browse-title">Serial numbers</h3>
                        <p class="serials-browse-sub" id="sharedSerialsBrowseSub"></p>
                    </div>
                    <button type="button" class="serials-browse-close" id="sharedSerialsBrowseClose" aria-label="Close">&times;</button>
                </div>
                <div class="serials-browse-body">
                    <input type="search" class="serials-browse-search" id="sharedSerialsBrowseSearch" placeholder="Search serial…" autocomplete="off">
                    <ul class="serials-browse-list" id="sharedSerialsBrowseList"></ul>
                </div>
                <div class="serials-browse-footer">
                    <button type="button" class="action-button grey" id="sharedSerialsBrowseDone" style="padding:8px 14px;">Close</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrap.firstElementChild);
    const close = () => {
        const m = document.getElementById('sharedSerialsBrowseModal');
        if (m) m.style.display = 'none';
    };
    document.getElementById('sharedSerialsBrowseClose')?.addEventListener('click', close);
    document.getElementById('sharedSerialsBrowseDone')?.addEventListener('click', close);
    document.getElementById('sharedSerialsBrowseModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'sharedSerialsBrowseModal') close();
    });
}

let browseCache = { serials: [], resourceType: null, resourceId: null };

function paintBrowseList(filter) {
    const list = document.getElementById('sharedSerialsBrowseList');
    if (!list) return;
    const q = String(filter || '').trim().toLowerCase();
    const rows = (browseCache.serials || []).filter((s) => {
        if (!q) return true;
        return String(s.serialValue || '').toLowerCase().includes(q)
            || String(s.sortOrder).includes(q);
    });
    if (!rows.length) {
        list.innerHTML = `<li class="serials-browse-empty">${q ? 'No matching serials' : 'No serials on this holding'}</li>`;
        return;
    }
    list.innerHTML = rows.map((s) => `
        <li>
            <span class="serials-browse-sn">${escapeHtml(s.serialValue)}</span>
            <span class="serials-browse-meta">#${escapeHtml(s.sortOrder)} · ${escapeHtml(s.status || 'ACTIVE')}</span>
        </li>
    `).join('');
}

export async function showSerialsBrowseModal(resourceType, resourceId) {
    ensureBrowseModal();
    const type = String(resourceType || 'ASSET').toUpperCase();
    const id = String(resourceId || '').trim();
    if (!id) return;
    const modal = document.getElementById('sharedSerialsBrowseModal');
    const sub = document.getElementById('sharedSerialsBrowseSub');
    const search = document.getElementById('sharedSerialsBrowseSearch');
    const list = document.getElementById('sharedSerialsBrowseList');
    modal.style.display = 'block';
    sub.textContent = `${type} · ${id}`;
    list.innerHTML = '<li class="serials-browse-empty">Loading…</li>';
    search.value = '';
    try {
        const params = new URLSearchParams({ resourceType: type, resourceId: id, includeInactive: '0' });
        const res = await fetchWithAuth(`/api/serials?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        browseCache = { serials: data.serials || [], resourceType: type, resourceId: id };
        sub.textContent = `${type} · ${id} · ${(browseCache.serials || []).length} active`;
        paintBrowseList('');
        search.oninput = () => paintBrowseList(search.value);
        search.focus();
    } catch (err) {
        list.innerHTML = `<li class="serials-browse-empty" style="color:#b91c1c;">${escapeHtml(err.message || 'Load failed')}</li>`;
    }
}

export async function loadSerialIdentityPanel(resourceType, resourceId) {
    const panel = document.getElementById('serialIdentityPanel');
    const list = document.getElementById('serialIdentityList');
    const meta = document.getElementById('serialIdentityMeta');
    if (!panel || !list) return;
    if (!resourceType || !resourceId) {
        panel.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    panel.style.display = 'block';
    panel.dataset.resourceType = resourceType;
    panel.dataset.resourceId = resourceId;
    list.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:6px;">Loading serials…</div>';
    try {
        const params = new URLSearchParams({
            resourceType,
            resourceId,
            includeInactive: '0'
        });
        const res = await fetchWithAuth(`/api/serials?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        const serials = data.serials || [];
        if (meta) meta.textContent = `${serials.length} active serial${serials.length === 1 ? '' : 's'}`;
        if (!serials.length) {
            list.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:6px;">No serials yet. Add below or save from the S/N field.</div>';
            return;
        }
        list.innerHTML = serials.map((s) => `
            <div class="serial-identity-row" data-sort="${escapeHtml(s.sortOrder)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">
                <div>
                    <div style="font-weight:600;font-family:ui-monospace,monospace;">${escapeHtml(s.serialValue)}</div>
                    <div style="font-size:10px;color:#94a3b8;">#${escapeHtml(s.sortOrder)} · ${escapeHtml(resourceId)}</div>
                </div>
                <button type="button" class="serial-identity-retire action-button grey" style="padding:2px 8px;font-size:11px;" data-sort="${escapeHtml(s.sortOrder)}">Retire</button>
            </div>
        `).join('');
        list.querySelectorAll('.serial-identity-retire').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const sortOrder = btn.getAttribute('data-sort');
                if (sortOrder == null || !confirm('Retire this serial?')) return;
                try {
                    const r = await fetchWithAuth('/api/serials/retire', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            resourceType,
                            resourceId,
                            sortOrder: Number(sortOrder),
                            status: 'RETIRED'
                        })
                    });
                    const body = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(body.error || `Retire failed (${r.status})`);
                    showToast('Serial retired', 'success');
                    await loadSerialIdentityPanel(resourceType, resourceId);
                    syncFormFieldsFromSerials(resourceType, resourceId);
                } catch (err) {
                    showToast(err.message || 'Retire failed', 'error');
                }
            });
        });
    } catch (err) {
        list.innerHTML = `<div style="font-size:12px;color:#b91c1c;padding:6px;">${escapeHtml(err.message || 'Load failed')}</div>`;
    }
}

async function syncFormFieldsFromSerials(resourceType, resourceId) {
    try {
        const params = new URLSearchParams({ resourceType, resourceId });
        const res = await fetchWithAuth(`/api/serials?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const joined = (data.serials || []).map((s) => s.serialValue).join(', ');
        const single = document.getElementById('itemSrNo');
        const batch = document.getElementById('itemSrNoBatch');
        if (single && document.getElementById('btnToggleBatchMode')?.dataset.batch !== '1') {
            single.value = joined;
        }
        if (batch) batch.value = (data.serials || []).map((s) => s.serialValue).join('\n');
    } catch (_) { /* ignore */ }
}

export function bindSerialIdentityPanel() {
    const addBtn = document.getElementById('btnSerialIdentityAdd');
    const input = document.getElementById('serialIdentityAddInput');
    if (!addBtn || addBtn.dataset.bound === '1') return;
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const panel = document.getElementById('serialIdentityPanel');
        const resourceType = panel?.dataset.resourceType;
        const resourceId = panel?.dataset.resourceId;
        const serialValue = String(input?.value || '').trim();
        if (!resourceType || !resourceId) {
            showToast('Open an existing Asset or Inventory item first', 'warning');
            return;
        }
        if (!serialValue) {
            showToast('Enter a serial number', 'warning');
            return;
        }
        try {
            const r = await fetchWithAuth('/api/serials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resourceType, resourceId, serialValue, source: 'MANUAL' })
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(body.error || `Add failed (${r.status})`);
            if (input) input.value = '';
            showToast('Serial added', 'success');
            await loadSerialIdentityPanel(resourceType, resourceId);
            await syncFormFieldsFromSerials(resourceType, resourceId);
        } catch (err) {
            showToast(err.message || 'Add failed', 'error');
        }
    });
}

export function hideSerialIdentityPanel() {
    const panel = document.getElementById('serialIdentityPanel');
    if (panel) {
        panel.style.display = 'none';
        delete panel.dataset.resourceType;
        delete panel.dataset.resourceId;
    }
    const list = document.getElementById('serialIdentityList');
    if (list) list.innerHTML = '';
}

window.loadSerialIdentityPanel = loadSerialIdentityPanel;
window.hideSerialIdentityPanel = hideSerialIdentityPanel;
window.bindSerialIdentityPanel = bindSerialIdentityPanel;
window.showSerialsBrowseModal = showSerialsBrowseModal;
window.bindSerialsBrowseButtons = bindSerialsBrowseButtons;
window.serialsTableCellHtml = serialsTableCellHtml;
