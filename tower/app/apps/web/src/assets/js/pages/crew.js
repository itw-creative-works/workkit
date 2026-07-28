//
// Crew — the running agents as an org chart: the main session at the root, its
// subagents beneath it by class, each node carrying its model, its state and
// its token spend.
//
// TWO sources, deliberately. `/api/telemetry` is the one that knows about
// SUBAGENTS and tokens, so it draws the chart whenever it answers.
// `/api/sessions` is the fallback: it knows which Claude sessions are running,
// where, and whether they are working, which is the root tier without its
// crews — so a telemetry failure costs the children, never the page.
//
// A finished subagent is not crew: the session's transcript holds every one it
// ever spawned, so the working ones are drawn and the rest are one expandable
// count line per session (libs/tower/crew.js does that split).
//

import { startPage } from '../libs/tower/page.js';
import { sessionsFor, sessions, feed, inSelectedRepo } from '../libs/tower/state.js';
import { normalize, splitCrew, crewCount, rootLabel } from '../libs/tower/crew.js';
import {
  esc, empty, problem, compact, statCell, statgrid, card, pill, modelBadge, classBadge,
} from '../libs/tower/format.js';
import { loading, swap } from '@omega.js/client/modules/live-page';

/** The tone a node's state is drawn in. */
const tone = (value) => ({ working: 'ok', idle: 'warn', stale: 'danger' }[value] || 'warn');

/**
 * The roster to draw: telemetry when it answers, the plain session list when it
 * does not. The selection in `?repo=` narrows both, by the root's cwd — a
 * subagent belongs to whatever repo the session that spawned it is working in.
 *
 * @param {object} state the runtime's feed state
 * @returns {object[]} the root nodes, each with its children
 */
const roots = (state) => {
  const result = feed(state, 'telemetry');
  if (result && result.ok && result.data && result.data.sessions.length) {
    return result.data.sessions.filter((row) => inSelectedRepo(state, row.cwd)).map(normalize);
  }
  return sessionsFor(state).map(normalize);
};

// A card leads with what the node IS. For a root that is where it is working
// and what the chat is called; for a subagent it is the CLASS, because a crew
// is read as roles and the agent id is a uuid nothing recognizes — so the id
// demotes to the muted line under it, where it stays reachable for matching a
// card against a transcript.
//
// A root is a manager: that is the tier telemetry's byClass counts it as, so
// the chart and the Usage page name it the same way.
const node = (entry, isRoot) => `<div class="card h-100">
  <div class="card-body p-3">
    <div class="d-flex align-items-center gap-2 mb-1">
      <span class="text-truncate flex-grow-1">${esc(isRoot ? rootLabel(entry) : (entry.agentClass || 'subagent'))}</span>
      ${entry.state && entry.state !== 'done' ? pill(tone(entry.state), entry.state) : ''}
    </div>
    <div class="classy-micro text-body-secondary text-truncate">${esc(entry.id || 'no id')}</div>
    <div class="d-flex flex-wrap align-items-center gap-1 my-2">
      ${classBadge(isRoot ? 'manager' : entry.agentClass)}
      ${modelBadge(entry.model)}
      ${entry.effort ? `<span class="classy-chip">${esc(entry.effort)}</span>` : ''}
    </div>
    <div class="classy-micro">${entry.tokens === null ? '<span class="text-body-secondary">tokens unknown</span>' : `${esc(compact(entry.tokens))} tokens`}</div>
  </div>
</div>`;

// The chart's second tier: the session's working crew, hanging off the trunk
// under the root. Every connector line on the chart is animated, and needs no
// condition to be — splitCrew has already left only the working agents here.
// The lines themselves are the framework's (`.omega-org-chart` — its data/org-chart
// component's stylesheet, which a client-rendered tree gets by writing the same
// class vocabulary); the markup supplies only the nesting they are drawn from.
const tier = (children) => `<div class="omega-org-chart__children">
  ${children.map((child) => `<div class="omega-org-chart__node">${node(child, false)}</div>`).join('')}
</div>`;

// The finished crew, folded shut. They are still worth reaching — what ran and
// what it spent is the session's history — so the line opens onto the same
// cards rather than hiding them. They are a LIST, not part of the chart: an
// agent that has stopped is connected to nothing that is still running.
const finished = (children) => `<details class="mt-3">
  <summary class="classy-micro text-body-secondary">${children.length} finished subagent${children.length === 1 ? '' : 's'}</summary>
  <div class="omega-tower-tree__done mt-2">
    ${children.map((child) => `<div class="omega-tower-tree__leaf">${node(child, false)}</div>`).join('')}
  </div>
</details>`;

const branch = (entry) => {
  const { working, done } = splitCrew(entry.children);
  return `<div class="omega-org-chart mb-4">
    <div class="omega-org-chart__root">${node(entry, true)}</div>
    ${working.length ? tier(working) : ''}
    ${done.length ? finished(done) : ''}
  </div>`;
};

const numbers = (tree) => {
  const crew = crewCount(tree);
  const working = tree.filter((entry) => entry.state === 'working').length;
  const spend = tree
    .flatMap((entry) => [entry, ...entry.children])
    .map((entry) => entry.tokens)
    .filter((value) => typeof value === 'number');
  return statgrid([
    statCell('Sessions', tree.length),
    statCell('Working', working),
    // The live count is the answer to "who is running"; the total says how much
    // history the parenthesis is folding away.
    statCell('Subagents', `${crew.working} (${crew.total})`),
    statCell('Tokens', spend.length ? compact(spend.reduce((a, b) => a + b, 0)) : '—', '/usage'),
  ]);
};

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const telemetry = feed(state, 'telemetry');
  const live = feed(state, 'sessions');
  const tree = roots(state);

  // One honest line about where the picture comes from, so a chart with no
  // second tier is not mistaken for a chart with no subagents running.
  const note = telemetry && !telemetry.ok ? `<div class="mb-3">${problem(telemetry.reason)}</div>` : '';

  let body;
  if (!live && !telemetry) body = loading('reading the crew…');
  else if (live && !live.ok && (!telemetry || !telemetry.ok)) body = problem(live.reason);
  else if (!tree.length) body = empty(sessions(state).length ? 'no sessions in the selected repo' : 'no live sessions');
  else body = `${numbers(tree)}${tree.map(branch).join('')}`;

  swap(root, `${note}${card('Who is running', body)}`);
};

export default () => startPage({
  mount: 'tower-crew',
  feeds: ['repos', 'sessions', 'telemetry'],
  render,
});
