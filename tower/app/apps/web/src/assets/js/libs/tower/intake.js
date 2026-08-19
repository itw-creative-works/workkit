//
// Intake - the behavior behind the topbar's "File an issue" dialog.
//
// The dialog's markup and its opening are the theme's: _layouts/tower/page.html
// ships the Bootstrap modal and topbar.json's button carries the data
// attributes that open it. This module adds the two things markup cannot know -
// the roster in the select, and what happens when the form is submitted.
//
// It is mounted from the main bundle, not from a page module, because the
// dialog rides EVERY page: mounting it per page would mean six mounts, and a
// page that forgot would silently be the one page with a dead button.
//
// One rule shapes the failure handling: whatever the human typed survives. The
// write is the only authority on whether an intake is valid, and its refusals
// ('title is required', 'unknown repo: …') arrive as a sentence - so the
// dialog shows that sentence and leaves the fields exactly as they were. Only
// a filed issue clears the form.
//
// It files in a PUBLISHED copy too, with the viewer's token: `submitIntake` and
// `readAnyFeed` pick the half that answers (api.js), and everything here is the
// same either way.
//

import { readAnyFeed, submitIntake, WRITABLE } from './api.js';
import { selectedRepo } from './page.js';
import { parseRepos } from './scope.js';
import { esc } from './format.js';
import { isLocalHost, lockedIntakeNotice } from './token.js';

/** The roster select, filled from /api/repos. An empty roster is a state, not an error. */
const fillRepos = async (select) => {
  // The dialog files against ONE repo, so the page's scope pre-selects it only
  // when the scope names exactly one - every repo, or a subset, names no
  // particular repo to file into and the select opens on the roster's first.
  const scoped = parseRepos(selectedRepo());
  const wanted = select.value || (scoped.length === 1 ? scoped[0] : '');
  const result = await readAnyFeed('/api/repos');
  const slugs = result.ok && Array.isArray(result.data) ? result.data.map((repo) => repo.slug).filter(Boolean) : [];

  if (!slugs.length) {
    select.innerHTML = `<option value="">${esc(result.ok ? 'no repos on the roster' : result.reason)}</option>`;
    return;
  }
  select.innerHTML = slugs
    .map((slug) => `<option value="${esc(slug)}"${slug === wanted ? ' selected' : ''}>${esc(slug)}</option>`)
    .join('');
};

const showResult = (host, markup) => { host.innerHTML = markup; };

/**
 * The locked shape of the affordance: filing needs a token, and a locked copy
 * has none - it has no roster to file against either, since even the slug list
 * only becomes useful once something can be read with it. So the form is inert
 * and says the one thing that fixes it - which is not always a token: on this
 * machine it is the tower API, so the notice and the empty roster fork the way
 * the locked page body does, on token.js's one predicate (issue #89).
 *
 * The topbar button stays ENABLED and still opens the dialog - that is the only
 * place the explanation can actually be read. A disabled button suppresses its
 * own `title` tooltip in Chromium, and the dialog is opened by Bootstrap's
 * toggle, so a disabled trigger would leave the reason unreachable. What is
 * disabled is everything that would file: the fields, the roster and the submit.
 * Close still closes.
 */
const disableIntake = (dialog) => {
  for (const field of dialog.querySelectorAll('input, textarea, select, [data-intake-submit]')) {
    field.disabled = true;
  }
  const select = dialog.querySelector('[data-intake-repo]');
  const local = isLocalHost(location.hostname);
  select.innerHTML = `<option value="">${local ? 'no roster until the tower is running' : 'no roster until a token is added'}</option>`;
  showResult(dialog.querySelector('[data-intake-result]'), lockedIntakeNotice(location.hostname));
};

/**
 * Wire the intake dialog on this page.
 *
 * Idempotent by construction - it binds once to the one dialog the layout
 * ships, and does nothing at all on a page without it.
 *
 * @param {Document|HTMLElement} [scope] - where to look for the dialog
 * @returns {void}
 */
export function mountIntake(scope = document) {
  const dialog = scope.querySelector('#tower-intake');
  if (!dialog) return;

  if (!WRITABLE) {
    disableIntake(dialog);
    return;
  }

  const form = dialog.querySelector('[data-intake-form]');
  const select = dialog.querySelector('[data-intake-repo]');
  const submit = dialog.querySelector('[data-intake-submit]');
  const result = dialog.querySelector('[data-intake-result]');

  // The roster is read when the dialog OPENS, not at page load: a repo added
  // to the machine while the tab sat open is on the list the next time it is
  // asked for, and a closed dialog costs the API nothing.
  dialog.addEventListener('show.bs.modal', () => { fillRepos(select); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Filing…';
    showResult(result, '');

    const payload = {
      repo: select.value,
      title: form.querySelector('[name="title"]').value.trim(),
      body: form.querySelector('[name="body"]').value.trim(),
    };
    const answer = await submitIntake(payload);

    submit.disabled = false;
    submit.textContent = label;

    if (!answer.ok) {
      showResult(result, `<div class="alert alert-danger mb-0">${esc(answer.reason)}</div>`);
      return;
    }
    const url = answer.data.url;
    showResult(result, `<div class="alert alert-success mb-0">Filed - <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div>`);
    form.querySelector('[name="title"]').value = '';
    form.querySelector('[name="body"]').value = '';
  });
}
