// libs/tower/modal/document.js: the published document's dialog: the registry,
// the trigger, the excerpt, the body, the card and the mount.
// modal.js re-exports it whole; no piece imports modal.js.

// ── The published document's dialog ────────────────────────────────────────
// A morning brief or a summary, opened whole from the archive the way an issue
// opens: the issue dialog's machinery without the live refresh or the
// dependency line, since a published post neither changes nor depends.

import { esc, documentMeta } from '../format.js';
import { externalLink, openFrom } from './issue.js';

/** The documents the current markup can open, keyed by their post's URL. */
const docs = new Map();

/**
 * The one name for one document. The URL, because a published post is exactly
 * what it links to - and the title, for a payload that somehow carried no URL,
 * since a key of '' would make every such document the same one.
 */
const documentKey = (doc) => doc.url || doc.title;

/**
 * The attributes that make an element open the document dialog, registering
 * the document as the markup is written, as `issueTrigger` does.
 *
 * @param {object} doc - one entry of the brief payload's `documents`
 * @returns {string} attributes to interpolate into the element's tag
 */
export const documentTrigger = (doc) => {
  const key = documentKey(doc);
  docs.set(key, doc);
  return `data-document="${esc(key)}" role="button" tabindex="0"`;
};

/** How much of the first line a card carries before it trails off. */
const EXCERPT_MAX = 180;

/**
 * The one line a card says about a document beside its title: the first line
 * of the text itself, its heading or quote markdown dropped.
 *
 * @param {string} body - the document's text
 * @returns {string} plain text, never markup
 */
export const excerpt = (body) => {
  const line = String(body || '').split('\n').map((one) => one.trim()).find(Boolean) || '';
  const plain = line.replace(/^(?:#{1,6}\s+|>\s*)/, '').replace(/\s+/g, ' ');
  return plain.length > EXCERPT_MAX ? `${plain.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : plain;
};

/**
 * The text of one document, rendered: the newest brief in place and every
 * other in the dialog. The renderer is handed in since a published body is
 * remote text, and it escapes first.
 *
 * @param {object} doc - one entry of the payload's `documents`
 * @param {(text: string) => string} renderBody - the markdown renderer
 * @returns {string} markup
 */
export const documentBody = (doc, renderBody) => `<div class="omega-tower-issue__body">${renderBody(doc.body) || '<p class="text-body-secondary mb-0">This one was published with nothing in it.</p>'}</div>`;

/**
 * One document as a card, the shape the archive is a list of; the click target
 * is the inner element for the reason on `issueItem`.
 *
 * @param {object} doc - one entry of the payload's `documents`
 * @returns {string} markup
 */
export const documentItem = (doc) => {
  const line = excerpt(doc.body);
  return `<li class="omega-tower-issue">
  <div class="omega-interactive py-2" ${documentTrigger(doc)}>
    <div class="d-flex align-items-start gap-2">
      <span class="flex-grow-1">
        <span class="omega-micro d-block">${esc(documentMeta(doc))}</span>
        <span class="d-block">${esc(doc.title)}</span>
        ${line ? `<span class="omega-micro d-block text-body-secondary">${esc(line)}</span>` : ''}
      </span>
      ${externalLink(doc.url)}
    </div>
  </div>
</li>`;
};

/**
 * The three pieces of the dialog for one document.
 *
 * Pure - a document and a renderer in, three markup strings out - which is what
 * lets the suite ask what a hostile title renders as without a browser.
 *
 * @param {object} doc - one entry of the payload's `documents`
 * @param {(text: string) => string} renderBody - the markdown renderer
 * @returns {{title: string, actions: string, body: string}}
 */
export const documentDialog = (doc, renderBody) => ({
  title: `<span class="omega-micro d-block">${esc(documentMeta(doc))}</span>
      <span class="d-block">${esc(doc.title)}</span>`,
  actions: externalLink(doc.url),
  body: documentBody(doc, renderBody),
});

/**
 * Wire the document dialog on this page.
 *
 * Idempotent the same way the other two are, and just as quiet on a page that
 * does not ship the shell.
 *
 * @param {object} options
 * @param {(text: string) => string} options.render - the markdown renderer
 * @param {Document|HTMLElement} [options.scope] - where to look for the dialog
 * @returns {void}
 */
export function mountDocumentModal({ render, scope = document } = {}) {
  // Without a renderer the dialog would mount fine and throw inside the click
  // listener - one interaction away from the mistake. Fail at the mount.
  if (typeof render !== 'function') throw new Error('mountDocumentModal needs a render function for document bodies');
  const dialog = scope.querySelector('#tower-document');
  if (!dialog || dialog.dataset.towerMounted) return;
  dialog.dataset.towerMounted = '1';

  const title = dialog.querySelector('[data-document-title]');
  const actions = dialog.querySelector('[data-document-actions]');
  const body = dialog.querySelector('[data-document-body]');

  openFrom('document', (key) => {
    const doc = docs.get(key);
    if (!doc) {
      console.warn(`[tower] no document registered for ${key}`);
      return;
    }
    const parts = documentDialog(doc, render);
    title.innerHTML = parts.title;
    actions.innerHTML = parts.actions;
    body.innerHTML = parts.body;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  });
}
