// The behavior behind the topbar's "File an issue" dialog: the roster in the
// select and the submit. The markup is the layout's; it mounts from the main
// bundle because the dialog rides every page. Whatever was typed survives a
// refusal: only a filed issue clears the form.

import { readAnyFeed, submitIntake, WRITABLE } from './api.js';
import { selectedRepo } from './page.js';
import { parseRepos } from './scope.js';
import { esc } from './format.js';
import { isLocalHost, lockedIntakeNotice } from './token.js';

/** The roster select, filled from /api/repos. An empty roster is a state, not an error. */
const fillRepos = async (select) => {
  // The page's scope pre-selects a repo only when it names exactly one; a
  // subset names no particular repo to file into.
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
 * The locked shape of the dialog: every field that would file is disabled and
 * the notice says what fixes it, forked on token.js's `isLocalHost` like the
 * locked page body. The topbar button stays enabled: a disabled trigger hides
 * its tooltip and the dialog, the one place the reason can be read.
 */
const disableIntake = (dialog) => {
  for (const field of dialog.querySelectorAll('input, textarea, select, [data-intake-submit]')) {
    field.disabled = true;
  }
  const select = dialog.querySelector('[data-intake-repo]');
  const local = isLocalHost(location.hostname);
  select.innerHTML = `<option value="">${local ? 'no roster until the Workkit API is running' : 'no roster until a token is added'}</option>`;
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

  // The roster is read when the dialog opens, not at page load: a repo added
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
