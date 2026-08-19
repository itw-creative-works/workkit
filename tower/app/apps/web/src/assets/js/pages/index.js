//
// Overview - the landing page, and the one that has to read as a control room:
// the six numbers, what is waiting on the owner, who is running, and which repos are
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
  modelBadge, statusBreakdown, LOCAL_ONLY_NOTICE, localOnlyNotice,
} from '../libs/tower/format.js';
import { chartSlot, doughnutChart, lineChart, barChart } from '__main_assets__/js/libs/charts.js';
import {
  entriesOf, hasSeries, unread, seriesOf, weekDelta, deltaLine, ACCRUES, UNREAD,
} from '../libs/tower/history.js';
import { loading, swap } from '@omega.js/client/modules/live-page';
import { issueItem, externalLink } from '../libs/tower/modal.js';
import { selectedSlugs } from '../libs/tower/scope.js';
import { crewActivity, cardMuted } from '../libs/tower/agent.js';

/** Sum a health field across the repos in play; nulls (unknowable) are skipped. */
const total = (state, field) => reposFor(state)
  .map((repo) => health(state)[repo.path])
  .filter(Boolean)
  .reduce((sum, reading) => sum + (typeof reading[field] === 'number' ? reading[field] : 0), 0);

// In flight is the brief's definition, to the letter (tower/api/lib/brief.js):
// `status:building` IS in flight, and the label is the whole of it (issue #62).
// A claim - an assignee, or the agent:working marker - says WHO holds an issue,
// never which queue it is in: a claimed `status:specced` issue is a transient
// the standards sweep flips, so counting it here would put the same issue in
// two places and disagree with the brief the Brief page draws.

// QA sits between them because it is the OWNER's queue (issue #135): built work
// parked on a check, which nothing ships past. Blocked is a decision to make and
// QA is a check to give - two different asks of the same person, so they are two
// tiles rather than one "waiting on you" number that hides which is which.

// Three of the seven numbers are the MACHINE's - the live crew and the state of
// its working copies - and a published copy has no reading of them at all. The
// tile says so: a dash with the local-only sentence as its tooltip, never the 0
// that summing an empty feed would produce, because "no sessions running" and
// "this cannot be read from here" are opposite facts and the second one must
// not be reported as the first.
const machineStat = (state, name, label, value, href) => (localOnly(state, name)
  ? statCell(label, num(null), href, LOCAL_ONLY_NOTICE)
  : statCell(label, value, href));

// The brief payload, which is where the history rides - the same read the Brief
// page makes, and the only feed that carries the mornings before this one.
const briefPayload = (state) => {
  const result = feed(state, 'brief');
  return result && result.ok ? result.data : null;
};

// How a number compares with a week ago, as the tile's sub-line (issue #55).
// The comparison is the HISTORY's, which is the board as the published briefs
// recorded it - roster-wide, and simply absent until two mornings have gone
// out. Under a repo selection the tiles above are narrowed, so the sub-lines
// go quiet rather than sit a roster-wide delta under a per-repo number.
const since = (entries, key) => deltaLine(weekDelta(entries, key));

const numbers = (state) => {
  const issues = issuesFor(state);
  const entries = selectedSlugs(state).length ? [] : entriesOf(briefPayload(state));
  return statgrid([
    statCell('Open issues', issues.length, '/board', undefined, since(entries, 'open')),
    statCell('Blocked', issues.filter((issue) => issue.status === 'blocked').length, '/board', undefined, since(entries, 'waiting')),
    statCell('QA', issues.filter((issue) => issue.status === 'qa').length, '/board', undefined, since(entries, 'qa')),
    statCell('In flight', issues.filter((issue) => issue.status === 'building').length, '/board', undefined, since(entries, 'inFlight')),
    machineStat(state, 'sessions', 'Live sessions', sessionsFor(state).length, '/crew'),
    machineStat(state, 'health', 'Unpushed', total(state, 'unpushed'), '/health'),
    machineStat(state, 'health', 'Unreleased', total(state, 'unreleasedEntries'), '/health'),
  ]);
};

// What is waiting on the owner. It sits high, it is never collapsed, and it says so
// even when the answer is "nothing" - a blank region would read as a bug.
//
// The alarm is spent only when something IS waiting: an empty strip carries no
// red border and no accent chip, because a dashboard that shouts at a clear
// queue teaches you to stop reading it.
// The rest of a capped list is on the Board, and the line says how many it is -
// "see all" with no number would hide exactly the fact that matters when the
// queue has grown.
const seeMore = (hidden, href) => (hidden
  ? `<p class="mt-2 mb-0"><a class="omega-micro text-decoration-none" href="${esc(href)}">see all - ${hidden} more on the board</a></p>`
  : '');

const waiting = (state) => {
  const blocked = issuesFor(state).filter((issue) => issue.status === 'blocked');
  const { shown, hidden } = cap(blocked);
  const body = blocked.length
    ? `<ul class="list-unstyled mb-0">${shown.map((issue) => issueItem(issue, `
        <span class="flex-grow-1">
          <span class="omega-micro">${esc(issue.repo)} #${esc(issue.number)}</span>
          <span class="d-block">${esc(issue.title)}</span>
        </span>
        ${externalLink(issue.url)}
      `, { inner: 'py-1 d-flex align-items-start gap-2' })).join('')}</ul>${seeMore(hidden, '/board')}`
    : empty('nothing is waiting on you', 'fa-regular fa-circle-check');
  return card('Waiting on you', body, {
    chip: blocked.length,
    alarm: blocked.length > 0,
    class: `mb-4${blocked.length ? ' border-danger' : ''}`,
  });
};

// What a session's `state` column says. A session that is MOVING says it with
// the crew's own glyph and how fresh it is - the same indicator the Crew page
// and the Board draw, so one agent reads the same on every surface (#46). The
// states the glyph does not name - idle, stale, unknown - keep their pill,
// because a word is the only thing that tells those two apart.
//
// The indicator itself is `agent.crewActivity` - the Crew page's builder, not a
// second copy of it (#65). This page used to wrap the bare glyph in its own
// span, which cost it the `data-live-*` stamps that markup carries, and the
// second hand ticks exactly what carries them: the Overview's numbers stood
// still while the Crew page's counted up. The hover text comes with the builder
// (how long it has been up, not what it last did) because the tick rewrites
// that attribute every second from the same arithmetic - a sentence written
// only here would survive one second and no more.
// The ROW goes muted with the glyph on it: a session quiet longer than a minute
// stays in the table, faint, until five (#99). Same class as the crew card
// wears, marked `data-live-card` so the second hand decides it too.
const stateCell = (session, now) => {
  // Empty is the builder saying `none` - quiet too long to draw at all.
  const indicator = crewActivity(session, now);
  return indicator || pill(session.state === 'stale' ? 'danger' : 'warn', session.state || 'unknown');
};

const crew = (state) => {
  const live = sessionsFor(state);
  // One `now` for the whole table, so every row ages against the same instant.
  const now = Date.now();
  const result = feed(state, 'sessions');
  let body;
  if (!result) body = loading('reading the crew…');
  // A published copy has no crew to read - the sentence, not an empty table.
  else if (localOnly(state, 'sessions')) body = localOnlyNotice();
  else if (!result.ok) body = problem(result.reason);
  else if (!live.length) body = empty('no live sessions', 'fa-regular fa-moon');
  else {
    // The chat name WRAPS. It used to carry `text-truncate`, which on a table
    // cell only sets `white-space: nowrap` - the cell cannot shrink, so one
    // long session name grew the table to twice its card and pushed the state
    // pill and the model out past the card's edge, reachable only by scrolling
    // the table sideways. Wrapping keeps every column inside the card.
    const { shown, hidden } = cap(live);
    body = `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>repo</th><th>chat</th><th>state</th><th>model</th></tr></thead>
      <tbody>${shown.map((session) => `<tr class="${cardMuted(session, now)}" data-live-card>
        <td class="text-nowrap">${esc(shortPath(session.cwd))}</td>
        <td>${esc(session.chatName || '-')}</td>
        <td>${stateCell(session, now)}</td>
        <td>${session.model ? modelBadge(session.model) : '-'}</td>
      </tr>`).join('')}</tbody>
    </table></div>${seeMore(hidden, '/crew')}`;
  }
  return card('Live crew', body, { class: 'h-100', link: { href: '/crew', label: 'all' } });
};

// A repo says only what is wrong with it, so a clean repo takes one line and
// the eye lands on the dirty ones.
const healthLine = (repo, reading) => {
  if (!reading) return `<li class="py-1">${esc(repo.name)} <span class="text-body-secondary">- no reading</span></li>`;
  if (reading.error) return `<li class="py-1">${esc(repo.name)} <span class="text-danger">${esc(reading.error)}</span></li>`;
  const notes = [
    ['unpushed', reading.unpushed],
    ['uncommitted', reading.uncommitted],
    ['unreleased', reading.unreleasedEntries],
  ].filter(([, value]) => typeof value === 'number' && value > 0);
  const detail = notes.length
    ? notes.map(([label, value]) => `<span class="omega-chip me-1">${esc(label)} ${esc(num(value))}</span>`).join('')
    : pill('ok', 'clean');
  return `<li class="py-1 d-flex align-items-center gap-2">
    <span class="flex-grow-1 text-truncate">${esc(repo.name)}</span>
    <span class="text-nowrap">${detail}</span>
  </li>`;
};

// How much is wrong with a repo, as one number - what the capped list is
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
  // The ROSTER answers off-machine - it is a list of names - but the readings
  // this panel is about do not: uncommitted, unpushed and unreleased are read
  // off working copies. So the panel is gated on `health`, not on the roster it
  // would otherwise draw a full list of "no reading" rows from.
  if (localOnly(state, 'health')) body = localOnlyNotice();
  else if (!result) body = loading('reading the roster…');
  else if (!result.ok) body = problem(result.reason);
  else if (!list.length) body = empty('no repos in the roster - nothing has opted in under the roster root', 'fa-regular fa-square-plus');
  else {
    const ranked = [...list].sort((a, b) => trouble(health(state)[b.path]) - trouble(health(state)[a.path]));
    const { shown, hidden } = cap(ranked);
    body = `<ul class="list-unstyled mb-0">${shown.map((repo) => healthLine(repo, health(state)[repo.path])).join('')}</ul>${seeMore(hidden, '/health')}`;
  }
  return card('Health', body, { class: 'h-100', link: { href: '/health', label: 'all' } });
};

// Open issues by status - the same series the Board's columns count, as a
// doughnut: the question this panel answers is what SHARE of the queue is
// blocked or unspecced, and a ring says a share where a row of bars said that
// many unrelated heights. The box is taller than the bars needed because the legend
// sits under the ring and carries the labels the axis used to. The series is
// statusBreakdown's, so an unlabeled issue is a visible slice rather than a
// ring quietly summing short of the count beside it (#118).
const shape = (state) => (issuesFor(state).length
  ? card('The queue by status', chartSlot('overview-status', 260, statusBreakdown(issuesFor(state)).values), { class: 'mt-4' })
  : '');

const drawShape = (state) => {
  const issues = issuesFor(state);
  if (!issues.length) return;
  doughnutChart('overview-status', statusBreakdown(issues));
};

// ── The board over time ────────────────────────────────────────────────────
//
// The history is the published briefs read back (issue #55): one point per
// morning, and nothing at all before the first brief that carried a stats
// block. So the three cards say WHY they are empty rather than drawing an axis
// with nothing on it - a chart of one point is a dot claiming to be a trend.
//
// The five series are the queue's own, in the Board's order - which is why `qa`
// is last - and every colour comes from the chart module's ramp: nothing here
// names a colour.

const historyBody = (payload, id, height, key) => {
  if (unread(payload)) return empty(UNREAD, 'fa-regular fa-clock');
  if (!hasSeries(payload)) return empty(ACCRUES, 'fa-regular fa-clock');
  // The stamp is the card's OWN series - it is what tells `swap` the markup
  // changed on a data-only tick, so a card stamped with a neighbour's series
  // would redraw on the wrong signal.
  return chartSlot(id, height, seriesOf(entriesOf(payload), key).values);
};

const overTime = (state) => {
  const payload = briefPayload(state);
  const result = feed(state, 'brief');
  // The feed has not answered yet - the cards are not drawn at all rather than
  // drawn as an absence that a moment later turns into data.
  if (!result) return '';
  return `<div class="row g-4 mt-0">
    <div class="col-12 col-xl-8">${card('The board over time', historyBody(payload, 'history-board', 240, 'open'), { class: 'h-100' })}</div>
    <div class="col-12 col-xl-4">${card('Closed per day', historyBody(payload, 'history-closed', 240, 'closedDay'), { class: 'h-100' })}</div>
    <div class="col-12">${card('Inbox depth', historyBody(payload, 'history-inbox', 180, 'inbox'), {})}</div>
  </div>`;
};

const drawHistory = (state) => {
  const payload = briefPayload(state);
  if (!hasSeries(payload)) return;
  const entries = entriesOf(payload);
  const open = seriesOf(entries, 'open');

  lineChart('history-board', {
    labels: open.labels,
    series: [
      { label: 'waiting', values: seriesOf(entries, 'waiting').values },
      { label: 'ready', values: seriesOf(entries, 'ready').values },
      { label: 'in flight', values: seriesOf(entries, 'inFlight').values },
      { label: 'inbox', values: seriesOf(entries, 'inbox').values },
      { label: 'qa', values: seriesOf(entries, 'qa').values },
    ],
  });

  const closed = seriesOf(entries, 'closedDay');
  barChart('history-closed', { labels: closed.labels, values: closed.values, label: 'closed' });

  const inbox = seriesOf(entries, 'inbox');
  lineChart('history-inbox', { labels: inbox.labels, series: [{ label: 'inbox', values: inbox.values }] });
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
  // showing seven confident zeros.
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
  // an unchanged tick leaves the existing canvas - and its Chart.js instance -
  // alone rather than tearing it down and building the same picture again.
  if (!swap(root, `
    ${head}
    <div class="row g-4">
      <div class="col-12 col-xl-6">${crew(state)}</div>
      <div class="col-12 col-xl-6">${healthPanel(state)}</div>
    </div>
    ${shape(state)}
    ${overTime(state)}
  `)) return;

  drawShape(state);
  drawHistory(state);
};

// `brief` is read for its HISTORY - the mornings before this one, which no live
// sweep can answer (issue #55). Its counts are not drawn here; the tiles above
// are this minute's board.
export default () => startPage({
  mount: 'tower-overview',
  feeds: ['repos', 'board', 'sessions', 'health', 'brief'],
  charts: true,
  render,
});
