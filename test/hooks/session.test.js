// Tests for docs:session's logic: sessionContext({ path, state, brief, repoSlug, now }) and briefLine(brief, repoSlug, now)
// in hooks/mods/session.js. The state handed back with its closing lines, the light bar, and the line naming a cloud
// brief that stopped arriving; every date counts from SESSION_NOW. The wiring (every source, the repo root, the
// opt-in, the visible channel, the brief marker's read) is test/mods/session-start.test.ts.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, WORKKIT_DIR: W } = require('../lib/harness');
const {
  mods, textOf, sessionFacts, daysBefore, briefMarker,
} = require('../lib/mods-inputs');

const TEMPLATE = path.join(__dirname, '..', '..', 'workflow', 'templates', 'session.md');
const OWNER = 'Owner: state carried over. Say "continue" and this session resumes the queue above.';
const MANAGER = 'Manager: open your first reply after a restart or compaction with this state in plain words.';

// The state file's absolute path, which the SESSION STATE line names; every call carries it.
const STATE_PATH = `/w/repo/${W}/agents/session.md`;
const session = (facts) => mods('session').sessionContext({ ...sessionFacts(facts), path: STATE_PATH });
const ctx = (facts) => session(facts).context || '';
const brief = (marker, repoSlug = null) => textOf(mods('session').briefLine(marker, repoSlug, sessionFacts().now));

const filled = (lines) => [
  '# Session',
  '',
  '## Active',
  ...lines.map((l) => `- ${l}`),
  '',
  '## Queue',
  '',
  '## Notes',
  '',
].join('\n');

const notes = (n) => Array.from({ length: n }, (_, i) => `note ${i}`);

describe('session: the file is injected when it has content', () => {
  test('a non-empty session.md is handed back, with the path named', () => {
    const out = session({ state: filled(['#12: the board sweep, mid-build']) });
    expect(out.context.includes('#12: the board sweep, mid-build'), `the content is in the context: ${out.context}`).toBeTruthy();
    expect(out.context.includes(`SESSION STATE: ${STATE_PATH}`), `the preamble names the file by its path: ${out.context}`).toBeTruthy();
    expect(out.carried, 'a state file with content is carried over').toBe(true);
  });
});

describe('session: the closing lines', () => {
  test('the context ends with the owner resume line', () => {
    const lines = ctx({ state: filled(['#12: the board sweep, mid-build']) }).trimEnd().split('\n');
    expect(lines.pop(), 'the last line is addressed to the owner').toBe(OWNER);
  });

  test('the context carries the manager duty line', () => {
    expect(ctx({ state: filled(['#12: mid-build']) }).includes(MANAGER), 'the first reply after a restart opens with the state').toBeTruthy();
  });

  test('a rule separates the file body from the closing lines', () => {
    const lines = ctx({ state: filled(['#12: mid-build']) }).split('\n');
    const rule = lines.indexOf('---');
    expect(rule > 0, 'the injection carries a --- rule').toBeTruthy();
    expect(lines.findIndex((l) => l.includes('#12: mid-build')) < rule, 'the file body is above the rule').toBeTruthy();
    expect(lines.findIndex((l) => l.startsWith('Manager:')) > rule, 'the closing lines are below it').toBeTruthy();
  });
});

describe('session: silence', () => {
  test('no session.md at all: silent exit 0', () => {
    const out = session({ state: null });
    expect(out.context || '', 'says nothing').toBe('');
    expect(out.carried, 'nothing carried over').toBe(false);
  });

  test('an empty session.md: silent', () => {
    const out = session({ state: '' });
    expect(out.context || '', 'says nothing').toBe('');
    expect(out.carried, 'nothing carried over').toBe(false);
  });

  test('the shipped template, untouched: headings and notes only, silent', () => {
    const out = session({ state: fs.readFileSync(TEMPLATE, 'utf8') });
    expect(out.context || '', 'a freshly seeded file counts zero content lines').toBe('');
    expect(out.carried, 'nothing carried over').toBe(false);
  });

  test('a header-only session.md: silent, and the closing lines do not leak', () => {
    const out = session({ state: filled([]) });
    expect(out.context || '', 'headings alone say nothing, not even the owner line').toBe('');
    expect(out.carried, 'and the owner hears nothing either').toBe(false);
  });
});

describe('session: the light bar', () => {
  test('past ~40 content lines the injection says it is a queue, not a journal', () => {
    const text = ctx({ state: filled(notes(45)) });
    expect(text.includes('note 44'), 'the content is still handed back').toBeTruthy();
    expect(text.split('\n').some((l) => l.startsWith('NOTE:')), `a NOTE: line is appended: ${text}`).toBeTruthy();
    expect(/queue, not a journal/.test(text), 'the warning says what the file is').toBeTruthy();
    expect(text.includes('45 content lines'), 'the warning counts content lines only').toBeTruthy();
  });

  test('at the bar there is no warning', () => {
    const text = ctx({ state: filled(notes(40)) });
    expect(!/queue, not a journal/.test(text), '40 lines is still light').toBeTruthy();
    expect(!text.split('\n').some((l) => l.startsWith('NOTE:')), 'no NOTE: line').toBeTruthy();
  });

  test('one more than the bar is the first warning: 41 content lines', () => {
    const text = ctx({ state: filled(notes(41)) });
    expect(text.includes('41 content lines'), `41 is past the bar: ${text}`).toBeTruthy();
  });
});

describe('session: the cloud brief went quiet', () => {
  test('a brief days old is named, with the fix and the check', () => {
    const text = ctx({ brief: briefMarker(10), repoSlug: 'owner/private-home' });
    expect(text.includes(`cloud brief: last posted ${daysBefore(10)} (10 days ago)`), `the line names the date and the gap: ${text}`).toBeTruthy();
    expect(text.includes('workkit setup --token'), `the fix is the token mint: ${text}`).toBeTruthy();
    expect(text.includes('gh run list --repo owner/private-home --workflow brief.yml'), `and the check names the home repo: ${text}`).toBeTruthy();
  });

  test('the line rides alone: no session.md is still a session that hears it', () => {
    const out = session({ brief: briefMarker(4) });
    expect(out.context.startsWith('cloud brief: last posted'), `the alert is the whole context: ${out.context}`).toBeTruthy();
    expect(!out.context.includes('SESSION STATE'), 'there is no state to hand back').toBeTruthy();
    expect(out.carried, 'an alert-only injection speaks to the model alone').toBe(false);
  });

  test('a machine that has not checked in days names itself, not the runner', () => {
    const text = ctx({ brief: briefMarker(10, 5), repoSlug: 'owner/private-home' });
    expect(text.includes(`last posted ${daysBefore(10)} (10 days ago)`), `the staleness is still reported: ${text}`).toBeTruthy();
    expect(text.includes(`this machine last checked ${daysBefore(5)}`), `and the marker's own age is named: ${text}`).toBeTruthy();
    expect(!text.includes('fresh token'), 'the runner is not blamed for a machine that was off').toBeTruthy();
    expect(!text.includes('workkit setup --token'), 'and no token is minted over it').toBeTruthy();
    expect(text.includes('gh run list --repo owner/private-home --workflow brief.yml'), `the check still rides: ${text}`).toBeTruthy();
  });

  test('a check from yesterday is a current marker: the runner wording stands', () => {
    const text = brief(briefMarker(9, 1));
    expect(text.includes('the runner likely needs a fresh token; fix: workkit setup --token'),
      `one day is the ordinary morning on this side of the marker too: ${text}`).toBeTruthy();
    expect(!text.includes('this machine last checked'), 'the machine is not blamed for a board it did read').toBeTruthy();
  });

  test('a marker with no checkedAt at all: silent', () => {
    expect(brief({ version: 1, lastBrief: daysBefore(8) }), 'without knowing when it was written, the marker cannot say whose silence it is').toBe('');
    expect(ctx({ brief: { version: 1, lastBrief: daysBefore(8) } }), 'and the whole context is silent').toBe('');
  });

  test('with no home repo named, the check clause is left off rather than guessed', () => {
    const text = brief(briefMarker(3));
    expect(text.includes('workkit setup --token'), 'the fix is still there').toBeTruthy();
    expect(!text.includes('gh run list'), `and nothing is invented to check: ${text}`).toBeTruthy();
  });

  test('the alert leads, and the session state keeps its own closing lines', () => {
    const out = session({ state: filled(['#12: mid-build']), brief: briefMarker(5) });
    expect(out.context.startsWith('cloud brief: last posted'), `the alert is first: ${out.context.slice(0, 80)}`).toBeTruthy();
    expect(out.context.includes('#12: mid-build'), 'the state is still handed back').toBeTruthy();
    expect(out.context.trimEnd().endsWith('resumes the queue above.'), 'and the owner line is still last').toBeTruthy();
    expect(out.carried, 'the visible channel still carries the owner line').toBe(true);
  });

  test('a brief posted yesterday is not stale: one day is the ordinary morning', () => {
    expect(brief(briefMarker(1)), 'says nothing').toBe('');
  });

  test('two days is the first stale morning', () => {
    const text = brief(briefMarker(2));
    expect(text.includes('(2 days ago)'), `the bar is one whole day: ${text}`).toBeTruthy();
  });

  test('no marker at all: silent, the machine that has never run the job', () => {
    expect(brief(null), 'nothing is claimed about a board nobody has read').toBe('');
    expect(ctx({ brief: null }), 'and the whole context is silent').toBe('');
  });

  // Each HEAD marker, then the same marker checked today, so a missing checkedAt is not what silences it.
  test('a marker whose date is not one: silent', () => {
    expect(brief({ version: 1, lastBrief: 'never' }), 'nothing is counted from a non-date').toBe('');
    expect(brief({ version: 1, lastBrief: 'never', checkedAt: `${daysBefore(0)}T09:00:00Z` }), 'nor from a non-date checked today').toBe('');
  });

  test('a marker dated in the future: silent', () => {
    expect(brief({ version: 1, lastBrief: daysBefore(-3) }), 'a negative gap is nobody\'s stale brief').toBe('');
    expect(brief({ version: 1, lastBrief: daysBefore(-3), checkedAt: `${daysBefore(0)}T09:00:00Z` }), 'checked today or not').toBe('');
  });
});
