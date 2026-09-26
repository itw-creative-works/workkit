// libs/tower/format/values.js: the escaping, the empty, problem and loading
// states, the three notices and the value formatters its siblings import.
// format.js re-exports it whole; no piece imports format.js.

/**
 * HTML-escape a value for interpolation into a template string.
 *
 * EVERY GitHub-sourced value goes through this: issue titles, labels, repo
 * slugs and assignee handles are all attacker-controlled text as far as the
 * tower is concerned, and a hostile title must render as text.
 */
export const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A count that may legitimately be unknown - null renders as a dash, not 0. */
export const num = (value) => (value === null || value === undefined ? '-' : String(value));

/**
 * One "nothing here" state - a muted icon above one line.
 *
 * Quiet on purpose: an empty column and an empty panel are the normal condition
 * of a board that is up to date, so it is drawn in the theme's secondary ink at
 * half opacity and never as an alarm. The icon is the caller's, because "no
 * live sessions" and "nothing is waiting to ship" are different kinds of
 * nothing; the default is the neutral one, and every icon is the framework's
 * Font Awesome, decorative, with the line itself carrying the meaning.
 *
 * `omega-tower-empty` is the sheet's hook for the one thing `text-center`
 * cannot do here: `d-block` makes the glyph's box a BLOCK one em wide, and a
 * block box ignores the text alignment around it (main.scss).
 */
export const empty = (message, icon = 'fa-regular fa-folder-open') => `<div class="omega-tower-empty text-center text-body-secondary py-3">
  <i class="${esc(icon)} fa-lg d-block mb-2 opacity-50" aria-hidden="true"></i>
  <p class="omega-micro mb-0">${esc(message)}</p>
</div>`;

/** The line a page shows where a section would be when its feed did not answer. */
export const problem = (message) => `<div class="alert alert-warning mb-0">${esc(message)}</div>`;

/**
 * The wait state a body or section shows before its feed answers - the ring
 * centered over the space the content will take, its line beneath it.
 *
 * Centered on purpose: the framework's inline
 * loading() sits flush against the top-left corner of a page body, which reads
 * as a misrender rather than a wait. The ring itself is still Bootstrap's
 * `.spinner-border`, animated by the bundle's own keyframes (#137) - this
 * wrapper places it, it never redraws it.
 */
export const loading = (message) => `<div class="d-flex flex-column align-items-center justify-content-center text-center gap-2 py-5 text-body-secondary" role="status">
  <span class="spinner-border" aria-hidden="true"></span>
  <p class="omega-micro mb-0">${esc(message)}</p>
</div>`;

/**
 * What a published copy says where a MACHINE-BOUND surface would be - the crew,
 * the token spend and the per-repo git health are read off transcripts,
 * processes and working copies, and a browser away from that machine has none
 * of them. One sentence, one home, said by the whole page on those three pages
 * and by the single panel on the Overview that shows the same data.
 */
export const LOCAL_ONLY_NOTICE = 'This reads the machine the tower runs on - its sessions, its transcripts, its working copies - so it is local only. Open the dashboard on that machine to see it.';

/** That sentence as markup, in the same muted voice as an empty state. */
export const localOnlyNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_ONLY_NOTICE)}</p>`;

/**
 * What a LOCKED copy says where a write would be. It has no data at all yet, so
 * the answer is "hand this one a token" - and once it has one there is nothing
 * left to say: an unlocked copy files and moves issues with that token exactly
 * as the dashboard on the machine does.
 */
export const LOCKED_NOTICE = 'This copy has no data until a GitHub token is added - add one on the Settings page. With one it files and moves issues just like the dashboard on your machine.';

/** That sentence as markup. */
export const lockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCKED_NOTICE)}</p>`;

/**
 * What a locked copy says where a write would be ON THIS MACHINE (issue #89).
 * A local page has no use for a token - the tower API holds the `gh` login - so
 * the answer is the same one its body gives: the tower is not there to read.
 */
export const LOCAL_LOCKED_NOTICE = 'This copy has no data until the tower API is running - start it with npm run tower and connect this page to it. Then it files and moves issues exactly as it does with a tower.';

/** That sentence as markup. */
export const localLockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_LOCKED_NOTICE)}</p>`;

/**
 * The one name for one issue: `repo#number`.
 *
 * Three things spell it - the `data-issue` attribute a card carries, the dialog
 * registry it is looked up in, and the Board's drop, which reads that attribute
 * off a dragged card and finds the issue in the live board payload. One home for
 * it, so the three cannot mean different things.
 */
export const issueKey = (issue) => `${issue.repo}#${issue.number}`;

/** The last path segment of a repo path - what a session's cwd is shown as. */
export const shortPath = (value) => String(value || '').split('/').filter(Boolean).pop() || String(value || '');

/** 1234567 → "1.23M". Token counts are large and the exact digit never matters. */
export const compact = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

/** A dollar amount, at the precision a per-session cost is actually known to. */
export const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `$${n.toFixed(n >= 10 ? 2 : 3)}`;
};

/**
 * A timestamp as the day it fell on, in the reader's own locale.
 *
 * What a missing or unreadable date leaves behind is the CALLER's, because the
 * two surfaces that draw one want opposite things: a dialog row labelled "filed"
 * has to say something, so it says a dash, while a line that is only a date
 * would rather be absent than be a dash, and passes nothing.
 *
 * @param {string} value - an ISO timestamp off the API
 * @param {string} [fallback] - what to say when there is no date to say
 * @returns {string} plain text, never markup
 */
export const day = (value, fallback = '') => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
};

/**
 * What a published document is, and when it was published - the line above
 * every title.
 *
 * Two surfaces spell it, the archive's cards and the newest brief open at the
 * top of the page, so it is written once here for the reason the body they draw
 * is written once: the same post in two places says one thing about itself.
 *
 * @param {object} doc - one entry of the brief payload's `documents`
 * @returns {string} plain text, never markup
 */
export const documentMeta = (doc) => [doc.kind, day(doc.createdAt)].filter(Boolean).join(' · ');
