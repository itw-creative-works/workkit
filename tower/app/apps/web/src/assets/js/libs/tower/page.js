//
// The page runtime every tower page boots into.
//
// It owns the things that are the same on all six pages: which feeds this page
// needs, how often each is re-read, the repo selection held in `?repo=`, the
// chrome that lets you change it, and the paint loop. A page module supplies a
// mount id, the feeds it reads, and one `render(root, state)` — nothing else.
//
// Polling cadence is the tower's old one: the board every 60 seconds (a gh
// sweep is expensive), everything live every 10. The brief is built from the
// board sweep and is never fresher than it, so it shares that cadence.
//
// Reading the state back out is state.js, which this file does not import: a
// page asks the runtime to run it and asks state.js what the answers were.
//
// The loop calls render() on every answer and on every tick; what reaches the
// DOM is decided further down, by loading.js's `swap` in each page's render, so
// a tick that changed nothing leaves the page — and its focus, its scroll and
// its open `details` — exactly as it was.
//

import omega from '@omega.js/client';
import { fetchFeed } from './api.js';
import { loadCharts } from './charts.js';
import { esc } from './format.js';
import { repos } from './state.js';

/** Every feed the API offers, with its path and its re-read interval. */
const FEEDS = {
  repos: { path: '/api/repos', every: 10000, fresh: '/api/repos?fresh=1' },
  board: { path: '/api/board', every: 60000, fresh: '/api/board?fresh=1' },
  brief: { path: '/api/brief', every: 60000 },
  sessions: { path: '/api/sessions', every: 10000 },
  health: { path: '/api/health', every: 10000 },
  telemetry: { path: '/api/telemetry', every: 10000 },
};

// ── The repo selection ─────────────────────────────────────────────────────

/** The repo the whole tower is narrowed to, or '' for all of them. */
export const selectedRepo = () => new URL(location.href).searchParams.get('repo') || '';

const writeSelectedRepo = (slug) => {
  const url = new URL(location.href);
  if (slug) url.searchParams.set('repo', slug);
  else url.searchParams.delete('repo');
  history.replaceState(null, '', url);
};

// ── The chrome ─────────────────────────────────────────────────────────────
//
// The repo selector lives here, in the page's own chrome, and NOT in the
// sidebar's `selector` block. The sidebar is a JSON file baked at build time;
// the roster is whatever repos are on the machine when the page is open, read
// from /api/repos. A build-time file cannot hold a runtime list, so the
// selector is drawn where the data is.

const chromeMarkup = (state) => {
  const slugs = repos(state).map((repo) => repo.slug).filter(Boolean);
  const stale = Object.entries(state.feeds).filter(([, result]) => result && (!result.ok || result.stale));
  return `<div class="d-flex flex-wrap align-items-end gap-2 mb-4">
    <label class="flex-grow-0">
      <span class="classy-micro d-block">Repository</span>
      <select class="form-select form-select-sm" id="tower-repo" aria-label="Filter every page by repository">
        <option value=""${state.selectedRepo ? '' : ' selected'}>All repos${slugs.length ? ` (${slugs.length})` : ''}</option>
        ${slugs.map((slug) => `<option value="${esc(slug)}"${slug === state.selectedRepo ? ' selected' : ''}>${esc(slug)}</option>`).join('')}
      </select>
    </label>
    <button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-refresh">Refresh</button>
    <span class="classy-micro text-body-secondary ms-auto d-flex align-items-center gap-2">
      ${state.pending ? '<span class="spinner-border spinner-border-sm" role="status" aria-label="Reading"></span>' : ''}
      ${esc(state.stamp || 'reading…')}
    </span>
    ${stale.length ? `<span class="classy-chip classy-chip--accent" title="${esc(stale.map(([name, result]) => `${name}: ${result.stale || result.reason}`).join(' · '))}">${stale.length} feed${stale.length === 1 ? '' : 's'} unavailable</span>` : ''}
  </div>`;
};

// ── The runtime ────────────────────────────────────────────────────────────

/**
 * Boot a page.
 *
 * @param {object} options
 * @param {string} options.mount - the id of the page's one mount div
 * @param {string[]} options.feeds - which API feeds this page reads
 * @param {(root: HTMLElement, state: object) => void} options.render - draws the page body
 * @param {boolean} [options.charts] - whether to pull Chart.js in before the first paint
 * @returns {Promise<void>}
 */
export async function startPage(options) {
  await omega.dom().ready();

  const host = document.getElementById(options.mount);
  // The mount is the page's contract with its markdown file. If it is missing,
  // the page was renamed and this module is bound to nothing — say so once
  // rather than throwing on every poll.
  if (!host) {
    console.warn(`[tower] no #${options.mount} on this page — nothing to draw into`);
    return;
  }

  host.innerHTML = '<div data-tower-chrome></div><div data-tower-body></div>';
  const chrome = host.querySelector('[data-tower-chrome]');
  const body = host.querySelector('[data-tower-body]');

  // `pending` is how many reads are in flight, which the chrome's spinner is
  // drawn from: a refresh is visible while it happens, and the page under it
  // keeps showing the data it already has.
  const state = { feeds: {}, selectedRepo: selectedRepo(), stamp: '', pending: 0 };

  const paint = () => {
    chrome.innerHTML = chromeMarkup(state);
    chrome.querySelector('#tower-repo').addEventListener('change', (event) => {
      state.selectedRepo = event.target.value;
      writeSelectedRepo(state.selectedRepo);
      paint();
    });
    chrome.querySelector('#tower-refresh').addEventListener('click', () => readAll(true));
    options.render(body, state);
  };

  const read = async (name, fresh) => {
    const spec = FEEDS[name];
    state.pending += 1;
    paint();
    const answer = await fetchFeed(fresh && spec.fresh ? spec.fresh : spec.path);
    const previous = state.feeds[name];
    state.pending -= 1;

    // A refresh that fails does not take the page down with it. The last good
    // answer stays on screen, marked stale so the chrome can say a feed is
    // unavailable — replacing a full board with an error line because one poll
    // missed is the "clearing to empty" this is here to prevent.
    state.feeds[name] = !answer.ok && previous && previous.ok
      ? { ...previous, stale: answer.reason }
      : answer;
    state.stamp = `updated ${new Date().toLocaleTimeString()}`;
    paint();
  };

  const readAll = (fresh) => Promise.all(options.feeds.map((name) => read(name, fresh)));

  // First paint before anything answers, so the page is never a blank region.
  paint();

  if (options.charts) {
    await loadCharts();
    paint();
  }

  await readAll(false);

  for (const name of options.feeds) {
    setInterval(() => { read(name, false); }, FEEDS[name].every);
  }
}
