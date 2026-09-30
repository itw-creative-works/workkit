// Tests for hooks/safety/commit-gate check 5: a commit carrying code needs the
// record a green root `npm test` wrote for the tree it carries; the gate runs no
// suite itself. The shared prologue (the hook runner, the repo and marker
// factories, the fixtures) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  group, test, skip, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_BASH, NODE_DIR, which, joinPath, cygpathStub,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const {
  skipWithoutDigest, TMP, stage, stageDeep, touchMarker, dropMarker, runHook, standDownMessage, cleanup,
  pkg, suiteRan, mkReleaseRepo, WRAPPER, scratchNpmrc,
} = require('./helpers');
const { plantRecord } = require('../../lib/suite-record');

const PROVED = 'commit-gate: suite proved: a green root `npm test` recorded this tree.';
const NO_CODE = 'commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only).';

// The block check 5 bounces with, and proof the gate ran nothing on the way.
const recordRequired = (out, dir) => {
  assertEq(out.code, 2, `no record for this tree blocks, got: ${out.stderr}`);
  assert(out.stderr.includes('no green run proves this tree'), `for the record reason, got: ${out.stderr}`);
  assert(out.stderr.includes('Run `npm test` at the repo root'), `naming the fix, got: ${out.stderr}`);
  assert(!suiteRan(dir), 'the gate never runs the suite');
};

// The block when the record proves the disk tree and the commit carries another.
const diskProved = (out, dir) => {
  assertEq(out.code, 2, `the disk tree is not the commit's, got: ${out.stderr}`);
  assert(out.stderr.includes('the green run proved the tree on disk, and this commit carries a different one'),
    `for the gap reason, got: ${out.stderr}`);
  assert(out.stderr.includes('`git add -A`'), `naming the fix, got: ${out.stderr}`);
  assert(!suiteRan(dir), 'the gate never runs the suite');
};

// A no-code commit passes with the stand-down line and no suite.
const recordNotRequired = (out, dir) => {
  assertEq(out.code, 0, `allowed, got: ${out.stderr}`);
  assertEq(standDownMessage(out), NO_CODE, 'the no-code stand-down');
  assert(!suiteRan(dir), 'the gate never runs the suite');
};

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: the record is required only for commits carrying code');

  // The fixture's test script leaves a sentinel, so a suite the gate ran would
  // be visible; every case asserts it never is.
  await test('docs-only commit: no record required', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'README.md', '# docs\n');
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "docs: readme"'), dir);
    cleanup(dir);
  });

  await test('version-only root package.json bump: no record required', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore(release): 1.0.1"'), dir);
    cleanup(dir);
  });

  await test('version bump plus a second changed key: gates as code', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1', { description: 'now with a second change' }));
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(first.code, 2, 'any second change restores code classification');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded as today, got: ${first.stderr}`);
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -m "chore: bump"'), dir);
    cleanup(dir);
  });

  await test('a code file alongside the version bump: record required', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    stage(dir, 'app.js', 'const x = 2;\n');
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -m "feat: thing"'), dir);
    cleanup(dir);
  });

  // The other file a repo keeps its version in: a plugin repo (this one
  // included) bumps both in the same release commit.
  const manifest = (version, extra) => `${JSON.stringify({
    name: 'fixture', version, description: 'a plugin', ...extra,
  }, null, 2)}\n`;

  const mkPluginRepo = () => {
    const dir = mkReleaseRepo();
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.0'));
    execSync('git commit -q -m "manifest" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    return dir;
  };

  await test('version-only plugin.json bump: no record required', () => {
    const dir = mkPluginRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.1'));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore(release): 1.0.1"'), dir);
    cleanup(dir);
  });

  await test('plugin.json version bump plus a second changed key: gates as code', () => {
    const dir = mkPluginRepo();
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.1', { description: 'reworded' }));
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(first.code, 2, 'any second change restores code classification');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded, got: ${first.stderr}`);
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -m "chore: bump"'), dir);
    cleanup(dir);
  });

  await test('a script under a docs PATH is code: record required', () => {
    // hooks/docs/*/run.sh is executable bash living under a docs directory.
    // Seeded first, then modified, so check 1 (new source needs tests) is not
    // what answers.
    const dir = mkReleaseRepo();
    stageDeep(dir, 'hooks/docs/x/run.sh', '#!/bin/bash\necho hi\n');
    execSync('git commit -q -m "hook" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stageDeep(dir, 'hooks/docs/x/run.sh', '#!/bin/bash\necho tweaked\n');
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "fix: the hook"');
    assertEq(first.code, 2, 'a code extension wins over the docs path');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded, got: ${first.stderr}`);
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -m "fix: the hook"'), dir);
    cleanup(dir);
  });

  await test('a .md under a docs path is still docs: no record required', () => {
    const dir = mkReleaseRepo();
    stageDeep(dir, 'docs/notes.md', '# notes\n');
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "docs: notes"'), dir);
    cleanup(dir);
  });

  await test('-am: the working tree decides the version bump, not the index', () => {
    // The -a/--all arm of the helper: what the commit carries is the working
    // tree, so an edit past the version there is code even when the index holds
    // a clean bump.
    const clean = mkReleaseRepo();
    stage(clean, 'package.json', pkg('1.0.1'));
    dropMarker(clean);
    recordNotRequired(runHook(clean, 'git commit -am "chore(release): 1.0.1"'), clean);
    cleanup(clean);

    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('1.0.1', { description: 'edited past the bump' }));
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -am "chore(release): 1.0.1"'), dir);
    cleanup(dir);
  });

  // A workspace member's package.json, committed, so a case stages its bump.
  const DEPS = { '@fixture/other': '1.0.0', lodash: '^4.0.0' };
  const mkWorkspaceRepo = (member) => {
    const dir = mkReleaseRepo();
    stageDeep(dir, 'sub/package.json', member);
    execSync('git commit -q -m "sub" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    return dir;
  };

  // A nested bump is gated as code: the marker first, then the record.
  const gatesAsCode = (dir) => {
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "chore: bump sub"');
    assertEq(first.code, 2, `the nested file is code, got: ${first.stderr}`);
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded, got: ${first.stderr}`);
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -m "chore: bump sub"'), dir);
  };

  await test('a nested package.json version bump is a version stamp: no record required', () => {
    const dir = mkWorkspaceRepo(pkg('1.0.0'));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1'));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore: bump sub"'), dir);
    cleanup(dir);
  });

  await test('a nested package.json lockstep bump moves version and exact pins together: no record required', () => {
    const dir = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore: bump sub"'), dir);
    cleanup(dir);
  });

  await test('a version bumped alone past a pin equal to the old version: no record required', () => {
    // The pin stays put, so only the lockstep reading would call it moved.
    const dir = mkReleaseRepo(pkg('1.0.0', { dependencies: { foo: '1.0.0' } }));
    stage(dir, 'package.json', pkg('1.0.1', { dependencies: { foo: '1.0.0' } }));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore(release): 1.0.1"'), dir);
    cleanup(dir);
  });

  await test('a nested package.json lockstep bump moves a devDependencies pin too: no record required', () => {
    const dir = mkWorkspaceRepo(pkg('1.0.0', { devDependencies: DEPS }));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1', { devDependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    dropMarker(dir);
    recordNotRequired(runHook(dir, 'git commit -m "chore: bump sub"'), dir);
    cleanup(dir);
  });

  await test('a range pin moved with the version gates as code: only exact pins are lockstep', () => {
    const range = { ...DEPS, '@fixture/other': '^1.0.0' };
    const dir = mkWorkspaceRepo(pkg('1.0.0', { dependencies: range }));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1', { dependencies: { ...range, '@fixture/other': '^1.0.1' } }));
    gatesAsCode(dir);
    cleanup(dir);
  });

  await test('a pin moved to a value other than the version gates as code', () => {
    const dir = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.2' } }));
    gatesAsCode(dir);
    cleanup(dir);
  });

  await test('a dependency added beside the bump gates as code', () => {
    // The added pin equals the new version, so only the new key tells it apart.
    const dir = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stageDeep(dir, 'sub/package.json', pkg('1.0.1', {
      dependencies: { ...DEPS, '@fixture/other': '1.0.1', '@fixture/third': '1.0.1' },
    }));
    gatesAsCode(dir);
    cleanup(dir);
  });

  group('commit-gate: the suite record');

  // A code commit, reviewed, everything staged.
  const codeCommit = () => {
    const dir = mkReleaseRepo();
    stage(dir, 'app.js', 'const x = 2;\n');
    touchMarker(dir);
    return dir;
  };

  await test('a record holding the index tree: exit 0 and the stand-down line', () => {
    const dir = codeCommit();
    plantRecord(TMP, dir);
    const out = runHook(dir, 'git commit -m "feat: thing"');
    assertEq(out.code, 0, `a proved tree passes, got: ${out.stderr}`);
    assertEq(standDownMessage(out), PROVED, 'the stand-down line');
    assert(!suiteRan(dir), 'the gate never runs the suite');
    cleanup(dir);
  });

  await test('no record: blocked, naming npm test at the repo root', () => {
    const dir = codeCommit();
    recordRequired(runHook(dir, 'git commit -m "feat: thing"'), dir);
    cleanup(dir);
  });

  // npm beside this node answers the hint's config read, from <npmrc>.
  const npmEnv = (npmrc) => ({ PATH: joinPath(NODE_DIR, process.env.PATH), NPM_CONFIG_USERCONFIG: npmrc });
  const npmTest = (name, fn) => (which('npm', NODE_DIR) ? test(name, fn) : skip(name, 'no npm beside this node'));

  await npmTest("no record and npm's script-shell unset: blocked, naming workkit setup", () => {
    const dir = codeCommit();
    const out = runHook(dir, 'git commit -m "feat: thing"', undefined, npmEnv(scratchNpmrc('')));
    assertEq(out.code, 2, `no record blocks, got: ${out.stderr}`);
    assert(out.stderr.includes("the commit carries code and no green run proves this tree, and npm's script-shell does not point at the kit's wrapper, so a root `npm test` writes no record. Run `workkit setup` once, then `npm test` at the repo root, then commit."),
      `the cause and its fix, got: ${out.stderr}`);
    assert(!suiteRan(dir), 'the gate never runs the suite');
    cleanup(dir);
  });

  await (WRAPPER ? npmTest : (n) => skip(n, 'no C# compiler on this Windows, so the script shell cannot be built'))("no record and npm's script-shell set to the wrapper: the plain block", () => {
    const dir = codeCommit();
    const out = runHook(dir, 'git commit -m "feat: thing"', undefined, npmEnv(scratchNpmrc(WRAPPER)));
    recordRequired(out, dir);
    assert(!out.stderr.includes('workkit setup'), `no setup hint, got: ${out.stderr}`);
    cleanup(dir);
  });

  // The Windows compare driven from any machine: the platform the hooks read,
  // a stub cygpath inverting its own `C:` prefix, and a scratch machine folder
  // holding the built executable unless <built> is false.
  const onWindows = (npmrcShell, { built = true } = {}) => {
    const home = mkTmp('cg-workkit-home-');
    const cyg = mkTmp('cg-cygpath-');
    cygpathStub(cyg);
    if (built) fs.writeFileSync(path.join(home, 'script-shell.exe'), '');
    const shell = npmrcShell(path.join(home, 'script-shell.exe'));
    return {
      home,
      env: {
        ...npmEnv(scratchNpmrc(shell)), PATH: joinPath(cyg, NODE_DIR, process.env.PATH), HOOK_UNAME_S: 'MSYS', WORKFLOW_HOME: home,
      },
    };
  };
  const stubWindowsTest = (name, fn) => {
    if (IS_WINDOWS) return skip(name, 'a stub cygpath cannot shadow the real one on Windows');
    return npmTest(name, fn);
  };

  await stubWindowsTest("Windows, npm's script-shell naming the built executable: the plain block", () => {
    const dir = codeCommit();
    const { home, env } = onWindows((exe) => `C:${exe}`);
    const out = runHook(dir, 'git commit -m "feat: thing"', undefined, env);
    recordRequired(out, dir);
    assert(!out.stderr.includes('workkit setup'), `no setup hint, got: ${out.stderr}`);
    cleanup(dir); cleanup(home);
  });

  await stubWindowsTest("Windows, npm's script-shell naming the executable, deleted: blocked, naming workkit setup", () => {
    const dir = codeCommit();
    const { home, env } = onWindows((exe) => `C:${exe}`, { built: false });
    const out = runHook(dir, 'git commit -m "feat: thing"', undefined, env);
    assertEq(out.code, 2, `no record blocks, got: ${out.stderr}`);
    assert(out.stderr.includes('Run `workkit setup` once'), `the setup hint, got: ${out.stderr}`);
    cleanup(dir); cleanup(home);
  });

  await stubWindowsTest("Windows, npm's script-shell naming another program: blocked, naming workkit setup", () => {
    const dir = codeCommit();
    // A file that exists, so the compare answers rather than a failed `cd`.
    const { home, env } = onWindows((exe) => {
      const other = path.join(path.dirname(exe), 'other.exe');
      fs.writeFileSync(other, '');
      return `C:${other}`;
    });
    const out = runHook(dir, 'git commit -m "feat: thing"', undefined, env);
    assertEq(out.code, 2, `no record blocks, got: ${out.stderr}`);
    assert(out.stderr.includes('Run `workkit setup` once'), `the setup hint, got: ${out.stderr}`);
    cleanup(dir); cleanup(home);
  });

  await test('a stale record, holding another tree: blocked', () => {
    const dir = codeCommit();
    plantRecord(TMP, dir, '0000000000000000000000000000000000000000');
    recordRequired(runHook(dir, 'git commit -m "feat: thing"'), dir);
    cleanup(dir);
  });

  await test('a record holding the disk tree while the index holds another: blocked, naming the gap', () => {
    const dir = codeCommit();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 3;\n');
    plantRecord(TMP, dir);
    const out = runHook(dir, 'git commit -m "feat: thing"');
    diskProved(out, dir);
    assert(!out.stdout.includes('suite proved'), `no stand-down line, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('an untracked file the green run saw: blocked, naming the gap', () => {
    const dir = codeCommit();
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'scratch\n');
    plantRecord(TMP, dir);
    diskProved(runHook(dir, 'git commit -m "feat: thing"'), dir);
    cleanup(dir);
  });

  await test('a pathspec code commit: blocked even when the record matches the index', () => {
    const dir = codeCommit();
    plantRecord(TMP, dir);
    const out = runHook(dir, 'git commit -m "feat: thing" -- app.js');
    assertEq(out.code, 2, `a pathspec tree is never compared, got: ${out.stderr}`);
    assert(out.stderr.includes('a pathspec commit carries a tree the gate cannot compare with the record'),
      `for the pathspec reason, got: ${out.stderr}`);
    assert(out.stderr.includes('stage the files and commit from the index'), `naming the fix, got: ${out.stderr}`);
    assert(!suiteRan(dir), 'the gate never runs the suite');
    cleanup(dir);
  });

  await test('-a: the record proves the tree -a carries, the tracked edits on disk', () => {
    const dir = mkReleaseRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    touchMarker(dir);
    recordRequired(runHook(dir, 'git commit -am "feat: thing"'), dir);
    plantRecord(TMP, dir);
    const out = runHook(dir, 'git commit -am "feat: thing"');
    assertEq(out.code, 0, `the working tree is what -a commits, got: ${out.stderr}`);
    assertEq(standDownMessage(out), PROVED, 'the stand-down line');
    cleanup(dir);
  });

  await test('a repo with no root test script: code commits need no record', () => {
    const dir = mkReleaseRepo(`${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`);
    stage(dir, 'app.js', 'const x = 2;\n');
    touchMarker(dir);
    const out = runHook(dir, 'git commit -m "feat: thing"');
    assertEq(out.code, 0, `there is no suite to prove, got: ${out.stderr}`);
    assertEq(standDownMessage(out), '', 'and says nothing about one');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
