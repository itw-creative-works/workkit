// Health: only what is broken on this machine, each fault with the act that ends
// it, and one all-clear line when nothing is (tower/README.md § The pages).

import { startPage } from '../libs/tower/page.js';
import { reposFor, brief, health, feed } from '../libs/tower/state.js';
import { isNone, selectedSlugs } from '../libs/tower/scope.js';
import { esc, empty, problem, loading, card } from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { briefAlert } from '../libs/tower/history.js';

// ── The process behind the page ────────────────────────────────────────────
// The API holds the code it started with; the two commits differ only when a
// restart is owed, and either one absent says nothing. The start time rides
// with the notice, where it says how long the old code has been answering.
const short = (sha) => String(sha || '').slice(0, 7);

const stale = (meta) => Boolean(meta && meta.bootCommit && meta.currentHead && meta.bootCommit !== meta.currentHead);

const processLine = (meta) => {
  const when = new Date(meta.startedAt);
  return Number.isNaN(when.getTime())
    ? ''
    : `<p class="omega-micro text-body-secondary mb-0">${esc(`API started ${when.toLocaleString()}`)}</p>`;
};

const restartNotice = (meta) => (stale(meta)
  ? `<div class="mb-4">
      ${problem(`the Workkit API is running commit ${short(meta.bootCommit)}, and the checkout is at ${short(meta.currentHead)} - restart it with npm run tower`)}
      ${processLine(meta)}
    </div>`
  : '');

// ── The morning that never came ────────────────────────────────────────────
// The stale cloud brief, naming the morning it last posted; the sentence is the
// lib's, shared with the Brief page.
const briefRow = (state) => {
  const alert = briefAlert(brief(state));
  return alert ? `<div class="alert alert-${esc(alert.level)} mb-4">${esc(alert.text)}</div>` : '';
};

// ── What is wrong with one working copy ────────────────────────────────────
// Each fault is paired with the act that ends it. `unpushed: null` means no
// upstream at all, never zero: a `> 0` test would call the never-pushed
// checkout the healthiest one (tower/api/lib/health.js).
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const them = (count) => (count === 1 ? 'it' : 'them');

const faultsOf = (reading) => {
  const faults = [];
  if (reading.uncommitted > 0) {
    faults.push({
      wrong: plural(reading.uncommitted, 'uncommitted file', 'uncommitted files'),
      fix: `commit ${them(reading.uncommitted)}`,
    });
  }
  if (reading.unpushed === null) {
    faults.push({ wrong: 'no upstream branch', fix: 'nothing here has ever been pushed - push it with git push -u' });
  } else if (reading.unpushed > 0) {
    faults.push({
      wrong: plural(reading.unpushed, 'unpushed commit', 'unpushed commits'),
      fix: `push ${them(reading.unpushed)}`,
    });
  }
  if (reading.unreleasedEntries > 0) {
    faults.push({
      wrong: plural(reading.unreleasedEntries, 'unreleased CHANGELOG entry', 'unreleased CHANGELOG entries'),
      fix: `release ${them(reading.unreleasedEntries)}`,
    });
  }
  return faults;
};

/**
 * One repo's faults - what is wrong on each line, and under it what ends it.
 *
 * Stacked blocks, not a list: every list this app draws is of issues and goes
 * through the modal helper (pinned in the app suite).
 */
const faultCard = (repo, faults) => `<div class="col-12 col-xl-6">
  ${card(repo.name, faults.map((fault, index) => `<div${index === faults.length - 1 ? '' : ' class="mb-2"'}>
    <p class="mb-0">${esc(fault.wrong)}</p>
    <p class="omega-micro text-body-secondary mb-0">${esc(fault.fix)}</p>
  </div>`).join(''), { chip: faults.length, alarm: true, class: 'h-100' })}
</div>`;

/**
 * A checkout that could not be read at all - the loudest thing on the page.
 *
 * Louder than any count: every other fact about that repo is unknown.
 */
const unreadable = (repo, reading) => `<div class="alert alert-danger mb-4" role="alert">
  <p class="mb-1">${esc(`${repo.name} could not be read`)}</p>
  <p class="omega-micro mb-0">${esc(reading.error)}</p>
  <p class="omega-micro mb-0">nothing on this page knows the state of that checkout - open it and see</p>
</div>`;

/** What a machine with nothing wrong on it says, since a blank page says nothing. */
const allClear = () => empty(
  'Nothing is broken. Every repo is committed, pushed and released, and the brief is current.',
  'fa-regular fa-circle-check',
);

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  const roster = feed(state, 'repos');
  const readings = feed(state, 'health');
  const briefFeed = feed(state, 'brief');
  const list = reposFor(state);

  if (roster && !roster.ok) {
    swap(root, problem(roster.reason));
    return;
  }
  if (!list.length) {
    // An empty scoped list means everything unticked, or an empty roster.
    swap(root, roster ? empty(isNone(selectedSlugs(state)) ? 'no projects selected - tick one in the project menu' : 'no repos in the roster - nothing has opted in under the roster root', 'fa-regular fa-square-plus') : loading('reading the roster…'));
    return;
  }
  // Never say "nothing is broken" over an unread machine.
  if (!readings) {
    swap(root, loading('reading the working copies…'));
    return;
  }

  const broken = [];
  const dirty = [];
  for (const repo of list) {
    const reading = health(state)[repo.path];
    // The roster answered first: not a fault, not a clean bill either.
    if (!reading) continue;
    if (reading.error) broken.push(unreadable(repo, reading));
    else {
      const faults = faultsOf(reading);
      if (faults.length) dirty.push(faultCard(repo, faults));
    }
  }

  const meta = health(state).meta;
  // A failed brief feed is this page's problem: the stale-brief question needs it.
  const briefProblem = briefFeed && !briefFeed.ok ? `<div class="mb-4">${problem(briefFeed.reason)}</div>` : '';
  const alarms = `${briefRow(state)}${restartNotice(meta)}${readings.ok ? '' : `<div class="mb-4">${problem(readings.reason)}</div>`}${briefProblem}${broken.join('')}`;
  const body = `${alarms}${dirty.length ? `<div class="row g-4">${dirty.join('')}</div>` : ''}`;
  // The all-clear names the brief as current, so it waits for the brief feed.
  swap(root, body || (briefFeed ? allClear() : loading('reading the brief history…')));
};

export default () => startPage({
  mount: 'tower-health',
  // No board feed: an open issue is the Board's business.
  feeds: ['repos', 'health', 'brief'],
  // Facts about this machine's working copies; a browser elsewhere cannot see them.
  local: true,
  render,
});
