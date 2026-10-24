// Tests for docs:session's logic: sessionContext({ path, state, brief, repoSlug, now }) and briefLine(brief, repoSlug, now)
// in hooks/mods/session.js. The state handed back with its closing lines, the light bar, and the line naming a cloud
// brief that stopped arriving. Each case ports the HEAD case its name quotes; every date counts from SESSION_NOW.

// HEAD cases ported in test/mods/session-start.test.ts: "a compaction gets it too: every source, not just startup",
// "a session opened in a subdirectory finds the repo root", "hooks.json registers the hook under SessionStart, for
// every source", "the owner hears it: the resume line rides the visible channel too", "a repo that never opted in:
// silent, even with content", "a repo that turned the workflow off: silent".

// Also ported there: "a settings file in a cwd that is no git repo: silent", "no cwd in the payload: silent", "the
// marker is read from WORKFLOW_HOME, the folder the 9am job writes it to", "a marker that does not parse: silent", "a
// repo that never opted in hears nothing about the brief either", "the hook reaches no network: the marker is the
// only source".

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
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

const run = async () => {
  group('session: the file is injected when it has content');

  await test('ports "a non-empty session.md is handed back, with the path named"', () => {
    const out = session({ state: filled(['#12: the board sweep, mid-build']) });
    assert(out.context.includes('#12: the board sweep, mid-build'), `the content is in the context: ${out.context}`);
    assert(out.context.includes(`SESSION STATE: ${STATE_PATH}`), `the preamble names the file by its path: ${out.context}`);
    assertEq(out.carried, true, 'a state file with content is carried over');
  });

  group('session: the closing lines');

  await test('ports "the context ends with the owner resume line"', () => {
    const lines = ctx({ state: filled(['#12: the board sweep, mid-build']) }).trimEnd().split('\n');
    assertEq(lines.pop(), OWNER, 'the last line is addressed to the owner');
  });

  await test('ports "the context carries the manager duty line"', () => {
    assert(ctx({ state: filled(['#12: mid-build']) }).includes(MANAGER), 'the first reply after a restart opens with the state');
  });

  await test('ports "a rule separates the file body from the closing lines"', () => {
    const lines = ctx({ state: filled(['#12: mid-build']) }).split('\n');
    const rule = lines.indexOf('---');
    assert(rule > 0, 'the injection carries a --- rule');
    assert(lines.findIndex((l) => l.includes('#12: mid-build')) < rule, 'the file body is above the rule');
    assert(lines.findIndex((l) => l.startsWith('Manager:')) > rule, 'the closing lines are below it');
  });

  group('session: silence');

  await test('ports "no session.md at all: silent exit 0"', () => {
    const out = session({ state: null });
    assertEq(out.context || '', '', 'says nothing');
    assertEq(out.carried, false, 'nothing carried over');
  });

  await test('ports "an empty session.md: silent"', () => {
    const out = session({ state: '' });
    assertEq(out.context || '', '', 'says nothing');
    assertEq(out.carried, false, 'nothing carried over');
  });

  await test('ports "the shipped template, untouched: headings and notes only, silent"', () => {
    const out = session({ state: fs.readFileSync(TEMPLATE, 'utf8') });
    assertEq(out.context || '', '', 'a freshly seeded file counts zero content lines');
    assertEq(out.carried, false, 'nothing carried over');
  });

  await test('ports "a header-only session.md: silent, and the closing lines do not leak"', () => {
    const out = session({ state: filled([]) });
    assertEq(out.context || '', '', 'headings alone say nothing, not even the owner line');
    assertEq(out.carried, false, 'and the owner hears nothing either');
  });

  group('session: the light bar');

  await test('ports "past ~40 content lines the injection says it is a queue, not a journal"', () => {
    const text = ctx({ state: filled(notes(45)) });
    assert(text.includes('note 44'), 'the content is still handed back');
    assert(text.split('\n').some((l) => l.startsWith('NOTE:')), `a NOTE: line is appended: ${text}`);
    assert(/queue, not a journal/.test(text), 'the warning says what the file is');
    assert(text.includes('45 content lines'), 'the warning counts content lines only');
  });

  await test('ports "at the bar there is no warning"', () => {
    const text = ctx({ state: filled(notes(40)) });
    assert(!/queue, not a journal/.test(text), '40 lines is still light');
    assert(!text.split('\n').some((l) => l.startsWith('NOTE:')), 'no NOTE: line');
  });

  await test('one more than the bar is the first warning: 41 content lines', () => {
    const text = ctx({ state: filled(notes(41)) });
    assert(text.includes('41 content lines'), `41 is past the bar: ${text}`);
  });

  group('session: the cloud brief went quiet');

  await test('ports "a brief days old is named, with the fix and the check"', () => {
    const text = ctx({ brief: briefMarker(10), repoSlug: 'owner/private-home' });
    assert(text.includes(`cloud brief: last posted ${daysBefore(10)} (10 days ago)`), `the line names the date and the gap: ${text}`);
    assert(text.includes('workkit setup --token'), `the fix is the token mint: ${text}`);
    assert(text.includes('gh run list --repo owner/private-home --workflow brief.yml'), `and the check names the home repo: ${text}`);
  });

  await test('ports "the line rides alone: no session.md is still a session that hears it"', () => {
    const out = session({ brief: briefMarker(4) });
    assert(out.context.startsWith('cloud brief: last posted'), `the alert is the whole context: ${out.context}`);
    assert(!out.context.includes('SESSION STATE'), 'there is no state to hand back');
    assertEq(out.carried, false, 'an alert-only injection speaks to the model alone');
  });

  await test('ports "a machine that has not checked in days names itself, not the runner"', () => {
    const text = ctx({ brief: briefMarker(10, 5), repoSlug: 'owner/private-home' });
    assert(text.includes(`last posted ${daysBefore(10)} (10 days ago)`), `the staleness is still reported: ${text}`);
    assert(text.includes(`this machine last checked ${daysBefore(5)}`), `and the marker's own age is named: ${text}`);
    assert(!text.includes('fresh token'), 'the runner is not blamed for a machine that was off');
    assert(!text.includes('workkit setup --token'), 'and no token is minted over it');
    assert(text.includes('gh run list --repo owner/private-home --workflow brief.yml'), `the check still rides: ${text}`);
  });

  await test('ports "a check from yesterday is a current marker: the runner wording stands"', () => {
    const text = brief(briefMarker(9, 1));
    assert(text.includes('the runner likely needs a fresh token; fix: workkit setup --token'),
      `one day is the ordinary morning on this side of the marker too: ${text}`);
    assert(!text.includes('this machine last checked'), 'the machine is not blamed for a board it did read');
  });

  await test('ports "a marker with no checkedAt at all: silent"', () => {
    assertEq(brief({ version: 1, lastBrief: daysBefore(8) }), '',
      'without knowing when it was written, the marker cannot say whose silence it is');
    assertEq(ctx({ brief: { version: 1, lastBrief: daysBefore(8) } }), '', 'and the whole context is silent');
  });

  await test('ports "with no home repo named, the check clause is left off rather than guessed"', () => {
    const text = brief(briefMarker(3));
    assert(text.includes('workkit setup --token'), 'the fix is still there');
    assert(!text.includes('gh run list'), `and nothing is invented to check: ${text}`);
  });

  await test('ports "the alert leads, and the session state keeps its own closing lines"', () => {
    const out = session({ state: filled(['#12: mid-build']), brief: briefMarker(5) });
    assert(out.context.startsWith('cloud brief: last posted'), `the alert is first: ${out.context.slice(0, 80)}`);
    assert(out.context.includes('#12: mid-build'), 'the state is still handed back');
    assert(out.context.trimEnd().endsWith('resumes the queue above.'), 'and the owner line is still last');
    assertEq(out.carried, true, 'the visible channel still carries the owner line');
  });

  await test('ports "a brief posted yesterday is not stale: one day is the ordinary morning"', () => {
    assertEq(brief(briefMarker(1)), '', 'says nothing');
  });

  await test('ports "two days is the first stale morning"', () => {
    const text = brief(briefMarker(2));
    assert(text.includes('(2 days ago)'), `the bar is one whole day: ${text}`);
  });

  await test('ports "no marker at all: silent, the machine that has never run the job"', () => {
    assertEq(brief(null), '', 'nothing is claimed about a board nobody has read');
    assertEq(ctx({ brief: null }), '', 'and the whole context is silent');
  });

  // Each HEAD marker, then the same marker checked today, so a missing checkedAt is not what silences it.
  await test('ports "a marker whose date is not one: silent"', () => {
    assertEq(brief({ version: 1, lastBrief: 'never' }), '', 'nothing is counted from a non-date');
    assertEq(brief({ version: 1, lastBrief: 'never', checkedAt: `${daysBefore(0)}T09:00:00Z` }), '',
      'nor from a non-date checked today');
  });

  await test('ports "a marker dated in the future: silent"', () => {
    assertEq(brief({ version: 1, lastBrief: daysBefore(-3) }), '', 'a negative gap is nobody\'s stale brief');
    assertEq(brief({ version: 1, lastBrief: daysBefore(-3), checkedAt: `${daysBefore(0)}T09:00:00Z` }), '',
      'checked today or not');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
