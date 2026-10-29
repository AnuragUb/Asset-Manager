/**
 * DC "Add Set" picker (PHYSICAL_TALLY_AUTHORITY_ADR §10).
 * A Set is a product recipe; the physical units are chosen here, per component.
 * Every component must be fully picked (required × kits) before it can be added.
 */
import { showToast } from './utils.js?v=6.59';
import { fetchWithAuth } from './auth.js?v=7.29';

const EPS = 1e-9;

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) {
    return String(Math.round(Number(n || 0) * 1e6) / 1e6);
}

async function getJson(url) {
    const res = await fetchWithAuth(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

/**
 * @param {{ excludeKeys?: Set<string>, onApply: (pick: { set: object, kits: number, lines: Array<{ requirement: object, holding: object, qty: number }> }) => void }} opts
 *   excludeKeys: `${resourceType}:${id lowercased}` already on the DC.
 */
export async function openDcSetPicker({ excludeKeys = new Set(), onApply } = {}) {
    document.getElementById('dcSetPickerModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dcSetPickerModal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '10050';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 900px; width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <h3 style="margin:0;">Add Set to DC</h3>
                <button type="button" data-close style="background:none;border:none;font-size:22px;cursor:pointer;">&times;</button>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
                <label style="flex:1;min-width:240px;font-size:12px;font-weight:700;">Set
                    <select id="dcSetPickerSet" style="width:100%;padding:8px;margin-top:4px;"><option value="">Loading Sets…</option></select>
                </label>
                <label style="width:110px;font-size:12px;font-weight:700;">Kits
                    <input id="dcSetPickerKits" type="number" min="1" step="1" value="1" style="width:100%;padding:8px;margin-top:4px;">
                </label>
                <button type="button" id="dcSetPickerAuto" class="action-button light-grey" style="padding:8px 12px;" disabled>Auto-fill</button>
            </div>
            <p class="lc-muted" style="margin:0 0 8px;font-size:12px;">Pick the units for every component. A multi-unit asset can give part of its quantity — it is split automatically when the DC is saved.</p>
            <div id="dcSetPickerBody" style="flex:1;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#f8fafc;min-height:160px;">
                <div class="lc-muted" style="padding:12px;">Choose a Set.</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:8px;">
                <span id="dcSetPickerStatus" style="font-size:12px;color:#64748b;"></span>
                <div style="display:flex;gap:8px;">
                    <button type="button" class="action-button light-grey" data-close>Cancel</button>
                    <button type="button" id="dcSetPickerApply" class="action-button" style="background:#4f46e5;color:#fff;" disabled>Add to DC</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const state = { data: null, picks: new Map() };
    const pickKey = (reqId, h) => `${reqId}|${h.resourceType}:${h.resourceId}`;
    const holdingKey = (h) => `${h.resourceType}:${String(h.resourceId).toLowerCase()}`;

    const pickedFor = (req) => req.holdings.reduce((acc, h) => acc + (state.picks.get(pickKey(req.id, h)) || 0), 0);
    const usedElsewhere = (reqId, h) => {
        let used = 0;
        for (const [key, qty] of state.picks) {
            if (key.endsWith(`|${h.resourceType}:${h.resourceId}`) && !key.startsWith(`${reqId}|`)) used += qty;
        }
        return used;
    };

    const refreshStatus = () => {
        const reqs = state.data?.requirements || [];
        let complete = reqs.length > 0;
        reqs.forEach((req) => {
            const got = pickedFor(req);
            const ok = Math.abs(got - req.needed) <= EPS;
            if (!ok) complete = false;
            const badge = overlay.querySelector(`[data-req-badge="${req.id}"]`);
            if (badge) {
                badge.textContent = `${fmt(got)} / ${fmt(req.needed)} ${req.unit}`;
                badge.style.background = ok ? '#dcfce7' : (got > req.needed + EPS ? '#fee2e2' : '#fef3c7');
                badge.style.color = ok ? '#166534' : (got > req.needed + EPS ? '#b91c1c' : '#92400e');
            }
        });
        $('#dcSetPickerApply').disabled = !complete;
        const short = reqs.filter((r) => r.short > EPS);
        $('#dcSetPickerStatus').textContent = short.length
            ? `Not enough stock: ${short.map((r) => `${r.productName} short ${fmt(r.short)}`).join(', ')}`
            : (complete ? 'All components picked.' : 'Pick every component to continue.');
        $('#dcSetPickerStatus').style.color = short.length ? '#b91c1c' : '#64748b';
    };

    const render = () => {
        const body = $('#dcSetPickerBody');
        const reqs = state.data?.requirements || [];
        body.innerHTML = reqs.map((req) => {
            const rows = req.holdings.length
                ? req.holdings.map((h) => {
                    const max = Number(h.quantityAvailable);
                    const cap = Number.isFinite(max) ? Math.max(0, max) : 0;
                    const step = h.resourceType === 'ASSET' ? 1 : 'any';
                    const val = state.picks.get(pickKey(req.id, h)) || '';
                    const detail = [h.srNo ? `SN ${esc(h.srNo)}` : '', esc(h.location || ''), esc(h.status || '')].filter(Boolean).join(' · ');
                    return `<tr style="border-top:1px solid #eef2f7;">
                        <td style="padding:6px;font-family:monospace;font-size:12px;white-space:nowrap;">${esc(h.resourceId)}<div style="font-size:10px;color:#64748b;font-family:inherit;">${h.resourceType === 'INVENTORY' ? 'Inventory' : 'Asset'}${h.splittable && h.resourceType === 'ASSET' ? ' · multi-unit' : ''}</div></td>
                        <td style="padding:6px;font-size:12px;">${esc(h.name)}<div style="font-size:11px;color:#64748b;">${detail}</div></td>
                        <td style="padding:6px;font-size:12px;text-align:right;white-space:nowrap;">${fmt(cap)} ${esc(h.unit)}</td>
                        <td style="padding:6px;width:90px;"><input type="number" min="0" max="${cap}" step="${step}" value="${val}" data-pick-req="${esc(req.id)}" data-pick-type="${esc(h.resourceType)}" data-pick-id="${esc(h.resourceId)}" style="width:100%;padding:6px;text-align:right;"></td>
                    </tr>`;
                }).join('')
                : `<tr><td colspan="4" style="padding:8px;color:#b91c1c;font-size:12px;">No in-store stock of this product.</td></tr>`;
            const mm = [req.make, req.model].filter(Boolean).join(' / ');
            return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #eef2f7;">
                    <div><strong>${esc(req.productName)}</strong>${mm ? ` <span style="font-size:11px;color:#64748b;">${esc(mm)}</span>` : ''}
                        <div style="font-size:11px;color:#64748b;">${fmt(req.perKit)} per kit × ${fmt(state.data.kits)} = ${fmt(req.needed)} ${esc(req.unit)} · ${fmt(req.inStock)} in stock</div></div>
                    <span data-req-badge="${esc(req.id)}" style="font-size:12px;font-weight:700;padding:3px 8px;border-radius:10px;"></span>
                </div>
                <table style="width:100%;border-collapse:collapse;">${rows}</table>
            </div>`;
        }).join('') || '<div class="lc-muted" style="padding:12px;">This Set has no components.</div>';

        body.querySelectorAll('input[data-pick-req]').forEach((input) => {
            input.oninput = () => {
                const req = reqs.find((r) => r.id === input.dataset.pickReq);
                const h = req?.holdings.find((x) => x.resourceType === input.dataset.pickType && x.resourceId === input.dataset.pickId);
                if (!req || !h) return;
                let qty = Number(input.value || 0);
                if (!Number.isFinite(qty) || qty < 0) qty = 0;
                if (h.resourceType === 'ASSET') qty = Math.floor(qty);
                const cap = Math.max(0, Number(h.quantityAvailable || 0) - usedElsewhere(req.id, h));
                if (qty > cap) {
                    qty = cap;
                    input.value = String(cap);
                    showToast(`Only ${fmt(cap)} available on ${h.resourceId}.`, 'error');
                }
                if (qty > 0) state.picks.set(pickKey(req.id, h), qty);
                else state.picks.delete(pickKey(req.id, h));
                refreshStatus();
            };
        });
        refreshStatus();
    };

    const autoFill = () => {
        (state.data?.requirements || []).forEach((req) => {
            req.holdings.forEach((h) => state.picks.delete(pickKey(req.id, h)));
            let remaining = req.needed;
            // Prefer holdings that fit exactly, then single units, so fewer records are split.
            const ordered = [...req.holdings].sort((a, b) => {
                const exactA = Math.abs(a.quantityAvailable - remaining) <= EPS ? 0 : 1;
                const exactB = Math.abs(b.quantityAvailable - remaining) <= EPS ? 0 : 1;
                return exactA - exactB || a.quantityAvailable - b.quantityAvailable;
            });
            for (const h of ordered) {
                if (remaining <= EPS) break;
                const cap = Math.max(0, h.quantityAvailable - usedElsewhere(req.id, h));
                let take = Math.min(cap, remaining);
                if (h.resourceType === 'ASSET') take = Math.floor(take);
                if (take > 0) {
                    state.picks.set(pickKey(req.id, h), take);
                    remaining -= take;
                }
            }
        });
        render();
    };

    const load = async () => {
        const setId = $('#dcSetPickerSet').value;
        state.picks.clear();
        $('#dcSetPickerAuto').disabled = true;
        if (!setId) {
            state.data = null;
            $('#dcSetPickerBody').innerHTML = '<div class="lc-muted" style="padding:12px;">Choose a Set.</div>';
            refreshStatus();
            return;
        }
        const kits = Math.max(1, Math.floor(Number($('#dcSetPickerKits').value || 1)));
        $('#dcSetPickerBody').innerHTML = '<div class="lc-muted" style="padding:12px;">Loading stock…</div>';
        try {
            const data = await getJson(`/api/dc/sets/${encodeURIComponent(setId)}/pick-options?kits=${kits}`);
            data.requirements.forEach((req) => {
                req.holdings = req.holdings.filter((h) => !excludeKeys.has(holdingKey(h)));
                req.inStock = req.holdings.reduce((acc, h) => acc + Number(h.quantityAvailable || 0), 0);
                req.short = Math.max(0, req.needed - req.inStock);
            });
            state.data = data;
            $('#dcSetPickerAuto').disabled = false;
            render();
        } catch (err) {
            state.data = null;
            $('#dcSetPickerBody').innerHTML = `<div style="padding:12px;color:#b91c1c;">${esc(err.message)}</div>`;
            refreshStatus();
        }
    };

    $('#dcSetPickerSet').onchange = load;
    $('#dcSetPickerKits').onchange = load;
    $('#dcSetPickerAuto').onclick = autoFill;
    $('#dcSetPickerApply').onclick = () => {
        const data = state.data;
        if (!data) return;
        const lines = [];
        data.requirements.forEach((req) => {
            req.holdings.forEach((h) => {
                const qty = state.picks.get(pickKey(req.id, h)) || 0;
                const cap = Number(h.quantityAvailable || 0);
                if (qty > cap + EPS) {
                    showToast(`${h.resourceId} has ${fmt(cap)} available; ${fmt(qty)} was entered.`, 'error');
                    return;
                }
                if (qty > 0) lines.push({ requirement: req, holding: h, qty });
            });
        });
        const merged = new Map();
        for (const line of lines) {
            const key = holdingKey(line.holding);
            if (merged.has(key)) {
                showToast(`${line.holding.resourceId} is picked for two components; use a separate unit for each`, 'warning');
                return;
            }
            merged.set(key, line);
        }
        close();
        onApply?.({ set: data.set, kits: data.kits, lines });
    };

    try {
        const { sets } = await getJson('/api/dc/sets');
        const select = $('#dcSetPickerSet');
        select.innerHTML = sets.length
            ? `<option value="">Select a Set…</option>${sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.requirementCount} component${s.requirementCount === 1 ? '' : 's'})</option>`).join('')}`
            : '<option value="">No active Sets with components</option>';
    } catch (err) {
        $('#dcSetPickerSet').innerHTML = '<option value="">Could not load Sets</option>';
        showToast(err.message, 'error');
    }
}
