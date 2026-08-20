//
// The mornings themselves — every brief and every summary the home repo has
// published, whole.
//
// `history.js` reads the same board and keeps the NUMBERS a morning recorded;
// this keeps the TEXT it was written in (issue #181). The Brief page is the one
// consumer: it renders the newest brief in place and lists the rest as an
// archive, so the one thing the dashboard could never show — the brief itself —
// is what the page is.
//
// PURE. The round trip is `history.js`'s `readDiscussions`, and both readings
// are made from that one answer: asking twice would be two round trips for a
// single read of a single board.
//
// TWO KINDS, decided by the TITLE, which is the same question `history.js` and
// `summaries.js` ask of the same board: `brief: <date>` is a morning, and
// anything else published there is a summary. The title is what the jobs write;
// the category is negotiable and answers differently on every home repo.
//
// THE BODY IS CARRIED WHOLE, minus its machine markers. A brief's stats line
// and the news cursor beside it are HTML comments — invisible where GitHub
// renders the post, and literal text in a browser renderer that escapes before
// it renders — so they come off here rather than in each of the two pages that
// would otherwise have to know about them.
//
// Usage:
//   const { documentsFrom } = require('./documents');
//   documentsFrom(readDiscussions(opts));   // newest first
//

const { BRIEF_TITLE_PREFIX } = require('./history');

/**
 * How many documents the archive carries. The read window is a hundred
 * Discussions and the briefs share it with the summaries, so this is the cap on
 * what the PAYLOAD carries rather than on what was read: about a month of
 * mornings and the summaries published beside them, which is as far back as an
 * archive is read in practice, and short enough that the bodies stay a payload
 * rather than a download.
 */
const DOCUMENT_LIMIT = 40;

/** The machine markers a published body carries — every HTML comment in it. */
const MARKER_RE = /<!--[\s\S]*?-->/g;

/**
 * One published body as a reader sees it: the markers stripped, and the blank
 * lines they left with them.
 *
 * @param {string} body the Discussion body
 * @returns {string}
 */
const readable = (body) => String(body || '')
  .replace(MARKER_RE, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Every published document, newest first.
 *
 * Newest first because that is the order an archive is read in, and the
 * opposite of the series `history.js` returns — which is ascending because a
 * chart draws that way. Neither order is the other's, so neither is derived
 * from the other.
 *
 * @param {Array<{title: string, url: string, createdAt: string|null, body: string}>} nodes
 *   what readDiscussions returned
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
