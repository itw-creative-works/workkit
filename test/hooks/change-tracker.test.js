// Tests for docs:change-tracker's logic in hooks/mods/change-tracker.js: endpointTurn(lines), a gh journal line
// past the turn's stored offset that parked, blocked or closed an issue, and changeTrackerVerdict:
// uncommitted code or unfiled entries block the stop with the nag, once per fingerprint of the state. Gathering the
// facts is the wiring's, cased in test/mods/stop-change-tracker.test.ts.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, ghEntry } = require('../lib/mods-inputs');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'hooks', 'mods', 'change-tracker', 'prompt.md');
const PROMPT = 'The working tree has uncommitted code/config changes. Keep the issue true before you stop.';

const CODE = 'Change tracker: uncommitted code changes detected.';
const ENTRIES = 'Change tracker: unfiled entries detected.';
const BOTH = 'Change tracker: uncommitted code changes + unfiled entries detected.';

// One journal line past the turn's offset: an edit of #12 unless `over` says otherwise.
const line = (over) => ghEntry({ numbers: [12], ...over });
const endpoint = (lines) => mods('change-tracker').endpointTurn(lines);

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

const cases = async () => {
  group('change-tracker: dirty tree detection');

  await test('clean repo: no output (no block)', async () => {
    await silent({}, 'a clean repo does not block');
  });

  await test('code change: outputs block decision: the reason and the nag', async () => {
    const r = await blocksWith(NEW_APP, CODE);
    assert(r.context.includes(PROMPT), 'the context carries the nag');
  });

  await test('doc-only changes: no block (only code triggers)', async () => {
    await silent({ porcelain: '?? README.md\n', untracked: [{ path: 'README.md', text: '# hi' }] }, 'doc-only changes do not block');
  });

  await test('a script under a docs PATH is code: blocks (review finding)', async () => {
    await blocksWith({ porcelain: ' M hooks/docs/x/run.sh\n', diff: '-echo hi\n+echo tweaked\n' }, CODE);
  });

  await test('a .md under a docs path is still docs: no block', async () => {
    await silent({ porcelain: ' M docs/notes.md\n', diff: '-# notes\n+# notes, edited\n' }, 'the docs basenames are unchanged');
  });

  await test('mixed code + docs: triggers block', async () => {
    await blocksWith({
      porcelain: '?? README.md\n?? app.js\n',
      untracked: [{ path: 'README.md', text: 'docs' }, { path: 'app.js', text: 'code' }],
    }, CODE);
  });

  group('change-tracker: prompt.md content');

  await test('prompt.md exists and is non-empty', () => {
    assert(fs.existsSync(PROMPT_FILE), `prompt.md should exist at ${PROMPT_FILE}`);
    assert(prompt().length > 100, 'prompt.md should have substantial content');
  });

  await test('prompt.md never offers the capture file as a filing destination', () => {
    const content = prompt();
    assert(/never write to `?\.workkit\/capture\.md/i.test(content), 'the rule is stated outright');
    for (const line of content.split('\n').filter((l) => /capture\.md/.test(l))) {
      assert(/never write to/i.test(line), `capture.md is only ever named to forbid it, got: ${line}`);
    }
  });

  group('change-tracker: repeat only when something changed');

  await test('unchanged tree on the next stop: silent', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await silent({ ...EDITED('two'), previous: first.fingerprint }, 'nothing changed, so nothing to say');
  });

  await test('a new edit behind an identical status line: blocks again', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    const rerun = await blocksWith({ ...EDITED('six'), previous: first.fingerprint }, CODE);
    assert(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old');
  });

  await test('a new file: blocks again', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await blocksWith({
      porcelain: ' M app.js\n?? lib.js\n',
      diff: EDITED('two').diff,
      untracked: [{ path: 'lib.js', text: 'more code' }],
      previous: first.fingerprint,
    }, CODE);
  });

  await test('an untracked file rewritten in place: blocks again', async () => {
    const lib = (text) => ({ porcelain: '?? lib.js\n', untracked: [{ path: 'lib.js', text }] });
    const first = await blocksWith(lib('one\n'), CODE);
    const rerun = await blocksWith({ ...lib('two\n'), previous: first.fingerprint }, CODE);
    assert(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old');
  });

  // The re-arm on a changed capture file is the wiring's: the file's text is
  // the gatherer's to fold in, the count alone is what this function sees.
  await test('a new capture entry: blocks again: the count, and silence on the same state', async () => {
    const first = await blocksWith({ capture: 1 }, ENTRIES);
    assert(first.context.includes('SCRATCH: 1 unfiled'), 'first capture nudges');
    await silent({ capture: 1, previous: first.fingerprint }, 'the same capture does not nudge twice');
    const second = await blocksWith({ capture: 2 }, ENTRIES);
    assert(second.context.includes('SCRATCH: 2 unfiled'), 'and carries the new count');
  });

  group('change-tracker: guards');

  await test('stop_hook_active=true: exits 0 (prevents recursion)', async () => {
    await silent({ ...NEW_APP, inbox: 2, capture: 2, stopHookActive: true }, 'should not block on re-entry');
  });

  group('change-tracker: unfiled inbox surfacing');

  await test('clean tree + unfiled INBOX entries: blocks with INBOX count', async () => {
    const r = await blocksWith({ inbox: 2 }, ENTRIES);
    assert(r.context.includes('INBOX: 2 unfiled'), `context carries the count, got: ${r.context}`);
    assert(r.context.includes('workkit:triage'), 'offers the triage skill');
  });

  await test('code change + unfiled INBOX: one block carrying both', async () => {
    const r = await blocksWith({ ...NEW_APP, inbox: 1 }, BOTH);
    assert(r.context.includes('INBOX: 1 unfiled'), 'inbox line rides the code nudge');
  });

  group('change-tracker: local .workkit/capture.md');

  await test('code change + scratch entries: one block carrying both', async () => {
    const r = await blocksWith({ ...NEW_APP, capture: 1 }, BOTH);
    assert(r.context.includes('SCRATCH: 1 unfiled'), 'scratch line rides the code nudge');
  });

  group('change-tracker: the endpoint turn');

  await test('a turn whose journal lines hold no park, block or close is no endpoint', () => {
    assertEq(endpoint([line({ add: ['status:building'], remove: ['status:inbox'] })]), false, 'a claim is no endpoint');
    assertEq(endpoint([line({ add: ['status:building'], remove: ['status:qa'] })]), false, 'taking status:qa off is no park');
    assertEq(endpoint([line({ sub: 'comment' })]), false, 'a comment');
  });

  await test('case 3: an edit adding status:qa past the turn\'s offset is an endpoint', () => {
    assertEq(endpoint([line({ sub: 'comment' }), line({ add: ['status:qa'] })]), true, 'a park');
  });

  await test('case 3: an edit adding status:blocked past the turn\'s offset is an endpoint', () => {
    assertEq(endpoint([line({ add: ['status:blocked'] })]), true, 'a block');
  });

  await test('case 3: a close past the turn\'s offset is an endpoint', () => {
    assertEq(endpoint([line({ sub: 'close' })]), true, 'a close');
  });

  // An older park sits before the offset, so it never reaches `lines`: the Stop's read is cased in
  // test/mods/stop-change-tracker.test.ts.
  await test('case 3: no line past the turn\'s offset: no endpoint', () => {
    assertEq(endpoint([]), false, 'a turn that wrote nothing to gh');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
