// Crew: the running agents as an org chart (tower/README.md § The pages).
// `/api/telemetry` draws it whenever it answers; `/api/sessions` is the
// fallback root tier, so a telemetry failure costs the children, never the page.

import { startPage } from '../libs/tower/page.js';
import { sessionsFor, sessions, feed, inSelectedRepo } from '../libs/tower/state.js';
import { normalize, splitCrew, crewCount, rootLabel, connectorFlow } from '../libs/tower/crew.js';
import {
  esc, empty, problem, loading, compact, statCell, statgrid, card, pill, modelBadge, classBadge, shortPath,
} from '../libs/tower/format.js';
import { crewActivity, cardMuted, roleIcon } from '../libs/tower/agent.js';
import { agentTrigger } from '../libs/tower/modal.js';
import { sitePath } from '../libs/tower/scope.js';
import { swap } from '@omega.js/client/modules/live-page';

/** The tone a node's state is drawn in. */
const tone = (value) => ({ working: 'ok', idle: 'warn', stale: 'danger' }[value] || 'warn');

// A module variable: it survives the poll repaint but not a reload.
let showFinished = false;

/**
 * The roster to draw: telemetry when it answers, the plain session list when it
 * does not. `?repo=` narrows both by the root's cwd.
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

/** What a node is called, and the role it is playing - a root is a manager. */
const label = (entry, isRoot) => (isRoot ? rootLabel(entry) : (entry.agentClass || 'subagent'));
const role = (entry, isRoot) => (isRoot ? 'manager' : entry.agentClass);

// A root is a manager, the tier telemetry's byClass counts it as. The pill names
// only the states the activity glyph does not (idle, stale); `data-live-card`
// lets the second hand lift the mute between polls.
const node = (entry, isRoot, now) => `<div class="card h-100 omega-interactive omega-interactive--lift ${cardMuted(entry, now)}" data-live-card ${agentTrigger({ ...entry, label: label(entry, isRoot), role: role(entry, isRoot) })}>
  <div class="card-body p-3">
    <div class="text-center mb-2">${roleIcon(role(entry, isRoot))}</div>
    <div class="d-flex align-items-center gap-2 mb-1">
      <span class="text-truncate flex-grow-1">${esc(label(entry, isRoot))}</span>
      ${crewActivity(entry, now)}
      ${entry.state && entry.state !== 'done' && entry.state !== 'working' ? pill(tone(entry.state), entry.state) : ''}
    </div>
    <div class="omega-micro text-body-secondary text-truncate">${esc(entry.id || 'no id')}</div>
    <div class="d-flex flex-wrap align-items-center gap-1 my-2">
      ${classBadge(role(entry, isRoot))}
      ${modelBadge(entry.model)}
      ${entry.effort ? `<span class="omega-chip">${esc(entry.effort)}</span>` : ''}
    </div>
    <div class="omega-micro">${entry.tokens === null ? '<span class="text-body-secondary">tokens unknown</span>' : `${esc(compact(entry.tokens))} tokens`}</div>
  </div>
</div>`;

// The working crew under the root. The lines are the framework's
// `.omega-org-chart`; the markup adds only which way each line flows.
const tier = (children, now) => `<div class="omega-org-chart__children">
  ${children.map((child, index) => `<div class="omega-org-chart__node omega-tower-flow--${connectorFlow(index, children.length)}">${node(child, false, now)}</div>`).join('')}
</div>`;

// The finished crew, a list rather than part of the chart: a stopped agent is
// connected to nothing still running.
const finished = (children, now) => `<div class="mt-3">
  <p class="omega-micro text-body-secondary mb-2">${children.length} finished subagent${children.length === 1 ? '' : 's'}</p>
  <div class="omega-tower-tree__done">
    ${children.map((child) => `<div class="omega-tower-tree__leaf">${node(child, false, now)}</div>`).join('')}
  </div>
</div>`;

const branch = (entry, now) => {
  const { working, done } = splitCrew(entry.children);
  return `<section class="mb-4">
    <div class="omega-panel-head mb-2">
      <span class="text-truncate">${esc(shortPath(entry.cwd) || 'no repo')}</span>
      <span class="omega-chip">${working.length} working</span>
    </div>
    <div class="omega-org-chart">
      <div class="omega-org-chart__root">${node(entry, true, now)}</div>
      ${working.length ? tier(working, now) : ''}
    </div>
    ${showFinished && done.length ? finished(done, now) : ''}
  </section>`;
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
    statCell('Subagents', `${crew.working} (${crew.total})`),
    statCell('Tokens', spend.length ? compact(spend.reduce((a, b) => a + b, 0)) : '-', sitePath('/usage')),
  ]);
};

/** The page's one switch: everything that ever ran, or only what is running. */
const finishedSwitch = (tree) => {
  const total = crewCount(tree);
  const done = total.total - total.working;
  if (!done) return '';
  return `<div class="form-check form-switch mb-3">
    <input class="form-check-input" type="checkbox" role="switch" id="crew-finished"${showFinished ? ' checked' : ''}>
    <label class="form-check-label omega-micro" for="crew-finished">Show ${done} finished subagent${done === 1 ? '' : 's'}</label>
  </div>`;
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
  // One `now`, so every indicator ages against the same instant.
  const now = Date.now();

  // Without it a chart missing its second tier reads as no subagents running.
  const note = telemetry && !telemetry.ok ? `<div class="mb-3">${problem(telemetry.reason)}</div>` : '';

  let body;
  if (!live && !telemetry) body = loading('reading the crew…');
  else if (live && !live.ok && (!telemetry || !telemetry.ok)) body = problem(live.reason);
  else if (!tree.length) body = empty(sessions(state).length ? 'no sessions in the selected repo' : 'no live sessions', 'fa-regular fa-moon');
  else body = `${numbers(tree)}${finishedSwitch(tree)}${tree.map((entry) => branch(entry, now)).join('')}`;

  // An unchanged repaint writes nothing, so the switch in the DOM needs no rebind.
  if (!swap(root, `${note}${card('Who is running', body)}`)) return;

  const toggle = root.querySelector('#crew-finished');
  if (toggle) {
    toggle.addEventListener('change', (event) => {
      showFinished = event.target.checked;
      render(root, state);
    });
  }
};

export default () => startPage({
  mount: 'tower-crew',
  feeds: ['repos', 'sessions', 'telemetry'],
  // This machine's processes and transcripts: a published copy has nothing here.
  local: true,
  render,
});
