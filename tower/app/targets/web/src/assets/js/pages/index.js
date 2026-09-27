// Overview: the landing page, read as a control room (tower/README.md § The
// pages). Bound to `/` by its filename: the engine derives a page's asset key
// from the URL ('/' → 'index').

import { startPage } from '../libs/tower/page.js';
import {
  issuesFor, reposFor, sessionsFor, board, brief, health, feed, localOnly,
} from '../libs/tower/state.js';
import {
  esc, num, empty, problem, loading, shortPath, statCell, statgrid, card, pill, cap,
  modelBadge, statusBreakdown, LOCAL_ONLY_NOTICE, localOnlyNotice,
} from '../libs/tower/format.js';
import { chartSlot, doughnutChart, lineChart, barChart } from '__main_assets__/js/libs/charts.js';
import {
  entriesOf, hasSeries, unread, seriesOf, weekDelta, deltaLine, unreadLine, ACCRUES, UNREAD,
} from '../libs/tower/history.js';
import { swap, loading as inlineLoading } from '@omega.js/client/modules/live-page';
import { issueItem, externalLink } from '../libs/tower/modal.js';
import { isNone, selectedSlugs, sitePath, scopedHref } from '../libs/tower/scope.js';
import { crewActivity, cardMuted } from '../libs/tower/agent.js';

// Every pointer in the body keeps the repo selection, as the nav links do. The
// inner `sitePath` at each call site is the spelling the suite's bare-path
// guard looks for.
const pointer = (state, href) => scopedHref(href, state.selectedRepo);

/** Sum a health field across the repos in play; nulls (unknowable) are skipped. */
const total = (state, field) => reposFor(state)
  .map((repo) => health(state)[repo.path])
  .filter(Boolean)
  .reduce((sum, reading) => sum + (typeof reading[field] === 'number' ? reading[field] : 0), 0);

// In flight is `status:building` alone, the brief's definition
// (tower/api/lib/brief.js): a claim says who holds an issue, never its queue.

// A machine number a published copy cannot read is a dash with the local-only
// tooltip, never the 0 an empty feed would sum to.
const machineStat = (state, name, label, value, href) => (localOnly(state, name)
  ? statCell(label, num(null), href, LOCAL_ONLY_NOTICE)
  : statCell(label, value, href));

// The week-over-week sub-line comes from the roster-wide history, so it goes
// quiet under a repo selection.
const since = (entries, key) => deltaLine(weekDelta(entries, key));

const numbers = (state) => {
  const issues = issuesFor(state);
  const entries = selectedSlugs(state).length ? [] : entriesOf(brief(state));
  return statgrid([
    statCell('Open issues', issues.length, pointer(state, sitePath('/board')), undefined, since(entries, 'open')),
    statCell('Blocked', issues.filter((issue) => issue.status === 'blocked').length, pointer(state, sitePath('/board')), undefined, since(entries, 'waiting')),
    statCell('QA', issues.filter((issue) => issue.status === 'qa').length, pointer(state, sitePath('/board')), undefined, since(entries, 'qa')),
    statCell('In flight', issues.filter((issue) => issue.status === 'building').length, pointer(state, sitePath('/board')), undefined, since(entries, 'inFlight')),
    machineStat(state, 'sessions', 'Live sessions', sessionsFor(state).length, pointer(state, sitePath('/crew'))),
    machineStat(state, 'health', 'Uncommitted', total(state, 'uncommitted'), pointer(state, sitePath('/health'))),
    machineStat(state, 'health', 'Unpushed', total(state, 'unpushed'), pointer(state, sitePath('/health'))),
    machineStat(state, 'health', 'Unreleased', total(state, 'unreleasedEntries'), pointer(state, sitePath('/health'))),
  ]);
};

// The rest of a capped list, with its count: a bare "see all" hides how far the
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
      `, { inner: 'py-1 d-flex align-items-start gap-2' })).join('')}</ul>${seeMore(hidden, pointer(state, sitePath('/board')))}`
    : empty('nothing is waiting on you', 'fa-regular fa-circle-check');
  return card('Waiting on you', body, {
    chip: blocked.length,
    alarm: blocked.length > 0,
    class: `mb-4${blocked.length ? ' border-danger' : ''}`,
    // The see-more line exists only once the list is capped.
    link: { href: pointer(state, sitePath('/board')), label: 'board' },
  });
};

// The Crew page's own builder, so the second hand ticks its `data-live-*`
// stamps here too; the states the glyph does not name keep their pill.
const stateCell = (session, now) => {
  // Empty is the builder saying `none` - quiet too long to draw at all.
  const indicator = crewActivity(session, now);
  return indicator || pill(session.state === 'stale' ? 'danger' : 'warn', session.state || 'unknown');
};

const crew = (state) => {
  const live = sessionsFor(state);
  // One `now`, so every row ages against the same instant.
  const now = Date.now();
  const result = feed(state, 'sessions');
  let body;
  if (!result) body = loading('reading the crew…');
  // A published copy has no crew to read - the sentence, not an empty table.
  else if (localOnly(state, 'sessions')) body = localOnlyNotice();
  else if (!result.ok) body = problem(result.reason);
  else if (!live.length) body = empty('no live sessions', 'fa-regular fa-moon');
  else {
    // The chat name wraps: `text-truncate` on a table cell only sets nowrap,
    // and one long name pushes the columns past the card's edge.
    const { shown, hidden } = cap(live);
    body = `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>repo</th><th>chat</th><th>state</th><th>model</th></tr></thead>
      <tbody>${shown.map((session) => `<tr class="${cardMuted(session, now)}" data-live-card>
        <td class="text-nowrap">${esc(shortPath(session.cwd))}</td>
        <td>${esc(session.chatName || '-')}</td>
        <td>${stateCell(session, now)}</td>
        <td>${session.model ? modelBadge(session.model) : '-'}</td>
      </tr>`).join('')}</tbody>
    </table></div>${seeMore(hidden, pointer(state, sitePath('/crew')))}`;
  }
  return card('Live crew', body, { class: 'h-100', link: { href: pointer(state, sitePath('/crew')), label: 'all' } });
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

// What the capped list is ordered by, so the cap never hides the dirty repo.
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
  // Gated on `health`, not the roster: the roster answers off-machine, the
  // working-copy readings do not.
  if (localOnly(state, 'health')) body = localOnlyNotice();
  else if (!result) body = loading('reading the roster…');
  else if (!result.ok) body = problem(result.reason);
  // An empty scoped list means everything unticked, or an empty roster.
  else if (!list.length) body = empty(isNone(selectedSlugs(state)) ? 'no projects selected - tick one in the project menu' : 'no repos in the roster - nothing has opted in under the roster root', 'fa-regular fa-square-plus');
  else {
    const ranked = [...list].sort((a, b) => trouble(health(state)[b.path]) - trouble(health(state)[a.path]));
    const { shown, hidden } = cap(ranked);
    body = `<ul class="list-unstyled mb-0">${shown.map((repo) => healthLine(repo, health(state)[repo.path])).join('')}</ul>${seeMore(hidden, pointer(state, sitePath('/health')))}`;
  }
  return card('Health', body, { class: 'h-100', link: { href: pointer(state, sitePath('/health')), label: 'all' } });
};

// The queue's share by status; an unlabelled issue is a visible slice. The head
// says `board`, not `all`: this panel caps nothing.
const shape = (state) => (issuesFor(state).length
  ? card('The queue by status', chartSlot('overview-status', 260, statusBreakdown(issuesFor(state)).values), {
    class: 'mt-4',
    link: { href: pointer(state, sitePath('/board')), label: 'board' },
  })
  : '');

const drawShape = (state) => {
  const issues = issuesFor(state);
  if (!issues.length) return;
  doughnutChart('overview-status', statusBreakdown(issues));
};

// ── The board over time ────────────────────────────────────────────────────
// The published briefs read back (tower/README.md § The pages). The series run
// in the Board's order, `qa` last, in the chart module's own colours.

const historyBody = (payload, id, height, key) => {
  if (unread(payload)) return empty(unreadLine(UNREAD, payload), 'fa-regular fa-clock');
  if (!hasSeries(payload)) return empty(ACCRUES, 'fa-regular fa-clock');
  // Stamped with the card's own series, which is how `swap` sees a data tick.
  return chartSlot(id, height, seriesOf(entriesOf(payload), key).values);
};

const overTime = (state) => {
  const payload = brief(state);
  const result = feed(state, 'brief');
  // Not answered yet: draw nothing rather than an absence about to turn to data.
  if (!result) return '';
  return `<div class="row g-4 mt-0">
    <div class="col-12 col-xl-8">${card('The board over time', historyBody(payload, 'history-board', 240, 'open'), { class: 'h-100' })}</div>
    <div class="col-12 col-xl-4">${card('Closed per day', historyBody(payload, 'history-closed', 240, 'closedDay'), { class: 'h-100' })}</div>
    <div class="col-12">${card('Inbox depth', historyBody(payload, 'history-inbox', 180, 'inbox'), {})}</div>
  </div>`;
};

const drawHistory = (state) => {
  const payload = brief(state);
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

  // A failed board says so where the numbers would be, never as zeros.
  let head;
  if (!result) head = `<div class="mb-4">${loading('reading the board…')}</div>`;
  else if (!result.ok) head = `<div class="mb-4">${problem(result.reason)}</div>`;
  else {
    // A repo speaks only to report an error, pages still arriving (an inline
    // wait, not a warning), or the ceiling it stopped at.
    const warnings = ((payload && payload.repos) || [])
      .filter((repo) => repo.error || repo.loading || repo.truncated)
      .map((repo) => (repo.loading
        ? `<div class="mb-2">${inlineLoading(`${repo.slug}: loading ${repo.count} of ${repo.totalCount} open issues`)}</div>`
        : `<div class="alert alert-warning py-2 px-3 mb-2">${esc(repo.slug)}: ${esc(repo.error || `showing ${repo.count} of ${repo.totalCount} open issues`)}</div>`))
      .join('');
    head = `${numbers(state)}${warnings}${waiting(state)}`;
  }

  // Charts draw only after a write, so an unchanged tick keeps its canvas.
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

// `brief` is read only for its history; the tiles are this minute's board.
export default () => startPage({
  mount: 'tower-overview',
  feeds: ['repos', 'board', 'sessions', 'health', 'brief'],
  charts: true,
  render,
});
