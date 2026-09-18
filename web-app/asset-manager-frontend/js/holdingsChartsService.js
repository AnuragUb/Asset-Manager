/**
 * Holdings Charts Service
 * Live Assets pie + Inventory doughnut driven by /api/operations/dashboard.
 * Updates Chart.js in place (animated) so charts are not a one-shot static paint.
 */
import { lifecycleApi } from './lifecycle.js?v=7.52';
import { createNativeChart, destroyCharts, nativeArcDataset, nativeArcOptions } from './charts.js?v=7.61';

export const ASSET_SLICE_COLORS = Object.freeze({ Rented: '#6366f1', Demo: '#f59e0b', Owned: '#10b981' });
export const ASSET_SLICE_HOVER = Object.freeze({ Rented: '#818cf8', Demo: '#fbbf24', Owned: '#34d399' });
export const INV_SLICE_COLORS = Object.freeze({
    Rented: '#6366f1',
    Demo: '#f59e0b',
    Sold: '#ef4444',
    'In Stock': '#14b8a6'
});
export const INV_SLICE_HOVER = Object.freeze({
    Rented: '#818cf8',
    Demo: '#fbbf24',
    Sold: '#f87171',
    'In Stock': '#2dd4bf'
});

export const CHART_IDS = Object.freeze(['ops-chart-assets', 'ops-chart-inventory']);
const AUTO_REFRESH_MS = 60000;

function formatChartAmount(amount, metric) {
    const n = Number(amount) || 0;
    if (metric === 'value') {
        if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
        return String(Math.round(n * 100) / 100);
    }
    return String(Math.round(n));
}

function sliceAmounts(slices, metric) {
    return (slices || []).map((s) => ({
        slice: s.slice,
        amount: metric === 'value' ? Number(s.value || 0) : Number(s.count || 0)
    }));
}

function buildPlotPayload(slices, colors, hoverColors, metric) {
    const values = sliceAmounts(slices, metric);
    const total = values.reduce((sum, s) => sum + s.amount, 0);
    const empty = total <= 0;
    const plotted = empty ? [{ slice: 'None', amount: 1 }] : values.filter((s) => s.amount > 0);
    return {
        values,
        total,
        empty,
        labels: plotted.map((s) => s.slice),
        data: plotted.map((s) => s.amount),
        backgroundColor: empty ? ['#e2e8f0'] : plotted.map((s) => colors[s.slice] || '#94a3b8'),
        hoverBackgroundColor: empty
            ? ['#e2e8f0']
            : plotted.map((s) => (hoverColors && hoverColors[s.slice]) || colors[s.slice] || '#94a3b8')
    };
}

function syncDomTotals(canvasId, total, metric, donut) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const block = canvas.closest('.ops-chart-block');
    if (!block) return;
    const countEl = block.querySelector('.ops-chart-head .ops-stage-count');
    if (countEl) countEl.textContent = formatChartAmount(total, metric);
    const hintEl = block.querySelector('.ops-chart-head .ops-stage-hint');
    if (hintEl) {
        hintEl.textContent = metric === 'value' ? 'Value of current holdings' : 'Count of current holdings';
    }
    const legend = block.querySelector('.ops-chart-legend');
    if (legend) {
        const colors = canvasId === 'ops-chart-assets' ? ASSET_SLICE_COLORS : INV_SLICE_COLORS;
        const slices = (canvasId === 'ops-chart-assets'
            ? ['Rented', 'Demo', 'Owned']
            : ['Rented', 'Demo', 'Sold', 'In Stock']).map((name) => {
            const idx = (window.__opsHoldingsLastSlices && window.__opsHoldingsLastSlices[canvasId]) || [];
            const hit = idx.find((s) => s.slice === name);
            return { slice: name, amount: hit ? hit.amount : 0 };
        });
        legend.innerHTML = slices.map((s) => `
            <div class="ops-chart-legend-row">
                <span class="ops-chart-swatch" style="background:${colors[s.slice] || '#94a3b8'}"></span>
                <span>${s.slice}</span>
                <strong>${formatChartAmount(s.amount, metric)}</strong>
            </div>`).join('') || '<p class="lc-muted">No current holdings.</p>';
    }
    if (donut) {
        const strong = block.querySelector('.ops-chart-total strong');
        const span = block.querySelector('.ops-chart-total span');
        if (strong) strong.textContent = formatChartAmount(total, metric);
        if (span) span.textContent = metric === 'value' ? 'Value' : 'Total';
    }
    canvas.setAttribute(
        'aria-label',
        `${canvasId === 'ops-chart-assets' ? 'Assets' : 'Inventory'} total ${formatChartAmount(total, metric)}`
    );
}

function getChartLib() {
    return typeof window !== 'undefined' ? window.Chart : null;
}

function getChart(canvasId) {
    const Chart = getChartLib();
    if (!Chart || !Chart.getChart) return null;
    return Chart.getChart(canvasId);
}

let state = {
    metric: 'count',
    canAssets: false,
    canInventory: false,
    period: 'month',
    timer: null,
    lastComposition: null
};

function plotOne(canvasId, slices, colors, hoverColors, donut, metric, mode) {
    const payload = buildPlotPayload(slices, colors, hoverColors, metric);
    if (!window.__opsHoldingsLastSlices) window.__opsHoldingsLastSlices = {};
    window.__opsHoldingsLastSlices[canvasId] = payload.values;

    const existing = getChart(canvasId);
    if (mode === 'update' && existing) {
        existing.data.labels = payload.labels;
        const ds = existing.data.datasets[0] || {};
        const styled = nativeArcDataset({
            data: payload.data,
            backgroundColor: payload.backgroundColor,
            hoverBackgroundColor: payload.hoverBackgroundColor
        });
        Object.assign(ds, styled);
        existing.data.datasets[0] = ds;
        existing.options = {
            ...existing.options,
            ...nativeArcOptions({
                cutout: donut ? '62%' : 0,
                empty: payload.empty,
                labelFormatter: payload.empty
                    ? null
                    : (context) => {
                        const label = context.label || '';
                        const amount = context.parsed || 0;
                        return ` ${label}: ${formatChartAmount(amount, metric)}`;
                    }
            }),
            responsive: true,
            maintainAspectRatio: false
        };
        existing.update('active');
        syncDomTotals(canvasId, payload.total, metric, donut);
        return existing;
    }

    createNativeChart(canvasId, {
        type: donut ? 'doughnut' : 'pie',
        data: {
            labels: payload.labels,
            datasets: [nativeArcDataset({
                data: payload.data,
                backgroundColor: payload.backgroundColor,
                hoverBackgroundColor: payload.hoverBackgroundColor
            })]
        },
        options: nativeArcOptions({
            cutout: donut ? '62%' : 0,
            empty: payload.empty,
            labelFormatter: payload.empty
                ? null
                : (context) => {
                    const label = context.label || '';
                    const amount = context.parsed || 0;
                    return ` ${label}: ${formatChartAmount(amount, metric)}`;
                }
        })
    });
    syncDomTotals(canvasId, payload.total, metric, donut);
    return getChart(canvasId);
}

export function destroy() {
    stopAutoRefresh();
    destroyCharts(CHART_IDS);
    state.lastComposition = null;
}

export function stopAutoRefresh() {
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }
}

export function startAutoRefresh(intervalMs = AUTO_REFRESH_MS) {
    stopAutoRefresh();
    state.timer = setInterval(() => {
        const host = document.getElementById('operationsContent');
        const view = document.getElementById('operations-view');
        if (!host || !view || view.classList.contains('hidden')) return;
        refresh(state.metric).catch((err) => {
            console.warn('[holdingsCharts] auto-refresh failed', err.message || err);
        });
    }, intervalMs);
}

export function mount({ composition, metric, canAssets, canInventory, period } = {}) {
    state.metric = metric === 'value' ? 'value' : 'count';
    state.canAssets = Boolean(canAssets);
    state.canInventory = Boolean(canInventory);
    if (period) state.period = period;
    state.lastComposition = composition || null;
    try {
        if (state.canAssets) {
            plotOne(
                'ops-chart-assets',
                (composition && composition.assets && composition.assets.slices) || [],
                ASSET_SLICE_COLORS,
                ASSET_SLICE_HOVER,
                false,
                state.metric,
                'mount'
            );
        }
        if (state.canInventory) {
            plotOne(
                'ops-chart-inventory',
                (composition && composition.inventory && composition.inventory.slices) || [],
                INV_SLICE_COLORS,
                INV_SLICE_HOVER,
                true,
                state.metric,
                'mount'
            );
        }
        startAutoRefresh();
    } catch (err) {
        console.warn('[holdingsCharts] mount failed', err.message || err);
    }
}

export function update({ composition, metric } = {}) {
    if (metric) state.metric = metric === 'value' ? 'value' : 'count';
    if (composition) state.lastComposition = composition;
    const comp = composition || state.lastComposition || { assets: { slices: [] }, inventory: { slices: [] } };
    try {
        if (state.canAssets && document.getElementById('ops-chart-assets')) {
            plotOne(
                'ops-chart-assets',
                (comp.assets && comp.assets.slices) || [],
                ASSET_SLICE_COLORS,
                ASSET_SLICE_HOVER,
                false,
                state.metric,
                'update'
            );
        }
        if (state.canInventory && document.getElementById('ops-chart-inventory')) {
            plotOne(
                'ops-chart-inventory',
                (comp.inventory && comp.inventory.slices) || [],
                INV_SLICE_COLORS,
                INV_SLICE_HOVER,
                true,
                state.metric,
                'update'
            );
        }
    } catch (err) {
        console.warn('[holdingsCharts] update failed', err.message || err);
    }
}

/**
 * Fetch live composition from the dashboard API and update charts in place.
 * @param {string} [metric]
 * @param {string} [period]
 * @returns {Promise<object|null>} composition payload
 */
export async function refresh(metric, period) {
    const useMetric = metric === 'value' || metric === 'count' ? metric : state.metric;
    const usePeriod = period || state.period || 'month';
    state.metric = useMetric;
    state.period = usePeriod;
    const snapshot = await lifecycleApi(
        `/api/operations/dashboard?period=${encodeURIComponent(usePeriod)}&metric=${encodeURIComponent(useMetric)}`
    );
    const composition = snapshot && snapshot.composition
        ? snapshot.composition
        : { assets: { slices: [] }, inventory: { slices: [] } };
    update({ composition, metric: useMetric });
    return composition;
}

export function getState() {
    return { ...state, lastComposition: state.lastComposition };
}

export function formatAmount(amount, metric) {
    return formatChartAmount(amount, metric);
}

export function chartCardHtml({ title, slices, colors, donut, metric, canvasId, escapeHtml }) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
    const values = sliceAmounts(slices, metric);
    const total = values.reduce((sum, s) => sum + s.amount, 0);
    const legend = values.map((s) => `
        <div class="ops-chart-legend-row">
            <span class="ops-chart-swatch" style="background:${colors[s.slice] || '#94a3b8'}"></span>
            <span>${esc(s.slice)}</span>
            <strong>${esc(formatChartAmount(s.amount, metric))}</strong>
        </div>`).join('');
    return `<div class="ops-chart-block ops-chart-block-wide">
        <div class="ops-chart-head">
            <span class="ops-stage-label">${esc(title)}</span>
            <span class="ops-stage-count">${esc(formatChartAmount(total, metric))}</span>
            <span class="ops-stage-hint">${metric === 'value' ? 'Value of current holdings' : 'Count of current holdings'}</span>
        </div>
        <div class="ops-chart-body ops-chart-body-centered">
            <div class="ops-chart-plot ${donut ? 'is-donut' : 'is-pie'}">
                <canvas id="${esc(canvasId)}" class="ops-chart-canvas" width="280" height="280" role="img" aria-label="${esc(title)} total ${esc(formatChartAmount(total, metric))}"></canvas>
                ${donut ? `<div class="ops-chart-total">
                    <strong>${esc(formatChartAmount(total, metric))}</strong>
                    <span>${metric === 'value' ? 'Value' : 'Total'}</span>
                </div>` : ''}
            </div>
            <div class="ops-chart-legend">${legend || '<p class="lc-muted">No current holdings.</p>'}</div>
        </div>
    </div>`;
}
