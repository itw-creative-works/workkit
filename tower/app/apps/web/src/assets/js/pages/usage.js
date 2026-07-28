//
// Usage — where the tokens went: by model, by agent class, over time, how much
// of the input was a cache read rather than fresh, what it cost, and the
// session inventory underneath.
//
// Everything here comes from `/api/telemetry`, which serves:
//
//   { sessions: [ { id, chatName, model, cost, startedAt,
//                   tokens: { input, output, cacheRead, cacheCreation, total },
//                   subagents: [ { class, model, tokens, cost, state, startedAt } ] } ],
//     byModel:  { <model>: <tokens> },
//     byClass:  { <class>: <tokens> },
//     overTime: [ { label: 'YYYY-MM-DD', tokens } ] }   // 30 days, quiet days 0
//
// That shape is the contract, and this page reads exactly it. The three
// aggregates are AUTHORITATIVE and are what the charts draw: the API computes
// them over every transcript on the machine, subagents included, while
// `sessions` lists only the handful of ROOT chats. This page used to fall back
// to recomputing them from that list, which threw the real answer away and drew
// a far smaller one — two models instead of five, one bar for the main chat
// instead of nine agent classes, a two-point line instead of thirty days. An
// aggregate the endpoint did not send is the endpoint's defect, so the chart
// says it has nothing rather than drawing a quieter wrong number.
//
// The session list is read for two things: the inventory table, which is
// per-session by definition, and the cache split and the cost, which the
// endpoint does not aggregate. Those two sum the roots AND their subagents, so
// they cover the same spend the charts do — the four numbers at the top of the
// page are one accounting, not two.
//

import { startPage } from '../libs/tower/page.js';
import { feed } from '../libs/tower/state.js';
import {
  esc, empty, problem, compact, money, statCell, statgrid, card, pill,
  modelKey, classKey, badgeColor, modelBadge, classBadge,
} from '../libs/tower/format.js';
import { chartSlot, barChart, doughnutChart, lineChart } from '__main_assets__/js/libs/charts.js';
import { loading, swap } from '@omega.js/client/modules/live-page';

const sortDown = (list) => [...list].sort((a, b) => b[1] - a[1]);

/**
 * One of the endpoint's `{ label: tokens }` aggregates as sorted rows.
 *
 * A zero-token entry is dropped: an empty bar carries no information and takes
 * a row of the chart to say nothing. `<synthetic>` — Claude Code's locally
 * generated messages, which cost nothing and are billed to no model — is always
 * one of these.
 */
const aggregate = (map) => sortDown(Object.entries(map)
  .map(([label, tokens]) => [label, Number(tokens) || 0])
  .filter(([label, tokens]) => label && tokens > 0));

/** '2026-07-27' → 'Jul 27'. Thirty of these share one axis. */
const dayLabel = (day) => {
  const when = new Date(`${day}T00:00:00`);
  return Number.isNaN(when.getTime()) ? day : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The endpoint's day series as rows, oldest first and quiet days included. */
const series = (list) => list.map((entry) => [String(entry.label), Number(entry.tokens) || 0]);

/**
 * Every transcript the payload carries — each root session, and each subagent
 * it spawned. The endpoint's aggregates are computed over exactly this set, so
 * the two numbers derived here, the cache split and the cost, account for the
 * same tokens the charts show.
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
      // A root session IS the manager, which is what the endpoint's byClass
      // calls it — the table and the class chart name the same tier the same way.
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
  const share = total ? `${((usage.cacheRead / total) * 100).toFixed(0)}%` : '—';
  return statgrid([
    statCell('Tokens', total ? compact(total) : '—'),
    statCell('Cache reads', usage.cacheRead ? compact(usage.cacheRead) : '—'),
    statCell('Cache share', share),
    statCell('Estimated cost', usage.cost === null ? '—' : money(usage.cost)),
  ]);
};

// A session's cache column says one thing and it is worth seeing at a glance:
// tokens that were READ from the cache are the cheap ones, and a session that
// read none paid full price for its whole context. So the cell is the theme's
// status pill — green for a read, red for a miss — rather than another number
// in a column of numbers.
//
// A session that has spent NOTHING gets neither. It has not missed the cache;
// it has not asked it anything yet, and a red pill on a chat that has said one
// word reads as a problem where there is none.
const cacheCell = (tokens) => {
  if (!tokens.cacheRead && !tokens.input) return '<span class="text-body-secondary">—</span>';
  return tokens.cacheRead > 0 ? pill('ok', compact(tokens.cacheRead)) : pill('danger', 'miss');
};

const sessionTable = (usage) => {
  if (!usage.sessions.length) return empty('no per-session detail in this payload');
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
    <thead><tr><th>session</th><th>class</th><th>model</th><th class="text-end">tokens</th><th class="text-end">cache</th><th class="text-end">cost</th></tr></thead>
    <tbody>${usage.sessions.map((session) => `<tr>
      <td>${esc(session.title || session.id || '—')}</td>
      <td>${classBadge(session.agentClass)}</td>
      <td>${modelBadge(session.model)}</td>
      <td class="text-end">${esc(compact(session.tokens.total))}</td>
      <td class="text-end">${cacheCell(session.tokens)}</td>
      <td class="text-end">${session.cost === null ? '—' : esc(money(session.cost))}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
};

// A ranked bar chart is as tall as it has rows — the class chart draws every
// agent class the machine ran, and nine of them crushed into a fixed 240px box
// would be nine unreadable slivers. The two charts share one height because
// they sit side by side: the taller one sets it, and the shorter card is not
// left half empty beside it.
const ranked = (rows) => Math.max(160, 40 + rows * 32);

const charts = (usage) => {
  const height = ranked(Math.max(usage.byModel.length, usage.byClass.length));
  return `<div class="row g-4 mb-4">
  <div class="col-12 col-xl-6">${card('Tokens by model', usage.byModel.length ? chartSlot('usage-model', height) : empty('no model breakdown yet'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-6">${card('Tokens by agent class', usage.byClass.length ? chartSlot('usage-class', height) : empty('no class breakdown yet'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-8">${card('Tokens over time', usage.overTime.length ? chartSlot('usage-time', 240) : empty('no history yet'), { class: 'h-100' })}</div>
  <div class="col-12 col-xl-4">${card('Cache read versus fresh', (usage.cacheRead + usage.fresh) ? chartSlot('usage-cache', 240) : empty('no split yet'), { class: 'h-100' })}</div>
</div>`;
};

// Each bar is drawn in the colour its model or class carries everywhere else on
// the tower, so a row in the chart and a badge in the table below it are
// recognizably the same thing.
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
    // Every one of the thirty days is on the axis, quiet ones at zero: the shape
    // of a month — which days were busy and which were not — is the whole point,
    // and an axis of only the days that happened to be non-zero would compress
    // three weeks of silence into nothing.
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
    swap(root, empty('the telemetry endpoint answered with nothing to chart'));
    return;
  }

  if (!swap(root, `${numbers(usage)}${charts(usage)}${card('Sessions', sessionTable(usage))}`)) return;
  drawCharts(usage);
};

export default () => startPage({
  mount: 'tower-usage',
  feeds: ['repos', 'telemetry'],
  charts: true,
  render,
});
