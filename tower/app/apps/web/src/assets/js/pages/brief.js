//
// Brief — the morning read, in the order a morning asks: the headline, the
// counts, what is waiting on a decision, what may be started, what is already
// someone's, and the work sitting on the table.
//
// The payload is one read of /api/brief, which the API assembles from the same
// board sweep and per-repo health every other page reads (tower/api/lib/brief.js).
// The 9am notification sends that same payload, so the page and the message
// tell one story and neither can drift.
//
// It is fetched HERE rather than through the page runtime's feed table: that
// table (libs/tower/page.js) has no `brief` entry and is another agent's file
// today. So this page holds its own answer, re-reads it on the board's cadence,
// and re-renders itself — what the runtime would do for it. The day `brief`
// joins FEEDS, all of that collapses to `feeds: ['brief']` and a render.
//

import { startPage } from '../libs/tower/page.js';
import { fetchFeed } from '../libs/tower/api.js';
import { esc, num, empty, problem, statCell, statgrid, card } from '../libs/tower/format.js';

// The board sweep behind the brief is re-read every 60 seconds, and the brief
// is never fresher than its source.
const EVERY = 60000;

/** The last answer from /api/brief, in `fetchFeed`'s result shape, or null. */
let result = null;

/** Where the page is drawn, kept so a re-read can redraw without a repaint. */
let mounted = null;

const reread = async () => {
  result = await fetchFeed('/api/brief');
  if (mounted) render(mounted.root, mounted.state);
};

/** The rows a section shows — narrowed to the selected repo when there is one. */
const forRepo = (items, selected) => (selected ? items.filter((item) => item.repo === selected) : items);

// ── The head ───────────────────────────────────────────────────────────────

// When the brief was built, and what the selection has narrowed it to.
//
// The headline is the API's own sentence about the WHOLE roster, and the brief
// and the 9am notification say it in the same words — so a narrowed view does
// not rewrite it, it says which scope it belongs to. Otherwise the largest line
// on the page reads as this repo's and contradicts the lists under it.
const subhead = (payload, selected) => {
  const when = new Date(payload.generatedAt);
  const parts = [];
  if (!Number.isNaN(when.getTime())) parts.push(`built ${when.toLocaleTimeString()}`);
  if (selected) parts.push('the headline counts every repo', `everything below it is narrowed to ${selected}`);
  return parts.length ? `<p class="classy-micro text-body-secondary mb-0">${esc(parts.join(' · '))}</p>` : '';
};

const headline = (payload, selected) => `<div class="mb-4">
  <h2 class="mb-2">${esc(payload.headline)}</h2>
  ${subhead(payload, selected)}
</div>`;

const numbers = (payload, lists, selected) => statgrid([
  // `open` and `parked` are roster-wide totals with no list under them, so a
  // narrowed view cannot restate them: they say unknown rather than a number
  // that would be read as this repo's. The other four ARE the lists on screen.
  statCell('Open', selected ? num(null) : payload.counts.open, '/board'),
  statCell('Waiting', lists.waiting.length, '/board'),
  statCell('Ready', lists.ready.length, '/board'),
  statCell('In flight', lists.inFlight.length, '/board'),
  statCell('Inbox', lists.inbox.length, '/board'),
  statCell('Parked', selected ? num(null) : payload.counts.parked, '/board'),
]);

// ── The sections ───────────────────────────────────────────────────────────

const issueRow = (issue) => `<li class="py-2">
  <a class="text-reset text-decoration-none" href="${esc(issue.url)}" target="_blank" rel="noopener">
    <span class="classy-micro d-block">${esc(issue.repo)} #${esc(issue.number)}</span>
    <span class="d-block">${esc(issue.title)}</span>
  </a>
  <span class="d-flex flex-wrap align-items-center gap-1 mt-1">
    ${issue.type ? `<span class="classy-chip">${esc(issue.type)}</span>` : ''}
    ${issue.priority === 'high' ? '<span class="classy-chip classy-chip--accent">high</span>' : ''}
    ${issue.agentOk ? '<span class="classy-chip">agent:ok</span>' : ''}
    ${(issue.assignees || []).length ? `<span class="classy-micro">@${esc(issue.assignees.join(', @'))}</span>` : ''}
  </span>
</li>`;

// A section with nothing in it says the sentence its emptiness means. "Nothing
// is waiting on you" is a morning's best news, and a card drawn empty would
// read as a section that failed to load.
const section = (heading, issues, nothing, alarm) => card(heading, issues.length
  ? `<ul class="list-unstyled mb-0">${issues.map(issueRow).join('')}</ul>`
  : empty(nothing), {
  chip: issues.length,
  alarm: Boolean(alarm) && issues.length > 0,
  class: `mb-4${alarm && issues.length ? ' border-danger' : ''}`,
});

// The same three numbers the Health page ranks repos by, as the brief's closing
// line: what is done and not delivered.
const table = (rows) => `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
  <thead><tr><th>repo</th><th class="text-end">uncommitted</th><th class="text-end">unpushed</th><th class="text-end">unreleased</th><th class="text-end">last tag</th></tr></thead>
  <tbody>${rows.map((row) => `<tr>
    <td>${esc(row.repo)}</td>
    <td class="text-end">${esc(row.uncommitted)}</td>
    <td class="text-end">${esc(row.unpushed)}</td>
    <td class="text-end">${esc(row.unreleased)}</td>
    <td class="text-end classy-micro">${esc(row.lastTag || 'never tagged')}</td>
  </tr>`).join('')}</tbody>
</table></div>`;

const warnings = (rows) => card('Work sitting on the table', rows.length
  ? table(rows)
  : empty('nothing is waiting to ship — every repo is committed, pushed and released'), {
  chip: rows.length,
  alarm: rows.length > 0,
  class: 'mb-0',
});

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  mounted = { root, state };

  // The chrome's Refresh re-reads the runtime's feeds, and this page has none
  // of them, so it hangs its own re-read on the same button. Wired once per
  // button: the chrome rebuilds it on every repaint, a re-read does not.
  const refresh = document.getElementById('tower-refresh');
  if (refresh && !refresh.dataset.briefWired) {
    refresh.dataset.briefWired = 'yes';
    refresh.addEventListener('click', reread);
  }

  if (!result) {
    root.innerHTML = empty('reading the brief…');
    return;
  }
  // A brief that could not be built is the whole page. A quiet morning and a
  // failed sweep are opposite facts, and empty sections would tell the first
  // story while the second is the true one.
  if (!result.ok) {
    root.innerHTML = problem(result.reason);
    return;
  }

  const payload = result.data;
  const selected = state.selectedRepo;
  const lists = {
    waiting: forRepo(payload.waiting || [], selected),
    ready: forRepo(payload.ready || [], selected),
    inFlight: forRepo(payload.inFlight || [], selected),
    inbox: forRepo(payload.inbox || [], selected),
  };

  root.innerHTML = `
    ${headline(payload, selected)}
    ${numbers(payload, lists, selected)}
    ${section('Waiting on you', lists.waiting, 'nothing is waiting on you', true)}
    ${section('Ready to start', lists.ready, 'nothing is specced and unclaimed')}
    ${section('In flight', lists.inFlight, 'nothing is claimed right now')}
    ${warnings(forRepo(payload.warnings || [], selected))}
  `;
};

export default () => {
  reread();
  setInterval(reread, EVERY);
  // `repos` is the roster the chrome's repo selector is built from — the page
  // reads no issue data from it, but without it there is no way to narrow the
  // brief, and the runtime's stamp would never leave "reading…".
  return startPage({
    mount: 'tower-brief',
    feeds: ['repos'],
    render,
  });
};
