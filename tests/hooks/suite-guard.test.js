//
// Tests for hooks/safety/suite-guard, the PreToolUse hook that keeps the full
// suite the commit gate's (docs/project-state.md, "The proof", issue #243): a
// bare `npm test`, a bare `npm run test`, and the repo's own test script run
// directly all bounce, while a narrowed run passes untouched. The deliberate
// full run carries `WORKKIT_SUITE=1`.
//
// Every case runs against a temporary repo whose package.json declares the test
// script, so nothing here runs a suite.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'suite-guard', 'run.sh');
const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = (prefix = 'suite-guard-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// A repo the hook can read: a git repository, since the test script is read
// from the GIT ROOT's package.json, the same place safety/commit-gate reads it.
const mkRepo = ({ scripts = { test: 'node tests/run.js' }, pkg = true } = {}) => {
  const dir = fs.realpathSync(mkTmp());
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts }));
  return dir;
};

const runArgv = (argv, command, cwd, env = {}, bash = 'bash') => {
  const res = spawnSync(bash, argv, {
    input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }),
    env: { HOME: os.homedir(), PATH: BASE_PATH, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const runHook = (command, cwd, env = {}, bash = 'bash') => runArgv([HOOK], command, cwd, env, bash);
const runLoader = (command, cwd) => runArgv([LOADER, 'safety:suite-guard'], command, cwd);

const run = async () => {
  group('suite-guard: the full suite by hand');

  await test('a bare npm test bounces, naming the gate and both ways out', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook('npm test', dir);
    assertEq(code, 2, 'the gate owns the full suite');
    assert(stderr.includes('suite-guard'), 'names itself');
    assert(stderr.includes('the commit gate owns the full suite'), `names the rule, got: ${stderr}`);
    assert(stderr.includes('node tests/<dir>/<name>.test.js'), `names the narrow run, got: ${stderr}`);
    assert(stderr.includes('WORKKIT_SUITE=1'), `names the escape, got: ${stderr}`);
    cleanup(dir);
  });

  await test('npm run test bounces, the same run spelled out', () => {
    const dir = mkRepo();
    assertEq(runHook('npm run test', dir).code, 2, 'the long spelling is the same suite');
    cleanup(dir);
  });

  await test("the repo's own test script run directly bounces", () => {
    const dir = mkRepo();
    assertEq(runHook('node tests/run.js', dir).code, 2, 'scripts.test is read from package.json');
    cleanup(dir);
  });

  await test('another repo, another script, the same bounce', () => {
    const dir = mkRepo({ scripts: { test: 'jest --runInBand' } });
    assertEq(runHook('jest --runInBand', dir).code, 2, 'the script is whatever this repo declares');
    assertEq(runHook('ls node_modules/.bin/jest --runInBand', dir).code, 0, 'a path ending in the script is not a run');
    cleanup(dir);
  });

  await test('a full run inside a compound bounces too', () => {
    const dir = mkRepo();
    assertEq(runHook('git status && npm test', dir).code, 2, 'a clause is still the whole suite');
    assertEq(runHook('npm test 2>&1 | tail -20', dir).code, 2, 'so is a piped one');
    assertEq(runHook('npm test>out.log', dir).code, 2, 'a redirect glued to the word is not a scope');
    assertEq(runHook('node tests/run.js 2>&1 | tail -20', dir).code, 2, 'the script run directly, into a pipe');
    assertEq(runHook('node tests/run.js > out.txt', dir).code, 2, 'the script run directly, into a file');
    assertEq(runHook('echo xnode tests/run.js', dir).code, 0, 'the script inside another word is not a run');
    cleanup(dir);
  });

  await test("npm's own spellings of the same run bounce", () => {
    const dir = mkRepo();
    assertEq(runHook('npm t', dir).code, 2, 'the t alias runs the same script');
    assertEq(runHook('npm --silent test', dir).code, 2, "npm's own flags do not narrow it");
    cleanup(dir);
  });

  await test('EVERY occurrence is judged, not the first', () => {
    const dir = mkRepo();
    assertEq(runHook('npm test -- tests/hooks/suite-guard.test.js && npm test', dir).code, 2,
      'the narrowed run first does not carry the full one through');
    cleanup(dir);
  });

  group('suite-guard: the narrow run passes');

  await test('every narrowed spelling passes', () => {
    const dir = mkRepo();
    for (const c of [
      'npm test -- tests/hooks/suite-guard.test.js',
      'node --test tests/hooks/suite-guard.test.js',
      'node tests/hooks/suite-guard.test.js',
      'npx omega test unit',
      'node tests/run.js hooks',
    ]) {
      assertEq(runHook(c, dir).code, 0, `a scoped run is the proof of a change: ${c}`);
    }
    cleanup(dir);
  });

  await test('a script whose name only starts with test is another script', () => {
    const dir = mkRepo();
    assertEq(runHook('npm run test:unit', dir).code, 0, 'test:unit is not the full suite');
    cleanup(dir);
  });

  await test('WORKKIT_SUITE=1 passes the deliberate full run', () => {
    const dir = mkRepo();
    for (const c of ['WORKKIT_SUITE=1 npm test', 'WORKKIT_SUITE=1 npm run test', 'WORKKIT_SUITE=1 node tests/run.js']) {
      assertEq(runHook(c, dir).code, 0, `the escape is the owner's deliberate run: ${c}`);
    }
    cleanup(dir);
  });

  group('suite-guard: a mention is not a run');

  await test('the suite named inside a quoted string passes', () => {
    const dir = mkRepo();
    for (const c of [
      'git commit -m "test: cover npm test wiring"',
      'gh issue comment 243 --body "Proof: unit: npm test ran green at the gate"',
      'echo "reminder: npm test belongs to the commit gate"',
    ]) {
      assertEq(runHook(c, dir).code, 0, `a quoted span is data, not a command: ${c}`);
    }
    cleanup(dir);
  });

  await test('the suite named inside a heredoc body passes', () => {
    const dir = mkRepo();
    const { code } = runHook('cat <<EOF > notes.md\nnpm test\nEOF', dir);
    assertEq(code, 0, 'a heredoc body is file content, not a command');
    cleanup(dir);
  });

  await test('ordinary commands pass, silently', () => {
    const dir = mkRepo();
    for (const c of ['git status', 'ls -la', 'gh issue list --label status:qa', 'cat package.json']) {
      const { code, stderr } = runHook(c, dir);
      assertEq(code, 0, `must pass: ${c}`);
      assertEq(stderr, '', `and say nothing: ${c}`);
    }
    cleanup(dir);
  });

  group('suite-guard: wiring and fail-open');

  await test('hooks.json registers the guard under PreToolUse Bash, after proof-guard', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    const names = bash.hooks.map((h) => h.command);
    const proof = names.findIndex((c) => c.includes('safety:proof-guard'));
    const suite = names.findIndex((c) => c.includes('safety:suite-guard'));
    assert(suite >= 0, 'the Bash block routes safety:suite-guard through the loader');
    assert(suite > proof, `suite-guard is wired after proof-guard, got proof at ${proof} and suite at ${suite}`);
  });

  await test('the loader routes safety:suite-guard and propagates the bounce', () => {
    const dir = mkRepo();
    assertEq(runLoader('npm test', dir).code, 2,
      'safety:suite-guard resolves to safety/suite-guard/run.sh and blocks');
    cleanup(dir);
  });

  await test('a repo declaring no test script passes', () => {
    const dir = mkRepo({ scripts: { start: 'node index.js' } });
    assertEq(runHook('npm test', dir).code, 0, 'there is no suite here to own');
    cleanup(dir);
  });

  await test('a repo with no package.json at its root passes', () => {
    const dir = mkRepo({ pkg: false });
    assertEq(runHook('npm test', dir).code, 0, 'nothing to read means nothing to judge');
    cleanup(dir);
  });

  await test('a directory inside no git repository passes', () => {
    const dir = mkTmp('suite-guard-bare-');
    assertEq(runHook('npm test', dir).code, 0, 'the repo is resolved from the git root, or not at all');
    cleanup(dir);
  });

  await test('no jq: exit 0', () => {
    // PATH points at an empty directory, so the hook finds no jq (and no cat);
    // bash itself is reached by its absolute path, the way a hook command is.
    // `/bin` alone would not do: on a merged-usr Linux it is `/usr/bin`, jq and all.
    const dir = mkRepo();
    const empty = path.join(dir, 'empty-path');
    fs.mkdirSync(empty);
    assertEq(runHook('npm test', dir, { PATH: empty }, '/bin/bash').code, 0, 'a missing tool never wedges a session');
    cleanup(dir);
  });

  await test('missing command, exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { HOME: os.homedir(), PATH: BASE_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'no command means fail open');
  });

  await test('malformed JSON, exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: 'not json',
      env: { HOME: os.homedir(), PATH: BASE_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
