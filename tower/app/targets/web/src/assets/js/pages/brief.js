// Brief: the mornings themselves, the newest brief open and the archive under
// it (tower/README.md § The pages). Its documents ride the `brief` feed. A brief
// is roster-wide, so nothing here is narrowed by the repo selection.

import omega from '@omega.js/client';
import { startPage } from '../libs/tower/page.js';
import { feed } from '../libs/tower/state.js';
import { esc, empty, problem, loading, card, documentMeta } from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { documentItem, documentBody, mountDocumentModal } from '../libs/tower/modal.js';
import { briefAlert, unreadLine } from '../libs/tower/history.js';

// This page holds the singleton because it draws a body in place as well as in
// the dialog; modal.js stays pure string functions the suite runs under Node.
const renderMarkdown = (text) => omega.utilities().renderMarkdown(text);

// Leads with the day the brief last posted when that is older than yesterday.
// The date came off a Discussion body, hence the escape.
const staleBanner = (payload) => {
  const alert = briefAlert(payload);
  return alert ? `<div class="alert alert-${esc(alert.level)} mb-4">${esc(alert.text)}</div>` : '';
};

// ── This morning ───────────────────────────────────────────────────────────

// The newest brief, open. A plain anchor, not the hover-revealed button: that
// is a card's affordance, wrong on the one document already open.
const latest = (doc) => card(doc.title, `<p class="omega-micro text-body-secondary">
    ${esc(documentMeta(doc))}
    ${doc.url ? `· <a href="${esc(doc.url)}" target="_blank" rel="noopener">open it on GitHub</a>` : ''}
  </p>
  ${documentBody(doc, renderMarkdown)}`, { class: 'mb-4' });

// ── Everything published before it ─────────────────────────────────────────

// One list, newest first, briefs and summaries interleaved. The newest brief is
// left out: it is open above.
const archive = (documents, drawn) => {
  const rest = documents.filter((doc) => doc !== drawn);
  const body = rest.length
    ? `<ul class="list-unstyled mb-0">${rest.map(documentItem).join('')}</ul>`
    // "Nothing else" is only true when something is open above it.
    : empty(drawn ? 'nothing else has been published yet' : 'nothing has been published yet', 'fa-regular fa-comments');
  return card('The archive', body, { chip: rest.length, class: 'mb-0' });
};

// An absent or null `documents` means the mornings could not be read, never an
// empty archive; a reason the read carried is appended to this line.
const UNREAD = 'the published briefs could not be read, so there is nothing to show here';

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  // Wired here, where the archive that opens it is; idempotent, so every paint
  // may call it.
  mountDocumentModal({ render: renderMarkdown });

  const result = feed(state, 'brief');

  if (!result) {
    swap(root, loading('reading the briefs…'));
    return;
  }
  // A failed brief is the whole page: an empty archive would read as a quiet
  // morning.
  if (!result.ok) {
    swap(root, problem(result.reason));
    return;
  }

  const payload = result.data;
  const documents = Array.isArray(payload.documents) ? payload.documents : null;

  if (!documents) {
    swap(root, `${staleBanner(payload)}${card('The mornings', empty(unreadLine(UNREAD, payload), 'fa-regular fa-comments'), { class: 'mb-0' })}`);
    return;
  }

  // The payload is newest first.
  const newest = documents.find((doc) => doc.kind === 'brief') || null;

  swap(root, `
    ${staleBanner(payload)}
    ${newest ? latest(newest) : ''}
    ${archive(documents, newest)}
  `);
};

// `repos` feeds only the sidebar's project selector.
export default () => startPage({
  mount: 'tower-brief',
  feeds: ['repos', 'brief'],
  render,
});
