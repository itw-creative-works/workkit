//
// The page runtime every tower page boots into.
//
// It owns the things that are the same on all six pages: which feeds this page
// needs, how often each is re-read, the repo selection held in `?repo=`, the
// chrome that lets you change it, and the paint loop. A page module supplies a
// mount id, the feeds it reads, and one `render(root, state)` — nothing else.
//
// Polling cadence is the tower's old one: the board every 60 seconds (a gh
// sweep is expensive), everything live every 10.
//

import omega from '@omega.js/client';
import { fetchFeed } from './api.js';
import { loadCharts } from './charts.js';
import { esc } from './format.js';

/** Every feed the API offers, with its path and its re-read interval. */
const FEEDS = {
  repos: { path: '/api/repos', every: 10000, fresh: '/api/repos?fresh=1' },
  board: { path: '/api/board', every: 60000, fresh: '/api/board?fresh=1' },
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

// ── Reading the state ──────────────────────────────────────────────────────

/** The raw result of one feed: `{ ok, data, status, reason }`, or null before its first read. */
export const feed = (state, name) => state.feeds[name] || null;

/** The roster, or [] when it has not answered. */
export const repos = (state) => {
  const result = feed(state, 'repos');
  return result && result.ok && Array.isArray(result.data) ? result.data : [];
};

/** The board payload, or null. */
export const board = (state) => {
  const result = feed(state, 'board');
  return result && result.ok ? result.data : null;
};

/** The live sessions, or []. */
export const sessions = (state) => {
  const result = feed(state, 'sessions');
  return result && result.ok && Array.isArray(result.data) ? result.data : [];
};

/** The per-repo health map, keyed by repo path, or {}. */
export const health = (state) => {
  const result = feed(state, 'health');
  return result && result.ok && result.data ? result.data : {};
};

/** The roster entries the selection leaves in play. */
export const reposFor = (state) => repos(state).filter((repo) => !state.selectedRepo || repo.slug === state.selectedRepo);

/** The open issues the selection leaves in play. */
export const issuesFor = (state) => {
  const payload = board(state);
  return ((payload && payload.issues) || []).filter((issue) => !state.selectedRepo || issue.repo === state.selectedRepo);
};

/**
 * Whether a working directory sits in the repo the selection names — the one
 * rule that places anything with a `cwd`, so the pages that read a different
 * feed of sessions all place them the same way.
 *
 * @param {object} state the runtime's state
 * @param {string} cwd the working directory to place
 * @returns {boolean} true when nothing is selected, or when the cwd is the
 *   selected repo or sits under it
 */
export const inSelectedRepo = (state, cwd) => {
  if (!state.selectedRepo) return true;
  const paths = repos(state).filter((repo) => repo.slug === state.selectedRepo).map((repo) => repo.path);
  return paths.some((base) => cwd === base || String(cwd || '').startsWith(`${base}/`));
};

/** The live sessions the selection leaves in play — a session is placed by its cwd. */
export const sessionsFor = (state) => sessions(state).filter((session) => inSelectedRepo(state, session.cwd));

// ── The chrome ─────────────────────────────────────────────────────────────
//
// The repo selector lives here, in the page's own chrome, and NOT in the
// sidebar's `selector` block. The sidebar is a JSON file baked at build time;
// the roster is whatever repos are on the machine when the page is open, read
// from /api/repos. A build-time file cannot hold a runtime list, so the
// selector is drawn where the data is.

const chromeMarkup = (state) => {
  const slugs = repos(state).map((repo) => repo.slug).filter(Boolean);
  const stale = Object.entries(state.feeds).filter(([, result]) => result && !result.ok);
  return `<div class="d-flex flex-wrap align-items-end gap-2 mb-4">
    <label class="flex-grow-0">
      <span class="classy-micro d-block">Repository</span>
      <select class="form-select form-select-sm" id="tower-repo" aria-label="Filter every page by repository">
        <option value=""${state.selectedRepo ? '' : ' selected'}>All repos${slugs.length ? ` (${slugs.length})` : ''}</option>
        ${slugs.map((slug) => `<option value="${esc(slug)}"${slug === state.selectedRepo ? ' selected' : ''}>${esc(slug)}</option>`).join('')}
      </select>
    </label>
    <button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-refresh">Refresh</button>
    <span class="classy-micro text-body-secondary ms-auto">${esc(state.stamp || 'reading…')}</span>
    ${stale.length ? `<span class="classy-chip classy-chip--accent" title="${esc(stale.map(([name, result]) => `${name}: ${result.reason}`).join(' · '))}">${stale.length} feed${stale.length === 1 ? '' : 's'} unavailable</span>` : ''}
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

  const state = { feeds: {}, selectedRepo: selectedRepo(), stamp: '' };

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
    state.feeds[name] = await fetchFeed(fresh && spec.fresh ? spec.fresh : spec.path);
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
