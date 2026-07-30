//
// The token prompt — what a published copy shows before it has been unlocked.
//
// The published site bakes no data at all: it reads GitHub live — and moves and
// files issues there — with a fine-grained personal access token the viewer
// hands over (issue #81). With no token there is nothing to draw and nothing to
// write with, so the prompt IS the page — every page, until one is stored.
//
// It says three things and asks for one: what to create, which permissions it
// needs, and where the token is kept. The token is written to this browser's
// localStorage and is never sent anywhere but api.github.com — no repo, no
// build, no URL, no server.
//
// Split the way every other lib here is: `tokenPrompt()` is a pure string
// function the suite can ask questions of, and `mountTokenPrompt()` is the one
// listener the markup needs — the submit that stores what was typed.
//

import { esc } from './format.js';
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
