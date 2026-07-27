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
import { normalize, splitCrew, crewCount } from '../libs/tower/crew.js';
import { esc, empty, problem, compact, shortPath, statCell, statgrid, card, pill } from '../libs/tower/format.js';

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

const node = (entry, isRoot) => `<div class="card ${isRoot ? '' : 'flex-grow-1'}" style="min-width: 14rem;">
  <div class="card-body p-3">
    <div class="d-flex align-items-center gap-2 mb-1">
      <span class="text-truncate flex-grow-1">${esc(entry.title || shortPath(entry.cwd) || entry.id || 'session')}</span>
      ${entry.state && entry.state !== 'done' ? pill(tone(entry.state), entry.state) : ''}
    </div>
    <div class="classy-micro text-body-secondary text-truncate">${esc(entry.agentClass || (isRoot ? 'main chat' : 'subagent'))}${entry.cwd ? ` · ${esc(shortPath(entry.cwd))}` : ''}</div>
    <div class="classy-micro text-body-secondary text-truncate">${esc(entry.model || 'model unknown')}${entry.effort ? ` · ${esc(entry.effort)}` : ''}</div>
    <div class="classy-micro">${entry.tokens === null ? '<span class="text-body-secondary">tokens unknown</span>' : `${esc(compact(entry.tokens))} tokens`}</div>
  </div>
</div>`;

const tier = (children) => `<div class="tower-tree__children mt-2">${children.map((child) => node(child, false)).join('')}</div>`;

// The finished crew, folded shut. They are still worth reaching — what ran and
// what it spent is the session's history — so the line opens onto the same
// cards rather than hiding them.
const finished = (children) => `<details class="mt-2">
  <summary class="classy-micro text-body-secondary">${children.length} finished subagent${children.length === 1 ? '' : 's'}</summary>
  ${tier(children)}
</details>`;

const branch = (entry) => {
  const { working, done } = splitCrew(entry.children);
  return `<div class="mb-3">
    ${node(entry, true)}
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
  if (live && !live.ok && (!telemetry || !telemetry.ok)) body = problem(live.reason);
  else if (!tree.length) body = empty(sessions(state).length ? 'no sessions in the selected repo' : 'no live sessions');
  else body = `${numbers(tree)}${tree.map(branch).join('')}`;

  root.innerHTML = `${note}${card('Who is running', body)}`;
};

export default () => startPage({
  mount: 'tower-crew',
  feeds: ['repos', 'sessions', 'telemetry'],
  render,
});
