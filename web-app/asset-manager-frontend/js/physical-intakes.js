/**
 * Physical Intake — register existing / non-procurement physical stock.
 * Does not create Assets or Inventory through the legacy add forms.
 */
import { showToast } from './utils.js?v=6.60';
import {
    canLogistics,
    escapeHtml,
    emptyState,
    toastOperatorError,
    formatQty,
    formatWhen,
    dash,
    go,
    consumeOpen,
    lifecycleApi
} from './lifecycle.js?v=7.52';

export const PO_STATUS_LABELS = {
    EXPECTED: 'PO Expected Later',
    NOT_REQUIRED: 'No PO Required',
    AVAILABLE: 'Purchase Order Already Available',
    AWAITING_PO: 'PO Expected Later',
    PO_LINKED: 'Purchase Order linked'
};

export const INTAKE_TYPE_LABELS = {
    OPENING_BALANCE: 'Opening Balance',
    LEGACY_EXISTING_STOCK: 'Legacy Existing Stock',
    EXTERNAL_ACQUISITION: 'External Acquisition',
    INTERNAL_TRANSFER: 'Internal Transfer',
    DONATION: 'Donation',
    NON_PO_ACQUISITION: 'Non-PO Acquisition',
    OTHER_APPROVED: 'Other Approved'
};

export function defaultPoStatusForType(_intakeType) {
    return 'EXPECTED';
}

function poStatusLabel(choiceOrState) {
    return PO_STATUS_LABELS[choiceOrState] || '—';
}

function el(id) {
    return document.getElementById(id);
}

function wizardHost() {
    return document.getElementById('physicalIntakesContent');
}

function canMutate() {
    return canLogistics();
}

async function api(path, options = {}) {
    return lifecycleApi(path, options);
}

function idempotencyKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const wizard = {
    holdingType: '',
    intakeType: '',
    product: null,
    quantity: '',
    unit: '',
    location: 'Mumbai',
    folderId: '',
    folderName: '',
    kindId: '',
    kindName: '',
    category: '',
    reason: '',
    source: {},
    poStatus: 'EXPECTED',
    expectedPoNumber: '',
    expectedVendorRef: '',
    selectedPo: null,
    selectedLine: null,
    result: null
};

let intakeHierarchy = {
    invFolders: [],
    invKinds: [],
    assetFolders: [],
    assetKinds: []
};

function clearHierarchySelection() {
    wizard.folderId = '';
    wizard.folderName = '';
    wizard.kindId = '';
    wizard.kindName = '';
    wizard.category = '';
}

function resetWizard() {
    wizard.holdingType = '';
    wizard.intakeType = '';
    wizard.product = null;
    wizard.quantity = '';
    wizard.unit = '';
    wizard.location = 'Mumbai';
    clearHierarchySelection();
    wizard.reason = '';
    wizard.source = {};
    wizard.poStatus = 'EXPECTED';
    wizard.expectedPoNumber = '';
    wizard.expectedVendorRef = '';
    wizard.selectedPo = null;
    wizard.selectedLine = null;
    wizard.result = null;
}

function rowId(row) {
    return String(row?.id || row?.ID || '');
}

function rowName(row) {
    return String(row?.name || row?.Name || rowId(row));
}

function rowFolderId(row) {
    return String(row?.folderid || row?.FolderId || row?.folderId || '');
}

function rowModule(row) {
    return String(row?.module || row?.Module || '');
}

function assetKindName(row) {
    return String(row?.name || row?.Name || '');
}

function assetKindParent(row) {
    return String(row?.parentname || row?.ParentName || row?.parentName || '');
}

function currentModule() {
    return localStorage.getItem('selectedAssetCategory') || 'IT';
}

function assetFolderById(id) {
    return intakeHierarchy.assetFolders.find((f) => rowId(f) === String(id || ''));
}

function invFolderOptionsHtml(selected) {
    const current = String(selected || '');
    return ['<option value="">Select folder</option>']
        .concat(intakeHierarchy.invFolders.map((folder) => {
            const id = rowId(folder);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(folder))}</option>`;
        }))
        .join('');
}

function invKindOptionsHtml(folderId, selected) {
    const current = String(selected || '');
    const kinds = intakeHierarchy.invKinds.filter((kind) => !folderId || rowFolderId(kind) === String(folderId));
    return ['<option value="">Select category</option>']
        .concat(kinds.map((kind) => {
            const id = rowId(kind);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(kind))}</option>`;
        }))
        .join('');
}

function assetFolderOptionsHtml(selected) {
    const module = currentModule();
    const current = String(selected || '');
    const folders = intakeHierarchy.assetFolders.filter((f) => {
        const mod = rowModule(f);
        return !mod || mod === module;
    });
    return ['<option value="">Select folder</option>']
        .concat(folders.map((folder) => {
            const id = rowId(folder);
            return `<option value="${escapeHtml(id)}" ${id === current ? 'selected' : ''}>${escapeHtml(rowName(folder))}</option>`;
        }))
        .join('');
}

function assetKindOptionsHtml(folderId, selected) {
    const current = String(selected || '');
    const folder = assetFolderById(folderId);
    const folderName = folder ? rowName(folder) : '';
    const kinds = intakeHierarchy.assetKinds.filter((kind) => {
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

async function loadIntakeHierarchy() {
    const [invFolders, invKinds, assetFolders, assetKinds] = await Promise.all([
        api('/api/inventory/folders').catch(() => ({ folders: [] })),
        api('/api/inventory/kinds').catch(() => ({ kinds: [] })),
        api('/api/folders').catch(() => []),
        api('/api/asset_kinds').catch(() => [])
    ]);
    intakeHierarchy = {
        invFolders: invFolders.folders || [],
        invKinds: invKinds.kinds || [],
        assetFolders: Array.isArray(assetFolders) ? assetFolders : (assetFolders.folders || []),
        assetKinds: Array.isArray(assetKinds) ? assetKinds : (assetKinds.kinds || [])
    };
}

export function provenanceHtml(intake, opts = {}) {
    if (!intake) return '';
    const typeLabel = INTAKE_TYPE_LABELS[intake.intakeType] || intake.intakeType || '—';
    const source = intake.sourceSummary || dash(intake.reason);
    const compact = opts.compact ? ' style="margin:12px 0;"' : '';
    const cp = intake.commercialProvenance;
    const out = (intake.outputs || [])[0] || {};
    const resourceType = out.resourceType || intake.holdingType || '';
    const resourceId = out.resourceId || intake.physicalId || '';
    const poLabel = cp ? poStatusLabel(cp.state || cp.poStatusLabel) : '';
    const showLink = !opts.hideLink && cp && cp.state === 'AWAITING_PO' && canMutate() && resourceType && resourceId;
    const showNotRequired = showLink;
    const poBits = cp ? `
            <div><div class="lc-k">Purchase Order Status</div><div>${escapeHtml(cp.poStatusLabel || poLabel || '—')}</div></div>
            ${cp.expectedPoNumber ? `<div><div class="lc-k">Expected PO Number</div><div>${escapeHtml(cp.expectedPoNumber)}</div></div>` : ''}
            ${cp.expectedVendorRef ? `<div><div class="lc-k">Expected vendor / reference</div><div>${escapeHtml(cp.expectedVendorRef)}</div></div>` : ''}
            ${cp.procurementPoId ? `<div><div class="lc-k">Purchase Order</div><div class="lc-mono">${escapeHtml(cp.procurementPoId)}</div></div>` : ''}
            ${cp.procurementPoLineId ? `<div><div class="lc-k">PO Line</div><div class="lc-mono">${escapeHtml(cp.procurementPoLineId)}</div></div>` : ''}
            ${cp.vendorName ? `<div><div class="lc-k">Vendor</div><div>${escapeHtml(cp.vendorName)}</div></div>` : ''}
    ` : '';
    return `<section class="pi-provenance"${compact}>
        <div class="lc-section-label">Origin</div>
        <div class="pi-prov-grid">
            <div><div class="lc-k">Origin</div><div>NON-PROCUREMENT INTAKE</div></div>
            <div><div class="lc-k">Reason</div><div>${escapeHtml(typeLabel)}</div></div>
            <div><div class="lc-k">Source</div><div>${source}</div></div>
            <div><div class="lc-k">Intake</div><div class="lc-mono">${escapeHtml(intake.id || '')}</div></div>
            ${intake.actor ? `<div><div class="lc-k">Registered by</div><div>${escapeHtml(intake.actor)}</div></div>` : ''}
            ${intake.createdAt ? `<div><div class="lc-k">When</div><div>${formatWhen(intake.createdAt)}</div></div>` : ''}
            ${poBits}
        </div>
        <p class="lc-muted" style="margin:8px 0 0;">Physical identity is the Asset or Inventory ID. The Intake ID is an audit reference.</p>
        ${showLink ? `<button type="button" class="action-button blue pi-link-po" style="margin-top:10px;" data-resource-type="${escapeHtml(resourceType)}" data-resource-id="${escapeHtml(resourceId)}" data-intake-id="${escapeHtml(intake.id || '')}">Link Purchase Order</button>` : ''}
        ${showNotRequired ? `<button type="button" class="action-button grey pi-mark-not-required" style="margin-top:10px;margin-left:8px;" data-resource-type="${escapeHtml(resourceType)}" data-resource-id="${escapeHtml(resourceId)}">No PO Required</button>` : ''}
    </section>`;
}

export async function loadProvenance(physicalIntakeId) {
    if (!physicalIntakeId) return null;
    try {
        const data = await api(`/api/physical-intakes/${encodeURIComponent(physicalIntakeId)}`);
        return data.intake || data;
    } catch (_err) {
        return null;
    }
}

function choiceButtons(name, options, selected) {
    return options.map((opt) => {
        const on = selected === opt.value ? ' pi-choice-on' : '';
        return `<button type="button" class="pi-choice${on}" data-pi-field="${escapeHtml(name)}" data-pi-value="${escapeHtml(opt.value)}">
            <strong>${escapeHtml(opt.label)}</strong>
            ${opt.hint ? `<span>${escapeHtml(opt.hint)}</span>` : ''}
        </button>`;
    }).join('');
}

function sourceFieldsHtml() {
    const t = wizard.intakeType;
    if (t === 'OPENING_BALANCE') {
        return `
            <p class="pi-callout">Opening balance — existing physical stock being registered in AssetEngine. This is not a Receipt or Purchase.</p>
            <label class="lc-k">Opening balance note</label>
            <textarea id="piSourceNote" class="form-input" rows="2">${escapeHtml(wizard.source.openingBalanceNote || wizard.reason || '')}</textarea>
            <label class="lc-k">Source date (optional)</label>
            <input type="date" id="piSourceDate" class="form-input" value="${escapeHtml(wizard.source.sourceDate || '')}">
            <label class="lc-k">Legacy reference (optional)</label>
            <input type="text" id="piLegacyRef" class="form-input" value="${escapeHtml(wizard.source.legacyReference || '')}">
        `;
    }
    if (t === 'LEGACY_EXISTING_STOCK') {
        return `
            <label class="lc-k">Legacy ID (optional)</label>
            <input type="text" id="piLegacyId" class="form-input" value="${escapeHtml(wizard.source.legacyId || '')}">
            <label class="lc-k">Source system (optional)</label>
            <input type="text" id="piSourceSystem" class="form-input" value="${escapeHtml(wizard.source.sourceSystem || '')}">
            <label class="lc-k">Legacy description (optional)</label>
            <textarea id="piLegacyDesc" class="form-input" rows="2">${escapeHtml(wizard.source.legacyDescription || '')}</textarea>
        `;
    }
    if (t === 'EXTERNAL_ACQUISITION') {
        return `
            <label class="lc-k">Source / reference document (optional)</label>
            <input type="text" id="piSourceDoc" class="form-input" value="${escapeHtml(wizard.source.sourceDocument || '')}">
            <label class="lc-k">Acquisition date (optional)</label>
            <input type="date" id="piAcqDate" class="form-input" value="${escapeHtml(wizard.source.acquisitionDate || '')}">
            <label class="lc-k">Note (optional)</label>
            <textarea id="piSourceNote" class="form-input" rows="2">${escapeHtml(wizard.source.note || wizard.reason || '')}</textarea>
        `;
    }
    if (t === 'INTERNAL_TRANSFER') {
        return `
            <p class="pi-callout">Internal Transfer here is intake provenance only. It does not create a complete transfer ledger.</p>
            <label class="lc-k">Source location / context (required)</label>
            <input type="text" id="piSourceLocation" class="form-input" required value="${escapeHtml(wizard.source.sourceLocation || '')}">
            <label class="lc-k">Transfer reference (optional)</label>
            <input type="text" id="piTransferRef" class="form-input" value="${escapeHtml(wizard.source.transferReference || '')}">
            <label class="lc-k">Note (optional)</label>
            <textarea id="piSourceNote" class="form-input" rows="2">${escapeHtml(wizard.source.note || '')}</textarea>
        `;
    }
    if (t === 'DONATION') {
        return `
            <label class="lc-k">Donor / reference (optional)</label>
            <input type="text" id="piDonor" class="form-input" value="${escapeHtml(wizard.source.donor || '')}">
            <label class="lc-k">Date (optional)</label>
            <input type="date" id="piDonationDate" class="form-input" value="${escapeHtml(wizard.source.donationDate || '')}">
            <label class="lc-k">Note (optional)</label>
            <textarea id="piSourceNote" class="form-input" rows="2">${escapeHtml(wizard.source.note || wizard.reason || '')}</textarea>
        `;
    }
    if (t === 'NON_PO_ACQUISITION') {
        return `
            <label class="lc-k">Reason (required)</label>
            <textarea id="piReason" class="form-input" rows="3" required>${escapeHtml(wizard.reason || '')}</textarea>
            <label class="lc-k">External reference (optional)</label>
            <input type="text" id="piSourceDoc" class="form-input" value="${escapeHtml(wizard.source.reference || '')}">
        `;
    }
    if (t === 'OTHER_APPROVED') {
        return `
            <label class="lc-k">Explanation / reason (required)</label>
            <textarea id="piReason" class="form-input" rows="3" required>${escapeHtml(wizard.reason || wizard.source.explanation || '')}</textarea>
            <p class="lc-muted">The logged-in Logistics operator is recorded as the approving actor.</p>
        `;
    }
    return '<p class="lc-muted">Select an intake type first.</p>';
}

function collectSource() {
    const t = wizard.intakeType;
    const val = (id) => el(id)?.value?.trim() || '';
    wizard.reason = val('piReason') || val('piSourceNote') || wizard.reason;
    wizard.location = val('piLocation') || wizard.location || 'Mumbai';
    if (t === 'OPENING_BALANCE') {
        wizard.source = {
            openingBalanceNote: val('piSourceNote'),
            sourceDate: val('piSourceDate'),
            legacyReference: val('piLegacyRef')
        };
        wizard.reason = wizard.reason || wizard.source.openingBalanceNote;
    } else if (t === 'LEGACY_EXISTING_STOCK') {
        wizard.source = {
            legacyId: val('piLegacyId'),
            sourceSystem: val('piSourceSystem'),
            legacyDescription: val('piLegacyDesc')
        };
    } else if (t === 'EXTERNAL_ACQUISITION') {
        wizard.source = {
            sourceDocument: val('piSourceDoc'),
            acquisitionDate: val('piAcqDate'),
            note: val('piSourceNote')
        };
        wizard.reason = wizard.reason || wizard.source.note;
    } else if (t === 'INTERNAL_TRANSFER') {
        wizard.source = {
            sourceLocation: val('piSourceLocation'),
            transferReference: val('piTransferRef'),
            note: val('piSourceNote')
        };
    } else if (t === 'DONATION') {
        wizard.source = {
            donor: val('piDonor'),
            donationDate: val('piDonationDate'),
            note: val('piSourceNote')
        };
        wizard.reason = wizard.reason || wizard.source.note;
    } else if (t === 'NON_PO_ACQUISITION') {
        wizard.source = { reference: val('piSourceDoc') };
        wizard.reason = val('piReason');
    } else if (t === 'OTHER_APPROVED') {
        wizard.source = { explanation: val('piReason') };
        wizard.reason = val('piReason');
    }
}

function isAwaitingHash() {
    return String(window.location.hash || '').includes('awaiting=1');
}

async function renderAwaitingAdoptionList() {
    const host = wizardHost();
    if (!host) return;
    const data = await api('/api/physical-intakes/provenance?state=AWAITING_PO&limit=200');
    const items = data.items || [];
    if (el('physicalIntakeCountBadge')) {
        el('physicalIntakeCountBadge').textContent = `${items.length} Awaiting Adoption`;
    }
    if (!items.length) {
        host.innerHTML = emptyState({
            title: 'Nothing awaiting adoption.',
            body: 'Newly registered Physical Intake holdings appear here until an operator links a Purchase Order or marks No PO Required.'
        });
        return;
    }
    host.innerHTML = `
        <p class="lc-muted">Adopted holdings still waiting. Leave them here, mark No PO Required, or link a Purchase Order. Each ID opens the physical holding.</p>
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="text-align:left;border-bottom:1px solid #e5e7eb;color:#667085;">
                    <th style="padding:8px;">Holding</th>
                    <th style="padding:8px;">Type</th>
                    <th style="padding:8px;">Name</th>
                    <th style="padding:8px;">Quantity</th>
                    <th style="padding:8px;">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${items.map((item) => {
                    const view = item.resourceType === 'INVENTORY' ? 'inventory-view' : 'home-view';
                    return `<tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:8px;" class="lc-mono">
                            <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(item.resourceId)}">${escapeHtml(item.resourceId)}</button>
                        </td>
                        <td style="padding:8px;">${escapeHtml(item.resourceType)}</td>
                        <td style="padding:8px;">${escapeHtml(item.holdingName || '—')}</td>
                        <td style="padding:8px;">${escapeHtml(String(item.quantity ?? '—'))}</td>
                        <td style="padding:8px;display:flex;gap:6px;flex-wrap:wrap;">
                            <button type="button" class="action-button blue pi-link-po" data-resource-type="${escapeHtml(item.resourceType)}" data-resource-id="${escapeHtml(item.resourceId)}">Link PO</button>
                            <button type="button" class="action-button grey pi-mark-not-required" data-resource-type="${escapeHtml(item.resourceType)}" data-resource-id="${escapeHtml(item.resourceId)}">No PO Required</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
    bindPhysicalIntakePoLink(host, null, {
        onLinked: () => renderAwaitingAdoptionList().catch((err) => toastOperatorError(err))
    });
}

async function renderIntakeHome() {
    if (isAwaitingHash()) {
        await renderAwaitingAdoptionList();
        return;
    }
    await renderIntakeList();
}

function renderList(intakes) {
    const host = wizardHost();
    if (!host) return;
    if (!intakes.length) {
        host.innerHTML = emptyState({
            title: 'No Physical Intakes yet.',
            body: 'Register existing or non-procurement stock here. Procurement stock still arrives through Receipt Notes.',
            actionLabel: canMutate() ? '+ Physical Intake' : '',
            actionView: canMutate() ? 'physical-intakes-view' : '',
            actionAttr: 'id="btnEmptyPhysicalIntake"'
        });
        host.querySelector('#btnEmptyPhysicalIntake')?.addEventListener('click', (e) => {
            e.preventDefault();
            startWizard();
        });
        return;
    }
    host.innerHTML = `
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr>
                    <th>Intake</th>
                    <th>Type</th>
                    <th>Holding</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Physical ID</th>
                    <th>When</th>
                </tr>
            </thead>
            <tbody>
                ${intakes.map((row) => {
                    const out = (row.outputs || [])[0] || {};
                    return `<tr class="pi-row" data-id="${escapeHtml(row.id)}" style="cursor:pointer;">
                        <td class="lc-mono">${escapeHtml(row.id)}</td>
                        <td>${escapeHtml(INTAKE_TYPE_LABELS[row.intakeType] || row.intakeType)}</td>
                        <td>${escapeHtml(row.holdingType)}</td>
                        <td>${escapeHtml(row.productName || row.productId || '—')}</td>
                        <td>${formatQty(row.quantity)} ${escapeHtml(row.unit || '')}</td>
                        <td class="lc-mono">${escapeHtml(out.resourceId || '—')}</td>
                        <td>${formatWhen(row.createdAt)}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
    host.querySelectorAll('.pi-row').forEach((row) => {
        row.addEventListener('click', () => openDetail(row.getAttribute('data-id')));
    });
}

async function renderIntakeList() {
    const host = wizardHost();
    if (!host) return;
    const q = el('physicalIntakeSearch')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', '100');
    const data = await api(`/api/physical-intakes?${params.toString()}`);
    const intakes = data.intakes || [];
    if (el('physicalIntakeCountBadge')) {
        el('physicalIntakeCountBadge').textContent = `${data.total ?? intakes.length} Intakes`;
    }
    renderList(intakes);
}

function bindChoiceClicks(host, field, onPick) {
    host.querySelectorAll(`[data-pi-field="${field}"]`).forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.getAttribute('data-pi-value')));
    });
}

function renderStepHolding() {
    const host = wizardHost();
    host.innerHTML = `
        <div class="pi-wizard">
            <p class="pi-banner">This physical stock is being registered outside procurement. Receipt Notes remain the path for stock that came through a Purchase Order.</p>
            <h3>What are you registering?</h3>
            <div class="pi-choices">
                ${choiceButtons('holdingType', [
                    { value: 'ASSET', label: 'Asset', hint: 'Individually identified physical holding. One AssetEngine ID and QR.' },
                    { value: 'INVENTORY', label: 'Inventory', hint: 'Quantity-tracked holding. One Inventory row and QR. Not per-unit children.' }
                ], wizard.holdingType)}
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piCancel">Cancel</button>
            </div>
        </div>
    `;
    bindChoiceClicks(host, 'holdingType', (value) => {
        if (wizard.holdingType !== value) clearHierarchySelection();
        wizard.holdingType = value;
        renderStepType();
    });
    el('piCancel')?.addEventListener('click', () => {
        resetWizard();
        renderIntakeList().catch((err) => toastOperatorError(err));
    });
}

function renderStepType() {
    const host = wizardHost();
    host.innerHTML = `
        <div class="pi-wizard">
            <p class="lc-muted">Registering ${escapeHtml(wizard.holdingType === 'ASSET' ? 'an Asset' : 'Inventory')}.</p>
            <h3>Why does this stock exist?</h3>
            <div class="pi-choices pi-choices-grid">
                ${choiceButtons('intakeType', [
                    { value: 'OPENING_BALANCE', label: 'Opening Balance', hint: 'Existing stock being registered in AssetEngine.' },
                    { value: 'LEGACY_EXISTING_STOCK', label: 'Legacy Existing Stock', hint: 'Known stock from a previous register.' },
                    { value: 'EXTERNAL_ACQUISITION', label: 'External Acquisition', hint: 'Acquired outside a Receipt Note; a Purchase Order may follow.' },
                    { value: 'INTERNAL_TRANSFER', label: 'Internal Transfer', hint: 'Provenance only — not a transfer ledger.' },
                    { value: 'DONATION', label: 'Donation', hint: 'Donated or gifted stock.' },
                    { value: 'NON_PO_ACQUISITION', label: 'Non-PO Acquisition', hint: 'Requires a reason.' },
                    { value: 'OTHER_APPROVED', label: 'Other Approved', hint: 'Requires an explanation.' }
                ], wizard.intakeType)}
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
            </div>
        </div>
    `;
    bindChoiceClicks(host, 'intakeType', (value) => {
        wizard.intakeType = value;
        wizard.poStatus = defaultPoStatusForType(value);
        wizard.selectedPo = null;
        wizard.selectedLine = null;
        wizard.expectedPoNumber = '';
        wizard.expectedVendorRef = '';
        renderStepProduct();
    });
    el('piBack')?.addEventListener('click', renderStepHolding);
}

function renderStepProduct() {
    const host = wizardHost();
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Product</h3>
            <p class="lc-muted">Search and select an existing AssetEngine Product. Physical Intake will not create a Product.</p>
            <input type="search" id="piProductSearch" class="form-input" placeholder="Search Product name or ID..." style="max-width:420px;">
            <div id="piProductHits" style="margin-top:10px;"></div>
            <div id="piProductSelected" style="margin-top:10px;">${wizard.product ? `<strong>${escapeHtml(wizard.product.id)}</strong> · ${escapeHtml(wizard.product.name)}` : ''}</div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext" ${wizard.product ? '' : 'disabled'}>Next</button>
            </div>
        </div>
    `;
    const hits = el('piProductHits');
    let timer = null;
    el('piProductSearch')?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = el('piProductSearch')?.value || '';
            if (q.trim().length < 1) {
                hits.innerHTML = '';
                return;
            }
            try {
                const data = await api(`/api/products?q=${encodeURIComponent(q)}&status=ACTIVE&limit=8`);
                const products = data.products || [];
                hits.innerHTML = products.map((p) => `<button type="button" class="action-button grey rn-pick-product" data-id="${escapeHtml(p.id)}" style="margin:2px 4px 2px 0;">${escapeHtml(p.id)} · ${escapeHtml(p.name)}</button>`).join('')
                    || '<p class="lc-muted">No matching Products.</p>';
                hits.querySelectorAll('.rn-pick-product').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const found = products.find((p) => p.id === btn.getAttribute('data-id'));
                        wizard.product = found;
                        wizard.unit = found?.unit || wizard.unit || 'Nos';
                        el('piProductSelected').innerHTML = `<strong>${escapeHtml(found.id)}</strong> · ${escapeHtml(found.name)}`;
                        const next = el('piNext');
                        if (next) next.disabled = false;
                    });
                });
            } catch (err) {
                toastOperatorError(err);
            }
        }, 250);
    });
    el('piBack')?.addEventListener('click', renderStepType);
    el('piNext')?.addEventListener('click', () => {
        if (!wizard.product) return;
        renderStepQty();
    });
}

function renderStepQty() {
    const host = wizardHost();
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Quantity / Unit</h3>
            <p class="lc-muted">${wizard.holdingType === 'ASSET'
                ? 'One Asset record will be created with this quantity. This is not per-unit Inventory children.'
                : 'One Inventory record will be created with this quantity.'}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;max-width:640px;">
                <div>
                    <label class="lc-k">Quantity</label>
                    <input type="number" min="0.000001" step="any" id="piQty" class="form-input" value="${escapeHtml(wizard.quantity || '')}">
                </div>
                <div>
                    <label class="lc-k">Unit</label>
                    <input type="text" id="piUnit" class="form-input" value="${escapeHtml(wizard.unit || wizard.product?.unit || 'Nos')}">
                </div>
                <div>
                    <label class="lc-k">Location</label>
                    <input type="text" id="piLocation" class="form-input" value="${escapeHtml(wizard.location || 'Mumbai')}">
                </div>
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Next</button>
            </div>
        </div>
    `;
    el('piBack')?.addEventListener('click', renderStepProduct);
    el('piNext')?.addEventListener('click', () => {
        wizard.quantity = el('piQty')?.value || '';
        wizard.unit = el('piUnit')?.value || 'Nos';
        wizard.location = el('piLocation')?.value || 'Mumbai';
        if (!(Number(wizard.quantity) > 0)) {
            showToast('Quantity must be greater than zero.', 'error');
            return;
        }
        renderStepCategory();
    });
}

async function renderStepCategory() {
    const host = wizardHost();
    const isAsset = wizard.holdingType === 'ASSET';
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Folder &amp; Category</h3>
            <p class="lc-muted">${isAsset
                ? `Choose Parent Folder and Kind for this Asset under module ${escapeHtml(currentModule())}. Same hierarchy as Add Asset.`
                : 'Choose Inventory Folder and Category. Same hierarchy as Add Inventory.'}</p>
            <p class="lc-muted" id="piHierarchyLoading">Loading folders…</p>
            <div id="piHierarchyFields" style="display:none;max-width:480px;flex-direction:column;gap:10px;">
                <div>
                    <label class="lc-k">Parent Folder</label>
                    <select id="piFolder" class="form-input"></select>
                </div>
                <div>
                    <label class="lc-k">${isAsset ? 'Kind / Category' : 'Category'}</label>
                    <select id="piKind" class="form-input"></select>
                </div>
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext" disabled>Next</button>
            </div>
        </div>
    `;

    const folderSelect = el('piFolder');
    const kindSelect = el('piKind');
    const nextBtn = el('piNext');
    const fields = el('piHierarchyFields');
    const loading = el('piHierarchyLoading');

    function syncNextEnabled() {
        if (nextBtn) nextBtn.disabled = !(folderSelect?.value && kindSelect?.value);
    }

    function refreshKindOptions() {
        if (!kindSelect || !folderSelect) return;
        const prev = kindSelect.value || wizard.kindId || '';
        kindSelect.innerHTML = isAsset
            ? assetKindOptionsHtml(folderSelect.value, prev)
            : invKindOptionsHtml(folderSelect.value, prev);
        if (prev && ![...kindSelect.options].some((o) => o.value === prev)) {
            kindSelect.value = '';
        }
        syncNextEnabled();
    }

    try {
        await loadIntakeHierarchy();
        if (loading) loading.style.display = 'none';
        if (fields) fields.style.display = 'flex';
        if (folderSelect) {
            folderSelect.innerHTML = isAsset
                ? assetFolderOptionsHtml(wizard.folderId)
                : invFolderOptionsHtml(wizard.folderId);
        }
        refreshKindOptions();
    } catch (err) {
        if (loading) loading.textContent = 'Could not load folders.';
        toastOperatorError(err);
    }

    folderSelect?.addEventListener('change', () => {
        wizard.kindId = '';
        wizard.kindName = '';
        refreshKindOptions();
    });
    kindSelect?.addEventListener('change', syncNextEnabled);

    el('piBack')?.addEventListener('click', renderStepQty);
    nextBtn?.addEventListener('click', () => {
        const folderId = folderSelect?.value || '';
        const kindId = kindSelect?.value || '';
        if (!folderId || !kindId) {
            showToast('Select Parent Folder and Category before continuing.', 'error');
            return;
        }
        wizard.folderId = folderId;
        wizard.kindId = kindId;
        if (isAsset) {
            const folder = assetFolderById(folderId);
            wizard.folderName = folder ? rowName(folder) : '';
            wizard.kindName = kindId;
            wizard.category = currentModule();
        } else {
            const folder = intakeHierarchy.invFolders.find((f) => rowId(f) === folderId);
            const kind = intakeHierarchy.invKinds.find((k) => rowId(k) === kindId);
            wizard.folderName = folder ? rowName(folder) : '';
            wizard.kindName = kind ? rowName(kind) : '';
            wizard.category = wizard.kindName;
        }
        renderStepSource();
    });
}

function renderStepSource() {
    const host = wizardHost();
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Additional source information</h3>
            <div class="pi-source-fields" style="max-width:640px;display:flex;flex-direction:column;gap:8px;">
                ${sourceFieldsHtml()}
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Review</button>
            </div>
        </div>
    `;
    el('piBack')?.addEventListener('click', renderStepCategory);
    el('piNext')?.addEventListener('click', () => {
        collectSource();
        if ((wizard.intakeType === 'NON_PO_ACQUISITION' || wizard.intakeType === 'OTHER_APPROVED') && !wizard.reason) {
            showToast('A reason is required for this intake type.', 'error');
            return;
        }
        if (wizard.intakeType === 'INTERNAL_TRANSFER' && !wizard.source.sourceLocation) {
            showToast('Source location / context is required for Internal Transfer intake.', 'error');
            return;
        }
        renderStepPoStatus();
    });
}

function poRadio(value, label, selected) {
    const on = selected === value ? ' pi-choice-on' : '';
    return `<label class="pi-choice pi-radio${on}">
        <input type="radio" name="piPoStatus" value="${escapeHtml(value)}" ${selected === value ? 'checked' : ''}>
        <strong>${escapeHtml(label)}</strong>
    </label>`;
}

function collectPoStatus() {
    const picked = document.querySelector('input[name="piPoStatus"]:checked');
    wizard.poStatus = picked ? picked.value : 'EXPECTED';
    wizard.expectedPoNumber = el('piExpectedPoNumber')?.value?.trim() || '';
    wizard.expectedVendorRef = el('piExpectedVendor')?.value?.trim() || '';
}

function selectedLineProductMatch() {
    const line = wizard.selectedLine;
    const productId = wizard.product?.id;
    if (!line || !productId) return '';
    if (!line.productId) {
        return '<p class="pi-callout">Map the PO line to an AssetEngine Product before linking this intake.</p>';
    }
    if (String(line.productId) !== String(productId)) {
        return '<p class="pi-callout">The intake Product does not match the Purchase Order line Product.</p>';
    }
    return `<p class="lc-muted">Product match: ${escapeHtml(line.productId)}</p>`;
}

function renderAvailablePoFields() {
    const po = wizard.selectedPo;
    const line = wizard.selectedLine;
    const versionLabel = po ? `Current · ${po.poNumber || po.id}` : '';
    const lines = (po && po.lines) ? po.lines.filter((l) => String(l.lineStatus || 'OPEN').toUpperCase() !== 'WITHDRAWN') : [];
    return `
        <div id="piPoAvailableFields" class="pi-po-available" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;max-width:640px;">
            <label class="lc-k">Purchase Order</label>
            <input type="search" id="piPoSearch" class="form-input" placeholder="Search Purchase Orders...">
            <div id="piPoHits"></div>
            <div id="piPoSelected">${po ? `<strong>${escapeHtml(po.poNumber || po.id)}</strong> · ${escapeHtml(po.vendorName || '')}` : '<span class="lc-muted">Select a Purchase Order.</span>'}</div>
            ${po ? `
                <label class="lc-k">PO Version</label>
                <select id="piPoVersion" class="form-input">
                    <option value="${escapeHtml(po.id)}">${escapeHtml(versionLabel)}</option>
                </select>
                <label class="lc-k">PO Line</label>
                <select id="piPoLine" class="form-input">
                    <option value="">Select a PO line</option>
                    ${lines.map((l) => `<option value="${escapeHtml(l.id)}" ${line && line.id === l.id ? 'selected' : ''}>${escapeHtml(l.id)} · ${l.productId ? escapeHtml(l.productId) : 'unmapped'} · ordered ${formatQty(l.ordered)}</option>`).join('')}
                </select>
                <div id="piPoLineMatch">${selectedLineProductMatch()}</div>
            ` : ''}
        </div>
    `;
}

function bindPoSearch() {
    const hits = el('piPoHits');
    let timer = null;
    el('piPoSearch')?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = el('piPoSearch')?.value || '';
            if (!hits) return;
            if (q.trim().length < 1) {
                hits.innerHTML = '';
                return;
            }
            try {
                const data = await api(`/api/physical-intakes/linkable-pos?q=${encodeURIComponent(q)}&limit=8`);
                const pos = data.purchaseOrders || [];
                hits.innerHTML = pos.map((p) => `<button type="button" class="action-button grey pi-pick-po" data-id="${escapeHtml(p.id)}" style="margin:2px 4px 2px 0;">${escapeHtml(p.poNumber || p.id)} · ${escapeHtml(p.vendorName || '')}</button>`).join('')
                    || '<p class="lc-muted">No matching Purchase Orders.</p>';
                hits.querySelectorAll('.pi-pick-po').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const found = pos.find((p) => p.id === btn.getAttribute('data-id'));
                        wizard.selectedPo = found;
                        wizard.selectedLine = null;
                        collectPoStatus();
                        renderStepPoStatus();
                    });
                });
            } catch (err) {
                toastOperatorError(err);
            }
        }, 250);
    });
    el('piPoLine')?.addEventListener('change', () => {
        const id = el('piPoLine')?.value || '';
        wizard.selectedLine = (wizard.selectedPo?.lines || []).find((l) => l.id === id) || null;
        const match = el('piPoLineMatch');
        if (match) match.innerHTML = selectedLineProductMatch();
    });
}

function renderExpectedFields() {
    return `
        <div id="piExpectedFields" class="pi-expected-fields" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;max-width:640px;">
            <p class="lc-muted">Optional. This is a note only until an imported Purchase Order is linked. It is not a PO relationship.</p>
            <label class="lc-k">Expected PO Number</label>
            <input type="text" id="piExpectedPoNumber" class="form-input" value="${escapeHtml(wizard.expectedPoNumber || '')}">
            <label class="lc-k">Expected vendor / reference</label>
            <input type="text" id="piExpectedVendor" class="form-input" value="${escapeHtml(wizard.expectedVendorRef || '')}">
        </div>
    `;
}

function renderStepPoStatus() {
    const host = wizardHost();
    const selected = wizard.poStatus === 'AVAILABLE' ? 'AVAILABLE' : 'EXPECTED';
    wizard.poStatus = selected;
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Purchase Order Status</h3>
            <p class="lc-muted">Every intake starts as PO Expected Later and appears on Dashboard Awaiting Adoption after register. Link a Purchase Order now only if it is already available. Mark No PO Required later from Awaiting Adoption.</p>
            <fieldset class="pi-po-status pi-choices" style="border:0;padding:0;margin:0;">
                <legend class="lc-k">Purchase Order Status</legend>
                ${poRadio('EXPECTED', 'PO Expected Later', selected)}
                ${poRadio('AVAILABLE', 'Purchase Order Already Available', selected)}
            </fieldset>
            <div id="piPoStatusExtra">
                ${selected === 'EXPECTED' ? renderExpectedFields() : ''}
                ${selected === 'AVAILABLE' ? renderAvailablePoFields() : ''}
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Review</button>
            </div>
        </div>
    `;
    host.querySelectorAll('input[name="piPoStatus"]').forEach((input) => {
        input.addEventListener('change', () => {
            collectPoStatus();
            if (wizard.poStatus !== 'AVAILABLE') {
                wizard.selectedPo = null;
                wizard.selectedLine = null;
            }
            renderStepPoStatus();
        });
    });
    if (selected === 'AVAILABLE') bindPoSearch();
    el('piBack')?.addEventListener('click', () => {
        collectPoStatus();
        renderStepSource();
    });
    el('piNext')?.addEventListener('click', () => {
        collectPoStatus();
        if (!wizard.poStatus) {
            showToast('Choose Purchase Order Status before registering this intake.', 'error');
            return;
        }
        if (wizard.poStatus === 'AVAILABLE') {
            if (!wizard.selectedPo || !wizard.selectedLine) {
                showToast('Select a Purchase Order and PO line before registering.', 'error');
                return;
            }
            if (!wizard.selectedLine.productId) {
                showToast('Map the PO line to an AssetEngine Product before linking this intake.', 'error');
                return;
            }
            if (wizard.product?.id && String(wizard.selectedLine.productId) !== String(wizard.product.id)) {
                showToast('The intake Product does not match the Purchase Order line Product.', 'error');
                return;
            }
        }
        renderStepReview();
    });
}

function renderStepReview() {
    const host = wizardHost();
    const qty = formatQty(wizard.quantity);
    const kind = wizard.holdingType === 'ASSET' ? 'Asset' : 'Inventory';
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Review</h3>
            <p class="pi-banner">This physical stock is being registered outside procurement.</p>
            <dl class="pi-review">
                <dt>Type</dt><dd>${escapeHtml(INTAKE_TYPE_LABELS[wizard.intakeType] || wizard.intakeType)}</dd>
                <dt>Product</dt><dd>${escapeHtml(wizard.product?.id || '')} · ${escapeHtml(wizard.product?.name || '')}</dd>
                <dt>Quantity</dt><dd>${qty} ${escapeHtml(wizard.unit || '')}</dd>
                <dt>Unit</dt><dd>${escapeHtml(wizard.unit || '')}</dd>
                <dt>Folder</dt><dd>${escapeHtml(wizard.folderName || wizard.folderId || '—')}</dd>
                <dt>Kind / Category</dt><dd>${escapeHtml(wizard.kindName || wizard.kindId || '—')}</dd>
                ${wizard.holdingType === 'ASSET' ? `<dt>Module</dt><dd>${escapeHtml(wizard.category || currentModule())}</dd>` : ''}
                <dt>Reason</dt><dd>${escapeHtml(wizard.reason || '—')}</dd>
                <dt>Purchase Order Status</dt><dd>${escapeHtml(poStatusLabel(wizard.poStatus))}</dd>
                ${wizard.poStatus === 'EXPECTED' && wizard.expectedPoNumber ? `<dt>Expected PO Number</dt><dd>${escapeHtml(wizard.expectedPoNumber)}</dd>` : ''}
                ${wizard.poStatus === 'EXPECTED' && wizard.expectedVendorRef ? `<dt>Expected vendor / reference</dt><dd>${escapeHtml(wizard.expectedVendorRef)}</dd>` : ''}
                ${wizard.poStatus === 'AVAILABLE' ? `<dt>Purchase Order</dt><dd>${escapeHtml(wizard.selectedPo?.poNumber || wizard.selectedPo?.id || '—')}</dd>` : ''}
                ${wizard.poStatus === 'AVAILABLE' ? `<dt>PO Version</dt><dd>Current · ${escapeHtml(wizard.selectedPo?.poNumber || wizard.selectedPo?.id || '—')}</dd>` : ''}
                ${wizard.poStatus === 'AVAILABLE' ? `<dt>PO Line</dt><dd>${escapeHtml(wizard.selectedLine?.id || '—')}</dd>` : ''}
                <dt>Source</dt><dd>${escapeHtml(Object.values(wizard.source).filter(Boolean).join(' · ') || '—')}</dd>
                <dt>Result</dt><dd>${escapeHtml(kind)} · ${qty} ${escapeHtml(wizard.unit || '')}</dd>
            </dl>
            <p><strong>Register this physical stock?</strong></p>
            <p>This will create ${escapeHtml(qty)} ${escapeHtml(wizard.unit || 'units')} of ${escapeHtml(kind)} for Product ${escapeHtml(wizard.product?.name || wizard.product?.id || '')}.
            This stock will be recorded as NON-PROCUREMENT INTAKE.</p>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button green" id="piConfirm">${canMutate() ? 'Register Physical Stock' : 'Not permitted'}</button>
            </div>
        </div>
    `;
    el('piBack')?.addEventListener('click', renderStepPoStatus);
    el('piConfirm')?.addEventListener('click', submitIntake);
}

async function submitIntake() {
    if (!canMutate()) {
        showToast('Sales cannot create Physical Intakes.', 'error');
        return;
    }
    const btn = el('piConfirm');
    if (btn) btn.disabled = true;
    try {
        const payload = {
            holdingType: wizard.holdingType,
            intakeType: wizard.intakeType,
            productId: wizard.product.id,
            quantity: Number(wizard.quantity),
            unit: wizard.unit,
            location: wizard.location,
            folderId: wizard.folderId,
            kindId: wizard.kindId,
            parentFolder: wizard.folderName || undefined,
            type: wizard.holdingType === 'ASSET' ? (wizard.kindName || wizard.kindId) : (wizard.kindName || undefined),
            category: wizard.holdingType === 'ASSET' ? (wizard.category || currentModule()) : (wizard.category || wizard.kindName || undefined),
            reason: wizard.reason,
            source: wizard.source,
            commercialPoChoice: wizard.poStatus,
            expectedPoNumber: wizard.poStatus === 'EXPECTED' ? wizard.expectedPoNumber : null,
            expectedVendorRef: wizard.poStatus === 'EXPECTED' ? wizard.expectedVendorRef : null,
            procurementPoId: wizard.poStatus === 'AVAILABLE' ? wizard.selectedPo?.id : null,
            procurementPoLineId: wizard.poStatus === 'AVAILABLE' ? wizard.selectedLine?.id : null
        };
        const data = await api('/api/physical-intakes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey('intake')
            },
            body: JSON.stringify(payload)
        });
        wizard.result = data;
        renderSuccess(data);
        showToast('Physical stock registered.', 'success');
    } catch (err) {
        toastOperatorError(err);
        if (btn) btn.disabled = false;
    }
}

function renderSuccess(data) {
    const host = wizardHost();
    const intake = data.intake || data;
    const created = data.created || (intake.outputs || [])[0] || {};
    const resourceId = created.resourceId || created.resource_id;
    const resourceType = created.resourceType || created.resource_type || intake.holdingType;
    const isAsset = String(resourceType).toUpperCase() === 'ASSET';
    host.innerHTML = `
        <div class="pi-wizard">
            <h3>Registered</h3>
            ${provenanceHtml(intake)}
            <div class="pi-result-card">
                <div class="lc-k">${isAsset ? 'Asset ID' : 'Inventory ID'}</div>
                <div class="lc-mono" style="font-size:18px;font-weight:700;">${escapeHtml(resourceId || '—')}</div>
                <div class="lc-k" style="margin-top:10px;">Quantity</div>
                <div>${formatQty(intake.quantity)} ${escapeHtml(intake.unit || '')}</div>
                <div class="lc-k" style="margin-top:10px;">QR</div>
                <div>${created.qr === false ? 'Not generated' : 'Generated for this physical ID'}</div>
            </div>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piAnother">Another intake</button>
                <button type="button" class="action-button blue" id="piOpenPhysical">${isAsset ? 'Open Asset' : 'Open Inventory'}</button>
            </div>
        </div>
    `;
    el('piAnother')?.addEventListener('click', () => startWizard());
    el('piOpenPhysical')?.addEventListener('click', () => {
        if (isAsset) {
            window.open(`/asset/${encodeURIComponent(resourceId)}`, '_blank');
        } else {
            go('inventory-view');
        }
    });
    bindPhysicalIntakePoLink(host, intake);
}

async function openDetail(id) {
    const host = wizardHost();
    const data = await api(`/api/physical-intakes/${encodeURIComponent(id)}`);
    const intake = data.intake || data;
    const history = await api(`/api/physical-intakes/${encodeURIComponent(id)}/history`).catch(() => ({ events: intake.events || [] }));
    const out = (intake.outputs || [])[0] || {};
    host.innerHTML = `
        <div class="pi-wizard">
            <button type="button" class="action-button grey" id="piBackList">Back to list</button>
            <h3>Physical Intake</h3>
            ${provenanceHtml(intake)}
            <div class="pi-result-card">
                <div class="lc-k">${intake.holdingType === 'ASSET' ? 'Asset ID' : 'Inventory ID'}</div>
                <div class="lc-mono" style="font-size:18px;font-weight:700;">${escapeHtml(out.resourceId || '—')}</div>
                <div class="lc-k" style="margin-top:10px;">Product</div>
                <div>${escapeHtml(intake.productName || intake.productId || '—')}</div>
                <div class="lc-k" style="margin-top:10px;">Quantity</div>
                <div>${formatQty(intake.quantity)} ${escapeHtml(intake.unit || '')}</div>
            </div>
            <h4>History</h4>
            ${(history.events || []).map((ev) => `<article class="lc-event-card">
                <div class="lc-event-when">${formatWhen(ev.timestamp)}</div>
                <div class="lc-event-action">${escapeHtml(eventTypeLabel(ev.type))}</div>
                <div class="lc-event-meta">
                    ${ev.actor ? `<span>By ${escapeHtml(ev.actor)}</span>` : ''}
                    ${ev.quantity != null ? `<span>Qty ${formatQty(ev.quantity)}</span>` : ''}
                    ${ev.resourceId ? `<span class="lc-mono">${escapeHtml(ev.resourceId)}</span>` : ''}
                </div>
            </article>`).join('') || '<p class="lc-muted">No history.</p>'}
        </div>
    `;
    el('piBackList')?.addEventListener('click', () => {
        const hash = String(window.location.hash || '');
        if (hash.includes('awaiting=1')) {
            renderAwaitingAdoptionList().catch((err) => toastOperatorError(err));
            return;
        }
        renderIntakeList().catch((err) => toastOperatorError(err));
    });
    bindPhysicalIntakePoLink(host, intake);
}

function eventTypeLabel(type) {
    if (type === 'PO_EXPECTED') return 'Purchase Order expected later';
    if (type === 'PO_LINKED') return 'Purchase Order linked';
    if (type === 'PO_NOT_REQUIRED') return 'No PO Required';
    if (type === 'PHYSICAL_INTAKE_CREATED') return 'Physical Intake registered';
    if (type === 'PHYSICAL_INTAKE_ASSET_CREATED') return 'Asset registered by Physical Intake';
    if (type === 'PHYSICAL_INTAKE_INVENTORY_CREATED') return 'Inventory registered by Physical Intake';
    return String(type || 'Event').replace(/_/g, ' ');
}

function closeLinkPoModal() {
    document.getElementById('piLinkPoModal')?.remove();
}

export function bindPhysicalIntakePoLink(root, intake, opts = {}) {
    const host = root || document;
    host.querySelectorAll('.pi-link-po').forEach((btn) => {
        btn.addEventListener('click', () => {
            const resourceType = btn.getAttribute('data-resource-type');
            const resourceId = btn.getAttribute('data-resource-id');
            openLinkPoModal({
                resourceType,
                resourceId,
                intake,
                onLinked: () => {
                    if (typeof opts.onLinked === 'function') {
                        opts.onLinked();
                        return;
                    }
                    if (intake && intake.id && wizardHost()) {
                        openDetail(intake.id).catch((err) => toastOperatorError(err));
                    }
                }
            });
        });
    });
    host.querySelectorAll('.pi-mark-not-required').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Mark this holding as No PO Required? It will leave Awaiting Adoption.')) return;
            try {
                await api('/api/physical-intakes/mark-not-required', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        resourceType: btn.getAttribute('data-resource-type'),
                        resourceId: btn.getAttribute('data-resource-id')
                    })
                });
                showToast('Marked No PO Required', 'success');
                if (typeof opts.onLinked === 'function') {
                    opts.onLinked();
                    return;
                }
                if (intake && intake.id && wizardHost()) {
                    openDetail(intake.id).catch((err) => toastOperatorError(err));
                }
            } catch (err) {
                toastOperatorError(err);
            }
        });
    });
}

function openLinkPoModal({ resourceType, resourceId, intake, onLinked }) {
    closeLinkPoModal();
    const holdingProduct = intake?.productId || intake?.productName || '—';
    const holdingQty = `${formatQty(intake?.quantity)} ${escapeHtml(intake?.unit || '')}`;
    const overlay = document.createElement('div');
    overlay.id = 'piLinkPoModal';
    overlay.className = 'pi-link-modal-overlay';
    overlay.innerHTML = `
        <div class="pi-link-modal" role="dialog" aria-labelledby="piLinkPoTitle">
            <h3 id="piLinkPoTitle">Link Purchase Order</h3>
            <div class="pi-link-cols">
                <div>
                    <div class="lc-k">Holding</div>
                    <div>Product ${escapeHtml(holdingProduct)}</div>
                    <div class="lc-mono">${escapeHtml(resourceId || '')}</div>
                    <div>Quantity ${holdingQty}</div>
                </div>
                <div id="piLinkSelectedLine" class="lc-muted">Select a PO line.</div>
            </div>
            <label class="lc-k">Purchase Order</label>
            <input type="search" id="piLinkPoSearch" class="form-input" placeholder="Search Purchase Orders...">
            <div id="piLinkPoHits"></div>
            <div id="piLinkPoSelected" class="lc-muted" style="margin:6px 0;">No Purchase Order selected.</div>
            <label class="lc-k">PO Version</label>
            <select id="piLinkPoVersion" class="form-input" disabled><option value="">Select a Purchase Order first</option></select>
            <label class="lc-k">PO Line</label>
            <select id="piLinkPoLine" class="form-input" disabled><option value="">Select a Purchase Order first</option></select>
            <div class="pi-nav">
                <button type="button" class="action-button grey" id="piLinkPoCancel">Cancel</button>
                <button type="button" class="action-button green" id="piLinkPoConfirm" disabled>Link Purchase Order</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    let selectedPo = null;
    let selectedLine = null;

    function renderLineSummary() {
        const box = overlay.querySelector('#piLinkSelectedLine');
        const confirm = overlay.querySelector('#piLinkPoConfirm');
        if (!selectedLine) {
            box.className = 'lc-muted';
            box.textContent = 'Select a PO line.';
            if (confirm) confirm.disabled = true;
            return;
        }
        box.className = '';
        box.innerHTML = `
            <div class="lc-k">Selected PO line</div>
            <div>Product ${escapeHtml(selectedLine.productId || 'unmapped')}</div>
            <div>Ordered ${formatQty(selectedLine.ordered)}</div>
            <div>Current outstanding ${formatQty(selectedLine.outstanding)}</div>
        `;
        if (confirm) confirm.disabled = !selectedLine.productId;
        if (!selectedLine.productId) {
            box.innerHTML += '<p class="pi-callout">Map the PO line to an AssetEngine Product before linking this intake.</p>';
        } else if (intake?.productId && String(selectedLine.productId) !== String(intake.productId)) {
            box.innerHTML += '<p class="pi-callout">The intake Product does not match the Purchase Order line Product.</p>';
            if (confirm) confirm.disabled = true;
        }
    }

    function applyPo(po) {
        selectedPo = po;
        selectedLine = null;
        overlay.querySelector('#piLinkPoSelected').innerHTML = `<strong>${escapeHtml(po.poNumber || po.id)}</strong> · ${escapeHtml(po.vendorName || '')}`;
        const version = overlay.querySelector('#piLinkPoVersion');
        version.disabled = false;
        version.innerHTML = `<option value="${escapeHtml(po.id)}">Current · ${escapeHtml(po.poNumber || po.id)}</option>`;
        const lineSel = overlay.querySelector('#piLinkPoLine');
        const lines = (po.lines || []).filter((l) => String(l.lineStatus || 'OPEN').toUpperCase() !== 'WITHDRAWN');
        lineSel.disabled = false;
        lineSel.innerHTML = `<option value="">Select a PO line</option>${lines.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.id)} · ${l.productId ? escapeHtml(l.productId) : 'unmapped'} · ordered ${formatQty(l.ordered)}</option>`).join('')}`;
        renderLineSummary();
    }

    let timer = null;
    overlay.querySelector('#piLinkPoSearch')?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = overlay.querySelector('#piLinkPoSearch')?.value || '';
            const hits = overlay.querySelector('#piLinkPoHits');
            if (q.trim().length < 1) {
                hits.innerHTML = '';
                return;
            }
            try {
                const data = await api(`/api/physical-intakes/linkable-pos?q=${encodeURIComponent(q)}&limit=8`);
                const pos = data.purchaseOrders || [];
                hits.innerHTML = pos.map((p) => `<button type="button" class="action-button grey pi-pick-po" data-id="${escapeHtml(p.id)}" style="margin:2px 4px 2px 0;">${escapeHtml(p.poNumber || p.id)} · ${escapeHtml(p.vendorName || '')}</button>`).join('')
                    || '<p class="lc-muted">No matching Purchase Orders.</p>';
                hits.querySelectorAll('.pi-pick-po').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const found = pos.find((p) => p.id === btn.getAttribute('data-id'));
                        if (found) applyPo(found);
                    });
                });
            } catch (err) {
                toastOperatorError(err);
            }
        }, 250);
    });
    overlay.querySelector('#piLinkPoLine')?.addEventListener('change', () => {
        const id = overlay.querySelector('#piLinkPoLine')?.value || '';
        selectedLine = (selectedPo?.lines || []).find((l) => l.id === id) || null;
        renderLineSummary();
    });
    overlay.querySelector('#piLinkPoCancel')?.addEventListener('click', closeLinkPoModal);
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) closeLinkPoModal();
    });
    overlay.querySelector('#piLinkPoConfirm')?.addEventListener('click', async () => {
        const confirm = overlay.querySelector('#piLinkPoConfirm');
        if (!selectedPo || !selectedLine) return;
        if (confirm) confirm.disabled = true;
        try {
            await api('/api/physical-intakes/link-po', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    resourceType,
                    resourceId,
                    procurementPoId: selectedPo.id,
                    procurementPoLineId: selectedLine.id
                })
            });
            closeLinkPoModal();
            showToast('Purchase Order linked.', 'success');
            if (typeof onLinked === 'function') onLinked();
        } catch (err) {
            toastOperatorError(err);
            if (confirm) confirm.disabled = false;
        }
    });
}

function startWizard() {
    if (!canMutate()) {
        showToast('Sales cannot create Physical Intakes.', 'error');
        return;
    }
    resetWizard();
    renderStepHolding();
}

let bound = false;
export function initPhysicalIntakesView() {
    if (!bound) {
        bound = true;
        el('btnReloadPhysicalIntakes')?.addEventListener('click', () => {
            renderIntakeHome().catch((err) => toastOperatorError(err));
        });
        el('btnStartPhysicalIntake')?.addEventListener('click', () => {
            if (!canMutate()) {
                showToast('Sales cannot create Physical Intakes.', 'error');
                return;
            }
            startWizard();
        });
        el('physicalIntakeSearch')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                renderIntakeList().catch((err) => toastOperatorError(err));
            }
        });
    }
    const pending = consumeOpen('physical-intakes-view');
    if (pending && pending.open) {
        openDetail(pending.open).catch((err) => toastOperatorError(err));
        return;
    }
    if (pending && pending.extra && pending.extra.start) {
        startWizard();
        return;
    }
    if ((pending && pending.extra && pending.extra.awaiting) || isAwaitingHash()) {
        renderAwaitingAdoptionList().catch((err) => toastOperatorError(err));
        return;
    }
    renderIntakeList().catch((err) => toastOperatorError(err));
}

window.initPhysicalIntakesView = initPhysicalIntakesView;
window.startPhysicalIntake = startWizard;
window.loadPhysicalIntakeProvenance = loadProvenance;
window.renderPhysicalIntakeProvenanceHtml = provenanceHtml;
window.bindPhysicalIntakePoLink = bindPhysicalIntakePoLink;
