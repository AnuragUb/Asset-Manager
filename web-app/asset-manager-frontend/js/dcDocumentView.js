/**
 * Delivery Challan document view — presentation only.
 *
 * Separates:
 *   DOCUMENT DATA  (payloadjson snapshot + header fields)
 *   DOCUMENT MODEL (buildDcDocumentModel)
 *   DOCUMENT TEMPLATE (templates/documents/dc/delivery-challan.html)
 *   DOCUMENT RENDER (renderDcDocumentHtml → #printableDC)
 *
 * Does not call Zoho. Does not change DC lifecycle or legal numbering.
 * See docs/DC_DOCUMENT_DESIGN.md.
 */

const DC_TEMPLATE_URL = '/templates/documents/dc/delivery-challan.html?v=2.2';
const DC_ASSET_BASE = '/templates/documents/dc/assets';
const DC_DISCLAIMER = 'This is a computer-generated document and does not require physical signature.';
const DC_REASON_LABELS = {
    DEMO: 'Demo (returnable)',
    RENTAL: 'Rental (returnable)',
    REPAIR: 'Repair (returnable)',
    INTERNAL_USE: 'Internal Use (returnable)',
    STOCK_TRANSFER: 'Stock Transfer',
    SALE: 'Sale',
    REPLACEMENT: 'Replacement / Warranty swap',
    FOC: 'Free of Cost / Sample',
    VENDOR_RETURN: 'Return to Vendor',
    LEGACY_UNSPECIFIED: 'Not specified (legacy)'
};

/** Built-in codes use the fixed labels; custom catalog reasons use the label stored on the DC. */
function dcReasonLabel(raw, storedLabel) {
    const key = dcTrim(raw).toUpperCase();
    if (DC_REASON_LABELS[key]) return DC_REASON_LABELS[key];
    if (dcTrim(storedLabel)) return dcTrim(storedLabel);
    return dcTrim(raw).replace(/_/g, ' ');
}

let cachedDcTemplateHtml = null;

function dcEscapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function dcTrim(value) {
    const text = String(value == null ? '' : value).trim();
    return text || '';
}

function dcDash(value) {
    const text = dcTrim(value);
    return text || '—';
}

function dcToNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function dcRound2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dcFormatAmountWords(amount) {
    if (typeof window.formatAmountWords === 'function') {
        return window.formatAmountWords(amount);
    }
    return String(amount);
}

function dcGetByPath(obj, path) {
    if (!path) return obj;
    if (path === 'this') {
        return obj && Object.prototype.hasOwnProperty.call(obj, 'this') ? obj.this : obj;
    }
    const parts = String(path).split('.');
    let cur = obj;
    for (const part of parts) {
        if (cur == null) return undefined;
        if (part === 'this') {
            cur = Object.prototype.hasOwnProperty.call(cur, 'this') ? cur.this : cur;
            continue;
        }
        cur = cur[part];
    }
    return cur;
}

/**
 * Minimal Mustache-like filler: {{path}}, {{#if path}}…{{/if}}, {{#each path}}…{{/each}}
 * Supports nested blocks. Does not evaluate expressions.
 */
function fillDcTemplate(template, data) {
    const findBlock = (src, openRe) => {
        const open = src.match(openRe);
        if (!open) return null;
        const kind = open[1];
        const path = open[2];
        const start = open.index;
        const openEnd = start + open[0].length;
        const openTag = `{{#${kind}`;
        const closeTag = `{{/${kind}}}`;
        let depth = 1;
        let i = openEnd;
        while (i < src.length && depth > 0) {
            const nextOpen = src.indexOf(openTag, i);
            const nextClose = src.indexOf(closeTag, i);
            if (nextClose < 0) return null;
            if (nextOpen >= 0 && nextOpen < nextClose) {
                depth += 1;
                i = nextOpen + openTag.length;
            } else {
                depth -= 1;
                if (depth === 0) {
                    return {
                        kind,
                        path,
                        start,
                        openEnd,
                        closeStart: nextClose,
                        closeEnd: nextClose + closeTag.length,
                        inner: src.slice(openEnd, nextClose)
                    };
                }
                i = nextClose + closeTag.length;
            }
        }
        return null;
    };

    const render = (tpl, ctx) => {
        let out = String(tpl || '');
        let guard = 0;
        while (guard < 200) {
            guard += 1;
            const block = findBlock(out, /\{\{#(each|if)\s+([\w.]+)\}\}/);
            if (!block) break;
            let replacement = '';
            if (block.kind === 'each') {
                const list = dcGetByPath(ctx, block.path);
                if (Array.isArray(list) && list.length) {
                    replacement = list.map((item, index) => {
                        const rowCtx = (item && typeof item === 'object')
                            ? { ...ctx, ...item, this: item, index, n: item.n != null ? item.n : index + 1 }
                            : { ...ctx, this: item, index, n: index + 1 };
                        return render(block.inner, rowCtx);
                    }).join('');
                }
            } else {
                const value = dcGetByPath(ctx, block.path);
                const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
                if (truthy) replacement = render(block.inner, ctx);
            }
            out = out.slice(0, block.start) + replacement + out.slice(block.closeEnd);
        }

        out = out.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, path) => {
            const value = dcGetByPath(ctx, path);
            return value == null ? '' : String(value);
        });

        out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
            const value = dcGetByPath(ctx, path);
            if (value == null) return '';
            return dcEscapeHtml(value);
        });

        return out;
    };

    return render(template, data);
}

async function loadDcTemplateHtml() {
    if (cachedDcTemplateHtml) return cachedDcTemplateHtml;
    const res = await fetch(DC_TEMPLATE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`DC template missing (${res.status})`);
    cachedDcTemplateHtml = await res.text();
    return cachedDcTemplateHtml;
}

function parsePayload(result) {
    const dcData = result.dc || result;
    let payload = result.payload;
    if (!payload || typeof payload !== 'object') {
        const raw = dcData.PayloadJSON || dcData.payloadjson || dcData.payloadJSON;
        if (typeof raw === 'string' && raw.trim()) {
            try { payload = JSON.parse(raw); } catch (_err) { payload = {}; }
        } else if (raw && typeof raw === 'object') {
            payload = raw;
        } else {
            payload = {};
        }
    }
    return { dcData, payload };
}

function stateLine(entity) {
    const name = dcTrim(entity && entity.stateName);
    const code = dcTrim(entity && entity.stateCode);
    return [name, code].filter(Boolean).join(' / ');
}

/**
 * Build print view-model from stored DC snapshot + header fields.
 * Presentation mapping only — no create/status/legal-number logic.
 */
export function buildDcDocumentModel(result, options = {}) {
    const { dcData, payload } = parsePayload(result);
    const company = payload.company || {};
    const account = payload.account || {};
    const consignee = payload.consignee || {};
    const buyer = payload.buyer || {};
    const meta = payload.meta || {};
    const itemsRaw = Array.isArray(payload.items) ? payload.items : [];

    const showRateAmount = meta.showRateAmount ?? options.showRateAmount ?? false;
    const showTotalPrice = meta.showTotalPrice ?? options.showTotalPrice ?? false;
    const showDescription = meta.showDescription ?? options.showDescription ?? true;
    const showSerial = meta.showSerial ?? options.showSerial ?? true;
    const showSerialInDescription = meta.showSerialInDescription ?? options.showSerialInDescription ?? false;

    const lineSerial = (row) => dcTrim(row && (row.srNo || row.serialNo || row.SrNo));
    const serialNote = (rows) => rows.map((row) => {
        const sn = lineSerial(row);
        if (!sn) return '';
        const label = dcTrim(row.description) || dcTrim(row.assetId);
        return label ? `${label} — S/N: ${sn}` : `S/N: ${sn}`;
    }).filter(Boolean).join('\n');

    const logoUrl = dcTrim(meta.logoUrl) || dcTrim(company.logoUrl);
    const companyName = dcTrim(company.name) || 'DELIVERY CHALLAN';

    const customerName = dcTrim(account.accountName) || dcTrim(meta.customerName) || dcTrim(dcData.customerName) || dcTrim(dcData.CustomerName);
    const consigneeName = dcTrim(consignee.name) || customerName;
    const buyerName = dcTrim(buyer.name);
    const kindAttn = (() => {
        if (customerName && consigneeName && customerName !== consigneeName) return customerName;
        if (buyerName && buyerName !== consigneeName) return buyerName;
        return '';
    })();

    // SET_COMMERCIAL_DEFINITION_ADR §5: a kit prints as ONE line (Set name, Set description,
    // qty = kits). Its component lines stay in the payload for dispatch / tally, not on paper.
    const items = [];
    const seenSetGroups = new Set();
    let lineNo = 0;
    itemsRaw.forEach((it) => {
        const setGroup = dcTrim(it.setGroup);
        if (setGroup) {
            if (seenSetGroups.has(setGroup)) return;
            seenSetGroups.add(setGroup);
            const group = itemsRaw.filter((row) => dcTrim(row.setGroup) === setGroup);
            const amounts = group.map((row) => dcToNumber(row.amount)).filter((n) => n !== null);
            const kits = Number(it.setKits) > 0 ? Number(it.setKits) : 1;
            const kitAmount = amounts.length ? dcRound2(amounts.reduce((a, b) => a + b, 0)) : null;
            const setSerials = group.map(lineSerial).filter(Boolean);
            const name = dcTrim(it.setName) || dcTrim(it.setId) || 'Set';
            const descLines = dcTrim(it.setDescription).split(/\n+/)
                .map((l) => l.trim()
                    .replace(/(\d+)\.0+(?=\D|$)/g, '$1')
                    .replace(/(\d+\.\d*?[1-9])0+(?=\D|$)/g, '$1'))
                .filter(Boolean);
            if (descLines.length && descLines[0].toUpperCase() === name.toUpperCase()) descLines.shift();
            lineNo += 1;
            items.push({
                isSetHeader: false,
                isLine: true,
                inSet: false,
                n: lineNo,
                description: name,
                setDescription: showDescription ? descLines.join('\n') : '',
                serialInDescription: showSerialInDescription ? serialNote(group) : '',
                make: dcTrim(it.setMake) || '—',
                model: dcTrim(it.setModel) || '—',
                assetId: dcTrim(it.setProductId) || '—',
                serialNo: showSerial ? (setSerials.join(', ') || '—') : '—',
                hsn: dcTrim(it.setHsn) || '—',
                qty: String(kits),
                unit: 'SET',
                rate: kitAmount === null ? '—' : String(dcRound2(kitAmount / kits)),
                amount: kitAmount === null ? '—' : String(kitAmount),
                showRateAmount: Boolean(showRateAmount)
            });
            return;
        }
        const make = dcTrim(it.make) || dcTrim(it.Make);
        const model = dcTrim(it.model) || dcTrim(it.Model);
        const serial = lineSerial(it);
        lineNo += 1;
        items.push({
            isSetHeader: false,
            isLine: true,
            inSet: false,
            n: lineNo,
            description: dcTrim(it.description) || '—',
            setDescription: '',
            serialInDescription: showSerialInDescription && serial ? `S/N: ${serial}` : '',
            make: make || '—',
            model: model || '—',
            assetId: dcTrim(it.assetId) || '—',
            serialNo: showSerial ? (serial || '—') : '—',
            hsn: dcTrim(it.hsn) || '—',
            qty: it.qty == null || it.qty === '' ? '—' : String(it.qty),
            unit: dcTrim(it.per || it.unit) || 'NO',
            rate: it.rate == null || it.rate === '' ? '—' : String(it.rate),
            amount: it.amount == null || it.amount === '' ? '—' : String(it.amount),
            showRateAmount: Boolean(showRateAmount)
        });
    });

    const totalAmount = itemsRaw.reduce((acc, it) => {
        const n = dcToNumber(it.amount);
        return acc + (n === null ? 0 : n);
    }, 0);
    const totalDisplay = String(dcRound2(totalAmount));

    const pickup = dcTrim(meta.pickup);
    const destination = dcTrim(meta.destination);
    const placeOfSupply = dcTrim(meta.placeOfSupply);
    const dispatchDocNo = dcTrim(meta.dispatchDocNo);
    const dispatchedThrough = dcTrim(meta.dispatchedThrough);
    const otherReferences = dcTrim(meta.otherReferences);
    const referenceNo = dcTrim(meta.referenceNo);
    const buyerOrderNo = dcTrim(meta.buyerOrderNo);
    const termsOfDelivery = dcTrim(meta.termsOfDelivery);
    const remarksText = dcTrim(meta.remarks);

    // Remarks only — Terms of Delivery belong under References (same as the DC form).
    const noteLines = String(remarksText || '')
        .split(/\n+/)
        .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
        .filter(Boolean)
        .map((text) => ({ text }));

    const gstin = dcTrim(company.gstin);
    const cin = dcTrim(company.cin);
    const pan = dcTrim(company.pan);
    const companyState = stateLine(company);
    const contactParts = [];
    if (gstin) contactParts.push(`GSTIN ${gstin}`);
    if (cin) contactParts.push(`CIN ${cin}`);
    if (pan) contactParts.push(`PAN ${pan}`);
    if (companyState) contactParts.push(companyState);
    const contactLine = contactParts.join('  ·  ');

    const footerAddress = dcTrim(company.address)
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        || companyName;
    const website = dcTrim(company.website || meta.website || company.web || company.url);
    const footerWeb = website || companyName;

    // Letterhead artwork bakes in Cineom contacts/address, so only use it for Cineom templates.
    const useLetterhead = /cineom/i.test(companyName);
    const letterheadHeader = useLetterhead ? `${DC_ASSET_BASE}/cineom-header.png` : '';
    const letterheadFooter = useLetterhead ? `${DC_ASSET_BASE}/cineom-footer.png` : '';

    const colCount = (showSerial ? 9 : 8) + (showRateAmount ? 2 : 0);
    const orderDate = dcTrim(meta.orderDate || meta.referenceDate);

    return {
        document: {
            title: 'DELIVERY CHALLAN',
            legalNumber: dcDash(dcData.challanNo || dcData.ChallanNo),
            date: dcDash(meta.deliveryDate || meta.dated || dcData.deliveryDate || dcData.DeliveryDate),
            orderDate,
            status: dcDash(dcData.lifecycleStatus || dcData.lifecycle_status || dcData.status || dcData.Status || 'DRAFT'),
            dispatchReason: dcDash(dcReasonLabel(dcData.dispatchReason || dcData.dispatch_reason || meta.dispatchReason, result?.dispatchReasonLabel || meta.dispatchReasonLabel)),
            transferDestination: dcTrim(dcData.transferDestination || dcData.transfer_destination || meta.transferDestination),
            createdBy: dcTrim(dcData.createdBy || dcData.CreatedBy),
            referenceNo: dcDash(referenceNo),
            buyerOrderNo,
            copyLabel: 'Original for Consignee',
            qrCode: dcTrim(dcData.qrCode || dcData.QRCode),
            disclaimer: DC_DISCLAIMER
        },
        showRateAmount: Boolean(showRateAmount),
        showSerial: Boolean(showSerial),
        company: {
            name: companyName,
            address: dcTrim(company.address),
            gstin,
            cin,
            pan,
            stateLine: companyState,
            logoUrl: useLetterhead ? '' : logoUrl,
            showFallback: !useLetterhead && !logoUrl,
            contactLine,
            footerAddress,
            footerWeb,
            letterheadHeader,
            letterheadFooter,
            cssHeader: !useLetterhead,
            cssFooter: !useLetterhead
        },
        customer: {
            name: dcDash(customerName),
            zohoAccountId: dcTrim(account.zohoAccountId)
        },
        consignee: {
            name: dcDash(consigneeName),
            address: dcTrim(consignee.address),
            gstin: dcTrim(consignee.gstin),
            stateLine: stateLine(consignee),
            kindAttn
        },
        buyer: {
            name: dcDash(buyerName),
            address: dcTrim(buyer.address),
            gstin: dcTrim(buyer.gstin),
            stateLine: stateLine(buyer)
        },
        logistics: {
            hasAny: Boolean(pickup || destination || placeOfSupply || dispatchedThrough),
            pickup,
            destination,
            placeOfSupply,
            dispatchedThrough
        },
        references: {
            hasAny: Boolean(referenceNo || buyerOrderNo || dispatchDocNo || otherReferences || termsOfDelivery),
            referenceNo,
            buyerOrderNo,
            dispatchDocNo,
            otherReferences,
            termsOfDelivery
        },
        items,
        itemsEmpty: items.length === 0,
        colCount,
        commercial: {
            showRateAmount: Boolean(showRateAmount),
            showTotalPrice: Boolean(showTotalPrice),
            amountWords: dcFormatAmountWords(dcRound2(totalAmount)),
            subtotal: totalDisplay,
            grandTotal: totalDisplay
        },
        notes: {
            hasAny: noteLines.length > 0,
            lines: noteLines
        }
    };
}

export async function renderDcDocumentHtml(result, options = {}) {
    const model = buildDcDocumentModel(result, options);
    const template = await loadDcTemplateHtml();
    return fillDcTemplate(template, model);
}

export async function showDcDocumentPreview(result, options = {}) {
    const modal = document.getElementById('dcPreviewModal');
    const printable = document.getElementById('printableDC');
    if (!modal || !printable) {
        console.error('[DC Preview] Modal or printable container not found');
        return;
    }
    try {
        const docHtml = await renderDcDocumentHtml(result, options);
        const returnHtml = renderDcReturnHistoryHtml(result);
        printable.innerHTML = docHtml + returnHtml;
        modal.style.display = 'flex';
    } catch (err) {
        console.error('[DC Preview] Template render failed', err);
        printable.innerHTML = `<div style="padding:24px;color:#991b1b;">Delivery Challan template could not load. ${dcEscapeHtml(err.message || err)}</div>`;
        modal.style.display = 'flex';
    }
}

function renderDcReturnHistoryHtml(result) {
    const position = result?.returnPosition || null;
    const logs = Array.isArray(result?.returnLogs) ? result.returnLogs : [];
    if (!position && !logs.length) return '';

    const pos = position || {};
    const label = String(pos.position || 'NO_RETURN').replace(/_/g, ' ');
    const assetsLine = pos.dispatchedAssets != null
        ? `${pos.returnedAssets || 0} / ${pos.dispatchedAssets || 0} Assets Returned · ${pos.stillOutAssets || 0} Still Out`
        : '';
    const qtyLine = pos.dispatchedQuantity != null
        ? `Qty returned ${pos.returnedQuantity || 0} / ${pos.dispatchedQuantity || 0} · outstanding ${pos.outstandingQuantity || 0}`
        : '';

    const entries = logs.map((log) => {
        const date = log.returnDate ? String(log.returnDate).slice(0, 10) : '—';
        const lineSummary = (log.lines || []).map((l) =>
            `${l.resourceType} ${l.resourceId}${l.quantity != null && l.resourceType === 'INVENTORY' ? ` ×${l.quantity}` : ''}`
        ).join(', ') || '—';
        return `<div class="dc-return-entry" style="border-top:1px solid #e2e8f0;padding:12px 0;">
            <div style="font-weight:700;font-family:ui-monospace,monospace;">${dcEscapeHtml(log.id)}</div>
            <div style="color:#64748b;font-size:13px;">${dcEscapeHtml(date)}</div>
            <div style="margin-top:6px;">${dcEscapeHtml(lineSummary)}</div>
            <div style="margin-top:4px;font-size:13px;">Reason: <strong>${dcEscapeHtml(log.returnReason || '—')}</strong></div>
            <div style="font-size:13px;">Returned By: ${dcEscapeHtml(log.returnedByParty || '—')}</div>
            <div style="font-size:13px;">Received By: ${dcEscapeHtml(log.receivedByUser || '—')}</div>
            <div style="font-size:13px;">Receipt Note: <span class="lc-mono">${dcEscapeHtml(log.receiptNoteId || '—')}</span> · ${dcEscapeHtml(log.status || '')}</div>
        </div>`;
    }).join('');

    return `<div class="no-print dc-return-history" style="margin-top:24px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <h3 style="margin:0 0 12px;font-size:16px;letter-spacing:0.04em;">RETURN HISTORY</h3>
        <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#64748b;text-transform:uppercase;font-weight:700;">Return Position</div>
            <div style="font-size:15px;font-weight:700;margin-top:4px;">${dcEscapeHtml(label)}</div>
            ${assetsLine ? `<div style="margin-top:4px;">${dcEscapeHtml(assetsLine)}</div>` : ''}
            ${qtyLine ? `<div style="color:#64748b;font-size:13px;">${dcEscapeHtml(qtyLine)}</div>` : ''}
        </div>
        ${entries || '<p style="color:#64748b;margin:0;">No return logs yet.</p>'}
    </div>`;
}

if (typeof window !== 'undefined') {
    window.buildDcDocumentModel = buildDcDocumentModel;
    window.renderDcDocumentHtml = renderDcDocumentHtml;
    window.showDcDocumentPreview = showDcDocumentPreview;
}
