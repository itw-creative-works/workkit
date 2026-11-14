// Tests for workflow/script-shell.sh, npm's script shell: a green root `npm test`
// records the tree it proved, every other green test run records its package,
// an install-time script in an opted-in repo is followed by the git hooks'
// re-point, and every other script passes straight through.
// The detached run and the checks before it are script-shell-detached.test.js;
// the world both run npm in is test/lib/script-shell.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect,
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

// What the wrapper's run reaches in the kit, by its path from the kit root: its
// libs, and the settings reader the launcher loads for a run's root.
const WRAPPER_PARTS = [
  'workflow/script-shell.sh', 'workflow/lib', 'workflow/user-dir.js',
  'hooks/package.json', 'hooks/mods/settings.js', 'hooks/mods/log.js', 'defaults/settings.json',
];

// The wrapper and what it reaches, copied in the kit's layout to <world.root>/kit
// so a case may rewrite it, its workflow/ linked as <world.root>/claude/workkit.
// On Windows the exe reaches it through WORKFLOW_CLAUDE_HOME (native, as mkWorld
// passes it); `file` is the copy in node's spelling.
const mkWrapperCopy = (world) => {
  const claude = path.join(world.root, 'claude');
  const kit = path.join(world.root, 'kit');
  for (const part of WRAPPER_PARTS) {
    fs.cpSync(path.join(ROOT, ...part.split('/')), path.join(kit, ...part.split('/')), { recursive: true });
  }
  fs.mkdirSync(claude, { recursive: true });
  fs.symlinkSync(path.join(kit, 'workflow'), path.join(claude, 'workkit'), 'junction');
  const file = path.join(kit, 'workflow', 'script-shell.sh');
  return IS_WINDOWS
    ? { shell: world.wrapper, env: { WORKFLOW_CLAUDE_HOME: claude }, file }
    : { shell: shellPath(file), env: {}, file };
};

// The lines a green run with CI set prints in place of its record.
const CI_SUITE_LINE = 'script-shell: the suite passed, but CI is set, so no record was written; run npm test again without CI';
const CI_RUN_LINE = 'script-shell: the run passed, but CI is set, so no record was written; run it again without CI';
// A detached run relays every body line on stdout, so a line is read from both streams.
const linesOf = (res) => `${res.out}\n${res.err}`.split(/\r?\n/);
const saysCi = (res) => `${res.out}${res.err}`.includes('CI is set');

// The commit gate, through the hooks module, asked about what <repo> has
// staged, on a machine whose npm names the world's script shell.
const gateOn = (world, repo) => gateIn(repo, { ...world.env, NPM_CONFIG_USERCONFIG: scratchNpmrc(world.wrapper) });

describe('script-shell', { skip: skipWithoutWrapper() }, () => {
  describe('script-shell: the root test records the tree it proved', () => {
    test('a green root npm test: exit 0, output streamed, the record holds the tree, no package record', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "console.log(\'streamed-green\')"' } });
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test']);
      expect(res.code, `exit 0, got: ${res.err}`).toBe(0);
      expect(res.out.includes('streamed-green'), `the script's output reaches the caller, got: ${res.out}`).toBeTruthy();
      assertRecord(recorded(world, repo), tree, 'the record holds the working tree it proved');
      expect(packaged(world, repo), 'the whole root suite never writes the package record').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test("a red root npm test: npm's exit code, no record", () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'echo streamed-red && exit 3' } });
      const res = npm(world, repo, ['test']);
      expect(res.code, `the script's code comes back, got: ${res.code} ${res.err}`).toBe(3);
      expect(res.out.includes('streamed-red'), `the failure output reaches the caller, got: ${res.out}`).toBeTruthy();
      expect(recorded(world, repo), 'a red run proves nothing').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a script that edits a committed file during the run writes no record', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'echo edited > app.js' } });
      const res = npm(world, repo, ['test']);
      expect(res.code, 'the run itself is green').toBe(0);
      expect(recorded(world, repo), 'the tree it ended on is not the tree it proved').toBe(undefined);
      expect(res.out.includes('script-shell: the suite passed, but the tree changed during the run, so no record was written; run npm test again\n'),
        `one line on the terminal says why, got: ${res.out}`).toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });

    test('a tree that cannot be hashed after the run: exit 1, the line names the hash, no record', () => {
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
      expect(fs.existsSync(flag), 'the suite ran and left its flag').toBeTruthy();
      expect(res.code, `a green run with no hash is not green, got: ${res.code} ${res.out} ${res.err}`).toBe(1);
      expect(res.out.includes('script-shell: the suite passed, but the tree of ')
        && res.out.includes(' could not be hashed, so no record was written\n'), `the line names the hash, got: ${res.out}`).toBeTruthy();
      expect(!res.out.includes('the tree changed during the run'), `never read as a changed tree, got: ${res.out}`).toBeTruthy();
      expect(recorded(world, repo), 'no record was written').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: the wrapper is parsed whole before the run', () => {
    test('an in-place rewrite of the wrapper during the run changes nothing: green, the record holds the tree', () => {
      const world = mkWorld();
      const kit = mkWrapperCopy(world);
      const repo = mkRepo({ scripts: {
        test: 'c=$(cat "$WK_COPY"); printf \'# a line added while the suite ran\\n%s\\n\' "$c" > "$WK_COPY"; echo rewrote',
      } });
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test'], kit.shell, { ...kit.env, WK_COPY: shellPath(kit.file) });
      expect(res.code, `exit 0, got: ${res.code} ${res.err}`).toBe(0);
      expect(res.out.includes('rewrote'), `the suite ran to its end, got: ${res.out}`).toBeTruthy();
      expect(fs.readFileSync(kit.file, 'utf8').split('\n')[0], 'the wrapper on disk was rewritten while it ran').toBe('# a line added while the suite ran');
      // The body's lines reach stdout through the log; its closing line is the one expected.
      const shellLines = res.out.split('\n').filter((l) => l.startsWith('script-shell:'));
      expect(!`${res.out}${res.err}`.includes('command not found') && !res.err.includes('script-shell:')
        && shellLines.every((l) => l === 'script-shell: exit 0'), `the running shell read no fragment, got: ${res.out} ${res.err}`).toBeTruthy();
      assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      cleanup(world.root); cleanup(repo);
    });

    test('a record that cannot be written: exit 1, the line names it, no record', () => {
      const world = mkWorld();
      const kit = mkWrapperCopy(world);
      const repo = mkRepo({ scripts: { test: 'exit 0' } });
      fs.mkdirSync(path.join(world.workflowHome, 'markers'), { recursive: true });
      fs.writeFileSync(path.join(world.workflowHome, 'markers', 'claude-suite-marker'), '');
      const res = npm(world, repo, ['test'], kit.shell, kit.env);
      expect(res.code, `a green run with no record is not green, got: ${res.code} ${res.err}`).toBe(1);
      expect(res.out.includes('script-shell: the suite passed, but the record of ')
        && res.out.includes(' could not be written'), `the script-shell line says why, got: ${res.out}`).toBeTruthy();
      expect(recorded(world, repo), 'no record was written').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: every other green test run records its package', () => {
    test('a narrowed root run (npm test -- <file>) green: the package record holds `.` under the tree, no suite record', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } });
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
      expect(res.code, `exit 0, got: ${res.err}`).toBe(0);
      expect(packaged(world, repo), 'the tree it ran on, then the root package').toBe(JSON.stringify([`${tree} .`]));
      expect(recorded(world, repo), 'a narrowed run never touches the suite record').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a nested package npm test green, run from its folder: the package record holds its folder', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'exit 0' } }, {
        'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo nested-ran' } },
      });
      const tree = treeHash(repo);
      const res = npm(world, path.join(repo, 'packages', 'foo'), ['test']);
      expect(res.code, `exit 0, got: ${res.err}`).toBe(0);
      expect(res.out.includes('nested-ran'), `the nested script ran, got: ${res.out}`).toBeTruthy();
      expect(packaged(world, repo), 'the folder relative to the root').toBe(JSON.stringify([`${tree} packages/foo`]));
      expect(recorded(world, repo), 'a nested suite is not the root suite').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a workspace member run from the root (-w) green: the package record holds its folder', () => {
      const world = mkWorld();
      const repo = mkRepo({ workspaces: ['packages/*'], scripts: { test: 'exit 0' } }, {
        'packages/foo/package.json': { name: 'foo', scripts: { test: 'echo member-ran' } },
      });
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test', '-w', 'foo']);
      expect(res.code, `exit 0, got: ${res.err}`).toBe(0);
      expect(res.out.includes('member-ran'), `the member's script ran, got: ${res.out}`).toBeTruthy();
      expect(packaged(world, repo), "the member's folder, never the root").toBe(JSON.stringify([`${tree} packages/foo`]));
      expect(recorded(world, repo), "a member's suite is not the root suite").toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test("a red narrowed run: npm's exit code, no package record", () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "process.exit(3)"' } });
      const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
      expect(res.code, `the script's code comes back, got: ${res.code} ${res.err}`).toBe(3);
      expect(packaged(world, repo), 'a red run proves nothing').toBe(undefined);
      expect(recorded(world, repo), 'and no suite record either').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a narrowed run that edits a committed file writes no package record and says so', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'echo edited > app.js' } });
      const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
      expect(fs.readFileSync(path.join(repo, 'app.js'), 'utf8').startsWith('edited'), 'the script edited the file').toBe(true);
      expect(packaged(world, repo), 'the tree it ended on is not the tree it ran on').toBe(undefined);
      expect(res.code, `a green run whose tree changed still exits 0, got: ${res.code} ${res.err}`).toBe(0);
      expect(/^script-shell: the run passed, but the tree changed during it, /m.test(`${res.out}\n${res.err}`),
        `the package run's line says the tree changed, got: ${res.out} ${res.err}`).toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });

    test('a second package green on the same tree gets its own line', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } }, {
        'packages/foo/package.json': { name: 'foo', scripts: { test: 'exit 0' } },
      });
      const tree = treeHash(repo);
      expect(npm(world, repo, ['test', '--', 'only/one.test.js']).code, 'the narrowed root run is green').toBe(0);
      expect(npm(world, path.join(repo, 'packages', 'foo'), ['test']).code, 'the nested run is green').toBe(0);
      expect(packaged(world, repo), 'one line per package, each on the tree').toBe(JSON.stringify([`${tree} .`, `${tree} packages/foo`]));
      cleanup(world.root); cleanup(repo);
    });

    test("workspace members run with -w each record on their own id: an edit in one leaves the other's line proved", () => {
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
      expect(npm(world, repo, ['test', '-w', 'a']).code, 'a is green').toBe(0);
      expect(npm(world, repo, ['test', '-w', 'b']).code, 'b is green').toBe(0);
      fs.writeFileSync(path.join(repo, 'packages', 'b', 'index.js'), 'module.exports = 20;\n');
      const bId = treeHash(repo, ['packages/a', 'packages/c']);
      expect(npm(world, repo, ['test', '-w', 'b']).code, 'b is green after its edit').toBe(0);
      expect(JSON.stringify(JSON.parse(packaged(world, repo)).sort()), "a's line unchanged, b's on its new id").toBe(JSON.stringify([`${aId} packages/a`, `${bId} packages/b`].sort()));
      const root = git(repo, 'rev-parse', '--show-toplevel');
      const proved = runLib(`wk_pkg_proved "${root}" "$(wk_tree_hash "${root}" packages/a)" packages/a`,
        { ...world.env, WORKKIT_NODE: shellPath(process.execPath) });
      expect(proved.code, `a is still proved on the tree as it is now, got: ${proved.stderr}`).toBe(0);
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: a run with CI set writes no record', () => {
    test('a green root npm test with CI=true: exit 0, the suite ran, no suite record, one line says why', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "console.log(\'streamed-green\')"' } });
      const res = npm(world, repo, ['test'], world.wrapper, { CI: 'true' });
      expect(res.code, `exit 0, got: ${res.code} ${res.err}`).toBe(0);
      expect(res.out.includes('streamed-green'), `the suite ran as today, got: ${res.out}`).toBeTruthy();
      expect(recorded(world, repo), 'a run with CI set records nothing').toBe(undefined);
      expect(res.out.split(/\r?\n/).includes(CI_SUITE_LINE), `the suite line on stdout, got: ${res.out}`).toBeTruthy();
      expect(res.err.includes('CI is set'), `never on stderr, got: ${res.err}`).toBe(false);
      cleanup(world.root); cleanup(repo);
    });

    test('a green narrowed run with CI=true: exit 0, no package record, one line says why', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } });
      const res = npm(world, repo, ['test', '--', 'only/one.test.js'], world.wrapper, { CI: 'true' });
      expect(res.code, `exit 0, got: ${res.code} ${res.err}`).toBe(0);
      expect(packaged(world, repo), 'a run with CI set writes no package record').toBe(undefined);
      expect(recorded(world, repo), 'and no suite record').toBe(undefined);
      expect(res.out.split(/\r?\n/).includes(CI_RUN_LINE), `the run line on stdout, got: ${res.out}`).toBeTruthy();
      expect(res.err.includes('CI is set'), `never on stderr, got: ${res.err}`).toBe(false);
      cleanup(world.root); cleanup(repo);
    });

    test('a green narrowed run with CI=false: CI is read as set, no package record, the run line', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'node -e "process.exit(0)"' } });
      const res = npm(world, repo, ['test', '--', 'only/one.test.js'], world.wrapper, { CI: 'false' });
      expect(res.code, `exit 0, got: ${res.code} ${res.err}`).toBe(0);
      expect(packaged(world, repo), 'CI=false writes no package record').toBe(undefined);
      expect(linesOf(res).includes(CI_RUN_LINE), `the run line, got: ${res.out} ${res.err}`).toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });

    test('a green run with CI=true that edits a committed file: only the CI line prints, never the tree-changed one', () => {
      for (const [label, args, line] of [['root', ['test'], CI_SUITE_LINE], ['narrowed', ['test', '--', 'only/one.test.js'], CI_RUN_LINE]]) {
        const world = mkWorld();
        const repo = mkRepo({ scripts: { test: 'echo edited > app.js' } });
        const res = npm(world, repo, args, world.wrapper, { CI: 'true' });
        expect(res.code, `${label}: exit 0, got: ${res.code} ${res.err}`).toBe(0);
        expect(linesOf(res).includes(line), `${label}: the CI line, got: ${res.out} ${res.err}`).toBeTruthy();
        expect(`${res.out}${res.err}`.includes('the tree changed during'), `${label}: no tree-changed line, got: ${res.out} ${res.err}`).toBe(false);
        expect(recorded(world, repo) === undefined && packaged(world, repo) === undefined, `${label}: no record of either kind`).toBe(true);
        cleanup(world.root); cleanup(repo);
      }
    });

    test('CI=1 and CI=false are each read as set: no record, the line', () => {
      for (const value of ['1', 'false']) {
        const world = mkWorld();
        const repo = mkRepo({ scripts: { test: 'exit 0' } });
        const res = npm(world, repo, ['test'], world.wrapper, { CI: value });
        expect(res.code, `CI=${value}: exit 0, got: ${res.code} ${res.err}`).toBe(0);
        expect(recorded(world, repo), `CI=${value}: no record`).toBe(undefined);
        expect(linesOf(res).includes(CI_SUITE_LINE), `CI=${value}: the line, got: ${res.out} ${res.err}`).toBeTruthy();
        cleanup(world.root); cleanup(repo);
      }
    });

    test('CI empty, and CI not set: the record is written as today, no CI line', () => {
      for (const [label, ci] of [['CI empty', { CI: '' }], ['CI not set', { CI: undefined }]]) {
        const world = mkWorld();
        const repo = mkRepo({ scripts: { test: 'exit 0' } });
        const tree = treeHash(repo);
        const res = npm(world, repo, ['test'], world.wrapper, ci);
        expect(res.code, `${label}: exit 0, got: ${res.code} ${res.err}`).toBe(0);
        assertRecord(recorded(world, repo), tree, `${label}: the record holds the tree`);
        expect(saysCi(res), `${label}: no CI line, got: ${res.out} ${res.err}`).toBe(false);
        cleanup(world.root); cleanup(repo);
      }
    });

    test("a red root npm test with CI=true: the suite's exit code, no CI line, no record", () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'exit 3' } });
      const res = npm(world, repo, ['test'], world.wrapper, { CI: 'true' });
      expect(res.code, `the script's code comes back, got: ${res.code} ${res.err}`).toBe(3);
      expect(saysCi(res), `a red run says nothing of CI, got: ${res.out} ${res.err}`).toBe(false);
      expect(recorded(world, repo), 'a red run proves nothing').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: everything else passes through', () => {
    test('another script: stdout and exit code exactly as plain sh gives them, no record of either kind', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { build: 'echo built && exit 4', test: 'exit 0' } });
      const wrapped = npm(world, repo, ['run', 'build']);
      const plain = npm(world, repo, ['run', 'build'], 'sh');
      expect(wrapped.code, `the script's code comes back, got: ${wrapped.code}`).toBe(4);
      expect(wrapped.out, 'the wrapper adds nothing to stdout').toBe(plain.out);
      expect(recorded(world, repo), 'only the test event records').toBe(undefined);
      expect(packaged(world, repo), 'and only the test event writes the package record').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a narrowed root run and another script: no suite log', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { build: 'echo built', test: 'echo ran' } });
      expect(npm(world, repo, ['test', '--', 'only/one.test.js']).code, 'the narrowed run is green').toBe(0);
      expect(npm(world, repo, ['run', 'build']).code, 'the other script is green').toBe(0);
      expect(!fs.existsSync(suiteLogPath(world.workflowHome, repo)), 'no suite log under the workflow home').toBeTruthy();
      expect(!fs.existsSync(path.join(repo, '.workkit', 'suite.log')), 'no suite log in the repo').toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: an install-time script re-points the git hooks', () => {
    test('a prepare that takes core.hooksPath for husky: after npm install it is ours again, the husky folder saved', () => {
      const world = mkWorld();
      const repo = repoWith({ prepare: HUSKY });
      const res = install(world, repo);
      expect(res.code, `npm install exits 0, got: ${res.out}${res.err}`).toBe(0);
      expect(isOurs(hooksPathOf(repo)), `core.hooksPath is the kit's githooks, got: ${hooksPathOf(repo)}`).toBeTruthy();
      expect(git(repo, 'config', '--local', '--get', 'workkit.hooksPath'), 'the repo\'s own folder is saved for ours to chain to').toBe('.husky/_');
      cleanup(world.root); cleanup(repo);
    });

    test('a prepare that exits 3 after taking the path: npm install fails, and the hooks are still ours', () => {
      const world = mkWorld();
      const repo = repoWith({ prepare: `${HUSKY} && exit 3` });
      const res = install(world, repo);
      expect(res.code !== 0, `npm install fails with its script, got: ${res.code}`).toBeTruthy();
      expect(isOurs(hooksPathOf(repo)), `core.hooksPath is the kit's githooks, got: ${hooksPathOf(repo)}`).toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });

    test('a repo with no settings, and one that declined: the install leaves core.hooksPath at husky\'s', () => {
      for (const [label, settings] of [['no .workkit/settings.json', null], ['a declined repo', DECLINED]]) {
        const world = mkWorld();
        const repo = repoWith({ prepare: HUSKY }, settings);
        expect(install(world, repo).code, `${label}: npm install exits 0`).toBe(0);
        expect(hooksPathOf(repo), `${label}: nothing re-pointed`).toBe('.husky/_');
        cleanup(world.root); cleanup(repo);
      }
    });

    test('npm run build in an opted-in repo: the script runs, core.hooksPath untouched', () => {
      const world = mkWorld();
      const mark = path.join(world.root, 'built');
      const repo = repoWith({ build: 'echo built > "$WK_MARK"' });
      git(repo, 'config', 'core.hooksPath', '.husky/_');
      const res = npm(world, repo, ['run', 'build'], world.wrapper, { WK_MARK: shellPath(mark) });
      expect(res.code, `npm run build exits 0, got: ${res.err}`).toBe(0);
      expect(fs.readFileSync(mark, 'utf8'), 'the build script ran').toBe('built\n');
      expect(hooksPathOf(repo), 'a script outside install time re-points nothing').toBe('.husky/_');
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: the commit gate honors the record', () => {
    test('the gate blocks a staged code change, and after a green root run stands down', async () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'exit 0' } });
      fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
      git(repo, 'add', 'app.js');
      // The review marker check 2 reads, so check 5 is what answers.
      const review = reviewMarkerPath(world.workflowHome, repo);
      fs.mkdirSync(path.dirname(review), { recursive: true });
      fs.writeFileSync(review, '');
      const before = await gateOn(world, repo);
      expect(before.deny !== null, `no green run yet, so the commit is denied, got: ${before.context}`).toBeTruthy();
      expect(before.deny.includes('Run `npm test` at the repo root'), `naming the fix, got: ${before.deny}`).toBeTruthy();
      expect(npm(world, repo, ['test']).code, 'the root suite ran green').toBe(0);
      const after = await gateOn(world, repo);
      expect(after.deny, 'the record proves the staged tree').toBe(null);
      expect(after.context, 'the stand-down line').toBe('commit-gate: suite proved: a green root `npm test` recorded this tree.');
      cleanup(world.root); cleanup(repo);
    });

    test('a green root run with CI=true, then a commit of that tree: the gate refuses it for a missing record', async () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'exit 0' } });
      fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
      git(repo, 'add', 'app.js');
      const review = reviewMarkerPath(world.workflowHome, repo);
      fs.mkdirSync(path.dirname(review), { recursive: true });
      fs.writeFileSync(review, '');
      expect(npm(world, repo, ['test'], world.wrapper, { CI: 'true' }).code, 'the root suite ran green').toBe(0);
      const verdict = await gateOn(world, repo);
      expect(verdict.deny !== null, `no record, so the commit is denied, got: ${verdict.context}`).toBeTruthy();
      expect(verdict.deny.includes('Run `npm test` at the repo root'), `naming the fix, got: ${verdict.deny}`).toBeTruthy();
      cleanup(world.root); cleanup(repo);
    });
  });
});
