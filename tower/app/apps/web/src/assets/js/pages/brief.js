//
// Brief - the mornings themselves, readable.
//
// This page used to be a second drawing of the 9am notification: a headline, a
// stat grid, three sparklines, a ranked list and four sections of issues, all
// of it the live board said in other words on other pages. The one thing it
// never showed was the brief - the text the morning was actually written in,
// which could only be read on github.com (issue #181).
//
// So it shows that, and nothing else. The newest published brief is rendered in
// place at the top, and every brief and summary published before it is a card
// under it; clicking one opens the whole text in the dialog, the way clicking an
// issue opens the issue. The charts belong to the Overview, the queue to the
// Board and the warnings to Health, and none of them is drawn twice.
//
// The documents ride the `brief` feed, which is one read of /api/brief. The
// tower reads the home repo's Discussions once and hands over both readings of
// them - the series the Overview charts, and these texts (tower/api/lib/
// documents.js). A PUBLISHED copy has no tower and makes the same read itself,
// off the same board (libs/tower/github.js), so both copies draw this page from
// the same shape.
//
// NOTHING HERE IS NARROWED BY THE REPO SELECTION. A brief is roster-wide - it
// is the morning, not a repo's morning - so the selection has nothing to say
// about it and the page does not pretend otherwise.
//

import omega from '@omega.js/client';
import { startPage } from '../libs/tower/page.js';
import { feed } from '../libs/tower/state.js';
import { esc, empty, problem, loading, card } from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { documentItem, documentBody, mountDocumentModal } from '../libs/tower/modal.js';
import { briefAlert } from '../libs/tower/history.js';

// A published body is remote text, so what turns it into markup escapes first.
// The renderer is the framework's; this page holds the singleton because it
// draws a body IN PLACE as well as in the dialog, and modal.js stays pure
// string functions the suite can ask questions of under Node.
const renderMarkdown = (text) => omega.utilities().renderMarkdown(text);

// The banner above all of it (issue #55, #172): this page is the mornings, and
// the one thing they cannot say for themselves is that the newest of them never
// happened. The cloud brief failed for ten days and the page went on drawing a
// perfectly good board, so when the newest published brief is older than
// yesterday the page leads with the day it last posted. The sentence and the
// level are the lib's, shared with the Health page; the escape is because the
// date came off a Discussion body.
const staleBanner = (payload) => {
  const alert = briefAlert(payload);
  return alert ? `<div class="alert alert-${esc(alert.level)} mb-4">${esc(alert.text)}</div>` : '';
};

// ── This morning ───────────────────────────────────────────────────────────

/** A date as this page says it, or '' when the document carried none. */
const day = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

// The newest brief, open. It is the reason to come here, so it is not a card to
// click - it is the page, with the link to the post itself beside it.
//
// A PLAIN anchor and not the hover-revealed external-link button: that button
// is a card's affordance and is invisible until the card is hovered, which is
// right on a list of forty and wrong on the one document already open.
const latest = (doc) => card(doc.title, `<p class="omega-micro text-body-secondary">
    ${esc([doc.kind, day(doc.createdAt)].filter(Boolean).join(' · '))}
    ${doc.url ? `· <a href="${esc(doc.url)}" target="_blank" rel="noopener">open it on GitHub</a>` : ''}
  </p>
  ${documentBody(doc, renderMarkdown)}`, { class: 'mb-4' });

// ── Everything published before it ─────────────────────────────────────────

// One list, newest first, briefs and summaries interleaved - which is the order
// they were published in and the order an archive is read in. Each card says
// which kind it is, so grouping them would only put a heading between two posts
// written on the same morning.
//
// The newest brief is left OUT of it: it is open above, and a card that opens a
// dialog onto the text already on the page is a second copy of it.
const archive = (documents, drawn) => {
  const rest = documents.filter((doc) => doc !== drawn);
  const body = rest.length
    ? `<ul class="list-unstyled mb-0">${rest.map(documentItem).join('')}</ul>`
    // "Nothing else" is only true when something IS open above it - a board
    // waiting on its first morning has published nothing at all.
    : empty(drawn ? 'nothing else has been published yet' : 'nothing has been published yet', 'fa-regular fa-comments');
  return card('The archive', body, { chip: rest.length, class: 'mb-0' });
};

// The two absences say opposite things, and neither is an empty archive: a copy
// with no home repo, or a read that failed, has nowhere to read the mornings
// from - while a home repo that has published none has an archive that is
// genuinely empty. The first is the `documents` key absent or null, which is
// the posture the history is read with beside it.
const UNREAD = 'the published briefs could not be read, so there is nothing to show here';

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  // The dialog lives in the layout, on every page, but the archive that opens
  // it is on this one - so this is where it is wired. Idempotent: it marks the
  // shell it bound and a second call does nothing, which is what lets a paint
  // that runs on every poll call it.
  mountDocumentModal({ render: renderMarkdown });

  const result = feed(state, 'brief');

  if (!result) {
    swap(root, loading('reading the briefs…'));
    return;
  }
  // A brief that could not be built is the whole page. A quiet morning and a
  // failed sweep are opposite facts, and an empty archive would tell the first
  // story while the second is the true one.
  if (!result.ok) {
    swap(root, problem(result.reason));
    return;
  }

  const payload = result.data;
  const documents = Array.isArray(payload.documents) ? payload.documents : null;

  if (!documents) {
    swap(root, `${staleBanner(payload)}${card('The mornings', empty(UNREAD, 'fa-regular fa-comments'), { class: 'mb-0' })}`);
    return;
  }

  // Newest first is the order the payload carries, so the first brief in it is
  // this morning's.
  const newest = documents.find((doc) => doc.kind === 'brief') || null;

  swap(root, `
    ${staleBanner(payload)}
    ${newest ? latest(newest) : ''}
    ${archive(documents, newest)}
  `);
};

// `repos` is the roster the sidebar's project selector is filled from. This page
// reads nothing out of it - the mornings are roster-wide - but without the feed
// the chrome's selector has no roster to offer while a viewer is standing here.
export default () => startPage({
  mount: 'tower-brief',
  feeds: ['repos', 'brief'],
  render,
});
