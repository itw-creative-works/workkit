// The token's page: the Settings cards a published copy is unlocked from, the
// line every other page points at them with, and the notices a locked copy
// served from this machine gets instead (`tower/README.md` § The three modes).
// Markup is pure string functions; `mountTokenCard()` is the two listeners.

import { esc, lockedNotice, localLockedNotice } from './format.js';
import {
  TOKEN_URL, TOKEN_SCOPES, TOKEN_CLASSIC_URL, TOKEN_CLASSIC, TOKEN_CLASSIC_WORDS, writeToken, clearToken, safeStorage,
} from './github.js';

/** Where the token is typed, and the only page a copy without one can use. */
export const SETTINGS_LABEL = 'Settings';

/**
 * The token card on the Settings page: the field, drawn whether or not a token
 * is held since replacing one is typing over it, and Clear only when there is
 * something to forget.
 *
 * @param {object} [options]
 * @param {boolean} [options.held] - whether this browser holds a token
 * @param {string} [options.problem] - why the last token did not work, if it did not
 * @returns {string} markup
 */
export const tokenCard = (options = {}) => `<div class="card h-100">
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
      </div>
    </form>
  </div>
</div>`;

/**
 * What that token has to be able to do, in github/token.js's sentences. The
 * page's one create button is this card's, under the permissions it names; the
 * classic URL rides the words naming that token, a phrase the suite pins.
 *
 * @returns {string} markup
 */
export const tokenGuidance = () => `<div class="card h-100">
  <div class="card-body">
    <div class="omega-panel-head mb-3"><span>What the token needs</span></div>
    <p class="text-body-secondary">${esc(TOKEN_SCOPES)}</p>
    <p class="text-body-secondary">${esc(TOKEN_CLASSIC).replace(esc(TOKEN_CLASSIC_WORDS), `<a href="${esc(TOKEN_CLASSIC_URL)}" target="_blank" rel="noopener">${esc(TOKEN_CLASSIC_WORDS)}</a>`)}</p>
    <a class="btn btn-outline-adaptive btn-sm" href="${esc(TOKEN_URL)}" target="_blank" rel="noopener">Create a token on GitHub</a>
  </div>
</div>`;

/**
 * What Settings says on a copy with a tower behind it: the machine's API holds
 * the `gh` login, so the token is not this copy's credential.
 *
 * @returns {string} markup
 */
export const towerTokenNote = () => `<p class="text-body-secondary">This copy reads the tower API on this machine, which holds the gh login - it needs no token of its own. A token saved here is what a published copy of this dashboard uses.</p>`;

/**
 * The one line every other page shows when this copy holds no token, and the
 * line left in place of the page when GitHub refuses the token: it points at
 * the one place a token is typed.
 *
 * @param {string} href - the Settings page, carrying the current repo selection
 * @param {string} [problem] - why the token this copy holds did not work
 * @returns {string} markup
 */
export const settingsNotice = (href, problem = '') => `<p class="text-body-secondary mb-0">${problem ? `${esc(problem)} ` : ''}This page has no data until this browser holds a GitHub token that can read it - add one on <a href="${esc(href)}">${SETTINGS_LABEL}</a>.</p>`;

/** Whether the page is being served from the machine the tower runs on. */
export const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/**
 * The same page, pointed at the tower with `?api=`: the whole of the local
 * advice, since the mode is decided from the build and only the override flips
 * it. The origin is the tower's default, not api.js's `API_BASE`: a locked copy
 * had no override, and importing api.js would tie this suite to `location`.
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
 * What a locked copy says on this machine: the tower API is not answering, or
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
 * on the same predicate as the page body so the two never disagree.
 *
 * @param {string} hostname - the host the page was served from
 * @returns {string}
 */
export const lockedIntakeNotice = (hostname) => (isLocalHost(hostname) ? localLockedNotice() : lockedNotice());

/**
 * Wire the token card: store what was typed, or forget what is held, then
 * reload, since the mode is decided once at module load (api.js).
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
    // An empty field is not a request to forget: `writeToken('')` is the
    // clear, so the guard sits before the write.
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
