// libs/tower/modal/issue.js: the issue dialog: the registry, the triggers, the
// external link, what an issue depends on, and the delegated opener its siblings
// import. modal.js re-exports it by name; no piece imports modal.js.

import { esc, issueChips, statusChip, issueKey, day } from '../format.js';

/** The issues the current markup can open, keyed `repo#number`. */
const registry = new Map();

// The key an issue is registered and looked up under is format.js's `issueKey`,
// the same one the Board's drop reads back off a dragged card.

/**
 * The attributes that make an element open the issue dialog, registering the
 * issue as the markup is written so no page keeps a second list for the dialog.
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
 * One issue as a list item. The click target is the inner div, never the
 * `<li>`, which would stop being a list item to a screen reader; the `<li>`
 * keeps `omega-tower-issue`, the stylesheet's hook for the external link.
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
 * The one external-link button, opening the GitHub page in a new tab. The
 * stylesheet hides `omega-tower-external` until a card is hovered or focused;
 * the framework's shared renderer draws the glyph in late-inserted markup.
 *
 * @param {string} url - the GitHub issue URL
 * @param {string} [extraClass] - layout classes the caller's context needs
 * @returns {string} markup
 */
export const externalLink = (url, extraClass = '') => `<a class="omega-tower-external${extraClass ? ` ${extraClass}` : ''}" href="${esc(url)}" target="_blank" rel="noopener" title="Open on GitHub" aria-label="Open on GitHub">
  <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
</a>`;

// ── What an issue depends on ───────────────────────────────────────────────
// Both halves of the edge come off the board payload in memory, the inverse
// read as the dialog opens, so nothing is fetched or stored. A blocker the
// board is not holding is satisfied and drawn nowhere, `waitsOnChips`'s rule.

/** The board payload the open dialog reads its dependencies out of. */
let held = [];

/**
 * Hold the board payload the dependency line is derived from: handed over by
 * the paint (page.js), since the dialog lives outside every page's mount. A
 * page with no board hands over nothing, and the dialog says nothing.
 *
 * @param {object|null} payload - the board payload (state.js's `board`), or null
 * @returns {void}
 */
export const holdBoard = (payload) => { held = (payload && payload.issues) || []; };

/**
 * What one issue waits on, and what waits on it, answered in the board's own
 * issue objects since each is drawn as a trigger the registry needs. Every
 * comparison folds case: the inline `Depends on:` fallback is hand-typed.
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
 * How one issue is named on another's line, the card chip's spelling: the
 * short `#<n>` in a shared repo, the whole key anywhere else.
 */
const dependencyRef = (target, issue) => (String(target.repo).toLowerCase() === String(issue.repo).toLowerCase()
  ? `#${target.number}`
  : issueKey(target));

/**
 * One issue on the other end of an edge, as the chip that opens it: a span,
 * since the delegated listener treats an anchor as the way out to GitHub. The
 * direction word sits in a sibling a tab never reaches, so the chip repeats it
 * as its accessible name.
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
 * What a blocked issue is waiting to be told: its newest comment, where the
 * spec puts the question, as a danger alert, the loudest thing in the dialog.
 * Only `blocked` draws it; a moving issue's last comment asks nobody anything.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @returns {string} markup, or nothing at all when there is no question to show
 */
const openQuestion = (issue) => (issue.status === 'blocked' && issue.lastComment
  ? `<div class="alert alert-danger mb-3" role="alert"><strong>Open question</strong><p class="omega-tower-issue__question mb-0">${esc(issue.lastComment)}</p></div>`
  : '');

/**
 * The three pieces of the dialog for one issue, pure so the suite can ask what
 * a hostile title renders as.
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
 * The one pair of delegated listeners a dialog opens from: a click, and the
 * Enter/Space a div with a button role needs by hand. On the document, so a
 * repaint rebinds nothing.
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
