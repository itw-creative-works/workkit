//
// Board - every open issue on the roster, in columns by `status:`.
//
// The columns are the status labels, in pipeline order. An open issue carrying
// none of them is not a further place to be - it is a fault the pipeline forbids
// and the daily heal repairs - so it is drawn as the danger alert above the
// board (format.js's `noStatusAlert`), named and linked, and nowhere else: not
// as a card, not in a column count, not in the denominator below (#118).
//
// The filters live in the URL query alongside the chrome's `?repo=`, so a
// filtered board is a link someone else can open. They are read back out of the
// URL on every draw, which also makes the 60-second repaint harmless: the
// toolbar is rebuilt from the URL, not from whatever the DOM last held.
//
// So does which VIEW is on screen (issue #103): the columns, or the dependency
// graph the same issues draw. `?view=graph` is one more thing the URL carries
// and the toolbar reads back, and the repo scope and every filter narrow both
// views identically - the graph is the same board, drawn as arrows. The picture
// itself is composed in `libs/tower/graphdef.js` and drawn by the framework's
// graph module; what is here is the toggle, the slot and the sequencing.
//
// A card is DRAGGED between those columns, and the drop really relabels the
// issue: the payload and the mode gate are api.js's `moveRequest`, the write is
// its `postIssueStatus`, and everything here is what the browser
// contributes - which card was picked up, which column it landed on, and the
// optimistic move that puts it there before the write has answered. A failed
// write puts the card back and says why. A PUBLISHED copy behaves identically:
// the sweep is GitHub's and the browser makes it, and so is the write, with the
// viewer's own token (libs/tower/github.js). The only copy that does not drag is
// the locked one, which never draws its cards - a locked viewer is routed to
// the Settings page instead.
//

import { startPage } from '../libs/tower/page.js';
import { issuesFor, board, feed, issueByKey } from '../libs/tower/state.js';
import { isNone, selectedSlugs } from '../libs/tower/scope.js';
import {
  esc, empty, problem, loading, issueChips, issueKey, STATUSES, statusColor, byPriority, noStatusAlert,
} from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { loadGraph, graphReady, graphSlot, drawGraph } from '__main_assets__/js/libs/graph.js';
import { issueTrigger, externalLink } from '../libs/tower/modal.js';
import { claimGlyph } from '../libs/tower/agent.js';
import { boardGraph } from '../libs/tower/graphdef.js';
import { WRITABLE, MOVABLE_STATUSES, moveRequest, postIssueStatus } from '../libs/tower/api.js';

// The filter names, which are also their URL parameter names. `repo` is not one
// of them - the page chrome owns that globally and every page obeys it, and
// neither is `view`, which is not something a filter clears.
const PARAMS = ['type', 'priority', 'agent', 'assignee', 'q'];

// The two ways this board is drawn. `list` is the default and is written into
// the URL as nothing at all, so a plain `/board` link is the board it always
// was; anything else the query carries reads as the default rather than as an
// empty page.
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

// The view toggle - two real buttons rather than a select, because there are
// two of them and the one in force is worth seeing without opening anything.
// The active one is the filled button and says `aria-pressed`, so what the eye
// reads and what a screen reader is told are the same fact.
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

// A card OPENS the issue in the dialog; GitHub is reached only through the
// button in its corner, which shows while the card is hovered or focused.
//
// Every card is the same size, which takes all three of its rows holding one
// shape: the slug line truncates, the title is clamped to two lines
// (`omega-tower-issue__title`), and the chips stay on one row
// (`omega-tower-issue__chips`) - so the only remaining variation is a short
// title, which the floor on `.omega-tower-board .omega-tower-issue` absorbs
// while `mt-auto` keeps the chips against the bottom edge. Nothing is lost to
// any of it: the card opens the dialog, which says the whole of all three.
//
// The claim indicator is the crew's own glyph, gate and all (agent.claimGlyph):
// what it looks like, when it is earned and what it says to a screen reader are
// one decision, and it is made in the lib the Crew page draws from too.
//
// Every card the board draws carries one of the pipeline statuses, so every
// card is draggable wherever there is something to write with. The card's
// `data-issue` key is what the drop reads back - the same key the dialog
// registry uses, so the two never mean different things.
//
// What the card says about a DEPENDENCY rides that same chip row (issue #103):
// the row is one line and clipped, so a "waits on #12" chip costs the card no
// height at all, where a line of its own would make every blocked card taller
// than its neighbours.
//
// The top row is NAMED because its right end is one slot rather than two: the
// open button is lifted out of the flow into that corner where there is a
// pointer to reveal it with, which is the sheet's job and needs an element to
// position against (main.scss). It is the board card's row alone - the list
// rows the Brief, the Overview and Health draw carry the same `omega-tower-issue`
// class and their button stays in flow.
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

// Every column names a status to move TO, so every one of them takes a drop.
// `pb-2` is the air between the title and the rule under it - the head is a
// flex row and its border sits on the text without it.
const column = (status, issues, showRepo, open) => `<section data-column="${esc(status.key)}">
  <div class="omega-panel-head mb-3 pb-2" style="border-bottom: 2px solid ${statusColor(status.key)};">
    <span>${esc(status.label)}</span>
    <span class="omega-chip">${issues.length}</span>
  </div>
  ${issues.length ? issues.map((issue) => issueCard(issue, showRepo, open)).join('') : empty('nothing here', 'fa-regular fa-square-check')}
</section>`;

// `.omega-tower-board` is the sideways-scrolling strip; how WIDE a column is
// belongs here, because it is a function of how many the pipeline has. At the
// stylesheet's 15rem floor the strip is wider than an ordinary main region,
// which put the right-hand columns half off the edge with only an overlay
// scrollbar to say so. Six columns at 9rem come to the same ~54rem five at 11rem
// did: they fit the main region down to a laptop width, they still stretch to
// fill a wide one, and the strip goes on scrolling when the window is genuinely
// too narrow for the board.
//
// A column reads in three priority bands - high, then the unlabelled middle,
// then low - most recently updated first inside each. The comparator is
// format.js's (`byPriority`), the same module that colours those bands.
const columns = (shown, showRepo, open) => `<div class="omega-tower-board" style="grid-auto-columns: minmax(9rem, 1fr);">
  ${STATUSES.map((status) => column(status, shown.filter((issue) => issue.status === status.key).sort(byPriority), showRepo, open)).join('')}
</div>`;

// The denominator, so a filtered board never reads as an empty one: how many
// are on screen, how many the COLUMNS hold in scope, and how many the filters
// removed. An unlabelled issue is in none of those three numbers - it is drawn
// in the alert above and nowhere else, and counting it here would leave the
// line describing a card that is not on the page.
const counts = (shown, total, selected) => {
  const hidden = total - shown;
  // The scope is a SET (#104): every repo, one of them, or the subset the URL
  // names - and a subset says how many rather than listing them into the line.
  // The none state (#188) is said in words, never as its tilde.
  let scope = 'across every repo';
  if (isNone(selected)) scope = 'with no projects selected';
  else if (selected.length === 1) scope = `in ${esc(selected[0])}`;
  else if (selected.length > 1) scope = `across ${selected.length} repos`;
  const tail = hidden > 0 ? ` - ${hidden} filtered out` : '';
  return `<p class="omega-micro text-body-secondary mb-2">showing ${shown} of ${total} open issue${total === 1 ? '' : 's'} ${scope}${tail}</p>`;
};

// ── The graph view ─────────────────────────────────────────────────────────
//
// The same issues, drawn as what waits on what (issue #103). The definition is
// composed by `libs/tower/graphdef.js` and everything about the picture is
// decided there; the slot, the height floor and the sentence under it are the
// page's.
//
// It is a READING, not a surface: nothing is dragged, opened or filed here, and
// the line under the diagram says so rather than leaving a viewer clicking at
// boxes. The List view is where the board is worked.

/** The height floor the diagram reserves before it has drawn anything. */
const GRAPH_HEIGHT = 420;

const graph = (definition) => (definition
  ? `<div role="img" aria-label="Dependency graph of this board's issues">${graphSlot('board-graph', GRAPH_HEIGHT, definition)}</div>
  <p class="omega-micro text-body-secondary mb-0 mt-2">dashed nodes are off this board · cards open in the List view</p>`
  : empty('nothing on this board waits on anything', 'fa-solid fa-diagram-project'));

/**
 * Draw the composed definition into the slot the paint just wrote.
 *
 * mermaid is a split chunk the framework fetches on demand, so the first paint
 * in this view has no library to draw with and `graphSlot` says so in place of
 * the host. The load is idempotent; when it lands the page draws itself again,
 * which is how every charted page sequences its own (libs/tower/page.js).
 *
 * Draws are SERIALIZED and the newest definition wins: a filter keystroke can
 * re-compose mid-draw, and a slower old render landing last would stand stale
 * forever - swap compares what IT last wrote, so the next poll would never
 * repair the host. And the definition is composed from remote titles, so a
 * shape the sanitizer missed that strict mermaid refuses says so in the host
 * instead of leaving the reserved box blank.
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
  // The board IS the labelled issues. The rest are the alert's, and the toolbar
  // never narrows that: a type filter hiding a pipeline fault would be the
  // comfortable lie a lane for them would tell.
  const labelled = all.filter((issue) => issue.status);
  const filters = readFilters();
  const shown = labelled.filter((issue) => matches(issue, filters));
  const selected = selectedSlugs(state);
  // The repo column is dropped only when every card on the board is from the
  // same repo - one selected slug. A subset still mixes repos and still needs
  // saying which is which.
  const showRepo = selected.length !== 1;
  // A blocker is unsatisfied while the SWEEP is still carrying it, and the sweep
  // is the whole payload rather than the scoped view: an issue waiting on one in
  // a repo the selection hides is still waiting on it (issue #103). Lowercased -
  // the chip's contract - since repo names are case-insensitive on GitHub.
  const sweep = (board(state) || {}).issues || [];
  const open = new Set(sweep.map((issue) => issueKey(issue).toLowerCase()));
  const view = readView();

  // Composed once and used twice: the markup carries the definition as the
  // stamp `swap` compares on, and the draw below takes it as its text.
  let definition = '';
  let body;
  if (!result) body = loading('reading the board…');
  else if (!result.ok) body = problem(result.reason);
  else if (!board(state)) body = empty('the board answered with nothing', 'fa-regular fa-rectangle-list');
  else {
    if (view === 'graph') definition = boardGraph(shown, sweep);
    const drawn = view === 'graph' ? graph(definition) : columns(shown, showRepo, open);
    body = `${moveError ? problem(moveError) : ''}${noStatusAlert(all, showRepo)}${counts(shown.length, labelled.length, selected)}${drawn}`;
  }

  // The page repaints every poll, and a repaint must not take the caret out of
  // the search box mid-word - so where the focus was is put back where it goes.
  // A poll that changed nothing does not write at all (swap), and then there is
  // nothing to restore.
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
  // `input` covers both the search box and the selects, so one listener on the
  // form is the whole toolbar - and every control is always in the markup.
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

  // Only ever after a write: `swap` returned above when the markup - the
  // definition stamp included - was the one already on the page, so the
  // 60-second repaint leaves an unchanged diagram standing rather than
  // rendering the same picture again.
  if (view === 'graph' && definition) paintGraph(root, state, definition);
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
 * issue behind it is looked up when the drop happens - every poll parses a new
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
    // A dragover that is not prevented means "not a drop target" - preventing it
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
