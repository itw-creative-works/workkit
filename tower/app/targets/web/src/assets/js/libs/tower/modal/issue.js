// libs/tower/modal/issue.js: the issue dialog: the registry, the triggers, the
// external link, what an issue depends on, and the delegated opener its siblings
// import. modal.js re-exports it by name; no piece imports modal.js.

import { esc, issueChips, statusChip, issueKey, day } from '../format.js';

/** The issues the current markup can open, keyed `repo#number`. */
const registry = new Map();

// The key an issue is registered and looked up under is format.js's `issueKey`,
// the same one the Board's drop reads back off a dragged card.

/**
 * The attributes that make an element open the issue dialog.
 *
 * Registering happens HERE, as the markup is written, because the issue object
 * and its markup are made in the same breath - a page never has to keep a
 * second copy of its own list for the dialog to read.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @returns {string} attributes to interpolate into the element's tag
 */
export const issueTrigger = (issue) => {
  const key = issueKey(issue);
  registry.set(key, issue);
  return `data-issue="${esc(key)}" role="button" tabindex="0"`;
};

/**
 * One issue as a list item - the shape three pages draw it in.
 *
 * The interactive semantics sit on the INNER element, never on the `<li>`: an
 * `<li>` given `role="button"` stops being a list item, and a screen reader
 * loses the list - how many issues there are and which one it is on. The `<li>`
 * keeps `omega-tower-issue` (what the stylesheet reveals the external link
 * from, through `:hover` and `:focus-within`, which reach the inner element
 * either way) and stays bare; the inner div takes the click target's
 * `omega-interactive`, its layout AND spacing classes, and the trigger
 * attributes - padding on the `<li>` would leave a strip of row the hover
 * tint and the click never cover (issue #42's review, browser-verified).
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @param {string} body - the item's content markup
 * @param {object} [classes]
 * @param {string} [classes.item] - extra classes for the `<li>` (rarely needed - spacing belongs on `inner`)
 * @param {string} [classes.inner] - classes for the interactive element (its layout and spacing)
 * @returns {string} markup
 */
export const issueItem = (issue, body, { item = '', inner = '' } = {}) => `<li class="omega-tower-issue${item ? ` ${item}` : ''}">
  <div class="omega-interactive${inner ? ` ${inner}` : ''}" ${issueTrigger(issue)}>${body}</div>
</li>`;

/**
 * The one external-link button: a box with an arrow leaving it, opening the
 * GitHub page in a new tab.
 *
 * `omega-tower-external` is what the stylesheet hides until a card is hovered
 * or focused; in the dialog it is passed no extra class and simply shows.
 *
 * The glyph is plain Font Awesome markup - the framework's shared renderer
 * watches for inserted elements and draws it, which is what makes it work in
 * markup this file writes long after the page booted. The anchor carries the
 * label, so the icon itself is hidden from the accessibility tree.
 *
 * @param {string} url - the GitHub issue URL
 * @param {string} [extraClass] - layout classes the caller's context needs
 * @returns {string} markup
 */
export const externalLink = (url, extraClass = '') => `<a class="omega-tower-external${extraClass ? ` ${extraClass}` : ''}" href="${esc(url)}" target="_blank" rel="noopener" title="Open on GitHub" aria-label="Open on GitHub">
  <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
</a>`;

//
// ── What an issue depends on ───────────────────────────────────────────────
//
// The Board's cards say what an issue is WAITING on (issue #103); the dialog is
// where the issue is actually read, and it says both halves of the edge (#127):
// what it waits on, and what is waiting on IT.
//
// Both come off the board payload already in memory - the same sweep the cards
// judge a "waits on" chip against - so nothing is fetched and nothing is stored.
// The inverse direction is read at the moment the dialog opens, by asking which
// issues on that board name this one as a blocker; keeping it anywhere would be
// a second copy of an edge the sweep already carries.
//
// A blocker the board is no longer holding is SATISFIED and drawn nowhere, which
// is `waitsOnChips`'s rule and may not be answered here a second way: closed
// issues leave the sweep, so being in it is the whole of the question.
//

/** The board payload the open dialog reads its dependencies out of. */
let held = [];

/**
 * Hold the board payload the dependency line is derived from.
 *
 * Called by the paint (page.js), for the same reason the agent dialog's refresh
 * is: a dialog lives in the layout, outside the mount a page's render writes
 * into, and every page's paint passes through the runtime - so the payload is
 * handed over once, there, rather than kept a second time by each page that
 * opens an issue. A page whose feeds carry no board hands over nothing, and the
 * dialog says nothing about dependencies rather than guessing at them.
 *
 * @param {object|null} payload - the board payload (state.js's `board`), or null
 * @returns {void}
 */
export const holdBoard = (payload) => { held = (payload && payload.issues) || []; };

/**
 * What one issue waits on, and what waits on it - both read off one board.
 *
 * Pure, and answering in the BOARD's own issue objects rather than in the
 * blocker references, because each one is drawn as a trigger that opens that
 * issue's own dialog: the object is what the registry needs. Every comparison
 * folds case, since repo names are case-insensitive on GitHub and the inline
 * `Depends on:` fallback is hand-typed.
 *
 * @param {object} issue - the issue being read
 * @param {object[]} [issues] - every open issue the sweep carries
 * @returns {{waitsOn: object[], blocks: object[]}} the board's own issues
 */
export const dependencies = (issue, issues) => {
  const board = issues || [];
  const key = (ref) => issueKey(ref).toLowerCase();
  const byKey = new Map(board.map((one) => [key(one), one]));
  const self = key(issue);
  return {
    waitsOn: (issue.blockedBy || []).map((blocker) => byKey.get(key(blocker))).filter(Boolean),
    blocks: board.filter((one) => (one.blockedBy || []).some((blocker) => key(blocker) === self)),
  };
};

/**
 * How one issue is named on another's line - the card's chip's own spelling: the
 * short `#12` when the two share a repo, the whole key anywhere else, since
 * `#12` in another repo is a different issue.
 */
const dependencyRef = (target, issue) => (String(target.repo).toLowerCase() === String(issue.repo).toLowerCase()
  ? `#${target.number}`
  : issueKey(target));

/**
 * One issue on the other end of an edge, as the chip that opens it.
 *
 * A SPAN and not an anchor: the delegated listener treats a link as the card's
 * escape hatch to GitHub, so an anchor here would leave the dashboard rather
 * than open the issue it names. The repo it carries is remote text like every
 * other value on the dialog, and is escaped with the rest. The direction word
 * lives in a sibling span a tab stop never reaches, so the chip carries it
 * again as its accessible name.
 */
const dependencyChip = (target, issue, word) => `<span class="omega-chip omega-interactive" aria-label="${esc(`${word} ${dependencyRef(target, issue)}`)}" ${issueTrigger(target)}>${esc(dependencyRef(target, issue))}</span>`;

/** One word of the line, in the muted voice the metadata above it is written in. */
const dependencyWord = (word) => `<span class="omega-micro text-body-secondary">${esc(word)}</span>`;

/** The dependency line, or nothing at all when the issue neither waits nor blocks. */
const dependencyLine = (issue, issues) => {
  const { waitsOn, blocks } = dependencies(issue, issues);
  const group = (word, targets) => (targets.length
    ? `${dependencyWord(word)}${targets.map((target) => dependencyChip(target, issue, word)).join('')}`
    : '');
  const parts = [group('waits on', waitsOn), group('blocks', blocks)].filter(Boolean);
  if (!parts.length) return '';
  return `<div class="d-flex flex-wrap align-items-center gap-1 mb-3">${parts.join(dependencyWord('·'))}</div>`;
};

/**
 * What a BLOCKED issue is waiting to be told (issue #196) - its open question,
 * in the dialog the card opens rather than on the card itself (issue #205).
 *
 * The convention the spec sets is that a blocked issue's question is a COMMENT
 * on it, so the last comment is the best signal the sweep can carry: it is the
 * question itself on an issue that has just been blocked, and the newest word on
 * one that has been discussed since. Only `blocked` draws it - the last comment
 * of an issue that is moving is not a question anybody is waiting on.
 *
 * Remote text like every other value here, escaped, and drawn as an alert in the
 * danger red `blocked` wears - a question waiting on the owner is the loudest
 * thing in the dialog, never a muted line.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @returns {string} markup, or nothing at all when there is no question to show
 */
const openQuestion = (issue) => (issue.status === 'blocked' && issue.lastComment
  ? `<div class="alert alert-danger mb-3" role="alert"><strong>Open question</strong><p class="omega-tower-issue__question mb-0">${esc(issue.lastComment)}</p></div>`
  : '');

/**
 * The three pieces of the dialog for one issue.
 *
 * Pure - an issue in, three markup strings out - which is what lets the suite
 * ask what a hostile title renders as without a browser.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @param {(text: string) => string} renderBody - the markdown renderer, handed
 *   in by the mount: an issue body is hostile text, and what turns it into
 *   markup escapes first
 * @param {object[]} [issues] - the board the dependency line is read off; the
 *   mount hands over the one the paint is holding
 * @returns {{title: string, actions: string, body: string}}
 */
export const issueDialog = (issue, renderBody, issues) => {
  const rendered = renderBody(issue.body);
  const meta = [
    `filed ${day(issue.createdAt, '-')}`,
    `updated ${day(issue.updatedAt, '-')}`,
    (issue.assignees || []).length ? `held by @${(issue.assignees || []).join(', @')}` : 'unclaimed',
  ];

  return {
    title: `<span class="omega-micro d-block">${esc(issue.repo)} #${esc(issue.number)}</span>
      <span class="d-block">${esc(issue.title)}</span>`,
    actions: externalLink(issue.url),
    body: `<div class="d-flex flex-wrap align-items-center gap-1 mb-2">
        ${statusChip(issue.status)}
        ${issueChips(issue)}
      </div>
      <p class="omega-micro text-body-secondary">${esc(meta.join(' · '))}</p>
      ${openQuestion(issue)}
      ${dependencyLine(issue, issues)}
      <div class="omega-tower-issue__body">${rendered || '<p class="text-body-secondary mb-0">No description.</p>'}</div>
      ${issue.bodyTruncated ? '<p class="omega-micro text-body-secondary mt-2">The body is longer than this - the rest is on GitHub.</p>' : ''}
      <p class="mt-3 mb-0"><a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.comments === 1 ? '1 comment' : `${issue.comments || 0} comments`)} on GitHub</a></p>`,
  };
};

/**
 * The one pair of delegated listeners a dialog opens from - a click, and the
 * Enter/Space a div with a button role has to be given by hand.
 *
 * Delegated on the document so a page that repaints ten times a minute rebinds
 * nothing, and a new click site is one attribute.
 *
 * @param {string} attribute - the data attribute's name (`issue`, `agent`)
 * @param {(key: string) => void} open - what to do with the key it carries
 * @returns {void}
 */
export const openFrom = (attribute, open) => {
  const trigger = (event) => {
    // A link inside a card is the card's escape hatch - the external-link
    // button and any link in the body keep their own behavior.
    if (event.target.closest('a[href]')) return null;
    return event.target.closest(`[data-${attribute}]`);
  };

  document.addEventListener('click', (event) => {
    const host = trigger(event);
    if (!host) return;
    event.preventDefault();
    open(host.dataset[attribute]);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const host = trigger(event);
    if (!host) return;
    event.preventDefault();
    open(host.dataset[attribute]);
  });
};

/**
 * Wire the issue dialog on this page.
 *
 * Idempotent: it binds to the one dialog the layout ships and marks it, so a
 * second call does nothing. A page without the dialog is left alone.
 *
 * @param {object} options
 * @param {(text: string) => string} options.render - the markdown renderer the
 *   dialog draws a body with
 * @param {Document|HTMLElement} [options.scope] - where to look for the dialog
 * @returns {void}
 */
export function mountIssueModal({ render, scope = document } = {}) {
  // Without a renderer the dialog would mount fine and then throw inside the
  // click listener - one interaction away from the mistake. Fail at the mount,
  // where the missing argument is.
  if (typeof render !== 'function') throw new Error('mountIssueModal needs a render function for issue bodies');
  const dialog = scope.querySelector('#tower-issue');
  if (!dialog || dialog.dataset.towerMounted) return;
  dialog.dataset.towerMounted = '1';

  const title = dialog.querySelector('[data-issue-title]');
  const actions = dialog.querySelector('[data-issue-actions]');
  const body = dialog.querySelector('[data-issue-body]');

  const open = (key) => {
    const issue = registry.get(key);
    // The registry is written by the same render that wrote the element, so a
    // key with nothing behind it means the markup outlived its data - say so
    // rather than opening an empty dialog.
    if (!issue) {
      console.warn(`[tower] no issue registered for ${key}`);
      return;
    }
    const parts = issueDialog(issue, render, held);
    title.innerHTML = parts.title;
    actions.innerHTML = parts.actions;
    body.innerHTML = parts.body;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  };

  openFrom('issue', open);
}
