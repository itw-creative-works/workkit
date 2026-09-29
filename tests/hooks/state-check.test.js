// Tests for hooks/docs:state-check: the SessionStart hook that announces open
// status:inbox issues, a non-empty .workkit/capture.md, a repo CLAUDE.md (to
// delete, rename or merge), and an oversized AGENTS.md, silent when everything
// is current.
// Every PATH carries no gh or a recording stub, so nothing hits the API.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC, shellPath, stubTool, basePathWithout, systemPathWith,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');
const { mkTmp } = require('../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'state-check', 'run.sh');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const mkRepo = () => {
  const dir = mkTmp('ic-test-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

// PATH shim: records each `gh` invocation and answers `issue list` from a
// fixture. `issues: null` makes the call fail the way an offline gh does.
// The recording keeps argument boundaries (see tests/lib/argv-log.js), so a
// flag whose value lost its quoting cannot pass as a correct call.
const makeGhStub = ({ issues = [] } = {}) => {
  const dir = mkTmp('ic-test-');
  const logFile = path.join(dir, 'gh.log');
  const issuesFile = path.join(dir, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify(issues || []));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1 $2" == "issue list" ]]; then',
    ...(issues === null ? ['  exit 1'] : [`  cat "${issuesFile}"`, '  exit 0']),
    'fi',
    'exit 0',
  ]);
  return { binDir, logFile, dir };
};

// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// Fresh cache dir per run by default. The ~30-min issue-count cache must never
// leak between tests or write into the real ~/.claude/logs. Pass `cache` to
// share one across runs (that is what the cache tests exercise); a shared dir is
// the caller's to clean up.

// The machine without `gh`. A runner ships the real one in /usr/bin, so a case
// about its absence takes it off the PATH, or the real gh answers and the case
// passes for another reason. Built once, since the mirror links every system
// tool, and removed with the suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('ic-test-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

const runHook = (cwd, { pathPrefix, cache, home } = {}) => {
  const input = JSON.stringify({ cwd: shellPath(cwd), source: 'startup' });
  const cacheDir = cache || mkTmp('sc-cache-');
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input,
    env: {
      HOME: shellPath(home || os.homedir()),
      PATH: pathPrefix ? systemPathWith(pathPrefix) : pathWithoutGh(),
      STATE_CHECK_CACHE: shellPath(cacheDir),
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  if (!cache) { try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch {} }
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', cacheDir };
};

const run = async () => {
  group('state-check: silence when nothing needs attention');

  await test('bare directory: silent exit 0', () => {
    const dir = mkTmp('ic-test-');
    const { code, stdout } = runHook(dir);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no output');
    cleanup(dir);
  });

  await test('a repo with no inbox issues: silent', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [] });
    const { code, stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'an empty queue is not news');
    cleanup(repo); cleanup(stub.dir);
  });

  group('state-check: status:inbox issues');

  await test('three open inbox issues: announces the count and offers triage', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }, { number: 2 }, { number: 3 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('additionalContext'), 'emits SessionStart context');
    assert(stdout.includes('3 open status:inbox issues'), `reports 3, got: ${stdout}`);
    assert(stdout.includes('workkit:triage'), 'points at triage');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('one issue: singular grammar', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 7 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('1 open status:inbox issue.'), `singular form, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the query is read-only, open, and label-scoped', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }] });
    runHook(repo, { pathPrefix: stub.binDir });
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    // Flag and value must be separate arguments. `--label status:inbox` arriving
    // as one word (or as two words that got split further) is a different query.
    const hasFlag = (call, flag, value) => call.some((a, i) => a === flag && call[i + 1] === value);
    assert(hasFlag(calls[0], '--state', 'open'), `open only, got: ${fmtCalls(calls)}`);
    assert(hasFlag(calls[0], '--label', 'status:inbox'), `label scoped, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.some((a) => /^(create|edit|close|comment|delete)$/.test(a))), 'a hook never writes');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('no gh on PATH: silent skip, everything else still checked', () => {
    const repo = mkRepo();
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Big Doc\n\nrules\nmore rules\nand more\n');
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('status:inbox'), 'no issue line without gh');
    assert(stdout.includes('git mv CLAUDE.md AGENTS.md'), 'the local checks still run');
    cleanup(repo);
  });

  await test('gh failing (offline / unauthenticated): silent skip', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: null });
    const { code, stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'a failed query announces nothing');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('non-git directory: gh is never called', () => {
    const dir = mkTmp('ic-test-');
    const stub = makeGhStub({ issues: [{ number: 1 }] });
    const { stdout } = runHook(dir, { pathPrefix: stub.binDir });
    assertEq(ghCalls(stub).length, 0, 'no query outside a repo');
    assertEq(stdout, '', 'silent');
    cleanup(dir); cleanup(stub.dir);
  });

  group('state-check: local .workkit/capture.md');

  await test('a non-empty capture file: announces it', () => {
    const dir = mkTmp('ic-test-');
    fs.mkdirSync(path.join(dir, W));
    fs.writeFileSync(path.join(dir, W, 'capture.md'), '# capture\n> dump anything\n\nan idea\nanother\n');
    const { stdout } = runHook(dir);
    assert(stdout.includes('the local capture file has entries'), `announces it, got: ${stdout}`);
    assert(stdout.includes('triage drains it'), 'names the drain');
    cleanup(dir);
  });

  await test('a header-only capture file: silent', () => {
    const dir = mkTmp('ic-test-');
    fs.mkdirSync(path.join(dir, W));
    fs.writeFileSync(path.join(dir, W, 'capture.md'), '# capture\n> dump anything here\n\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'headings/blockquotes/blanks are not entries');
    cleanup(dir);
  });

  await test('inbox issues + captures: both in one context', () => {
    const repo = mkRepo();
    fs.mkdirSync(path.join(repo, W));
    fs.writeFileSync(path.join(repo, W, 'capture.md'), 'note\n');
    const stub = makeGhStub({ issues: [{ number: 4 }, { number: 5 }] });
    const { stdout } = runHook(repo, { pathPrefix: stub.binDir });
    assert(stdout.includes('2 open status:inbox') && stdout.includes('the local capture file has entries'), `both signals, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('state-check: retired board checks');

  await test('a PROGRESS.md is no longer the hook\'s business', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# Project Progress Tracker\n\n## Current Focus\n* stuff\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'board files are dying: no legacy-format announcement');
    cleanup(dir);
  });

  await test('an INBOX.md is no longer counted', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'INBOX.md'), '# INBOX\n\nfix the thing\nidea: new skill\n');
    const { stdout } = runHook(dir);
    assertEq(stdout, '', 'capture lives in issues and .workkit/ now');
    cleanup(dir);
  });

  group('state-check: a repo CLAUDE.md is deleted, renamed or merged');

  // Claude Code reads AGENTS.md itself, and a project CLAUDE.md stops that read,
  // so every repo CLAUDE.md is announced with the one fix its shape calls for.
  const claudeCase = (claude, { agents } = {}) => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claude);
    if (agents !== undefined) fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents);
    const { stdout } = runHook(dir);
    cleanup(dir);
    return stdout;
  };

  await test('a pointer-only CLAUDE.md: says to delete it', () => {
    const stdout = claudeCase('@AGENTS.md\n', { agents: '# repo\n' });
    assert(stdout.includes('git rm CLAUDE.md'), `names the delete, got: ${stdout}`);
    assert(!stdout.includes('git mv'), 'never the rename');
    assert(!stdout.includes('by hand'), 'never the merge');
  });

  await test('a pointer with blank lines and trailing spaces: still pointer-only', () => {
    const stdout = claudeCase('\n  @AGENTS.md  \r\n\n');
    assert(stdout.includes('git rm CLAUDE.md'), `names the delete, got: ${stdout}`);
  });

  await test('a content CLAUDE.md with no AGENTS.md beside it: says to rename it', () => {
    const stdout = claudeCase('# Big Doc\n\nlots of rules\n');
    assert(stdout.includes('git mv CLAUDE.md AGENTS.md'), `names the rename, got: ${stdout}`);
    assert(stdout.includes('history'), 'says the rename keeps history');
    assert(!stdout.includes('@AGENTS.md'), `no pointer goes back in its place, got: ${stdout}`);
    assert(!stdout.includes('git rm CLAUDE.md'), 'never the delete');
  });

  await test('a single content line with no AGENTS.md: still a rename', () => {
    const stdout = claudeCase('Use tabs.\n');
    assert(stdout.includes('git mv CLAUDE.md AGENTS.md'), `one line of content is content, got: ${stdout}`);
    assert(!stdout.includes('@AGENTS.md'), `no pointer goes back in its place, got: ${stdout}`);
  });

  await test('a content CLAUDE.md beside an AGENTS.md: says to merge by hand', () => {
    const stdout = claudeCase('@AGENTS.md\n\nUse tabs.\n', { agents: '# repo\n\nthe overview\n' });
    assert(stdout.includes('by hand'), `names the hand merge, got: ${stdout}`);
    assert(!stdout.includes('git mv'), 'never the rename: AGENTS.md is already there');
  });

  await test('the user-level ~/.claude/CLAUDE.md is out of scope: silent', () => {
    const home = mkTmp('ic-home-');
    const claudeDir = path.join(home, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), '@AGENTS.md\n');
    const { stdout } = runHook(claudeDir, { home });
    assertEq(stdout, '', `the global pointer stays, got: ${stdout}`);
    cleanup(home);
  });

  await test('no CLAUDE.md: silent', () => {
    const dir = mkTmp('ic-test-');
    const { stdout } = runHook(dir);
    assert(!stdout.includes('CLAUDE.md'), 'missing file is fine');
    cleanup(dir);
  });

  group('state-check: oversized AGENTS.md');

  await test('AGENTS.md over 250 lines: announces the offload', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'line\n'.repeat(255)}`);
    const { stdout } = runHook(dir);
    assert(stdout.includes('AGENTS.md'), `announces the oversized file, got: ${stdout}`);
    assert(stdout.includes('250'), 'states the budget');
    cleanup(dir);
  });

  await test('AGENTS.md within budget: silent', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'line\n'.repeat(100)}`);
    const { stdout } = runHook(dir);
    assert(!stdout.includes('AGENTS.md'), 'compliant file stays silent');
    cleanup(dir);
  });

  // The density half of the same budget: a markdown paragraph is one source
  // line, so a file well inside 250 lines still carries a book. The unit is
  // bytes, pinned with LC_ALL=C the way board-guard pins it.
  await test('a dense AGENTS.md inside the line count: announces the density rule', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'x'.repeat(2100)}\n${'line\n'.repeat(100)}`);
    const { stdout } = runHook(dir);
    assert(stdout.includes('1 line over 400 bytes'), `announces the dense line, got: ${stdout}`);
    assert(stdout.includes('density rule'), 'names the rule');
    assert(stdout.includes('board-guard'), 'says writes bounce until it fits');
    assert(!stdout.includes('budget 250'), 'the line count is not the complaint');
    cleanup(dir);
  });

  await test('several dense lines: the count is plural', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${`${'x'.repeat(500)}\n`.repeat(3)}`);
    const { stdout } = runHook(dir);
    assert(stdout.includes('3 lines over 400 bytes'), `counts them, got: ${stdout}`);
    cleanup(dir);
  });

  await test('a 400-byte line: silent (the boundary passes)', () => {
    const dir = mkTmp('ic-test-');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${'x'.repeat(400)}\n`);
    const { stdout } = runHook(dir);
    assert(!stdout.includes('AGENTS.md'), 'exactly 400 is within the budget');
    cleanup(dir);
  });

  await test('a non-ASCII line: 370 characters, 410 bytes, and it counts', () => {
    const dir = mkTmp('ic-test-');
    const line = `${'x'.repeat(350)}${'\u2014'.repeat(20)}`;
    assertEq(Buffer.byteLength(line, 'utf8'), 410, 'the fixture is 410 bytes');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# repo\n${line}\n`);
    const { stdout } = runHook(dir);
    assert(stdout.includes('1 line over 400 bytes'), `bytes decide it, got: ${stdout}`);
    cleanup(dir);
  });

  group('state-check: guards');

  group('state-check: the issue-count cache');

  // Only silence is cached. An announcement describes a queue that triage can
  // empty at any moment, leaving no local trace this hook could fingerprint,
  // so the announcing state is re-asked every session.
  const issueCount = (stub) => ghCalls(stub).filter((c) => isCall(c, 'issue', 'list')).length;
  // The stub answers `issue list` from this file, so rewriting it is what the
  // repo's queue changing between two sessions looks like.
  const setIssues = (stub, issues) => fs.writeFileSync(path.join(stub.dir, 'issues.json'), JSON.stringify(issues));

  await test('an empty queue is cached: a second session inside 30 minutes makes no gh call', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [] });
    const cache = mkTmp('ic-test-');
    const first = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(first.stdout, '', 'an empty queue is not news');
    assertEq(issueCount(stub), 1, 'exactly one query');
    const second = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(issueCount(stub), 1, 'the cached run queries nothing');
    assertEq(second.stdout, '', 'and stays silent');
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('a count worth announcing is never cached: the next session asks again', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }, { number: 2 }] });
    const cache = mkTmp('ic-test-');
    const first = runHook(repo, { pathPrefix: stub.binDir, cache });
    assert(first.stdout.includes('2 open status:inbox'), `first run announces, got: ${first.stdout}`);
    assertEq(fs.readdirSync(cache).length, 0, 'nothing was written to the cache');
    const second = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(issueCount(stub), 2, 'the announcing state re-queries');
    assert(second.stdout.includes('2 open status:inbox'), `and announces the fresh count, got: ${second.stdout}`);
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('triage drains the inbox and the very next session goes quiet', () => {
    // A drained inbox stops announcing at once, not when a cache ages out: the
    // announcing state simply has no cache entry to go stale.
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [{ number: 1 }, { number: 2 }] });
    const cache = mkTmp('ic-test-');
    const before = runHook(repo, { pathPrefix: stub.binDir, cache });
    assert(before.stdout.includes('2 open status:inbox'), `announced first, got: ${before.stdout}`);
    setIssues(stub, []);
    const after = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(after.stdout, '', 'silent immediately, with no wait for the cache window');
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('a cached silence older than 30 minutes re-queries', () => {
    const repo = mkRepo();
    const stub = makeGhStub({ issues: [] });
    const cache = mkTmp('ic-test-');
    runHook(repo, { pathPrefix: stub.binDir, cache });
    const cacheFile = path.join(cache, fs.readdirSync(cache)[0]);
    assertEq(fs.readFileSync(cacheFile, 'utf8'), '0', 'the cache holds the empty count');
    // Backdate past the 30-minute window the hook checks with `find -mmin -30`.
    const old = new Date(Date.now() - 90 * 60 * 1000);
    fs.utimesSync(cacheFile, old, old);
    setIssues(stub, [{ number: 1 }]);
    const again = runHook(repo, { pathPrefix: stub.binDir, cache });
    assertEq(issueCount(stub), 2, 'a stale cache re-queries');
    assert(again.stdout.includes('1 open status:inbox'), `and reports the fresh count, got: ${again.stdout}`);
    assertEq(fs.readdirSync(cache).length, 0, 'and the entry it invalidated is gone');
    cleanup(repo); cleanup(stub.dir); cleanup(cache);
  });

  await test('empty cwd in input: exit 0', () => {
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
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
