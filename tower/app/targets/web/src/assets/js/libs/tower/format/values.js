// libs/tower/format/values.js: the escaping, the empty, problem and loading
// states, the three notices and the value formatters its siblings import.
// format.js re-exports it whole; no piece imports format.js.

/**
 * HTML-escape a value for interpolation into a template string. Every
 * GitHub-sourced value goes through this: a hostile title must render as text.
 */
export const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A count that may legitimately be unknown - null renders as a dash, not 0. */
export const num = (value) => (value === null || value === undefined ? '-' : String(value));

/**
 * One "nothing here" state: a muted icon above one line, quiet because an empty
 * column is the normal state of an up-to-date board. `omega-tower-empty` is the
 * sheet's hook: the `d-block` glyph ignores `text-center` (main.scss).
 */
export const empty = (message, icon = 'fa-regular fa-folder-open') => `<div class="omega-tower-empty text-center text-body-secondary py-3">
  <i class="${esc(icon)} fa-lg d-block mb-2 opacity-50" aria-hidden="true"></i>
  <p class="omega-micro mb-0">${esc(message)}</p>
</div>`;

/** The line a page shows where a section would be when its feed did not answer. */
export const problem = (message) => `<div class="alert alert-warning mb-0">${esc(message)}</div>`;

/**
 * The wait state a body or section shows before its feed answers: Bootstrap's
 * ring centered over the space the content will take, its line beneath it,
 * since the framework's inline loading() sits flush top-left like a misrender.
 */
export const loading = (message) => `<div class="d-flex flex-column align-items-center justify-content-center text-center gap-2 py-5 text-body-secondary" role="status">
  <span class="spinner-border" aria-hidden="true"></span>
  <p class="omega-micro mb-0">${esc(message)}</p>
</div>`;

/**
 * What a published copy says where a machine-bound surface would be (the crew,
 * the spend, the git health): one sentence for the three pages and the Overview
 * panel that show that data.
 */
export const LOCAL_ONLY_NOTICE = 'This reads the machine Workkit runs on - its sessions, its transcripts, its working copies - so it is local only. Open the dashboard on that machine to see it.';

/** That sentence as markup, in the same muted voice as an empty state. */
export const localOnlyNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_ONLY_NOTICE)}</p>`;

/**
 * What a locked copy says where a write would be: hand it a token, and it files
 * and moves issues as the dashboard on the machine does.
 */
export const LOCKED_NOTICE = 'This copy has no data until a GitHub token is added - add one on the Settings page. With one it files and moves issues just like the dashboard on your machine.';

/** That sentence as markup. */
export const lockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCKED_NOTICE)}</p>`;

/**
 * What a locked copy says where a write would be on this machine: the tower API
 * holds the `gh` login, so the answer is the one its body gives.
 */
export const LOCAL_LOCKED_NOTICE = 'This copy has no data until the Workkit API is running - start it with npm run tower and connect this page to it. Then it files and moves issues exactly as a connected copy does.';

/** That sentence as markup. */
export const localLockedNotice = () => `<p class="text-body-secondary mb-0">${esc(LOCAL_LOCKED_NOTICE)}</p>`;

/**
 * The one name for one issue, `repo#number`: the card's `data-issue`, the
 * dialog registry and the Board's drop all spell it through here.
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
 * A timestamp as the day it fell on, in the reader's own locale. What a missing
 * date leaves is the caller's: a dialog row says a dash, a date-only line would
 * rather be absent.
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
 * What a published document is, and when it was published: the line above
 * every title, on the archive's cards and the newest brief alike.
 *
 * @param {object} doc - one entry of the brief payload's `documents`
 * @returns {string} plain text, never markup
 */
export const documentMeta = (doc) => [doc.kind, day(doc.createdAt)].filter(Boolean).join(' · ');
