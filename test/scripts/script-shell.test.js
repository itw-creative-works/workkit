// Tests for workflow/script-shell.sh, npm's script shell: a green root `npm test`
// records the tree it proved, every other green test run records its package,
// an install-time script in an opted-in repo is followed by the git hooks'
// re-point, and every other script passes straight through.
// The detached run and the checks before it are script-shell-detached.test.js;
// the world both run npm in is test/lib/script-shell.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, shellPath, which, joinPath, stubTool, NODE_DIR, SYSTEM_PATH,
} = require('../lib/platform');
const { reviewMarkerPath, suiteLogPath, treeHash } = require('../lib/suite-record');
const {
  scratchNpmrc, cleanup, git, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded, packaged, assertRecord,
} = require('../lib/script-shell');
const { gateOn: gateIn } = require('../lib/real-gate');
const { runLib } = require('../lib/hook-lib');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const ROOT = path.join(__dirname, '..', '..');
const KIT_HOOKS = path.join(ROOT, 'workflow', 'githooks');

const OPT_IN = OPT_IN_SHAPES.current;
const DECLINED = '{ "version": 1, "enabled": false }\n';
// A prepare script that takes the hooks path for the repo's own hooks, as husky's does.
const HUSKY = 'git config core.hooksPath .husky/_';

// A committed repo whose package.json carries <scripts>; `settings` is its
// .workkit/settings.json text, none when null.
const repoWith = (scripts, settings = OPT_IN) => mkRepo({ scripts },
  settings === null ? {} : { '.workkit/settings.json': settings });

const hooksPathOf = (repo) => git(repo, 'config', '--local', '--get', 'core.hooksPath');
const isOurs = (value) => value !== '' && fs.existsSync(value) && fs.realpathSync(value) === fs.realpathSync(KIT_HOOKS);

// `npm install` in <repo> as the owner's terminal runs it: no Claude session.
const install = (world, repo) => npm(world, repo, ['install', '--no-audit', '--no-fund'], world.wrapper, { CLAUDECODE: undefined });

// A copy of the wrapper and its libs under <world.root>/claude/workkit, so a
// case may rewrite it. On Windows the world's exe reaches the copy through
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
    ? { shell: world.wrapper, env: { WORKFLOW_CLAUDE_HOME: claude }, file }
    : { shell: shellPath(file), env: {}, file };
};

// The commit gate, through the hooks module, asked about what <repo> has
// staged, on a machine whose npm names the world's script shell.
const gateOn = (world, repo) => gateIn(repo, { ...world.env, NPM_CONFIG_USERCONFIG: scratchNpmrc(world.wrapper) });

const cases = async () => {
  skipWithoutWrapper();

  group('script-shell: the root test records the tree it proved');

  await test('a green root npm test: exit 0, output streamed, the record holds the tree, no package record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "console.log(\'streamed-green\')"' } });
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('streamed-green'), `the script's output reaches the caller, got: ${res.out}`);
    assertRecord(recorded(world, repo), tree, 'the record holds the working tree it proved');
    assertEq(packaged(world, repo), undefined, 'the whole root suite never writes the package record');
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
    assert(res.out.includes('script-shell: the suite passed, but the tree changed during the run, so no record was written; run npm test again\n'),
      `one line on the terminal says why, got: ${res.out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('a tree that cannot be hashed after the run: exit 1, the line names the hash, no record', () => {
    const world = mkWorld();
    // A git ahead on PATH refuses `add` once the suite has left its flag, so the
    // hash before the run succeeds and the one after it fails.
    const bin = path.join(world.root, 'git-shim');
    const flag = path.join(world.root, 'break-hash');
    fs.mkdirSync(bin);
    stubTool(bin, 'git', ['#!/bin/bash',
      `if [ -e "${shellPath(flag)}" ]; then for a in "$@"; do [ "$a" = add ] && { echo 'git: add refused' >&2; exit 1; }; done; fi`,
      `exec "${shellPath(which('git'))}" "$@"`]);
    const repo = mkRepo({ scripts: { test: ': > "$WK_FLAG"' } });
    const res = npm(world, repo, ['test'], world.wrapper, { PATH: joinPath(bin, NODE_DIR, SYSTEM_PATH), WK_FLAG: shellPath(flag) });
    assert(fs.existsSync(flag), 'the suite ran and left its flag');
    assertEq(res.code, 1, `a green run with no hash is not green, got: ${res.code} ${res.out} ${res.err}`);
    assert(res.out.includes('script-shell: the suite passed, but the tree of ')
      && res.out.includes(' could not be hashed, so no record was written\n'), `the line names the hash, got: ${res.out}`);
    assert(!res.out.includes('the tree changed during the run'), `never read as a changed tree, got: ${res.out}`);
    assertEq(recorded(world, repo), undefined, 'no record was written');
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
    // The body's lines reach stdout through the log; its closing line is the one expected.
    const shellLines = res.out.split('\n').filter((l) => l.startsWith('script-shell:'));
    assert(!`${res.out}${res.err}`.includes('command not found') && !res.err.includes('script-shell:')
      && shellLines.every((l) => l === 'script-shell: exit 0'), `the running shell read no fragment, got: ${res.out} ${res.err}`);
    assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  await test('a record that cannot be written: exit 1, the line names it, no record', () => {
    const world = mkWorld();
    const kit = mkWrapperCopy(world);
    const repo = mkRepo({ scripts: { test: 'exit 0' } });
    fs.mkdirSync(path.join(world.workflowHome, 'markers'), { recursive: true });
    fs.writeFileSync(path.join(world.workflowHome, 'markers', 'claude-suite-marker'), '');
    const res = npm(world, repo, ['test'], kit.shell, kit.env);
    assertEq(res.code, 1, `a green run with no record is not green, got: ${res.code} ${res.err}`);
    assert(res.out.includes('script-shell: the suite passed, but the record of ')
      && res.out.includes(' could not be written'), `the script-shell line says why, got: ${res.out}`);
    assertEq(recorded(world, repo), undefined, 'no record was written');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: every other green test run records its package');

  await test('a narrowed root run (npm test -- <file>) green: the package record holds `.` under the tree, no suite record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } });
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assertEq(packaged(world, repo), JSON.stringify([`${tree} .`]), 'the tree it ran on, then the root package');
    assertEq(recorded(world, repo), undefined, 'a narrowed run never touches the suite record');
    cleanup(world.root); cleanup(repo);
  });

  await test('a nested package npm test green, run from its folder: the package record holds its folder', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'exit 0' } }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo nested-ran' } },
    });
    const tree = treeHash(repo);
    const res = npm(world, path.join(repo, 'packages', 'foo'), ['test']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('nested-ran'), `the nested script ran, got: ${res.out}`);
    assertEq(packaged(world, repo), JSON.stringify([`${tree} packages/foo`]), 'the folder relative to the root');
    assertEq(recorded(world, repo), undefined, 'a nested suite is not the root suite');
    cleanup(world.root); cleanup(repo);
  });

  await test('a workspace member run from the root (-w) green: the package record holds its folder', () => {
    const world = mkWorld();
    const repo = mkRepo({ workspaces: ['packages/*'], scripts: { test: 'exit 0' } }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo member-ran' } },
    });
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test', '-w', 'foo']);
    assertEq(res.code, 0, `exit 0, got: ${res.err}`);
    assert(res.out.includes('member-ran'), `the member's script ran, got: ${res.out}`);
    assertEq(packaged(world, repo), JSON.stringify([`${tree} packages/foo`]), "the member's folder, never the root");
    assertEq(recorded(world, repo), undefined, "a member's suite is not the root suite");
    cleanup(world.root); cleanup(repo);
  });

  await test("a red narrowed run: npm's exit code, no package record", () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "process.exit(3)"' } });
    const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
    assertEq(res.code, 3, `the script's code comes back, got: ${res.code} ${res.err}`);
    assertEq(packaged(world, repo), undefined, 'a red run proves nothing');
    assertEq(recorded(world, repo), undefined, 'and no suite record either');
    cleanup(world.root); cleanup(repo);
  });

  await test('a narrowed run that edits a committed file writes no package record and says so', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'echo edited > app.js' } });
    const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
    assertEq(fs.readFileSync(path.join(repo, 'app.js'), 'utf8').startsWith('edited'), true, 'the script edited the file');
    assertEq(packaged(world, repo), undefined, 'the tree it ended on is not the tree it ran on');
    assertEq(res.code, 0, `a green run whose tree changed still exits 0, got: ${res.code} ${res.err}`);
    assert(/^script-shell: the run passed, but the tree changed during it, /m.test(`${res.out}\n${res.err}`),
      `the package run's line says the tree changed, got: ${res.out} ${res.err}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('a second package green on the same tree gets its own line', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'exit 0' } },
    });
    const tree = treeHash(repo);
    assertEq(npm(world, repo, ['test', '--', 'only/one.test.js']).code, 0, 'the narrowed root run is green');
    assertEq(npm(world, path.join(repo, 'packages', 'foo'), ['test']).code, 0, 'the nested run is green');
    assertEq(packaged(world, repo), JSON.stringify([`${tree} .`, `${tree} packages/foo`]), 'one line per package, each on the tree');
    cleanup(world.root); cleanup(repo);
  });

  await test("workspace members run with -w each record on their own id: an edit in one leaves the other's line proved", () => {
    const world = mkWorld();
    const member = (name, extra = {}) => ({ name, version: '1.0.0', scripts: { test: 'exit 0' }, ...extra });
    const repo = mkRepo({ private: true, workspaces: ['packages/*'], scripts: { test: 'exit 0' } }, {
      'packages/a/package.json': member('a'),
      'packages/a/index.js': 'module.exports = 1;\n',
      'packages/b/package.json': member('b'),
      'packages/b/index.js': 'module.exports = 2;\n',
      'packages/c/package.json': member('c', { dependencies: { a: '1.0.0' } }),
    });
    // Each member's id: the tree less the members it neither is nor depends on.
    const aId = treeHash(repo, ['packages/b', 'packages/c']);
    assertEq(npm(world, repo, ['test', '-w', 'a']).code, 0, 'a is green');
    assertEq(npm(world, repo, ['test', '-w', 'b']).code, 0, 'b is green');
    fs.writeFileSync(path.join(repo, 'packages', 'b', 'index.js'), 'module.exports = 20;\n');
    const bId = treeHash(repo, ['packages/a', 'packages/c']);
    assertEq(npm(world, repo, ['test', '-w', 'b']).code, 0, 'b is green after its edit');
    assertEq(JSON.stringify(JSON.parse(packaged(world, repo)).sort()), JSON.stringify([`${aId} packages/a`, `${bId} packages/b`].sort()),
      "a's line unchanged, b's on its new id");
    const root = git(repo, 'rev-parse', '--show-toplevel');
    const proved = runLib(`wk_pkg_proved "${root}" "$(wk_tree_hash "${root}" packages/a)" packages/a`,
      { ...world.env, WORKKIT_NODE: shellPath(process.execPath) });
    assertEq(proved.code, 0, `a is still proved on the tree as it is now, got: ${proved.stderr}`);
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: everything else passes through');

  await test('another script: stdout and exit code exactly as plain sh gives them, no record of either kind', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { build: 'echo built && exit 4', test: 'exit 0' } });
    const wrapped = npm(world, repo, ['run', 'build']);
    const plain = npm(world, repo, ['run', 'build'], 'sh');
    assertEq(wrapped.code, 4, `the script's code comes back, got: ${wrapped.code}`);
    assertEq(wrapped.out, plain.out, 'the wrapper adds nothing to stdout');
    assertEq(recorded(world, repo), undefined, 'only the test event records');
    assertEq(packaged(world, repo), undefined, 'and only the test event writes the package record');
    cleanup(world.root); cleanup(repo);
  });

  await test('a narrowed root run and another script run in the foreground: no suite log', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { build: 'echo built', test: 'echo ran' } });
    assertEq(npm(world, repo, ['test', '--', 'only/one.test.js']).code, 0, 'the narrowed run is green');
    assertEq(npm(world, repo, ['run', 'build']).code, 0, 'the other script is green');
    assert(!fs.existsSync(suiteLogPath(world.workflowHome, repo)), 'no suite log under the workflow home');
    assert(!fs.existsSync(path.join(repo, '.workkit', 'suite.log')), 'no suite log in the repo');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: an install-time script re-points the git hooks');

  await test('a prepare that takes core.hooksPath for husky: after npm install it is ours again, the husky folder saved', () => {
    const world = mkWorld();
    const repo = repoWith({ prepare: HUSKY });
    const res = install(world, repo);
    assertEq(res.code, 0, `npm install exits 0, got: ${res.out}${res.err}`);
    assert(isOurs(hooksPathOf(repo)), `core.hooksPath is the kit's githooks, got: ${hooksPathOf(repo)}`);
    assertEq(git(repo, 'config', '--local', '--get', 'workkit.hooksPath'), '.husky/_', 'the repo\'s own folder is saved for ours to chain to');
    cleanup(world.root); cleanup(repo);
  });

  await test('a prepare that exits 3 after taking the path: npm install fails, and the hooks are still ours', () => {
    const world = mkWorld();
    const repo = repoWith({ prepare: `${HUSKY} && exit 3` });
    const res = install(world, repo);
    assert(res.code !== 0, `npm install fails with its script, got: ${res.code}`);
    assert(isOurs(hooksPathOf(repo)), `core.hooksPath is the kit's githooks, got: ${hooksPathOf(repo)}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('a repo with no settings, and one that declined: the install leaves core.hooksPath at husky\'s', () => {
    for (const [label, settings] of [['no .workkit/settings.json', null], ['a declined repo', DECLINED]]) {
      const world = mkWorld();
      const repo = repoWith({ prepare: HUSKY }, settings);
      assertEq(install(world, repo).code, 0, `${label}: npm install exits 0`);
      assertEq(hooksPathOf(repo), '.husky/_', `${label}: nothing re-pointed`);
      cleanup(world.root); cleanup(repo);
    }
  });

  await test('npm run build in an opted-in repo: the script runs, core.hooksPath untouched', () => {
    const world = mkWorld();
    const mark = path.join(world.root, 'built');
    const repo = repoWith({ build: 'echo built > "$WK_MARK"' });
    git(repo, 'config', 'core.hooksPath', '.husky/_');
    const res = npm(world, repo, ['run', 'build'], world.wrapper, { WK_MARK: shellPath(mark) });
    assertEq(res.code, 0, `npm run build exits 0, got: ${res.err}`);
    assertEq(fs.readFileSync(mark, 'utf8'), 'built\n', 'the build script ran');
    assertEq(hooksPathOf(repo), '.husky/_', 'a script outside install time re-points nothing');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: the commit gate honors the record');

  await test('the gate blocks a staged code change, and after a green root run stands down', async () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'exit 0' } });
    fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
    git(repo, 'add', 'app.js');
    // The review marker check 2 reads, so check 5 is what answers.
    const review = reviewMarkerPath(world.workflowHome, repo);
    fs.mkdirSync(path.dirname(review), { recursive: true });
    fs.writeFileSync(review, '');
    const before = await gateOn(world, repo);
    assert(before.deny !== null, `no green run yet, so the commit is denied, got: ${before.context}`);
    assert(before.deny.includes('Run `npm test` at the repo root'), `naming the fix, got: ${before.deny}`);
    assertEq(npm(world, repo, ['test']).code, 0, 'the root suite ran green');
    const after = await gateOn(world, repo);
    assertEq(after.deny, null, 'the record proves the staged tree');
    assertEq(after.context, 'commit-gate: suite proved: a green root `npm test` recorded this tree.', 'the stand-down line');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
