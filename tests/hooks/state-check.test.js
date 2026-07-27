//
// Tests for hooks/docs:state-check — the SessionStart hook that announces
// open status:inbox issues, a non-empty .workkit/inbox.md, a content-bearing
// CLAUDE.md, and an oversized AGENTS.md. Silent when everything is current.
//
// The issue count is the hook's only network call; every test here runs with a
// PATH that carries no gh (or a recording stub), so nothing hits the API.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'state-check', 'run.sh');

const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ic-test-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const mkRepo = () => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

// PATH shim: records each `gh` invocation and answers `issue list` from a
// fixture. `issues: null` makes the call fail the way an offline gh does.
// The recording keeps argument boundaries (see tests/lib/argv-log.js), so a
// flag whose value lost its quoting cannot pass as a correct call.
const makeGhStub = ({ issues = [] } = {}) => {
  const dir = mkTmp();
  const logFile = path.join(dir, 'gh.log');
  const issuesFile = path.join(dir, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify(issues || []));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1 $2" == "issue list" ]]; then',
    ...(issues === null ? ['  exit 1'] : [`  cat "${issuesFile}"`, '  exit 0']),
    'fi',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  return { binDir: path.join(dir, 'bin'), logFile, dir };
};

// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// Fresh cache dir per run by default — the ~30-min issue-count cache must never
// leak between tests or write into the real ~/.claude/logs. Pass `cache` to
// share one across runs (that is what the cache tests exercise); a shared dir is
// the caller's to clean up.
const runHook = (cwd, { pathPrefix, cache } = {}) => {
  const input = JSON.stringify({ cwd, source: 'startup' });
  const cacheDir = cache || fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cache-'));
  const res = spawnSync('bash', [HOOK], {
    input,
    env: {
      HOME: os.homedir(),
      PATH: pathPrefix ? `${pathPrefix}:${BASE_PATH}` : BASE_PATH,
      STATE_CHECK_CACHE: cacheDir,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  if (!cache) { try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch {} }
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', cacheDir };
};

const run = async () => {
  group('state-check: silence when nothing needs attention');

  await test('bare directory — silent exit 0', () => {
    const dir = mkTmp();
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no output');
    cleanup(dir);
  });

  await test('a repo with no inbox issues — silent', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [] });
    const { code, stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'an empty queue is not news');
    cleanup(repo); cleanup(stub.dir);
  });

  group('state-check: status:inbox issues');

  await test('three open inbox issues — announces the count and offers triage', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }, { number: 2 }, { number: 3 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('additionalContext'), 'emits SessionStart context');
    assert(stdout.includes('3 open status:inbox issues'), `reports 3, got: ${stdout}`);
    assert(stdout.includes('workkit:triage'), 'points at triage');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('one issue — singular grammar', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 7 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('1 open status:inbox issue '), `singular form, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the query is read-only, open, and label-scoped', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }] });
    runHook(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    // Flag and value must be SEPARATE arguments — `--label status:inbox` arriving
    // as one word (or as two words that got split further) is a different query.
    const hasFlag = (call, flag, value) => call.some((a, i) => a === flag && call[i + 1] === value);
    assert(hasFlag(calls[0], '--state', 'open'), `open only, got: ${fmtCalls(calls)}`);
    assert(hasFlag(calls[0], '--label', 'status:inbox'), `label scoped, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.some((a) => /^(create|edit|close|comment|delete)$/.test(a))), 'a hook never writes');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('no gh on PATH — silent skip, everything else still checked', () => {
    const repo = mkRepo();
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Big Doc\n\nrules\nmore rules\nand more\n');
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('status:inbox'), 'no issue line without gh');
    assert(stdout.includes('CLAUDE.md holds content'), 'the local checks still run');
    cleanup(repo);
  });

  await test('gh failing (offline / unauthenticated) — silent skip', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: null });
    const { code, stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'a failed query announces nothing');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('non-git directory — gh is never called', () => {
    const dir = mkTmp();
    const stub = makeGhStub({ issues: [{ number: 1 }] });
    const { stdout } = runHook(dir, { pathPrefix: stub.binDir });
    assertEq(ghCalls(stub).length, 0, 'no query outside a repo');
    assertEq(stdout, '', 'silent');
    cleanup(dir); cleanup(stub.dir);
  });

  group('state-check: local .workkit/inbox.md');

  await test('non-empty scratch inbox — announces it', () => {
    const dir = mkTmp();
    fs.mkdirSync(path.join(dir, W));
    fs.writeFileSync(path.join(dir, W, 'inbox.md'), '# inbox\n> dump anything\n\nan idea\nanother\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('local inbox has entries'), `announces it, got: ${stdout}`);
    assert(stdout.includes('triage drains it'), 'names the drain');
    cleanup(dir);
  });

  await test('header-only scratch inbox — silent', () => {
    const dir = mkTmp();
    fs.mkdirSync(path.join(dir, W));
    fs.writeFileSync(path.join(dir, W, 'inbox.md'), '# inbox\n> dump anything here\n\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'headings/blockquotes/blanks are not entries');
    cleanup(dir);
  });

  await test('inbox issues + scratch entries — both in one context', () => {
    const repo = mkRepo();
    fs.mkdirSync(path.join(repo, W));
    fs.writeFileSync(path.join(repo, W, 'inbox.md'), 'note\n');
    const stub = makeGhStub({ issues: [{ number: 4 }, { number: 5 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('2 open status:inbox') && stdout.includes('local inbox has entries'), `both signals, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('state-check: retired board checks');

  await test('a PROGRESS.md is no longer the hook\'s business', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# Project Progress Tracker\n\n## Current Focus\n* stuff\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'board files are dying — no legacy-format announcement');
    cleanup(dir);
  });

  await test('an INBOX.md is no longer counted', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '# INBOX\n\nfix the thing\nidea: new skill\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'capture lives in issues and .workkit/ now');
    cleanup(dir);
  });

  group('state-check: content-bearing CLAUDE.md (pointer doctrine)');

  await test('content-bearing CLAUDE.md — announces conversion', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Big Doc\n\nlots of rules\nmore rules\nand more\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('CLAUDE.md holds content'), `announces conversion, got: ${stdout}`);
    assert(stdout.includes('SEPARATE commit'), 'includes the rename-safe recipe');
    cleanup(dir);
  });

  await test('pointer CLAUDE.md — silent', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    const { stdout } = runHook(dir);
    assert(!stdout.includes('CLAUDE.md holds content'), 'a compliant pointer stays silent');
    cleanup(dir);
  });

  await test('no CLAUDE.md — silent', () => {
    const dir = mkTmp();
    const { stdout } = runHook(dir);
    assert(!stdout.includes('CLAUDE.md'), 'missing file is fine');
    cleanup(dir);
  });

  group('state-check: oversized AGENTS.md');

  await test('AGENTS.md over 250 lines — announces the offload', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'line\n'.repeat(255)}`);
    const { stdout } = runHook(dir);
    assert(stdout.includes('AGENTS.md'), `announces the oversized file, got: ${stdout}`);
    assert(stdout.includes('250'), 'states the budget');
    cleanup(dir);
  });

  await test('AGENTS.md within budget — silent', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'line\n'.repeat(100)}`);
    const { stdout } = runHook(dir);
    assert(!stdout.includes('AGENTS.md'), 'compliant file stays silent');
    cleanup(dir);
  });

  group('state-check: guards');

  group('state-check: the issue-count cache');

  await test('a second session inside 30 minutes makes no gh call', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }, { number: 2 }] });
    const cache = mkTmp();
    const first = runHook(repo, { pathPrefix: stub.binDir, cache });
    assert(first.stdout.includes('2 open status:inbox'), `first run queried, got: ${first.stdout}`);
    const callsAfterFirst = ghCalls(stub).filter((c) => isCall(c, 'issue', 'list')).length;
    assertEq(callsAfterFirst, 1, 'exactly one query');
    const second = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(ghCalls(stub).filter((c) => isCall(c, 'issue', 'list')).length, 1, 'the cached run queries nothing');
    assert(second.stdout.includes('2 open status:inbox'), `and still announces the count, got: ${second.stdout}`);
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('a cache file older than 30 minutes re-queries', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }] });
    const cache = mkTmp();
    runHook(repo, { pathPrefix: stub.binDir, cache });
    const cacheFile = path.join(cache, fs.readdirSync(cache)[0]);
    assertEq(fs.readFileSync(cacheFile, 'utf8'), '1', 'the cache holds the count');
    // Backdate past the 30-minute window the hook checks with `find -mmin -30`.
    const old = new Date(Date.now() - 90 * 60 * 1000);
    fs.utimesSync(cacheFile, old, old);
    const again = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(ghCalls(stub).filter((c) => isCall(c, 'issue', 'list')).length, 2, 'a stale cache re-queries');
    assert(again.stdout.includes('1 open status:inbox'), `and reports the fresh count, got: ${again.stdout}`);
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('empty cwd in input — exit 0', () => {
    const { code } = runHook('');
    assertEq(code, 0, 'fail open');
  });

  await test('output is valid JSON when announcing', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 9 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    const parsed = JSON.parse(stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'SessionStart', 'correct event name');
    assert(parsed.hookSpecificOutput.additionalContext.length > 0, 'context non-empty');
    cleanup(repo); cleanup(stub.dir);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
