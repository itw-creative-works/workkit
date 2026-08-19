//
// Brief - the morning read, in the order a morning asks: the headline, the
// counts, what is waiting on a decision, what is built and waiting on a check,
// what may be started, what is already someone's, and the work sitting on the
// table.
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
// The cards that name a summary (issue #54) hang on the payload's own keys,
// which the COMPOSED brief carries and the browser's does not - the machine's
// side reads the newest daily and, on a Monday, the weekly rollup, while a
// published copy answers the same question with its own summaries card. An
// absent key draws nothing either way.
//

import { startPage } from '../libs/tower/page.js';
import { MODE } from '../libs/tower/api.js';
import { feed } from '../libs/tower/state.js';
import { inScope, selectedSlugs } from '../libs/tower/scope.js';
import {
  esc, num, empty, problem, issueChips, statCell, statgrid, card, LOCAL_ONLY_NOTICE,
} from '../libs/tower/format.js';
import { loading, swap } from '@omega.js/client/modules/live-page';
import { chartSlot, lineChart } from '__main_assets__/js/libs/charts.js';
import { issueItem, externalLink } from '../libs/tower/modal.js';
import {
  entriesOf, hasSeries, unread, seriesOf, ACCRUES, UNREAD,
} from '../libs/tower/history.js';

/** The rows a section shows - narrowed to the selected repos when any are named. */
const forRepo = (items, selected) => items.filter((item) => inScope(selected, item.repo));

// ── The head ───────────────────────────────────────────────────────────────

// When the brief was built, and what the selection has narrowed it to.
//
// The headline is the API's own sentence about the WHOLE roster, and the brief
// and the 9am notification say it in the same words - so a narrowed view does
// not rewrite it, it says which scope it belongs to. Otherwise the largest line
// on the page reads as this repo's and contradicts the lists under it.
const subhead = (payload, selected) => {
  const when = new Date(payload.generatedAt);
  const parts = [];
  if (!Number.isNaN(when.getTime())) parts.push(`built ${when.toLocaleTimeString()}`);
  if (selected.length) parts.push('the headline counts every repo', `everything below it is narrowed to ${selected.join(', ')}`);
  return parts.length ? `<p class="omega-micro text-body-secondary mb-0">${esc(parts.join(' · '))}</p>` : '';
};

const headline = (payload, selected) => `<div class="mb-4">
  <h2 class="mb-2">${esc(payload.headline)}</h2>
  ${subhead(payload, selected)}
</div>`;

const numbers = (payload, lists, selected) => statgrid([
  // `open` and `backlog` are roster-wide totals with no list under them, so a
  // narrowed view cannot restate them: they say unknown rather than a number
  // that would be read as this repo's. The other five ARE the lists on screen.
  statCell('Open', selected.length ? num(null) : payload.counts.open, '/board'),
  statCell('Waiting', lists.waiting.length, '/board'),
  statCell('QA', lists.qa.length, '/board'),
  statCell('Ready', lists.ready.length, '/board'),
  statCell('In flight', lists.inFlight.length, '/board'),
  statCell('Inbox', lists.inbox.length, '/board'),
  statCell('Backlog', selected.length ? num(null) : payload.counts.backlog, '/board'),
]);

// ── The week behind the numbers ────────────────────────────────────────────
//
// Three sparklines under the counts (issue #55): the last seven mornings of the
// open board, what each of them closed, and how deep the inbox got. The history
// is the published briefs read back, so it is ROSTER-wide like the headline -
// a narrowed view does not rewrite it - and it says why it is empty rather than
// drawing an axis with nothing on it.
//
// Small on purpose: these are the shape of a week beside today's numbers, not
// the Overview's charts a second time.
const SPARK_DAYS = 7;
const SPARK_HEIGHT = 80;

const sparkSeries = (payload, key) => {
  const entries = entriesOf(payload);
  return seriesOf(entries.slice(-SPARK_DAYS), key);
};

const SPARKS = [
  ['brief-spark-open', 'open', 'Open'],
  ['brief-spark-closed', 'closedDay', 'Closed a day'],
  ['brief-spark-inbox', 'inbox', 'Inbox'],
];

const sparklines = (payload, selected) => {
  // The history is roster-wide, and under a selection the subhead promises
  // everything below it is narrowed - so the card names its own scope rather
  // than let the page make a false claim about it.
  const title = selected.length ? 'The week behind these numbers (every repo)' : 'The week behind these numbers';
  if (unread(payload)) return card(title, empty(UNREAD, 'fa-regular fa-clock'), { class: 'mb-4' });
  if (!hasSeries(payload)) return card(title, empty(ACCRUES, 'fa-regular fa-clock'), { class: 'mb-4' });
  return card(title, `<div class="row g-3">
    ${SPARKS.map(([id, key, label]) => `<div class="col-12 col-md-4">
      <p class="omega-micro text-body-secondary mb-1">${esc(label)}</p>
      ${chartSlot(id, SPARK_HEIGHT, sparkSeries(payload, key).values)}
    </div>`).join('')}
  </div>`, { class: 'mb-4' });
};

const drawSparklines = (payload) => {
  if (!hasSeries(payload)) return;
  for (const [id, key, label] of SPARKS) {
    const series = sparkSeries(payload, key);
    lineChart(id, { labels: series.labels, series: [{ label, values: series.values }] });
  }
};

// ── The sections ───────────────────────────────────────────────────────────

const issueRow = (issue) => issueItem(issue, `
  <div class="d-flex align-items-start gap-2">
    <span class="flex-grow-1">
      <span class="omega-micro d-block">${esc(issue.repo)} #${esc(issue.number)}</span>
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
  : empty(nothing, 'fa-regular fa-circle-check'), {
  chip: issues.length,
  alarm: Boolean(alarm) && issues.length > 0,
  class: `mb-4${alarm && issues.length ? ' border-danger' : ''}`,
});

// ── What this morning could move ───────────────────────────────────────────

// The board asked one question further (issue #54): per repo, the few open items
// a morning could actually move - decisions first, then the checks waiting on
// the owner, then accepted specs, three at most. The rank is the API's
// (tower/api/lib/brief.js); this only draws it, one short list per repo, so a
// morning reads down its own repo rather than across a merged pile.
// An item that waits says so in the same line the Board's chip says it (#103):
// the short `#N` when the blocker shares the repo, the whole key across repos.
const waitsRef = (key, repo) => (key.toLowerCase().startsWith(`${String(repo).toLowerCase()}#`) ? key.slice(key.lastIndexOf('#')) : key);

const nextRow = (item, repo) => `<li class="py-2 d-flex align-items-start gap-2">
  <span class="flex-grow-1">
    <span class="omega-micro d-block">#${esc(item.number)} · ${esc(item.status || 'open')}${item.priority ? ` · ${esc(item.priority)} priority` : ''}${(item.waitsOn || []).length ? ` · waits on ${esc(item.waitsOn.map((key) => waitsRef(key, repo)).join(', '))}` : ''}</span>
    <span class="d-block">${esc(item.title)}</span>
  </span>
  ${externalLink(item.url)}
</li>`;

const nextRepo = (entry) => `<div class="mb-3">
  <p class="omega-micro text-body-secondary mb-1">${esc(entry.repo)}</p>
  <ul class="list-unstyled mb-0">${(entry.items || []).map((item) => nextRow(item, entry.repo)).join('')}</ul>
</div>`;

const nextUp = (rows) => card('Work on this next', rows.length
  ? `<div class="mb-n3">${rows.map(nextRepo).join('')}</div>`
  : empty('there is nothing waiting on you and nothing specced to start', 'fa-regular fa-circle-check'), {
  chip: rows.reduce((total, entry) => total + (entry.items || []).length, 0),
  class: 'mb-4',
});

// ── Yesterday, and the week ────────────────────────────────────────────────

// The summaries the nightly job publishes, named and linked rather than
// restated: the artifact that recorded the day is the thing worth opening.
// A key that is absent or null draws no card at all - a brief composed where
// Discussions were unreachable says less, never something untrue.
const summaryCard = (heading, item) => (item ? card(heading, `<div class="d-flex align-items-start gap-2">
  <span class="flex-grow-1">
    <span class="omega-micro d-block">${esc(item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '')}</span>
    <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
  </span>
  ${externalLink(item.url)}
</div>`, { class: 'mb-4' }) : '');

// The same three numbers the Health page ranks repos by, as the brief's closing
// line: what is done and not delivered.
const table = (rows) => `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
  <thead><tr><th>repo</th><th class="text-end">uncommitted</th><th class="text-end">unpushed</th><th class="text-end">unreleased</th><th class="text-end">last tag</th></tr></thead>
  <tbody>${rows.map((row) => `<tr>
    <td>${esc(row.repo)}</td>
    <td class="text-end">${esc(row.uncommitted)}</td>
    <td class="text-end">${esc(row.unpushed)}</td>
    <td class="text-end">${esc(row.unreleased)}</td>
    <td class="text-end omega-micro">${esc(row.lastTag || 'never tagged')}</td>
  </tr>`).join('')}</tbody>
</table></div>`;

// The summaries the 9am job publishes as Discussions on the home repo. Only a
// PUBLISHED copy carries them: it reads GitHub itself and can ask for them in
// the same breath as the board, while the local dashboard's brief comes from
// the tower, which composes the morning rather than reading it back. So the
// card exists only when the payload has the section at all.
const summaryRow = (item) => `<li class="py-2 d-flex align-items-start gap-2">
  <span class="flex-grow-1">
    <span class="omega-micro d-block">${esc([item.category, item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · '))}</span>
    <span class="d-block">${esc(item.title)}</span>
  </span>
  ${externalLink(item.url)}
</li>`;

const summaries = (payload) => {
  const read = payload.summaries;
  if (!read) return '';
  let body;
  if (!read.ok) body = empty(read.reason, 'fa-regular fa-comments');
  else if (!read.items.length) body = empty('nothing has been published yet', 'fa-regular fa-comments');
  else body = `<ul class="list-unstyled mb-0">${read.items.map(summaryRow).join('')}</ul>`;
  return card('Published summaries', body, { chip: read.ok ? read.items.length : undefined, class: 'mb-4' });
};

// The one section a published copy cannot answer: uncommitted, unpushed and
// unreleased are read off the working copies on the machine. An empty table
// there would read as the best possible news, so it says where the answer lives
// instead.
//
// Which copy this is comes from `MODE` - the one signal, decided in api.js and
// read the same way on every page. The payload's own shape is not asked: whether
// a brief happens to carry a `summaries` section is a fact about that read, and
// hanging the sentence on it would make an absent key load-bearing.
const warnings = (rows, published) => card('Work sitting on the table', rows.length
  ? table(rows)
  : empty(published ? LOCAL_ONLY_NOTICE : 'nothing is waiting to ship - every repo is committed, pushed and released', published ? 'fa-solid fa-laptop' : 'fa-regular fa-circle-check'), {
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
  const selected = selectedSlugs(state);
  const lists = {
    waiting: forRepo(payload.waiting || [], selected),
    qa: forRepo(payload.qa || [], selected),
    ready: forRepo(payload.ready || [], selected),
    inFlight: forRepo(payload.inFlight || [], selected),
    inbox: forRepo(payload.inbox || [], selected),
  };

  // The charts are drawn only when the markup they live on was written: an
  // unchanged tick leaves the existing canvases - and their instances - alone.
  if (!swap(root, `
    ${headline(payload, selected)}
    ${numbers(payload, lists, selected)}
    ${sparklines(payload, selected)}
    ${nextUp(forRepo(payload.nextUp || [], selected))}
    ${section('Waiting on you', lists.waiting, 'nothing is waiting on you', true)}
    ${section('Waiting on your check', lists.qa, 'nothing is built and waiting on a check')}
    ${section('Ready to start', lists.ready, 'nothing is specced')}
    ${section('In flight', lists.inFlight, 'nothing is being built right now')}
    ${summaryCard('What yesterday produced', payload.findings)}
    ${summaryCard('The week', payload.week)}
    ${summaries(payload)}
    ${warnings(forRepo(payload.warnings || [], selected), MODE === 'github')}
  `)) return;

  drawSparklines(payload);
};

// `repos` is the roster the sidebar's project selector is filled from - the page
// reads no issue data from it, but without it there is no way to narrow the
// brief.
export default () => startPage({
  mount: 'tower-brief',
  feeds: ['repos', 'brief', 'board'],
  charts: true,
  render,
});
