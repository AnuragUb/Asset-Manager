/**
 * Dashboard — lifecycle overview. Receiving and composition use windowed SQL.
 * Other cards still use existing list APIs.
 */
import { showToast, canOpenAppView } from './utils.js?v=7.39';
import {
    lifecycleApi,
    escapeHtml,
    consumeOpen,
    toastOperatorError
} from './lifecycle.js?v=7.139';
import { gatherLifecycleFeed } from './lifecycle-history.js?v=7.75';
import { getDashboardEntityLink } from './dashboardEntityLink.js?v=7.40';
import {
    mount as mountHoldingsCharts,
    destroy as destroyHoldingsCharts,
    refresh as refreshHoldingsCharts,
    chartCardHtml,
    ASSET_SLICE_COLORS,
    INV_SLICE_COLORS
} from './holdingsChartsService.js?v=7.70';

const NEW_PRODUCT_DAYS = 7;
const RECENT_PRODUCT_HOURS = 24;
const RECENT_PRODUCT_LIMIT = 4;

function el(id) {
    return document.getElementById(id);
}

let opsPeriod = 'month';
let opsMetric = 'count';

function receivingStageCard(openCount, totalCount, period) {
    const p = escapeHtml(period || 'month');
    return `<div class="ops-stage ops-receiving-split ops-glossy-surface ops-lift" role="group" aria-label="Receiving">
        <span class="ops-stage-label">Receiving</span>
        <div class="ops-receiving-halves">
            <button type="button" class="ops-receiving-half ops-receiving-open" data-lc-go="receipts-view" data-lc-status="OPEN" data-lc-period="${p}" aria-label="Receiving: ${escapeHtml(openCount)} Open Notes. Show open Receipt Notes.">
                <span class="ops-stage-count">${escapeHtml(openCount)}</span>
                <span class="ops-stage-hint">Open Notes</span>
                <span class="ops-receiving-glow ops-receiving-glow-open" aria-hidden="true"></span>
            </button>
            <span class="ops-receiving-break" aria-hidden="true"></span>
            <button type="button" class="ops-receiving-half ops-receiving-total" data-lc-go="receipts-view" data-lc-status="ALL" data-lc-period="${p}" aria-label="Receiving: ${escapeHtml(totalCount)} Total. Show all Receipt Notes.">
                <span class="ops-stage-count">${escapeHtml(totalCount)}</span>
                <span class="ops-stage-hint">Total</span>
                <span class="ops-receiving-glow ops-receiving-glow-total" aria-hidden="true"></span>
            </button>
        </div>
    </div>`;
}

function stageCard(label, count, view, hint, extraAttr = '', extraClass = '') {
    return `<button type="button" class="ops-stage ops-glossy-surface ops-lift ${extraClass}" data-lc-go="${escapeHtml(view)}" ${extraAttr} aria-label="${escapeHtml(label)}: ${escapeHtml(count)}. ${escapeHtml(hint)}">
        <span class="ops-stage-label">${escapeHtml(label)}</span>
        <span class="ops-stage-count">${escapeHtml(count)}</span>
        <span class="ops-stage-hint">${escapeHtml(hint)}</span>
    </button>`;
}

function entityChipHtml(entity, missingLabel = '') {
    const link = getDashboardEntityLink(entity);
    if (!link) {
        const label = String(missingLabel || '').trim();
        if (!label) return '';
        return `<span class="ops-entity-chip ops-entity-chip-missing">${escapeHtml(label)}</span>`;
    }
    if (!link.accessible) {
        return `<span class="ops-entity-chip ops-entity-chip-missing" title="Not accessible">${escapeHtml(link.display)}</span>`;
    }
    return `<button type="button" class="ops-entity-chip" data-lc-go="${escapeHtml(link.view)}" data-lc-open="${escapeHtml(link.open)}" aria-label="${escapeHtml(link.accessibleName)}"><span class="ops-entity-id">${escapeHtml(link.display)}</span><span class="ops-entity-go" aria-hidden="true">↗</span></button>`;
}

function settled(promise) {
    return promise.then((data) => ({ ok: true, data })).catch((err) => ({ ok: false, err }));
}

function listFromResponse(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    if (data && Array.isArray(data.data)) return data.data;
    return [];
}

function isRetiredAsset(asset) {
    return asset.IsRetired == 1 || asset.is_retired == 1;
}

/** Holding-record count: non-retired Assets + current Inventory rows. Not quantity_total. */
function stockHoldings(assetRows, inventoryRows) {
    const assets = (assetRows || []).filter((asset) => !isRetiredAsset(asset)).length;
    const inventory = (inventoryRows || []).length;
    return { assets, inventory, total: assets + inventory };
}

function isWithinDays(iso, days) {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return (Date.now() - t) <= days * 86400000;
}

function isWithinHours(iso, hours) {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return (Date.now() - t) <= hours * 3600000;
}

function productCreatedAt(row) {
    return row.created_at || '';
}

function productEditedAt(row) {
    return row.updated_at || row.created_at || '';
}

function isReceivableWaitlistPo(po) {
    if (String(po.source || '').toUpperCase() === 'LOCAL') return false;
    if (po.reconciliationRequired || po.mappingRequired) return false;
    if (String(po.status || '').toUpperCase() === 'CANCELLED') return false;
    const lines = (po.lines || []).filter((line) => String(line.lineStatus || 'OPEN').toUpperCase() !== 'WITHDRAWN');
    return lines.some((line) => Number(line.outstanding || 0) > 0);
}

function waitlistLineCount(poRows) {
    let lines = 0;
    let pos = 0;
    (poRows || []).forEach((po) => {
        if (!isReceivableWaitlistPo(po)) return;
        const outstanding = (po.lines || []).filter((line) => String(line.lineStatus || 'OPEN').toUpperCase() !== 'WITHDRAWN' && Number(line.outstanding || 0) > 0);
        if (!outstanding.length) return;
        pos += 1;
        lines += outstanding.length;
    });
    return { lines, pos };
}

function productsCardHtml(productRows) {
    const rows = productRows || [];
    const newCount = rows.filter((p) => isWithinDays(productCreatedAt(p), NEW_PRODUCT_DAYS)).length;
    const recent = [...rows]
        .filter((p) => isWithinHours(productEditedAt(p), RECENT_PRODUCT_HOURS))
        .sort((a, b) => String(productEditedAt(b)).localeCompare(String(productEditedAt(a))))
        .slice(0, RECENT_PRODUCT_LIMIT);
    const recentHtml = recent.length
        ? recent.map((p) => (
            p && p.id
                ? entityChipHtml({ type: 'PRODUCT', id: p.id, name: p.name, ref: p.id })
                : ''
        )).join('')
        : '<span class="ops-mini-hint">None in the last 24 hours</span>';
    return `<div class="ops-stage ops-product-card ops-product-card-compact ops-glossy-surface ops-lift">
        <button type="button" class="ops-product-head" data-lc-go="products-view" aria-label="Products: ${newCount} new in the last ${NEW_PRODUCT_DAYS} days. Open Products workspace.">
            <span class="ops-stage-label">Products</span>
            <span class="ops-stage-count">${escapeHtml(newCount)}</span>
            <span class="ops-stage-hint">New in last ${NEW_PRODUCT_DAYS} days</span>
        </button>
        <div class="ops-product-stack">
            <div class="ops-product-stat">
                <span class="ops-mini-label">New</span>
                <strong>${escapeHtml(newCount)}</strong>
                <span class="ops-mini-hint">Last ${NEW_PRODUCT_DAYS} days</span>
            </div>
            <div class="ops-product-stat ops-product-stat-refs">
                <span class="ops-mini-label">Recent</span>
                <span class="ops-mini-hint">Added or edited · ${RECENT_PRODUCT_HOURS}h</span>
                <div class="ops-entity-row">${recentHtml}</div>
            </div>
        </div>
    </div>`;
}

function activityCardHtml(events) {
    const rows = (events || []).slice(0, 4);
    const body = rows.length
        ? rows.map((ev) => {
            const dest = ev.refView && canOpenAppView(ev.refView) ? ev.refView : 'history-view';
            return `<button type="button" class="ops-activity-row ops-glossy-surface" data-lc-go="${escapeHtml(dest)}" data-lc-open="${escapeHtml(ev.ref || '')}" aria-label="${escapeHtml(ev.action || 'Event')} ${escapeHtml(ev.ref || ev.dest || '')}">
                <span class="ops-activity-when">${escapeHtml(ev.when ? String(ev.when).replace('T', ' ').slice(0, 16) : '')}</span>
                <span class="ops-activity-action">${escapeHtml(ev.action || 'Event')}</span>
                <span class="ops-activity-ref">${escapeHtml(ev.ref || ev.dest || '')}</span>
            </button>`;
        }).join('')
        : '<p class="lc-muted ops-activity-empty">No recent authorized activity.</p>';
    return `<div class="ops-stage ops-activity-card ops-glossy-well ops-lift">
        <button type="button" class="ops-activity-head ops-glossy-surface" data-lc-go="history-view" aria-label="Recent activity history. Open History workspace.">
            <span class="ops-stage-label">Recent Activity History</span>
            <span class="ops-stage-hint">Last ${rows.length} authorized events</span>
        </button>
        <div class="ops-activity-list">${body}</div>
    </div>`;
}

function periodChip(id, label, current) {
    const on = current === id;
    return `<button type="button" class="ops-period-chip${on ? ' is-on' : ''}" data-ops-period="${id}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
}

function metricChip(id, label, current) {
    const on = current === id;
    return `<button type="button" class="ops-period-chip${on ? ' is-on' : ''}" data-ops-metric="${id}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
}

function compositionHasValues(block) {
    return Boolean(block && Array.isArray(block.slices) && block.slices.some((s) => Number(s.count || 0) > 0 || Number(s.value || 0) > 0));
}

/** Fallback classification: purpose or status (matches backend CASE). */
function assetPurposeSlice(row) {
    const purpose = String(row.purpose || row.Purpose || '').trim().toLowerCase();
    const status = String(row.status || row.Status || '').trim().toLowerCase();
    if (purpose === 'rental' || purpose === 'rented' || status === 'rental' || status === 'rented') return 'Rented';
    if (purpose === 'demo' || status === 'demo') return 'Demo';
    return 'Owned';
}

function inventoryStatusSlice(row) {
    const purpose = String(row.purpose || row.Purpose || '').trim().toLowerCase();
    const status = String(row.status || row.Status || '').trim().toLowerCase();
    if (status === 'sold' || status === 'scraped') return 'Sold';
    if (purpose === 'rental' || purpose === 'rented' || status === 'rental' || status === 'rented') return 'Rented';
    if (purpose === 'demo' || status === 'demo') return 'Demo';
    return 'In Stock';
}

function holdingValue(row) {
    const n = Number(row.asset_value ?? row.AssetValue ?? row.unitprice ?? row.unitPrice ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function holdingCount(row) {
    const qty = Number(row.quantity_available ?? row.quantityAvailable ?? row.quantity_total ?? row.quantityTotal);
    if (Number.isFinite(qty) && qty > 0) return qty;
    return 1;
}

function tallySlices(names, rows, sliceOf, metric) {
    const tallies = new Map(names.map((name) => [name, { slice: name, count: 0, value: 0 }]));
    (rows || []).forEach((row) => {
        const slice = sliceOf(row);
        const bucket = tallies.get(slice);
        if (!bucket) return;
        bucket.count += holdingCount(row);
        bucket.value += holdingValue(row);
    });
    const slices = names.map((name) => tallies.get(name));
    const totalCount = slices.reduce((n, s) => n + s.count, 0);
    const totalValue = slices.reduce((n, s) => n + s.value, 0);
    return { slices, totalCount, totalValue, metric };
}

function compositionFromHoldings(assetRows, inventoryRows, metric) {
    const assets = (assetRows || []).filter((row) => !isRetiredAsset(row) && !['sold', 'scraped'].includes(String(row.status || row.Status || '').toLowerCase()));
    const inventory = inventoryRows || [];
    return {
        assets: tallySlices(['Rented', 'Demo', 'Owned'], assets, assetPurposeSlice, metric),
        inventory: tallySlices(['Rented', 'Demo', 'Sold', 'In Stock'], inventory, inventoryStatusSlice, metric)
    };
}

function holdingsCompositionCard(canAssets, canInventory, composition, metric) {
    const assets = canAssets
        ? chartCardHtml({
            title: 'Assets',
            slices: (composition.assets && composition.assets.slices) || [],
            colors: ASSET_SLICE_COLORS,
            donut: false,
            metric,
            canvasId: 'ops-chart-assets',
            escapeHtml
        })
        : '';
    const inventory = canInventory
        ? chartCardHtml({
            title: 'Inventory',
            slices: (composition.inventory && composition.inventory.slices) || [],
            colors: INV_SLICE_COLORS,
            donut: true,
            metric,
            canvasId: 'ops-chart-inventory',
            escapeHtml
        })
        : '';
    if (!assets && !inventory) return '';
    return `<div class="ops-holdings-composition ops-holdings-composition-wide ops-glossy-surface">
        <div class="ops-filter-row ops-chart-filters">
            <span class="ops-chart-filter-label">Holdings</span>
            <div class="ops-period-group" role="group" aria-label="Chart metric">
                ${metricChip('count', 'Count', metric)}
                ${metricChip('value', 'Value', metric)}
            </div>
        </div>
        <div class="ops-holdings-pair">${assets}${inventory}</div>
    </div>`;
}

export async function renderOperations() {
    const host = el('operationsContent');
    if (!host) return;
    host.innerHTML = '<p class="lc-muted">Loading operations…</p>';
    try {
        const canProducts = canOpenAppView('products-view');
        const canPo = canOpenAppView('purchase-orders-view');
        const canReceipts = canOpenAppView('receipts-view');
        const canInventory = canOpenAppView('inventory-view');
        const canAssets = canOpenAppView('home-view');
        const canHistory = canOpenAppView('history-view');

        const canIntake = canOpenAppView('physical-intakes-view');

        const [products, pos, inventoryResult, assetsResult, activity, snapshotResult] = await Promise.all([
            canProducts
                ? lifecycleApi('/api/products?status=ACTIVE&limit=500').catch(() => ({ products: [] }))
                : Promise.resolve({ products: [] }),
            canPo
                ? lifecycleApi('/api/procurement/pos?limit=200').catch(() => ({ purchaseOrders: [] }))
                : Promise.resolve({ purchaseOrders: [] }),
            canInventory ? settled(lifecycleApi('/api/inventory/items')) : Promise.resolve({ ok: false, data: { items: [] } }),
            canAssets ? settled(lifecycleApi('/api/assets?all=true')) : Promise.resolve({ ok: false, data: [] }),
            canHistory
                ? gatherLifecycleFeed({ limit: 8 }).catch(() => [])
                : Promise.resolve([]),
            settled(lifecycleApi(`/api/operations/dashboard?period=${encodeURIComponent(opsPeriod)}&metric=${encodeURIComponent(opsMetric)}`))
        ]);

        const inventory = inventoryResult.ok ? inventoryResult.data : { items: [] };
        const productRows = products.products || [];
        const poRows = pos.purchaseOrders || [];
        const assetRows = assetsResult.ok ? listFromResponse(assetsResult.data, 'data') : [];
        const inventoryRows = listFromResponse(inventory, 'items');
        const stockReady = Boolean(canAssets && canInventory && inventoryResult.ok && assetsResult.ok);
        const stock = stockReady ? stockHoldings(assetRows, inventoryRows) : null;
        const stockCount = stock ? stock.total : '—';
        const stockHint = stock
            ? `${stock.assets} ${stock.assets === 1 ? 'Asset' : 'Assets'} · ${stock.inventory} Inventory`
            : 'Unavailable';
        const waitlist = waitlistLineCount(poRows);
        const snapshot = snapshotResult.ok ? snapshotResult.data : null;
        if (!snapshotResult.ok && snapshotResult.err) {
            console.warn('[operations] dashboard snapshot failed', snapshotResult.err.message || snapshotResult.err);
        }
        let receiving = snapshot && snapshot.receiving
            ? snapshot.receiving
            : { openCount: 0, totalCount: 0 };
        let awaitingCount = snapshot && snapshot.awaitingAdoption ? Number(snapshot.awaitingAdoption.count) || 0 : 0;
        let zohoUnlinkedCount = snapshot && snapshot.zohoUnlinkedProducts
            ? Number(snapshot.zohoUnlinkedProducts.count) || 0
            : null;
        let composition = snapshot && snapshot.composition
            ? snapshot.composition
            : { assets: { slices: [] }, inventory: { slices: [] } };
        const fallbackComposition = compositionFromHoldings(assetRows, inventoryRows, opsMetric);
        if (!compositionHasValues(composition.assets) && compositionHasValues(fallbackComposition.assets)) {
            composition = { ...composition, assets: fallbackComposition.assets };
        }
        if (!compositionHasValues(composition.inventory) && compositionHasValues(fallbackComposition.inventory)) {
            composition = { ...composition, inventory: fallbackComposition.inventory };
        }
        if ((!snapshot || !snapshot.receiving) && canReceipts) {
            try {
                const notes = await lifecycleApi(`/api/receipt-notes?period=${encodeURIComponent(opsPeriod)}&limit=200`);
                const rows = listFromResponse(notes, 'receiptNotes');
                receiving = {
                    openCount: rows.filter((n) => String(n.status || '').toUpperCase() === 'OPEN').length,
                    totalCount: rows.length
                };
            } catch (err) {
                console.warn('[operations] receiving fallback failed', err.message || err);
            }
        }
        if ((!snapshot || snapshot.awaitingAdoption == null) && canIntake) {
            try {
                const awaiting = await lifecycleApi('/api/physical-intakes/provenance?state=AWAITING_PO&limit=200');
                awaitingCount = listFromResponse(awaiting, 'items').length;
            } catch (err) {
                console.warn('[operations] awaiting fallback failed', err.message || err);
            }
        }
        if (zohoUnlinkedCount == null && canProducts) {
            try {
                const catalog = await lifecycleApi('/api/zoho/catalog?unlinked=1');
                zohoUnlinkedCount = (catalog.catalog || []).length;
            } catch (err) {
                console.warn('[operations] zoho unlinked fallback failed', err.message || err);
                zohoUnlinkedCount = '—';
            }
        }

        const waitlistCard = canPo
            ? stageCard('PO Waitlist', waitlist.lines, 'purchase-orders-view', waitlist.pos === 1 ? '1 Purchase Order waiting for a Receipt Note' : `${waitlist.pos} Purchase Orders waiting for Receipt Notes`, 'data-lc-waitlist="1"', 'ops-waitlist-slim')
            : '';
        const activityCard = canHistory ? activityCardHtml(activity) : '';
        const productsCard = canProducts ? productsCardHtml(productRows) : '';
        const chartsCard = (canAssets || canInventory)
            ? holdingsCompositionCard(canAssets, canInventory, composition, opsMetric)
            : '';
        const leftPair = (productsCard || activityCard)
            ? `<div class="ops-layout-pair">
                    ${productsCard ? `<div class="ops-layout-products">${productsCard}</div>` : ''}
                    ${activityCard ? `<div class="ops-layout-activity">${activityCard}</div>` : ''}
                </div>`
            : '';
        const leftStack = (waitlistCard || leftPair)
            ? `<div class="ops-layout-left">${waitlistCard}${leftPair}</div>`
            : '';

        const receivingBlock = canReceipts
            ? `<div class="ops-receiving-wrap">
                    <div class="ops-filter-row ops-receiving-filters">
                        <div class="ops-period-group" role="group" aria-label="Receiving calendar window">
                            ${periodChip('month', 'Monthly', opsPeriod)}
                            ${periodChip('quarter', 'Quarterly', opsPeriod)}
                            ${periodChip('year', 'Yearly', opsPeriod)}
                        </div>
                    </div>
                    ${receivingStageCard(receiving.openCount, receiving.totalCount, opsPeriod)}
                </div>`
            : '';

        const holdingsCard = (canAssets || canInventory)
            ? stageCard('Holdings', stockCount, canAssets ? 'home-view' : 'inventory-view', stockHint, '', 'ops-lift-yellow')
            : '';
        const awaitingCard = canIntake
            ? stageCard('Awaiting Adoption', awaitingCount, 'physical-intakes-view', 'Waiting for PO or No PO Required', 'data-lc-awaiting="1"', 'ops-lift-yellow')
            : '';
        const zohoGapCard = canProducts
            ? stageCard(
                'Products Awaiting Sync',
                zohoUnlinkedCount == null ? '—' : zohoUnlinkedCount,
                'products-view',
                'Zoho Product Catalog · no AssetEngine Product yet',
                'data-lc-zoho-catalog="1"'
            )
            : '';
        const aeNotInZohoCount = productRows.filter((p) => (
            String(p.origin || '').toUpperCase() === 'ASSETENGINE' && !p.zoho_external_id
        )).length;
        const aeNotInZohoCard = canProducts
            ? stageCard(
                'Not in Zoho',
                aeNotInZohoCount,
                'products-view',
                aeNotInZohoCount === 1 ? 'AssetEngine Product · no Zoho link yet' : 'AssetEngine Products · no Zoho link yet',
                'data-lc-ae-unlinked="1"'
            )
            : '';
        const flowRest = [holdingsCard, awaitingCard, zohoGapCard, aeNotInZohoCard].filter(Boolean).join('');
        const layoutMods = [
            receivingBlock ? '' : 'ops-layout-no-receiving',
            leftStack ? '' : 'ops-layout-no-left',
            flowRest ? '' : 'ops-layout-no-flow',
            chartsCard ? '' : 'ops-layout-no-charts'
        ].filter(Boolean).join(' ');
        const hasLayout = Boolean(receivingBlock || flowRest || leftStack || chartsCard);

        destroyHoldingsCharts();
        host.innerHTML = `
            <div class="ops-page">
                <section class="lc-section ops-dashboard-section">
                    <div class="lc-section-label">Lifecycle Progress</div>
                    ${hasLayout ? `<div class="ops-layout ${layoutMods}">
                        ${receivingBlock ? `<div class="ops-layout-receiving">${receivingBlock}</div>` : ''}
                        ${receivingBlock && flowRest ? '<span class="ops-flow-arrow ops-layout-arrow" aria-hidden="true">→</span>' : ''}
                        ${flowRest ? `<div class="ops-layout-flow ops-flow" role="navigation" aria-label="Lifecycle stages">${flowRest}</div>` : ''}
                        ${leftStack || ''}
                        ${chartsCard ? `<div class="ops-layout-charts">${chartsCard}</div>` : ''}
                    </div>` : '<p class="lc-muted">No authorized lifecycle modules.</p>'}
                </section>
            </div>
        `;
        if (canAssets || canInventory) {
            mountHoldingsCharts({
                composition,
                metric: opsMetric,
                canAssets,
                canInventory,
                period: opsPeriod
            });
        }
        host.querySelectorAll('[data-ops-period]').forEach((btn) => {
            btn.addEventListener('click', () => {
                opsPeriod = btn.getAttribute('data-ops-period') || 'month';
                renderOperations().catch((err) => showToast(err.message, 'error'));
            });
        });
        host.querySelectorAll('[data-ops-metric]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const next = btn.getAttribute('data-ops-metric') || 'count';
                if (next === opsMetric) return;
                opsMetric = next;
                host.querySelectorAll('[data-ops-metric]').forEach((chip) => {
                    const on = chip.getAttribute('data-ops-metric') === opsMetric;
                    chip.classList.toggle('is-on', on);
                    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                try {
                    const live = await refreshHoldingsCharts(opsMetric, opsPeriod);
                    if (live) {
                        // Keep card totals/legends in sync without wiping the whole dashboard.
                        return;
                    }
                } catch (err) {
                    console.warn('[operations] holdings refresh failed, full reload', err.message || err);
                }
                renderOperations().catch((e) => showToast(e.message, 'error'));
            });
        });
    } catch (err) {
        destroyHoldingsCharts();
        host.innerHTML = `<div class="lc-empty"><h3>Operations could not load</h3><p>${escapeHtml(toastOperatorError(err))}</p></div>`;
    }
}

let bound = false;
export function initOperationsView() {
    if (!bound) {
        bound = true;
        el('btnReloadOperations')?.addEventListener('click', () => {
            renderOperations().catch((err) => showToast(err.message, 'error'));
        });
    }
    consumeOpen('operations-view');
    renderOperations().catch((err) => showToast(err.message, 'error'));
}

window.initOperationsView = initOperationsView;
