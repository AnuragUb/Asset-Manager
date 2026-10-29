/**
 * Physical Tally report — per Product: In vs controlled exits vs On hand.
 * Read-only view over GET /api/reports/tally (PHYSICAL_TALLY_AUTHORITY_ADR).
 */
import {
    lifecycleApi,
    escapeHtml,
    formatQty,
    formatIstDateTime,
    go,
    consumeOpen,
    toastOperatorError
} from './lifecycle.js?v=7.140';

const PAGE_SIZE = 10;
const state = {
    q: '',
    mismatchOnly: false,
    type: 'ALL',
    data: null,
    page: 1,
    mode: 'lifetime',
    periodGrain: 'fy',
    fy: null,
    fq: null,
    month: null,
    periodFrom: null,
    periodTo: null,
    periodTitle: null,
    productId: null,
    periodData: null,
    fySiblings: [],
    monthSiblings: [],
    fqSiblings: [],
    productSiblings: []
};

const TYPE_LABEL = { ALL: 'Assets + Inventory', ASSET: 'Assets', INVENTORY: 'Inventory' };

function typeParam() {
    return state.type === 'ALL' ? '' : state.type;
}

const netConverted = (r) => Number(r.convertedIn || 0) - Number(r.convertedOut || 0);
const totalExits = (r) => ['dcSale', 'dcOtherExit', 'retired', 'vendorReturn', 'consumed', 'otherExit']
    .reduce((s, k) => s + Number(r[k] || 0), 0);
const totalInQty = (r) => Number(r.inReceipt || 0) + Number(r.inIntake || 0) + Number(r.inOpening || 0);
const availableQty = (r) => Number(r.onHand || 0) - Number(r.outOnDc || 0) - Number(r.outManual || 0) - Number(r.reservedForSet || 0);

function inColumns() {
    const cols = [
        { key: 'inReceipt', label: 'Receipt Note', tip: 'Posted purchase Receipt Notes (reversed excluded)' },
        { key: 'inIntake', label: 'Physical Intake', tip: 'Physical Intake' },
        { key: 'inDcReturn', label: 'DC Return', tip: 'Return Inward from a returnable Delivery Challan. Still owned while out; this is the return, not a new purchase.' },
        { key: 'inOpening', label: 'Legacy', tip: 'Holdings with no Receipt Note / Intake (balanced opening)' }
    ];
    if (state.type !== 'ALL') {
        cols.push({ key: 'converted', label: 'Converted', tip: 'Inventory ↔ Asset conversion. Nets to 0 when both types are shown.', signed: true });
    }
    cols.push({ key: 'totalIn', label: 'Total In', tip: 'Receipt Note + Intake + Legacy', strong: true });
    return cols;
}

function outColumns() {
    const cols = [
        { key: 'dcSale', label: 'DC Sale', tip: 'Delivery Challan dispatched with reason Sale' },
        { key: 'dcOtherExit', label: 'Other DC exit', tip: 'Replacement / Warranty swap or Free of Cost' }
    ];
    if (state.type !== 'INVENTORY') cols.push({ key: 'retired', label: 'Retired', tip: 'Asset Retire' });
    cols.push({ key: 'vendorReturn', label: 'Vendor Rtn', tip: 'Vendor Return document, or DC with reason Return to Vendor' });
    if (state.type !== 'ASSET') cols.push({ key: 'consumed', label: 'Consumed', tip: 'Inventory Consume' });
    if (state.type !== 'INVENTORY') cols.push({ key: 'otherExit', label: 'Other', tip: 'Exited without a DC / Retire / Vendor Return document' });
    cols.push({ key: 'deleted', label: 'Deleted', tip: 'Soft-deleted, recoverable' });
    cols.push({ key: 'totalOut', label: 'Total Out', tip: 'All controlled exits', strong: true });
    return cols;
}

function reserveColumns() {
    return [
        { key: 'outOnDc', label: 'Out on DC', tip: 'Still owned: Demo / Rental / Repair / Internal Use / Stock Transfer' },
        { key: 'outManual', label: 'Out · manual', tip: 'Status says out but no DC backs it' },
        { key: 'reservedForSet', label: 'Reserved for Set', tip: 'On-hand quantity reserved for a Set. Still owned; not available for another owner.' },
        { key: 'available', label: 'Available', tip: 'On hand − Out on DC − Out (manual) − Reserved for Set', strong: true }
    ];
}

function colValue(r, col) {
    if (col.key === 'converted') return netConverted(r);
    if (col.key === 'totalIn') return totalInQty(r);
    if (col.key === 'totalOut') return totalExits(r);
    if (col.key === 'available') return availableQty(r);
    return Number(r[col.key] || 0);
}

function el(id) {
    return document.getElementById(id);
}

function numCell(r, col, tone) {
    const n = colValue(r, col);
    if (n === 0) return `<td class="z">${col.strong ? '<b>–</b>' : '–'}</td>`;
    const shown = col.signed && n > 0 ? `+${formatQty(n)}` : formatQty(n);
    return `<td class="${tone}">${col.strong ? `<b>${shown}</b>` : shown}</td>`;
}

function mismatchTag(value) {
    const n = Number(value || 0);
    if (n === 0) return '<span class="tally-tag ok">Balanced</span>';
    const sign = n > 0 ? '+' : '';
    return `<span class="tally-tag nil">Mismatch ${sign}${formatQty(n)}</span>`;
}

const HEAD_STYLE = 'text-align:right;padding:6px 8px;font-size:11px;color:#475569;font-weight:700;white-space:nowrap;border-bottom:1px solid #e2e8f0;background:#f8fafc;position:sticky;top:0;';

function headerRows() {
    const sub = (cols, cls) => cols.map((c) => `<th class="${cls}" title="${escapeHtml(c.tip)}">${escapeHtml(c.label)}</th>`).join('');
    const inn = inColumns();
    const out = outColumns();
    const res = reserveColumns();
    return `<tr class="g">
        <th rowspan="2" class="l">Product</th>
        <th colspan="${inn.length}" class="gi">Stock In</th>
        <th colspan="${out.length}" class="go">Stock Out</th>
        <th colspan="${res.length}" class="gr">Reservation</th>
        <th rowspan="2" class="gm l">Mismatch</th>
    </tr>
    <tr>
        ${sub(inn, 'gi')}
        ${sub(out, 'go')}
        ${sub(res, 'gr')}
    </tr>`;
}

function productRow(r) {
    const key = r.productId || '__none__';
    const code = r.productCode ? escapeHtml(r.productCode) : escapeHtml(r.productId || 'No Product');
    return `<tr class="tally-row" data-product="${escapeHtml(key)}" style="cursor:pointer;">
        <td class="l">
            <div class="tally-prod" title="${escapeHtml(r.productName)}">${escapeHtml(r.productName)}</div>
            <div class="tally-sku">${code} · ${r.holdings} holding${r.holdings === 1 ? '' : 's'}</div>
        </td>
        ${inColumns().map((c) => numCell(r, c, 'in')).join('')}
        ${outColumns().map((c) => numCell(r, c, 'out')).join('')}
        ${reserveColumns().map((c) => numCell(r, c, 'rs')).join('')}
        <td class="l">${mismatchTag(r.mismatch)}</td>
    </tr>`;
}

function footerRow(rows) {
    const sum = (col) => rows.reduce((s, r) => s + colValue(r, col), 0);
    const cell = (col, tone) => {
        const n = sum(col);
        return `<td class="${n ? tone : 'z'}">${n ? formatQty(n) : '–'}</td>`;
    };
    return `<tr>
        <td class="l">Total</td>
        ${inColumns().map((c) => cell(c, 'in')).join('')}
        ${outColumns().map((c) => cell(c, 'out')).join('')}
        ${reserveColumns().map((c) => cell(c, 'rs')).join('')}
        <td></td>
    </tr>`;
}

function summaryCards(data) {
    const t = data.totals || {};
    const inn = totalInQty(t);
    const out = totalExits(t);
    const avail = availableQty(t);
    const mismatchCls = data.mismatchCount ? 'bad' : 'ok';
    return `<div class="tally-cards">
        <div class="tally-card"><span>Products</span><b>${data.productCount || 0}</b><em>${escapeHtml(TYPE_LABEL[state.type])}</em></div>
        <div class="tally-card in"><span>Total In</span><b>${formatQty(inn)}</b><em>RN ${formatQty(t.inReceipt)} · Intake ${formatQty(t.inIntake)} · DC Return ${formatQty(t.inDcReturn)} · Legacy ${formatQty(t.inOpening)}</em></div>
        <div class="tally-card out"><span>Total Out</span><b>${formatQty(out)}</b><em>DC Sale ${formatQty(t.dcSale)} · Vendor Rtn ${formatQty(t.vendorReturn)}</em></div>
        <div class="tally-card rs"><span>Reservation</span><b>${formatQty(t.outOnDc)}</b><em>Out on DC · Set ${formatQty(t.reservedForSet)} · Available ${formatQty(avail)}</em></div>
        <div class="tally-card ${mismatchCls}"><span>Mismatches</span><b>${data.mismatchCount || 0}</b><em>${data.mismatchCount ? `Net ${Number(t.mismatch) > 0 ? '+' : ''}${formatQty(t.mismatch)}` : 'Every count is backed by a document'}</em></div>
    </div>`;
}

function pagerHtml(total) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const from = total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
    const to = Math.min(state.page * PAGE_SIZE, total);
    return `<div class="tally-pager">
        <span>Showing ${from}–${to} of ${total}</span>
        <div class="tally-pager-btns">
            <button type="button" class="tally-page-btn" data-tally-page="prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${state.page} of ${pages}</span>
            <button type="button" class="tally-page-btn" data-tally-page="next" ${state.page >= pages ? 'disabled' : ''}>Next</button>
        </div>
    </div>`;
}

function bindTable(content, allRows) {
    content.querySelectorAll('.tally-row').forEach((tr) => {
        tr.addEventListener('click', () => openProductTally(tr.getAttribute('data-product')).catch((e) => toastOperatorError(e)));
    });
    content.querySelectorAll('[data-tally-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const pages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
            if (btn.getAttribute('data-tally-page') === 'prev') state.page = Math.max(1, state.page - 1);
            else state.page = Math.min(pages, state.page + 1);
            paintTally();
        });
    });
}

function paintTally() {
    const content = el('tallyContent');
    const data = state.data;
    if (!content || !data) return;
    const rows = data.rows || [];
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE) || 1);
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const colCount = 2 + inColumns().length + outColumns().length + reserveColumns().length;
    const empty = state.mismatchOnly
        ? 'No mismatches — every count is backed by a document.'
        : `No ${state.type === 'ALL' ? '' : `${TYPE_LABEL[state.type].toLowerCase()} `}holdings found.`;
    content.innerHTML = `
        ${summaryCards(data)}
        <div class="tally-box">
            <table class="tally-table">
                <thead>${headerRows()}</thead>
                <tbody>${pageRows.length
                    ? pageRows.map(productRow).join('')
                    : `<tr><td class="l z" colspan="${colCount}">${empty}</td></tr>`}
                </tbody>
                ${rows.length ? `<tfoot>${footerRow(rows)}</tfoot>` : ''}
            </table>
        </div>
        ${pagerHtml(rows.length)}
        <div class="tally-leg">
            <span><i class="tally-dot in"></i> Stock In</span>
            <span><i class="tally-dot out"></i> Stock Out</span>
            <span><i class="tally-dot rs"></i> Reservation · Available = On hand − Out on DC − Out (manual) − Reserved for Set</span>
            <span><i class="tally-dot bad"></i> Mismatch · On hand − (In − Out − Deleted)</span>
            <span>Click a product for holdings and documents.</span>
        </div>`;
    bindTable(content, rows);
}

async function renderTally() {
    const content = el('tallyContent');
    if (!content) return;
    syncModeButtons();
    const mismatchWrap = el('tallyMismatchOnly')?.closest('label');
    if (mismatchWrap) mismatchWrap.style.display = state.mode === 'period' ? 'none' : '';
    content.innerHTML = '<div class="lc-muted" style="padding:16px;">Loading tally…</div>';
    if (state.mode === 'period') {
        await renderPeriod();
        return;
    }
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.mismatchOnly) params.set('mismatchOnly', '1');
    if (typeParam()) params.set('type', typeParam());
    const data = await lifecycleApi(`/api/reports/tally${params.toString() ? `?${params}` : ''}`);
    state.data = data;
    state.page = 1;
    const badge = el('tallyGeneratedAt');
    if (badge) badge.textContent = `As of ${formatIstDateTime(data.generatedAt).replace(/&amp;/g, '&')}`;
    paintTally();
}

function docLinks(documents) {
    const items = [];
    (documents.receiptNotes || []).forEach((id) => items.push({ label: id, view: 'receipts-view' }));
    (documents.physicalIntakes || []).forEach((id) => items.push({ label: id, view: 'physical-intakes-view' }));
    const seenDc = new Set();
    const pushDc = (dc) => {
        const id = typeof dc === 'string' ? dc : dc.id;
        if (!id || seenDc.has(id)) return;
        seenDc.add(id);
        const label = typeof dc === 'string' ? dc : (dc.challanNo || dc.id);
        items.push({ label, open: id, view: 'history-view' });
    };
    (documents.deliveryChallans || []).forEach(pushDc);
    (documents.returnedDeliveryChallans || []).forEach(pushDc);
    (documents.vendorReturns || []).forEach((id) => items.push({ label: id, view: 'history-view' }));
    if (!items.length) return '<span style="color:#94a3b8;">—</span>';
    return items.map((d) => `<button type="button" class="tally-doc" data-view="${d.view}" data-open="${escapeHtml(d.open || d.label)}" style="border:1px solid #cbd5e1;background:#f8fafc;border-radius:4px;padding:1px 6px;margin:1px;font-size:11px;cursor:pointer;font-family:monospace;">${escapeHtml(d.label)}</button>`).join('');
}

const SOURCE_LABEL = {
    RECEIPT_NOTE: 'Receipt Note',
    PHYSICAL_INTAKE: 'Physical Intake',
    LEGACY: 'Legacy / opening',
    RESHAPED: 'Split / conversion',
    RECLASSIFIED: 'Reclassified from asset'
};

function challanNotes(list) {
    return (list || []).map((dc) => {
        if (typeof dc === 'string') return dc;
        const reason = String(dc.dispatchReason || '').toLowerCase().replace(/_/g, ' ');
        return [dc.challanNo, reason].filter(Boolean).join(' · ');
    }).filter(Boolean);
}

function holdingDcReason(h) {
    const lines = [];
    if (h.outOnDc) {
        const notes = challanNotes(h.documents && h.documents.deliveryChallans);
        lines.push(`Out on DC ${formatQty(h.outOnDc)}${notes.length ? ` · ${notes.join(', ')}` : ''}`);
    } else {
        const notes = challanNotes(h.documents && h.documents.returnedDeliveryChallans);
        if (notes.length) lines.push(`DC ${notes.join(', ')}`);
    }
    if (h.outManual) lines.push(`${formatQty(h.outManual)} out · manual status`);
    if (h.reservedForSet) {
        const sets = (h.documents && h.documents.reservedSets) || [];
        const notes = sets.map((s) => {
            if (typeof s === 'string') return s;
            return [s.name, s.setCode].filter(Boolean).join(' · ') || s.id;
        }).filter(Boolean);
        lines.push(`Reserved for Set ${formatQty(h.reservedForSet)}${notes.length ? ` · ${notes.join(', ')}` : ''}`);
    }
    return lines;
}

function holdingRow(h) {
    const exits = [];
    if (h.dcSale) exits.push(`DC Sale ${formatQty(h.dcSale)}`);
    if (h.dcOtherExit) exits.push(`DC Replacement / FOC ${formatQty(h.dcOtherExit)}`);
    if (h.retired) exits.push(`Retired ${formatQty(h.retired)}${h.retireReason ? ` (${escapeHtml(h.retireReason)})` : ''}`);
    if (h.vendorReturn) exits.push(`Vendor Rtn ${formatQty(h.vendorReturn)}`);
    if (h.consumed) exits.push(`Consumed ${formatQty(h.consumed)}`);
    if (h.otherExit) exits.push(`<span style="color:#b45309;">Other ${formatQty(h.otherExit)}</span>`);
    if (h.deleted) exits.push(`Deleted ${formatQty(h.deleted)}`);
    const inParts = [];
    if (h.inReceipt) inParts.push(`RN ${formatQty(h.inReceipt)}`);
    if (h.inIntake) inParts.push(`Intake ${formatQty(h.inIntake)}`);
    if (h.inDcReturn) inParts.push(`DC Return ${formatQty(h.inDcReturn)}`);
    if (h.inOpening) inParts.push(`Legacy ${formatQty(h.inOpening)}`);
    const reIn = Number(h.reclassifiedIn || 0);
    const reOut = Number(h.reclassifiedOut || 0);
    const convIn = Number(h.convertedIn || 0) - reIn;
    const convOut = Number(h.convertedOut || 0) - reOut;
    if (convIn) inParts.push(`<span style="color:#6d28d9;">Converted from Inventory ${formatQty(convIn)}</span>`);
    if (reIn) inParts.push(`<span style="color:#6d28d9;">Reclassified from Asset ${formatQty(reIn)}</span>`);
    if (convOut) exits.push(`<span style="color:#6d28d9;">Converted to Assets ${formatQty(convOut)}</span>`);
    if (reOut) exits.push(`<span style="color:#6d28d9;">Reclassified to Inventory ${formatQty(reOut)}</span>`);
    const adj = Number(h.manualAdjustments || 0);
    const reason = holdingDcReason(h);
    const reasonRow = reason.length
        ? `<tr class="tally-holding-reason" data-for="${escapeHtml(h.id)}" hidden>
            <td colspan="7" style="padding:2px 12px 8px 28px;font-size:11px;font-weight:700;color:#1d4ed8;background:#f8fafc;">${escapeHtml(reason.join(' · '))}</td>
        </tr>`
        : '';
    return `<tr class="tally-holding" data-holding="${escapeHtml(h.id)}" style="border-bottom:1px solid #f1f5f9;vertical-align:top;cursor:${reason.length ? 'pointer' : 'default'};${h.closed ? 'opacity:.6;' : ''}">
        <td style="padding:6px 8px;">
            <a href="/asset/${encodeURIComponent(h.id)}" target="_blank" rel="noopener" style="font-family:monospace;font-weight:600;">${escapeHtml(h.id)}</a>
            <div style="font-size:11px;color:#64748b;">${h.resourceType === 'ASSET' ? 'Asset' : 'Inventory'} · ${h.closed ? 'closed (reclassified), not a holding' : escapeHtml(h.status || '—')}${h.isDeleted ? ' · deleted' : ''}</div>
        </td>
        <td style="padding:6px 8px;font-size:11px;">${escapeHtml(SOURCE_LABEL[h.source] || h.source)}</td>
        <td style="padding:6px 8px;font-size:11px;">${inParts.join(' · ') || '<span style="color:#94a3b8;">—</span>'}</td>
        <td style="padding:6px 8px;font-size:11px;">${exits.join(' · ') || '<span style="color:#94a3b8;">—</span>'}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:700;">${formatQty(h.onHand)}</td>
        <td style="padding:6px 8px;text-align:right;${adj ? 'color:#b91c1c;font-weight:700;' : 'color:#94a3b8;'}">${adj ? `${adj > 0 ? '+' : ''}${formatQty(adj)}` : '—'}</td>
        <td style="padding:6px 8px;">${docLinks(h.documents || {})}</td>
    </tr>${reasonRow}`;
}

async function openProductTally(productKey) {
    const qs = typeParam() ? `?type=${typeParam()}` : '';
    const data = await lifecycleApi(`/api/reports/tally/${encodeURIComponent(productKey)}${qs}`);
    document.getElementById('aeTallyDetailModal')?.remove();
    const t = data.totals || {};
    const overlay = document.createElement('div');
    overlay.id = 'aeTallyDetailModal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '10040';
    const mismatch = Number(t.mismatch || 0);
    const explain = mismatch === 0
        ? '<span style="color:#15803d;font-weight:700;">Balanced — every unit is backed by a document.</span>'
        : `<span style="color:#b91c1c;font-weight:700;">Mismatch ${mismatch > 0 ? '+' : ''}${formatQty(mismatch)}.</span> Manual quantity adjustments on these holdings total ${formatQty(t.manualAdjustments)}. Holdings with a red adjustment figure explain the gap.`;
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:1100px;width:94vw;max-height:88vh;display:flex;flex-direction:column;">
            <span class="close-modal" data-tally-close>&times;</span>
            <h3 style="margin:0 0 2px;">${escapeHtml(data.productName)}</h3>
            <div style="font-size:12px;color:#64748b;margin-bottom:10px;">${escapeHtml(data.productId || 'Holdings without a Product')}${data.productCode ? ` · ${escapeHtml(data.productCode)}` : ''} · ${escapeHtml(TYPE_LABEL[state.type])}</div>
            <div style="font-size:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:10px;">
                In ${formatQty(Number(t.inReceipt) + Number(t.inIntake) + Number(t.inOpening))}
                ${netConverted(t) ? `${netConverted(t) > 0 ? '+' : '−'} Converted ${formatQty(Math.abs(netConverted(t)))}` : ''}
                − Out ${formatQty(totalExits(t))}
                − Deleted ${formatQty(t.deleted)} = Expected ${formatQty(t.expectedOnHand)} · On hand <strong>${formatQty(t.onHand)}</strong>. ${explain}
            </div>
            <div style="overflow:auto;flex:1;min-height:0;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr>
                        <th style="${HEAD_STYLE}text-align:left;">Holding</th>
                        <th style="${HEAD_STYLE}text-align:left;">Source</th>
                        <th style="${HEAD_STYLE}text-align:left;">In</th>
                        <th style="${HEAD_STYLE}text-align:left;">Out</th>
                        <th style="${HEAD_STYLE}">On hand</th>
                        <th style="${HEAD_STYLE}" title="Manual quantity ADJUST events (excludes Receipt Note reversals)">Manual adj.</th>
                        <th style="${HEAD_STYLE}text-align:left;">Documents</th>
                    </tr></thead>
                    <tbody>${(data.holdings || []).map(holdingRow).join('') || '<tr><td colspan="7" style="padding:14px;text-align:center;color:#64748b;">No holdings.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-tally-close]').forEach((n) => { n.onclick = close; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.tally-holding').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('a, .tally-doc')) return;
            const id = row.getAttribute('data-holding');
            const detail = overlay.querySelector(`.tally-holding-reason[data-for="${CSS.escape(id)}"]`);
            if (!detail) return;
            detail.hidden = !detail.hidden;
        });
    });
    overlay.querySelectorAll('.tally-doc').forEach((btn) => {
        btn.addEventListener('click', () => {
            close();
            go(btn.getAttribute('data-view'), { open: btn.getAttribute('data-open') });
        });
    });
}

function syncTypeButtons() {
    document.querySelectorAll('#tallyTypeFilter [data-tally-type]').forEach((btn) => {
        const active = btn.getAttribute('data-tally-type') === state.type;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.style.background = '';
        btn.style.color = '';
    });
}

function syncModeButtons() {
    document.querySelectorAll('#tallyViewMode [data-tally-mode]').forEach((btn) => {
        const active = btn.getAttribute('data-tally-mode') === state.mode;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function ledgerQty(n, { always } = {}) {
    const v = Number(n || 0);
    if (!always && v === 0) return '';
    return formatQty(v);
}

function voucherView(row) {
    const type = String(row.docType || '').toUpperCase();
    if (type === 'RECEIPT_NOTE') return { view: 'receipts-view', open: row.docId };
    if (type === 'PHYSICAL_INTAKE') return { view: 'physical-intakes-view', open: row.docId };
    if (type === 'DC' || type === 'VENDOR_RETURN') return { view: 'history-view', open: row.docId };
    if (type === 'RETIRE' || row.resourceId) return { view: row.resourceType === 'INVENTORY' ? 'inventory-view' : 'home-view', open: row.resourceId };
    return null;
}

function fyName(year) {
    const y = Number(year);
    if (!Number.isFinite(y)) return 'Financial years';
    return `FY ${y}–${String(y + 1).slice(-2)}`;
}

function periodPathLabel() {
    const parts = [];
    if (state.periodGrain === 'fy') return 'Financial years';
    if (state.fy) parts.push(fyName(state.fy));
    if (state.periodGrain === 'fq') parts.push('Quarters');
    if (state.periodGrain === 'month') parts.push('Months');
    if (state.month && (state.periodGrain === 'products' || state.periodGrain === 'vouchers')) {
        parts.push(state.periodTitle && state.month ? state.periodTitle : state.month);
    } else if (state.fq && !state.month && (state.periodGrain === 'products' || state.periodGrain === 'vouchers')) {
        parts.push(`Q${state.fq}`);
    }
    if (state.periodGrain === 'vouchers') {
        parts.push((state.periodData && state.periodData.productName) || 'Vouchers');
    }
    return parts.join(' / ');
}

function currentSiblings() {
    if (state.periodGrain === 'vouchers') return state.productSiblings || [];
    if (state.periodGrain === 'products') {
        return state.month ? (state.monthSiblings || []) : (state.fqSiblings || []);
    }
    if (state.periodGrain === 'month' || state.periodGrain === 'fq') return state.fySiblings || [];
    return [];
}

function currentSiblingIndex() {
    const list = currentSiblings();
    if (state.periodGrain === 'vouchers') {
        const id = String(state.productId || '');
        return list.findIndex((r) => String(r.productId || r.key) === id);
    }
    if (state.periodGrain === 'products' && state.month) {
        return list.findIndex((r) => r.month === state.month);
    }
    if (state.periodGrain === 'products' && state.fq) {
        return list.findIndex((r) => Number(r.fq) === Number(state.fq));
    }
    if (state.periodGrain === 'month' || state.periodGrain === 'fq') {
        return list.findIndex((r) => Number(r.fy) === Number(state.fy));
    }
    return -1;
}

function popLedger() {
    if (state.periodGrain === 'vouchers') {
        state.periodGrain = 'products';
        state.productId = null;
        return true;
    }
    if (state.periodGrain === 'products') {
        state.periodGrain = state.month || !state.fq ? 'month' : 'fq';
        state.productId = null;
        return true;
    }
    if (state.periodGrain === 'month' || state.periodGrain === 'fq') {
        state.periodGrain = 'fy';
        state.fy = null;
        state.fq = null;
        state.month = null;
        state.periodFrom = null;
        state.periodTo = null;
        state.productId = null;
        return true;
    }
    if (state.mode === 'period') {
        state.mode = 'lifetime';
        return true;
    }
    return false;
}

function applySibling(row) {
    if (!row) return;
    if (state.periodGrain === 'vouchers') {
        state.productId = row.productId || row.key;
        state.periodFrom = row.from || state.periodFrom;
        state.periodTo = row.to || state.periodTo;
        return;
    }
    if (state.periodGrain === 'products') {
        state.fy = Number(row.fy) || state.fy;
        state.fq = row.fq != null ? Number(row.fq) : state.fq;
        state.month = row.month || null;
        state.periodFrom = row.from;
        state.periodTo = row.to;
        state.periodTitle = row.particulars;
        return;
    }
    state.fy = Number(row.fy);
    state.fq = null;
    state.month = null;
    state.productId = null;
    state.periodTitle = row.particulars;
}

function moveSibling(dir) {
    const list = currentSiblings();
    const idx = currentSiblingIndex();
    const next = list[idx + dir];
    if (!next) return false;
    applySibling(next);
    return true;
}

function ledgerNavBar() {
    const list = currentSiblings();
    const idx = currentSiblingIndex();
    const atTop = state.periodGrain === 'fy';
    const prevOff = idx < 0 || idx <= 0;
    const nextOff = idx < 0 || idx >= list.length - 1 || !list.length;
    const siblingHint = state.periodGrain === 'vouchers'
        ? 'product'
        : (state.periodGrain === 'products' ? (state.month ? 'month' : 'quarter') : 'year');
    return `<div class="tally-pager tally-ledger-nav">
        <button type="button" class="tally-page-btn" data-ledger-back>${atTop ? '← Lifetime' : '← Back'}</button>
        <span class="tally-ledger-here">${escapeHtml(periodPathLabel())}</span>
        <div class="tally-pager-btns">
            <button type="button" class="tally-page-btn" data-ledger-sib="prev" ${prevOff ? 'disabled' : ''} aria-label="Previous ${siblingHint}">‹ Previous</button>
            <span>${list.length && idx >= 0 ? `${idx + 1} of ${list.length}` : ''}</span>
            <button type="button" class="tally-page-btn" data-ledger-sib="next" ${nextOff ? 'disabled' : ''} aria-label="Next ${siblingHint}">Next ›</button>
        </div>
    </div>`;
}

function ledgerHead() {
    return `<tr>
        <th class="l">Particulars</th>
        <th>Inwards</th>
        <th>Outwards</th>
        <th>Closing</th>
    </tr>`;
}

function ledgerRowHtml(r, { clickable } = {}) {
    const open = r.grain === 'opening';
    const cls = [clickable && !open ? 'tally-row' : '', open ? 'tally-open' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}" data-ledger-key="${escapeHtml(r.key || '')}" data-grain="${escapeHtml(r.grain || '')}" data-from="${escapeHtml(r.from || '')}" data-to="${escapeHtml(r.to || '')}" data-fy="${r.fy || ''}" data-fq="${r.fq || ''}" data-month="${escapeHtml(r.month || '')}" data-product="${escapeHtml(r.productId || r.key || '')}">
        <td class="l">
            <div class="tally-prod">${escapeHtml(r.particulars)}</div>
            ${r.sub ? `<div class="tally-sku">${escapeHtml(r.sub)}${r.inAsset || r.inInventory ? ` · Asset in ${formatQty(r.inAsset)} · Inventory in ${formatQty(r.inInventory)}` : ''}</div>` : ''}
        </td>
        <td class="${r.inwards ? 'in' : 'z'}">${ledgerQty(r.inwards)}</td>
        <td class="${r.outwards ? 'out' : 'z'}">${ledgerQty(r.outwards)}</td>
        <td>${ledgerQty(r.closing, { always: true })}</td>
    </tr>`;
}

function ledgerFooter(rows) {
    const skip = rows.filter((r) => r.grain !== 'opening');
    const inn = skip.reduce((s, r) => s + Number(r.inwards || 0), 0);
    const out = skip.reduce((s, r) => s + Number(r.outwards || 0), 0);
    const running = rows.some((r) => r.grain === 'opening' || r.grain === 'month' || r.grain === 'fq');
    const close = running
        ? Number((rows[rows.length - 1] || {}).closing || 0)
        : skip.reduce((s, r) => s + Number(r.closing || 0), 0);
    return `<tr>
        <td class="l">Grand Total</td>
        <td class="${inn ? 'in' : 'z'}">${ledgerQty(inn)}</td>
        <td class="${out ? 'out' : 'z'}">${ledgerQty(out)}</td>
        <td>${ledgerQty(close, { always: true })}</td>
    </tr>`;
}

function periodCards(data) {
    const t = data.totals || {};
    const rows = data.rows || [];
    const last = rows[rows.length - 1] || t;
    const inn = t.inwards != null ? t.inwards : rows.filter((r) => r.grain !== 'opening').reduce((s, r) => s + Number(r.inwards || 0), 0);
    const out = t.outwards != null ? t.outwards : rows.filter((r) => r.grain !== 'opening').reduce((s, r) => s + Number(r.outwards || 0), 0);
    return `<div class="tally-cards tally-cards-4">
        <div class="tally-card"><span>Opening</span><b>${formatQty(t.opening != null ? t.opening : (rows[0] && rows[0].grain === 'opening' ? rows[0].closing : 0))}</b><em>${escapeHtml(TYPE_LABEL[state.type])}</em></div>
        <div class="tally-card in"><span>Inwards</span><b>${formatQty(inn)}</b><em>Asset ${formatQty(t.inAsset)} · Inventory ${formatQty(t.inInventory)}</em></div>
        <div class="tally-card out"><span>Outwards</span><b>${formatQty(out)}</b><em>Asset ${formatQty(t.outAsset)} · Inventory ${formatQty(t.outInventory)}</em></div>
        <div class="tally-card"><span>Closing</span><b>${formatQty(t.closing != null ? t.closing : (last && last.closing) || 0)}</b><em>Still owned at period end</em></div>
    </div>`;
}

function paintPeriodLedger(data, { clickable, caption }) {
    const content = el('tallyContent');
    const rows = data.rows || [];
    const badge = el('tallyGeneratedAt');
    if (badge) badge.textContent = `${caption || 'Period ledger'} · ${TZ_HINT}`;
    const grainSwitch = (data.grain === 'month' || data.grain === 'fq')
        ? `<div id="tallyPeriodGrain" class="tally-mode" role="group" aria-label="Period grain">
                <button type="button" data-period-grain="month" aria-pressed="${data.grain === 'month' ? 'true' : 'false'}">Months</button>
                <button type="button" data-period-grain="fq" aria-pressed="${data.grain === 'fq' ? 'true' : 'false'}">Quarters</button>
           </div>`
        : '';
    content.innerHTML = `
        ${ledgerNavBar()}
        ${grainSwitch}
        ${periodCards(data)}
        <div class="tally-box">
            <table class="tally-table tally-ledger">
                <thead>${ledgerHead()}</thead>
                <tbody>${rows.map((r) => ledgerRowHtml(r, { clickable })).join('') || '<tr><td class="l z" colspan="4">No movements in this period.</td></tr>'}</tbody>
                ${rows.length ? `<tfoot>${ledgerFooter(rows)}</tfoot>` : ''}
            </table>
        </div>
        <div class="tally-leg">
            <span>Quantity ledger over Receipt Notes, Physical Intake, DC exits, Retire, Vendor Return, Consume and adjustments. Returnable DCs stay owned and do not change closing.</span>
            <span>Indian FY 1 Apr – 31 Mar · Asia/Kolkata. Same documents as Lifetime Tally — not a second stock figure.</span>
        </div>`;
    bindPeriodNav(content);
}

function paintVoucherLedger(data) {
    const content = el('tallyContent');
    const badge = el('tallyGeneratedAt');
    if (badge) badge.textContent = `${data.productName || 'Vouchers'} · Asia/Kolkata`;
    const openRow = {
        eventTs: data.from,
        particulars: 'Opening Balance',
        vchType: '',
        vchNo: '',
        inwards: 0,
        outwards: 0,
        closing: data.opening,
        opening: true
    };
    const lines = [openRow, ...(data.vouchers || [])];
    content.innerHTML = `
        ${ledgerNavBar()}
        ${periodCards({ totals: data.totals, rows: [] })}
        <div class="tally-box">
            <table class="tally-table tally-ledger">
                <thead>
                    <tr>
                        <th class="l">Date</th>
                        <th class="l">Particulars</th>
                        <th class="l">Vch Type</th>
                        <th class="l">Vch No</th>
                        <th>Inwards</th>
                        <th>Outwards</th>
                        <th>Closing</th>
                    </tr>
                </thead>
                <tbody>${lines.map((r) => {
                    return `<tr class="${r.opening ? 'tally-open' : ''} ${r.affectsClose === false ? 'tally-info' : ''}">
                        <td class="l">${r.opening ? '' : escapeHtml(String(formatIstDateTime(r.eventTs) || '').split(',')[0] || '')}</td>
                        <td class="l">
                            <div class="tally-prod">${escapeHtml(r.particulars || '—')}</div>
                            ${r.kind ? `<div class="tally-sku">${escapeHtml(r.kind)}${r.resourceId ? ` · ${escapeHtml(r.resourceId)}` : ''}${r.affectsClose === false ? ' · still owned' : ''}</div>` : ''}
                        </td>
                        <td class="l">${escapeHtml(r.vchType || '')}</td>
                        <td class="l">${r.opening || !r.vchNo ? escapeHtml(r.vchNo || '') : `<button type="button" class="tally-doc" data-open-doc data-doc-type="${escapeHtml(r.docType || '')}" data-doc-id="${escapeHtml(r.docId || '')}" data-resource="${escapeHtml(r.resourceId || '')}" data-resource-type="${escapeHtml(r.resourceType || '')}">${escapeHtml(r.vchNo)}</button>`}</td>
                        <td class="${r.inwards ? 'in' : 'z'}">${r.opening ? '' : ledgerQty(r.inwards)}</td>
                        <td class="${r.outwards ? 'out' : 'z'}">${r.opening ? '' : ledgerQty(r.outwards)}</td>
                        <td>${ledgerQty(r.closing, { always: true })}</td>
                    </tr>`;
                }).join('')}</tbody>
                <tfoot>
                    <tr>
                        <td class="l" colspan="4">Totals</td>
                        <td class="in">${ledgerQty(data.totals && data.totals.inwards)}</td>
                        <td class="out">${ledgerQty(data.totals && data.totals.outwards)}</td>
                        <td>${ledgerQty(data.totals && data.totals.closing, { always: true })}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <div class="tally-leg">
            <span>Use Back or Previous / Next to stay in this ledger. Open a voucher from its document number if you need the source document.</span>
        </div>`;
    bindPeriodNav(content);
    content.querySelectorAll('[data-open-doc]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dest = voucherView({
                docType: btn.getAttribute('data-doc-type'),
                docId: btn.getAttribute('data-doc-id'),
                resourceId: btn.getAttribute('data-resource'),
                resourceType: btn.getAttribute('data-resource-type')
            });
            if (dest) go(dest.view, { open: dest.open });
        });
    });
}

const TZ_HINT = 'Asia/Kolkata';

function bindPeriodNav(content) {
    content.querySelectorAll('[data-ledger-back]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!popLedger()) return;
            renderTally().catch((err) => toastOperatorError(err));
        });
    });
    content.querySelectorAll('[data-ledger-sib]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const dir = btn.getAttribute('data-ledger-sib') === 'prev' ? -1 : 1;
            if (!moveSibling(dir)) return;
            renderTally().catch((err) => toastOperatorError(err));
        });
    });
    content.querySelectorAll('[data-ledger-nav]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const grain = btn.getAttribute('data-ledger-nav');
            if (grain === 'fy') {
                state.periodGrain = 'fy';
                state.fy = null;
                state.fq = null;
                state.month = null;
                state.productId = null;
            } else if (grain === 'month') {
                state.periodGrain = 'month';
                state.fy = Number(btn.getAttribute('data-fy')) || state.fy;
                state.fq = null;
                state.month = null;
                state.productId = null;
            } else if (grain === 'products') {
                state.periodGrain = 'products';
                state.periodFrom = btn.getAttribute('data-from') || state.periodFrom;
                state.periodTo = btn.getAttribute('data-to') || state.periodTo;
                state.productId = null;
            }
            renderTally().catch((err) => toastOperatorError(err));
        });
    });
    content.querySelectorAll('[data-period-grain]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = btn.getAttribute('data-period-grain');
            if (!next || next === state.periodGrain) return;
            state.periodGrain = next;
            state.productId = null;
            renderTally().catch((err) => toastOperatorError(err));
        });
    });
    content.querySelectorAll('tr[data-grain]').forEach((tr) => {
        tr.addEventListener('click', () => {
            const grain = tr.getAttribute('data-grain');
            if (grain === 'opening') return;
            if (grain === 'fy') {
                state.fy = Number(tr.getAttribute('data-fy'));
                state.periodGrain = 'month';
                state.periodTitle = tr.querySelector('.tally-prod')?.textContent || '';
            } else if (grain === 'fq') {
                state.fy = Number(tr.getAttribute('data-fy')) || state.fy;
                state.fq = Number(tr.getAttribute('data-fq'));
                state.month = null;
                state.periodFrom = tr.getAttribute('data-from');
                state.periodTo = tr.getAttribute('data-to');
                state.periodTitle = tr.querySelector('.tally-prod')?.textContent || `Q${state.fq}`;
                state.periodGrain = 'products';
            } else if (grain === 'month') {
                state.fy = Number(tr.getAttribute('data-fy')) || state.fy;
                state.fq = Number(tr.getAttribute('data-fq')) || state.fq;
                state.month = tr.getAttribute('data-month');
                state.periodFrom = tr.getAttribute('data-from');
                state.periodTo = tr.getAttribute('data-to');
                state.periodTitle = tr.querySelector('.tally-prod')?.textContent || state.month;
                state.periodGrain = 'products';
            } else if (grain === 'product') {
                state.productId = tr.getAttribute('data-product');
                state.periodFrom = tr.getAttribute('data-from') || state.periodFrom;
                state.periodTo = tr.getAttribute('data-to') || state.periodTo;
                state.periodGrain = 'vouchers';
            }
            renderTally().catch((err) => toastOperatorError(err));
        });
    });
}

async function renderPeriod() {
    const typeQs = typeParam() ? `&type=${typeParam()}` : '';
    const badge = el('tallyGeneratedAt');
    if (state.periodGrain === 'fy') {
        const data = await lifecycleApi(`/api/reports/tally/period?grain=fy${typeQs}`);
        state.periodData = data;
        state.fySiblings = (data.rows || []).filter((r) => r.grain === 'fy');
        paintPeriodLedger(data, { clickable: true, caption: 'Financial year ledger' });
        return;
    }
    if (state.periodGrain === 'fq') {
        const data = await lifecycleApi(`/api/reports/tally/period?grain=fq&fy=${state.fy}${typeQs}`);
        state.periodData = data;
        state.periodTitle = data.label;
        state.fqSiblings = (data.rows || []).filter((r) => r.grain === 'fq');
        paintPeriodLedger(data, { clickable: true, caption: data.label });
        return;
    }
    if (state.periodGrain === 'month') {
        const data = await lifecycleApi(`/api/reports/tally/period?grain=month&fy=${state.fy}${typeQs}`);
        state.periodData = data;
        state.periodTitle = data.label;
        state.monthSiblings = (data.rows || []).filter((r) => r.grain === 'month');
        paintPeriodLedger(data, { clickable: true, caption: `${data.label} · monthly` });
        return;
    }
    if (state.periodGrain === 'products') {
        const params = new URLSearchParams({ from: state.periodFrom, to: state.periodTo });
        if (typeParam()) params.set('type', typeParam());
        if (state.q) params.set('q', state.q);
        const data = await lifecycleApi(`/api/reports/tally/period/products?${params.toString()}`);
        state.periodData = data;
        state.productSiblings = data.rows || [];
        paintPeriodLedger(data, { clickable: true, caption: state.periodTitle || 'Product ledger' });
        return;
    }
    if (state.periodGrain === 'vouchers') {
        const params = new URLSearchParams({
            productId: state.productId,
            from: state.periodFrom,
            to: state.periodTo
        });
        if (typeParam()) params.set('type', typeParam());
        const data = await lifecycleApi(`/api/reports/tally/period/vouchers?${params.toString()}`);
        state.periodData = data;
        paintVoucherLedger(data);
        return;
    }
    if (badge) badge.textContent = '';
}

let bound = false;
export function initTallyView() {
    if (!bound) {
        bound = true;
        el('btnReloadTally')?.addEventListener('click', () => renderTally().catch((e) => toastOperatorError(e)));
        el('tallyMismatchOnly')?.addEventListener('change', (e) => {
            state.mismatchOnly = !!e.target.checked;
            renderTally().catch((err) => toastOperatorError(err));
        });
        document.querySelectorAll('#tallyTypeFilter [data-tally-type]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-tally-type') || 'ALL';
                if (next === state.type) return;
                state.type = next;
                syncTypeButtons();
                renderTally().catch((err) => toastOperatorError(err));
            });
        });
        document.querySelectorAll('#tallyViewMode [data-tally-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-tally-mode') || 'lifetime';
                if (next === state.mode) return;
                state.mode = next;
                if (next === 'period') {
                    state.periodGrain = 'fy';
                    state.fy = null;
                    state.fq = null;
                    state.month = null;
                    state.productId = null;
                }
                syncModeButtons();
                renderTally().catch((err) => toastOperatorError(err));
            });
        });
        el('tallySearch')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            state.q = String(e.target.value || '').trim();
            renderTally().catch((err) => toastOperatorError(err));
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (state.mode !== 'period') return;
            if (document.getElementById('aeTallyDetailModal')) return;
            const view = el('tally-view');
            if (!view || view.classList.contains('hidden')) return;
            e.preventDefault();
            if (!popLedger()) return;
            renderTally().catch((err) => toastOperatorError(err));
        });
    }
    syncTypeButtons();
    syncModeButtons();
    const pending = consumeOpen('tally-view');
    renderTally()
        .then(() => {
            if (pending && pending.open && state.mode === 'lifetime') return openProductTally(pending.open);
            return null;
        })
        .catch((err) => toastOperatorError(err));
}

window.initTallyView = initTallyView;
