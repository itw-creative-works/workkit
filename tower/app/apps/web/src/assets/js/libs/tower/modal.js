//
// The issue dialog — what clicking an issue does, everywhere on the tower.
//
// Before this, every issue on every page was an anchor to github.com, so the
// only way to read one was to leave the dashboard. Now a click OPENS it here —
// title, number, repo, status and chips, the body rendered, who holds it, when
// it was filed and last touched, and how many comments are waiting — and GitHub
// is reached only through the explicit external-link button, which is in the
// dialog and on each card while it is hovered or focused. Nothing navigates by
// accident.
//
// The dialog's markup is the LAYOUT's (_layouts/tower/page.html), like the
// intake dialog's: the theme ships Bootstrap's modal and the tower supplies
// only what markup cannot know. This file fills it and decides when it opens.
//
// Click sites do not each need a listener. A card carries `data-issue` with a
// `repo#number` key, `issueTrigger()` records the issue object under that key
// as the markup is built, and ONE delegated listener on the document opens
// whatever was clicked — so a page that repaints ten times a minute never
// rebinds anything, and a new click site is one attribute.
//
// Every field is attacker-controlled text: titles, bodies and handles come from
// GitHub's API and are escaped (or run through the markdown renderer, which
// escapes first) without exception.
//
// The renderer itself is the framework's — `omega.utilities().renderMarkdown`,
// which this file never names. It is handed in at mount instead, from the main
// bundle that already holds the client singleton, which is what keeps every
// markup function here a pure string function the suite can ask questions of
// under Node.
//

import { esc, issueChips } from './format.js';

/** The issues the current markup can open, keyed `repo#number`. */
const registry = new Map();

/** The key an issue is registered and looked up under. */
const keyOf = (issue) => `${issue.repo}#${issue.number}`;

/**
 * The attributes that make an element open the issue dialog.
 *
 * Registering happens HERE, as the markup is written, because the issue object
 * and its markup are made in the same breath — a page never has to keep a
 * second copy of its own list for the dialog to read.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @returns {string} attributes to interpolate into the element's tag
 */
export const issueTrigger = (issue) => {
  const key = keyOf(issue);
  registry.set(key, issue);
  return `data-issue="${esc(key)}" role="button" tabindex="0"`;
};

/**
 * The one external-link button: a box with an arrow leaving it, opening the
 * GitHub page in a new tab.
 *
 * `omega-tower-external` is what the stylesheet hides until a card is hovered
 * or focused; in the dialog it is passed no extra class and simply shows.
 *
 * The glyph is plain Font Awesome markup — the framework's shared renderer
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

/** A date as the dialog says it — the day, or a dash when there is no date. */
const day = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

/**
 * The three pieces of the dialog for one issue.
 *
 * Pure — an issue in, three markup strings out — which is what lets the suite
 * ask what a hostile title renders as without a browser.
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @param {(text: string) => string} renderBody - the markdown renderer, handed
 *   in by the mount: an issue body is hostile text, and what turns it into
 *   markup escapes first
 * @returns {{title: string, actions: string, body: string}}
 */
export const issueDialog = (issue, renderBody) => {
  const rendered = renderBody(issue.body);
  const meta = [
    `filed ${day(issue.createdAt)}`,
    `updated ${day(issue.updatedAt)}`,
    (issue.assignees || []).length ? `held by @${(issue.assignees || []).join(', @')}` : 'unclaimed',
  ];

  return {
    title: `<span class="classy-micro d-block">${esc(issue.repo)} #${esc(issue.number)}</span>
      <span class="d-block">${esc(issue.title)}</span>`,
    actions: externalLink(issue.url),
    body: `<div class="d-flex flex-wrap align-items-center gap-1 mb-2">
        ${issue.status ? `<span class="classy-chip">${esc(issue.status)}</span>` : ''}
        ${issueChips(issue)}
      </div>
      <p class="classy-micro text-body-secondary">${esc(meta.join(' · '))}</p>
      <div class="omega-tower-issue__body">${rendered || '<p class="text-body-secondary mb-0">No description.</p>'}</div>
      ${issue.bodyTruncated ? '<p class="classy-micro text-body-secondary mt-2">The body is longer than this — the rest is on GitHub.</p>' : ''}
      <p class="mt-3 mb-0"><a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.comments === 1 ? '1 comment' : `${issue.comments || 0} comments`)} on GitHub</a></p>`,
  };
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
  // click listener — one interaction away from the mistake. Fail at the mount,
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
    // key with nothing behind it means the markup outlived its data — say so
    // rather than opening an empty dialog.
    if (!issue) {
      console.warn(`[tower] no issue registered for ${key}`);
      return;
    }
    const parts = issueDialog(issue, render);
    title.innerHTML = parts.title;
    actions.innerHTML = parts.actions;
    body.innerHTML = parts.body;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  };

  const trigger = (event) => {
    // A link inside a card is the card's escape hatch — the external-link
    // button and any link in the body keep their own behavior.
    if (event.target.closest('a[href]')) return null;
    return event.target.closest('[data-issue]');
  };

  document.addEventListener('click', (event) => {
    const host = trigger(event);
    if (!host) return;
    event.preventDefault();
    open(host.dataset.issue);
  });

  // A card is a div with a button role, so the keyboard has to be given what a
  // real button gets for free.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const host = trigger(event);
    if (!host) return;
    event.preventDefault();
    open(host.dataset.issue);
  });
}
