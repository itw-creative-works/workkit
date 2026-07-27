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
// `normalize` accepts the spellings either source could take (`sessions`/`crew`
// for the roster, `subagents`/`children` for the tier below, a token count
// either flat or split) and shows what it recognizes.
//

import { startPage, sessionsFor, sessions, feed, inSelectedRepo } from '../libs/tower/page.js';
import { esc, empty, problem, compact, shortPath, statCell, statgrid, card, pill } from '../libs/tower/format.js';

/** The tone a session's state is drawn in. */
const tone = (value) => ({ working: 'ok', idle: 'warn', stale: 'danger' }[value] || 'warn');

/** Total tokens from whatever shape the number arrives in. */
const tokensOf = (node) => {
  const raw = node.tokens;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.total === 'number') return raw.total;
    return ['input', 'output', 'cacheRead', 'cacheCreation']
      .map((key) => (typeof raw[key] === 'number' ? raw[key] : 0))
      .reduce((sum, value) => sum + value, 0);
  }
  return null;
};

/** One node of the chart, from either source, in the shape the render wants. */
const normalize = (node) => ({
  id: node.id || node.sessionId || node.agentId || '',
  title: node.chatName || node.title || node.name || '',
  cwd: node.cwd || '',
  model: node.model || '',
  effort: node.effort || '',
  state: node.state || '',
  agentClass: node.class || node.agentClass || node.subagentType || node.subagent_type || '',
  tokens: tokensOf(node),
  children: (node.subagents || node.children || []).map(normalize),
});

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
  if (result && result.ok && result.data) {
    const list = result.data.sessions || result.data.crew || result.data.roots || [];
    if (Array.isArray(list) && list.length) {
      return list.filter((row) => inSelectedRepo(state, row.cwd)).map(normalize);
    }
  }
  return sessionsFor(state).map(normalize);
};

const node = (entry, isRoot) => `<div class="card ${isRoot ? '' : 'flex-grow-1'}" style="min-width: 14rem;">
  <div class="card-body p-3">
    <div class="d-flex align-items-center gap-2 mb-1">
      <span class="text-truncate flex-grow-1">${esc(entry.title || shortPath(entry.cwd) || entry.id || 'session')}</span>
      ${entry.state ? pill(tone(entry.state), entry.state) : ''}
    </div>
    <div class="classy-micro text-body-secondary text-truncate">${esc(entry.agentClass || (isRoot ? 'main chat' : 'subagent'))}${entry.cwd ? ` · ${esc(shortPath(entry.cwd))}` : ''}</div>
    <div class="classy-micro text-body-secondary text-truncate">${esc(entry.model || 'model unknown')}${entry.effort ? ` · ${esc(entry.effort)}` : ''}</div>
    <div class="classy-micro">${entry.tokens === null ? '<span class="text-body-secondary">tokens unknown</span>' : `${esc(compact(entry.tokens))} tokens`}</div>
  </div>
</div>`;

const branch = (entry) => `<div class="mb-3">
  ${node(entry, true)}
  ${entry.children.length ? `<div class="tower-tree__children mt-2">${entry.children.map((child) => node(child, false)).join('')}</div>` : ''}
</div>`;

const numbers = (tree) => {
  const subagents = tree.reduce((sum, entry) => sum + entry.children.length, 0);
  const working = tree.filter((entry) => entry.state === 'working').length;
  const spend = tree
    .flatMap((entry) => [entry, ...entry.children])
    .map((entry) => entry.tokens)
    .filter((value) => typeof value === 'number');
  return statgrid([
    statCell('Sessions', tree.length),
    statCell('Working', working),
    statCell('Subagents', subagents),
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
