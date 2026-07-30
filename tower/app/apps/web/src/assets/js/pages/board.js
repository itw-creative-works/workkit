//
// Board — every open issue on the roster, in columns by `status:`.
//
// The six columns are the five status labels plus one for issues carrying no
// status at all: those exist, they are the ones triage has not reached, and a
// board that hides them tells a comfortable lie about how much is in the queue.
//
// The filters live in the URL query alongside the chrome's `?repo=`, so a
// filtered board is a link someone else can open. They are read back out of the
// URL on every draw, which also makes the 60-second repaint harmless: the
// toolbar is rebuilt from the URL, not from whatever the DOM last held.
//
// A card is DRAGGED between the five status columns, and the drop really
// relabels the issue: the payload and the mode gate are api.js's `moveRequest`,
// the write is its `postIssueStatus`, and everything here is what the browser
// contributes — which card was picked up, which column it landed on, and the
// optimistic move that puts it there before the write has answered. A failed
// write puts the card back and says why. A PUBLISHED copy behaves identically:
// the sweep is GitHub's and the browser makes it, and so is the write, with the
// viewer's own token (libs/tower/github.js). The only copy that does not drag is
// the locked one, which never reaches this page — the prompt is its whole body.
//

import { startPage } from '../libs/tower/page.js';
import { issuesFor, board, feed, issueByKey } from '../libs/tower/state.js';
import {
  esc, empty, problem, issueChips, STATUSES, statusColor,
} from '../libs/tower/format.js';
import { loading, swap } from '@omega.js/client/modules/live-page';
import { issueTrigger, externalLink } from '../libs/tower/modal.js';
import { claimGlyph } from '../libs/tower/agent.js';
import { WRITABLE, MOVABLE_STATUSES, moveRequest, postIssueStatus } from '../libs/tower/api.js';

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
  <button class="btn btn-sm btn-outline-adaptive" type="button" id="board-clear">Clear filters</button>
</form>`;

/** Whether this card may be picked up — something to write with, and a status to move from. */
const draggable = (issue) => WRITABLE && MOVABLE_STATUSES.includes(issue.status);

// priority:high floats to the top of its column; everything else keeps the
// board's own order, which the sweep already returns most-recently-updated first.
const order = (a, b) => {
  const high = (issue) => (issue.priority === 'high' ? 0 : 1);
  if (high(a) !== high(b)) return high(a) - high(b);
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
};

// A card OPENS the issue in the dialog; GitHub is reached only through the
// button in its corner, which shows while the card is hovered or focused.
//
// Every card is the same size, which takes all three of its rows holding one
// shape: the slug line truncates, the title is clamped to two lines
// (`omega-tower-issue__title`), and the chips stay on one row
// (`omega-tower-issue__chips`) — so the only remaining variation is a short
// title, which the floor on `.omega-tower-board .omega-tower-issue` absorbs
// while `mt-auto` keeps the chips against the bottom edge. Nothing is lost to
// any of it: the card opens the dialog, which says the whole of all three.
//
// The claim indicator is the crew's own glyph, gate and all (agent.claimGlyph):
// what it looks like, when it is earned and what it says to a screen reader are
// one decision, and it is made in the lib the Crew page draws from too.
//
// A card carrying one of the five statuses is draggable; the one in the "No
// status" column is not, because there is no label to take off it. The card's
// `data-issue` key is what the drop reads back — the same key the dialog
// registry uses, so the two never mean different things.
const issueCard = (issue, showRepo) => `<div class="card omega-tower-issue omega-interactive omega-interactive--lift mb-2${issue.status === 'blocked' ? ' border-danger' : ''}"${draggable(issue) ? ' draggable="true"' : ''} ${issueTrigger(issue)}>
  <div class="card-body p-3 d-flex flex-column">
    <div class="d-flex align-items-start gap-2">
      <span class="classy-micro d-block flex-grow-1 text-truncate">${showRepo ? `${esc(issue.repo)} ` : ''}#${esc(issue.number)}</span>
      ${claimGlyph(issue)}
      ${externalLink(issue.url)}
    </div>
    <span class="mb-2 omega-tower-issue__title">${esc(issue.title)}</span>
    ${issueChips(issue, 'mt-auto omega-tower-issue__chips')}
  </div>
</div>`;

// A column is a drop target only when it names a status to move TO, which the
// "No status" column does not. `pb-2` is the air between the title and the rule
// under it — the head is a flex row and its border sits on the text without it.
const column = (status, issues, showRepo) => `<section${MOVABLE_STATUSES.includes(status.key) ? ` data-column="${esc(status.key)}"` : ''}>
  <div class="classy-panel-head mb-3 pb-2" style="border-bottom: 2px solid ${statusColor(status.key)};">
    <span>${esc(status.label)}</span>
    <span class="classy-chip">${issues.length}</span>
  </div>
  ${issues.length ? issues.map((issue) => issueCard(issue, showRepo)).join('') : empty('nothing here')}
</section>`;

// `.omega-tower-board` is the sideways-scrolling strip; how WIDE a column is belongs
// here, because it is a function of how many the pipeline has. At the
// stylesheet's 15rem floor the strip is wider than an ordinary main region,
// which put Parked half off the edge and No status past it with only an overlay
// scrollbar to say so. At 11rem the columns fit the main region down to a laptop
// width, they still stretch to fill a wide one, and the strip goes on scrolling
// when the window is genuinely too narrow for the board.
const columns = (shown, showRepo) => `<div class="omega-tower-board" style="grid-auto-columns: minmax(11rem, 1fr);">
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

// Why the last move did not land, until another one is tried. It sits outside
// render because a repaint arriving between the failed write and the next drop
// must not swallow the only explanation the page has.
let moveError = null;

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
  if (!result) body = loading('reading the board…');
  else if (!result.ok) body = problem(result.reason);
  else if (!board(state)) body = empty('the board answered with nothing');
  else body = `${moveError ? problem(moveError) : ''}${counts(shown.length, all.length, state.selectedRepo)}${columns(shown, showRepo)}`;

  // The page repaints every poll, and a repaint must not take the caret out of
  // the search box mid-word — so where the focus was is put back where it goes.
  // A poll that changed nothing does not write at all (swap), and then there is
  // nothing to restore.
  const focused = document.activeElement;
  const focusId = focused && root.contains(focused) ? focused.id : null;
  const caret = focusId && typeof focused.selectionStart === 'number' ? focused.selectionStart : null;

  if (!swap(root, `${toolbar(all, filters)}${body}`)) return;

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
  root.querySelector('#board-clear').addEventListener('click', () => {
    writeFilters({});
    render(root, state);
  });

  wireDrag(root, state);
};

/**
 * Make the cards draggable and the columns droppable, for the markup that was
 * just written.
 *
 * Bound per paint rather than delegated: a paint that changed nothing does not
 * write at all (swap returns false above), so the elements holding these
 * listeners are exactly as long-lived as the listeners are.
 *
 * What is NOT held across paints is the data. A card carries its key, and the
 * issue behind it is looked up when the drop happens — every poll parses a new
 * object graph into the feed, and a quiet poll (unchanged markup, so no repaint
 * and no rebinding) would otherwise leave these handlers holding issue objects
 * nothing draws from any more: the optimistic move would mutate a detached
 * object and the card would sit still until the write came back.
 *
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const wireDrag = (root, state) => {
  const move = async (key, to) => {
    const issue = issueByKey(state, key);
    const request = moveRequest(issue, to);
    if (!request) return;

    // Optimistic: this issue IS the board payload's own, so moving its status
    // moves the card on the repaint below, and the poll that follows keeps it
    // there instead of flickering it back.
    const from = issue.status;
    issue.status = to;
    moveError = null;
    render(root, state);

    const answer = await postIssueStatus(request);
    if (!answer.ok) {
      issue.status = from;
      moveError = answer.reason;
      render(root, state);
      return;
    }

    // The board is polled once a minute and the API caches the sweep for as
    // long: without asking for a fresh one, the next poll would paint the old
    // labels back over a move that actually landed.
    await state.refresh('board');
  };

  for (const card of root.querySelectorAll('[draggable="true"]')) {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.issue);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('omega-tower-issue--dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('omega-tower-issue--dragging'));
  }

  for (const section of root.querySelectorAll('[data-column]')) {
    // A dragover that is not prevented means "not a drop target" — preventing it
    // is how an element says it takes the drop at all.
    section.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      section.classList.add('omega-tower-column--over');
    });
    section.addEventListener('dragleave', () => section.classList.remove('omega-tower-column--over'));
    section.addEventListener('drop', (event) => {
      event.preventDefault();
      section.classList.remove('omega-tower-column--over');
      move(event.dataTransfer.getData('text/plain'), section.dataset.column);
    });
  }
};

export default () => startPage({
  mount: 'tower-board',
  feeds: ['repos', 'board'],
  render,
});
