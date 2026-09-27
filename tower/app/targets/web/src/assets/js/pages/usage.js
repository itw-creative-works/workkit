// Usage: where the tokens went, from `/api/telemetry` (tower/README.md
// § Endpoints). The charts draw the endpoint's aggregates, never a recount from
// `sessions`; a missing aggregate draws nothing. The cache split and the cost
// sum roots and subagents, the same spend the charts show.

import { startPage } from '../libs/tower/page.js';
import { feed } from '../libs/tower/state.js';
import {
  esc, empty, problem, loading, compact, money, statCell, statgrid, card, pill,
  modelKey, classKey, badgeColor, modelBadge, classBadge,
} from '../libs/tower/format.js';
import { chartSlot, barChart, doughnutChart, lineChart } from '__main_assets__/js/libs/charts.js';
import { swap } from '@omega.js/client/modules/live-page';

const sortDown = (list) => [...list].sort((a, b) => b[1] - a[1]);

/**
 * One of the endpoint's `{ label: tokens }` aggregates as sorted rows.
 *
 * A zero-token entry is dropped, `<synthetic>` (Claude Code's own unbilled
 * messages) always among them.
 */
const aggregate = (map) => sortDown(Object.entries(map)
  .map(([label, tokens]) => [label, Number(tokens) || 0])
  .filter(([label, tokens]) => label && tokens > 0));

/** An ISO day to its short label ('Jul 27'). Thirty of these share one axis. */
const dayLabel = (day) => {
  const when = new Date(`${day}T00:00:00`);
  return Number.isNaN(when.getTime()) ? day : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The endpoint's day series as rows, oldest first and quiet days included. */
const series = (list) => list.map((entry) => [String(entry.label), Number(entry.tokens) || 0]);

/**
 * Every transcript the payload carries: each root session and each subagent it
 * spawned, the set the endpoint's aggregates are computed over.
 */
const spends = (sessions) => sessions.flatMap((session) => [
  { cost: session.cost, tokens: session.tokens },
  ...session.subagents.map((agent) => ({ cost: agent.cost, tokens: agent.tokens })),
]);

/** Everything the page draws, read out of the telemetry payload. */
const readUsage = (result) => {
  if (!result || !result.ok || !result.data) return null;
  const payload = result.data;
  const all = spends(payload.sessions);
  const costs = all.map((spend) => spend.cost).filter((value) => typeof value === 'number');

  return {
    sessions: payload.sessions.map((session) => ({
      id: session.id,
      title: session.chatName || '',
      model: session.model || 'unknown',
      // A root session is the manager, as the endpoint's byClass names it.
      agentClass: 'manager',
      cost: session.cost,
      tokens: session.tokens,
    })),
    byModel: aggregate(payload.byModel),
    byClass: aggregate(payload.byClass),
    overTime: series(payload.overTime),
    cacheRead: all.reduce((sum, spend) => sum + spend.tokens.cacheRead, 0),
    fresh: all.reduce((sum, spend) => sum + spend.tokens.input + spend.tokens.output + spend.tokens.cacheCreation, 0),
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
};

const numbers = (usage) => {
  const total = usage.byModel.reduce((sum, [, value]) => sum + value, 0)
    || usage.cacheRead + usage.fresh;
  const share = total ? `${((usage.cacheRead / total) * 100).toFixed(0)}%` : '-';
  return statgrid([
    statCell('Tokens', total ? compact(total) : '-'),
    statCell('Cache reads', usage.cacheRead ? compact(usage.cacheRead) : '-'),
    statCell('Cache share', share),
    statCell('Estimated cost', usage.cost === null ? '-' : money(usage.cost)),
  ]);
};

// Green for a cache read, red for a miss; a session that has spent nothing has
// not missed the cache, so it gets a dash.
const cacheCell = (tokens) => {
  if (!tokens.cacheRead && !tokens.input) return '<span class="text-body-secondary">-</span>';
  return tokens.cacheRead > 0 ? pill('ok', compact(tokens.cacheRead)) : pill('danger', 'miss');
};

const sessionTable = (usage) => {
  if (!usage.sessions.length) return empty('no per-session detail in this payload', 'fa-regular fa-rectangle-list');
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
    <thead><tr><th>session</th><th>class</th><th>model</th><th class="text-end">tokens</th><th class="text-end">cache</th><th class="text-end">cost</th></tr></thead>
    <tbody>${usage.sessions.map((session) => `<tr>
      <td>${esc(session.title || session.id || '-')}</td>
      <td>${classBadge(session.agentClass)}</td>
      <td>${modelBadge(session.model)}</td>
      <td class="text-end">${esc(compact(session.tokens.total))}</td>
      <td class="text-end">${cacheCell(session.tokens)}</td>
      <td class="text-end">${session.cost === null ? '-' : esc(money(session.cost))}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
};

// A ranked bar chart is as tall as it has rows; the two side by side share the
// taller one's height.
const ranked = (rows) => Math.max(160, 40 + rows * 32);

const charts = (usage) => {
  const height = ranked(Math.max(usage.byModel.length, usage.byClass.length));
  return `<div class="row g-4 mb-4">
  <div class="col-12 col-xl-6">${card('Tokens by model', usage.byModel.length ? chartSlot('usage-model', height) : empty('no model breakdown yet', 'fa-regular fa-chart-bar'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-6">${card('Tokens by agent class', usage.byClass.length ? chartSlot('usage-class', height) : empty('no class breakdown yet', 'fa-regular fa-chart-bar'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-8">${card('Tokens over time', usage.overTime.length ? chartSlot('usage-time', 240) : empty('no history yet', 'fa-regular fa-chart-bar'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-4">${card('Cache read versus fresh', (usage.cacheRead + usage.fresh) ? chartSlot('usage-cache', 240) : empty('no split yet', 'fa-regular fa-chart-bar'), { class: 'h-100' })}</div>
</div>`;
};

// Each bar wears its model's or class's badge colour.
const drawCharts = (usage) => {
  if (usage.byModel.length) {
    barChart('usage-model', {
      labels: usage.byModel.map(([label]) => label),
      values: usage.byModel.map(([, value]) => value),
      colors: usage.byModel.map(([label]) => badgeColor(modelKey(label))),
      horizontal: true,
      label: 'tokens',
    });
  }
  if (usage.byClass.length) {
    barChart('usage-class', {
      labels: usage.byClass.map(([label]) => label),
      values: usage.byClass.map(([, value]) => value),
      colors: usage.byClass.map(([label]) => badgeColor(classKey(label))),
      horizontal: true,
      label: 'tokens',
    });
  }
  if (usage.overTime.length) {
    // Every day is on the axis, quiet ones at zero: the month's shape is the point.
    lineChart('usage-time', {
      labels: usage.overTime.map(([label]) => dayLabel(label)),
      series: [{ label: 'tokens', values: usage.overTime.map(([, value]) => value) }],
    });
  }
  if (usage.cacheRead + usage.fresh) {
    doughnutChart('usage-cache', {
      labels: ['cache read', 'fresh'],
      values: [usage.cacheRead, usage.fresh],
      colors: ['var(--omega-ok)', 'var(--omega-accent)'],
    });
  }
};

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const result = feed(state, 'telemetry');

  if (!result) {
    swap(root, loading('reading usage…'));
    return;
  }
  if (!result.ok) {
    swap(root, problem(result.reason));
    return;
  }

  const usage = readUsage(result);
  if (!usage) {
    swap(root, empty('the telemetry endpoint answered with nothing to chart', 'fa-regular fa-chart-bar'));
    return;
  }

  if (!swap(root, `${numbers(usage)}${charts(usage)}${card('Sessions', sessionTable(usage))}`)) return;
  drawCharts(usage);
};

export default () => startPage({
  mount: 'tower-usage',
  feeds: ['repos', 'telemetry'],
  // Token spend is read off this machine's transcripts.
  local: true,
  charts: true,
  render,
});
