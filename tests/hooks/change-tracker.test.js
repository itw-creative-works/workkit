/* eslint-disable no-console */
//
// Tests for hooks/docs:change-tracker — the Stop hook that detects uncommitted
// code changes and nudges Claude to keep the work item's issue true, promote
// durable findings out of .workkit/, and check doc-parity.
//
// The hook reads JSON on stdin (with cwd), checks git status, classifies
// changes as code vs docs, and outputs a "block" decision with the prompt.md content.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'change-tracker', 'run.sh');
const PROMPT = path.join(__dirname, '..', '..', 'hooks', 'docs', 'change-tracker', 'prompt.md');

const mkTmpRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-test-'));
  execSync('git init && git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
};

const runHook = (cwd) => {
  const input = JSON.stringify({ cwd, stop_hook_active: false });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: { ...process.env, HOME: os.homedir() },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const writeScratch = (dir, body) => {
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  fs.writeFileSync(path.join(dir, W, 'inbox.md'), body);
};

const cleanup = (dir) => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
};

const run = async () => {
  group('change-tracker: dirty tree detection');

  await test('clean repo — no output (no block)', () => {
    const dir = mkTmpRepo();
    const { stdout } = runHook(dir);
    assert(!stdout.includes('block'), 'clean repo should not block');
    cleanup(dir);
  });

  await test('code change — outputs block decision', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hi")');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), `code change should produce block, got: ${stdout.slice(0, 200)}`);
    assert(stdout.includes('additionalContext'), 'should include context');
    cleanup(dir);
  });

  await test('doc-only changes — no block (only code triggers)', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'README.md'), '# hi');
    const { stdout } = runHook(dir);
    assert(!stdout.includes('"block"'), 'doc-only changes should not block');
    cleanup(dir);
  });

  await test('mixed code + docs — triggers block', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    fs.writeFileSync(path.join(dir, 'README.md'), 'docs');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'mixed changes should block');
    cleanup(dir);
  });

  group('change-tracker: prompt.md content');

  await test('prompt.md exists and is non-empty', () => {
    assert(fs.existsSync(PROMPT), 'prompt.md should exist');
    const content = fs.readFileSync(PROMPT, 'utf8');
    assert(content.length > 100, 'prompt.md should have substantial content');
  });

  await test('prompt.md points at issues as the work-item home', () => {
    const content = fs.readFileSync(PROMPT, 'utf8');
    assert(/GitHub issues/i.test(content), 'should name issues as the SSOT');
    assert(content.includes('status:'), 'should name the status label vocabulary');
    assert(content.includes('CHANGELOG'), 'should require the CHANGELOG entry on ship');
  });

  await test('prompt.md requires promoting durable findings out of .workkit/', () => {
    const content = fs.readFileSync(PROMPT, 'utf8');
    assert(content.includes(`${W}/`), 'should reference scratch');
    assert(/promote/i.test(content), 'should state the promotion rule');
  });

  await test('prompt.md never offers the local inbox as a filing destination', () => {
    const content = fs.readFileSync(PROMPT, 'utf8');
    // The inbox is the owner's capture surface (#145): a finding is filed as an
    // issue, and where GitHub is out of reach it goes in chat, never here.
    assert(/never write to `?\.workkit\/inbox\.md/i.test(content), 'the rule is stated outright');
    for (const line of content.split('\n').filter((l) => /inbox\.md/.test(l))) {
      assert(/never write to/i.test(line), `inbox.md is only ever named to forbid it, got: ${line}`);
    }
  });

  await test('prompt.md carries no board instructions', () => {
    const content = fs.readFileSync(PROMPT, 'utf8');
    assert(!content.includes('PROGRESS.md'), 'the board is not the prompt\'s business anymore');
    assert(!content.includes('INBOX.md'), 'nor the retired inbox file');
  });

  await test('prompt.md mentions doc parity', () => {
    const content = fs.readFileSync(PROMPT, 'utf8');
    assert(
      content.includes('doc parity') || content.includes('Doc parity') || content.includes('CLAUDE.md'),
      'should reference the doc parity system'
    );
  });

  group('change-tracker: repeat only when something changed');

  // The hook nudges once per fingerprint of the state it nags about — the
  // porcelain status, the diff behind it, and the local inbox's content — and
  // remembers the last one in the repo's own .workkit/ session state.
  const STATE = path.join(W, '.change-tracker');

  // A participating repo: .workkit/ exists and is gitignored, and app.js is
  // committed so an edit to it moves the diff without moving the status line.
  const mkStateRepo = () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), `${W}/*\n`);
    fs.writeFileSync(path.join(dir, 'app.js'), 'one\n');
    execSync('git add -A && git commit -m "app"', { cwd: dir, stdio: 'pipe' });
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    return dir;
  };

  const stateOf = (dir) => {
    const file = path.join(dir, STATE);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  };

  await test('first stop with changes — blocks and records the fingerprint', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'two\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'the first stop on a new state nudges');
    assert(stateOf(dir), `the fingerprint is recorded in ${STATE}`);
    cleanup(dir);
  });

  await test('unchanged tree on the next stop — silent', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'two\n');
    const first = runHook(dir);
    assert(first.stdout.includes('"block"'), 'first run should block');
    const before = stateOf(dir);
    const second = runHook(dir);
    assert(!second.stdout.includes('"block"'), 'nothing changed, so nothing to say');
    assertEq(second.code, 0, 'silent run should exit 0');
    assertEq(stateOf(dir), before, 'the remembered fingerprint stands');
    cleanup(dir);
  });

  await test('a new edit behind an identical status line — blocks again', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'two\n');
    runHook(dir);
    const before = stateOf(dir);
    // Same porcelain (' M app.js'), different content: only the diff sees it.
    fs.writeFileSync(path.join(dir, 'app.js'), 'six\n');
    const rerun = runHook(dir);
    assert(rerun.stdout.includes('"block"'), 'a real edit re-arms the nudge');
    assert(stateOf(dir) !== before, 'and the new fingerprint replaces the old');
    cleanup(dir);
  });

  await test('a new file — blocks again', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'two\n');
    runHook(dir);
    fs.writeFileSync(path.join(dir, 'lib.js'), 'more code');
    const rerun = runHook(dir);
    assert(rerun.stdout.includes('"block"'), 'a new file is a new state');
    cleanup(dir);
  });

  await test('an untracked file rewritten in place — blocks again', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'lib.js'), 'one\n');
    const first = runHook(dir);
    assert(first.stdout.includes('"block"'), 'the new file nudges');
    const before = stateOf(dir);
    // Same porcelain ('?? lib.js') and nothing in the diff at all — an
    // untracked file's content lives only in the file, so building one across
    // turns would go silent after the first nudge.
    fs.writeFileSync(path.join(dir, 'lib.js'), 'two\n');
    const rerun = runHook(dir);
    assert(rerun.stdout.includes('"block"'), 'an edit to an untracked file re-arms the nudge');
    assert(stateOf(dir) !== before, 'and the new fingerprint replaces the old');
    cleanup(dir);
  });

  await test('a new local inbox entry — blocks again', () => {
    const dir = mkStateRepo();
    writeScratch(dir, '# inbox\n> header\n\na finding\n');
    const first = runHook(dir);
    assert(first.stdout.includes('SCRATCH: 1 unfiled'), 'first capture nudges');
    assert(!runHook(dir).stdout.includes('"block"'), 'the same capture does not nudge twice');
    writeScratch(dir, '# inbox\n> header\n\na finding\nanother finding\n');
    const rerun = runHook(dir);
    assert(rerun.stdout.includes('"block"'), 'a new capture re-arms the nudge');
    assert(rerun.stdout.includes('SCRATCH: 2 unfiled'), 'and carries the new count');
    cleanup(dir);
  });

  await test('clean tree, empty inbox — silent and no state file written', () => {
    const dir = mkStateRepo();
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'a clean repo exits 0');
    assert(!stdout.includes('block'), 'nothing to nudge about');
    assertEq(stateOf(dir), null, 'nothing to remember, so nothing is written');
    cleanup(dir);
  });

  await test('the memory is the repo\'s, not the session\'s', () => {
    const dir = mkStateRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'two\n');
    const runSession = (sessionId) => {
      const input = JSON.stringify({ cwd: dir, stop_hook_active: false, session_id: sessionId });
      const res = spawnSync('bash', [HOOK], {
        input,
        env: { ...process.env, HOME: os.homedir() },
        encoding: 'utf8',
        timeout: 10000,
      });
      return res.stdout || '';
    };
    assert(runSession('sess-a').includes('"block"'), 'first session nudges');
    assert(!runSession('sess-b').includes('"block"'), 'a second session over the same state stays silent');
    cleanup(dir);
  });

  await test('no .workkit/ — nudges every stop and writes nothing', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    assert(runHook(dir).stdout.includes('"block"'), 'an undecided repo still hears it');
    assert(runHook(dir).stdout.includes('"block"'), 'and hears it again — it has no memory');
    assert(!fs.existsSync(path.join(dir, W)), 'an undecided repo is never written to');
    cleanup(dir);
  });

  await test('.workkit/ present but not gitignored — nudges every stop, writes nothing', () => {
    const dir = mkTmpRepo();
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    assert(runHook(dir).stdout.includes('"block"'), 'the first stop nudges');
    assert(runHook(dir).stdout.includes('"block"'), 'and so does the next — no memory without a gitignore');
    assert(runHook(dir).stdout.includes('"block"'), 'and the one after that');
    assertEq(stateOf(dir), null, 'the memory is never a file the repo would commit');
    cleanup(dir);
  });

  group('change-tracker: fail-open / guards');

  await test('non-git directory — exits 0 silently (fail open)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-nogit-'));
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'non-git dir should exit 0');
    assert(!stdout.includes('block'), 'should not block');
    cleanup(dir);
  });

  await test('stop_hook_active=true — exits 0 (prevents recursion)', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    const input = JSON.stringify({ cwd: dir, stop_hook_active: true });
    const res = spawnSync('bash', [HOOK], {
      input,
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'should exit 0 when stop_hook_active');
    assert(!res.stdout.includes('block'), 'should not block on re-entry');
    cleanup(dir);
  });

  group('change-tracker: unfiled inbox surfacing');

  await test('clean tree + unfiled INBOX entries — blocks with INBOX count', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '# INBOX\n> header line\n\nan idea\nanother note\n');
    execSync('git add -A && git commit -m "inbox"', { cwd: dir, stdio: 'pipe' });
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'unfiled inbox should nudge even with a clean tree');
    assert(stdout.includes('INBOX: 2 unfiled'), `context carries the count, got: ${stdout.slice(0, 300)}`);
    assert(stdout.includes('workkit:triage'), 'offers the triage skill');
    cleanup(dir);
  });

  await test('clean tree + header-only INBOX — no block', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '# INBOX\n> Dump anything here.\n\n');
    execSync('git add -A && git commit -m "inbox"', { cwd: dir, stdio: 'pipe' });
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'empty inbox exits 0');
    assert(!stdout.includes('block'), 'no nudge for an empty inbox');
    cleanup(dir);
  });

  await test('code change + unfiled INBOX — one block carrying both', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '# INBOX\nnote\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'blocks');
    assert(stdout.includes('INBOX: 1 unfiled'), 'inbox line rides the code nudge');
    cleanup(dir);
  });

  group('change-tracker: local .workkit/inbox.md');

  await test('clean tree + scratch entries — blocks with the count', () => {
    const dir = mkTmpRepo();
    writeScratch(dir, '# inbox\n> header\n\na finding\nan idea\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'a non-empty local inbox nudges on its own');
    assert(stdout.includes('SCRATCH: 2 unfiled'), `context carries the count, got: ${stdout.slice(0, 400)}`);
    assert(stdout.includes('workkit:triage'), 'offers the triage skill');
    assert(stdout.includes('never drain'), 'draining stays deliberate');
    cleanup(dir);
  });

  await test('clean tree + header-only scratch inbox — no block', () => {
    const dir = mkTmpRepo();
    writeScratch(dir, '# inbox\n> dump anything here\n\n');
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'exits 0');
    assert(!stdout.includes('block'), 'no nudge for an empty local inbox');
    cleanup(dir);
  });

  await test('code change + scratch entries — one block carrying both', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    writeScratch(dir, 'note\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'blocks');
    assert(stdout.includes('SCRATCH: 1 unfiled'), 'scratch line rides the code nudge');
    cleanup(dir);
  });

  group('change-tracker: board transition guard');

  await test('PROGRESS.md present — the board reminder rides along', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# PROGRESS\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('BOARD: PROGRESS.md still exists'), `pre-migration turn is not lawless, got: ${stdout.slice(0, 400)}`);
    cleanup(dir);
  });

  await test('no PROGRESS.md — no board reminder', () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'code');
    const { stdout } = runHook(dir);
    assert(stdout.includes('"block"'), 'still nudges on the code change');
    assert(!stdout.includes('BOARD:'), 'the board line is file-existence gated');
    cleanup(dir);
  });

  await test('the hook never calls gh', () => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    assert(!/\bgh\b/.test(hook.replace(/^#.*$/gm, '')), 'a Stop hook pays no network latency');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
