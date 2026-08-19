//
// Crew - the running agents as an org chart: the main session at the root, its
// subagents beneath it by class, each node carrying its role, its model, its
// state and its token spend.
//
// TWO sources, deliberately. `/api/telemetry` is the one that knows about
// SUBAGENTS and tokens, so it draws the chart whenever it answers.
// `/api/sessions` is the fallback: it knows which Claude sessions are running,
// where, and whether they are working, which is the root tier without its
// crews - so a telemetry failure costs the children, never the page.
//
// A finished subagent is not crew: the session's transcript holds every one it
// ever spawned, so the working ones are drawn and the rest are behind ONE
// page-global switch at the top, off by default (libs/tower/crew.js does the
// split). One switch rather than a fold per tree, because the question - "am I
// looking at what is running, or at everything that ever ran?" - is asked of
// the page, not of a session.
//
// Every card is clickable: a click opens the agent dialog, which says what the
// card has no room for (libs/tower/modal.js).
//

import { startPage } from '../libs/tower/page.js';
import { sessionsFor, sessions, feed, inSelectedRepo } from '../libs/tower/state.js';
import { normalize, splitCrew, crewCount, rootLabel, connectorFlow } from '../libs/tower/crew.js';
import {
  esc, empty, problem, compact, statCell, statgrid, card, pill, modelBadge, classBadge, shortPath,
} from '../libs/tower/format.js';
import { crewActivity, cardMuted, roleIcon } from '../libs/tower/agent.js';
import { agentTrigger } from '../libs/tower/modal.js';
import { sitePath } from '../libs/tower/scope.js';
import { loading, swap } from '@omega.js/client/modules/live-page';

/** The tone a node's state is drawn in. */
const tone = (value) => ({ working: 'ok', idle: 'warn', stale: 'danger' }[value] || 'warn');

// Whether the finished subagents are on screen. A module variable on purpose:
// it has to survive the poll repaint - which rebuilds the whole page body every
// ten seconds - and it does not have to survive a reload, where the honest
// default is the live crew again.
let showFinished = false;

/**
 * The roster to draw: telemetry when it answers, the plain session list when it
 * does not. The selection in `?repo=` narrows both, by the root's cwd - a
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

/** What a node is called, and the role it is playing - a root is a manager. */
const label = (entry, isRoot) => (isRoot ? rootLabel(entry) : (entry.agentClass || 'subagent'));
const role = (entry, isRoot) => (isRoot ? 'manager' : entry.agentClass);

// A card leads with the ROLE - one glyph, centred at the top, in the colour
// that class is drawn in everywhere else on the tower - and then with what the
// node is. For a root that is where it is working and what the chat is called;
// for a subagent it is the class, because a crew is read as roles and the agent
// id is a uuid nothing recognizes - so the id demotes to the muted line under
// it, where it stays reachable for matching a card against a transcript.
//
// A root is a manager: that is the tier telemetry's byClass counts it as, so
// the chart and the Usage page name it the same way.
//
// The state pill is now only for the states the indicator does NOT say. A
// working agent is the spinning glyph beside the title (#46) and a pill saying
// the same word twice; idle and stale are neither working nor fresh, and the
// pill is the only thing that names them.
//
// A card that has said nothing for a minute goes MUTED and stays put until five
// (#99) - the mute is a class on the card itself, marked `data-live-card` so the
// second hand can take it off the moment the agent moves again rather than at
// the next poll.
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

// The chart's second tier: the session's working crew, hanging off the trunk
// under the root. Every connector line on the chart is animated, and needs no
// condition to be - splitCrew has already left only the working agents here.
// The lines themselves are the framework's (`.omega-org-chart` - its data/org-chart
// component's stylesheet, which a client-rendered tree gets by writing the same
// class vocabulary); the markup supplies only the nesting they are drawn from,
// and the one thing the framework cannot know: which WAY the line into each
// child runs (crew.connectorFlow), so a card left of the trunk is reached by a
// line flowing left rather than by one crawling back towards its parent.
const tier = (children, now) => `<div class="omega-org-chart__children">
  ${children.map((child, index) => `<div class="omega-org-chart__node omega-tower-flow--${connectorFlow(index, children.length)}">${node(child, false, now)}</div>`).join('')}
</div>`;

// The finished crew, shown only while the page's switch is on. They are still
// worth reaching - what ran and what it spent is the session's history - so the
// switch opens onto the same cards rather than a count. They are a LIST, not
// part of the chart: an agent that has stopped is connected to nothing that is
// still running.
const finished = (children, now) => `<div class="mt-3">
  <p class="omega-micro text-body-secondary mb-2">${children.length} finished subagent${children.length === 1 ? '' : 's'}</p>
  <div class="omega-tower-tree__done">
    ${children.map((child) => `<div class="omega-tower-tree__leaf">${node(child, false, now)}</div>`).join('')}
  </div>
</div>`;

// Each tree says which repo it belongs to before it says anything else: a
// machine running four chats shows four charts, and the root card's own title
// is the last thing read on it.
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
    // The live count is the answer to "who is running"; the total says how much
    // history the parenthesis is folding away.
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
  // One `now` for the whole paint, so every indicator on the page ages against
  // the same instant.
  const now = Date.now();

  // One honest line about where the picture comes from, so a chart with no
  // second tier is not mistaken for a chart with no subagents running.
  const note = telemetry && !telemetry.ok ? `<div class="mb-3">${problem(telemetry.reason)}</div>` : '';

  let body;
  if (!live && !telemetry) body = loading('reading the crew…');
  else if (live && !live.ok && (!telemetry || !telemetry.ok)) body = problem(live.reason);
  else if (!tree.length) body = empty(sessions(state).length ? 'no sessions in the selected repo' : 'no live sessions', 'fa-regular fa-moon');
  else body = `${numbers(tree)}${finishedSwitch(tree)}${tree.map((entry) => branch(entry, now)).join('')}`;

  // A repaint that changed nothing writes nothing, and then there is no switch
  // to rebind - the one in the DOM is still the one this render drew.
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
  // The crew is this machine's processes and transcripts, so a published copy
  // has nothing to draw here whatever token it holds.
  local: true,
  render,
});
