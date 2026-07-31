//
// The token prompt — what a published copy shows before it has been unlocked.
//
// The published site bakes no data at all: it reads GitHub live — and moves and
// files issues there — with a fine-grained personal access token the viewer
// hands over (issue #81). With no token there is nothing to draw and nothing to
// write with, so the prompt is the one thing a viewer is asked — on every page,
// until a token is stored.
//
// It says three things and asks for one: what to create, which permissions it
// needs, and where the token is kept. The token is written to this browser's
// localStorage and is never sent anywhere but api.github.com — no repo, no
// build, no URL, no server.
//
// Where it is DRAWN is the layout's unlock dialog (issue #96): the prompt used
// to be written into the page body, taking the shell with it; now the shell
// stays and the prompt opens over it, in the theme's own Bootstrap modal — the
// same mechanism the intake and issue dialogs use, opened from here rather than
// by a data attribute because nothing was clicked.
//
// Split the way every other lib here is: `tokenPrompt()` is a pure string
// function the suite can ask questions of, `mountTokenPrompt()` is the one
// listener the markup needs — the submit that stores what was typed — and
// `openTokenModal()` is the two of them put into the dialog the layout ships.
//
// A locked copy served from THIS machine is a different story, and asking it
// for a token would be asking for the wrong thing (issue #89): on localhost the
// tower API holds the `gh` login and the app runs tokenless, so a copy that
// found no tower there has one problem — the API is not running. It gets
// `towerDownNotice()` as its page body and no dialog at all; the fork is the
// hostname the page was served from and nothing else, and the mode itself is
// api.js's and is untouched.
//

import { esc, lockedNotice, localLockedNotice } from './format.js';
import {
  TOKEN_URL, TOKEN_SCOPES, writeToken, safeStorage,
} from './github.js';

/**
 * The prompt, as markup.
 *
 * @param {string} [problem] - why the last attempt did not work, if it did not
 * @returns {string}
 */
export const tokenPrompt = (problem = '') => `<div class="card">
  <div class="card-body">
    <div class="classy-panel-head mb-3"><span>Unlock the board</span></div>
    <p>This copy of the tower has no data of its own — it reads your GitHub issues live from your browser, and moves and files them there too. Hand it a token and it works exactly like the dashboard on your machine.</p>
    <p class="text-body-secondary">${esc(TOKEN_SCOPES)}</p>
    ${problem ? `<div class="alert alert-warning" data-token-problem>${esc(problem)}</div>` : ''}
    <form data-token-form>
      <div class="mb-3">
        <label class="form-label" for="tower-token-input">GitHub token</label>
        <input class="form-control" id="tower-token-input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" data-token-input/>
        <div class="form-text">Stored in this browser only (localStorage), sent only to api.github.com. Clear it any time with the Token button above the page.</div>
      </div>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <button class="btn btn-adaptive btn-sm" type="submit" data-token-save>Unlock</button>
        <a class="btn btn-outline-adaptive btn-sm" href="${esc(TOKEN_URL)}" target="_blank" rel="noopener">Create a token on GitHub</a>
      </div>
    </form>
  </div>
</div>`;

/** Whether the page is being served from the machine the tower runs on. */
export const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/**
 * The same page, pointed at the tower with `?api=` — the link the local notice
 * offers.
 *
 * It is the whole of the advice, because the mode is decided from the BUILD and
 * never from a probe (api.js): a locked page on this machine is a production
 * build, so starting the API changes nothing a reload can see. The override is
 * what flips `decideLive`, and it survives a reload in the URL.
 *
 * The origin is the tower's default rather than api.js's `API_BASE`: a locked
 * copy is by definition one that was given no override, so the two are the same
 * string — and importing api.js here would put this module's suite behind a
 * `location` it does not need.
 *
 * @param {string} href - the page URL
 * @param {string} [origin] - where the tower answers
 * @returns {string}
 */
export const connectHref = (href, origin = 'http://127.0.0.1:8693') => {
  const url = new URL(href);
  url.searchParams.set('api', origin);
  return url.toString();
};

/**
 * What a locked copy says on THIS machine: the tower API is not answering, or
 * this copy was never pointed at it — never a token, which a local page has no
 * use for.
 *
 * @param {string} href - the page URL, which the connect link is built from
 * @returns {string}
 */
export const towerDownNotice = (href) => `<div class="card">
  <div class="card-body">
    <div class="classy-panel-head mb-3"><span>The tower isn’t connected</span></div>
    <p>The tower API on this machine isn’t running, or this copy of the dashboard isn’t pointed at it.</p>
    <p class="text-body-secondary">Start it with <code>npm run tower</code> from the workkit checkout, then connect this page to it.</p>
    <a class="btn btn-adaptive btn-sm" href="${esc(connectHref(href))}">Connect to the tower</a>
  </div>
</div>`;

/**
 * What the intake dialog says where its roster and its write would be, forked
 * the same way and on the same predicate — the dialog rides every page, so a
 * local page telling one story in its body and another in its dialog is the
 * contradiction this fork exists to end.
 *
 * @param {string} hostname - the host the page was served from
 * @returns {string}
 */
export const lockedIntakeNotice = (hostname) => (isLocalHost(hostname) ? localLockedNotice() : lockedNotice());

/**
 * Wire the prompt: store what was typed and read the page again with it.
 *
 * A reload rather than a re-render, because the mode is decided once at module
 * load (api.js) — asking the page to start over is both simpler and exactly
 * what the viewer expects from an unlock.
 *
 * @param {HTMLElement} host - the element the prompt was drawn into
 * @param {object} [seams] - `{ storage, reload }`, injectable for the suite
 * @returns {void}
 */
export const mountTokenPrompt = (host, seams = {}) => {
  const storage = seams.storage || safeStorage(window);
  const reload = seams.reload || (() => location.reload());
  const form = host.querySelector('[data-token-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('[data-token-input]');
    if (!writeToken(storage, input.value)) {
      input.focus();
      return;
    }
    reload();
  });
};

/** The id of the dialog the layout ships for the prompt. */
export const TOKEN_MODAL = 'tower-unlock';

/**
 * Put the prompt in that dialog, wire it, and open it.
 *
 * The dialog is the layout's, so it is on every page and is opened by
 * Bootstrap's own JS — which is what keeps focus and the backdrop the theme's
 * business rather than this file's. It is filled on every open: the reason a
 * refused token carries is the only thing that changes between two of them.
 *
 * @param {string} [problem] - why the last attempt did not work, if it did not
 * @param {Document|HTMLElement} [scope] - where to look for the dialog
 * @returns {void}
 */
export const openTokenModal = (problem = '', scope = document) => {
  const dialog = scope.querySelector(`#${TOKEN_MODAL}`);
  // No dialog means the page is not wearing the tower layout — and there is
  // nowhere else to ask for a token, so say it once rather than fail silently.
  if (!dialog) {
    console.warn(`[tower] no #${TOKEN_MODAL} on this page — nowhere to show the token prompt`);
    return;
  }
  const host = dialog.querySelector('[data-token-body]');
  host.innerHTML = tokenPrompt(problem);
  mountTokenPrompt(host);
  window.bootstrap.Modal.getOrCreateInstance(dialog).show();
};

/**
 * Take it away again.
 *
 * The dialog is static — nothing a viewer does dismisses it — so the one thing
 * that can is the state that made it wrong: a read landing after a refusal
 * (a 403 is a rate limit as often as a bad token), which the runtime answers
 * by showing the page it was hiding.
 *
 * @param {Document|HTMLElement} [scope] - where to look for the dialog
 * @returns {void}
 */
export const hideTokenModal = (scope = document) => {
  const dialog = scope.querySelector(`#${TOKEN_MODAL}`);
  const open = dialog && window.bootstrap.Modal.getInstance(dialog);
  if (open) open.hide();
};
