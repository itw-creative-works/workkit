// Tests for workflow/script-shell.sh, npm's script shell: a green root `npm test`
// records the tree it proved, and every other script passes straight through.
// npm is spawned directly, with the wrapper named by `--script-shell`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skipSuite, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, SYSTEM_PATH, shellPath, which, joinPath, homeEnv,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { suiteMarkerPath, reviewMarkerPath, treeHash } = require('../lib/suite-record');
const {
  scratchNpmrc, WRAPPER, EXE_CLAUDE_HOME, EXE_ENV,
} = require('../hooks/commit-gate/helpers');

const ROOT = path.join(__dirname, '..', '..');
const GATE = path.join(ROOT, 'hooks', 'safety', 'commit-gate', 'run.sh');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
  { cwd: dir, encoding: 'utf8' }).stdout.trim();

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

// A committed repo: the root package.json (<pkg> merged over a name), app.js,
// and any <extra> files by relative path.
const mkRepo = (pkg, extra = {}) => {
  const dir = mkTmp('script-shell-');
  git(dir, 'init', '-q');
  writeJson(path.join(dir, 'package.json'), { name: 'fixture', ...pkg });
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
  for (const [rel, value] of Object.entries(extra)) writeJson(path.join(dir, rel), value);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  return dir;
};

// A scratch machine: its own home and TMPDIR, node and npm on PATH; on Windows
// a claude home through which the built executable reaches this checkout.
const mkWorld = () => {
  const root = mkTmp('script-shell-world-');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  return {
    root,
    tmp,
    env: homeEnv(home, {
      TMPDIR: shellPath(tmp),
      PATH: joinPath(NODE_DIR, SYSTEM_PATH),
      ...(IS_WINDOWS ? { WORKFLOW_CLAUDE_HOME: EXE_CLAUDE_HOME } : {}),
    }),
  };
};

// npm run in <cwd> with <args>, through the wrapper unless `shell` names another,
// with <extra> merged over the world's env. The flag goes first: after a `--`
// npm hands it to the script instead.
const npm = (world, cwd, args, shell = WRAPPER, extra = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', `--script-shell=${shell}`, ...args], {
    cwd, env: { ...world.env, ...extra }, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `npm ${args.join(' ')} finished: ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// A copy of the wrapper and its libs under <world.root>/claude/workkit, so a
// case may rewrite it. On Windows the built exe reaches the copy through
// WORKFLOW_CLAUDE_HOME (the claude home, native spelling, as mkWorld passes it);
// `file` is the copy in node's spelling.
const mkWrapperCopy = (world) => {
  const claude = path.join(world.root, 'claude');
  const kit = path.join(claude, 'workkit');
  fs.mkdirSync(kit, { recursive: true });
  const file = path.join(kit, 'script-shell.sh');
  fs.cpSync(path.join(ROOT, 'workflow', 'script-shell.sh'), file);
  fs.cpSync(path.join(ROOT, 'workflow', 'lib'), path.join(kit, 'lib'), { recursive: true });
  return IS_WINDOWS
    ? { shell: WRAPPER, env: { WORKFLOW_CLAUDE_HOME: claude }, file }
    : { shell: shellPath(file), env: {}, file };
};

const recorded = (world, repo) => {
  const marker = suiteMarkerPath(world.tmp, repo);
  return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
};

// The commit gate asked about a plain code commit in <repo>, on a machine whose
// npm names the wrapper, the gate helpers' default.
const gateOn = (world, repo) => spawnSync(BASH, [...NO_RC, shellPath(GATE)], {
  input: JSON.stringify({ cwd: shellPath(repo), tool_input: { command: 'git commit -m "feat: x"' } }),
  env: { ...world.env, NPM_CONFIG_USERCONFIG: scratchNpmrc(WRAPPER), ...EXE_ENV },
  encoding: 'utf8',
  timeout: 30000,
});

const run = async () => {
  if (!WRAPPER) skipSuite('no C# compiler on this Windows, so the script shell cannot be built');
  if (!which('npm', NODE_DIR)) skipSuite('no npm beside this node, so no script shell is ever called');

  group('script-shell: the root test records the tree it proved');

  await test('a green root npm test: exit 0, output streamed, the record holds the tree', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "console.log(\'streamed-green\')"' } });
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('streamed-green'), `the script's output reaches the caller, got: ${res.out}`);
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the working tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  await test("a red root npm test: npm's exit code, no record", () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'echo streamed-red && exit 3' } });
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 3, `the script's code comes back, got: ${res.code} ${res.err}`);
    assert(res.out.includes('streamed-red'), `the failure output reaches the caller, got: ${res.out}`);
    assertEq(recorded(world, repo), undefined, 'a red run proves nothing');
    cleanup(world.root); cleanup(repo);
  });

  await test('a script that edits a committed file during the run writes no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'echo edited > app.js' } });
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 0, 'the run itself is green');
    assertEq(recorded(world, repo), undefined, 'the tree it ended on is not the tree it proved');
    assert(res.err.includes('script-shell: the suite passed, but the tree changed during the run, so no record was written; run npm test again\n'),
      `one stderr line says why, got: ${res.err}`);
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: the wrapper is parsed whole before the run');

  await test('an in-place rewrite of the wrapper during the run changes nothing: green, the record holds the tree', () => {
    const world = mkWorld();
    const kit = mkWrapperCopy(world);
    const repo = mkRepo({ scripts: {
      test: 'c=$(cat "$WK_COPY"); printf \'# a line added while the suite ran\\n%s\\n\' "$c" > "$WK_COPY"; echo rewrote',
    } });
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test'], kit.shell, { ...kit.env, WK_COPY: shellPath(kit.file) });
    assertEq(res.code, 0, `exit 0, got: ${res.code} ${res.err}`);
    assert(res.out.includes('rewrote'), `the suite ran to its end, got: ${res.out}`);
    assertEq(fs.readFileSync(kit.file, 'utf8').split('\n')[0], '# a line added while the suite ran',
      'the wrapper on disk was rewritten while it ran');
    assert(!res.err.includes('command not found') && !res.err.includes('script-shell:'),
      `the running shell read no fragment, got: ${res.err}`);
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  await test('a record that cannot be written: exit 1, the line names it, no record', () => {
    const world = mkWorld();
    const kit = mkWrapperCopy(world);
    const repo = mkRepo({ scripts: { test: 'exit 0' } });
    fs.writeFileSync(path.join(world.tmp, 'claude-suite-marker'), '');
    const res = npm(world, repo, ['test'], kit.shell, kit.env);
    assertEq(res.code, 1, `a green run with no record is not green, got: ${res.code} ${res.err}`);
    assert(res.err.includes('script-shell: the suite passed, but the record of ')
      && res.err.includes(' could not be written'), `the script-shell line says why, got: ${res.err}`);
    assertEq(recorded(world, repo), undefined, 'no record was written');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: everything else passes through');

  await test('a narrowed root run (npm test -- <file>) is green and writes no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } });
    const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assertEq(recorded(world, repo), undefined, 'a narrowed run proves only what it ran');
    cleanup(world.root); cleanup(repo);
  });

  await test('a nested package npm test writes no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'exit 0' } }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo nested-ran' } },
    });
    const res = npm(world, path.join(repo, 'packages', 'foo'), ['test']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('nested-ran'), `the nested script ran, got: ${res.out}`);
    assertEq(recorded(world, repo), undefined, 'a nested suite is not the root suite');
    cleanup(world.root); cleanup(repo);
  });

  await test('a workspace member run from the root (-w) writes no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ workspaces: ['packages/*'], scripts: { test: 'exit 0' } }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo member-ran' } },
    });
    const res = npm(world, repo, ['test', '-w', 'foo']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('member-ran'), `the member's script ran, got: ${res.out}`);
    assertEq(recorded(world, repo), undefined, "a member's suite is not the root suite");
    cleanup(world.root); cleanup(repo);
  });

  await test('another script: stdout and exit code exactly as plain sh gives them, no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { build: 'echo built && exit 4', test: 'exit 0' } });
    const wrapped = npm(world, repo, ['run', 'build']);
    const plain = npm(world, repo, ['run', 'build'], 'sh');
    assertEq(wrapped.code, 4, `the script's code comes back, got: ${wrapped.code}`);
    assertEq(wrapped.out, plain.out, 'the wrapper adds nothing to stdout');
    assertEq(recorded(world, repo), undefined, 'only the test event records');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: the commit gate honors the record');

  await test('the gate blocks a staged code change, and after a green root run stands down', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'exit 0' } });
    fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
    git(repo, 'add', 'app.js');
    // The review marker check 2 reads, so check 5 is what answers.
    const review = reviewMarkerPath(world.tmp, repo);
    fs.mkdirSync(path.dirname(review), { recursive: true });
    fs.writeFileSync(review, '');
    const before = gateOn(world, repo);
    assertEq(before.status, 2, `no green run yet, got: ${before.stderr}`);
    assert(before.stderr.includes('Run `npm test` at the repo root'), `naming the fix, got: ${before.stderr}`);
    assertEq(npm(world, repo, ['test']).code, 0, 'the root suite ran green');
    const after = gateOn(world, repo);
    assertEq(after.status, 0, `the record proves the staged tree, got: ${after.stderr}`);
    assertEq(JSON.parse(after.stdout).systemMessage,
      'commit-gate: suite proved: a green root `npm test` recorded this tree.', 'the stand-down line');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
