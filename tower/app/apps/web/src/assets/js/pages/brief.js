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
// `brief` is one of the runtime's feeds, so the poll cadence and the chrome's
// Refresh both reach it the same way every other page's data is reached.
//
// A PUBLISHED copy has no tower and builds the same payload in the browser off
// its own GitHub sweep (libs/tower/github.js), with two differences this page
// draws: the summaries published as Discussions on the home repo, which only
// that side can read, and no warnings, which only the machine can answer.
//

import { startPage } from '../libs/tower/page.js';
import { MODE } from '../libs/tower/api.js';
import { feed } from '../libs/tower/state.js';
import {
  esc, num, empty, problem, issueChips, statCell, statgrid, card, LOCAL_ONLY_NOTICE,
} from '../libs/tower/format.js';
import { loading, swap } from '@omega.js/client/modules/live-page';
import { issueItem, externalLink } from '../libs/tower/modal.js';

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

const issueRow = (issue) => issueItem(issue, `
  <div class="d-flex align-items-start gap-2">
    <span class="flex-grow-1">
      <span class="classy-micro d-block">${esc(issue.repo)} #${esc(issue.number)}</span>
      <span class="d-block">${esc(issue.title)}</span>
    </span>
    ${externalLink(issue.url)}
  </div>
  ${issueChips(issue, 'mt-1')}
`, { inner: 'py-2' });

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

// The summaries the 9am job publishes as Discussions on the home repo. Only a
// PUBLISHED copy carries them: it reads GitHub itself and can ask for them in
// the same breath as the board, while the local dashboard's brief comes from
// the tower, which composes the morning rather than reading it back. So the
// card exists only when the payload has the section at all.
const summaryRow = (item) => `<li class="py-2 d-flex align-items-start gap-2">
  <span class="flex-grow-1">
    <span class="classy-micro d-block">${esc([item.category, item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · '))}</span>
    <span class="d-block">${esc(item.title)}</span>
  </span>
  ${externalLink(item.url)}
</li>`;

const summaries = (payload) => {
  const read = payload.summaries;
  if (!read) return '';
  let body;
  if (!read.ok) body = empty(read.reason);
  else if (!read.items.length) body = empty('nothing has been published yet');
  else body = `<ul class="list-unstyled mb-0">${read.items.map(summaryRow).join('')}</ul>`;
  return card('Published summaries', body, { chip: read.ok ? read.items.length : undefined, class: 'mb-4' });
};

// The one section a published copy cannot answer: uncommitted, unpushed and
// unreleased are read off the working copies on the machine. An empty table
// there would read as the best possible news, so it says where the answer lives
// instead.
//
// Which copy this is comes from `MODE` — the one signal, decided in api.js and
// read the same way on every page. The payload's own shape is not asked: whether
// a brief happens to carry a `summaries` section is a fact about that read, and
// hanging the sentence on it would make an absent key load-bearing.
const warnings = (rows, published) => card('Work sitting on the table', rows.length
  ? table(rows)
  : empty(published ? LOCAL_ONLY_NOTICE : 'nothing is waiting to ship — every repo is committed, pushed and released'), {
  chip: published ? undefined : rows.length,
  alarm: rows.length > 0,
  class: 'mb-0',
});

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const result = feed(state, 'brief');

  if (!result) {
    swap(root, loading('reading the brief…'));
    return;
  }
  // A brief that could not be built is the whole page. A quiet morning and a
  // failed sweep are opposite facts, and empty sections would tell the first
  // story while the second is the true one.
  if (!result.ok) {
    swap(root, problem(result.reason));
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

  swap(root, `
    ${headline(payload, selected)}
    ${numbers(payload, lists, selected)}
    ${section('Waiting on you', lists.waiting, 'nothing is waiting on you', true)}
    ${section('Ready to start', lists.ready, 'nothing is specced and unclaimed')}
    ${section('In flight', lists.inFlight, 'nothing is claimed right now')}
    ${summaries(payload)}
    ${warnings(forRepo(payload.warnings || [], selected), MODE === 'github')}
  `);
};

// `repos` is the roster the chrome's repo selector is built from — the page
// reads no issue data from it, but without it there is no way to narrow the
// brief.
export default () => startPage({
  mount: 'tower-brief',
  feeds: ['repos', 'brief'],
  render,
});
