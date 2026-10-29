/**
 * Dated HSN / SAC history for a holding. Information modal only.
 */
(function () {
    const MONTHS = [
        { n: 4, label: 'April' }, { n: 5, label: 'May' }, { n: 6, label: 'June' },
        { n: 7, label: 'July' }, { n: 8, label: 'August' }, { n: 9, label: 'September' },
        { n: 10, label: 'October' }, { n: 11, label: 'November' }, { n: 12, label: 'December' },
        { n: 1, label: 'January' }, { n: 2, label: 'February' }, { n: 3, label: 'March' }
    ];

    const CSS = `
        .hsn-hist-modal { display:none; position:fixed; z-index:10001; left:0; top:0; width:100%; height:100%; overflow:auto; background:rgba(15,23,42,0.45); }
        .hsn-hist-card { background:#fff; margin:6% auto; width:92%; max-width:720px; border-radius:12px; box-shadow:0 18px 40px rgba(15,23,42,0.25); display:flex; flex-direction:column; max-height:86vh; }
        .hsn-hist-hd { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid #e2e8f0; background:#f8fafc; border-radius:12px 12px 0 0; }
        .hsn-hist-hd h3 { margin:0; font-size:16px; color:#0f172a; }
        .hsn-hist-close { border:0; background:transparent; font-size:22px; line-height:1; color:#64748b; cursor:pointer; }
        .hsn-hist-filters { display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:8px; padding:12px 18px; border-bottom:1px solid #eef2f7; }
        .hsn-hist-filters label { display:block; font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-bottom:3px; }
        .hsn-hist-filters select, .hsn-hist-filters input { width:100%; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; font-size:13px; }
        .hsn-hist-body { overflow:auto; padding:0; }
        .hsn-hist-now { margin:12px 18px 0; padding:10px 12px; background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; font-size:13px; color:#312e81; }
        .hsn-hist-table { width:100%; border-collapse:collapse; font-size:13px; }
        .hsn-hist-table th { text-align:left; padding:10px 14px; background:#f1f5f9; color:#475569; position:sticky; top:0; }
        .hsn-hist-table td { padding:9px 14px; border-bottom:1px solid #f1f5f9; vertical-align:top; color:#334155; }
        .hsn-hist-empty { padding:36px; text-align:center; color:#94a3b8; }
        .hsn-hist-ft { padding:12px 18px; text-align:right; border-top:1px solid #eee; }
        .hsn-hist-ft button { padding:8px 14px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; cursor:pointer; }
        .hsn-kind { font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 7px; border-radius:999px; }
        .hsn-kind-OPENING { background:#ecfdf5; color:#166534; border:1px solid #bbf7d0; }
        .hsn-kind-CHANGE { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
        @media (max-width: 720px) { .hsn-hist-filters { grid-template-columns:1fr 1fr; } }
    `;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fyOptions() {
        const now = new Date();
        const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const out = ['<option value="">All periods</option>'];
        for (let i = 0; i < 8; i += 1) {
            const fy = y - i;
            out.push(`<option value="${fy}">FY ${fy}–${String(fy + 1).slice(-2)}</option>`);
        }
        return out.join('');
    }

    function monthOptions() {
        return ['<option value="">Full year</option>']
            .concat(MONTHS.map((m) => `<option value="${m.n}">${m.label}</option>`))
            .join('');
    }

    function fmt(iso) {
        if (!iso) return 'Current';
        try {
            return new Date(iso).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            return String(iso);
        }
    }

    function ensure() {
        if (!document.getElementById('hsnHistoryModalStyle')) {
            const style = document.createElement('style');
            style.id = 'hsnHistoryModalStyle';
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        if (document.getElementById('hsnHistoryModal')) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div id="hsnHistoryModal" class="hsn-hist-modal">
                <div class="hsn-hist-card">
                    <div class="hsn-hist-hd">
                        <h3>HSN / SAC history <span id="hsnHistorySubtitle" style="font-weight:500;color:#64748b;font-size:13px;"></span></h3>
                        <button type="button" class="hsn-hist-close" id="hsnHistoryClose">&times;</button>
                    </div>
                    <div class="hsn-hist-filters">
                        <div>
                            <label for="hsnHistoryFy">Financial year</label>
                            <select id="hsnHistoryFy">${fyOptions()}</select>
                        </div>
                        <div>
                            <label for="hsnHistoryMonth">Month</label>
                            <select id="hsnHistoryMonth">${monthOptions()}</select>
                        </div>
                        <div>
                            <label for="hsnHistoryAsOf">As of date</label>
                            <input type="date" id="hsnHistoryAsOf">
                        </div>
                        <div style="align-self:end;">
                            <button type="button" id="hsnHistoryReload">Show</button>
                        </div>
                    </div>
                    <div id="hsnHistoryNow" class="hsn-hist-now"></div>
                    <div class="hsn-hist-body">
                        <div id="hsnHistoryEmpty" class="hsn-hist-empty" style="display:none;">No HSN / SAC recorded for this period.</div>
                        <table class="hsn-hist-table" id="hsnHistoryTable">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>Until</th>
                                    <th>Period</th>
                                    <th>HSN / SAC</th>
                                    <th>By</th>
                                </tr>
                            </thead>
                            <tbody id="hsnHistoryBody"></tbody>
                        </table>
                    </div>
                    <div class="hsn-hist-ft">
                        <button type="button" id="hsnHistoryDone">Close</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(wrap.firstElementChild);
        const close = () => { document.getElementById('hsnHistoryModal').style.display = 'none'; };
        document.getElementById('hsnHistoryClose').onclick = close;
        document.getElementById('hsnHistoryDone').onclick = close;
        document.getElementById('hsnHistoryModal').addEventListener('click', (e) => {
            if (e.target.id === 'hsnHistoryModal') close();
        });
        document.getElementById('hsnHistoryReload').onclick = () => {
            const ctx = window.__hsnHistoryCtx;
            if (ctx) window.showHsnHistoryModal(ctx.resourceType, ctx.resourceId, ctx.label);
        };
        document.getElementById('hsnHistoryFy').onchange = () => {
            document.getElementById('hsnHistoryAsOf').value = '';
        };
        document.getElementById('hsnHistoryAsOf').onchange = () => {
            if (document.getElementById('hsnHistoryAsOf').value) {
                document.getElementById('hsnHistoryFy').value = '';
                document.getElementById('hsnHistoryMonth').value = '';
            }
        };
    }

    async function load() {
        const ctx = window.__hsnHistoryCtx;
        if (!ctx) return;
        const fy = document.getElementById('hsnHistoryFy').value;
        const month = document.getElementById('hsnHistoryMonth').value;
        const asOf = document.getElementById('hsnHistoryAsOf').value;
        const params = new URLSearchParams();
        if (asOf) params.set('asOf', asOf);
        else {
            if (fy) params.set('fy', fy);
            if (fy && month) params.set('month', month);
        }
        const qs = params.toString();
        const url = `/api/holdings/${encodeURIComponent(ctx.resourceType)}/${encodeURIComponent(ctx.resourceId)}/hsn-history${qs ? `?${qs}` : ''}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
            throw new Error(data.error || `Could not load HSN history (${res.status})`);
        }
        const now = document.getElementById('hsnHistoryNow');
        const current = data.current ? esc(data.current) : '—';
        const desc = data.currentDescription ? ` · ${esc(data.currentDescription)}` : '';
        const asOfLine = data.asOf
            ? ` As of ${esc(data.asOf)}: <strong>${esc(data.asOfHsn || 'none')}</strong>.`
            : '';
        now.innerHTML = `On file now: <strong>${current}</strong>${desc}.${asOfLine}`;

        const rows = Array.isArray(data.rows) ? data.rows : [];
        const empty = document.getElementById('hsnHistoryEmpty');
        const table = document.getElementById('hsnHistoryTable');
        const body = document.getElementById('hsnHistoryBody');
        if (!rows.length) {
            empty.style.display = 'block';
            table.style.display = 'none';
            body.innerHTML = '';
            return;
        }
        empty.style.display = 'none';
        table.style.display = 'table';
        body.innerHTML = rows.map((row) => {
            const period = `${esc(row.fyLabel || '')}${row.monthLabel ? ' · ' + esc(row.monthLabel) : ''}`;
            const code = esc(row.hsnCode || '—');
            const prev = row.previousHsnCode ? `<div style="font-size:11px;color:#94a3b8;">was ${esc(row.previousHsnCode)}</div>` : '';
            const note = row.note ? `<div style="font-size:11px;color:#64748b;">${esc(row.note)}</div>` : '';
            return `<tr>
                <td style="white-space:nowrap;font-size:12px;color:#64748b;">${esc(fmt(row.effectiveFrom))}</td>
                <td style="white-space:nowrap;font-size:12px;color:#64748b;">${esc(fmt(row.effectiveTo))}</td>
                <td>${period}<div><span class="hsn-kind hsn-kind-${esc(row.kind || 'CHANGE')}">${esc(row.kind || '')}</span></div></td>
                <td><strong>${code}</strong>${row.description ? `<div style="font-size:11px;color:#64748b;">${esc(row.description)}</div>` : ''}${prev}${note}</td>
                <td>${esc(row.actor || '—')}</td>
            </tr>`;
        }).join('');
    }

    window.showHsnHistoryModal = async function (resourceType, resourceId, label) {
        ensure();
        window.__hsnHistoryCtx = { resourceType, resourceId, label };
        document.getElementById('hsnHistorySubtitle').textContent = label
            ? ` · ${label} (${resourceId})`
            : ` · ${resourceType} ${resourceId}`;
        document.getElementById('hsnHistoryModal').style.display = 'block';
        const body = document.getElementById('hsnHistoryBody');
        body.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#64748b;">Loading…</td></tr>';
        try {
            await load();
        } catch (err) {
            body.innerHTML = `<tr><td colspan="5" style="padding:24px;color:#b91c1c;">${esc(err.message)}</td></tr>`;
        }
    };

    window.bindHsnHistoryButton = function () {
        ensure();
        const btn = document.getElementById('btnOpenHsnHistory');
        if (!btn) return;
        const form = document.getElementById('addAssetItemForm');
        const entity = form && form.dataset.entity === 'inventory' ? 'INVENTORY' : 'ASSET';
        const assetId = String(document.getElementById('assetDbId')?.value || '').trim();
        const invId = String(form?.dataset.inventoryEditId || '').trim();
        const id = entity === 'INVENTORY' ? invId : assetId;
        btn.style.display = id ? 'inline-flex' : 'none';
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!id) return;
            const name = document.getElementById('itemName')?.value || '';
            window.showHsnHistoryModal(entity, id, name);
        };
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensure);
    } else {
        ensure();
    }
})();
