//
// Health - only what is broken.
//
// Every other page says what the work IS. This one says what is WRONG with the
// machine the work happens on, and nothing else: a number that is fine has no
// business here, and an unanswered issue is the Board's business rather than
// this page's (issue #182). So there is no per-repo stat grid, no open or
// blocked count and no status doughnut - what the page draws is a list of
// problems, each one said as the problem it is and carrying the act that ends
// it, and a repo in good order is not on the page at all.
//
// On a good morning that leaves nothing to draw, which is its own answer: the
// page says the machine is clean in one line rather than going blank.
//

import { startPage } from '../libs/tower/page.js';
import { reposFor, brief, health, feed } from '../libs/tower/state.js';
import { esc, empty, problem, loading, card } from '../libs/tower/format.js';
import { swap } from '@omega.js/client/modules/live-page';
import { briefAlert } from '../libs/tower/history.js';

// ── The process behind the page ────────────────────────────────────────────
// The API holds the code it started with, so a tower left running past a pull
// answers from the old one (issue #64 was exactly that, and nothing said so).
// The meta block names both commits; they differ only when a restart is owed,
// and either one absent says nothing at all. The start time rides WITH the
// notice rather than sitting on the page in its own right - on a tower that is
// current it is a neutral fact, and beside a stale one it is how long the page
// has been answering from the old code.
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
      ${problem(`the tower API is running commit ${short(meta.bootCommit)}, and the checkout is at ${short(meta.currentHead)} - restart it with npm run tower`)}
      ${processLine(meta)}
    </div>`
  : '');

// ── The morning that never came ────────────────────────────────────────────
// The other thing that can be stale here (issue #172), and the one nothing on
// the tower used to say: the CLOUD brief, which failed every day for ten days
// behind a dashboard that looked healthy. This page is where a thing that
// stopped working belongs, so the row leads it, naming the morning it last
// posted. The sentence and the level are the lib's, shared with the Brief page.
const briefRow = (state) => {
  const alert = briefAlert(brief(state));
  return alert ? `<div class="alert alert-${esc(alert.level)} mb-4">${esc(alert.text)}</div>` : '';
};

// ── What is wrong with one working copy ────────────────────────────────────
// Four states, each one a thing that is TRUE of the checkout right now, and
// each paired with the single act that ends it. A reading with none of them is
// a repo that never appears.
//
// `unpushed: null` is not a smaller number than 1: it means the branch has no
// upstream, so every commit on it exists on this disk and nowhere else. The API
// keeps that apart from "level with an upstream" for exactly this reason
// (tower/api/lib/health.js), and a page comparing it with `> 0` would report the
// checkout that was never pushed as the healthiest one on the list.
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
 * Stacked blocks rather than a list, because the only lists this app draws are
 * of issues and every one of them goes through the modal helper (pinned in the
 * app suite); a fault is a sentence with its remedy under it, not a row.
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
 * Louder than any count, because it is the state in which every OTHER line here
 * is unknown: nothing on this page can say whether that repo is committed,
 * pushed or released, so it is drawn as the alarm rather than as a card among
 * the ones that carry numbers.
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
    swap(root, roster ? empty('no repos in the roster - nothing has opted in under the roster root', 'fa-regular fa-square-plus') : loading('reading the roster…'));
    return;
  }
  // Before the readings land there is nothing to judge, and "nothing is broken"
  // said over an unread machine is the one sentence this page must never say.
  if (!readings) {
    swap(root, loading('reading the working copies…'));
    return;
  }

  const broken = [];
  const dirty = [];
  for (const repo of list) {
    const reading = health(state)[repo.path];
    // A repo the readings do not carry yet - the roster answered first. Not a
    // fault, and not a clean bill either; it is simply not spoken for.
    if (!reading) continue;
    if (reading.error) broken.push(unreadable(repo, reading));
    else {
      const faults = faultsOf(reading);
      if (faults.length) dirty.push(faultCard(repo, faults));
    }
  }

  const meta = health(state).meta;
  // A brief feed that FAILED is a problem this page owns, like a failed health
  // read: without it the stale-brief question is unanswerable (#182 verify).
  const briefProblem = briefFeed && !briefFeed.ok ? `<div class="mb-4">${problem(briefFeed.reason)}</div>` : '';
  const alarms = `${briefRow(state)}${restartNotice(meta)}${readings.ok ? '' : `<div class="mb-4">${problem(readings.reason)}</div>`}${briefProblem}${broken.join('')}`;
  const body = `${alarms}${dirty.length ? `<div class="row g-4">${dirty.join('')}</div>` : ''}`;
  // The all-clear names the brief as current, so it waits for the brief feed
  // the way the whole page waits for the readings - "nothing is broken" said
  // over an unanswered sweep is the sentence this page must never say.
  swap(root, body || (briefFeed ? allClear() : loading('reading the brief history…')));
};

export default () => startPage({
  mount: 'tower-health',
  // Three feeds, one question each: which repos are in scope, what their
  // working copies say, and whether the cloud brief still posts (#172). The
  // board is not among them - an open issue is the Board's business, and this
  // page reads no count of them.
  feeds: ['repos', 'health', 'brief'],
  // Unpushed, uncommitted and unreleased are facts about the working copies on
  // this machine - a browser elsewhere cannot see them.
  local: true,
  render,
});
