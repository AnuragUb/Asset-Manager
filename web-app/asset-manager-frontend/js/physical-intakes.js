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

function piSheet({ kicker, title, lead, body, foot, wide }) {
    return `<article class="rn-sheet pi-sheet${wide ? ' pi-sheet-wide' : ''}">
        <header class="rn-sheet-head">
            <div>
                <div class="rn-sheet-kicker">${escapeHtml(kicker || 'Physical Intake')}</div>
                <h2 class="rn-sheet-vendor">${escapeHtml(title || '')}</h2>
            </div>
        </header>
        <div class="pi-sheet-body">
            ${lead ? `<p class="pi-lead">${lead}</p>` : ''}
            ${body || ''}
        </div>
        ${foot ? `<footer class="rn-sheet-foot">${foot}</footer>` : ''}
    </article>`;
}

let contentEpoch = 0;
function claimContent() {
    contentEpoch += 1;
    return contentEpoch;
}
function contentIsCurrent(token) {
    return token === contentEpoch;
}

function canMutate() {
    return canLogistics();
}

async function api(path, options = {}) {
    return lifecycleApi(path, options);
}

// The Assets view renders from window.allAssets, which main.js loads once at startup.
function refreshAssetListAfterIntake(holdingType) {
    if (String(holdingType || '').toUpperCase() !== 'ASSET') return;
    if (typeof window.loadAssets === 'function') {
        Promise.resolve(window.loadAssets()).catch((err) => console.warn('Asset list refresh failed:', err));
    }
}

function idempotencyKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const wizard = {
    holdingType: '',
    intakeType: '',
    product: null,
    noProduct: false,
    itemName: '',
    make: '',
    model: '',
    quantity: '',
    unit: '',
    location: 'Mumbai',
    folderId: '',
    folderName: '',
    kindId: '',
    kindName: '',
    brandCategory: '',
    folderPath: '',
    category: '',
    itemDescription: '',
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
    wizard.brandCategory = '';
    wizard.folderPath = '';
    wizard.category = '';
}

function resetWizard() {
    wizard.holdingType = '';
    wizard.intakeType = '';
    wizard.product = null;
    wizard.noProduct = false;
    wizard.itemName = '';
    wizard.make = '';
    wizard.model = '';
    wizard.quantity = '';
    wizard.unit = '';
    wizard.location = 'Mumbai';
    clearHierarchySelection();
    wizard.itemDescription = '';
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
    return String(
        row?.parent_id || row?.ParentID || row?.parentid || row?.ParentId
        || row?.parentname || row?.ParentName || row?.parentName || ''
    );
}

function kindParentKeys(row) {
    return [
        row?.parent_id, row?.ParentID, row?.parentid, row?.ParentId,
        row?.parentname, row?.ParentName, row?.parentName
    ].map((value) => String(value || '').trim()).filter(Boolean);
}

function kindMatchesParent(kind, parentName, parentId) {
    const keys = kindParentKeys(kind).map((value) => value.toLowerCase());
    if (!keys.length) return false;
    return [parentId, parentName]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .some((token) => keys.includes(token));
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
        if (Number(kind.is_deleted || kind.IsDeleted) === 1) return false;
        if (!folder) return !kindParentKeys(kind).length;
        return kindMatchesParent(kind, folderName, rowId(folder));
    });
    return ['<option value="">Select category</option>']
        .concat(kinds.map((kind) => {
            const name = assetKindName(kind);
            return `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        }))
        .join('');
}

function assetBrandOptionsHtml(kindName, selected) {
    const current = String(selected || '');
    const parentKind = intakeHierarchy.assetKinds.find((kind) => assetKindName(kind) === String(kindName || '')) || null;
    const brands = intakeHierarchy.assetKinds.filter((kind) => {
        if (Number(kind.is_deleted || kind.IsDeleted) === 1) return false;
        return kindMatchesParent(kind, kindName, parentKind ? rowId(parentKind) : '');
    });
    return ['<option value="">Generic / Default</option>']
        .concat(brands.map((kind) => {
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
            ${intake.actor ? `<div><div class="lc-k">Registered by</div><div>${escapeHtml(intake.actor)}</div></div>` : ''}
            ${intake.createdAt ? `<div><div class="lc-k">When</div><div>${formatWhen(intake.createdAt)}</div></div>` : ''}
            ${poBits}
        </div>
        <p class="lc-muted" style="margin:8px 0 0;">Physical identity is the Asset or Inventory ID.</p>
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
    const token = claimContent();
    const data = await api('/api/physical-intakes/provenance?state=AWAITING_PO&limit=200');
    if (!contentIsCurrent(token) || !wizardHost()) return;
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
    host.innerHTML = piSheet({
        kicker: 'Awaiting Adoption',
        title: 'Holdings waiting for a Purchase Order',
        lead: 'Leave them here, mark No PO Required, or link a Purchase Order. Each ID opens the physical holding.',
        wide: true,
        body: `<table class="rn-sheet-table">
            <thead>
                <tr>
                    <th>Holding</th>
                    <th>Type</th>
                    <th>Name</th>
                    <th class="rn-sheet-num">Quantity</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${items.map((item) => {
                    const view = item.resourceType === 'INVENTORY' ? 'inventory-view' : 'home-view';
                    return `<tr>
                        <td class="lc-mono">
                            <button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(item.resourceId)}">${escapeHtml(item.resourceId)}</button>
                        </td>
                        <td>${escapeHtml(item.resourceType)}</td>
                        <td class="rn-sheet-name">${escapeHtml(item.holdingName || '—')}</td>
                        <td class="rn-sheet-num">${escapeHtml(String(item.quantity ?? '—'))}</td>
                        <td class="pi-row-actions">
                            <button type="button" class="action-button blue pi-link-po" data-resource-type="${escapeHtml(item.resourceType)}" data-resource-id="${escapeHtml(item.resourceId)}">Link PO</button>
                            <button type="button" class="action-button grey pi-mark-not-required" data-resource-type="${escapeHtml(item.resourceType)}" data-resource-id="${escapeHtml(item.resourceId)}">No PO Required</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`
    });
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

const INTAKE_PAGE_SIZE = 10;
let intakeListPage = 0;
let intakePaging = false;

function renderList(intakes, total) {
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
    const pads = Math.max(0, INTAKE_PAGE_SIZE - intakes.length);
    const padRows = Array.from({ length: pads }, () => `<tr class="pi-row-pad" aria-hidden="true"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
    host.innerHTML = `
        <div class="pi-list-frame">
        <table class="rn-sheet-table pi-list">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Holding</th>
                    <th>Product</th>
                    <th class="rn-sheet-num">Qty</th>
                    <th>Physical ID</th>
                    <th>When</th>
                </tr>
            </thead>
            <tbody>
                ${intakes.map((row) => {
                    const out = (row.outputs || [])[0] || {};
                    return `<tr class="pi-row" data-id="${escapeHtml(row.id)}">
                        <td>${escapeHtml(INTAKE_TYPE_LABELS[row.intakeType] || row.intakeType)}</td>
                        <td>${escapeHtml(row.holdingType)}</td>
                        <td class="rn-sheet-name">${escapeHtml(row.productName || row.productId || 'No Product')}</td>
                        <td class="rn-sheet-num">${formatQty(row.quantity)} ${escapeHtml(row.unit || '')}</td>
                        <td class="ms-mono">${escapeHtml(out.resourceId || '—')}</td>
                        <td>${escapeHtml(formatWhen(row.createdAt))}</td>
                    </tr>`;
                }).join('')}
                ${padRows}
            </tbody>
        </table>
        ${intakePagerHtml(total)}
        </div>
    `;
    host.querySelectorAll('.pi-row').forEach((row) => {
        row.addEventListener('click', () => openDetail(row.getAttribute('data-id')));
    });
    bindIntakePager(host, total);
}

function intakePagerHtml(total) {
    const pages = Math.max(1, Math.ceil(Number(total || 0) / INTAKE_PAGE_SIZE));
    if (intakeListPage > pages - 1) intakeListPage = pages - 1;
    if (intakeListPage < 0) intakeListPage = 0;
    const from = total ? intakeListPage * INTAKE_PAGE_SIZE + 1 : 0;
    const to = Math.min(total, (intakeListPage + 1) * INTAKE_PAGE_SIZE);
    return `<div class="pi-pager" role="navigation" aria-label="Physical Intake pages">
        <span class="pi-pager-meta">${total ? `${from}–${to} of ${total}` : '0 intakes'}</span>
        <div class="pi-pager-actions">
            <button type="button" class="pi-page-nav" id="piPagePrev" aria-label="Previous page" ${intakeListPage <= 0 ? 'disabled' : ''}>‹</button>
            <span class="pi-pager-page">${intakeListPage + 1} / ${pages}</span>
            <button type="button" class="pi-page-nav" id="piPageNext" aria-label="Next page" ${intakeListPage >= pages - 1 ? 'disabled' : ''}>›</button>
        </div>
    </div>`;
}

function goIntakePage(next, total) {
    if (intakePaging) return;
    const pages = Math.max(1, Math.ceil(Number(total || 0) / INTAKE_PAGE_SIZE));
    const page = Math.max(0, Math.min(pages - 1, next));
    if (page === intakeListPage) return;
    intakePaging = true;
    intakeListPage = page;
    const host = wizardHost();
    if (host) host.scrollTop = 0;
    renderIntakeList()
        .catch((err) => toastOperatorError(err))
        .finally(() => { intakePaging = false; });
}

function bindIntakePager(host, total) {
    el('piPagePrev')?.addEventListener('click', () => goIntakePage(intakeListPage - 1, total));
    el('piPageNext')?.addEventListener('click', () => goIntakePage(intakeListPage + 1, total));
    if (host._piWheel) {
        host.removeEventListener('wheel', host._piWheel);
        host._piWheel = null;
    }
}

async function renderIntakeList() {
    const host = wizardHost();
    if (!host) return;
    const token = claimContent();
    const q = el('physicalIntakeSearch')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(INTAKE_PAGE_SIZE));
    params.set('offset', String(intakeListPage * INTAKE_PAGE_SIZE));
    const data = await api(`/api/physical-intakes?${params.toString()}`);
    if (!contentIsCurrent(token)) return;
    const intakes = data.intakes || [];
    const total = Number(data.total ?? intakes.length);
    const pages = Math.max(1, Math.ceil(total / INTAKE_PAGE_SIZE));
    if (intakeListPage > pages - 1) {
        intakeListPage = pages - 1;
        renderIntakeList().catch((err) => toastOperatorError(err));
        return;
    }
    if (el('physicalIntakeCountBadge')) {
        el('physicalIntakeCountBadge').textContent = `${total} Intakes`;
    }
    renderList(intakes, total);
}

function bindChoiceClicks(host, field, onPick) {
    host.querySelectorAll(`[data-pi-field="${field}"]`).forEach((btn) => {
        btn.addEventListener('click', () => onPick(btn.getAttribute('data-pi-value')));
    });
}

function renderStepHolding() {
    const host = wizardHost();
    host.innerHTML = piSheet({
        kicker: 'Physical Intake',
        title: 'What are you registering?',
        lead: 'This physical stock is being registered outside procurement. Receipt Notes remain the path for stock that came through a Purchase Order.',
        body: `<div class="pi-choices">
                ${choiceButtons('holdingType', [
                    { value: 'ASSET', label: 'Asset', hint: 'Individually identified physical holding. One AssetEngine ID and QR.' },
                    { value: 'INVENTORY', label: 'Inventory', hint: 'Quantity-tracked holding. One Inventory row and QR. Not per-unit children.' }
                ], wizard.holdingType)}
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piCancel">Cancel</button>`
    });
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
    host.innerHTML = piSheet({
        kicker: wizard.holdingType === 'ASSET' ? 'Asset' : 'Inventory',
        title: 'Why does this stock exist?',
        lead: `Registering ${wizard.holdingType === 'ASSET' ? 'an Asset' : 'Inventory'}.`,
        body: `<div class="pi-choices pi-choices-grid">
                ${choiceButtons('intakeType', [
                    { value: 'OPENING_BALANCE', label: 'Opening Balance', hint: 'Existing stock being registered in AssetEngine.' },
                    { value: 'LEGACY_EXISTING_STOCK', label: 'Legacy Existing Stock', hint: 'Known stock from a previous register.' },
                    { value: 'EXTERNAL_ACQUISITION', label: 'External Acquisition', hint: 'Acquired outside a Receipt Note; a Purchase Order may follow.' },
                    { value: 'INTERNAL_TRANSFER', label: 'Internal Transfer', hint: 'Provenance only — not a transfer ledger.' },
                    { value: 'DONATION', label: 'Donation', hint: 'Donated or gifted stock.' },
                    { value: 'NON_PO_ACQUISITION', label: 'Non-PO Acquisition', hint: 'Requires a reason.' },
                    { value: 'OTHER_APPROVED', label: 'Other Approved', hint: 'Requires an explanation.' }
                ], wizard.intakeType)}
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>`
    });
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

function collectNoProductFields() {
    const name = el('piItemName');
    const make = el('piMake');
    const model = el('piModel');
    if (!name && !make && !model) return;
    wizard.itemName = name ? name.value.trim() : wizard.itemName;
    wizard.make = make ? make.value.trim() : wizard.make;
    wizard.model = model ? model.value.trim() : wizard.model;
}

function renderStepProduct() {
    const host = wizardHost();
    const noProduct = wizard.noProduct && !wizard.product;
    host.innerHTML = piSheet({
        kicker: 'Product',
        title: wizard.product ? wizard.product.name : (noProduct ? 'No Product' : 'Choose a Product'),
        lead: 'Search an existing Product, or register this holding with no Product. This step does not create a Product.',
        body: `<input type="search" id="piProductSearch" class="form-input" placeholder="Search Product name or ID..." style="max-width:420px;" ${noProduct ? 'disabled' : ''}>
            <div id="piProductHits" style="margin-top:10px;"></div>
            <div id="piProductSelected" class="rn-sheet-name" style="margin-top:10px;">${wizard.product ? `<span class="ms-mono">${escapeHtml(wizard.product.id)}</span> · ${escapeHtml(wizard.product.name)}` : ''}</div>
            <div class="pi-choices" style="margin-top:14px;">
                <button type="button" class="pi-choice${noProduct ? ' pi-choice-on' : ''}" id="piNoProduct">
                    <strong>No PRD required</strong>
                    <span>Register the asset or inventory item and stop. A Product will not be created afterwards.</span>
                </button>
            </div>
            <div id="piNoProductFields" class="pi-fields" style="display:${noProduct ? 'flex' : 'none'};">
                <label class="lc-k" for="piItemName">Item name</label>
                <input type="text" id="piItemName" class="form-input" value="${escapeHtml(wizard.itemName || '')}" placeholder="Name on the asset or inventory item">
                <label class="lc-k" for="piMake">Make</label>
                <input type="text" id="piMake" class="form-input" value="${escapeHtml(wizard.make || '')}">
                <label class="lc-k" for="piModel">Model</label>
                <input type="text" id="piModel" class="form-input" value="${escapeHtml(wizard.model || '')}">
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext" ${wizard.product || noProduct ? '' : 'disabled'}>Next</button>`
    });
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
                        wizard.noProduct = false;
                        wizard.unit = found?.unit || wizard.unit || 'Nos';
                        renderStepProduct();
                    });
                });
            } catch (err) {
                toastOperatorError(err);
            }
        }, 250);
    });
    el('piNoProduct')?.addEventListener('click', () => {
        collectNoProductFields();
        wizard.noProduct = !wizard.noProduct;
        if (wizard.noProduct) {
            wizard.product = null;
            wizard.poStatus = 'EXPECTED';
            wizard.selectedPo = null;
            wizard.selectedLine = null;
        }
        renderStepProduct();
    });
    el('piBack')?.addEventListener('click', renderStepType);
    el('piNext')?.addEventListener('click', () => {
        collectNoProductFields();
        if (wizard.noProduct) {
            if (!wizard.itemName) {
                showToast('Item name is required when no Product is selected.', 'error');
                return;
            }
            renderStepQty();
            return;
        }
        if (!wizard.product) return;
        renderStepQty();
    });
}

function renderStepQty() {
    const host = wizardHost();
    host.innerHTML = piSheet({
        kicker: 'Quantity',
        title: 'Quantity, unit, and location',
        lead: wizard.holdingType === 'ASSET'
            ? 'One Asset record will be created with this quantity. This is not per-unit Inventory children.'
            : 'One Inventory record will be created with this quantity.',
        body: `<div class="pi-fields pi-fields-3">
                <div>
                    <label class="lc-k" for="piQty">Quantity</label>
                    <input type="number" min="0.000001" step="any" id="piQty" class="form-input" value="${escapeHtml(wizard.quantity || '')}">
                </div>
                <div>
                    <label class="lc-k" for="piUnit">Unit</label>
                    <input type="text" id="piUnit" class="form-input" value="${escapeHtml(wizard.unit || wizard.product?.unit || 'Nos')}">
                </div>
                <div>
                    <label class="lc-k" for="piLocation">Location</label>
                    <input type="text" id="piLocation" class="form-input" value="${escapeHtml(wizard.location || 'Mumbai')}">
                </div>
            </div>
            <div class="pi-fields" style="margin-top:12px;">
                <label class="lc-k" for="piItemDescription">${wizard.holdingType === 'ASSET' ? 'Asset' : 'Inventory'} description</label>
                <textarea id="piItemDescription" class="form-input" rows="3" placeholder="Required. This is not the Product description.">${escapeHtml(wizard.itemDescription || '')}</textarea>
                ${wizard.product ? `<button type="button" class="action-button grey" id="piPortProductDesc" style="margin-top:8px;width:auto;">Copy Product description</button>
                    <p class="rn-sheet-sub">Product description stays on the Product. Copy it here only if this holding should start with that text.</p>` : ''}
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Next</button>`
    });
    el('piBack')?.addEventListener('click', renderStepProduct);
    el('piPortProductDesc')?.addEventListener('click', () => {
        const text = String(wizard.product?.description || '').trim();
        if (!text) {
            showToast('Product description is blank, so there is nothing to copy.', 'error');
            return;
        }
        const box = el('piItemDescription');
        if (box) box.value = text;
        wizard.itemDescription = text;
        showToast('Product description copied onto this holding. Edit it if the asset should differ.', 'info');
    });
    el('piNext')?.addEventListener('click', () => {
        wizard.quantity = el('piQty')?.value || '';
        wizard.unit = el('piUnit')?.value || 'Nos';
        wizard.location = el('piLocation')?.value || 'Mumbai';
        wizard.itemDescription = String(el('piItemDescription')?.value || '').trim();
        if (!(Number(wizard.quantity) > 0)) {
            showToast('Quantity must be greater than zero.', 'error');
            return;
        }
        if (!wizard.itemDescription) {
            showToast(`${wizard.holdingType === 'ASSET' ? 'Asset' : 'Inventory'} description is required.`, 'error');
            return;
        }
        renderStepCategory();
    });
}

async function renderStepCategory() {
    const host = wizardHost();
    const isAsset = wizard.holdingType === 'ASSET';
    host.innerHTML = piSheet({
        kicker: 'Folder',
        title: 'Folder path',
        lead: isAsset
            ? `Where this asset sits. Example: Cineom Assets / Accessories / URSA / Case. Module ${escapeHtml(currentModule())}.`
            : 'Where this inventory item sits. Example: Stores / Cables.',
        body: `<p class="pi-lead" id="piHierarchyLoading">Loading folders…</p>
            <div id="piHierarchyFields" class="pi-fields" style="display:none;">
                <label class="lc-k" for="piFolderPath">Folder Path</label>
                <input type="text" id="piFolderPath" class="form-input" list="piFolderPathList" value="${escapeHtml(wizard.folderPath || '')}" placeholder="${isAsset ? 'Cineom Assets / Accessories / URSA / Case' : 'Stores / Cables'}">
                <datalist id="piFolderPathList"></datalist>
                <p id="piFolderPathHint" class="rn-sheet-sub">Each name must already exist under the previous one.</p>
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Next</button>`
    });
    const fields = el('piHierarchyFields');
    const loading = el('piHierarchyLoading');
    try {
        await loadIntakeHierarchy();
        if (loading) loading.style.display = 'none';
        if (fields) fields.style.display = 'block';
        const list = el('piFolderPathList');
        if (list) {
            list.innerHTML = bulkKnownPaths().map((path) => `<option value="${escapeHtml(path)}"></option>`).join('');
        }
    } catch (err) {
        if (loading) loading.textContent = 'Could not load folders.';
        toastOperatorError(err);
    }
    el('piBack')?.addEventListener('click', renderStepQty);
    el('piNext')?.addEventListener('click', () => {
        const row = { pathText: el('piFolderPath')?.value || '' };
        applyBulkAssetPath(row);
        if (row.pathError || !row.pathLeaf) {
            showToast(row.pathError || 'Enter a folder path.', 'error');
            return;
        }
        wizard.folderId = row.folderId;
        wizard.kindId = row.kindId;
        wizard.brandCategory = isAsset ? (row.brandId || '') : '';
        wizard.folderName = isAsset ? (row.pathSegments[0] || '') : bulkFolderName(row.folderId);
        wizard.kindName = isAsset ? (row.pathSegments[1] || row.kindId) : bulkKindName(row.folderId, row.kindId);
        wizard.folderPath = (row.pathSegments || []).join(' / ');
        wizard.category = isAsset ? currentModule() : wizard.kindName;
        renderStepSource();
    });
}

function renderStepSource() {
    const host = wizardHost();
    host.innerHTML = piSheet({
        kicker: 'Source',
        title: 'Additional source information',
        body: `<div class="pi-source-fields pi-fields">${sourceFieldsHtml()}</div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Next</button>`
    });
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
    if (wizard.noProduct && wizard.poStatus === 'AVAILABLE') {
        wizard.poStatus = 'EXPECTED';
        wizard.selectedPo = null;
        wizard.selectedLine = null;
    }
    const selected = wizard.noProduct ? 'EXPECTED' : (wizard.poStatus === 'AVAILABLE' ? 'AVAILABLE' : 'EXPECTED');
    wizard.poStatus = selected;
    host.innerHTML = piSheet({
        kicker: 'Purchase Order',
        title: 'Purchase Order status',
        lead: wizard.noProduct
            ? 'This intake has no Product, so it cannot be linked to a Purchase Order. It is recorded as PO Expected Later.'
            : 'Every intake starts as PO Expected Later and appears on Awaiting Adoption after register. Link a Purchase Order now only if it is already available.',
        body: `<fieldset class="pi-po-status pi-choices">
                <legend class="rn-sheet-kicker">Purchase Order status</legend>
                ${poRadio('EXPECTED', 'PO Expected Later', selected)}
                ${wizard.noProduct ? '' : poRadio('AVAILABLE', 'Purchase Order Already Available', selected)}
            </fieldset>
            <div id="piPoStatusExtra">
                ${selected === 'EXPECTED' ? renderExpectedFields() : ''}
                ${selected === 'AVAILABLE' ? renderAvailablePoFields() : ''}
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button blue" id="piNext">Review</button>`
    });
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
    host.innerHTML = piSheet({
        kicker: 'Review',
        title: kind,
        lead: 'This physical stock is being registered outside procurement.',
        body: `<dl class="pi-review">
                <dt>Type</dt><dd>${escapeHtml(INTAKE_TYPE_LABELS[wizard.intakeType] || wizard.intakeType)}</dd>
                <dt>Product</dt><dd>${wizard.noProduct
                    ? `No Product · ${escapeHtml([wizard.itemName, wizard.make, wizard.model].filter(Boolean).join(' / '))}`
                    : `${escapeHtml(wizard.product?.id || '')} · ${escapeHtml(wizard.product?.name || '')}`}</dd>
                <dt>Quantity</dt><dd>${qty} ${escapeHtml(wizard.unit || '')}</dd>
                <dt>Unit</dt><dd>${escapeHtml(wizard.unit || '')}</dd>
                <dt>Folder Path</dt><dd>${escapeHtml(wizard.folderPath || '—')}</dd>
                <dt>${wizard.holdingType === 'ASSET' ? 'Asset' : 'Inventory'} description</dt><dd>${escapeHtml(wizard.itemDescription || '—')}</dd>
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
            <p class="pi-lead">${wizard.noProduct
                ? `This will create ${escapeHtml(qty)} ${escapeHtml(wizard.unit || 'units')} of ${escapeHtml(kind)} named ${escapeHtml(wizard.itemName || '')}. No Product will be created.`
                : `This will create ${escapeHtml(qty)} ${escapeHtml(wizard.unit || 'units')} of ${escapeHtml(kind)} for Product ${escapeHtml(wizard.product?.name || wizard.product?.id || '')}.`}
            This stock will be recorded as a non-procurement intake.</p>`,
        foot: `<button type="button" class="action-button grey" id="piBack">Back</button>
                <button type="button" class="action-button green" id="piConfirm">${canMutate() ? 'Register Physical Stock' : 'Not permitted'}</button>`
    });
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
            productId: wizard.noProduct ? undefined : wizard.product.id,
            noProduct: wizard.noProduct === true,
            itemName: wizard.noProduct ? wizard.itemName : undefined,
            itemDescription: wizard.itemDescription,
            make: wizard.noProduct ? wizard.make : undefined,
            model: wizard.noProduct ? wizard.model : undefined,
            quantity: Number(wizard.quantity),
            unit: wizard.unit,
            location: wizard.location,
            folderId: wizard.folderId,
            kindId: wizard.kindId,
            parentFolder: wizard.folderName || undefined,
            folderPath: wizard.folderPath || undefined,
            type: wizard.holdingType === 'ASSET' ? (wizard.folderPath.split(' / ').filter(Boolean).pop() || wizard.kindName || wizard.kindId) : (wizard.kindName || undefined),
            brandCategory: wizard.holdingType === 'ASSET' ? (wizard.brandCategory || undefined) : undefined,
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
        refreshAssetListAfterIntake(wizard.holdingType);
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
    host.innerHTML = piSheet({
        kicker: 'Registered',
        title: resourceId || 'Physical stock',
        lead: 'Non-procurement intake. The holding is in store.',
        body: `${provenanceHtml(intake)}
            <dl class="pi-review">
                <dt>${isAsset ? 'Asset ID' : 'Inventory ID'}</dt><dd class="ms-mono">${escapeHtml(resourceId || '—')}</dd>
                <dt>Quantity</dt><dd>${formatQty(intake.quantity)} ${escapeHtml(intake.unit || '')}</dd>
                <dt>QR</dt><dd>${created.qr === false ? 'Not generated' : 'Generated for this physical ID'}</dd>
            </dl>`,
        foot: `<button type="button" class="action-button grey" id="piAnother">Another intake</button>
                <button type="button" class="action-button blue" id="piOpenPhysical">${isAsset ? 'Open Asset' : 'Open Inventory'}</button>`
    });
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
    host.innerHTML = piSheet({
        kicker: 'Physical Intake',
        title: out.resourceId || intake.productName || 'Physical stock',
        lead: `${escapeHtml(INTAKE_TYPE_LABELS[intake.intakeType] || intake.intakeType || '')} · ${escapeHtml(intake.holdingType || '')}`,
        body: `${provenanceHtml(intake)}
            <dl class="pi-review">
                <dt>${intake.holdingType === 'ASSET' ? 'Asset ID' : 'Inventory ID'}</dt><dd class="ms-mono">${escapeHtml(out.resourceId || '—')}</dd>
                <dt>Product</dt><dd>${escapeHtml(intake.productName || intake.productId || 'No Product')}</dd>
                <dt>Quantity</dt><dd>${formatQty(intake.quantity)} ${escapeHtml(intake.unit || '')}</dd>
            </dl>
            <div class="rn-sheet-kicker" style="margin:16px 0 8px;">History</div>
            ${(history.events || []).map((ev) => `<article class="lc-event-card">
                <div class="lc-event-when">${formatWhen(ev.timestamp)}</div>
                <div class="lc-event-action">${escapeHtml(eventTypeLabel(ev.type))}</div>
                <div class="lc-event-meta">
                    ${ev.actor ? `<span>By ${escapeHtml(ev.actor)}</span>` : ''}
                    ${ev.quantity != null ? `<span>Qty ${formatQty(ev.quantity)}</span>` : ''}
                    ${ev.resourceId ? `<span class="lc-mono">${escapeHtml(ev.resourceId)}</span>` : ''}
                </div>
            </article>`).join('') || '<p class="pi-lead">No history.</p>'}`,
        foot: `<button type="button" class="action-button grey" id="piBackList">Back to list</button>`
    });
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

// ---------------------------------------------------------------------------
// Bulk Physical Intake — one header (holding type, intake type, source) and many
// Product rows. Every row is registered as PO Expected Later; PO lines are linked
// afterwards from Awaiting Adoption. The server registers all rows or none.
// ---------------------------------------------------------------------------

const BULK_MAX_ROWS = 200;

const BULK_COLUMNS = [
    { key: 'productId', label: 'Product ID', aliases: ['product id', 'productid', 'ae product id', 'ae id'] },
    { key: 'product_code', label: 'Product Code', aliases: ['product code', 'productcode', 'sku', 'code', 'part number', 'part no'] },
    { key: 'name', label: 'Product Name', aliases: ['product name', 'name', 'product', 'item', 'equipment', 'equipment name', 'material', 'material name'] },
    { key: 'make', label: 'Make', aliases: ['make', 'brand'] },
    { key: 'model', label: 'Model', aliases: ['model', 'model no', 'model number'] },
    { key: 'manufacturer', label: 'Manufacturer', aliases: ['manufacturer', 'mfr', 'oem'] },
    { key: 'description', label: 'Product Description', aliases: ['description', 'desc', 'product description'] },
    { key: 'hsn_code', label: 'HSN', aliases: ['hsn', 'hsn code', 'hsn sac', 'hsnsac', 'sac'] },
    { key: 'itemName', label: 'Item Name', aliases: ['item name', 'holding name', 'asset name', 'inventory name'] },
    { key: 'itemDescription', label: 'Holding Description', aliases: ['holding description', 'asset description', 'inventory description', 'item description'] },
    { key: 'purchaseDate', label: 'Purchase Date', aliases: ['purchase date', 'date of purchase', 'bought on', 'purchasedate'] },
    { key: 'price', label: 'Price', aliases: ['price', 'rate', 'unit price', 'purchase price', 'cost', 'asset value', 'value'] },
    { key: 'quantity', label: 'Quantity', aliases: ['quantity', 'qty'] },
    { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'units'] },
    { key: 'path', label: 'Path', aliases: ['path', 'folder path', 'category path', 'hierarchy', 'hierarchy path'] },
    { key: 'location', label: 'Location', aliases: ['location'] }
];

const bulk = { rows: [], batchKey: '', validated: false, busy: false, ignored: [], portProductDescription: false };

function bulkHeaderKey(header) {
    const norm = String(header || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hit = BULK_COLUMNS.find((c) => c.aliases.includes(norm) || c.aliases.includes(norm.replace(/\s+/g, '')));
    return hit ? hit.key : null;
}

function bulkParseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

function bulkNormalizeMatrix(matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const idx = rows.findIndex((row) => {
        const keys = (row || []).map(bulkHeaderKey);
        return keys.includes('quantity') && keys.includes('path');
    });
    return idx > 0 ? rows.slice(idx) : rows;
}

async function bulkReadSheet(file) {
    if (window.XLSX) {
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const preferred = wb.SheetNames.find((name) => /^intake$/i.test(name)) || wb.SheetNames[0];
        const sheet = wb.Sheets[preferred];
        return bulkNormalizeMatrix(window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }));
    }
    if (!/\.csv$/i.test(file.name)) throw new Error('Excel reader unavailable — save the sheet as CSV and try again.');
    return bulkNormalizeMatrix(bulkParseCsv(await file.text()));
}

function bulkSheetToRows(matrix) {
    const [header = [], ...body] = matrix || [];
    const keys = header.map(bulkHeaderKey);
    if (!keys.includes('quantity')) {
        throw new Error('A "Quantity" column is required. Download the template to see the expected columns.');
    }
    if (!keys.includes('path')) {
        throw new Error('A "Path" column is required. Example: Cineom Assets / Accessories / URSA / Case');
    }
    if (!keys.some((k) => ['productId', 'product_code', 'name', 'description', 'make', 'model'].includes(k))) {
        throw new Error('Add a Product Name column (or Product ID / Code / Description / Make / Model) so each row can be matched to or create a Product.');
    }
    const ignored = header.filter((h, i) => String(h || '').trim() && !keys[i]);
    const rows = [];
    body.forEach((cells, idx) => {
        const raw = {};
        let any = false;
        keys.forEach((key, i) => {
            if (!key) return;
            const value = String(cells[i] == null ? '' : cells[i]).trim();
            if (value) any = true;
            raw[key] = value;
        });
        if (!any) return;
        rows.push({
            rowNumber: idx + 2,
            ref: {
                productId: raw.productId || '',
                product_code: raw.product_code || '',
                name: raw.name || '',
                make: raw.make || '',
                model: raw.model || ''
            },
            productInfo: {
                description: raw.description || '',
                manufacturer: raw.manufacturer || '',
                hsn_code: raw.hsn_code || '',
                price: raw.price || ''
            },
            quantity: raw.quantity || '',
            unit: raw.unit || '',
            price: bulkNormalizePrice(raw.price),
            itemName: raw.itemName || '',
            itemDescription: raw.itemDescription || '',
            purchaseDate: raw.purchaseDate || '',
            pathText: raw.path || '',
            pathLeaf: '',
            pathError: '',
            pathSegments: [],
            location: raw.location || '',
            match: null,
            product: null,
            folderId: '',
            kindId: '',
            brandId: '',
            errors: []
        });
    });
    return { rows, ignored };
}

function bulkRowFromRecord(record) {
    return BULK_COLUMNS.map((col) => {
        const value = record && record[col.key];
        return value == null ? '' : value;
    });
}

function bulkTemplateExampleRecords() {
    return [
        {
            name: 'Gansgassa Konvision',
            make: 'Konvision',
            model: 'Gansgassa',
            manufacturer: 'Konvision',
            description: 'Catalog text on the Product. Not copied onto the Asset unless you tick Port Product description.',
            hsn_code: '8528',
            itemName: 'Konvision Gansgassa #1',
            itemDescription: 'Opening-balance monitor — this text is stored on the Asset.',
            purchaseDate: '2024-04-01',
            price: '80000',
            quantity: '1',
            unit: 'Nos',
            path: 'Cineom Assets / Hardware / Backlight Boards / Konvision',
            location: 'Mumbai'
        },
        {
            product_code: 'CAN-XLR-10M',
            name: 'XLR Cable 10m',
            make: 'Canare',
            model: 'L-4E6S',
            manufacturer: 'Canare',
            description: 'Product catalog cable.',
            hsn_code: '8544',
            itemDescription: 'Legacy store stock cable.',
            purchaseDate: '15/04/2024',
            price: '450',
            quantity: '12',
            unit: 'Nos',
            path: 'Stores / Cables',
            location: 'Mumbai'
        },
        {
            productId: '(paste an existing Product ID here)',
            itemDescription: 'Required unless you tick Port Product description in Bulk.',
            purchaseDate: '2024-06-12',
            price: '0',
            quantity: '1',
            unit: 'Nos',
            path: 'Cineom Assets / Hardware / Laptops / Dell',
            location: 'Mumbai'
        }
    ];
}

function bulkTemplateColumnGuide() {
    return [
        ['Column', 'Required?', 'Goes onto', 'Notes'],
        ['Product ID', 'One of Product ID / Code / Name', 'Match existing Product', 'Fastest match. Leave blank if the Product is not in AssetEngine yet.'],
        ['Product Code', 'One of Product ID / Code / Name', 'Match or create Product', 'SKU / part number.'],
        ['Product Name', 'One of Product ID / Code / Name', 'Match or create Product', 'Make and Model help when names collide.'],
        ['Make', 'Optional', 'Product', 'Used when matching or creating a Product.'],
        ['Model', 'Optional', 'Product', 'Used when matching or creating a Product.'],
        ['Manufacturer', 'Optional', 'Product', 'Stored on a newly created Product.'],
        ['Product Description', 'Optional', 'Product only', 'Does not become Asset / Inventory description unless you port it in Bulk.'],
        ['HSN', 'Optional', 'Product', 'HSN / SAC on a newly created Product.'],
        ['Item Name', 'Optional', 'Asset / Inventory', 'Holding name. Blank uses the Product name.'],
        ['Holding Description', 'Required unless you port', 'Asset / Inventory', 'This is what Edit Asset shows. Separate from Product Description.'],
        ['Purchase Date', 'Optional', 'Asset / Inventory', 'YYYY-MM-DD or DD/MM/YYYY.'],
        ['Price', 'Optional', 'Asset Value / Inventory value', 'Number only (80000). Writes to the holding. Blank stores 0. Does not pull Product price automatically.'],
        ['Quantity', 'Required', 'Asset / Inventory qty', 'Must be greater than 0. One row = one holding with that quantity.'],
        ['Unit', 'Optional', 'Holding unit', 'Blank uses the Product unit, then Nos.'],
        ['Path', 'Required', 'Folder in the tree', 'Exact names, separated by /. Each segment must already exist. Asset example: Cineom Assets / Hardware / Backlight Boards / Konvision. Inventory example: Stores / Cables.'],
        ['Location', 'Optional', 'Holding location', 'Blank uses Mumbai (or the location chosen in the wizard).']
    ];
}

function bulkTemplateInstructions() {
    return [
        ['AssetEngine bulk Physical Intake'],
        [''],
        ['What this file is'],
        ['Fill the Intake sheet, then use Physical Intake → Bulk → Upload CSV / Excel.'],
        ['Holding type (Asset vs Inventory), intake type, and source are chosen in the app — not in this file.'],
        ['Each data row registers one holding as non-procurement stock (PO Expected Later). It is not a Receipt Note and does not create a Purchase Order.'],
        [''],
        ['Which sheet is uploaded'],
        ['The app reads the sheet named Intake. Examples and these notes are ignored.'],
        ['Do not rename the header row. Extra columns are ignored.'],
        [''],
        ['How to fill Intake'],
        ['1. Leave the header row as-is.'],
        ['2. Add one row per holding (at most 200). Split larger lists into another file.'],
        ['3. Identify the Product with Product ID, Product Code, or Product Name. Make / Model help.'],
        ['4. Put the Asset / Inventory description in Holding Description (or tick Port Product description in the app).'],
        ['5. Put the holding unit value in Price. That becomes Asset Value in the dashboard. Leave Price blank only when the value should be 0.'],
        ['6. Put Quantity and Path. Path names must already exist in the tree, in order, separated by /.'],
        ['7. Empty rows are skipped. Do not copy the Examples sheet onto Intake unless you mean to register those rows.'],
        [''],
        ['Product vs holding'],
        ['Product Description and Product price live on the Product catalog.'],
        ['Holding Description and Price live on the Asset or Inventory row.'],
        ['They stay different unless you copy them on purpose (port description in Bulk, or type the same Price).'],
        [''],
        ['After upload'],
        ['Review the preview, create any missing Products if asked, then Register.'],
        ['New holdings appear under the Path you set. If a brand-new row is missing for a few minutes, refresh — the asset list can cache for up to 5 minutes.']
    ];
}

function downloadBulkIntakeTemplate() {
    const headers = BULK_COLUMNS.map((c) => c.label);
    const examples = bulkTemplateExampleRecords().map(bulkRowFromRecord);
    const guide = bulkTemplateColumnGuide();
    const instructions = bulkTemplateInstructions();

    if (window.XLSX) {
        const wb = window.XLSX.utils.book_new();
        const intake = window.XLSX.utils.aoa_to_sheet([headers]);
        intake['!cols'] = headers.map((h) => ({ wch: Math.max(16, String(h).length + 4) }));
        intake['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
        const exampleSheet = window.XLSX.utils.aoa_to_sheet([
            ['These rows are examples only. Copy what you need onto Intake. This sheet is not imported.'],
            [],
            headers,
            ...examples
        ]);
        exampleSheet['!cols'] = headers.map((h) => ({ wch: Math.max(16, String(h).length + 4) }));
        exampleSheet['!views'] = [{ state: 'frozen', ySplit: 3, topLeftCell: 'A4' }];
        const cols = window.XLSX.utils.aoa_to_sheet(guide);
        cols['!cols'] = [{ wch: 24 }, { wch: 32 }, { wch: 28 }, { wch: 88 }];
        const how = window.XLSX.utils.aoa_to_sheet(instructions);
        how['!cols'] = [{ wch: 100 }];
        window.XLSX.utils.book_append_sheet(wb, intake, 'Intake');
        window.XLSX.utils.book_append_sheet(wb, exampleSheet, 'Examples');
        window.XLSX.utils.book_append_sheet(wb, cols, 'Columns');
        window.XLSX.utils.book_append_sheet(wb, how, 'Instructions');
        window.XLSX.writeFile(wb, 'AssetEngine_Physical_Intake_Template.xlsx');
        return;
    }

    const csvEscape = (value) => {
        const text = String(value == null ? '' : value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
        'AssetEngine bulk Physical Intake — fill rows below the header. Holding type is chosen in the app.',
        'Price is Asset Value on the holding. Holding Description is required unless you port Product description.',
        headers.map(csvEscape).join(','),
        ...examples.map((row) => row.map(csvEscape).join(','))
    ];
    const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'AssetEngine_Physical_Intake_Template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function bulkIsAsset() {
    return wizard.holdingType === 'ASSET';
}

function bulkFolderList() {
    if (!bulkIsAsset()) return intakeHierarchy.invFolders;
    const module = currentModule();
    return intakeHierarchy.assetFolders.filter((f) => {
        const mod = rowModule(f);
        return !mod || mod === module;
    });
}

function bulkFolderParentId(folder) {
    return String(folder?.parentid || folder?.ParentID || folder?.ParentId || folder?.parentId || '').trim();
}

function bulkChildFolder(parentId, name) {
    const wanted = String(name || '').trim().toLowerCase();
    const pid = String(parentId || '');
    if (!wanted || !pid) return null;
    return bulkFolderList().find((folder) => {
        if (bulkFolderParentId(folder) !== pid) return false;
        return rowName(folder).toLowerCase() === wanted || rowId(folder).toLowerCase() === wanted;
    }) || null;
}

function bulkMatchFolder(text) {
    const key = String(text || '').trim().toLowerCase();
    if (!key) return '';
    const hit = bulkFolderList().find((f) => rowId(f).toLowerCase() === key || rowName(f).toLowerCase() === key);
    return hit ? rowId(hit) : '';
}

function bulkKindOptionValues(folderId) {
    if (bulkIsAsset()) {
        const tmp = document.createElement('select');
        tmp.innerHTML = assetKindOptionsHtml(folderId, '');
        return [...tmp.options].filter((o) => o.value).map((o) => ({ id: o.value, name: o.textContent }));
    }
    return intakeHierarchy.invKinds
        .filter((k) => !folderId || rowFolderId(k) === String(folderId))
        .map((k) => ({ id: rowId(k), name: rowName(k) }));
}

function bulkMatchKind(folderId, text) {
    const key = String(text || '').trim().toLowerCase();
    if (!key || !folderId) return '';
    const hit = bulkKindOptionValues(folderId).find((k) => k.id.toLowerCase() === key || k.name.toLowerCase() === key);
    return hit ? hit.id : '';
}

function bulkFolderName(folderId) {
    const list = bulkIsAsset() ? intakeHierarchy.assetFolders : intakeHierarchy.invFolders;
    const hit = list.find((f) => rowId(f) === String(folderId || ''));
    return hit ? rowName(hit) : '';
}

function bulkKindName(folderId, kindId) {
    if (bulkIsAsset()) return kindId;
    const hit = intakeHierarchy.invKinds.find((k) => rowId(k) === String(kindId || ''));
    return hit ? rowName(hit) : '';
}

function bulkRowResolved(row) {
    return Boolean(row.product && Number(row.quantity) > 0 && row.pathLeaf && !bulkHierarchyIssues(row).length);
}

function bulkRefLabel(ref) {
    const bits = [ref.productId, ref.product_code, ref.name, ref.make, ref.model].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'No Product reference';
}

function bulkMarkDirty() {
    bulk.validated = false;
    bulk.rows.forEach((r) => { r.errors = []; });
}

function renderBulkHeader() {
    const host = wizardHost();
    if (!host) return;
    claimContent();
    const typeOptions = Object.entries(INTAKE_TYPE_LABELS)
        .map(([value, label]) => `<option value="${escapeHtml(value)}" ${wizard.intakeType === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
        .join('');
    host.innerHTML = piSheet({
        kicker: 'Bulk Physical Intake',
        title: 'Sheet details',
        lead: 'Register many existing or non-procurement holdings from one CSV or Excel sheet. Rows are matched to existing Products. All rows are registered together, or none are.',
        body: `<p class="pi-callout">Bulk intake registers every row as PO Expected Later. Link Purchase Orders afterwards from Awaiting Adoption.</p>
            <div class="pi-fields pi-fields-3">
                <div>
                    <label class="lc-k" for="piBulkHolding">Holding type</label>
                    <select id="piBulkHolding" class="form-input">
                        <option value="">Select</option>
                        <option value="ASSET" ${wizard.holdingType === 'ASSET' ? 'selected' : ''}>Asset</option>
                        <option value="INVENTORY" ${wizard.holdingType === 'INVENTORY' ? 'selected' : ''}>Inventory</option>
                    </select>
                </div>
                <div>
                    <label class="lc-k" for="piBulkType">Intake type</label>
                    <select id="piBulkType" class="form-input">
                        <option value="">Select</option>
                        ${typeOptions}
                    </select>
                </div>
                <div>
                    <label class="lc-k" for="piLocation">Default location</label>
                    <input type="text" id="piLocation" class="form-input" value="${escapeHtml(wizard.location || 'Mumbai')}">
                </div>
            </div>
            <div id="piBulkSource" class="pi-source-fields pi-fields">${sourceFieldsHtml()}</div>
            ${renderExpectedFields()}`,
        foot: `<button type="button" class="action-button grey" id="piBulkCancel">Cancel</button>
                <button type="button" class="action-button blue" id="piBulkNext">Next: upload sheet</button>`
    });
    el('piBulkType')?.addEventListener('change', () => {
        collectSource();
        wizard.intakeType = el('piBulkType').value;
        wizard.source = {};
        wizard.reason = '';
        el('piBulkSource').innerHTML = sourceFieldsHtml();
    });
    el('piBulkCancel')?.addEventListener('click', () => {
        resetWizard();
        renderIntakeList().catch((err) => toastOperatorError(err));
    });
    el('piBulkNext')?.addEventListener('click', async () => {
        const holding = el('piBulkHolding')?.value || '';
        wizard.intakeType = el('piBulkType')?.value || '';
        if (!holding) { showToast('Choose Asset or Inventory.', 'error'); return; }
        if (!wizard.intakeType) { showToast('Choose an intake type.', 'error'); return; }
        collectSource();
        wizard.expectedPoNumber = el('piExpectedPoNumber')?.value?.trim() || '';
        wizard.expectedVendorRef = el('piExpectedVendor')?.value?.trim() || '';
        if ((wizard.intakeType === 'NON_PO_ACQUISITION' || wizard.intakeType === 'OTHER_APPROVED') && !wizard.reason) {
            showToast('A reason is required for this intake type.', 'error');
            return;
        }
        if (wizard.intakeType === 'INTERNAL_TRANSFER' && !wizard.source.sourceLocation) {
            showToast('Source location / context is required for Internal Transfer intake.', 'error');
            return;
        }
        if (wizard.holdingType !== holding) {
            wizard.holdingType = holding;
            bulk.rows.forEach((r) => { r.folderId = ''; r.kindId = ''; r.brandId = ''; });
        }
        try {
            await loadIntakeHierarchy();
        } catch (err) {
            toastOperatorError(err);
            return;
        }
        bulk.rows.forEach((r) => applyBulkAssetPath(r));
        bulkMarkDirty();
        renderBulkRows();
    });
}

function bulkProductCell(row, idx) {
    if (row.product) {
        return `<div><strong class="lc-mono">${escapeHtml(row.product.id)}</strong> · ${escapeHtml(row.product.name || '')}</div>
            <button type="button" class="lc-crumb-link" data-bulk-act="unpick" data-idx="${idx}">Change</button>`;
    }
    const status = row.match?.status || 'UNMATCHED';
    const candidates = row.match?.candidates || [];
    const label = status === 'AMBIGUOUS' ? `${candidates.length} possible Products` : 'No matching Product';
    return `<div class="lc-muted" style="font-size:12px;">${escapeHtml(bulkRefLabel(row.ref))}</div>
        <span class="lc-chip" style="background:${status === 'AMBIGUOUS' ? '#fef9c3' : '#fee2e2'};color:${status === 'AMBIGUOUS' ? '#854d0e' : '#991b1b'};">${escapeHtml(label)}</span>
        ${candidates.length ? `<select class="form-input" data-bulk-act="candidate" data-idx="${idx}" style="margin-top:4px;">
            <option value="">Choose Product</option>
            ${candidates.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)} · ${escapeHtml([c.name, c.make, c.model].filter(Boolean).join(' / '))}</option>`).join('')}
        </select>` : ''}
        <input type="search" class="form-input" data-bulk-act="search" data-idx="${idx}" placeholder="Search Products..." style="margin-top:4px;">
        <div data-bulk-hits="${idx}"></div>
        ${bulkRowProductName(row) ? `<button type="button" class="action-button green" data-bulk-act="create" data-idx="${idx}" style="margin-top:4px;">Create Product "${escapeHtml(bulkRowProductName(row))}"</button>` : ''}`;
}

function bulkFolderOptions(selected) {
    return bulkIsAsset() ? assetFolderOptionsHtml(selected) : invFolderOptionsHtml(selected);
}

function bulkKindOptions(folderId, selected) {
    return bulkIsAsset() ? assetKindOptionsHtml(folderId, selected) : invKindOptionsHtml(folderId, selected);
}

function bulkBrandOptions(kindName, selected) {
    if (!bulkIsAsset()) return '<option value="">Generic / Default</option>';
    return assetBrandOptionsHtml(kindName, selected);
}

function bulkSplitPath(text) {
    return String(text || '').split(/[/|>]+/).map((part) => part.trim()).filter(Boolean);
}

function bulkIsGenericBrand(text) {
    return /^generic(\s*\/\s*default)?$/i.test(String(text || '').trim());
}

function bulkKindByParent(parentName, name, parentId) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted || (!parentName && !parentId)) return null;
    return intakeHierarchy.assetKinds.find((kind) => {
        if (Number(kind.is_deleted || kind.IsDeleted) === 1) return false;
        return kindMatchesParent(kind, parentName, parentId) && assetKindName(kind).toLowerCase() === wanted;
    }) || null;
}

function bulkKnownPaths() {
    if (!bulkIsAsset()) {
        return intakeHierarchy.invKinds.map((kind) => {
            const folder = intakeHierarchy.invFolders.find((item) => rowId(item) === rowFolderId(kind));
            return folder ? `${rowName(folder)} / ${rowName(kind)}` : '';
        }).filter(Boolean);
    }
    const paths = [];
    const walkKinds = (parentName, prefix, parentId, seenKinds) => {
        const children = intakeHierarchy.assetKinds.filter((kind) => {
            if (Number(kind.is_deleted || kind.IsDeleted) === 1) return false;
            const childKey = String(rowId(kind) || assetKindName(kind)).toLowerCase();
            if (!childKey || seenKinds.has(childKey)) return false;
            return kindMatchesParent(kind, parentName, parentId);
        });
        if (!children.length) {
            if (prefix.length > 1) paths.push(prefix.join(' / '));
            return;
        }
        children.forEach((child) => {
            const name = assetKindName(child);
            const childId = String(rowId(child) || name);
            const nextSeen = new Set(seenKinds);
            nextSeen.add(childId.toLowerCase());
            walkKinds(name, prefix.concat(name), childId, nextSeen);
        });
    };
    const walkFolder = (folder, prefix) => {
        const id = rowId(folder);
        bulkFolderList()
            .filter((child) => bulkFolderParentId(child) === String(id))
            .forEach((child) => walkFolder(child, prefix.concat(rowName(child))));
        walkKinds(rowName(folder), prefix, id, new Set());
    };
    const folders = bulkFolderList();
    folders.filter((folder) => !bulkFolderParentId(folder)).forEach((folder) => walkFolder(folder, [rowName(folder)]));
    folders.forEach((folder) => {
        const pid = bulkFolderParentId(folder);
        if (pid && !folders.some((parent) => rowId(parent) === pid)) {
            walkFolder(folder, [rowName(folder)]);
        }
    });
    return paths;
}

/** Path only: folder, then each next name must already sit inside the previous one. */
function applyBulkAssetPath(row) {
    row.pathError = '';
    row.pathLeaf = '';
    row.pathSegments = [];
    row.folderId = '';
    row.kindId = '';
    row.brandId = '';
    const segments = bulkSplitPath(row.pathText);
    if (!segments.length) {
        row.pathError = bulkIsAsset()
            ? 'Path is required. Example: Cineom Assets / Accessories / URSA / Case'
            : 'Path is required. Example: Stores / Cables';
        return;
    }

    if (!bulkIsAsset()) {
        row.folderId = bulkMatchFolder(segments[0]);
        if (!row.folderId) {
            row.pathError = `“${segments[0]}” is not a Parent Folder. Add it in the UI, then use that name.`;
            return;
        }
        if (segments.length > 2) {
            row.pathError = `“${segments[2]}” is past Inventory’s folder / category. Inventory stops at the category.`;
            return;
        }
        if (!segments[1]) {
            row.pathError = 'The path needs a category under the folder. Example: Stores / Cables';
            return;
        }
        row.kindId = bulkMatchKind(row.folderId, segments[1]);
        if (!row.kindId) {
            row.pathError = `“${segments[1]}” is not a Category under “${segments[0]}”. Add it in the UI, then use that name.`;
            return;
        }
        const folderName = bulkFolderName(row.folderId);
        const kindName = bulkKindName(row.folderId, row.kindId);
        row.pathLeaf = kindName;
        row.pathSegments = [folderName, kindName].filter(Boolean);
        return;
    }

    const folderKey = segments[0].toLowerCase();
    const folderHits = bulkFolderList().filter((item) => rowId(item).toLowerCase() === folderKey || rowName(item).toLowerCase() === folderKey);
    let folder = folderHits[0] || null;
    if (folderHits.length > 1) {
        const next = segments[1];
        folder = folderHits.find((item) => next && (bulkChildFolder(rowId(item), next) || bulkKindByParent(rowName(item), next, rowId(item))))
            || folderHits.find((item) => !bulkFolderParentId(item))
            || folderHits[0];
    }
    if (!folder) {
        row.folderId = '';
        row.kindId = '';
        row.brandId = '';
        const other = (intakeHierarchy.assetFolders || []).find((item) => {
            const key = rowName(item).toLowerCase() === folderKey || rowId(item).toLowerCase() === folderKey;
            return key && rowModule(item) && rowModule(item) !== currentModule();
        });
        row.pathError = other
            ? `“${segments[0]}” is in the ${rowModule(other)} module, not ${currentModule()}. Switch module in the app, or use a ${currentModule()} folder.`
            : `“${segments[0]}” is not a folder in ${currentModule()}. Use the folder name from the tree, including nested folders.`;
        return;
    }
    const names = [rowName(folder)];
    let i = 1;
    while (i < segments.length) {
        const nested = bulkChildFolder(rowId(folder), segments[i]);
        if (!nested) break;
        folder = nested;
        names.push(rowName(folder));
        i += 1;
    }
    row.folderId = rowId(folder);
    let parentName = rowName(folder);
    let parentId = rowId(folder);
    let kindName = '';
    let second = '';
    for (; i < segments.length; i += 1) {
        const hit = bulkKindByParent(parentName, segments[i], parentId);
        if (!hit) {
            row.kindId = kindName;
            row.brandId = second;
            row.pathLeaf = '';
            row.pathSegments = names;
            row.pathError = `“${segments[i]}” is not inside “${parentName}”. Use an existing subfolder, category, or make under that name.`;
            return;
        }
        const name = assetKindName(hit);
        if (!kindName) kindName = name;
        else if (!second) second = name;
        names.push(name);
        parentName = name;
        parentId = rowId(hit) || name;
    }
    if (!kindName) {
        row.kindId = '';
        row.pathError = 'The path needs a category under the folder.';
        return;
    }
    row.kindId = kindName;
    row.brandId = second;
    if (second) row.brandPicked = true;
    row.pathLeaf = names[names.length - 1];
    row.pathSegments = names;
}

function bulkMatchBrand(kindName, text) {
    const key = String(text || '').trim().toLowerCase();
    if (!key || !kindName || !bulkIsAsset()) return '';
    const tmp = document.createElement('select');
    tmp.innerHTML = assetBrandOptionsHtml(kindName, '');
    const hit = [...tmp.options].find((opt) => opt.value && (opt.value.toLowerCase() === key || opt.textContent.toLowerCase() === key));
    return hit ? hit.value : '';
}

function bulkHierarchyIssues(row) {
    return row.pathError ? [row.pathError] : [];
}

function bulkStatusCell(row) {
    if (row.errors && row.errors.length) {
        return `<span class="lc-chip" style="background:#fee2e2;color:#991b1b;">Error</span>
            <div style="font-size:12px;color:#991b1b;">${row.errors.map(escapeHtml).join('<br>')}</div>`;
    }
    if (!row.product && bulkRowReadyExceptProduct(row)) {
        return '<span class="lc-chip" style="background:#e0f2fe;color:#075985;">New Product will be created</span>';
    }
    const hierarchy = bulkHierarchyIssues(row);
    if (!bulkRowResolved(row) || hierarchy.length) {
        const missing = [];
        if (!row.product) missing.push('Product');
        if (!(Number(row.quantity) > 0)) missing.push('Quantity');
        if (!row.pathLeaf) missing.push('Path');
        const head = missing.length ? `Needs ${missing.join(', ')}` : 'Unknown hierarchy name';
        return `<span class="lc-chip" style="background:#fef9c3;color:#854d0e;">${escapeHtml(head)}</span>
            ${hierarchy.length ? `<div style="font-size:12px;color:#854d0e;">${hierarchy.map(escapeHtml).join('<br>')}</div>` : ''}`;
    }
    return bulk.validated
        ? '<span class="lc-chip" style="background:#dcfce7;color:#166534;">Checked</span>'
        : '<span class="lc-chip" style="background:#e0f2fe;color:#075985;">Ready</span>';
}

function renderBulkTable() {
    const body = el('piBulkBody');
    if (!body) return;
    body.innerHTML = bulk.rows.map((row, idx) => `
        <tr>
            <td class="rn-sheet-idx">${escapeHtml(String(row.rowNumber))}</td>
            <td class="pi-col-product">${bulkProductCell(row, idx)}</td>
            <td><input type="text" class="form-input" data-bulk-act="itemName" data-idx="${idx}" value="${escapeHtml(row.itemName || '')}" placeholder="Product name if blank"></td>
            <td><input type="text" class="form-input" data-bulk-act="purchaseDate" data-idx="${idx}" value="${escapeHtml(row.purchaseDate || '')}" placeholder="YYYY-MM-DD"></td>
            <td class="rn-sheet-num"><input type="text" class="form-input" data-bulk-act="price" data-idx="${idx}" value="${escapeHtml(row.price || '')}" placeholder="0"></td>
            <td class="rn-sheet-num"><input type="number" min="0.000001" step="any" class="form-input" data-bulk-act="qty" data-idx="${idx}" value="${escapeHtml(row.quantity)}"></td>
            <td><input type="text" class="form-input" data-bulk-act="unit" data-idx="${idx}" value="${escapeHtml(row.unit || row.product?.unit || '')}" placeholder="Nos"></td>
            <td class="pi-col-path">
                <input type="text" class="form-input" list="piBulkPathList" data-bulk-act="path" data-idx="${idx}" value="${escapeHtml(row.pathText || '')}" placeholder="${bulkIsAsset() ? 'Cineom Assets / Accessories / URSA / Case' : 'Stores / Cables'}">
                ${row.pathError ? `<div class="rn-sheet-sub">${escapeHtml(row.pathError)}</div>` : ''}
            </td>
            <td><input type="text" class="form-input" data-bulk-act="location" data-idx="${idx}" value="${escapeHtml(row.location)}" placeholder="${escapeHtml(wizard.location || 'Mumbai')}"></td>
            <td data-bulk-status="${idx}">${bulkStatusCell(row)}</td>
            <td><button type="button" class="action-button grey" data-bulk-act="remove" data-idx="${idx}" title="Remove row">×</button></td>
        </tr>
    `).join('') || '<tr><td colspan="11" class="rn-sheet-empty">Upload a CSV or Excel sheet to add rows.</td></tr>';
    refreshBulkFooter();
}

function refreshBulkStatus(idx) {
    const cell = document.querySelector(`[data-bulk-status="${idx}"]`);
    if (cell) cell.innerHTML = bulkStatusCell(bulk.rows[idx]);
    refreshBulkFooter();
}

function refreshBulkFooter() {
    const total = bulk.rows.length;
    const resolved = bulk.rows.filter(bulkRowResolved).length;
    const summary = el('piBulkSummary');
    if (summary) {
        summary.textContent = total
            ? `${resolved} of ${total} rows ready${bulk.validated ? ' · checked' : ''}`
            : 'No rows yet';
    }
    const missing = bulkMissingProductRows().length;
    const banner = el('piBulkMissingBanner');
    if (banner) banner.style.display = missing ? 'flex' : 'none';
    const bannerText = el('piBulkMissingText');
    if (bannerText) {
        bannerText.textContent = `${missing} row${missing === 1 ? ' has' : 's have'} no Product yet. Create them from the sheet's name / make / model, or pick an existing Product on each row.`;
    }
    const createMissing = el('piBulkCreateMissing');
    if (createMissing) {
        createMissing.disabled = bulk.busy || !missing;
        createMissing.textContent = `Create missing Products (${missing} row${missing === 1 ? '' : 's'})`;
    }
    const allResolved = total > 0 && resolved === total;
    const allCreatable = total > 0 && bulk.rows.every(bulkRowReadyExceptProduct);
    const check = el('piBulkCheck');
    if (check) check.disabled = bulk.busy || !allCreatable;
    const submit = el('piBulkSubmit');
    if (submit) {
        submit.disabled = bulk.busy || !allResolved || !bulk.validated;
        submit.textContent = `Register ${total} intake${total === 1 ? '' : 's'}`;
    }
}

function renderBulkRows() {
    const host = wizardHost();
    const isAsset = bulkIsAsset();
    host.innerHTML = piSheet({
        kicker: 'Bulk Physical Intake',
        title: isAsset ? 'Assets' : 'Inventory',
        lead: `${escapeHtml(INTAKE_TYPE_LABELS[wizard.intakeType] || wizard.intakeType)} · PO Expected Later${isAsset ? ` · module ${escapeHtml(currentModule())}` : ''}. Each row creates one ${isAsset ? 'Asset' : 'Inventory'} record with its quantity.`,
        wide: true,
        body: `<p class="pi-callout">Item Name is the name stored on the holding. Leave it blank to use the Product name. Holding Description is required on the holding and is not the Product Description column unless you port it. Purchase Date is YYYY-MM-DD or DD/MM/YYYY. Path is the folder. ${isAsset ? 'Example: Cineom Assets / Accessories / URSA / Case.' : 'Example: Stores / Cables.'} Each name must already exist under the previous one.</p>
            <label class="pi-choice" style="margin:10px 0;display:flex;align-items:flex-start;gap:8px;">
                <input type="checkbox" id="piBulkPortProductDesc" ${bulk.portProductDescription ? 'checked' : ''}>
                <span>Port Product description onto each holding that has no Holding Description. Product records stay unchanged.</span>
            </label>
            <div class="pi-bulk-tools">
                <button type="button" class="action-button grey" id="piBulkTemplate">Download bulk upload workbook</button>
                <label class="action-button blue" style="cursor:pointer;margin:0;">
                    Upload CSV / Excel
                    <input type="file" id="piBulkFile" accept=".csv,.xlsx,.xls" style="display:none;">
                </label>
                <span class="rn-sheet-sub" id="piBulkFileNote">${bulk.ignored.length ? `Ignored columns: ${escapeHtml(bulk.ignored.join(', '))}` : ''}</span>
            </div>
            <div class="pi-bulk-path">
                <div>
                    <label class="lc-k" for="piBulkAllPath">Place all rows in</label>
                    <input type="text" id="piBulkAllPath" class="form-input" list="piBulkPathList" placeholder="${isAsset ? 'Cineom Assets / Accessories / URSA / Case' : 'Stores / Cables'}">
                    <datalist id="piBulkPathList">${bulkKnownPaths().map((path) => `<option value="${escapeHtml(path)}"></option>`).join('')}</datalist>
                </div>
                <button type="button" class="action-button grey" id="piBulkApplyAll">Apply path to all rows</button>
            </div>
            <div id="piBulkMissingBanner" class="pi-callout pi-bulk-missing">
                <span id="piBulkMissingText"></span>
                <button type="button" class="action-button green" id="piBulkCreateMissing">Create missing Products</button>
            </div>
            <div class="pi-bulk-scroll">
                <table class="rn-sheet-table">
                    <thead>
                        <tr>
                            <th>Row</th>
                            <th>Product</th>
                            <th>Item Name</th>
                            <th>Purchase Date</th>
                            <th class="rn-sheet-num">Price</th>
                            <th class="rn-sheet-num">Qty</th>
                            <th>Unit</th>
                            <th>Path</th>
                            <th>Location</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="piBulkBody"></tbody>
                </table>
            </div>`,
        foot: `<button type="button" class="action-button grey" id="piBulkBack">Back</button>
                <span class="rn-sheet-sub" id="piBulkSummary"></span>
                <span class="pi-foot-spacer"></span>
                <button type="button" class="action-button blue" id="piBulkCheck">Check rows</button>
                <button type="button" class="action-button green" id="piBulkSubmit" disabled>Register</button>`
    });
    renderBulkTable();

    el('piBulkPortProductDesc')?.addEventListener('change', (ev) => {
        bulk.portProductDescription = !!ev.target.checked;
        bulkMarkDirty();
    });
    el('piBulkTemplate')?.addEventListener('click', downloadBulkIntakeTemplate);
    el('piBulkCreateMissing')?.addEventListener('click', bulkCreateMissingProducts);
    el('piBulkFile')?.addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (file) await loadBulkFile(file);
    });
    el('piBulkApplyAll')?.addEventListener('click', () => {
        const pathText = String(el('piBulkAllPath')?.value || '').trim();
        if (!pathText) {
            showToast('Enter the folder path to apply.', 'error');
            return;
        }
        bulk.rows.forEach((r) => {
            r.pathText = pathText;
            applyBulkAssetPath(r);
        });
        const problem = bulk.rows.find((r) => r.pathError);
        if (problem) showToast(problem.pathError, 'error');
        bulkMarkDirty();
        renderBulkTable();
    });
    el('piBulkBack')?.addEventListener('click', renderBulkHeader);
    el('piBulkCheck')?.addEventListener('click', () => submitBulk(true));
    el('piBulkSubmit')?.addEventListener('click', () => submitBulk(false));
    bindBulkTableEvents();
}

async function loadBulkFile(file) {
    try {
        const { rows, ignored } = bulkSheetToRows(await bulkReadSheet(file));
        if (!rows.length) { showToast('The sheet has no data rows.', 'error'); return; }
        if (rows.length > BULK_MAX_ROWS) {
            showToast(`At most ${BULK_MAX_ROWS} rows per bulk intake. Split the sheet and import in parts.`, 'error');
            return;
        }
        rows.forEach((r) => applyBulkAssetPath(r));
        const data = await api('/api/products/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows: rows.map((r) => ({
                    rowNumber: r.rowNumber,
                    ...r.ref,
                    name: bulkRowProductName(r) || r.ref.name || '',
                    description: (r.productInfo && r.productInfo.description) || ''
                }))
            })
        });
        const byRow = new Map((data.rows || []).map((m) => [m.row, m]));
        rows.forEach((r) => {
            r.match = byRow.get(r.rowNumber) || { status: 'UNMATCHED', candidates: [] };
            if (r.match.status === 'MATCHED' && r.match.candidates && r.match.candidates[0]) {
                r.product = r.match.candidates[0];
            }
        });
        bulk.rows = rows;
        bulk.ignored = ignored;
        bulk.batchKey = idempotencyKey('bulk');
        bulk.validated = false;
        const note = el('piBulkFileNote');
        if (note) note.textContent = ignored.length ? `Ignored columns: ${ignored.join(', ')}` : '';
        renderBulkTable();
        const unmatched = rows.filter((r) => !r.product).length;
        const unknownHierarchy = rows.filter((r) => bulkHierarchyIssues(r).length).length;
        const bits = [`${rows.length} rows loaded`];
        if (unmatched) bits.push(`${unmatched} have no Product yet`);
        if (unknownHierarchy) {
            const first = rows.find((r) => r.pathError);
            bits.push(first?.pathError || `${unknownHierarchy} have a Path that is not in the folder tree`);
        }
        if (!unmatched && !unknownHierarchy) bits.push('all matched to Products and existing hierarchy');
        showToast(bits.join(' · '), unmatched || unknownHierarchy ? 'warning' : 'success');
    } catch (err) {
        toastOperatorError(err);
    }
}

function bulkPickProduct(idx, product) {
    const row = bulk.rows[idx];
    if (!row || !product) return;
    row.product = { id: product.id, name: product.name, unit: product.unit || null };
    bulkMarkDirty();
    renderBulkTable();
}

function bulkNormalizePrice(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const n = Number(text.replace(/[₹$]/g, '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? String(n) : text;
}

function bulkRowProductName(row) {
    const info = row.productInfo || {};
    return row.ref.name
        || info.description
        || [row.ref.make, row.ref.model].filter(Boolean).join(' ')
        || row.ref.product_code
        || '';
}

function bulkProductDraft(row) {
    return {
        ...(row.productInfo || {}),
        price: row.price || (row.productInfo && row.productInfo.price) || '',
        rowNumber: row.rowNumber,
        name: bulkRowProductName(row),
        make: row.ref.make,
        model: row.ref.model,
        product_code: row.ref.product_code,
        unit: row.unit
    };
}

function bulkDraftKey(row) {
    return [bulkRowProductName(row), row.ref.make, row.ref.model]
        .map((v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase())
        .join('|');
}

function bulkMissingProductRows() {
    return bulk.rows.filter((r) => !r.product && bulkRowProductName(r));
}

function bulkRowReadyExceptProduct(row) {
    return Boolean((row.product || bulkRowProductName(row)) && Number(row.quantity) > 0 && row.pathLeaf && !bulkHierarchyIssues(row).length);
}

/**
 * Create Products for every unmatched row in one all-or-nothing call.
 * Rows sharing name/make/model share one new Product; rows that turn out to
 * match an existing Product are linked to it instead of creating a duplicate.
 */
async function bulkCreateMissingProducts() {
    const missing = bulkMissingProductRows();
    if (!missing.length) return true;
    const groups = new Map();
    missing.forEach((row) => {
        const key = bulkDraftKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    const drafts = [...groups.values()].map((rows) => bulkProductDraft(rows[0]));
    const noName = bulk.rows.filter((r) => !r.product && !bulkRowProductName(r)).length;
    const preview = drafts.slice(0, 8).map((d) => `• ${[d.name, d.make, d.model].filter(Boolean).join(' / ')}`).join('\n');
    if (!confirm(`${missing.length} row${missing.length === 1 ? ' has' : 's have'} no Product yet.\n\nCreate ${drafts.length} new Product${drafts.length === 1 ? '' : 's'} from the sheet?\n${preview}${drafts.length > 8 ? `\n…and ${drafts.length - 8} more` : ''}`
        + (noName ? `\n\n${noName} row(s) have no name, make or model and will still need a Product picked.` : ''))) return false;

    const btn = el('piBulkCreateMissing');
    if (btn) btn.disabled = true;
    try {
        const check = await api('/api/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun: true, rows: drafts })
        });
        const groupByRow = new Map([...groups.values()].map((rows) => [rows[0].rowNumber, rows]));
        const toCreate = [];
        let linked = 0;
        let flagged = 0;
        (check.rows || []).forEach((res) => {
            const rows = groupByRow.get(res.row) || [];
            if (res.status === 'VALID') {
                toCreate.push(drafts.find((d) => d.rowNumber === res.row));
                return;
            }
            if (res.status === 'DUPLICATE' && res.match && res.match.status === 'MATCHED' && res.match.candidates?.[0]) {
                const hit = res.match.candidates[0];
                rows.forEach((r) => { r.product = { id: hit.id, name: hit.name, unit: hit.unit || null }; });
                linked += rows.length;
                return;
            }
            flagged += rows.length;
            rows.forEach((r) => {
                if (res.match) r.match = res.match;
                r.errors = res.errors && res.errors.length ? res.errors : [];
            });
        });

        let created = 0;
        if (toCreate.length) {
            const data = await api('/api/products/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: false, rows: toCreate })
            });
            (data.created || []).forEach(({ row, product }) => {
                (groupByRow.get(row) || []).forEach((r) => {
                    r.product = { id: product.id, name: product.name, unit: product.unit || null };
                });
                created += 1;
            });
        }
        bulk.validated = false;
        renderBulkTable();
        const parts = [];
        if (created) parts.push(`${created} Product${created === 1 ? '' : 's'} created`);
        if (linked) parts.push(`${linked} row(s) linked to existing Products`);
        if (flagged) parts.push(`${flagged} row(s) need a Product picked`);
        showToast(parts.join(' · ') || 'No Products created.', flagged ? 'warning' : 'success');
        return !flagged;
    } catch (err) {
        toastOperatorError(err);
        return false;
    } finally {
        refreshBulkFooter();
    }
}

async function bulkCreateProductFromRow(idx) {
    const row = bulk.rows[idx];
    const name = row ? bulkRowProductName(row) : '';
    if (!name) return;
    if (!confirm(`Create a new Product "${name}"${row.ref.make ? ` (${row.ref.make} ${row.ref.model || ''})` : ''}?`)) return;
    try {
        const data = await api('/api/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dryRun: false,
                rows: [bulkProductDraft(row)]
            })
        });
        const created = (data.created || [])[0];
        if (!created || !created.product) throw new Error('Product was not created.');
        bulkPickProduct(idx, created.product);
        showToast(`Product ${created.product.id} created.`, 'success');
    } catch (err) {
        const detail = err.details && err.details.rows && err.details.rows[0];
        if (detail && detail.status === 'DUPLICATE') {
            showToast('A matching Product already exists — pick it from the search instead.', 'error');
            return;
        }
        toastOperatorError(err);
    }
}

let bulkEventsBound = null;
function bindBulkTableEvents() {
    const body = el('piBulkBody');
    if (!body || bulkEventsBound === body) return;
    bulkEventsBound = body;
    let searchTimer = null;

    body.addEventListener('click', (ev) => {
        const target = ev.target.closest('[data-bulk-act]');
        if (!target) return;
        const idx = Number(target.getAttribute('data-idx'));
        const act = target.getAttribute('data-bulk-act');
        if (act === 'unpick') {
            bulk.rows[idx].product = null;
            bulkMarkDirty();
            renderBulkTable();
        } else if (act === 'remove') {
            bulk.rows.splice(idx, 1);
            bulkMarkDirty();
            renderBulkTable();
        } else if (act === 'create') {
            bulkCreateProductFromRow(idx);
        } else if (act === 'hit') {
            bulkPickProduct(idx, JSON.parse(target.getAttribute('data-product') || 'null'));
        }
    });

    body.addEventListener('change', (ev) => {
        const target = ev.target.closest('[data-bulk-act]');
        if (!target) return;
        const idx = Number(target.getAttribute('data-idx'));
        const row = bulk.rows[idx];
        if (!row) return;
        const act = target.getAttribute('data-bulk-act');
        if (act === 'candidate') {
            const found = (row.match?.candidates || []).find((c) => c.id === target.value);
            if (found) bulkPickProduct(idx, found);
            return;
        }
        if (act === 'qty') row.quantity = target.value;
        else if (act === 'unit') row.unit = target.value.trim();
        else if (act === 'itemName') row.itemName = target.value.trim();
        else if (act === 'purchaseDate') row.purchaseDate = target.value.trim();
        else if (act === 'price') row.price = bulkNormalizePrice(target.value);
        else if (act === 'location') row.location = target.value.trim();
        else if (act === 'path') {
            row.pathText = target.value.trim();
            applyBulkAssetPath(row);
        }
        else return;
        if (bulk.validated) {
            bulkMarkDirty();
            renderBulkTable();
            return;
        }
        row.errors = [];
        refreshBulkStatus(idx);
    });

    body.addEventListener('input', (ev) => {
        const target = ev.target.closest('[data-bulk-act="search"]');
        if (!target) return;
        const idx = Number(target.getAttribute('data-idx'));
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const hits = body.querySelector(`[data-bulk-hits="${idx}"]`);
            const q = target.value.trim();
            if (!hits) return;
            if (!q) { hits.innerHTML = ''; return; }
            try {
                const data = await api(`/api/products?q=${encodeURIComponent(q)}&status=ACTIVE&limit=6`);
                const products = data.products || [];
                hits.innerHTML = products.map((p) => `<button type="button" class="action-button grey" data-bulk-act="hit" data-idx="${idx}"
                    data-product="${escapeHtml(JSON.stringify({ id: p.id, name: p.name, unit: p.unit || null }))}"
                    style="margin:2px 4px 2px 0;font-size:12px;">${escapeHtml(p.id)} · ${escapeHtml(p.name)}</button>`).join('')
                    || '<p class="lc-muted" style="margin:4px 0;">No matching Products.</p>';
            } catch (err) {
                toastOperatorError(err);
            }
        }, 250);
    });
}

function bulkPayload(dryRun) {
    const isAsset = bulkIsAsset();
    return {
        dryRun,
        batchKey: bulk.batchKey,
        header: {
            holdingType: wizard.holdingType,
            intakeType: wizard.intakeType,
            reason: wizard.reason,
            source: wizard.source,
            location: wizard.location || 'Mumbai',
            commercialPoChoice: 'EXPECTED',
            expectedPoNumber: wizard.expectedPoNumber || null,
            expectedVendorRef: wizard.expectedVendorRef || null
        },
        rows: bulk.rows.map((row) => {
            const folderName = bulkFolderName(row.folderId);
            const kindName = bulkKindName(row.folderId, row.kindId);
            const brand = isAsset ? (row.brandId || '') : '';
            return {
                rowNumber: row.rowNumber,
                productId: row.product?.id,
                itemName: row.itemName || undefined,
                itemDescription: row.itemDescription || undefined,
                portProductDescription: bulk.portProductDescription === true,
                purchaseDate: row.purchaseDate || undefined,
                price: row.price === '' || row.price == null ? undefined : row.price,
                quantity: Number(row.quantity),
                unit: row.unit || row.product?.unit || undefined,
                location: row.location || undefined,
                folderId: row.folderId,
                kindId: row.kindId,
                parentFolder: folderName || undefined,
                folderPath: (row.pathSegments || []).filter(Boolean).join(' / ') || undefined,
                brandCategory: brand || undefined,
                type: isAsset ? (row.pathLeaf || brand || kindName || row.kindId) : (kindName || undefined),
                category: isAsset ? currentModule() : (kindName || undefined)
            };
        })
    };
}

function applyBulkRowResults(resultRows) {
    const byRow = new Map((resultRows || []).map((r) => [r.row, r]));
    bulk.rows.forEach((row) => {
        const res = byRow.get(row.rowNumber);
        row.errors = res && res.status === 'ERROR' ? (res.errors || ['Invalid row']) : [];
    });
}

async function submitBulk(dryRun) {
    if (!canMutate()) {
        showToast('Sales cannot create Physical Intakes.', 'error');
        return;
    }
    if (bulk.busy) return;
    if (bulk.rows.length && bulk.rows.every(bulkRowReadyExceptProduct) && bulkMissingProductRows().length) {
        const ok = await bulkCreateMissingProducts();
        if (!ok) return;
    }
    if (!bulk.rows.length || !bulk.rows.every(bulkRowResolved)) {
        showToast('Resolve every row (Product, quantity, and Path) first.', 'error');
        return;
    }
    if (!dryRun && !confirm(`Register ${bulk.rows.length} ${bulkIsAsset() ? 'Asset' : 'Inventory'} holdings as NON-PROCUREMENT INTAKE?`)) return;
    if (!bulk.batchKey) bulk.batchKey = idempotencyKey('bulk');
    bulk.busy = true;
    refreshBulkFooter();
    try {
        const data = await api('/api/physical-intakes/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bulkPayload(dryRun))
        });
        if (dryRun) {
            applyBulkRowResults(data.rows);
            bulk.validated = !data.summary?.error;
            renderBulkTable();
            showToast(bulk.validated
                ? `All ${data.summary.total} rows checked. Ready to register.`
                : `${data.summary.error} row(s) need attention.`, bulk.validated ? 'success' : 'error');
            return;
        }
        refreshAssetListAfterIntake(wizard.holdingType);
        renderBulkResult(data);
        showToast(`${(data.intakes || []).length} holdings registered.`, 'success');
    } catch (err) {
        if (err.details && Array.isArray(err.details.rows)) {
            applyBulkRowResults(err.details.rows);
            bulk.validated = false;
            renderBulkTable();
        }
        toastOperatorError(err);
    } finally {
        bulk.busy = false;
        refreshBulkFooter();
    }
}

function renderBulkResult(data) {
    const host = wizardHost();
    const intakes = data.intakes || [];
    const replayed = intakes.filter((i) => i.replayed).length;
    host.innerHTML = piSheet({
        kicker: 'Bulk Physical Intake',
        title: `Registered ${intakes.length} holding${intakes.length === 1 ? '' : 's'}`,
        lead: `Each holding is PO Expected Later and appears on Awaiting Adoption.${replayed ? ` ${replayed} row(s) were already registered by an earlier submit of this batch.` : ''}`,
        wide: true,
        body: `<table class="rn-sheet-table">
                <thead>
                    <tr>
                        <th>Row</th>
                        <th>Physical ID</th>
                        <th>Product</th>
                        <th class="rn-sheet-num">Qty</th>
                    </tr>
                </thead>
                <tbody>
                    ${intakes.map((i) => {
                        const view = String(i.resourceType).toUpperCase() === 'INVENTORY' ? 'inventory-view' : 'home-view';
                        return `<tr class="pi-bulk-open" data-id="${escapeHtml(i.id)}" style="cursor:pointer;">
                            <td class="rn-sheet-idx">${escapeHtml(String(i.row))}</td>
                            <td class="ms-mono">
                                ${i.resourceId ? `<button type="button" class="lc-crumb-link" data-lc-go="${view}" data-lc-open="${escapeHtml(i.resourceId)}">${escapeHtml(i.resourceId)}</button>` : '—'}
                            </td>
                            <td>${escapeHtml(i.productName || i.productId || '—')}</td>
                            <td class="rn-sheet-num">${formatQty(i.quantity)} ${escapeHtml(i.unit || '')}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`,
        foot: `<button type="button" class="action-button grey" id="piBulkAnother">Another bulk intake</button>
                <button type="button" class="action-button grey" id="piBulkAwaiting">Awaiting Adoption</button>
                <button type="button" class="action-button blue" id="piBulkDone">Back to list</button>`
    });
    host.querySelectorAll('tr.pi-bulk-open').forEach((row) => {
        row.addEventListener('click', (ev) => {
            if (ev.target.closest('button, a')) return;
            openDetail(row.getAttribute('data-id')).catch((err) => toastOperatorError(err));
        });
    });
    el('piBulkAnother')?.addEventListener('click', startBulkIntake);
    el('piBulkAwaiting')?.addEventListener('click', () => renderAwaitingAdoptionList().catch((err) => toastOperatorError(err)));
    el('piBulkDone')?.addEventListener('click', () => renderIntakeList().catch((err) => toastOperatorError(err)));
}

function startBulkIntake() {
    if (!canMutate()) {
        showToast('Sales cannot create Physical Intakes.', 'error');
        return;
    }
    claimContent();
    resetWizard();
    wizard.poStatus = 'EXPECTED';
    bulk.rows = [];
    bulk.ignored = [];
    bulk.batchKey = '';
    bulk.validated = false;
    bulk.busy = false;
    renderBulkHeader();
}

function startWizard(preset) {
    if (!canMutate()) {
        showToast('Sales cannot create Physical Intakes.', 'error');
        return;
    }
    claimContent();
    resetWizard();
    const opts = preset && typeof preset === 'object' ? preset : {};
    if (opts.holdingType) wizard.holdingType = opts.holdingType;
    if (opts.folderPath) wizard.folderPath = opts.folderPath;
    if (wizard.holdingType === 'ASSET') {
        renderStepType();
        return;
    }
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
        el('btnBulkPhysicalIntake')?.addEventListener('click', startBulkIntake);
        el('physicalIntakeSearch')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                intakeListPage = 0;
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
window.startBulkPhysicalIntake = startBulkIntake;
window.loadPhysicalIntakeProvenance = loadProvenance;
window.renderPhysicalIntakeProvenanceHtml = provenanceHtml;
window.bindPhysicalIntakePoLink = bindPhysicalIntakePoLink;
