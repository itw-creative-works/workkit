// Board: every open issue on the roster, in columns by `status:`, or as the
// dependency graph (tower/README.md § The pages). The filters and the view live
// in the URL, read back on every draw, so a filtered board is a shareable link
// and a repaint is harmless. The drag's payload and write are api.js's.

import { startPage } from '../libs/tower/page.js';
import { issuesFor, board, feed, issueByKey } from '../libs/tower/state.js';
import { selectedSlugs } from '../libs/tower/scope.js';
import {
  esc, empty, problem, loading, issueChips, issueKey, STATUSES, statusColor, chipGlyph, byPriority, noStatusAlert,
} from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { loadGraph, graphReady, graphSlot, drawGraph } from '__main_assets__/js/libs/graph.js';
import { issueTrigger, externalLink } from '../libs/tower/modal.js';
import { claimGlyph } from '../libs/tower/agent.js';
import { boardGraph } from '../libs/tower/graphdef.js';
import { WRITABLE, MOVABLE_STATUSES, moveRequest, postIssueStatus } from '../libs/tower/api.js';

// The filter names, which are also their URL parameter names. `repo` is the
// chrome's, and `view` is not something a filter clears.
const PARAMS = ['type', 'priority', 'agent', 'assignee', 'q'];

// `list` is the default, written into the URL as nothing at all; an unknown
// value reads as the default rather than an empty page.
const VIEWS = ['list', 'graph'];

const readView = () => {
  const value = new URL(location.href).searchParams.get('view') || '';
  return VIEWS.includes(value) ? value : 'list';
};

const writeView = (view) => {
  const url = new URL(location.href);
  if (view && view !== 'list') url.searchParams.set('view', view);
  else url.searchParams.delete('view');
  history.replaceState(null, '', url);
};

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
  <span class="omega-micro d-block">${esc(label)}</span>
  <select class="form-select form-select-sm" id="${esc(id)}" data-filter="${esc(id.replace('board-', ''))}">
    <option value="">any</option>
    ${values.map((value) => `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(value)}</option>`).join('')}
  </select>
</label>`;

// Two buttons, not a select, so the view in force shows without opening
// anything; `aria-pressed` tells a screen reader what the fill tells the eye.
const viewToggle = (view) => `<span class="btn-group btn-group-sm" role="group" aria-label="Board view">
    ${VIEWS.map((name) => `<button class="btn btn-sm btn-${view === name ? '' : 'outline-'}adaptive" type="button" data-view="${name}" aria-pressed="${view === name}">${name === 'list' ? 'List' : 'Graph'}</button>`).join('')}
  </span>`;

const toolbar = (issues, filters, view) => `<form class="d-flex flex-wrap align-items-end gap-2 mb-3" id="board-filters" onsubmit="return false">
  <label class="flex-grow-1">
    <span class="omega-micro d-block">Search</span>
    <input class="form-control form-control-sm" type="search" id="board-q" data-filter="q" value="${esc(filters.q)}" placeholder="title or number" aria-label="Search titles and numbers">
  </label>
  ${select('board-type', 'Type', filters.type, optionsFrom(issues, (issue) => [issue.type]))}
  ${select('board-priority', 'Priority', filters.priority, optionsFrom(issues, (issue) => [issue.priority]))}
  ${select('board-assignee', 'Assignee', filters.assignee, optionsFrom(issues, (issue) => issue.assignees || []))}
  <label>
    <span class="omega-micro d-block">Agent</span>
    <select class="form-select form-select-sm" id="board-agent" data-filter="agent">
      <option value="">any</option>
      <option value="ok"${filters.agent === 'ok' ? ' selected' : ''}>agent:ok</option>
    </select>
  </label>
  <button class="btn btn-sm btn-outline-adaptive" type="button" id="board-clear">Clear filters</button>
  <div>
    <span class="omega-micro d-block">View</span>
    ${viewToggle(view)}
  </div>
</form>`;

/** Whether this card may be picked up - something to write with, and a status to move from. */
const draggable = (issue) => WRITABLE && MOVABLE_STATUSES.includes(issue.status);

// One size per card: slug truncated, title clamped, chips (dependencies
// included) on one row. `data-issue` is the dialog registry's key, read back by
// the drop. The named top row is what main.scss positions the open button
// against; the list rows elsewhere keep theirs in flow.
const issueCard = (issue, showRepo, open) => `<div class="card omega-tower-issue omega-interactive omega-interactive--lift mb-2${issue.status === 'blocked' ? ' border-danger' : ''}"${draggable(issue) ? ' draggable="true"' : ''} ${issueTrigger(issue)}>
  <div class="card-body p-3 d-flex flex-column">
    <div class="d-flex align-items-start gap-2 omega-tower-issue__top">
      <span class="omega-micro d-block flex-grow-1 text-truncate">${showRepo ? `${esc(issue.repo)} ` : ''}#${esc(issue.number)}</span>
      ${claimGlyph(issue)}
      ${externalLink(issue.url)}
    </div>
    <span class="mb-2 omega-tower-issue__title">${esc(issue.title)}</span>
    ${issueChips(issue, 'mt-auto omega-tower-issue__chips', open)}
  </div>
</div>`;

// Every column takes a drop. `pb-2` keeps the head's border off its text.
const column = (status, issues, showRepo, open) => `<section data-column="${esc(status.key)}">
  <div class="omega-panel-head mb-3 pb-2" style="border-bottom: 2px solid ${statusColor(status.key)};">
    <span>${chipGlyph(status.key)}${esc(status.label)}</span>
    <span class="omega-chip">${issues.length}</span>
  </div>
  ${issues.length ? issues.map((issue) => issueCard(issue, showRepo, open)).join('') : empty('nothing here', 'fa-regular fa-square-check')}
</section>`;

// A group of lanes, each a cell of the one strip below. No caption: the
// pocket's aria-label and divider say it.
const lanes = (statuses, shown, showRepo, open) => statuses.map((status) => column(status, shown.filter((issue) => issue.status === status.key).sort(byPriority), showRepo, open)).join('');

// One grid, so every lane is one width; the pocket borrows its tracks back
// through `subgrid` to stay a landmark. The split is the vocabulary's `pocket`
// flag, and the two counts go to the stylesheet as custom properties.
const columns = (shown, showRepo, open) => {
  const pipeline = STATUSES.filter((status) => !status.pocket);
  const pocket = STATUSES.filter((status) => status.pocket);
  return `<div class="omega-tower-board" style="--pipeline: ${pipeline.length}; --pocket: ${pocket.length};">
  <div class="omega-tower-group omega-tower-group--pipeline">
    ${lanes(pipeline, shown, showRepo, open)}
  </div>
  <aside class="omega-tower-group omega-tower-group--pocket" aria-label="Waiting - not stages of the pipeline">
    ${lanes(pocket, shown, showRepo, open)}
  </aside>
</div>`;
};

// An unlabelled issue is in neither number: it is the alert's alone.
const counts = (shown, total) => `<p class="omega-micro text-body-secondary mb-2">showing ${shown} out of ${total}</p>`;

// ── The graph view ─────────────────────────────────────────────────────────
// The picture is `libs/tower/graphdef.js`'s; the slot, the height floor and the
// line saying the List view is where the board is worked are the page's.

/** The height floor the diagram reserves before it has drawn anything. */
const GRAPH_HEIGHT = 420;

const graph = (definition) => (definition
  ? `<div role="img" aria-label="Dependency graph of this board's issues">${graphSlot('board-graph', GRAPH_HEIGHT, definition)}</div>
  <p class="omega-micro text-body-secondary mb-0 mt-2">dashed nodes are off this board · cards open in the List view</p>`
  : empty('nothing on this board waits on anything', 'fa-solid fa-diagram-project'));

/**
 * Draw the composed definition into the slot the paint just wrote.
 *
 * mermaid loads on demand; when it lands the page draws itself again.
 *
 * Draws are serialized and the newest definition wins: a slower old render
 * landing last would stand stale, since swap compares only what it last wrote.
 * A definition strict mermaid refuses says so in the host.
 */
let drawing = Promise.resolve();
let queuedDefinition = null;

const paintGraph = (root, state, definition) => {
  if (!graphReady()) {
    loadGraph().then((ok) => { if (ok) render(root, state); });
    return;
  }
  queuedDefinition = definition;
  drawing = drawing.then(() => {
    const next = queuedDefinition;
    if (next === null) return null;
    queuedDefinition = null;
    return drawGraph('board-graph', next).catch(() => {
      const host = document.getElementById('board-graph');
      if (!host) return;
      host.innerHTML = problem('the diagram could not be drawn');
      // The wrapper's image role makes its contents presentational - right for
      // an SVG, wrong for this message, which must be announced.
      const wrap = host.parentElement;
      if (wrap && wrap.getAttribute('role') === 'img') {
        wrap.removeAttribute('role');
        wrap.removeAttribute('aria-label');
      }
    });
  });
};

// Outside render, so a repaint before the next drop keeps the explanation.
let moveError = null;

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const result = feed(state, 'board');
  const all = issuesFor(state);
  // The unlabelled are the alert's, and no filter narrows that.
  const labelled = all.filter((issue) => issue.status);
  const filters = readFilters();
  const shown = labelled.filter((issue) => matches(issue, filters));
  const selected = selectedSlugs(state);
  const showRepo = selected.length !== 1;
  // The whole sweep, not the scoped view: a blocker in a hidden repo still
  // blocks. Lowercased, since GitHub repo names are case-insensitive.
  const sweep = (board(state) || {}).issues || [];
  const open = new Set(sweep.map((issue) => issueKey(issue).toLowerCase()));
  const view = readView();

  // Used twice: the stamp `swap` compares on, and the text the draw takes.
  let definition = '';
  let body;
  if (!result) body = loading('reading the board…');
  else if (!result.ok) body = problem(result.reason);
  else if (!board(state)) body = empty('the board answered with nothing', 'fa-regular fa-rectangle-list');
  else {
    if (view === 'graph') definition = boardGraph(shown, sweep);
    const drawn = view === 'graph' ? graph(definition) : columns(shown, showRepo, open);
    body = `${moveError ? problem(moveError) : ''}${noStatusAlert(all, showRepo)}${counts(shown.length, labelled.length)}${drawn}`;
  }

  // A repaint must not take the caret out of the search box mid-word.
  const focused = document.activeElement;
  const focusId = focused && root.contains(focused) ? focused.id : null;
  const caret = focusId && typeof focused.selectionStart === 'number' ? focused.selectionStart : null;

  if (!swap(root, `${toolbar(labelled, filters, view)}${body}`)) return;

  if (focusId) {
    const again = root.querySelector(`#${focusId}`);
    if (again) {
      again.focus();
      if (caret !== null && typeof again.setSelectionRange === 'function') again.setSelectionRange(caret, caret);
    }
  }

  const form = root.querySelector('#board-filters');
  // `input` covers the search box and the selects alike.
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
  for (const button of form.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      writeView(button.dataset.view);
      render(root, state);
    });
  }

  wireDrag(root, state);

  // Only after a write: an unchanged diagram is left standing.
  if (view === 'graph' && definition) paintGraph(root, state, definition);
};

/**
 * Make the cards draggable and the columns droppable, for the markup that was
 * just written.
 *
 * Bound per paint, since an unchanged paint writes nothing. The issue is looked
 * up by key at drop time: a quiet poll swaps the feed's objects without a
 * rebind, and a held one would be detached.
 *
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const wireDrag = (root, state) => {
  const move = async (key, to) => {
    const issue = issueByKey(state, key);
    const request = moveRequest(issue, to);
    if (!request) return;

    // Optimistic: this is the payload's own issue, so the next poll keeps it.
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

    // Without a fresh sweep the next poll paints the cached old labels back.
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
    // Preventing dragover is how an element takes the drop.
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
