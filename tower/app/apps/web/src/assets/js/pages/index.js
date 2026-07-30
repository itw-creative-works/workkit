//
// Overview — the landing page, and the one that has to read as a control room:
// the six numbers, what is waiting on Ian, who is running, and which repos are
// dirty, all above the fold.
//
// Bound to `/` by its filename: the engine derives a page's asset key from the
// URL ('/' → 'index'), so js/pages/index.js is this page's module.
//

import { startPage } from '../libs/tower/page.js';
import {
  issuesFor, reposFor, sessionsFor, board, health, feed, localOnly,
} from '../libs/tower/state.js';
import {
  esc, num, empty, problem, shortPath, statCell, statgrid, card, pill, cap,
  modelBadge, STATUSES, statusColor, LOCAL_ONLY_NOTICE, localOnlyNotice,
} from '../libs/tower/format.js';
import { chartSlot, doughnutChart } from '__main_assets__/js/libs/charts.js';
import { loading, swap } from '@omega.js/client/modules/live-page';
import { issueItem, externalLink } from '../libs/tower/modal.js';
import { activityPhase, activityIcon, sinceLabel } from '../libs/tower/agent.js';

/** Sum a health field across the repos in play; nulls (unknowable) are skipped. */
const total = (state, field) => reposFor(state)
  .map((repo) => health(state)[repo.path])
  .filter(Boolean)
  .reduce((sum, reading) => sum + (typeof reading[field] === 'number' ? reading[field] : 0), 0);

// In flight is the brief's definition, to the letter (tower/api/lib/brief.js):
// `status:building` IS in flight, and a CLAIMED specced issue counts too — the
// shape the board carried before the fifth state existed. A claim is an
// assignee OR the agent:working label, because an agent that took an issue
// without assigning itself is still working it; counting only assignees would
// make this number disagree with the brief's on exactly those issues.
const claimed = (issue) => (issue.assignees || []).length > 0 || issue.agentWorking;

// Three of the six numbers are the MACHINE's — the live crew and the state of
// its working copies — and a published copy has no reading of them at all. The
// tile says so: a dash with the local-only sentence as its tooltip, never the 0
// that summing an empty feed would produce, because "no sessions running" and
// "this cannot be read from here" are opposite facts and the second one must
// not be reported as the first.
const machineStat = (state, name, label, value, href) => (localOnly(state, name)
  ? statCell(label, num(null), href, LOCAL_ONLY_NOTICE)
  : statCell(label, value, href));

const numbers = (state) => {
  const issues = issuesFor(state);
  return statgrid([
    statCell('Open issues', issues.length, '/board'),
    statCell('Blocked', issues.filter((issue) => issue.status === 'blocked').length, '/board'),
    statCell('In flight', issues.filter((issue) => issue.status === 'building'
      || (issue.status === 'specced' && claimed(issue))).length, '/board'),
    machineStat(state, 'sessions', 'Live sessions', sessionsFor(state).length, '/crew'),
    machineStat(state, 'health', 'Unpushed', total(state, 'unpushed'), '/health'),
    machineStat(state, 'health', 'Unreleased', total(state, 'unreleasedEntries'), '/health'),
  ]);
};

// What is waiting on Ian. It sits high, it is never collapsed, and it says so
// even when the answer is "nothing" — a blank region would read as a bug.
//
// The alarm is spent only when something IS waiting: an empty strip carries no
// red border and no accent chip, because a dashboard that shouts at a clear
// queue teaches you to stop reading it.
// The rest of a capped list is on the Board, and the line says how many it is —
// "see all" with no number would hide exactly the fact that matters when the
// queue has grown.
const seeMore = (hidden, href) => (hidden
  ? `<p class="mt-2 mb-0"><a class="classy-micro text-decoration-none" href="${esc(href)}">see all — ${hidden} more on the board</a></p>`
  : '');

const waiting = (state) => {
  const blocked = issuesFor(state).filter((issue) => issue.status === 'blocked');
  const { shown, hidden } = cap(blocked);
  const body = blocked.length
    ? `<ul class="list-unstyled mb-0">${shown.map((issue) => issueItem(issue, `
        <span class="flex-grow-1">
          <span class="classy-micro">${esc(issue.repo)} #${esc(issue.number)}</span>
          <span class="d-block">${esc(issue.title)}</span>
        </span>
        ${externalLink(issue.url)}
      `, { inner: 'py-1 d-flex align-items-start gap-2' })).join('')}</ul>${seeMore(hidden, '/board')}`
    : empty('nothing is waiting on you');
  return card('Waiting on you', body, {
    chip: blocked.length,
    alarm: blocked.length > 0,
    class: `mb-4${blocked.length ? ' border-danger' : ''}`,
  });
};

// What a session's `state` column says. A session that is MOVING says it with
// the crew's own glyph and how fresh it is — the same indicator the Crew page
// and the Board draw, so one agent reads the same on every surface (#46). The
// states the glyph does not name — idle, stale, unknown — keep their pill,
// because a word is the only thing that tells those two apart.
const stateCell = (session, now) => {
  const phase = activityPhase(session, now);
  if (phase === 'none') return pill(session.state === 'stale' ? 'danger' : 'warn', session.state || 'unknown');
  const age = Number.isFinite(Number(session.lastActivity)) ? sinceLabel(now - Number(session.lastActivity)) : '';
  return `<span class="d-inline-flex align-items-center gap-1">
    ${activityIcon(phase, `${esc(session.state || 'unknown')} — last moved ${age || 'at an unknown time'}`)}
    ${age ? `<span class="classy-micro text-body-secondary">${esc(age)}</span>` : ''}
  </span>`;
};

const crew = (state) => {
  const live = sessionsFor(state);
  // One `now` for the whole table, so every row ages against the same instant.
  const now = Date.now();
  const result = feed(state, 'sessions');
  let body;
  if (!result) body = loading('reading the crew…');
  // A published copy has no crew to read — the sentence, not an empty table.
  else if (localOnly(state, 'sessions')) body = localOnlyNotice();
  else if (!result.ok) body = problem(result.reason);
  else if (!live.length) body = empty('no live sessions');
  else {
    // The chat name WRAPS. It used to carry `text-truncate`, which on a table
    // cell only sets `white-space: nowrap` — the cell cannot shrink, so one
    // long session name grew the table to twice its card and pushed the state
    // pill and the model out past the card's edge, reachable only by scrolling
    // the table sideways. Wrapping keeps every column inside the card.
    const { shown, hidden } = cap(live);
    body = `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>repo</th><th>chat</th><th>state</th><th>model</th></tr></thead>
      <tbody>${shown.map((session) => `<tr>
        <td class="text-nowrap">${esc(shortPath(session.cwd))}</td>
        <td>${esc(session.chatName || '—')}</td>
        <td>${stateCell(session, now)}</td>
        <td>${session.model ? modelBadge(session.model) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>${seeMore(hidden, '/crew')}`;
  }
  return card('Live crew', body, { class: 'h-100', link: { href: '/crew', label: 'all' } });
};

// A repo says only what is wrong with it, so a clean repo takes one line and
// the eye lands on the dirty ones.
const healthLine = (repo, reading) => {
  if (!reading) return `<li class="py-1">${esc(repo.name)} <span class="text-body-secondary">— no reading</span></li>`;
  if (reading.error) return `<li class="py-1">${esc(repo.name)} <span class="text-danger">${esc(reading.error)}</span></li>`;
  const notes = [
    ['unpushed', reading.unpushed],
    ['uncommitted', reading.uncommitted],
    ['unreleased', reading.unreleasedEntries],
  ].filter(([, value]) => typeof value === 'number' && value > 0);
  const detail = notes.length
    ? notes.map(([label, value]) => `<span class="classy-chip me-1">${esc(label)} ${esc(num(value))}</span>`).join('')
    : pill('ok', 'clean');
  return `<li class="py-1 d-flex align-items-center gap-2">
    <span class="flex-grow-1 text-truncate">${esc(repo.name)}</span>
    <span class="text-nowrap">${detail}</span>
  </li>`;
};

// How much is wrong with a repo, as one number — what the capped list is
// ordered by. A cap that kept the roster's own order would show five clean
// repos and hide the dirty one, which is the only row on this panel anyone is
// looking for; the full census is the Health page, one click away.
const trouble = (reading) => {
  if (!reading) return 0;
  if (reading.error) return Infinity;
  return ['unpushed', 'uncommitted', 'unreleasedEntries']
    .reduce((sum, field) => sum + (typeof reading[field] === 'number' ? reading[field] : 0), 0);
};

const healthPanel = (state) => {
  const list = reposFor(state);
  const result = feed(state, 'repos');
  let body;
  // The ROSTER answers off-machine — it is a list of names — but the readings
  // this panel is about do not: uncommitted, unpushed and unreleased are read
  // off working copies. So the panel is gated on `health`, not on the roster it
  // would otherwise draw a full list of "no reading" rows from.
  if (localOnly(state, 'health')) body = localOnlyNotice();
  else if (!result) body = loading('reading the roster…');
  else if (!result.ok) body = problem(result.reason);
  else if (!list.length) body = empty('no repos in the roster — nothing has opted in under the roster root');
  else {
    const ranked = [...list].sort((a, b) => trouble(health(state)[b.path]) - trouble(health(state)[a.path]));
    const { shown, hidden } = cap(ranked);
    body = `<ul class="list-unstyled mb-0">${shown.map((repo) => healthLine(repo, health(state)[repo.path])).join('')}</ul>${seeMore(hidden, '/health')}`;
  }
  return card('Health', body, { class: 'h-100', link: { href: '/health', label: 'all' } });
};

// Open issues by status — the same series the Board's columns count, as a
// doughnut: the question this panel answers is what SHARE of the queue is
// blocked or unspecced, and a ring says a share where a row of bars said that
// many unrelated heights. The box is taller than the bars needed because the legend
// sits under the ring and carries the labels the axis used to.
const statusSeries = (issues) => STATUSES.map((status) => issues.filter((issue) => (issue.status || '') === status.key).length);

const shape = (state) => (issuesFor(state).length
  ? card('The queue by status', chartSlot('overview-status', 260, statusSeries(issuesFor(state))), { class: 'mt-4' })
  : '');

const drawShape = (state) => {
  const issues = issuesFor(state);
  if (!issues.length) return;
  doughnutChart('overview-status', {
    labels: STATUSES.map((status) => status.label),
    values: statusSeries(issues),
    colors: STATUSES.map((status) => statusColor(status.key)),
  });
};

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const payload = board(state);
  const result = feed(state, 'board');

  // The board is the section with a failure of its own to report: no gh, no
  // login, no network. It says so where the numbers would be rather than
  // showing six confident zeros.
  let head;
  if (!result) head = `<div class="mb-4">${loading('reading the board…')}</div>`;
  else if (!result.ok) head = `<div class="mb-4">${problem(result.reason)}</div>`;
  else {
    const warnings = ((payload && payload.repos) || [])
      .filter((repo) => repo.error || repo.truncated)
      .map((repo) => `<div class="alert alert-warning py-2 px-3 mb-2">${esc(repo.slug)}: ${esc(repo.error || `showing ${repo.count} of ${repo.totalCount} open issues`)}</div>`)
      .join('');
    head = `${numbers(state)}${warnings}${waiting(state)}`;
  }

  // The chart is drawn only when the markup it lives on was actually written:
  // an unchanged tick leaves the existing canvas — and its Chart.js instance —
  // alone rather than tearing it down and building the same picture again.
  if (!swap(root, `
    ${head}
    <div class="row g-4">
      <div class="col-12 col-xl-6">${crew(state)}</div>
      <div class="col-12 col-xl-6">${healthPanel(state)}</div>
    </div>
    ${shape(state)}
  `)) return;

  drawShape(state);
};

export default () => startPage({
  mount: 'tower-overview',
  feeds: ['repos', 'board', 'sessions', 'health'],
  charts: true,
  render,
});
