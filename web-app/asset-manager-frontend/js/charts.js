/**
 * Chart.js helper for the vanilla SPA.
 * Uses the eight native types only. Library is window.Chart from /js/vendor/chart.umd.js.
 *
 * Config shape (Chart.js):
 *   { type, data: { labels, datasets }, options }
 */
export const NATIVE_CHART_TYPES = Object.freeze([
    'bar',
    'line',
    'scatter',
    'bubble',
    'pie',
    'doughnut',
    'polarArea',
    'radar'
]);

export function getChartLib() {
    const Chart = typeof window !== 'undefined' ? window.Chart : null;
    if (!Chart) {
        throw new Error('Chart.js is not loaded. Expected /js/vendor/chart.umd.js before this module.');
    }
    return Chart;
}

function defaultOptions(options) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        ...(options || {})
    };
}

const ARC_CARD_FILL = '#ffffff';

/**
 * Dataset defaults for native pie / doughnut (rounded arcs, slice gaps, hover lift).
 * One visible slice must close the circle — spacing/radius only apply when 2+ slices share the ring.
 */
export function nativeArcDataset(extra) {
    const merged = {
        borderWidth: 3,
        borderColor: ARC_CARD_FILL,
        hoverBorderWidth: 3,
        hoverBorderColor: ARC_CARD_FILL,
        borderRadius: 6,
        spacing: 3,
        hoverOffset: 6,
        ...(extra || {})
    };
    const visible = Array.isArray(merged.data)
        ? merged.data.filter((n) => Number(n) > 0).length
        : 0;
    if (visible <= 1) {
        merged.spacing = 0;
        merged.borderRadius = 0;
        merged.borderWidth = 0;
        merged.hoverBorderWidth = 0;
    }
    return merged;
}

/**
 * Options defaults for native pie / doughnut.
 * @param {{ cutout?: string|number, empty?: boolean, labelFormatter?: function }} [opts]
 */
export function nativeArcOptions(opts) {
    const empty = Boolean(opts && opts.empty);
    const labelFormatter = opts && opts.labelFormatter;
    const options = {
        rotation: -90,
        layout: { padding: 10 },
        animation: {
            animateRotate: true,
            animateScale: true,
            duration: 550,
            easing: 'easeOutQuart'
        },
        plugins: {
            legend: { display: false },
            title: { display: false },
            tooltip: {
                enabled: !empty,
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                titleColor: '#fff',
                bodyColor: '#e2e8f0',
                padding: 10,
                cornerRadius: 8,
                displayColors: true,
                boxPadding: 4,
                callbacks: labelFormatter
                    ? {
                        label(context) {
                            return labelFormatter(context);
                        }
                    }
                    : undefined
            }
        }
    };
    if (opts && opts.cutout != null) options.cutout = opts.cutout;
    return options;
}

/**
 * Create or replace a native Chart.js chart on a canvas.
 * @param {HTMLCanvasElement|string} canvasOrId
 * @param {{ type: string, data: object, options?: object, plugins?: object[] }} config
 */
export function createNativeChart(canvasOrId, config) {
    const Chart = getChartLib();
    const type = config && config.type;
    if (!NATIVE_CHART_TYPES.includes(type)) {
        throw new Error(`Unsupported Chart.js type "${type}". Native types: ${NATIVE_CHART_TYPES.join(', ')}`);
    }
    const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
    if (!canvas) {
        throw new Error(`Chart canvas not found: ${canvasOrId}`);
    }
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    return new Chart(canvas, {
        type,
        data: config.data,
        options: defaultOptions(config.options),
        plugins: config.plugins
    });
}

export function destroyChart(canvasOrId) {
    const Chart = typeof window !== 'undefined' ? window.Chart : null;
    if (!Chart || !Chart.getChart) return;
    const chart = Chart.getChart(canvasOrId);
    if (chart) chart.destroy();
}

export function destroyCharts(ids) {
    (ids || []).forEach((id) => destroyChart(id));
}
