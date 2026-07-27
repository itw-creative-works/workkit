//
// Usage — where the tokens went: by model, by agent class, over time, how much
// of the input was a cache read rather than fresh, what it cost, and the
// session inventory underneath.
//
// Everything here comes from `/api/telemetry`, which serves:
//
//   { sessions: [ { id, chatName, model, cost, startedAt,
//                   tokens: { input, output, cacheRead, cacheCreation, total },
//                   subagents: [ { class, model, tokens, cost, startedAt } ] } ],
//     byModel:  { <model>: <tokens> },
//     byClass:  { <class>: <tokens> },
//     overTime: [ { label: 'YYYY-MM-DD', tokens } ] }   // 30 days, quiet days 0
//
// The three aggregates are AUTHORITATIVE and are what the charts draw. The API
// computes them over every transcript on the machine, subagents included, while
// `sessions` lists only the handful of ROOT chats — so recomputing the charts
// from that list throws the real answer away and draws a far smaller one: two
// models instead of five, one bar for the main chat instead of nine agent
// classes, and a two-point line instead of thirty days. Deriving an aggregate
// from the sessions is the fallback for a field the endpoint did not send, and
// nothing else.
//
// The session list is read for two things: the inventory table, which is
// per-session by definition, and the cache split and the cost, which the
// endpoint does not aggregate. Those two sum the roots AND their subagents, so
// they cover the same spend the charts do — the four numbers at the top of the
// page are one accounting, not two.
//

import { startPage, feed } from '../libs/tower/page.js';
import { esc, empty, problem, compact, money, statCell, statgrid, card } from '../libs/tower/format.js';
import { chartSlot, barChart, doughnutChart, lineChart } from '../libs/tower/charts.js';

/** Sum the token fields of one session, whichever of them it carries. */
const tokensOf = (session) => {
  const raw = session.tokens || {};
  if (typeof raw === 'number') return { total: raw, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const part = (key) => (typeof raw[key] === 'number' ? raw[key] : 0);
  const parts = {
    input: part('input'),
    output: part('output'),
    cacheRead: part('cacheRead'),
    cacheCreation: part('cacheCreation'),
  };
  const total = typeof raw.total === 'number'
    ? raw.total
    : parts.input + parts.output + parts.cacheRead + parts.cacheCreation;
  return { ...parts, total };
};

const sortDown = (list) => [...list].sort((a, b) => b[1] - a[1]);

/**
 * One of the endpoint's `{ label: tokens }` aggregates as sorted rows, or null
 * when it sent none — null is what puts the derived fallback in play.
 *
 * A zero-token entry is dropped: an empty bar carries no information and takes
 * a row of the chart to say nothing. `<synthetic>` — Claude Code's locally
 * generated messages, which cost nothing and are billed to no model — is always
 * one of these.
 */
const aggregate = (map) => {
  if (!map || typeof map !== 'object') return null;
  const list = Object.entries(map)
    .map(([label, tokens]) => [label, Number(tokens) || 0])
    .filter(([label, tokens]) => label && tokens > 0);
  return list.length ? sortDown(list) : null;
};

/** '2026-07-27' → 'Jul 27'. Thirty of these share one axis. */
const dayLabel = (day) => {
  const when = new Date(`${day}T00:00:00`);
  return Number.isNaN(when.getTime()) ? day : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The endpoint's day series, oldest first and quiet days included, or null. */
const series = (list) => {
  if (!Array.isArray(list) || !list.length) return null;
  const days = list
    .map((entry) => [String(entry.label || ''), Number(entry.tokens) || 0])
    .filter(([label]) => label);
  return days.length ? days : null;
};

/**
 * Every transcript the payload carries — each root session, and each subagent
 * it spawned. The endpoint's aggregates are computed over exactly this set, so
 * the numbers derived here (the cache split, the cost, and any aggregate the
 * endpoint did not send) account for the same tokens the charts show.
 */
const spends = (sessions) => sessions.flatMap((session) => [
  {
    // A root session IS the manager, which is what the endpoint's byClass calls
    // it — a derived class chart has to speak the same vocabulary as a served one.
    agentClass: 'manager',
    model: session.model || 'unknown',
    startedAt: session.startedAt || session.lastAt || '',
    cost: typeof session.cost === 'number' ? session.cost : null,
    tokens: tokensOf(session),
  },
  ...(Array.isArray(session.subagents) ? session.subagents : []).map((agent) => ({
    agentClass: agent.class || 'unknown',
    model: agent.model || 'unknown',
    startedAt: agent.startedAt || agent.lastAt || '',
    cost: typeof agent.cost === 'number' ? agent.cost : null,
    tokens: tokensOf(agent),
  })),
]);

/** Everything the page draws, read out of the telemetry payload. */
const readUsage = (result) => {
  if (!result || !result.ok || !result.data) return null;
  const payload = result.data;
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const all = spends(sessions);

  const sumBy = (key) => {
    const map = new Map();
    for (const spend of all) map.set(spend[key], (map.get(spend[key]) || 0) + spend.tokens.total);
    return sortDown([...map.entries()].filter(([, tokens]) => tokens > 0));
  };

  // The fallback day series: by calendar day of each transcript's start.
  const byDay = () => {
    const map = new Map();
    for (const spend of all) {
      const day = String(spend.startedAt).slice(0, 10);
      if (!day) continue;
      map.set(day, (map.get(day) || 0) + spend.tokens.total);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const costs = all.map((spend) => spend.cost).filter((value) => typeof value === 'number');

  return {
    sessions: sessions.map((session) => ({
      id: session.id || '',
      title: session.chatName || '',
      model: session.model || 'unknown',
      agentClass: 'manager',
      cost: typeof session.cost === 'number' ? session.cost : null,
      tokens: tokensOf(session),
    })),
    byModel: aggregate(payload.byModel) || sumBy('model'),
    byClass: aggregate(payload.byClass) || sumBy('agentClass'),
    overTime: series(payload.overTime) || byDay(),
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

const sessionTable = (usage) => {
  if (!usage.sessions.length) return empty('no per-session detail in this payload');
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
    <thead><tr><th>session</th><th>class</th><th>model</th><th class="text-end">tokens</th><th class="text-end">cache</th><th class="text-end">cost</th></tr></thead>
    <tbody>${usage.sessions.map((session) => `<tr>
      <td class="text-truncate">${esc(session.title || session.id || '—')}</td>
      <td>${esc(session.agentClass)}</td>
      <td>${esc(session.model)}</td>
      <td class="text-end">${esc(compact(session.tokens.total))}</td>
      <td class="text-end">${esc(compact(session.tokens.cacheRead))}</td>
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

const drawCharts = (usage) => {
  if (usage.byModel.length) {
    barChart('usage-model', {
      labels: usage.byModel.map(([label]) => label),
      values: usage.byModel.map(([, value]) => value),
      horizontal: true,
      label: 'tokens',
    });
  }
  if (usage.byClass.length) {
    barChart('usage-class', {
      labels: usage.byClass.map(([label]) => label),
      values: usage.byClass.map(([, value]) => value),
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
    root.innerHTML = empty('reading usage…');
    return;
  }
  if (!result.ok) {
    root.innerHTML = problem(result.reason);
    return;
  }

  const usage = readUsage(result);
  if (!usage) {
    root.innerHTML = empty('the telemetry endpoint answered with nothing to chart');
    return;
  }

  root.innerHTML = `${numbers(usage)}${charts(usage)}${card('Sessions', sessionTable(usage))}`;
  drawCharts(usage);
};

export default () => startPage({
  mount: 'tower-usage',
  feeds: ['repos', 'telemetry'],
  charts: true,
  render,
});
