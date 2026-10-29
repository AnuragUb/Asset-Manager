import { fetchWithAuth } from './auth.js?v=7.29';
import { showToast } from './utils.js?v=6.60';
import {
    canLogistics,
    escapeHtml,
    emptyState,
    consumeOpen,
    toastOperatorError,
    formatQty
} from './lifecycle.js?v=7.52';

function el(id) {
    return document.getElementById(id);
}

function canMutateReceipts() {
    return canLogistics();
}

async function api(path, options = {}) {
    const response = await fetchWithAuth(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.reasonCode = data.reasonCode;
        err.details = data.details;
        err.status = response.status;
        throw err;
    }
    return data;
}

function idempotencyKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** Compact hoverable “i” tip next to a label (replaces long inline prompts). */
function rnInfoTip(text) {
    const tip = String(text || '').trim();
    if (!tip) return '';
    return `<button type="button" class="rn-info-tip" aria-label="More information" data-tip="${escapeHtml(tip)}"><span aria-hidden="true">i</span></button>`;
}

function bindInfoTips(root) {
    (root || document).querySelectorAll('.rn-info-tip').forEach((btn) => {
        if (btn.dataset.rnInfoBound) return;
        btn.dataset.rnInfoBound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
}

/** Human label for a PO / receipt line — prefer Product name; never show internal POL-* ids. */
function lineDisplayTitle(line) {
    const candidates = [
        line?.productName,
        line?.ProductName,
        line?.product?.name,
        line?.zohoProductName,
        line?.itemDescriptionSnapshot,
        line?.itemName,
        line?.description,
        line?.itemdescription
    ];
    for (const raw of candidates) {
        const text = String(raw || '').trim();
        if (text && !/^POL-[0-9]{4}-[A-Z0-9]+-[A-Z0-9]+$/i.test(text)) return text;
    }
    return '—';
}

function scoreProductMatch(product, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const name = String(product.name || '').toLowerCase();
    const id = String(product.id || '').toLowerCase();
    if (id === q || name === q) return 100;
    if (id.startsWith(q) || name.startsWith(q)) return 80;
    if (id.includes(q) || name.includes(q)) return 50;
    return 0;
}

function renderProductHits(hitsEl, products, onPick) {
    if (!hitsEl) return;
    if (!products.length) {
        hitsEl.innerHTML = '<div class="rn-product-hit-empty">No matching Products</div>';
        return;
    }
    hitsEl.innerHTML = products.map((p) => `
        <button type="button" class="rn-product-hit" data-id="${escapeHtml(p.id)}">
            <span class="rn-product-hit-name">${escapeHtml(p.name || p.id)}</span>
            <span class="rn-product-hit-id">${escapeHtml(p.id)}</span>
        </button>
    `).join('');
    hitsEl.querySelectorAll('.rn-product-hit').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const found = products.find((p) => p.id === id);
            if (found) onPick(found);
        });
    });
}

function applyProductPick(card, product, { search, hidden, hits, chosen }) {
    if (!product) return;
    hidden.value = product.id;
    card.setAttribute('data-product-id', product.id);
    const titleEl = card.querySelector('.rn-line-title');
    if (titleEl && product.name) titleEl.textContent = product.name;
    if (search) {
        search.value = product.name || product.id;
        search.classList.add('is-selected');
    }
    if (chosen) {
        chosen.textContent = product.id;
        chosen.style.display = 'none';
    }
    if (hits) hits.innerHTML = '';
    fillHoldingFromProduct(card, product);
    refreshProductHoldings(card).catch(() => refreshHoldingSummary(card));
}

function statusChipClass(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'OPEN') return 'ms-chip ms-chip-incomplete';
    if (s === 'POSTED') return 'ms-chip ms-chip-complete';
    if (s === 'CANCELLED') return 'ms-chip ms-chip-archived';
    if (s === 'REVERSED') return 'ms-chip ms-chip-disbanded';
    return 'ms-chip';
}

function projectionChip(status) {
    const s = String(status || '—').toUpperCase();
    if (s === 'SKIPPED') return 'ms-chip ms-chip-legacy';
    if (s === 'SENT') return 'ms-chip ms-chip-complete';
    if (s === 'FAILED' || s === 'RETRY') return 'ms-chip ms-chip-overcomplete';
    if (s === 'PENDING') return 'ms-chip ms-chip-incomplete';
    return 'ms-chip';
}

let viewListenersBound = false;
let productHits = [];
let receiptHierarchy = {
    invFolders: [],
    invKinds: [],
    assetFolders: [],
    assetKinds: []
};

function rowId(row) {
    return String(row?.id || row?.ID || '');
}

function rowName(row) {
    return String(row?.name || row?.Name || rowId(row));
}

function rowFolderId(row) {
    return String(row?.folderid || row?.FolderId || row?.folderId || '');
}

function assetKindName(row) {
    return String(row?.name || row?.Name || '');
}

function assetKindParent(row) {
    return String(row?.parentname || row?.ParentName || row?.parentName || '');
}

function assetFolderById(id) {
    return receiptHierarchy.assetFolders.find((f) => rowId(f) === String(id || ''));
}

function assetFolderByName(name) {
    const n = String(name || '').trim().toLowerCase();
    return receiptHierarchy.assetFolders.find((f) => rowName(f).toLowerCase() === n);
}

function pathParts(value) {
    return String(value || '').split(/[/|>]+/).map((part) => part.trim()).filter(Boolean);
}

function sameName(left, right) {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function domField(id) {
    const node = document.getElementById(id);
    return node ? String(node.value || '').trim() : '';
}

function resolveInventoryPlacement(path, folderRaw, kindRaw) {
    const parts = pathParts(path);
    const folder = receiptHierarchy.invFolders.find((row) => rowId(row) === folderRaw)
        || receiptHierarchy.invFolders.find((row) => sameName(rowName(row), folderRaw))
        || receiptHierarchy.invFolders.find((row) => sameName(rowName(row), parts[0]));
    if (!folder) return null;
    const folderId = rowId(folder);
    const kinds = receiptHierarchy.invKinds.filter((row) => rowFolderId(row) === folderId);
    const guesses = [kindRaw, parts[1], parts[parts.length - 1]].filter(Boolean);
    let kind = null;
    for (const guess of guesses) {
        kind = kinds.find((row) => rowId(row) === guess || sameName(rowName(row), guess));
        if (kind) break;
    }
    if (!kind) return null;
    return { folderId, kindId: rowId(kind) };
}

function resolveAssetPlacement(path, folderRaw, kindRaw, brandRaw) {
    const parts = pathParts(path);
    const folder = assetFolderById(folderRaw) || assetFolderByName(folderRaw) || assetFolderByName(parts[0]);
    if (!folder) return null;
    const folderId = rowId(folder);
    const folderName = rowName(folder);
    const under = receiptHierarchy.assetKinds.filter((row) => {
        const parent = assetKindParent(row);
        return parent === folderName || parent === folderId;
    });
    const kind = under.find((row) => sameName(assetKindName(row), kindRaw || parts[1]));
    if (!kind) return null;
    const brand = brandRaw || (parts.length > 2 ? parts[parts.length - 1] : '');
    return {
        folderId,
        kindName: assetKindName(kind),
        brand: sameName(brand, assetKindName(kind)) ? '' : brand
    };
}

function invFolderOptionsHtml(selected) {
    const current = String(selected || '');
    return ['<option value="">Select folder</option>']
        .concat(receiptHierarchy.invFolders.map((folder) => {
            const id = rowId(folder);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(folder))}</option>`;
        }))
        .join('');
}

function invKindOptionsHtml(folderId, selected) {
    const current = String(selected || '');
    const kinds = receiptHierarchy.invKinds.filter((kind) => !folderId || rowFolderId(kind) === String(folderId));
    return ['<option value="">Select category</option>']
        .concat(kinds.map((kind) => {
            const id = rowId(kind);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(kind))}</option>`;
        }))
        .join('');
}

function assetFolderOptionsHtml(selected) {
    const current = String(selected || '');
    return ['<option value="">Select folder</option>']
        .concat(receiptHierarchy.assetFolders.map((folder) => {
            const id = rowId(folder);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(folder))}</option>`;
        }))
        .join('');
}

/** Category/Kind under an asset parent folder (parentname = folder name). */
function assetKindOptionsHtml(folderId, selected) {
    const current = String(selected || '');
    const folder = assetFolderById(folderId);
    const folderName = folder ? rowName(folder) : '';
    const kinds = receiptHierarchy.assetKinds.filter((kind) => {
        const parent = assetKindParent(kind);
        if (!folderName) return !parent;
        return parent === folderName || parent === rowId(folder);
    });
    return ['<option value="">Select category</option>']
        .concat(kinds.map((kind) => {
            const name = assetKindName(kind);
            return `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        }))
        .join('');
}

/** Make Category = child kinds under the selected Category/Kind name. */
function assetMakeOptionsHtml(kindName, selected) {
    const current = String(selected || '');
    const parent = String(kindName || '');
    const makes = parent
        ? receiptHierarchy.assetKinds.filter((kind) => assetKindParent(kind) === parent)
        : [];
    return ['<option value="">Generic / Default</option>']
        .concat(makes.map((kind) => {
            const name = assetKindName(kind);
            return `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        }))
        .join('');
}

async function loadReceiptHierarchy() {
    const [invFolders, invKinds, assetFolders, assetKinds] = await Promise.all([
        api('/api/inventory/folders').catch(() => ({ folders: [] })),
        api('/api/inventory/kinds').catch(() => ({ kinds: [] })),
        api('/api/folders').catch(() => []),
        api('/api/asset_kinds').catch(() => [])
    ]);
    receiptHierarchy = {
        invFolders: invFolders.folders || [],
        invKinds: invKinds.kinds || [],
        assetFolders: Array.isArray(assetFolders) ? assetFolders : (assetFolders.folders || []),
        assetKinds: Array.isArray(assetKinds) ? assetKinds : (assetKinds.kinds || [])
    };
}

function holdingFromLine(line) {
    const raw = line?.physicalMarkings;
    if (raw && typeof raw === 'object' && raw.holding && typeof raw.holding === 'object') return raw.holding;
    return {};
}

function fillHoldingFromProduct(card, product) {
    if (!card || !product) return;
    const set = (cls, value) => {
        const input = card.querySelector(cls);
        if (input && value != null && String(value).trim() !== '') input.value = String(value);
    };
    set('.rn-item-name', product.name);
    set('.rn-item-make', product.make);
    set('.rn-item-model', product.model);
    set('.rn-item-unit', product.unit);
}

function isAddToExistingAction(holding) {
    return String(holding?.holdingAction || '').toUpperCase() === 'ADD_EXISTING';
}

function holdingIsReady(holding, mode, invFolder, invKind, assetFolderId, assetKind) {
    if (isAddToExistingAction(holding)) {
        return !!(holding?.targetResourceId || holding?.targetId);
    }
    if (mode === 'INVENTORY') return !!(invFolder && invKind);
    return !!(assetFolderId || holding?.parentFolder) && !!(assetKind || holding?.assetKind);
}

function holdingConfiguredSummaryHtml(holding, mode, invFolder, invKind, assetFolderId, assetKind) {
    if (isAddToExistingAction(holding)) {
        const targetId = holding.targetResourceId || holding.targetId || '';
        if (!targetId) {
            return '<span class="rn-holding-summary-empty">Choose an existing holding to add quantity to.</span>';
        }
        const label = holding.targetLabel || targetId;
        return `<strong>${escapeHtml(label)}</strong><span class="lc-muted"> · Add to existing ${mode === 'INVENTORY' ? 'Inventory' : 'Asset'}</span>`;
    }
    const ready = holdingIsReady(holding, mode, invFolder, invKind, assetFolderId, assetKind);
    if (!ready) {
        return '<span class="rn-holding-summary-empty">Not configured yet — open the form to set Folder / Category for this Product.</span>';
    }
    const name = escapeHtml(holding.itemName || holding.itemname || '—');
    if (mode === 'INVENTORY') {
        const folder = intakeFolderName(invFolder, 'inv') || invFolder;
        const kind = intakeKindName(invKind, 'inv') || invKind;
        return `<strong>${name}</strong><span class="lc-muted"> · Inventory · ${escapeHtml(folder)} → ${escapeHtml(kind)}</span>`;
    }
    const folder = intakeFolderName(assetFolderId, 'asset') || holding.parentFolder || assetFolderId;
    const kind = assetKind || holding.assetKind || '';
    return `<strong>${name}</strong><span class="lc-muted"> · Asset · ${escapeHtml(folder)} → ${escapeHtml(kind)}</span>`;
}

function intakeFolderName(idOrName, kind) {
    if (!idOrName) return '';
    if (kind === 'inv') {
        const row = receiptHierarchy.invFolders.find((f) => rowId(f) === String(idOrName));
        return row ? rowName(row) : String(idOrName);
    }
    const byId = assetFolderById(idOrName);
    if (byId) return rowName(byId);
    const byName = assetFolderByName(idOrName);
    return byName ? rowName(byName) : String(idOrName);
}

function intakeKindName(idOrName, kind) {
    if (!idOrName) return '';
    if (kind === 'inv') {
        const row = receiptHierarchy.invKinds.find((k) => rowId(k) === String(idOrName));
        return row ? rowName(row) : String(idOrName);
    }
    return String(idOrName);
}

function targetResourceTypeForMode(mode) {
    return mode === 'INVENTORY' ? 'INVENTORY' : 'ASSET';
}

function syncTargetPanelVisibility(card) {
    const action = card.querySelector('.rn-target-action:checked')?.value || 'CREATE_NEW';
    const existingWrap = card.querySelector('.rn-target-existing');
    const summaryBtn = card.querySelector('.rn-open-holding-modal');
    const summaryBlock = card.querySelector('.rn-holding-summary');
    if (existingWrap) existingWrap.style.display = action === 'ADD_EXISTING' ? '' : 'none';
    if (summaryBtn) summaryBtn.style.display = action === 'ADD_EXISTING' ? 'none' : '';
    if (summaryBlock) summaryBlock.style.display = action === 'ADD_EXISTING' ? 'none' : '';
}

async function refreshProductHoldings(card) {
    const productId = card.querySelector('.rn-product-id')?.value;
    const mode = card.querySelector('.rn-mode:checked')?.value || 'INVENTORY';
    const targetPanel = card.querySelector('.rn-holding-target');
    const select = card.querySelector('.rn-target-select');
    const emptyHint = card.querySelector('.rn-target-empty-hint');
    const idInput = card.querySelector('.rn-target-id');
    if (!targetPanel) {
        refreshHoldingSummary(card);
        return;
    }
    if (mode === 'ASSET_INDIVIDUAL' || !productId) {
        targetPanel.style.display = 'none';
        refreshHoldingSummary(card);
        return;
    }
    targetPanel.style.display = '';
    let holdings = [];
    let loadError = '';
    try {
        // Load Inventory + Asset for this Product (do not filter by current mode).
        const data = await api(`/api/products/${encodeURIComponent(productId)}/holdings`);
        holdings = data.holdings || [];
    } catch (err) {
        holdings = [];
        loadError = err?.message || 'Could not load existing holdings';
    }
    card.__productHoldings = holdings;
    const savedAction = card.dataset.rnHoldingAction || '';
    const savedTarget = card.dataset.rnTargetResourceId || '';
    const addRadio = card.querySelector('.rn-target-action[value="ADD_EXISTING"]');
    const createRadio = card.querySelector('.rn-target-action[value="CREATE_NEW"]');
    if (addRadio) addRadio.disabled = false;
    if (select) {
        if (holdings.length) {
            select.innerHTML = holdings.map((h) => (
                `<option value="${escapeHtml(h.resourceId)}" data-type="${escapeHtml(h.resourceType)}">`
                + `[${escapeHtml(h.resourceType)}] ${escapeHtml(h.resourceId)} · ${escapeHtml(h.name || h.resourceId)} `
                + `(${escapeHtml(h.quantityTotal)} ${escapeHtml(h.unit || 'Nos')})`
                + `</option>`
            )).join('');
        } else {
            select.innerHTML = `<option value="">No holdings linked to this Product yet</option>`;
        }
    }
    if (emptyHint) {
        if (loadError) {
            emptyHint.hidden = false;
            emptyHint.textContent = `${loadError}. Paste an existing Inventory/Asset ID below, or Create new.`;
        } else if (!holdings.length) {
            emptyHint.hidden = false;
            emptyHint.textContent = 'No Inventory/Asset linked to this Product yet. Paste an existing ID below, or Create new.';
        } else {
            emptyHint.hidden = true;
            emptyHint.textContent = '';
        }
    }
    const preferAdd = savedAction === 'ADD_EXISTING' || (!savedAction && holdings.length >= 1);
    if (preferAdd && addRadio) {
        addRadio.checked = true;
        const pickId = savedTarget
            || (holdings.length === 1 ? holdings[0].resourceId : '')
            || (holdings.find((h) => h.resourceType === (mode === 'INVENTORY' ? 'INVENTORY' : 'ASSET'))?.resourceId)
            || holdings[0]?.resourceId
            || '';
        if (pickId && select && holdings.some((h) => h.resourceId === pickId)) {
            select.value = pickId;
            applyHoldingTargetToMode(card, pickId);
        }
        if (pickId && idInput && !idInput.value) idInput.value = pickId;
    } else if (!savedAction && createRadio) {
        createRadio.checked = true;
    }
    syncTargetPanelVisibility(card);
    refreshHoldingSummary(card);
}

function applyHoldingTargetToMode(card, resourceId) {
    const holdings = card.__productHoldings || [];
    const hit = holdings.find((h) => String(h.resourceId) === String(resourceId));
    if (!hit) return;
    const wantMode = hit.resourceType === 'INVENTORY' ? 'INVENTORY' : 'ASSET_GROUPED';
    const radio = card.querySelector(`.rn-mode[value="${wantMode}"]`);
    if (radio && !radio.checked) {
        radio.checked = true;
    }
}

function resolveTargetResourceId(card) {
    const select = card.querySelector('.rn-target-select');
    const idInput = card.querySelector('.rn-target-id');
    return String(idInput?.value || select?.value || '').trim();
}

function refreshHoldingSummary(card) {
    const summary = card.querySelector('.rn-holding-summary-text');
    const btn = card.querySelector('.rn-open-holding-modal');
    if (!summary) return;
    const mode = card.querySelector('.rn-mode:checked')?.value || 'INVENTORY';
    const action = card.querySelector('.rn-target-action:checked')?.value || 'CREATE_NEW';
    const select = card.querySelector('.rn-target-select');
    const selectedOption = select?.selectedOptions?.[0];
    const targetResourceId = resolveTargetResourceId(card);
    const holding = {
        itemName: card.querySelector('.rn-item-name')?.value || '',
        parentFolder: '',
        assetKind: card.querySelector('.rn-asset-kind')?.value || '',
        holdingAction: action,
        targetResourceId,
        targetResourceType: selectedOption?.getAttribute('data-type') || targetResourceTypeForMode(mode),
        targetLabel: selectedOption && selectedOption.value
            ? selectedOption.textContent.trim()
            : (targetResourceId || '')
    };
    const invFolder = card.querySelector('.rn-folder')?.value || '';
    const invKind = card.querySelector('.rn-kind')?.value || '';
    const assetFolderId = card.querySelector('.rn-asset-folder')?.value || '';
    const assetKind = card.querySelector('.rn-asset-kind')?.value || '';
    const folderRow = assetFolderById(assetFolderId);
    holding.parentFolder = folderRow ? rowName(folderRow) : assetFolderId;
    summary.innerHTML = holdingConfiguredSummaryHtml(holding, mode, invFolder, invKind, assetFolderId, assetKind);
    const ready = holdingIsReady(holding, mode, invFolder, invKind, assetFolderId, assetKind);
    const readyInput = card.querySelector('.rn-holding-ready');
    if (readyInput) readyInput.value = ready ? '1' : '0';
    if (btn) btn.textContent = `Open ${mode === 'INVENTORY' ? 'Inventory' : 'Asset'} form`;
    syncTargetPanelVisibility(card);
}

function productPrefillFromCard(card) {
    return {
        ItemName: card.querySelector('.rn-item-name')?.value || '',
        ItemDescription: card.querySelector('.rn-item-description')?.value || '',
        Make: card.querySelector('.rn-item-make')?.value || '',
        Model: card.querySelector('.rn-item-model')?.value || '',
        UOM: card.querySelector('.rn-item-unit')?.value || 'Nos',
        QtyOrdered: Math.max(1, num(card.querySelector('.rn-accepted')?.value) || num(card.querySelector('.rn-received')?.value) || 1),
        CurrentLocation: card.querySelector('.rn-item-location')?.value || el('rnEditLocation')?.value || 'Mumbai',
        parent_folder: (() => {
            const id = card.querySelector('.rn-asset-folder')?.value || '';
            const row = assetFolderById(id);
            return row ? rowName(row) : id;
        })(),
        Type: card.querySelector('.rn-asset-kind')?.value || '',
        FolderId: card.querySelector('.rn-folder')?.value || '',
        folderid: card.querySelector('.rn-folder')?.value || '',
        KindId: card.querySelector('.rn-kind')?.value || '',
        kindid: card.querySelector('.rn-kind')?.value || ''
    };
}

async function openHoldingModalForCard(card) {
    const productId = card.querySelector('.rn-product-id')?.value;
    if (!productId) {
        showToast('Link a Product on this line before configuring the holding.', 'warning');
        return;
    }
    const mode = card.querySelector('.rn-mode:checked')?.value || 'INVENTORY';
    let product = null;
    try {
        const data = await api(`/api/products/${encodeURIComponent(productId)}`);
        product = data.product || data;
        fillHoldingFromProduct(card, product);
    } catch (_err) {
        /* keep staged fields */
    }

    const prefill = productPrefillFromCard(card);
    if (product) {
        prefill.ItemName = product.name || prefill.ItemName;
        prefill.Make = product.make || prefill.Make;
        prefill.Model = product.model || prefill.Model;
        prefill.UOM = product.unit || prefill.UOM;
    }

    window.__receiptHoldingContext = { card, mode };
    window.__inventoryModalActive = mode === 'INVENTORY';

    if (mode === 'INVENTORY') {
        if (typeof window.loadInventoryWorkspace === 'function') {
            try { await window.loadInventoryWorkspace(); } catch (_e) { /* optional */ }
        }
        if (typeof window.openInventorySharedModal === 'function') {
            window.openInventorySharedModal({
                FolderId: prefill.FolderId,
                folderid: prefill.folderid,
                KindId: prefill.KindId,
                kindid: prefill.kindid,
                ItemName: prefill.ItemName,
                ItemDescription: prefill.ItemDescription,
                Make: prefill.Make,
                Model: prefill.Model,
                CurrentLocation: prefill.CurrentLocation,
                QuantityTotal: prefill.QtyOrdered,
                quantity_total: prefill.QtyOrdered,
                QuantityAvailable: prefill.QtyOrdered,
                quantity_available: prefill.QtyOrdered,
                UOM: prefill.UOM
            });
        } else if (typeof window.openAddItemModal === 'function') {
            window.openAddItemModal('Inventory', prefill);
            const form = document.getElementById('addAssetItemForm');
            if (form) form.dataset.entity = 'inventory';
        } else {
            showToast('Inventory form is not available.', 'error');
            window.__receiptHoldingContext = null;
            return;
        }
    } else if (typeof window.openAddItemModal === 'function') {
        window.openAddItemModal(prefill.Type || 'Asset', prefill);
        const form = document.getElementById('addAssetItemForm');
        if (form) {
            form.dataset.entity = 'asset';
            window.__inventoryModalActive = false;
        }
    } else {
        showToast('Asset form is not available.', 'error');
        window.__receiptHoldingContext = null;
        return;
    }

    const title = document.getElementById('addItemModalTitle');
    if (title) {
        title.textContent = mode === 'INVENTORY'
            ? `Receipt → Add Inventory (${productId})`
            : `Receipt → Add Asset (${productId})`;
    }
    const submitBtn = document.querySelector('#addAssetItemForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Use on this Receipt line';

    setTimeout(() => {
        const setDom = (id, val) => {
            const node = document.getElementById(id);
            if (node && val != null && val !== '') node.value = String(val);
        };
        setDom('itemName', prefill.ItemName);
        setDom('itemDescription', prefill.ItemDescription);
        setDom('itemMake', prefill.Make);
        setDom('itemModel', prefill.Model);
        setDom('itemQtyUnit', prefill.UOM);
        setDom('itemQtyTotal', prefill.QtyOrdered);
        setDom('itemLocation', prefill.CurrentLocation);
        setDom('itemPurpose', 'Owned');
    }, 200);
}

async function applyReceiptHoldingFromModal(form) {
    const ctx = window.__receiptHoldingContext;
    if (!ctx?.card) return false;
    if (!receiptHierarchy.invFolders.length || !receiptHierarchy.assetFolders.length) {
        try { await loadReceiptHierarchy(); } catch (_err) { /* use whatever is loaded */ }
    }
    const card = ctx.card;
    const mode = ctx.mode || 'INVENTORY';
    const formData = new FormData(form);

    const set = (sel, val) => {
        const node = card.querySelector(sel);
        if (node) node.value = val == null ? '' : String(val);
    };

    const name = String(formData.get('itemName') || '').trim();
    const description = String(formData.get('itemDescription') || '').trim();
    const make = String(formData.get('itemMake') || '').trim();
    const model = String(formData.get('itemModel') || '').trim();
    const unit = String(formData.get('itemQtyUnit') || 'Nos').trim() || 'Nos';
    const location = String(formData.get('itemLocation') || formData.get('itemCurrentLocation') || el('rnEditLocation')?.value || '').trim();
    const serial = String(formData.get('itemSrNo') || '').trim();
    const purpose = String(formData.get('itemPurpose') || formData.get('itemStatus') || 'Owned').trim() || 'Owned';
    const pathValue = domField('itemFolderPath') || String(formData.get('itemFolderPath') || '').trim();
    const folderValue = domField('itemFolder') || String(formData.get('itemFolder') || '').trim();
    const kindValue = domField('itemKind') || String(formData.get('itemKind') || '').trim();
    const brandValue = domField('itemBrandCategory') || String(formData.get('itemBrandCategory') || '').trim();

    set('.rn-item-name', name);
    set('.rn-item-description', description);
    set('.rn-item-make', make);
    set('.rn-item-model', model);
    set('.rn-item-unit', unit);
    set('.rn-item-location', location);
    set('.rn-item-serial', serial);
    const purposeSelect = card.querySelector('.rn-purpose');
    if (purposeSelect && [...purposeSelect.options].some((o) => o.value === purpose)) {
        purposeSelect.value = purpose;
    } else if (purposeSelect) {
        purposeSelect.value = 'Owned';
    }

    // Ensure mode radio matches
    const modeRadio = card.querySelector(`.rn-mode[value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    if (mode === 'INVENTORY') {
        const placed = resolveInventoryPlacement(pathValue, folderValue, kindValue);
        if (!placed) {
            showToast('Choose a Folder Path that is an existing Inventory folder and category, such as Stores / Cables.', 'error');
            return false;
        }
        const folderSelect = card.querySelector('.rn-folder');
        const kindSelect = card.querySelector('.rn-kind');
        if (folderSelect) {
            if (![...folderSelect.options].some((o) => o.value === placed.folderId)) {
                const opt = document.createElement('option');
                opt.value = placed.folderId;
                opt.textContent = intakeFolderName(placed.folderId, 'inv') || placed.folderId;
                folderSelect.appendChild(opt);
            }
            folderSelect.value = placed.folderId;
        }
        if (kindSelect) {
            kindSelect.innerHTML = invKindOptionsHtml(placed.folderId, placed.kindId);
            kindSelect.value = placed.kindId;
        }
    } else {
        const placed = resolveAssetPlacement(pathValue, folderValue, kindValue, brandValue);
        if (!placed) {
            showToast('Choose a Folder Path under an existing Asset folder and category.', 'error');
            return false;
        }
        const folderSelect = card.querySelector('.rn-asset-folder');
        const kindSelect = card.querySelector('.rn-asset-kind');
        const makeSelect = card.querySelector('.rn-asset-make');
        if (folderSelect) {
            if (![...folderSelect.options].some((o) => o.value === placed.folderId)) {
                const opt = document.createElement('option');
                opt.value = placed.folderId;
                opt.textContent = intakeFolderName(placed.folderId, 'asset') || placed.folderId;
                folderSelect.appendChild(opt);
            }
            folderSelect.value = placed.folderId;
        }
        if (kindSelect) {
            kindSelect.innerHTML = assetKindOptionsHtml(placed.folderId, placed.kindName);
            kindSelect.value = placed.kindName;
        }
        if (makeSelect) {
            makeSelect.innerHTML = assetMakeOptionsHtml(placed.kindName, placed.brand);
            makeSelect.value = placed.brand;
        }
    }

    refreshHoldingSummary(card);
    window.__receiptHoldingContext = null;
    window.__inventoryModalActive = false;
    const modal = document.getElementById('addAssetItemModal');
    if (modal) modal.style.display = 'none';
    showToast('Holding details applied to this Receipt line. Post the Receipt to create stock.', 'success');
    return true;
}

window.applyReceiptHoldingFromModal = applyReceiptHoldingFromModal;

function syncHoldingPanel(card) {
    const received = num(card.querySelector('.rn-received')?.value);
    const accepted = num(card.querySelector('.rn-accepted')?.value);
    const panel = card.querySelector('.rn-holding-panel');
    if (panel) panel.style.display = (received > 0 || accepted > 0) ? '' : 'none';
    refreshHoldingSummary(card);
}

function refreshAssetCascades(card, { keepKind = true, keepMake = true } = {}) {
    const folderSelect = card.querySelector('.rn-asset-folder');
    const kindSelect = card.querySelector('.rn-asset-kind');
    const makeSelect = card.querySelector('.rn-asset-make');
    if (!folderSelect || !kindSelect || !makeSelect) return;
    const prevKind = keepKind ? kindSelect.value : '';
    const prevMake = keepMake ? makeSelect.value : '';
    kindSelect.innerHTML = assetKindOptionsHtml(folderSelect.value, prevKind);
    makeSelect.innerHTML = assetMakeOptionsHtml(kindSelect.value, prevMake);
}

async function promptName(title, placeholder) {
    const value = window.prompt(title, placeholder || '');
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

async function createInventoryFolder(card) {
    const name = await promptName('New inventory folder name');
    if (!name) return;
    try {
        const res = await api('/api/inventory/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: name, Icon: '📁' })
        });
        await loadReceiptHierarchy();
        const folderSelect = card.querySelector('.rn-folder');
        const kindSelect = card.querySelector('.rn-kind');
        if (folderSelect) {
            folderSelect.innerHTML = invFolderOptionsHtml(res.id || '');
            folderSelect.value = res.id || '';
        }
        if (kindSelect) kindSelect.innerHTML = invKindOptionsHtml(folderSelect?.value || '', '');
        showToast('Inventory folder created', 'success');
    } catch (err) {
        showToast(err.status === 403 ? 'You do not have permission to create folders.' : err.message, 'error');
    }
}

async function createInventoryKind(card) {
    const folderId = card.querySelector('.rn-folder')?.value;
    if (!folderId) {
        showToast('Select a folder first', 'warning');
        return;
    }
    const name = await promptName('New inventory category name');
    if (!name) return;
    try {
        const res = await api('/api/inventory/kinds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: name, FolderID: folderId, Icon: '📦' })
        });
        await loadReceiptHierarchy();
        const kindSelect = card.querySelector('.rn-kind');
        if (kindSelect) {
            kindSelect.innerHTML = invKindOptionsHtml(folderId, res.id || '');
            kindSelect.value = res.id || '';
        }
        showToast('Inventory category created', 'success');
    } catch (err) {
        showToast(err.status === 403 ? 'You do not have permission to create categories.' : err.message, 'error');
    }
}

async function createAssetFolder(card) {
    const name = await promptName('New asset parent folder name');
    if (!name) return;
    try {
        const res = await api('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: name, Icon: '📂', Module: 'IT' })
        });
        await loadReceiptHierarchy();
        const folderSelect = card.querySelector('.rn-asset-folder');
        if (folderSelect) {
            folderSelect.innerHTML = assetFolderOptionsHtml(res.id || '');
            folderSelect.value = res.id || '';
        }
        refreshAssetCascades(card, { keepKind: false, keepMake: false });
        showToast('Asset folder created', 'success');
    } catch (err) {
        showToast(err.status === 403 ? 'You do not have permission to create folders.' : err.message, 'error');
    }
}

async function createAssetKind(card) {
    const folderSelect = card.querySelector('.rn-asset-folder');
    const folderId = folderSelect?.value;
    const folder = assetFolderById(folderId);
    if (!folder) {
        showToast('Select a parent folder first', 'warning');
        return;
    }
    const name = await promptName('New asset category / kind name');
    if (!name) return;
    try {
        await api('/api/asset_kinds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Name: name,
                Icon: '📦',
                ParentName: rowName(folder),
                Module: 'IT'
            })
        });
        await loadReceiptHierarchy();
        const kindSelect = card.querySelector('.rn-asset-kind');
        if (kindSelect) {
            kindSelect.innerHTML = assetKindOptionsHtml(folderId, name);
            kindSelect.value = name;
        }
        refreshAssetCascades(card, { keepKind: true, keepMake: false });
        showToast('Asset category created', 'success');
    } catch (err) {
        showToast(err.status === 403 ? 'You do not have permission to create categories.' : err.message, 'error');
    }
}

async function createAssetMake(card) {
    const kindName = card.querySelector('.rn-asset-kind')?.value;
    if (!kindName) {
        showToast('Select a category / kind first', 'warning');
        return;
    }
    const name = await promptName('New make category name');
    if (!name) return;
    try {
        await api('/api/asset_kinds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Name: name,
                Icon: '🏷️',
                ParentName: kindName,
                Module: 'IT'
            })
        });
        await loadReceiptHierarchy();
        const makeSelect = card.querySelector('.rn-asset-make');
        if (makeSelect) {
            makeSelect.innerHTML = assetMakeOptionsHtml(kindName, name);
            makeSelect.value = name;
        }
        showToast('Make category created', 'success');
    } catch (err) {
        showToast(err.status === 403 ? 'You do not have permission to create categories.' : err.message, 'error');
    }
}

async function renderReceiptList(filterPoId) {
    const host = el('receiptsContent');
    if (!host) return;
    const q = el('receiptSearch')?.value || '';
    const status = el('receiptStatusFilter')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const period = el('receiptPeriodFilter')?.value || '';
    if (period) params.set('period', period);
    const poFilter = String(filterPoId || window.__receiptPoFilter || '').trim();
    if (poFilter) params.set('poId', poFilter);
    params.set('limit', '100');
    const data = await api(`/api/receipt-notes?${params.toString()}`);
    const notes = data.receiptNotes || [];
    if (el('receiptCountBadge')) {
        el('receiptCountBadge').textContent = `${notes.length} Receipts`;
    }
    if (!notes.length) {
        host.innerHTML = emptyState({
            title: 'No Receipt Notes awaiting action.',
            body: 'Receive goods against an imported Purchase Order. Posting creates accepted physical stock.',
            actionLabel: canMutateReceipts() ? 'Receive against PO' : '',
            actionView: 'receipts-view',
            actionAttr: 'id="btnEmptyCreateReceipt"'
        });
        host.querySelector('#btnEmptyCreateReceipt')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renderCreateForm().catch((err) => toastOperatorError(err));
        });
        return;
    }
    host.innerHTML = `
        <div class="rn-card-grid">
            ${notes.map((n) => `
                <button type="button" class="rn-op-card" data-id="${escapeHtml(n.id)}" aria-label="Receipt Note ${escapeHtml(n.id)}">
                    <div class="rn-op-title ms-mono">${escapeHtml(n.id)}</div>
                    <div class="rn-op-primary">${escapeHtml(n.poNumber || n.poId || '—')}</div>
                    <div class="rn-op-meta">${escapeHtml(n.vendorName || '—')}</div>
                    <div class="rn-op-facts">
                        <span>Received <strong>${escapeHtml(n.receivedAt ? String(n.receivedAt).slice(0, 16) : '—')}</strong></span>
                        <span>Accepted <strong>${escapeHtml(n.acceptedQuantity == null ? '—' : String(n.acceptedQuantity))}</strong></span>
                    </div>
                    <div class="rn-op-foot">
                        <span class="${statusChipClass(n.status)}">${escapeHtml(n.status)}</span>
                        <span class="${projectionChip(n.projectionStatus)}">${escapeHtml(n.projectionStatus || '—')}</span>
                    </div>
                </button>
            `).join('')}
        </div>`;
    host.querySelectorAll('.rn-op-card').forEach((card) => {
        card.addEventListener('click', () => openReceiptDetail(card.getAttribute('data-id')));
    });
}

function lineEditorHtml(line, index, note) {
    const productMissing = !line.productId;
    const holding = holdingFromLine(line);
    const mode = line.creationMode || 'INVENTORY';
    const title = lineDisplayTitle(line);
    const productLabel = line.productId || '';
    const productSearchValue = line.productName || line.productLabel || '';
    const locationDefault = holding.location || note.receivedAtLocation || '';
    const invFolder = line.folderId || '';
    const invKind = mode === 'INVENTORY' ? (line.kindId || '') : '';
    let assetFolderId = holding.parentFolderId || '';
    if (!assetFolderId && holding.parentFolder) {
        assetFolderId = rowId(assetFolderByName(holding.parentFolder)) || '';
    }
    const assetKind = holding.assetKind || (mode !== 'INVENTORY' ? (line.kindId || '') : '') || '';
    const assetMake = holding.brandCategory || '';
    const checked = (value) => mode === value ? 'checked' : '';
    const holdingAction = String(holding.holdingAction || '').toUpperCase();
    const preferAddExisting = holdingAction === 'ADD_EXISTING';
    const targetResourceId = holding.targetResourceId || holding.targetId || '';

    return `
        <div class="rn-line-card" data-index="${index}" data-line-id="${escapeHtml(line.id || '')}" data-po-line-id="${escapeHtml(line.poLineId)}" data-product-id="${escapeHtml(line.productId || '')}" data-outstanding="${escapeHtml(line.outstanding ?? '')}" data-rn-holding-action="${escapeHtml(holdingAction)}" data-rn-target-resource-id="${escapeHtml(targetResourceId)}">
            <div class="rn-line-head">
                <div>
                    <div class="rn-line-title">${escapeHtml(title)}</div>
                </div>
                <div class="rn-line-meta">
                    <span>Ordered ${rnInfoTip('Quantity ordered on this Purchase Order line.')} <strong>${escapeHtml(line.orderedQtySnapshot)}</strong></span>
                    <span>Accepted to date ${rnInfoTip('Quantity already accepted on earlier Receipts for this PO line.')} <strong>${escapeHtml(line.acceptedToDate ?? '—')}</strong></span>
                    <span>Outstanding ${rnInfoTip('Remaining quantity still open on the PO (Ordered minus accepted to date).')} <strong>${escapeHtml(line.outstanding ?? '—')}</strong></span>
                </div>
            </div>

            <div class="rn-field">
                <label>Product ${rnInfoTip('Link the catalogue Product for this line. Required on every received line before you can Post.')}${productMissing ? ' <span class="rn-req">Required</span>' : ''}</label>
                <input type="text" class="rn-product-search form-input${productLabel ? ' is-selected' : ''}" placeholder="Search Product name or ID..." value="${escapeHtml(productSearchValue)}" autocomplete="off">
                <input type="hidden" class="rn-product-id" value="${escapeHtml(line.productId || '')}">
                <div class="rn-product-hits"></div>
                <div class="rn-product-chosen ms-mono"${productLabel ? ' style="display:none;"' : ''}>${escapeHtml(productLabel)}</div>
            </div>

            <div class="rn-qty-row">
                <div class="rn-qty-cell">
                    <span class="rn-qty-label">Received ${rnInfoTip('Total units received this Receipt. Must equal Accepted + Rejected + Damaged. Use + / − or type a value.')}</span>
                    <div class="rn-qty-stepper">
                        <button type="button" class="rn-qty-btn rn-qty-dec" aria-label="Decrease received">−</button>
                        <input type="number" min="0" step="1" class="rn-received rn-qty-input form-input" value="${escapeHtml(line.qtyReceived ?? 0)}">
                        <button type="button" class="rn-qty-btn rn-qty-inc" aria-label="Increase received">+</button>
                    </div>
                </div>
                <div class="rn-qty-cell">
                    <span class="rn-qty-label">Accepted ${rnInfoTip('Units accepted into stock. Posting creates Inventory or Assets for this quantity.')}</span>
                    <input type="number" min="0" step="1" class="rn-accepted rn-qty-input form-input" value="${escapeHtml(line.qtyAccepted ?? 0)}">
                </div>
                <div class="rn-qty-cell">
                    <span class="rn-qty-label">Rejected ${rnInfoTip('Units rejected (not taken into stock). Counts toward Received but creates no holding.')}</span>
                    <input type="number" min="0" step="1" class="rn-rejected rn-qty-input form-input" value="${escapeHtml(line.qtyRejected ?? 0)}">
                </div>
                <div class="rn-qty-cell">
                    <span class="rn-qty-label">Damaged ${rnInfoTip('Units received damaged. Counts toward Received; not posted as good stock.')}</span>
                    <input type="number" min="0" step="1" class="rn-damaged rn-qty-input form-input" value="${escapeHtml(line.qtyDamaged ?? 0)}">
                </div>
            </div>
            <div class="rn-eq-msg" hidden></div>

            <div class="rn-holding-panel" style="display:none;">
                <div class="rn-holding-title">Create holding ${rnInfoTip('Choose Inventory or Asset, then open the form with this line’s Product filled in. Stock is created only when you Post the Receipt.')}</div>

                <div class="rn-mode-row">
                    <label class="rn-mode-option"><input type="radio" name="rn-mode-${index}" class="rn-mode" value="INVENTORY" ${checked('INVENTORY') || (!line.creationMode ? 'checked' : '')}> Inventory ${rnInfoTip('One quantity-tracked inventory record (single QR) for the accepted quantity.')}</label>
                    <label class="rn-mode-option"><input type="radio" name="rn-mode-${index}" class="rn-mode" value="ASSET_GROUPED" ${checked('ASSET_GROUPED')}> Asset ${rnInfoTip('One grouped asset record holding the accepted quantity (single QR).')}</label>
                    <label class="rn-mode-option"><input type="radio" name="rn-mode-${index}" class="rn-mode" value="ASSET_INDIVIDUAL" ${checked('ASSET_INDIVIDUAL')}> Individual Assets ${rnInfoTip('Creates one asset (and QR) per accepted unit.')}</label>
                </div>

                <div class="rn-holding-target" style="display:none;">
                    <div class="rn-holding-target-title">Stock target ${rnInfoTip('When this Product already has stock, add accepted quantity to that holding instead of creating a duplicate record.')}</div>
                    <div class="rn-target-mode-row">
                        <label class="rn-mode-option"><input type="radio" name="rn-target-${index}" class="rn-target-action" value="ADD_EXISTING" ${preferAddExisting ? 'checked' : ''}> Add to existing</label>
                        <label class="rn-mode-option"><input type="radio" name="rn-target-${index}" class="rn-target-action" value="CREATE_NEW" ${!preferAddExisting ? 'checked' : ''}> Create new</label>
                    </div>
                    <div class="rn-target-existing" style="display:none;">
                        <select class="rn-target-select form-input"><option value="">Loading holdings…</option></select>
                        <div class="rn-target-empty-hint" hidden></div>
                        <label class="rn-field-label" style="margin-top:8px;display:block;">Or paste existing ID</label>
                        <input type="text" class="rn-target-id form-input" placeholder="Asset / Inventory ID" value="${escapeHtml(targetResourceId)}" autocomplete="off">
                    </div>
                </div>

                <div class="rn-holding-summary" id="">
                    <div class="rn-holding-summary-text">${holdingConfiguredSummaryHtml(holding, mode, invFolder, invKind, assetFolderId, assetKind)}</div>
                    <button type="button" class="action-button blue rn-open-holding-modal">Open ${mode === 'INVENTORY' ? 'Inventory' : 'Asset'} form</button>
                </div>

                <!-- Staged fields for collectLinesFromEditor (filled by modal) -->
                <div class="rn-holding-staged" hidden aria-hidden="true">
                    <select class="rn-folder">${invFolderOptionsHtml(invFolder)}</select>
                    <select class="rn-kind">${invKindOptionsHtml(invFolder, invKind)}</select>
                    <select class="rn-asset-folder">${assetFolderOptionsHtml(assetFolderId)}</select>
                    <select class="rn-asset-kind">${assetKindOptionsHtml(assetFolderId, assetKind)}</select>
                    <select class="rn-asset-make">${assetMakeOptionsHtml(assetKind, assetMake)}</select>
                    <input class="rn-item-name" value="${escapeHtml(holding.itemName || holding.itemname || title)}">
                    <input class="rn-item-unit" value="${escapeHtml(holding.unit || line.unit || line.unitSnapshot || 'Nos')}">
                    <textarea class="rn-item-description">${escapeHtml(holding.description || '')}</textarea>
                    <input class="rn-item-make" value="${escapeHtml(holding.make || '')}">
                    <input class="rn-item-model" value="${escapeHtml(holding.model || '')}">
                    <input class="rn-item-location" value="${escapeHtml(locationDefault)}">
                    <select class="rn-purpose">
                        <option value="Owned" ${(!holding.purpose || holding.purpose === 'Owned') ? 'selected' : ''}>Owned</option>
                        <option value="Rental" ${holding.purpose === 'Rental' ? 'selected' : ''}>Rental</option>
                        <option value="Demo" ${holding.purpose === 'Demo' ? 'selected' : ''}>Demo</option>
                    </select>
                    <input class="rn-item-serial" value="${escapeHtml(holding.serialNo || holding.srno || '')}">
                    <input type="hidden" class="rn-holding-ready" value="${holdingIsReady(holding, mode, invFolder, invKind, assetFolderId, assetKind) ? '1' : '0'}">
                </div>
            </div>
        </div>`;
}

function bindLineCard(card, lineContext) {
    const outstanding = num(card.getAttribute('data-outstanding') || lineContext?.outstanding);
    const received = card.querySelector('.rn-received');
    const accepted = card.querySelector('.rn-accepted');
    const rejected = card.querySelector('.rn-rejected');
    const damaged = card.querySelector('.rn-damaged');
    const msg = card.querySelector('.rn-eq-msg');

    const recast = () => {
        const prevAccepted = num(card.dataset.rnPrevAccepted || '0');
        const a = num(accepted.value);
        const j = num(rejected.value);
        const d = num(damaged.value);
        const r = num(received.value);
        const sum = a + j + d;

        if (card.dataset.rnSyncReceived !== '1') {
            received.value = String(sum);
        }

        if (msg) {
            if (sum > r) {
                msg.hidden = false;
                msg.classList.add('is-error');
                msg.textContent = `Accepted + Rejected + Damaged (${sum}) cannot exceed Received (${r}).`;
            } else if (outstanding > 0 && a > outstanding) {
                msg.hidden = false;
                msg.classList.add('is-error');
                msg.textContent = `Accepted exceeds remaining PO quantity (${outstanding}).`;
            } else if (r > 0 && sum < r) {
                msg.hidden = false;
                msg.classList.remove('is-error');
                msg.textContent = `${r - sum} unallocated — add to Accepted, Rejected, or Damaged.`;
            } else {
                msg.hidden = true;
                msg.classList.remove('is-error');
                msg.textContent = '';
            }
        }
        syncHoldingPanel(card);
        if (a > 0 && prevAccepted <= 0) {
            const action = card.querySelector('.rn-target-action:checked')?.value || 'CREATE_NEW';
            if (action !== 'ADD_EXISTING') {
                openHoldingModalForCard(card).catch((err) => toastOperatorError(err));
            }
        }
        card.dataset.rnPrevAccepted = String(a);
    };

    [accepted, rejected, damaged].forEach((input) => input?.addEventListener('input', recast));
    received?.addEventListener('input', () => {
        card.dataset.rnSyncReceived = '1';
        let r = num(received.value);
        let j = num(rejected.value);
        let d = num(damaged.value);
        if (j + d > r) {
            let overflow = j + d - r;
            if (d > 0) {
                const cut = Math.min(d, overflow);
                d -= cut;
                overflow -= cut;
                damaged.value = String(d);
            }
            if (overflow > 0 && j > 0) {
                j = Math.max(0, j - overflow);
                rejected.value = String(j);
            }
        }
        accepted.value = String(Math.max(0, r - j - d));
        delete card.dataset.rnSyncReceived;
        recast();
    });
    const bumpReceived = (delta) => {
        if (!received) return;
        received.value = String(Math.max(0, num(received.value) + delta));
        received.dispatchEvent(new Event('input', { bubbles: true }));
    };
    card.querySelector('.rn-qty-dec')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bumpReceived(-1);
    });
    card.querySelector('.rn-qty-inc')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bumpReceived(1);
    });
    bindInfoTips(card);
    recast();

    card.querySelectorAll('.rn-mode').forEach((input) => {
        input.addEventListener('change', () => {
            syncHoldingPanel(card);
            refreshProductHoldings(card).catch(() => refreshHoldingSummary(card));
            const action = card.querySelector('.rn-target-action:checked')?.value || 'CREATE_NEW';
            if (action !== 'ADD_EXISTING') {
                openHoldingModalForCard(card).catch((err) => toastOperatorError(err));
            }
        });
    });

    card.querySelectorAll('.rn-target-action').forEach((input) => {
        input.addEventListener('change', () => {
            card.dataset.rnHoldingAction = input.value;
            syncTargetPanelVisibility(card);
            refreshHoldingSummary(card);
            if (input.value === 'CREATE_NEW' && num(card.querySelector('.rn-accepted')?.value) > 0) {
                openHoldingModalForCard(card).catch((err) => toastOperatorError(err));
            }
        });
    });
    card.querySelector('.rn-target-select')?.addEventListener('change', () => {
        const select = card.querySelector('.rn-target-select');
        const idInput = card.querySelector('.rn-target-id');
        if (select) {
            card.dataset.rnTargetResourceId = select.value || '';
            if (idInput && select.value) idInput.value = select.value;
            if (select.value) applyHoldingTargetToMode(card, select.value);
        }
        refreshHoldingSummary(card);
    });
    card.querySelector('.rn-target-id')?.addEventListener('input', () => {
        const idInput = card.querySelector('.rn-target-id');
        const value = idInput?.value?.trim() || '';
        card.dataset.rnTargetResourceId = value;
        if (value) applyHoldingTargetToMode(card, value);
        refreshHoldingSummary(card);
    });

    card.querySelector('.rn-open-holding-modal')?.addEventListener('click', () => {
        openHoldingModalForCard(card).catch((err) => toastOperatorError(err));
    });

    const search = card.querySelector('.rn-product-search');
    const hits = card.querySelector('.rn-product-hits');
    const hidden = card.querySelector('.rn-product-id');
    const chosen = card.querySelector('.rn-product-chosen');
    const productId = hidden?.value;
    if (productId) {
        api(`/api/products/${encodeURIComponent(productId)}`).then((data) => {
            const product = data.product || data;
            applyProductPick(card, product, { search, hidden, hits, chosen });
        }).catch(() => {
            refreshProductHoldings(card).catch(() => {});
        });
    }
    refreshProductHoldings(card).catch(() => {});

    let timer = null;
    search?.addEventListener('input', () => {
        search.classList.remove('is-selected');
        if (hidden) hidden.value = '';
        card.setAttribute('data-product-id', '');
        if (chosen) {
            chosen.style.display = '';
            chosen.textContent = '';
        }
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = search.value.trim();
            if (!q) {
                if (hits) hits.innerHTML = '';
                refreshProductHoldings(card).catch(() => {});
                return;
            }
            try {
                const data = await api(`/api/products?q=${encodeURIComponent(q)}&status=ACTIVE&limit=24`);
                productHits = (data.products || [])
                    .map((p) => ({ p, score: scoreProductMatch(p, q) }))
                    .filter((row) => row.score > 0)
                    .sort((a, b) => b.score - a.score || String(a.p.name || '').localeCompare(String(b.p.name || '')))
                    .slice(0, 8)
                    .map((row) => row.p);
                renderProductHits(hits, productHits, (product) => {
                    applyProductPick(card, product, { search, hidden, hits, chosen });
                });
            } catch (err) {
                if (hits) hits.innerHTML = `<div class="rn-product-hit-empty" style="color:#b91c1c;">${escapeHtml(err.message)}</div>`;
            }
        }, 200);
    });
    search?.addEventListener('focus', () => {
        if (search.value.trim()) search.dispatchEvent(new Event('input'));
    });
}

function collectLinesFromEditor() {
    return Array.from(document.querySelectorAll('#rnEditorLines .rn-line-card')).map((card) => {
        const mode = card.querySelector('.rn-mode:checked')?.value || 'INVENTORY';
        const assetFolderSelect = card.querySelector('.rn-asset-folder');
        const assetKindSelect = card.querySelector('.rn-asset-kind');
        const assetMakeSelect = card.querySelector('.rn-asset-make');
        const assetFolder = assetFolderById(assetFolderSelect?.value);
        const assetKindName = assetKindSelect?.value || '';
        const brandCategory = assetMakeSelect?.value || '';
        const typeName = brandCategory || assetKindName;

        const qtyAccepted = num(card.querySelector('.rn-accepted')?.value);
        const qtyRejected = num(card.querySelector('.rn-rejected')?.value);
        const qtyDamaged = num(card.querySelector('.rn-damaged')?.value);
        const qtyReceived = qtyAccepted + qtyRejected + qtyDamaged;
        const targetAction = card.querySelector('.rn-target-action:checked')?.value || 'CREATE_NEW';
        const targetSelect = card.querySelector('.rn-target-select');
        const targetOption = targetSelect?.selectedOptions?.[0];
        const targetResourceId = resolveTargetResourceId(card);
        const targetResourceType = targetOption?.getAttribute('data-type') || targetResourceTypeForMode(mode);

        return {
            poLineId: card.getAttribute('data-po-line-id'),
            productId: card.querySelector('.rn-product-id')?.value || null,
            qtyReceived,
            qtyAccepted,
            qtyRejected,
            qtyDamaged,
            creationMode: mode,
            unit: card.querySelector('.rn-item-unit')?.value || null,
            folderId: mode === 'INVENTORY' ? (card.querySelector('.rn-folder')?.value || null) : null,
            kindId: mode === 'INVENTORY'
                ? (card.querySelector('.rn-kind')?.value || null)
                : (typeName || null),
            physicalMarkings: {
                holding: {
                    holdingAction: targetAction,
                    targetResourceType: targetAction === 'ADD_EXISTING' ? targetResourceType : '',
                    targetResourceId: targetAction === 'ADD_EXISTING' ? targetResourceId : '',
                    itemName: card.querySelector('.rn-item-name')?.value || '',
                    description: card.querySelector('.rn-item-description')?.value || '',
                    make: card.querySelector('.rn-item-make')?.value || '',
                    model: card.querySelector('.rn-item-model')?.value || '',
                    serialNo: card.querySelector('.rn-item-serial')?.value || '',
                    purpose: card.querySelector('.rn-purpose')?.value || 'Owned',
                    location: card.querySelector('.rn-item-location')?.value || el('rnEditLocation')?.value || '',
                    unit: card.querySelector('.rn-item-unit')?.value || '',
                    parentFolderId: mode === 'INVENTORY' ? '' : (assetFolderSelect?.value || ''),
                    parentFolder: mode === 'INVENTORY' ? '' : (assetFolder ? rowName(assetFolder) : ''),
                    assetKind: mode === 'INVENTORY' ? '' : assetKindName,
                    brandCategory: mode === 'INVENTORY' ? '' : brandCategory,
                    type: mode === 'INVENTORY' ? '' : typeName,
                    category: mode === 'INVENTORY' ? '' : typeName
                },
                serials: []
            }
        };
    });
}

function validateEditorLines(lines, { requireReceived = false } = {}) {
    const active = lines.filter((line) => line.qtyReceived > 0);
    if (requireReceived && !active.length) {
        showToast('Enter received quantity on at least one line', 'error');
        return null;
    }
    const badQty = active.find((line) => {
        const sum = line.qtyAccepted + line.qtyRejected + line.qtyDamaged;
        return line.qtyReceived !== sum || sum > line.qtyReceived;
    });
    if (badQty) {
        showToast('Received must equal Accepted + Rejected + Damaged on every line.', 'error');
        return null;
    }
    const over = active.find((line) => {
        const card = Array.from(document.querySelectorAll('#rnEditorLines .rn-line-card'))
            .find((node) => String(node.getAttribute('data-po-line-id')) === String(line.poLineId));
        const outstanding = num(card?.getAttribute('data-outstanding'));
        return outstanding > 0 && line.qtyAccepted > outstanding;
    });
    if (over) {
        showToast('Over-receipt is rejected. Reduce accepted quantity.', 'error');
        return null;
    }
    const missingProduct = active.find((line) => !line.productId);
    if (missingProduct) {
        showToast('Product Required on every received line.', 'error');
        return null;
    }
    const missingTarget = active.find((line) => {
        if (!(line.qtyAccepted > 0) || line.creationMode === 'ASSET_INDIVIDUAL') return false;
        const holding = line.physicalMarkings?.holding || {};
        return isAddToExistingAction(holding) && !(holding.targetResourceId || holding.targetId);
    });
    if (missingTarget) {
        showToast('Choose an existing holding to add quantity to, or switch to Create new.', 'error');
        return null;
    }
    const missingInv = active.find((line) => {
        if (!(line.qtyAccepted > 0) || line.creationMode !== 'INVENTORY') return false;
        const holding = line.physicalMarkings?.holding || {};
        if (isAddToExistingAction(holding)) return false;
        return !line.folderId || !line.kindId;
    });
    if (missingInv) {
        showToast('Choose Folder and Category for accepted Inventory.', 'error');
        return null;
    }
    const missingAsset = active.find((line) => {
        if (!(line.qtyAccepted > 0) || line.creationMode === 'INVENTORY') return false;
        const holding = line.physicalMarkings?.holding || {};
        if (isAddToExistingAction(holding)) return false;
        return !holding.parentFolder || !holding.assetKind;
    });
    if (missingAsset) {
        showToast('Choose Parent Folder and Category for accepted Assets.', 'error');
        return null;
    }
    return lines;
}

async function saveOpenReceipt(noteId, { requireReceived = false } = {}) {
    const invoice = String(el('rnEditVendorInvoice')?.value || '').trim();
    if (!invoice) {
        showToast('Invoice number is required', 'error');
        el('rnEditVendorInvoice')?.focus();
        return false;
    }
    const lines = validateEditorLines(collectLinesFromEditor(), { requireReceived });
    if (!lines) return false;
    await api(`/api/receipt-notes/${encodeURIComponent(noteId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            vendorInvoiceNo: invoice,
            deliveryNoteNo: el('rnEditDeliveryNote')?.value || null,
            receivedAtLocation: el('rnEditLocation')?.value || null,
            lines
        })
    });
    showToast('Receipt saved', 'success');
    return true;
}

function readOnlyLinesHtml(lines) {
    if (!lines.length) {
        return '<tr><td colspan="7" class="rn-sheet-empty">No lines</td></tr>';
    }
    return lines.map((line, index) => `
        <tr>
            <td class="rn-sheet-idx">${index + 1}</td>
            <td>
                <div class="rn-sheet-name">${escapeHtml(lineDisplayTitle(line))}</div>
                <div class="rn-sheet-sub">${line.productId ? `<span class="ms-mono">${escapeHtml(line.productId)}</span>` : '<span class="rn-req">Product required</span>'}${line.creationMode ? ` · ${escapeHtml(line.creationMode)}` : ''}</div>
            </td>
            <td class="rn-sheet-num">${escapeHtml(line.orderedQtySnapshot ?? '—')}</td>
            <td class="rn-sheet-num">${escapeHtml(line.qtyReceived ?? '—')}</td>
            <td class="rn-sheet-num">${escapeHtml(line.qtyAccepted ?? '—')}</td>
            <td class="rn-sheet-num">${escapeHtml(line.qtyRejected ?? '—')}</td>
            <td class="rn-sheet-num">${escapeHtml(line.qtyDamaged ?? '—')}</td>
        </tr>
    `).join('');
}

async function openReceiptDetail(id) {
    const host = el('receiptsContent');
    if (!host) return;
    const data = await api(`/api/receipt-notes/${encodeURIComponent(id)}`);
    const note = data.receiptNote;
    const lines = data.lines || [];
    const outputs = data.outputs || [];
    const events = data.events || [];
    const mutate = canMutateReceipts();
    const isOpen = note.status === 'OPEN';
    const isPosted = note.status === 'POSTED';

    if (isOpen && mutate) {
        await loadReceiptHierarchy();
    }

    const isReturn = String(note.inwardKind || '').toUpperCase() === 'RETURN_INWARD';
    const editable = isOpen && mutate && !isReturn;
    const receivedLabel = note.receivedAt ? String(note.receivedAt).slice(0, 16).replace('T', ' ') : '—';
    const landLabel = note.returnHome === 'ASSET'
        ? `Asset · ${note.returnLocation || '—'}`
        : note.returnHome === 'INVENTORY'
            ? `Inventory · ${note.returnLocation || '—'}`
            : 'Origin place';
    const fact = (label, value) => `<label>${label}<div class="rn-sheet-fact">${escapeHtml(value || '—')}</div></label>`;
    const inputFact = (label, id, value, placeholder, required) => `
        <label>${label}<input id="${id}" class="form-input${required ? ' rn-invoice-required' : ''}" value="${escapeHtml(value || '')}"${placeholder ? ` placeholder="${placeholder}"` : ''}${required ? ' required' : ''}></label>`;
    const lineTable = (body, foot) => `
        <table class="rn-sheet-table">
            <thead>
                <tr>
                    <th class="rn-sheet-idx">#</th>
                    <th>Particulars</th>
                    <th class="rn-sheet-num">Ordered</th>
                    <th class="rn-sheet-num">Received</th>
                    <th class="rn-sheet-num">Accepted</th>
                    <th class="rn-sheet-num">Rejected</th>
                    <th class="rn-sheet-num">Damaged</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
            ${foot || ''}
        </table>`;
    const totals = `
        <tfoot>
            <tr>
                <td></td>
                <td>Total</td>
                <td></td>
                <td class="rn-sheet-num">${escapeHtml(String(lines.reduce((s, line) => s + num(line.qtyReceived), 0)))}</td>
                <td class="rn-sheet-num">${escapeHtml(String(lines.reduce((s, line) => s + num(line.qtyAccepted), 0)))}</td>
                <td class="rn-sheet-num">${escapeHtml(String(lines.reduce((s, line) => s + num(line.qtyRejected), 0)))}</td>
                <td class="rn-sheet-num">${escapeHtml(String(lines.reduce((s, line) => s + num(line.qtyDamaged), 0)))}</td>
            </tr>
        </tfoot>`;
    const physicalHtml = isReturn
        ? (isPosted
            ? `<ul class="rn-sheet-list">${lines.map((l) => `<li>${escapeHtml(l.resourceType || '')} <span class="ms-mono">${escapeHtml(l.resourceId || l.itemDescriptionSnapshot || '')}</span>${l.serialSnapshot ? ` · SN ${escapeHtml(l.serialSnapshot)}` : ''} × ${escapeHtml(l.qtyAccepted ?? l.qtyReceived ?? '')}</li>`).join('')}</ul>`
            : '<p class="rn-sheet-empty">No physical restoration until this return is posted.</p>')
        : (outputs.length ? `<ul class="rn-sheet-list">${outputs.map((o) => {
            const view = String(o.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
            const qr = String(o.resourceType).toUpperCase() === 'INVENTORY'
                ? `/api/qr/dynamic/inventory/${encodeURIComponent(o.resourceId)}`
                : `/api/qr/${encodeURIComponent(o.resourceId)}`;
            return `<li>${escapeHtml(o.resourceType)}
                <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(o.resourceId)}">${escapeHtml(o.resourceId)}</button>
                × ${escapeHtml(o.quantity)}
                · <a href="${qr}" target="_blank" rel="noopener">QR</a></li>`;
        }).join('')}</ul>` : '<p class="rn-sheet-empty">None until this receipt is posted.</p>');

    host.innerHTML = `
        <div class="rn-bar">
            <button type="button" class="action-button grey" id="btnReceiptBack">← Receipts</button>
            <span class="rn-bar-spacer"></span>
            ${editable ? '<button type="button" class="action-button blue" id="btnReceiptSave">Save</button>' : ''}
            ${isOpen && mutate ? '<button type="button" class="action-button green" id="btnReceiptPost">Post</button>' : ''}
            ${isOpen && mutate ? '<button type="button" class="action-button grey" id="btnReceiptCancel">Cancel</button>' : ''}
            ${isPosted && mutate && note.canReverse && !isReturn ? '<button type="button" class="action-button grey" id="btnReceiptReverse">Reverse</button>' : ''}
        </div>
        <article class="rn-sheet">
            <header class="rn-sheet-head">
                <div>
                    <div class="rn-sheet-kicker">${isReturn ? 'Return Inward' : 'Receipt Note'}</div>
                    <h2 class="rn-sheet-vendor">${escapeHtml(note.vendorName || (isReturn ? 'Return' : 'Vendor'))}</h2>
                    <div class="rn-sheet-id">${escapeHtml(note.id)}</div>
                </div>
                <div class="rn-sheet-facts">
                    <div class="rn-sheet-stamps">
                        <span class="${statusChipClass(note.status)}">${escapeHtml(note.status)}</span>
                        ${isReturn
                            ? '<span class="ms-chip" style="background:#dbeafe;color:#1e40af;">Return</span>'
                            : `<span class="${projectionChip(note.projectionStatus)}">${escapeHtml(note.projectionStatus || '—')}</span>`}
                    </div>
                    ${editable
                        ? inputFact('Invoice', 'rnEditVendorInvoice', note.vendorInvoiceNo, '', true)
                        : fact('Invoice', note.vendorInvoiceNo)}
                    ${isReturn
                        ? fact('Originating DC', note.deliveryNoteNo || note.deliveryChallanId)
                        : (editable
                            ? inputFact('Delivery note', 'rnEditDeliveryNote', note.deliveryNoteNo)
                            : fact('Delivery note', note.deliveryNoteNo))}
                    ${editable
                        ? inputFact('Location', 'rnEditLocation', note.receivedAtLocation, 'Mumbai')
                        : fact('Location', note.receivedAtLocation)}
                    ${isReturn ? fact('Return log', note.returnLogId) : fact('Purchase Order', note.poNumber || note.poId)}
                    ${fact('Received', receivedLabel)}
                </div>
            </header>
            ${isReturn ? `
                <div class="rn-sheet-note">
                    <span>Return</span>
                    <div>${escapeHtml(note.returnReason || '—')} · Returned by ${escapeHtml(note.returnedByParty || '—')} · Lands ${escapeHtml(landLabel)}. Not a vendor purchase. Quantity on the purchase order stays as it is. Stock is restored only when this note is posted.</div>
                </div>` : (note.projectionSkipReason ? `<div class="rn-warn">Zoho projection skipped: ${escapeHtml(note.projectionSkipReason)}. No GRN exists.</div>` : '')}
            ${isReturn || !(isOpen && mutate)
                ? lineTable(readOnlyLinesHtml(lines), totals)
                : `<div id="rnEditorLines" class="rn-sheet-lines">${lines.map((line, i) => lineEditorHtml(line, i, note)).join('')}</div>`}
            <section class="rn-sheet-foot">
                <div class="rn-sheet-kicker">${isReturn ? 'Physical restoration' : 'Physical records'}</div>
                ${physicalHtml}
            </section>
            <section class="rn-sheet-foot">
                <div class="rn-sheet-kicker">History</div>
                ${events.length
                    ? `<ul class="rn-sheet-list">${events.map((ev) => `<li>${escapeHtml(ev.type)} · ${escapeHtml(ev.actor || '—')} · ${escapeHtml(ev.timestamp ? String(ev.timestamp).slice(0, 19).replace('T', ' ') : '')}</li>`).join('')}</ul>`
                    : '<p class="rn-sheet-empty">No events yet.</p>'}
            </section>
        </article>`;

    if (isOpen && mutate) {
        host.querySelectorAll('#rnEditorLines .rn-line-card').forEach((card, i) => bindLineCard(card, lines[i]));
    }
    bindInfoTips(host);

    el('btnReceiptBack')?.addEventListener('click', () => renderReceiptList().catch((err) => showToast(err.message, 'error')));
    el('btnReceiptSave')?.addEventListener('click', async () => {
        try {
            await saveOpenReceipt(note.id);
            await openReceiptDetail(note.id);
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnReceiptPost')?.addEventListener('click', async () => {
        try {
            if (String(note.inwardKind || '').toUpperCase() === 'RETURN_INWARD') {
                await confirmAndPost(note, lines);
                return;
            }
            const ok = await saveOpenReceipt(note.id, { requireReceived: true });
            if (!ok) return;
            const refreshed = await api(`/api/receipt-notes/${encodeURIComponent(note.id)}`);
            await confirmAndPost(refreshed.receiptNote, refreshed.lines || []);
        } catch (err) {
            toastOperatorError(err);
        }
    });
    el('btnReceiptCancel')?.addEventListener('click', async () => {
        if (!confirm('Cancel this OPEN Receipt Note? No physical stock will be created.')) return;
        try {
            await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-cancel') },
                body: '{}'
            });
            showToast('Receipt cancelled', 'success');
            await openReceiptDetail(note.id);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    el('btnReceiptReverse')?.addEventListener('click', async () => {
        if (!confirm('Reverse this posted Receipt Note?\nPhysical identities are preserved. Quantity will be adjusted to zero if still reversible.')) return;
        try {
            await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/reverse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-rev') },
                body: '{}'
            });
            showToast('Receipt reversed. Physical IDs preserved.', 'success');
            await openReceiptDetail(note.id);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function previewHtml(note, lines) {
    return lines.map((line) => {
        const accepted = num(line.qtyAccepted);
        const mode = line.creationMode || '—';
        let physical = 'No physical stock (accepted = 0)';
        if (accepted > 0 && mode === 'INVENTORY') physical = `Inventory ×${accepted} (1 QR)`;
        else if (accepted > 0 && mode === 'ASSET_GROUPED') physical = `Grouped Asset ×${accepted} (1 QR)`;
        else if (accepted > 0 && mode === 'ASSET_INDIVIDUAL') physical = `Individual Assets ×${accepted} (${accepted} QR)`;
        return `${escapeHtml(lineDisplayTitle(line))}
Ordered ${escapeHtml(line.orderedQtySnapshot)} · Previously accepted ${escapeHtml(line.acceptedToDate ?? '—')}
This receipt: received ${escapeHtml(line.qtyReceived)} accepted ${escapeHtml(line.qtyAccepted)} damaged ${escapeHtml(line.qtyDamaged)} rejected ${escapeHtml(line.qtyRejected)}
Physical: ${physical}`;
    }).join('\n\n');
}

async function confirmAndPost(note, lines) {
    if (String(note.inwardKind || '').toUpperCase() === 'RETURN_INWARD') {
        if (!confirm(`Post Return Inward ${note.id}?\n\nThis restores physical holdings for Return Log ${note.returnLogId || '—'}.\nOriginating DC: ${note.deliveryNoteNo || note.deliveryChallanId || '—'}\nReturn Reason: ${note.returnReason || '—'}\nReturned By: ${note.returnedByParty || '—'}\nReceived By: ${note.receivedByUser || note.receivedBy || '—'}`)) return;
        try {
            const data = await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/post`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-post') },
                body: '{}'
            });
            showToast(`Posted Return Inward ${data.receiptNote?.id || note.id}`, 'success');
            await openReceiptDetail(note.id);
        } catch (err) {
            toastOperatorError(err);
        }
        return;
    }
    const missing = lines.filter((line) => num(line.qtyReceived) > 0 && !line.productId);
    if (missing.length) {
        showToast('Product Required on every received line before POST. Use the Product catalogue to create/link a Product first.', 'error');
        return;
    }
    const acceptedTotal = lines.reduce((s, line) => s + num(line.qtyAccepted), 0);
    const damagedTotal = lines.reduce((s, line) => s + num(line.qtyDamaged), 0);
    const rejectedTotal = lines.reduce((s, line) => s + num(line.qtyRejected), 0);
    const text = previewHtml(note, lines);
    if (!confirm(`Posting this Receipt Note will create the accepted physical stock.\n\nAccepted: ${acceptedTotal}\nDamaged: ${damagedTotal}\nRejected: ${rejectedTotal}\n\n${text}`)) return;
    try {
        const data = await api(`/api/receipt-notes/${encodeURIComponent(note.id)}/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-post') },
            body: '{}'
        });
        showToast(`Posted ${data.receiptNote?.id || note.id}`, 'success');
        await openReceiptDetail(note.id);
    } catch (err) {
        toastOperatorError(err);
    }
}

/** Slim create: pick PO + meta, create OPEN draft with qty 0 lines, open editor. */
async function renderCreateForm(preselectPoId) {
    const host = el('receiptsContent');
    if (!host) return;
    if (!canMutateReceipts()) {
        showToast('Sales cannot create Receipt Notes', 'error');
        return;
    }
    const orders = await api('/api/procurement/pos?limit=200');
    const list = orders.purchaseOrders || [];
    const pre = String(preselectPoId || '').trim();
    host.innerHTML = `
        <div class="rn-bar">
            <button type="button" class="action-button grey" id="btnReceiptBackCreate">← Receipts</button>
            <span class="rn-bar-spacer"></span>
            <button type="button" class="action-button green" id="btnReceiptCreateDraft">Open draft</button>
        </div>
        <article class="rn-sheet">
            <header class="rn-sheet-head">
                <div>
                    <div class="rn-sheet-kicker">Receipt Note</div>
                    <h2 class="rn-sheet-vendor">New receipt</h2>
                    <div class="rn-sheet-id">Quantities start at zero. You enter them on the next page.</div>
                </div>
                <div class="rn-sheet-facts">
                    <label>Purchase Order ${rnInfoTip('Opens a draft from this order’s lines.')}
                        <select id="rnPoSelect" class="form-input">
                            <option value="">Select a PO…</option>
                            ${list.map((o) => `<option value="${escapeHtml(o.id)}" data-po-source="${escapeHtml(o.source || 'LOCAL')}" ${pre && String(o.id) === pre ? 'selected' : ''}>${escapeHtml(o.poNumber || o.id)}${o.source === 'ZOHO' ? ' · Zoho' : ' · Legacy'}${o.status ? ` · ${escapeHtml(o.status)}` : ''}</option>`).join('')}
                        </select>
                    </label>
                    <label>Invoice<input id="rnVendorInvoice" class="form-input rn-invoice-required" required></label>
                    <label>Delivery note<input id="rnDeliveryNote" class="form-input"></label>
                    <label>Location<input id="rnLocation" class="form-input" placeholder="Mumbai"></label>
                </div>
            </header>
            <div id="rnPoSummary" class="rn-sheet-note"><span>Order</span><div>Select a purchase order.</div></div>
        </article>`;

    bindInfoTips(host);

    el('btnReceiptBackCreate')?.addEventListener('click', () => renderReceiptList().catch((err) => showToast(err.message, 'error')));
    const onPoChange = async () => {
        const poId = el('rnPoSelect').value;
        const box = el('rnPoSummary');
        if (!poId) {
            const vendor = host.querySelector('.rn-sheet-vendor');
            if (vendor) vendor.textContent = 'New receipt';
            box.innerHTML = '<span>Order</span><div>Select a purchase order.</div>';
            return;
        }
        try {
            const balance = await api(`/api/purchase-orders/${encodeURIComponent(poId)}/receipt-balance`);
            const count = (balance.lines || []).length;
            const vendor = host.querySelector('.rn-sheet-vendor');
            if (vendor) vendor.textContent = balance.vendorName || 'Vendor';
            box.innerHTML = `<span>Order</span><div>${escapeHtml(balance.poNumber || poId)} · ${count} line${count === 1 ? '' : 's'}</div>`;
            box.dataset.lineCount = String(count);
        } catch (err) {
            box.textContent = err.message;
        }
    };
    el('rnPoSelect')?.addEventListener('change', onPoChange);
    el('btnReceiptCreateDraft')?.addEventListener('click', submitCreateDraft);
    if (pre) onPoChange().catch(() => {});
}

async function submitCreateDraft() {
    const poId = el('rnPoSelect')?.value;
    const invoice = String(el('rnVendorInvoice')?.value || '').trim();
    if (!poId) { showToast('Select a PO', 'error'); return; }
    if (!invoice) {
        showToast('Invoice number is required', 'error');
        el('rnVendorInvoice')?.focus();
        return;
    }
    try {
        const balance = await api(`/api/purchase-orders/${encodeURIComponent(poId)}/receipt-balance`);
        const poLines = balance.lines || [];
        if (!poLines.length) {
            showToast('This PO has no receivable lines', 'error');
            return;
        }
        const lines = poLines.map((line, index) => ({
            poLineId: line.poLineId,
            productId: line.productId || null,
            qtyReceived: 0,
            qtyAccepted: 0,
            qtyRejected: 0,
            qtyDamaged: 0,
            unit: line.unit || null,
            creationMode: null,
            sortOrder: index
        }));
        const created = await api('/api/receipt-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('rn-create') },
            body: JSON.stringify({
                poId,
                poSource: el('rnPoSelect')?.selectedOptions?.[0]?.getAttribute('data-po-source') || balance.poSource || 'LOCAL',
                vendorInvoiceNo: invoice,
                deliveryNoteNo: el('rnDeliveryNote')?.value || null,
                receivedAtLocation: el('rnLocation')?.value || null,
                lines
            })
        });
        showToast(`OPEN draft ${created.receiptNote?.id}`, 'success');
        await openReceiptDetail(created.receiptNote.id);
    } catch (err) {
        toastOperatorError(err);
    }
}

export function initReceiptsView() {
    if (el('btnCreateReceipt')) {
        el('btnCreateReceipt').style.display = canMutateReceipts() ? '' : 'none';
    }
    const pending = consumeOpen('receipts-view');
    const createFromPo = pending?.createFromPo || pending?.extra?.createFromPo || '';
    const filterPoId = pending?.extra?.poId || '';
    if (filterPoId) window.__receiptPoFilter = filterPoId;
    else window.__receiptPoFilter = '';
    const start = async () => {
        if (createFromPo) {
            await renderCreateForm(createFromPo);
            return;
        }
        if (pending && pending.open) {
            await openReceiptDetail(pending.open);
            return;
        }
        const filter = el('receiptStatusFilter');
        const periodFilter = el('receiptPeriodFilter');
        const status = String((pending && pending.extra && pending.extra.status) || '').toUpperCase();
        const period = String((pending && pending.extra && pending.extra.period) || '').toLowerCase();
        if (filter && status === 'OPEN') filter.value = 'OPEN';
        if (filter && status === 'ALL') filter.value = '';
        if (periodFilter && (period === 'month' || period === 'quarter' || period === 'year')) {
            periodFilter.value = period;
        }
        await renderReceiptList(filterPoId);
    };
    if (viewListenersBound) {
        start().catch((err) => toastOperatorError(err));
        return;
    }
    viewListenersBound = true;
    bindInfoTips(el('receipts-view'));
    el('btnReloadReceipts')?.addEventListener('click', () => renderReceiptList().catch((e) => toastOperatorError(e)));
    el('btnCreateReceipt')?.addEventListener('click', () => renderCreateForm().catch((e) => toastOperatorError(e)));
    el('receiptSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderReceiptList().catch((err) => toastOperatorError(err));
    });
    el('receiptStatusFilter')?.addEventListener('change', () => renderReceiptList().catch((err) => toastOperatorError(err)));
    el('receiptPeriodFilter')?.addEventListener('change', () => renderReceiptList().catch((err) => toastOperatorError(err)));
    start().catch((err) => toastOperatorError(err));
}

window.initReceiptsView = initReceiptsView;
window.openReceiptDetail = openReceiptDetail;
