// Tests for docs:change-tracker's logic in hooks/mods/change-tracker.js: endpointTurn(lines), a gh journal line
// past the turn's stored offset that parked, blocked or closed an issue, and changeTrackerVerdict:
// uncommitted code or unfiled entries block the stop with the nag, once per fingerprint of the state. Gathering the
// facts is the wiring's, cased in test/mods/stop-change-tracker.test.ts.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../lib/harness');
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
  expect(r && typeof r.block === 'string', `must block, got: ${JSON.stringify(r)}`).toBeTruthy();
  expect(r.block, 'the reason').toBe(reason);
  return r;
};

const silent = async (facts, label) => {
  const r = await judge(facts);
  expect(r ?? null, label).toBe(null);
};

const prompt = () => fs.readFileSync(PROMPT_FILE, 'utf8');

describe('change-tracker: dirty tree detection', () => {
  test('clean repo: no output (no block)', async () => {
    await silent({}, 'a clean repo does not block');
  });

  test('code change: outputs block decision: the reason and the nag', async () => {
    const r = await blocksWith(NEW_APP, CODE);
    expect(r.context.includes(PROMPT), 'the context carries the nag').toBeTruthy();
  });

  test('doc-only changes: no block (only code triggers)', async () => {
    await silent({ porcelain: '?? README.md\n', untracked: [{ path: 'README.md', text: '# hi' }] }, 'doc-only changes do not block');
  });

  test('a script under a docs PATH is code: blocks (review finding)', async () => {
    await blocksWith({ porcelain: ' M hooks/docs/x/run.sh\n', diff: '-echo hi\n+echo tweaked\n' }, CODE);
  });

  test('a .md under a docs path is still docs: no block', async () => {
    await silent({ porcelain: ' M docs/notes.md\n', diff: '-# notes\n+# notes, edited\n' }, 'the docs basenames are unchanged');
  });

  test('mixed code + docs: triggers block', async () => {
    await blocksWith({
      porcelain: '?? README.md\n?? app.js\n',
      untracked: [{ path: 'README.md', text: 'docs' }, { path: 'app.js', text: 'code' }],
    }, CODE);
  });
});

describe('change-tracker: prompt.md content', () => {
  test('prompt.md exists and is non-empty', () => {
    expect(fs.existsSync(PROMPT_FILE), `prompt.md should exist at ${PROMPT_FILE}`).toBeTruthy();
    expect(prompt().length > 100, 'prompt.md should have substantial content').toBeTruthy();
  });

  test('prompt.md never offers the capture file as a filing destination', () => {
    const content = prompt();
    expect(/never write to `?\.workkit\/capture\.md/i.test(content), 'the rule is stated outright').toBeTruthy();
    for (const line of content.split('\n').filter((l) => /capture\.md/.test(l))) {
      expect(/never write to/i.test(line), `capture.md is only ever named to forbid it, got: ${line}`).toBeTruthy();
    }
  });
});

describe('change-tracker: repeat only when something changed', () => {
  test('unchanged tree on the next stop: silent', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await silent({ ...EDITED('two'), previous: first.fingerprint }, 'nothing changed, so nothing to say');
  });

  test('a new edit behind an identical status line: blocks again', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    const rerun = await blocksWith({ ...EDITED('six'), previous: first.fingerprint }, CODE);
    expect(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old').toBeTruthy();
  });

  test('a new file: blocks again', async () => {
    const first = await blocksWith(EDITED('two'), CODE);
    await blocksWith({
      porcelain: ' M app.js\n?? lib.js\n',
      diff: EDITED('two').diff,
      untracked: [{ path: 'lib.js', text: 'more code' }],
      previous: first.fingerprint,
    }, CODE);
  });

  test('an untracked file rewritten in place: blocks again', async () => {
    const lib = (text) => ({ porcelain: '?? lib.js\n', untracked: [{ path: 'lib.js', text }] });
    const first = await blocksWith(lib('one\n'), CODE);
    const rerun = await blocksWith({ ...lib('two\n'), previous: first.fingerprint }, CODE);
    expect(rerun.fingerprint !== first.fingerprint, 'and the new fingerprint replaces the old').toBeTruthy();
  });

  // The re-arm on a changed capture file is the wiring's: the file's text is
  // the gatherer's to fold in, the count alone is what this function sees.
  test('a new capture entry: blocks again: the count, and silence on the same state', async () => {
    const first = await blocksWith({ capture: 1 }, ENTRIES);
    expect(first.context.includes('SCRATCH: 1 unfiled'), 'first capture nudges').toBeTruthy();
    await silent({ capture: 1, previous: first.fingerprint }, 'the same capture does not nudge twice');
    const second = await blocksWith({ capture: 2 }, ENTRIES);
    expect(second.context.includes('SCRATCH: 2 unfiled'), 'and carries the new count').toBeTruthy();
  });
});

describe('change-tracker: guards', () => {
  test('stop_hook_active=true: exits 0 (prevents recursion)', async () => {
    await silent({ ...NEW_APP, inbox: 2, capture: 2, stopHookActive: true }, 'should not block on re-entry');
  });
});

describe('change-tracker: unfiled inbox surfacing', () => {
  test('clean tree + unfiled INBOX entries: blocks with INBOX count', async () => {
    const r = await blocksWith({ inbox: 2 }, ENTRIES);
    expect(r.context.includes('INBOX: 2 unfiled'), `context carries the count, got: ${r.context}`).toBeTruthy();
    expect(r.context.includes('workkit:triage'), 'offers the triage skill').toBeTruthy();
  });

  test('code change + unfiled INBOX: one block carrying both', async () => {
    const r = await blocksWith({ ...NEW_APP, inbox: 1 }, BOTH);
    expect(r.context.includes('INBOX: 1 unfiled'), 'inbox line rides the code nudge').toBeTruthy();
  });
});

describe('change-tracker: local .workkit/capture.md', () => {
  test('code change + scratch entries: one block carrying both', async () => {
    const r = await blocksWith({ ...NEW_APP, capture: 1 }, BOTH);
    expect(r.context.includes('SCRATCH: 1 unfiled'), 'scratch line rides the code nudge').toBeTruthy();
  });
});

describe('change-tracker: the endpoint turn', () => {
  test('a turn whose journal lines hold no park, block or close is no endpoint', () => {
    expect(endpoint([line({ add: ['status:building'], remove: ['status:inbox'] })]), 'a claim is no endpoint').toBe(false);
    expect(endpoint([line({ add: ['status:building'], remove: ['status:qa'] })]), 'taking status:qa off is no park').toBe(false);
    expect(endpoint([line({ sub: 'comment' })]), 'a comment').toBe(false);
  });

  test('case 3: an edit adding status:qa past the turn\'s offset is an endpoint', () => {
    expect(endpoint([line({ sub: 'comment' }), line({ add: ['status:qa'] })]), 'a park').toBe(true);
  });

  test('case 3: an edit adding status:blocked past the turn\'s offset is an endpoint', () => {
    expect(endpoint([line({ add: ['status:blocked'] })]), 'a block').toBe(true);
  });

  test('case 3: a close past the turn\'s offset is an endpoint', () => {
    expect(endpoint([line({ sub: 'close' })]), 'a close').toBe(true);
  });

  // An older park sits before the offset, so it never reaches `lines`: the Stop's read is cased in
  // test/mods/stop-change-tracker.test.ts.
  test('case 3: no line past the turn\'s offset: no endpoint', () => {
    expect(endpoint([]), 'a turn that wrote nothing to gh').toBe(false);
  });
});
