//
// Overview — the landing page, and the one that has to read as a control room:
// the six numbers, what is waiting on Ian, who is running, and which repos are
// dirty, all above the fold.
//
// Bound to `/` by its filename: the engine derives a page's asset key from the
// URL ('/' → 'index'), so js/pages/index.js is this page's module.
//

import {
  startPage, issuesFor, reposFor, sessionsFor, board, health, feed,
} from '../libs/tower/page.js';
import {
  esc, num, empty, problem, shortPath, statCell, statgrid, card, pill, STATUSES, statusColor,
} from '../libs/tower/format.js';
import { chartSlot, barChart } from '../libs/tower/charts.js';

/** Sum a health field across the repos in play; nulls (unknowable) are skipped. */
const total = (state, field) => reposFor(state)
  .map((repo) => health(state)[repo.path])
  .filter(Boolean)
  .reduce((sum, reading) => sum + (typeof reading[field] === 'number' ? reading[field] : 0), 0);

const numbers = (state) => {
  const issues = issuesFor(state);
  return statgrid([
    statCell('Open issues', issues.length, '/board'),
    statCell('Blocked', issues.filter((issue) => issue.status === 'blocked').length, '/board'),
    statCell('In flight', issues.filter((issue) => (issue.assignees || []).length > 0).length, '/board'),
    statCell('Live sessions', sessionsFor(state).length, '/crew'),
    statCell('Unpushed', total(state, 'unpushed'), '/health'),
    statCell('Unreleased', total(state, 'unreleasedEntries'), '/health'),
  ]);
};

// What is waiting on Ian. It sits high, it is never collapsed, and it says so
// even when the answer is "nothing" — a blank region would read as a bug.
//
// The alarm is spent only when something IS waiting: an empty strip carries no
// red border and no accent chip, because a dashboard that shouts at a clear
// queue teaches you to stop reading it.
const waiting = (state) => {
  const blocked = issuesFor(state).filter((issue) => issue.status === 'blocked');
  const body = blocked.length
    ? `<ul class="list-unstyled mb-0">${blocked.map((issue) => `<li class="py-1">
        <a href="${esc(issue.url)}" target="_blank" rel="noopener" class="text-reset">
          <span class="classy-micro">${esc(issue.repo)} #${esc(issue.number)}</span>
          <span class="d-block">${esc(issue.title)}</span>
        </a>
      </li>`).join('')}</ul>`
    : empty('nothing is waiting on you');
  return card('Waiting on you', body, {
    chip: blocked.length,
    alarm: blocked.length > 0,
    class: `mb-4${blocked.length ? ' border-danger' : ''}`,
  });
};

const crew = (state) => {
  const live = sessionsFor(state);
  const result = feed(state, 'sessions');
  let body;
  if (result && !result.ok) body = problem(result.reason);
  else if (!live.length) body = empty('no live sessions');
  else {
    // The chat name WRAPS. It used to carry `text-truncate`, which on a table
    // cell only sets `white-space: nowrap` — the cell cannot shrink, so one
    // long session name grew the table to twice its card and pushed the state
    // pill and the model out past the card's edge, reachable only by scrolling
    // the table sideways. Wrapping keeps every column inside the card.
    body = `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>repo</th><th>chat</th><th>state</th><th>model</th></tr></thead>
      <tbody>${live.map((session) => `<tr>
        <td class="text-nowrap">${esc(shortPath(session.cwd))}</td>
        <td>${esc(session.chatName || '—')}</td>
        <td>${pill(session.state === 'working' ? 'ok' : (session.state === 'stale' ? 'danger' : 'warn'), session.state || 'unknown')}</td>
        <td>${esc(session.model || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
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

const healthPanel = (state) => {
  const list = reposFor(state);
  const result = feed(state, 'repos');
  let body;
  if (result && !result.ok) body = problem(result.reason);
  else if (!list.length) body = empty('no repos in the roster — nothing has opted in under the roster root');
  else body = `<ul class="list-unstyled mb-0">${list.map((repo) => healthLine(repo, health(state)[repo.path])).join('')}</ul>`;
  return card('Health', body, { class: 'h-100', link: { href: '/health', label: 'all' } });
};

/** Open issues by status — the same series the Board's columns count. */
const shape = (state) => (issuesFor(state).length
  ? card('The queue by status', chartSlot('overview-status', 200), { class: 'mt-4' })
  : '');

const drawShape = (state) => {
  const issues = issuesFor(state);
  if (!issues.length) return;
  barChart('overview-status', {
    labels: STATUSES.map((status) => status.label),
    values: STATUSES.map((status) => issues.filter((issue) => (issue.status || '') === status.key).length),
    colors: STATUSES.map((status) => statusColor(status.key)),
    label: 'open issues',
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
  if (!result) head = `<div class="mb-4">${empty('reading the board…')}</div>`;
  else if (!result.ok) head = `<div class="mb-4">${problem(result.reason)}</div>`;
  else {
    const warnings = ((payload && payload.repos) || [])
      .filter((repo) => repo.error || repo.truncated)
      .map((repo) => `<div class="alert alert-warning py-2 px-3 mb-2">${esc(repo.slug)}: ${esc(repo.error || `showing ${repo.count} of ${repo.totalCount} open issues`)}</div>`)
      .join('');
    head = `${numbers(state)}${warnings}${waiting(state)}`;
  }

  root.innerHTML = `
    ${head}
    <div class="row g-4">
      <div class="col-12 col-xl-6">${crew(state)}</div>
      <div class="col-12 col-xl-6">${healthPanel(state)}</div>
    </div>
    ${shape(state)}
  `;

  drawShape(state);
};

export default () => startPage({
  mount: 'tower-overview',
  feeds: ['repos', 'board', 'sessions', 'health'],
  charts: true,
  render,
});
