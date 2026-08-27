//
// The token - what a published copy is given before it has any data, and the
// page that owns it.
//
// The published site bakes no data at all: it reads GitHub live - and moves and
// files issues there - with a personal access token the viewer hands over
// (issue #81). With no token there is nothing to draw and nothing to write
// with, so handing one over is the one thing a viewer is asked.
//
// Where it is asked moved to the SETTINGS page (issue #167). It used to be a
// dialog the runtime opened over whichever page was landed on, and that dialog
// could not be dismissed - a tokenless viewer stood on a data page that could
// not load anything, with nowhere else to be. Now there is somewhere: `/settings`
// is a page like the other six, in the sidebar, and it works with no token
// because it is where one is typed. Every other page points at it in a line and
// the runtime sends a tokenless landing there (page.js).
//
// It says three things and asks for one: what to create, which permissions it
// needs, and where the token is kept. The token is written to this browser's
// localStorage and is never sent anywhere but api.github.com - no repo, no
// build, no URL, no server.
//
// Split the way every other lib here is: the markup is pure string functions
// the suite can ask questions of, and `mountTokenCard()` is the two listeners
// that markup needs - the save that stores what was typed and the clear that
// forgets it, which used to be the chrome's Token button.
//
// A locked copy served from THIS machine is a different story, and asking it
// for a token would be asking for the wrong thing (issue #89): on localhost the
// tower API holds the `gh` login and the app runs tokenless, so a copy that
// found no tower there has one problem - the API is not running. It gets
// `towerDownNotice()` as its page body; the fork is the hostname the page was
// served from and nothing else, and the mode itself is api.js's and is
// untouched. Settings is the exception, because a viewer who opened it asked.
//

import { esc, lockedNotice, localLockedNotice } from './format.js';
import {
  TOKEN_URL, TOKEN_SCOPES, TOKEN_CLASSIC_URL, TOKEN_CLASSIC, writeToken, clearToken, safeStorage,
} from './github.js';

/** Where the token is typed, and the only page a copy without one can use. */
export const SETTINGS_LABEL = 'Settings';

/**
 * The token card on the Settings page: what this browser holds, the field that
 * replaces it, and the button that forgets it.
 *
 * The field is drawn whether or not a token is held - replacing one is typing
 * the next over it - and the clear button only where there is something to
 * forget, which is the same rule the chrome's Token button was drawn by.
 *
 * @param {object} [options]
 * @param {boolean} [options.held] - whether this browser holds a token
 * @param {string} [options.problem] - why the last token did not work, if it did not
 * @returns {string} markup
 */
export const tokenCard = (options = {}) => `<div class="card mb-4">
  <div class="card-body">
    <div class="omega-panel-head mb-3"><span>GitHub token</span></div>
    <p>This copy of the tower has no data of its own - it reads your GitHub issues live from your browser, and moves and files them there too. Hand it a token and it works exactly like the dashboard on your machine.</p>
    ${options.problem ? `<div class="alert alert-warning" data-token-problem>${esc(options.problem)}</div>` : ''}
    <form data-token-form>
      <div class="mb-3">
        <label class="form-label" for="tower-token-input">GitHub token</label>
        <input class="form-control" id="tower-token-input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${options.held ? 'a token is stored - paste another to replace it' : 'github_pat_… or ghp_…'}" data-token-input/>
        <div class="form-text">${options.held ? 'This browser holds a token.' : 'This browser holds no token yet.'} It is stored in this browser only (localStorage) and sent only to api.github.com.</div>
      </div>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <button class="btn btn-adaptive btn-sm" type="submit" data-token-save>Save</button>
        ${options.held ? '<button class="btn btn-outline-adaptive btn-sm" type="button" data-token-clear>Clear</button>' : ''}
        <a class="btn btn-outline-adaptive btn-sm" href="${esc(TOKEN_URL)}" target="_blank" rel="noopener">Create a token on GitHub</a>
      </div>
    </form>
  </div>
</div>`;

/**
 * What that token has to be able to do - the fine-grained permissions, and the
 * classic token that covers a board spanning two owners (issue #167).
 *
 * Both sentences are github.js's, beside the URLs a viewer makes each kind at:
 * the guidance and the calls it describes cannot drift apart if they live in
 * one file.
 *
 * @returns {string} markup
 */
export const tokenGuidance = () => `<div class="card">
  <div class="card-body">
    <div class="omega-panel-head mb-3"><span>What the token needs</span></div>
    <p class="text-body-secondary">${esc(TOKEN_SCOPES)}</p>
    <p class="text-body-secondary">${esc(TOKEN_CLASSIC)}</p>
    <a class="btn btn-outline-adaptive btn-sm" href="${esc(TOKEN_CLASSIC_URL)}" target="_blank" rel="noopener">Create a classic token on GitHub</a>
  </div>
</div>`;

/**
 * What Settings says on a copy that has a TOWER behind it.
 *
 * There the machine's API holds the `gh` login and the token is not this copy's
 * credential at all - so the page says whose it is rather than letting the card
 * under it read as this dashboard's own key.
 *
 * @returns {string} markup
 */
export const towerTokenNote = () => `<p class="text-body-secondary">This copy reads the tower API on this machine, which holds the gh login - it needs no token of its own. A token saved here is what a published copy of this dashboard uses.</p>`;

/**
 * The one line every OTHER page shows when this copy holds no token, and the
 * line a refused token leaves in place of the page.
 *
 * The runtime sends a tokenless landing to Settings, so this is what the page
 * says on its way there - and what it goes on saying if the viewer came back to
 * it. One line, pointing at the one place a token is typed: there is nothing
 * else a page with no data can honestly show.
 *
 * @param {string} href - the Settings page, carrying the current repo selection
 * @param {string} [problem] - why the token this copy holds did not work
 * @returns {string} markup
 */
export const settingsNotice = (href, problem = '') => `<p class="text-body-secondary mb-0">${problem ? `${esc(problem)} ` : ''}This page has no data until this browser holds a GitHub token that can read it - add one on <a href="${esc(href)}">${SETTINGS_LABEL}</a>.</p>`;

/** Whether the page is being served from the machine the tower runs on. */
export const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/**
 * The same page, pointed at the tower with `?api=` - the link the local notice
 * offers.
 *
 * It is the whole of the advice, because the mode is decided from the BUILD and
 * never from a probe (api.js): a locked page on this machine is a production
 * build, so starting the API changes nothing a reload can see. The override is
 * what flips `decideLive`, and it survives a reload in the URL.
 *
 * The origin is the tower's default rather than api.js's `API_BASE`: a locked
 * copy is by definition one that was given no override, so the two are the same
 * string - and importing api.js here would put this module's suite behind a
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
 * this copy was never pointed at it - never a token, which a local page has no
 * use for.
 *
 * @param {string} href - the page URL, which the connect link is built from
 * @returns {string}
 */
export const towerDownNotice = (href) => `<div class="card">
  <div class="card-body">
    <div class="omega-panel-head mb-3"><span>The tower isn’t connected</span></div>
    <p>The tower API on this machine isn’t running, or this copy of the dashboard isn’t pointed at it.</p>
    <p class="text-body-secondary">Start it with <code>npm run tower</code> from the workkit checkout, then connect this page to it.</p>
    <a class="btn btn-adaptive btn-sm" href="${esc(connectHref(href))}">Connect to the tower</a>
  </div>
</div>`;

/**
 * What the intake dialog says where its roster and its write would be, forked
 * the same way and on the same predicate - the dialog rides every page, so a
 * local page telling one story in its body and another in its dialog is the
 * contradiction this fork exists to end.
 *
 * @param {string} hostname - the host the page was served from
 * @returns {string}
 */
export const lockedIntakeNotice = (hostname) => (isLocalHost(hostname) ? localLockedNotice() : lockedNotice());

/**
 * Wire the token card: store what was typed, or forget what is held, and read
 * the page again either way.
 *
 * A reload rather than a re-render, because the mode is decided once at module
 * load (api.js) - asking the page to start over is both simpler and exactly
 * what the viewer expects from handing over a key. Forgetting reloads for the
 * same reason it did from the chrome's Token button: a copy with no token is a
 * different copy.
 *
 * @param {HTMLElement} host - the element the card was drawn into
 * @param {object} [seams] - `{ storage, reload }`, injectable for the suite
 * @returns {void}
 */
export const mountTokenCard = (host, seams = {}) => {
  const storage = seams.storage || safeStorage(window);
  const reload = seams.reload || (() => location.reload());
  const form = host.querySelector('[data-token-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('[data-token-input]');
    // An empty field is not a request to forget - Clear is - and the guard is
    // HERE rather than on the answer, because `writeToken('')` is the clear:
    // asking it and reacting to the empty string back would already have
    // removed the token this browser holds.
    const typed = String(input.value || '').trim();
    if (!typed) {
      input.focus();
      return;
    }
    writeToken(storage, typed);
    reload();
  });

  const forget = form.querySelector('[data-token-clear]');
  if (forget) {
    forget.addEventListener('click', () => {
      clearToken(storage);
      reload();
    });
  }
};
