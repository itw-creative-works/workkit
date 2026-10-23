// Tests for docs:change-tracker's logic, changeTrackerVerdict in
// hooks/mods/change-tracker.js: uncommitted code or unfiled entries block the
// stop with the nag, once per fingerprint of the state. Gathering the facts is
// the wiring's, cased in tests/mods/stop-change-tracker.test.ts.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'hooks', 'mods', 'change-tracker', 'prompt.md');
const PROMPT = 'The working tree has uncommitted code/config changes. Keep the issue true before you stop.';

const CODE = 'Change tracker: uncommitted code changes detected.';
const ENTRIES = 'Change tracker: unfiled entries detected.';
const BOTH = 'Change tracker: uncommitted code changes + unfiled entries detected.';

const judge = (facts) => mods('change-tracker').changeTrackerVerdict({
  stopHookActive: false, porcelain: '', diff: '', untracked: [], inbox: 0, capture: 0, previous: null, prompt: PROMPT, ...facts,
});

// A new app.js, untracked: a name in the status, its content in the file alone.
const NEW_APP = { porcelain: '?? app.js\n', untracked: [{ path: 'app.js', text: 'console.log("hi")' }] };
// A committed app.js edited in place: a status line and a diff.
const EDITED = (to) => ({ porcelain: ' M app.js\n', diff: `diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-one\n+${to}\n` });

const blocksWith = async (facts, reason) => {
  const r = await judge(facts);
  assert(r && typeof r.block === 'string', `must block, got: ${JSON.stringify(r)}`);
  assertEq(r.block, reason, 'the reason');
  return r;
};

const silent = async (facts, label) => {
  const r = await judge(facts);
  assertEq(r ?? null, null, label);
};

const prompt = () => fs.readFileSync(PROMPT_FILE, 'utf8');

const run = async () => {
  group('change-tracker: dirty tree detection');

  await test('ports "clean repo: no output (no block)"', async () => {
    await silent({}, 'a clean repo does not block');
  });

  await test('ports "code change: outputs block decision": the reason and the nag', async () => {
    const r = await blocksWith(NEW_APP, CODE);
    assert(r.context.includes(PROMPT), 'the context carries the nag');
  });

  await test('ports "doc-only changes: no block (only code triggers)"', async () => {
    await silent({ porcelain: '?? README.md\n', untracked: [{ path: 'README.md', text: '# hi' }] }, 'doc-only changes do not block');
  });

  await test('ports "a script under a docs PATH is code: blocks (review finding)"', async () => {
    await blocksWith({ porcelain: ' M hooks/docs/x/run.sh\n', diff: '-echo hi\n+echo tweaked\n' }, CODE);
  });

  await test('ports "a .md under a docs path is still docs: no block"', async () => {
    await silent({ porcelain: ' M docs/notes.md\n', diff: '-# notes\n+# notes, edited\n' }, 'the docs basenames are unchanged');
  });

  await test('ports "mixed code + docs: triggers block"', async () => {
    await blocksWith({
      porcelain: '?? README.md\n?? app.js\n',
      untracked: [{ path: 'README.md', text: 'docs' }, { path: 'app.js', text: 'code' }],
    }, CODE);
  });

  group('change-tracker: prompt.md content');

  await test('ports "prompt.md exists and is non-empty"', () => {
    assert(fs.existsSync(PROMPT_FILE), `prompt.md should exist at ${PROMPT_FILE}`);
    assert(prompt().length > 100, 'prompt.md should have substantial content');
  });

  await test('ports "prompt.md never offers the capture file as a filing destination"', () => {
    const content = prompt();
    assert(/never write to `?\.workkit\/capture\.md/i.test(content), 'the rule is stated outright');
    for (const line of content.split('\n').filter((l) => /capture\.md/.test(l))) {
      assert(/never write to/i.test(line), `capture.md is only ever named to forbid it, got: ${line}`);
    }
  });

  group('change-tracker: repeat only when something changed');

  await test('ports "unchanged tree on the next stop: silent"', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await silent({ ...EDITED('two'), previous: first.fingerprint }, 'nothing changed, so nothing to say');
  });

  await test('ports "a new edit behind an identical status line: blocks again"', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    const rerun = await blocksWith({ ...EDITED('six'), previous: first.fingerprint }, CODE);
    assert(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old');
  });

  await test('ports "a new file: blocks again"', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await blocksWith({
      porcelain: ' M app.js\n?? lib.js\n',
      diff: EDITED('two').diff,
      untracked: [{ path: 'lib.js', text: 'more code' }],
      previous: first.fingerprint,
    }, CODE);
  });

  await test('ports "an untracked file rewritten in place: blocks again"', async () => {
    const lib = (text) => ({ porcelain: '?? lib.js\n', untracked: [{ path: 'lib.js', text }] });
    const first = await blocksWith(lib('one\n'), CODE);
    const rerun = await blocksWith({ ...lib('two\n'), previous: first.fingerprint }, CODE);
    assert(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old');
  });

  // The re-arm on a changed capture file is the wiring's: the file's text is
  // the gatherer's to fold in, the count alone is what this function sees.
  await test('ports "a new capture entry: blocks again": the count, and silence on the same state', async () => {
    const first = await blocksWith({ capture: 1 }, ENTRIES);
    assert(first.context.includes('SCRATCH: 1 unfiled'), 'first capture nudges');
    await silent({ capture: 1, previous: first.fingerprint }, 'the same capture does not nudge twice');
    const second = await blocksWith({ capture: 2 }, ENTRIES);
    assert(second.context.includes('SCRATCH: 2 unfiled'), 'and carries the new count');
  });

  group('change-tracker: guards');

  await test('ports "stop_hook_active=true: exits 0 (prevents recursion)"', async () => {
    await silent({ ...NEW_APP, inbox: 2, capture: 2, stopHookActive: true }, 'should not block on re-entry');
  });

  group('change-tracker: unfiled inbox surfacing');

  await test('ports "clean tree + unfiled INBOX entries: blocks with INBOX count"', async () => {
    const r = await blocksWith({ inbox: 2 }, ENTRIES);
    assert(r.context.includes('INBOX: 2 unfiled'), `context carries the count, got: ${r.context}`);
    assert(r.context.includes('workkit:triage'), 'offers the triage skill');
  });

  await test('ports "code change + unfiled INBOX: one block carrying both"', async () => {
    const r = await blocksWith({ ...NEW_APP, inbox: 1 }, BOTH);
    assert(r.context.includes('INBOX: 1 unfiled'), 'inbox line rides the code nudge');
  });

  group('change-tracker: local .workkit/capture.md');

  await test('ports "code change + scratch entries: one block carrying both"', async () => {
    const r = await blocksWith({ ...NEW_APP, capture: 1 }, BOTH);
    assert(r.context.includes('SCRATCH: 1 unfiled'), 'scratch line rides the code nudge');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
