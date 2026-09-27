// The mornings themselves: every brief and summary the home repo published,
// whole, for the Brief page's archive (tower/README.md § The pages). Pure: the
// round trip is history.js's `readDiscussions`. The kind comes from the title,
// and the HTML-comment markers come off here, so no page has to know them.
//
// Usage:
//   documentsFrom(readDiscussions(opts).nodes);   // newest first

const { BRIEF_TITLE_PREFIX } = require('./history');

/**
 * How many documents the payload carries (the read window is wider): about a
 * month of mornings and their summaries, short enough to stay a payload.
 */
const DOCUMENT_LIMIT = 40;

/** The machine markers a published body carries: every HTML comment in it. */
const MARKER_RE = /<!--[\s\S]*?-->/g;

/**
 * One published body as a reader sees it: the markers stripped, and the blank
 * lines they left with them.
 * @param {string} body the Discussion body
 * @returns {string}
 */
const readable = (body) => String(body || '')
  .replace(MARKER_RE, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Every published document, newest first: the order an archive is read in.
 * @param {Array<{title: string, url: string, createdAt: string|null, body: string}>} nodes
 *   the `nodes` readDiscussions returned
 * @returns {Array<{kind: string, title: string, url: string, createdAt: string|null, body: string}>}
 */
const documentsFrom = (nodes) => (nodes || [])
  .filter((node) => node.title)
  .slice(0, DOCUMENT_LIMIT)
  .map((node) => ({
    kind: node.title.startsWith(BRIEF_TITLE_PREFIX) ? 'brief' : 'summary',
    title: node.title,
    url: node.url || '',
    createdAt: node.createdAt || null,
    body: readable(node.body),
  }));

module.exports = { documentsFrom, readable, DOCUMENT_LIMIT };
