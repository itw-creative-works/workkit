//
// Board — every open issue on the roster, in columns by `status:`.
//
// The five columns are the four status labels plus one for issues carrying no
// status at all: those exist, they are the ones triage has not reached, and a
// board that hides them tells a comfortable lie about how much is in the queue.
//
// The filters live in the URL query alongside the chrome's `?repo=`, so a
// filtered board is a link someone else can open. They are read back out of the
// URL on every draw, which also makes the 60-second repaint harmless: the
// toolbar is rebuilt from the URL, not from whatever the DOM last held.
//

import { startPage } from '../libs/tower/page.js';
import { issuesFor, board, feed } from '../libs/tower/state.js';
import { esc, empty, problem, issueChips, STATUSES, statusColor } from '../libs/tower/format.js';

// The filter names, which are also their URL parameter names. `repo` is not one
// of them — the page chrome owns that globally and every page obeys it.
const PARAMS = ['type', 'priority', 'agent', 'assignee', 'q'];

const readFilters = () => {
  const params = new URL(location.href).searchParams;
  const filters = {};
  for (const name of PARAMS) filters[name] = params.get(name) || '';
  return filters;
};

const writeFilters = (filters) => {
  const url = new URL(location.href);
  for (const name of PARAMS) {
    if (filters[name]) url.searchParams.set(name, filters[name]);
    else url.searchParams.delete(name);
  }
  history.replaceState(null, '', url);
};

const anyFilter = (filters) => PARAMS.some((name) => filters[name]);

const matches = (issue, filters) => {
  if (filters.type && issue.type !== filters.type) return false;
  if (filters.priority && issue.priority !== filters.priority) return false;
  if (filters.agent === 'ok' && !issue.agentOk) return false;
  if (filters.assignee && !(issue.assignees || []).includes(filters.assignee)) return false;
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    if (!`#${issue.number} ${issue.title}`.toLowerCase().includes(needle)) return false;
  }
  return true;
};

/** The distinct values of one field across the issues, sorted, blanks dropped. */
const optionsFrom = (issues, pick) => [...new Set(issues.flatMap(pick).filter(Boolean))].sort();

const select = (id, label, chosen, values) => `<label>
  <span class="classy-micro d-block">${esc(label)}</span>
  <select class="form-select form-select-sm" id="${esc(id)}" data-filter="${esc(id.replace('board-', ''))}">
    <option value="">any</option>
    ${values.map((value) => `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(value)}</option>`).join('')}
  </select>
</label>`;

const toolbar = (issues, filters) => `<form class="d-flex flex-wrap align-items-end gap-2 mb-3" id="board-filters" onsubmit="return false">
  <label class="flex-grow-1">
    <span class="classy-micro d-block">Search</span>
    <input class="form-control form-control-sm" type="search" id="board-q" data-filter="q" value="${esc(filters.q)}" placeholder="title or number" aria-label="Search titles and numbers">
  </label>
  ${select('board-type', 'Type', filters.type, optionsFrom(issues, (issue) => [issue.type]))}
  ${select('board-priority', 'Priority', filters.priority, optionsFrom(issues, (issue) => [issue.priority]))}
  ${select('board-assignee', 'Assignee', filters.assignee, optionsFrom(issues, (issue) => issue.assignees || []))}
  <label>
    <span class="classy-micro d-block">Agent</span>
    <select class="form-select form-select-sm" id="board-agent" data-filter="agent">
      <option value="">any</option>
      <option value="ok"${filters.agent === 'ok' ? ' selected' : ''}>agent:ok</option>
    </select>
  </label>
  ${anyFilter(filters) ? '<button class="btn btn-sm btn-outline-adaptive" type="button" id="board-clear">Clear filters</button>' : ''}
</form>`;

// priority:high floats to the top of its column; everything else keeps the
// board's own order, which the sweep already returns most-recently-updated first.
const order = (a, b) => {
  const high = (issue) => (issue.priority === 'high' ? 0 : 1);
  if (high(a) !== high(b)) return high(a) - high(b);
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
};

const issueCard = (issue, showRepo) => `<a class="card mb-2 text-decoration-none text-reset${issue.status === 'blocked' ? ' border-danger' : ''}" href="${esc(issue.url)}" target="_blank" rel="noopener">
  <div class="card-body p-3">
    <span class="classy-micro d-block">${showRepo ? `${esc(issue.repo)} ` : ''}#${esc(issue.number)}</span>
    <span class="d-block mb-2">${esc(issue.title)}</span>
    ${issueChips(issue)}
  </div>
</a>`;

const column = (status, issues, showRepo) => `<section>
  <div class="classy-panel-head mb-3" style="border-bottom: 2px solid ${statusColor(status.key)};">
    <span>${esc(status.label)}</span>
    <span class="classy-chip">${issues.length}</span>
  </div>
  ${issues.length ? issues.map((issue) => issueCard(issue, showRepo)).join('') : empty('nothing here')}
</section>`;

// `.tower-board` is the sideways-scrolling strip; how WIDE a column is belongs
// here, because it is a function of how many the pipeline has. Five at the
// stylesheet's 15rem floor are wider than an ordinary main region, which put
// Parked half off the edge and No status past it with only an overlay scrollbar
// to say so. At 11rem all five are on screen down to a laptop width, they still
// stretch to fill a wide one, and the strip goes on scrolling when the window is
// genuinely too narrow for the board.
const columns = (shown, showRepo) => `<div class="tower-board" style="grid-auto-columns: minmax(11rem, 1fr);">
  ${STATUSES.map((status) => column(status, shown.filter((issue) => (issue.status || '') === status.key).sort(order), showRepo)).join('')}
</div>`;

// The denominator, so a filtered board never reads as an empty one: how many
// are on screen, how many exist in scope, and how many the filters removed.
const counts = (shown, total, selected) => {
  const hidden = total - shown;
  const scope = selected ? `in ${esc(selected)}` : 'across every repo';
  const tail = hidden > 0 ? ` — ${hidden} filtered out` : '';
  return `<p class="classy-micro text-body-secondary mb-2">showing ${shown} of ${total} open issue${total === 1 ? '' : 's'} ${scope}${tail}</p>`;
};

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const result = feed(state, 'board');
  const all = issuesFor(state);
  const filters = readFilters();
  const shown = all.filter((issue) => matches(issue, filters));
  const showRepo = !state.selectedRepo;

  let body;
  if (!result) body = empty('reading the board…');
  else if (!result.ok) body = problem(result.reason);
  else if (!board(state)) body = empty('the board answered with nothing');
  else body = `${counts(shown.length, all.length, state.selectedRepo)}${columns(shown, showRepo)}`;

  // The page repaints every poll, and a repaint must not take the caret out of
  // the search box mid-word — so where the focus was is put back where it goes.
  const focused = document.activeElement;
  const focusId = focused && root.contains(focused) ? focused.id : null;
  const caret = focusId && typeof focused.selectionStart === 'number' ? focused.selectionStart : null;

  root.innerHTML = `${toolbar(all, filters)}${body}`;

  if (focusId) {
    const again = root.querySelector(`#${focusId}`);
    if (again) {
      again.focus();
      if (caret !== null && typeof again.setSelectionRange === 'function') again.setSelectionRange(caret, caret);
    }
  }

  const form = root.querySelector('#board-filters');
  // `input` covers both the search box and the selects, so one listener on the
  // form is the whole toolbar — and every control is always in the markup.
  form.addEventListener('input', () => {
    const next = {};
    for (const control of form.querySelectorAll('[data-filter]')) next[control.dataset.filter] = control.value.trim();
    writeFilters(next);
    render(root, state);
  });
  const clear = root.querySelector('#board-clear');
  if (clear) {
    clear.addEventListener('click', () => {
      writeFilters({});
      render(root, state);
    });
  }
};

export default () => startPage({
  mount: 'tower-board',
  feeds: ['repos', 'board'],
  render,
});
