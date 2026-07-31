//
// The tower's dialogs — what clicking an issue does, and what clicking a crew
// card does, everywhere on the tower.
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

import {
  esc, issueChips, statusChip, compact, money, modelBadge, classBadge, shortPath, issueKey,
} from './format.js';
import { crewActivity, sinceLabel, roleIcon } from './agent.js';

/** The issues the current markup can open, keyed `repo#number`. */
const registry = new Map();

// The key an issue is registered and looked up under is format.js's `issueKey`,
// the same one the Board's drop reads back off a dragged card.

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
  const key = issueKey(issue);
  registry.set(key, issue);
  return `data-issue="${esc(key)}" role="button" tabindex="0"`;
};

/**
 * One issue as a list item — the shape three pages draw it in.
 *
 * The interactive semantics sit on the INNER element, never on the `<li>`: an
 * `<li>` given `role="button"` stops being a list item, and a screen reader
 * loses the list — how many issues there are and which one it is on. The `<li>`
 * keeps `omega-tower-issue` (what the stylesheet reveals the external link
 * from, through `:hover` and `:focus-within`, which reach the inner element
 * either way) and stays bare; the inner div takes the click target's
 * `omega-interactive`, its layout AND spacing classes, and the trigger
 * attributes — padding on the `<li>` would leave a strip of row the hover
 * tint and the click never cover (issue #42's review, browser-verified).
 *
 * @param {object} issue - one issue from /api/board or /api/brief
 * @param {string} body - the item's content markup
 * @param {object} [classes]
 * @param {string} [classes.item] - extra classes for the `<li>` (rarely needed — spacing belongs on `inner`)
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
        ${statusChip(issue.status)}
        ${issueChips(issue)}
      </div>
      <p class="classy-micro text-body-secondary">${esc(meta.join(' · '))}</p>
      <div class="omega-tower-issue__body">${rendered || '<p class="text-body-secondary mb-0">No description.</p>'}</div>
      ${issue.bodyTruncated ? '<p class="classy-micro text-body-secondary mt-2">The body is longer than this — the rest is on GitHub.</p>' : ''}
      <p class="mt-3 mb-0"><a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.comments === 1 ? '1 comment' : `${issue.comments || 0} comments`)} on GitHub</a></p>`,
  };
};

/**
 * The one pair of delegated listeners a dialog opens from — a click, and the
 * Enter/Space a div with a button role has to be given by hand.
 *
 * Delegated on the document so a page that repaints ten times a minute rebinds
 * nothing, and a new click site is one attribute.
 *
 * @param {string} attribute - the data attribute's name (`issue`, `agent`)
 * @param {(key: string) => void} open - what to do with the key it carries
 * @returns {void}
 */
const openFrom = (attribute, open) => {
  const trigger = (event) => {
    // A link inside a card is the card's escape hatch — the external-link
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

  openFrom('issue', open);
}

//
// ── The crew card's dialog ─────────────────────────────────────────────────
//
// The same machinery for the other thing the tower draws as a card: an agent.
// A crew card shows what it IS; this says what it is doing — the tool it last
// reached for, what it has spent, how long it has been up, and where its
// transcript is. Everything on it comes from the telemetry payload; a field the
// payload does not carry is left OUT rather than drawn as a dash, because a row
// of dashes reads as a broken dialog rather than as a session too young to have
// spent anything.
//

/** The agents the current markup can open, keyed by agent id. */
const agents = new Map();

/**
 * The attributes that make an element open the agent dialog.
 *
 * @param {object} entry - a normalized crew node, plus the `label` the card is
 *   titled with and the `role` it is playing
 * @returns {string} attributes to interpolate into the element's tag
 */
export const agentTrigger = (entry) => {
  agents.set(entry.id, entry);
  return `data-agent="${esc(entry.id)}" role="button" tabindex="0"`;
};

/** One label/value row of the dialog, or '' when there is no value to show. */
const detail = (label, value) => (value
  ? `<div class="d-flex justify-content-between gap-3 py-1 border-bottom">
      <span class="classy-micro text-body-secondary">${esc(label)}</span>
      <span class="text-end">${value}</span>
    </div>`
  : '');

/** A moment as the clock said it, or '' when there is no moment. */
const clock = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleTimeString() : '');

/**
 * The two pieces of the dialog for one agent.
 *
 * Pure — a node and a `now` in, two markup strings out — so the suite can ask
 * what it says about a session that has spent nothing without a browser.
 *
 * The indicator in the header is `agent.crewActivity`, the same stamped builder
 * the Crew page and the Overview draw (#65): a dialog is opened once and can be
 * left open for minutes, so its glyph has to age on the second hand like every
 * other surface rather than freezing at whatever it said when it was opened.
 * That is also why the clock is armed over the whole document body — these two
 * dialogs live in the LAYOUT, outside the page mount the paint writes into.
 *
 * @param {object} entry - a normalized crew node with `label` and `role`
 * @param {number} [now] - ms epoch
 * @returns {{title: string, body: string}}
 */
export const agentDialog = (entry, now = Date.now()) => {
  const usage = entry.usage || null;
  const alive = Number(entry.aliveSince);
  const last = Number(entry.lastActivity);
  const tool = Number(entry.lastToolAt);

  return {
    title: `<span class="classy-micro d-block">${esc(entry.role || 'agent')}${entry.cwd ? ` · ${esc(shortPath(entry.cwd))}` : ''}</span>
      <span class="d-block">${esc(entry.label || entry.id || 'agent')}</span>`,
    body: `<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
        ${roleIcon(entry.role || entry.agentClass)}
        ${classBadge(entry.role || entry.agentClass)}
        ${modelBadge(entry.model)}
        ${entry.effort ? `<span class="classy-chip">${esc(entry.effort)}</span>` : ''}
        ${crewActivity(entry, now)}
      </div>
      ${detail('Last tool', entry.lastTool ? `${esc(entry.lastTool)}${Number.isFinite(tool) ? ` <span class="classy-micro text-body-secondary">${esc(sinceLabel(now - tool))} ago</span>` : ''}` : '')}
      ${detail('Last activity', Number.isFinite(last) ? `${esc(sinceLabel(now - last))} ago` : '')}
      ${detail('Running for', Number.isFinite(alive) ? esc(sinceLabel(now - alive)) : '')}
      ${detail('Spawned', clock(alive) ? esc(clock(alive)) : '')}
      ${detail('Tokens in', usage ? esc(compact(usage.input)) : '')}
      ${detail('Tokens out', usage ? esc(compact(usage.output)) : '')}
      ${detail('Tokens total', entry.tokens === null || entry.tokens === undefined ? '' : esc(compact(entry.tokens)))}
      ${detail('Cost', entry.cost === null || entry.cost === undefined ? '' : esc(money(entry.cost)))}
      ${detail('Id', esc(entry.id || ''))}
      ${detail('Transcript', entry.transcript ? `<code class="classy-micro">${esc(entry.transcript)}</code>` : '')}`,
  };
};

/**
 * Wire the agent dialog on this page.
 *
 * Idempotent the same way the issue dialog is, and just as quiet on a page that
 * does not ship the shell.
 *
 * @param {object} [options]
 * @param {Document|HTMLElement} [options.scope] - where to look for the dialog
 * @returns {void}
 */
export function mountAgentModal({ scope = document } = {}) {
  const dialog = scope.querySelector('#tower-agent');
  if (!dialog || dialog.dataset.towerMounted) return;
  dialog.dataset.towerMounted = '1';

  const title = dialog.querySelector('[data-agent-title]');
  const body = dialog.querySelector('[data-agent-body]');

  openFrom('agent', (key) => {
    const entry = agents.get(key);
    if (!entry) {
      console.warn(`[tower] no agent registered for ${key}`);
      return;
    }
    const parts = agentDialog(entry, Date.now());
    title.innerHTML = parts.title;
    body.innerHTML = parts.body;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  });
}
