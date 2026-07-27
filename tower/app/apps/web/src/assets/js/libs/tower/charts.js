//
// Charting, on Chart.js, pulled in through OMEGA's own dynamic-loading module.
//
// The loader is `loadScript`, it lives in @omega.js/client
// (packages/client/src/modules/dom.js) and is reached as `omega.dom().loadScript()`.
// The framework uses it for exactly this — a library only some pages need,
// fetched when one of them asks: core/js/libs/recaptcha.js loads the reCAPTCHA
// script that way, and core/js/pages/payment/confirmation/modules/celebration.js
// loads canvas-confetti from a CDN with the same call. The pattern is copied
// here verbatim, so the tower carries no charting dependency of its own.
//
// The UMD build self-registers every controller, scale and element, so there is
// no Chart.register step (the framework's bundled admin page does register, but
// only because a bundler import is tree-shaken).
//
// The colours come from the classy token sheet, exactly as the framework's own
// chart code does (core/js/pages/admin/index.js getChartColors) — which is what
// makes a chart follow the brand ramp and dark mode without knowing either exists.
//

import omega from '@omega.js/client';

const CHART_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.js';

let pending = null;

/**
 * Load Chart.js once. Idempotent and safe to call on every poll.
 *
 * The one cost of the loader path: this is a network fetch, so a tower running
 * with no internet has no charts. Every chart on every page sits beside the
 * same numbers in a table or a statgrid, and `chartSlot` says so in place of
 * the canvas — nothing becomes unreadable, and nothing goes blank.
 *
 * @returns {Promise<boolean>} whether Chart.js is available
 */
export async function loadCharts() {
  if (window.Chart) return true;
  if (!pending) {
    pending = omega.dom().loadScript({ src: CHART_SRC, timeout: 15000, retries: 1 })
      .then(() => Boolean(window.Chart))
      .catch(() => {
        pending = null; // a later poll may find the network back
        return false;
      });
  }
  return pending;
}

/** Whether a chart can be drawn right now — synchronous, for render paths. */
export const chartsReady = () => Boolean(window.Chart);

/** Read the theme's colour tokens off :root, with the framework's fallbacks. */
export function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  const accent = token('--omega-accent') || '#2563eb';
  return {
    text: token('--omega-ink-muted') || token('--bs-body-color') || '#6c757d',
    grid: token('--omega-line') || token('--bs-border-color') || '#dee2e6',
    accent,
    palette: [
      accent,
      token('--omega-ok') || '#198754',
      token('--omega-warn') || '#ffc107',
      token('--omega-danger') || '#dc3545',
      token('--omega-ink-faint') || '#6c757d',
      token('--omega-chart-2') || token('--omega-accent-active') || accent,
    ],
  };
}

/** Resolve a `var(--token)` string against :root — Chart.js needs a real colour. */
export function resolveColor(value) {
  const match = /^var\((--[\w-]+)\)$/.exec(String(value || ''));
  if (!match) return value;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || chartColors().accent;
}

/**
 * The markup a chart is drawn into. A canvas has no intrinsic height, so the
 * box carries it. When the library did not load, the slot says that instead of
 * leaving a hole — the figures it would have drawn are always beside it.
 */
export const chartSlot = (id, height = 220) => (chartsReady()
  ? `<div style="position: relative; height: ${Number(height)}px;"><canvas id="${id}"></canvas></div>`
  : '<p class="classy-micro text-body-secondary mb-0">chart library unavailable offline — the figures are in the table</p>');

/** Draw into `id`, replacing whatever chart was there (every poll repaints). */
function draw(id, config) {
  if (!window.Chart) return null;
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const existing = window.Chart.getChart(canvas);
  if (existing) existing.destroy();
  return new window.Chart(canvas, config);
}

// Every chart is drawn WITHOUT animation, and that is the difference between a
// chart and a blank pair of axes. A tower page repaints on every feed answer —
// three of them within a second or two, every ten seconds — and each repaint
// destroys the chart and builds it again, so an animated chart spends most of
// its life growing its bars back out of the axis from zero. Off, the data is on
// screen in the first painted frame and stays there.
const baseOptions = (colors) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: { ticks: { color: colors.text }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } },
  },
});

/**
 * A bar chart. `horizontal` turns it into the ranked-rows shape the board and
 * health counts want; the default vertical shape is for a series over time.
 * @param {string} id - the canvas id from `chartSlot`
 * @param {{labels: string[], values: number[], colors?: string[], horizontal?: boolean, label?: string}} data
 */
export function barChart(id, data) {
  if (!chartsReady()) return null;
  const colors = chartColors();
  const options = baseOptions(colors);
  if (data.horizontal) {
    options.indexAxis = 'y';
    options.scales = {
      x: { beginAtZero: true, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } },
      y: { ticks: { color: colors.text }, grid: { display: false } },
    };
  }
  return draw(id, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: data.label || '',
        data: data.values,
        backgroundColor: (data.colors || []).length ? data.colors.map(resolveColor) : colors.accent,
        borderRadius: 4,
        maxBarThickness: 28,
      }],
    },
    options,
  });
}

/**
 * A stacked bar chart — one bar per label, one colour per series.
 * @param {string} id
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>}} data
 */
export function stackedBarChart(id, data) {
  if (!chartsReady()) return null;
  const colors = chartColors();
  const options = baseOptions(colors);
  options.plugins.legend = { display: true, position: 'bottom', labels: { color: colors.text, boxWidth: 12 } };
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  return draw(id, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: data.series.map((series, i) => ({
        label: series.label,
        data: series.values,
        backgroundColor: series.color ? resolveColor(series.color) : colors.palette[i % colors.palette.length],
        borderRadius: 3,
        maxBarThickness: 28,
      })),
    },
    options,
  });
}

/**
 * A doughnut — for a split that is a share of one whole (cache versus fresh).
 * @param {string} id
 * @param {{labels: string[], values: number[], colors?: string[]}} data
 */
export function doughnutChart(id, data) {
  if (!chartsReady()) return null;
  const colors = chartColors();
  return draw(id, {
    type: 'doughnut',
    data: {
      labels: data.labels,
      datasets: [{
        data: data.values,
        backgroundColor: (data.colors || []).length
          ? data.colors.map(resolveColor)
          : colors.palette.slice(0, data.values.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text, padding: 12, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const sum = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${((ctx.parsed / sum) * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

/**
 * A line chart over time.
 * @param {string} id
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>}} data
 */
export function lineChart(id, data) {
  if (!chartsReady()) return null;
  const colors = chartColors();
  const options = baseOptions(colors);
  options.plugins.legend = { display: data.series.length > 1, position: 'bottom', labels: { color: colors.text, boxWidth: 12 } };
  return draw(id, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: data.series.map((series, i) => {
        const color = series.color ? resolveColor(series.color) : colors.palette[i % colors.palette.length];
        return {
          label: series.label,
          data: series.values,
          borderColor: color,
          backgroundColor: color,
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        };
      }),
    },
    options,
  });
}
