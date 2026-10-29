import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.60';
import { toastOperatorError } from './lifecycle.js?v=7.28';

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function canMutate() {
    if (typeof window !== 'undefined' && typeof window.hasPermission === 'function') {
        return window.hasPermission('asset.convert');
    }
    return false;
}

function qty(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function newIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const response = await fetchWithAuth(path, Object.assign({}, options, { headers, credentials: 'same-origin' }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.status = response.status;
        err.reasonCode = data.reasonCode;
        err.details = data.details;
        throw err;
    }
    return data;
}

async function productName(productId) {
    if (!productId) return null;
    try {
        const data = await api(`/api/products/${encodeURIComponent(productId)}`, { method: 'GET', headers: {} });
        return (data.product && data.product.name) || productId;
    } catch (err) {
        return productId;
    }
}

function ensureModal() {
    let modal = document.getElementById('conversionConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'conversionConfirmModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:560px;width:92%;max-height:90vh;overflow:auto;">
            <span class="close-modal" id="closeConversionConfirmModal">&times;</span>
            <div id="conversionConfirmBody"></div>
        </div>
    `;
    document.body.appendChild(modal);
    const close = () => { modal.style.display = 'none'; };
    modal.querySelector('#closeConversionConfirmModal').onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    return modal;
}

function radioRow(name, value, label, hint, checked) {
    return `
        <label style="display:flex;gap:10px;align-items:flex-start;background:white;border:1px solid #e0e7ff;border-radius:6px;padding:8px 10px;cursor:pointer;">
            <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} style="margin-top:3px;">
            <span>
                <span style="font-weight:700;font-size:13px;display:block;">${escapeHtml(label)}</span>
                <span style="font-size:12px;color:#64748b;">${escapeHtml(hint)}</span>
            </span>
        </label>
    `;
}

export async function setupInventoryConversionUI({
    record,
    sectionId = 'invConvertSection'
} = {}) {
    const section = document.getElementById(sectionId);
    if (!section || !record) return;

    const id = record.id || record.ID;
    const tracked = Number(record.is_quantity_tracked ?? record.IsQuantityTracked ?? 0) === 1;
    const inactive = String(record.lineage_status || 'ACTIVE').toUpperCase() === 'INACTIVE';
    if (!tracked || !id || inactive) {
        section.style.display = 'none';
        return;
    }

    const total = qty(record.quantity_total);
    const reserved = qty(record.quantity_reserved);
    const available = qty(record.quantity_available);
    const converted = qty(record.quantity_converted);
    const productId = record.product_id || record.productId || '';
    const name = await productName(productId);
    const mutate = canMutate();

    section.style.display = 'block';
    section.innerHTML = `
        <h4 style="margin:0 0 8px 0;color:#0f766e;">Inventory → Asset</h4>
        <p style="margin:0 0 10px 0;font-size:12px;color:#115e59;">
            Converts available Inventory quantity into Asset records. This is not Break and not Set allocation.
            ${escapeHtml(id)}
            · Product ${productId ? escapeHtml(productId) : '—'}
            ${name && name !== productId ? ` · ${escapeHtml(name)}` : ''}
        </p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
            <div style="background:white;border:1px solid #99f6e4;border-radius:6px;padding:8px;">
                <div style="font-size:11px;color:#0f766e;font-weight:700;">Total</div>
                <div style="font-weight:800;font-size:16px;">${total}</div>
            </div>
            <div style="background:white;border:1px solid #fde68a;border-radius:6px;padding:8px;">
                <div style="font-size:11px;color:#92400e;font-weight:700;">Reserved</div>
                <div style="font-weight:800;font-size:16px;">${reserved}</div>
            </div>
            <div style="background:white;border:1px solid #bbf7d0;border-radius:6px;padding:8px;">
                <div style="font-size:11px;color:#166534;font-weight:700;">Available</div>
                <div style="font-weight:800;font-size:16px;">${available}</div>
            </div>
        </div>
        ${converted > 0 ? `<p style="margin:0 0 8px 0;font-size:12px;color:#4338ca;">Currently converted (unreturned): ${converted}</p>` : ''}
        ${!productId ? `<p style="margin:0 0 8px 0;font-size:12px;color:#b91c1c;font-weight:700;">Conversion requires a Product on this Inventory record.</p>` : ''}
        ${mutate ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
            <div>
                <label for="invConvertQty" style="font-size:11px;">Conversion quantity</label>
                <input type="number" id="invConvertQty" min="0" step="any" style="width:110px;padding:6px;" ${!productId || available <= 0 ? 'disabled' : ''}>
            </div>
        </div>
        <p id="invConvertQtyHint" style="margin:6px 0 10px;font-size:12px;color:#b91c1c;min-height:16px;"></p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${radioRow('invConvertGranularity', 'GROUPED', 'Grouped Asset', 'One Asset representing the converted quantity', true)}
            ${radioRow('invConvertGranularity', 'INDIVIDUAL', 'Individual Assets', 'One Asset of quantity 1 per unit', false)}
        </div>
        <button type="button" id="invBtnConvertToAsset" class="btn-action" style="background:#0f766e;color:white;border:none;padding:8px 12px;border-radius:4px;font-weight:700;cursor:pointer;" ${!productId || available <= 0 ? 'disabled' : ''}>Inventory → Asset</button>
        ` : '<p style="font-size:12px;color:#64748b;">You can view conversion history, but converting requires a manager role.</p>'}
        <div id="invConvertHistory" style="margin-top:10px;display:flex;flex-direction:column;gap:6px;"></div>
    `;

    const qtyInput = document.getElementById('invConvertQty');
    const hint = document.getElementById('invConvertQtyHint');
    const updateHint = () => {
        if (!hint || !qtyInput) return;
        const requested = Number(qtyInput.value);
        if (!qtyInput.value) {
            hint.textContent = '';
            return;
        }
        if (!(requested > 0)) {
            hint.textContent = 'Quantity must be greater than zero.';
            return;
        }
        if (requested > available) {
            hint.textContent = `Cannot convert ${requested}. Only ${available} is available.`;
            return;
        }
        hint.textContent = '';
    };
    if (qtyInput) qtyInput.addEventListener('input', updateHint);

    const historyHost = document.getElementById('invConvertHistory');
    try {
        const hist = await api(`/api/conversions/resource/INVENTORY/${encodeURIComponent(id)}`, { method: 'GET', headers: {} });
        const rows = hist.conversions || [];
        if (historyHost) {
            historyHost.innerHTML = rows.length
                ? rows.slice(0, 8).map((c) => `
                    <div style="background:white;border:1px solid #ccfbf1;border-radius:6px;padding:6px 8px;font-size:12px;">
                        <div style="font-weight:700;">${escapeHtml(c.direction === 'INVENTORY_TO_ASSET' ? 'Inventory → Asset' : c.direction === 'ASSET_TO_INVENTORY' ? 'Asset → Inventory' : c.direction)} · ${escapeHtml(c.status)}</div>
                        <div style="color:#64748b;">qty ${escapeHtml(c.quantityOriginal)} · ${escapeHtml(c.granularity || c.condition || '')}${c.id ? ` · <span style="font-size:11px;color:#94a3b8;">${escapeHtml(c.id)}</span>` : ''}</div>
                    </div>
                `).join('')
                : '<div style="font-size:12px;color:#64748b;">No conversions from this Inventory record yet.</div>';
        }
    } catch (err) {
        if (historyHost) historyHost.innerHTML = '';
    }

    const btn = document.getElementById('invBtnConvertToAsset');
    if (!btn) return;
    btn.onclick = async () => {
        const requested = Number(qtyInput && qtyInput.value);
        if (!(requested > 0)) {
            showToast('Enter a conversion quantity greater than zero.', 'error');
            return;
        }
        if (requested > available) {
            showToast(`Cannot convert ${requested}. Only ${available} is available.`, 'error');
            return;
        }
        if (!productId) {
            showToast('Conversion requires a Product.', 'error');
            return;
        }
        const granularity = (document.querySelector('input[name="invConvertGranularity"]:checked') || {}).value || 'GROUPED';
        const preview = granularity === 'INDIVIDUAL'
            ? `${Math.round(requested)} individual Asset${Math.round(requested) === 1 ? '' : 's'} of quantity 1`
            : `one grouped Asset of quantity ${requested}`;
        const modal = ensureModal();
        const body = document.getElementById('conversionConfirmBody');
        body.innerHTML = `
            <h3 style="margin:0 0 12px;">Inventory → Asset</h3>
            <div style="border:1px solid #ccfbf1;background:#f0fdfa;border-radius:8px;padding:12px;margin-bottom:12px;">
                <div style="font-size:12px;color:#0f766e;font-weight:700;">Source Inventory</div>
                <div style="font-weight:800;">${escapeHtml(id)}</div>
                <div style="font-size:12px;color:#115e59;">Product ${escapeHtml(productId)}${name ? ` · ${escapeHtml(name)}` : ''}</div>
                <div style="font-size:12px;margin-top:6px;">Total ${total} · Reserved ${reserved} · Available ${available}</div>
            </div>
            <p style="font-size:13px;">Convert <strong>${escapeHtml(requested)}</strong> as <strong>${escapeHtml(preview)}</strong>.</p>
            <p style="font-size:12px;color:#64748b;">The Inventory record stays. A new AssetEngine ID and QR are created. Reserved quantity is not converted.</p>
            <div style="display:flex;gap:8px;margin-top:16px;">
                <button type="button" id="cancelConversionConfirm" class="action-button grey" style="flex:1;">Cancel</button>
                <button type="button" id="okConversionConfirm" class="action-button blue" style="flex:1;background:#0f766e;">Confirm Inventory → Asset</button>
            </div>
        `;
        modal.style.display = 'flex';
        document.getElementById('cancelConversionConfirm').onclick = () => { modal.style.display = 'none'; };
        const ok = document.getElementById('okConversionConfirm');
        ok.onclick = async () => {
            ok.disabled = true;
            ok.textContent = 'Converting…';
            try {
                const result = await api('/api/conversions', {
                    method: 'POST',
                    body: JSON.stringify({
                        direction: 'INVENTORY_TO_ASSET',
                        sourceId: id,
                        quantity: requested,
                        granularity,
                        idempotencyKey: newIdempotencyKey()
                    })
                });
                modal.style.display = 'none';
                const created = (result.assets || []).map((a) => a.id).filter(Boolean);
                showToast(
                    created.length
                        ? `Converted ${requested} to ${created.join(', ')}`
                        : 'Conversion complete',
                    'success'
                );
                if (typeof window.loadInventoryItems === 'function') await window.loadInventoryItems();
                if (window.loadAssets) await window.loadAssets();
            } catch (err) {
                ok.disabled = false;
                ok.textContent = 'Confirm convert';
                toastOperatorError(err);
            }
        };
    };
}

export async function setupAssetReturnUI({
    record,
    sectionId = 'assetReturnSection'
} = {}) {
    const section = document.getElementById(sectionId);
    if (!section || !record) return;

    const id = record.id || record.ID;
    const sourceId = record.conversion_source_id || record.conversionSourceId || '';
    const inactive = String(record.lineage_status || record.lineageStatus || 'ACTIVE').toUpperCase() === 'INACTIVE';
    const tracked = Number(record.is_quantity_tracked ?? record.IsQuantityTracked ?? 0) === 1;
    if (!id || !tracked) {
        section.style.display = 'none';
        return;
    }
    if (!sourceId) {
        section.style.display = 'block';
        section.innerHTML = `
            <h4 style="margin:0 0 8px 0;color:#0369a1;">Asset → Inventory</h4>
            <p style="margin:0;font-size:12px;color:#64748b;">This Asset has no Inventory conversion lineage. Native Assets cannot be returned to Inventory.</p>
        `;
        return;
    }
    if (inactive) {
        section.style.display = 'block';
        section.innerHTML = `
            <h4 style="margin:0 0 8px 0;color:#0369a1;">Asset → Inventory</h4>
            <p style="margin:0;font-size:12px;color:#64748b;">Already returned. Original Inventory source ${escapeHtml(sourceId)} is unchanged. This Asset remains queryable.</p>
        `;
        return;
    }

    const productId = record.product_id || record.productId || '';
    const name = await productName(productId);
    const total = qty(record.quantity_total);
    const mutate = canMutate();

    section.style.display = 'block';
    section.innerHTML = `
        <h4 style="margin:0 0 8px 0;color:#0369a1;">Asset → Inventory</h4>
        <div style="display:grid;gap:6px;margin-bottom:10px;font-size:13px;">
            <div><span style="color:#64748b;">Asset</span> <strong>${escapeHtml(id)}</strong></div>
            <div><span style="color:#64748b;">Product</span> <strong>${productId ? escapeHtml(productId) : '—'}</strong>${name && name !== productId ? ` · ${escapeHtml(name)}` : ''}</div>
            <div><span style="color:#64748b;">Quantity</span> <strong>${total}</strong></div>
            <div><span style="color:#64748b;">Original immediate Inventory source</span> <strong>${escapeHtml(sourceId)}</strong> <span style="font-size:11px;color:#94a3b8;">(read-only)</span></div>
        </div>
        ${mutate ? `
        <p style="font-size:12px;font-weight:700;margin:0 0 6px;">Return condition</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${radioRow('assetReturnCondition', 'AVAILABLE', 'Available', 'Returns to normal Available Inventory', true)}
            ${radioRow('assetReturnCondition', 'INSPECTION', 'Inspection / Hold', 'Returns to the original Inventory lineage — not available for normal allocation', false)}
            ${radioRow('assetReturnCondition', 'DAMAGED', 'Damaged / Not Available', 'Returns to the original Inventory lineage — not available for normal allocation', false)}
        </div>
        <button type="button" id="btnReturnToInventory" class="btn-action" style="background:#0369a1;color:white;border:none;padding:8px 12px;border-radius:4px;font-weight:700;cursor:pointer;">Asset → Inventory</button>
        ` : '<p style="font-size:12px;color:#64748b;">Returning requires a manager role.</p>'}
    `;

    const btn = document.getElementById('btnReturnToInventory');
    if (!btn) return;
    btn.onclick = async () => {
        const condition = (document.querySelector('input[name="assetReturnCondition"]:checked') || {}).value || 'AVAILABLE';
        const consequence = condition === 'AVAILABLE'
            ? 'Quantity returns to available Inventory.'
            : 'Quantity returns to the original Inventory lineage and is not available for normal allocation.';
        const modal = ensureModal();
        const body = document.getElementById('conversionConfirmBody');
        body.innerHTML = `
            <h3 style="margin:0 0 12px;">Asset → Inventory</h3>
            <div style="border:1px solid #bae6fd;background:#f0f9ff;border-radius:8px;padding:12px;margin-bottom:12px;">
                <div style="font-weight:800;">${escapeHtml(id)}</div>
                <div style="font-size:12px;color:#0369a1;">→ ${escapeHtml(sourceId)} · ${escapeHtml(condition)}</div>
                <div style="font-size:12px;margin-top:6px;">Quantity ${total}</div>
            </div>
            <p style="font-size:13px;">${escapeHtml(consequence)}</p>
            <p style="font-size:12px;color:#64748b;">There is no destination picker. The Asset record remains queryable.</p>
            <div style="display:flex;gap:8px;margin-top:16px;">
                <button type="button" id="cancelConversionConfirm" class="action-button grey" style="flex:1;">Cancel</button>
                <button type="button" id="okConversionConfirm" class="action-button blue" style="flex:1;background:#0369a1;">Confirm Asset → Inventory</button>
            </div>
        `;
        modal.style.display = 'flex';
        document.getElementById('cancelConversionConfirm').onclick = () => { modal.style.display = 'none'; };
        const ok = document.getElementById('okConversionConfirm');
        ok.onclick = async () => {
            ok.disabled = true;
            ok.textContent = 'Returning…';
            try {
                await api('/api/conversions', {
                    method: 'POST',
                    body: JSON.stringify({
                        direction: 'ASSET_TO_INVENTORY',
                        sourceId: id,
                        condition,
                        idempotencyKey: newIdempotencyKey()
                    })
                });
                modal.style.display = 'none';
                showToast(`Returned ${id} to ${sourceId} as ${condition}`, 'success');
                if (window.loadAssets) await window.loadAssets();
                if (typeof window.loadInventoryItems === 'function') await window.loadInventoryItems();
            } catch (err) {
                ok.disabled = false;
                ok.textContent = 'Confirm return';
                toastOperatorError(err);
            }
        };
    };
}

window.setupInventoryConversionUI = setupInventoryConversionUI;
window.setupAssetReturnUI = setupAssetReturnUI;
