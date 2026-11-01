// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in hooks/mods/commit-gate.js, check 5:
// a commit carrying code needs the record a green root `npm test` wrote for the tree it carries
// (`treeId`, the commit's index tree as tree-hash.sh -i takes it); the gate runs no suite. The script-shell compare
// reads physical paths through `real`. The prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, summary, selfRun, mkTmp } = require('../../lib/harness');
const {
  T, NOTICE, stage, write, commit, touchMarker, proveTree, judge, denyOf, blocks, passes, recordBlocks,
  suiteRan, pkg, mkReleaseRepo,
} = require('./helpers');

// A no-code commit passes with the stand-down line and no suite.
const recordNotRequired = (v, r) => {
  passes(v, NOTICE.noCode, 'the no-code stand-down');
  assert(!suiteRan(r), 'the gate never runs the suite');
};

// The record block, and proof the gate ran nothing on the way.
const recordRequired = (v, r) => {
  recordBlocks(v);
  assert(!suiteRan(r), 'the gate never runs the suite');
};

// The block when the record proves the disk tree and the commit carries another.
const diskProved = (v, r) => {
  blocks(v, T.disk, 'the disk tree is not the commit\'s');
  assert(!suiteRan(r), 'the gate never runs the suite');
};

// A plugin repo's manifest, the other file a repo keeps its version in.
const manifest = (version, extra) => `${JSON.stringify({ name: 'fixture', version, description: 'a plugin', ...extra }, null, 2)}\n`;
const mkPluginRepo = () => {
  const r = mkReleaseRepo();
  stage(r, '.claude-plugin/plugin.json', manifest('1.0.0'));
  commit(r);
  return r;
};

// A workspace member's package.json, committed, so a case stages its bump.
const DEPS = { '@fixture/other': '1.0.0', lodash: '^4.0.0' };
const mkWorkspaceRepo = (member) => {
  const r = mkReleaseRepo();
  stage(r, 'sub/package.json', member);
  commit(r);
  return r;
};

// A nested bump is gated as code: the marker first, then the record.
const gatesAsCode = async (r) => {
  blocks(await judge(r, 'chore: bump sub'), T.noReview, 'the nested file is code: the review marker is demanded');
  touchMarker(r);
  recordRequired(await judge(r, 'chore: bump sub'), r);
};

const NESTED_MANIFEST = 'agent-plugins/claude/.claude-plugin/plugin.json';
const mkNestedPluginRepo = () => {
  const r = mkReleaseRepo();
  stage(r, NESTED_MANIFEST, manifest('1.0.0'));
  commit(r);
  return r;
};

// A workspaces lockfile as npm writes one: the version at the top, in the root
// entry and in the member's, beside a dependency's entry; `dep` overrides that entry's version.
const lockfile = (version, dep = '4.17.21') => `${JSON.stringify({
  name: 'fixture',
  version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'fixture', version, workspaces: ['sub'] },
    'node_modules/@fixture/sub': { resolved: 'sub', link: true },
    'node_modules/lodash': { version: dep },
    sub: { name: '@fixture/sub', version },
  },
}, null, 2)}\n`;
const mkLockRepo = () => {
  const r = mkReleaseRepo();
  stage(r, 'package-lock.json', lockfile('1.0.0'));
  commit(r);
  return r;
};

// A code commit, reviewed, everything staged.
const codeCommit = () => {
  const r = mkReleaseRepo();
  stage(r, 'app.js', 'const x = 2;\n');
  touchMarker(r);
  return r;
};

const cases = async () => {
  group('commit-gate: the record is required only for commits carrying code');

  await test('docs-only commit: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'README.md', '# docs\n');
    recordNotRequired(await judge(r, 'docs: readme'), r);
  });

  await test('version-only root package.json bump: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  await test('version bump plus a second changed key: gates as code', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1', { description: 'now with a second change' }));
    blocks(await judge(r, 'chore: bump'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'chore: bump'), r);
  });

  await test('a code file alongside the version bump: record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  await test('version-only plugin.json bump: no record required', async () => {
    const r = mkPluginRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  await test('plugin.json version bump plus a second changed key: gates as code', async () => {
    const r = mkPluginRepo();
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1', { description: 'reworded' }));
    blocks(await judge(r, 'chore: bump'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'chore: bump'), r);
  });

  await test('a script under a docs PATH is code: record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho hi\n');
    commit(r);
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho tweaked\n');
    blocks(await judge(r, 'fix: the hook'), T.noReview, 'a code extension wins over the docs path');
    touchMarker(r);
    recordRequired(await judge(r, 'fix: the hook'), r);
  });

  await test('a .md under a docs path is still docs: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'docs/notes.md', '# notes\n');
    recordNotRequired(await judge(r, 'docs: notes'), r);
  });

  await test('a nested package.json version bump is a version stamp: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0'));
    stage(r, 'sub/package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  await test('a nested package.json lockstep bump moves version and exact pins together: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  await test('a version bumped alone past a pin equal to the old version: no record required', async () => {
    const r = mkReleaseRepo(pkg('1.0.0', { dependencies: { foo: '1.0.0' } }));
    stage(r, 'package.json', pkg('1.0.1', { dependencies: { foo: '1.0.0' } }));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  await test('a nested package.json lockstep bump moves a devDependencies pin too: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { devDependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { devDependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  await test('a range pin moved with the version gates as code: only exact pins are lockstep', async () => {
    const range = { ...DEPS, '@fixture/other': '^1.0.0' };
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: range }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...range, '@fixture/other': '^1.0.1' } }));
    await gatesAsCode(r);
  });

  await test('a pin moved to a value other than the version gates as code', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.2' } }));
    await gatesAsCode(r);
  });

  await test('a dependency added beside the bump gates as code', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1', '@fixture/third': '1.0.1' } }));
    await gatesAsCode(r);
  });

  await test('a nested plugin.json version-only bump is a version stamp: no record required', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  await test('a nested plugin.json bump with an added key gates as code', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1', { homepage: 'https://example.com' }));
    await gatesAsCode(r);
  });

  await test('a release commit whose lockfile moves only its version spots: no record required', async () => {
    const r = mkLockRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'package-lock.json', lockfile('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  await test('a lockfile whose dependency entry moves beside the version spots gates as code', async () => {
    const r = mkLockRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'package-lock.json', lockfile('1.0.1', '4.17.22'));
    blocks(await judge(r, 'chore(release): 1.0.1'), T.noReview, 'a moved dependency is code');
    touchMarker(r);
    recordRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  group('commit-gate: the suite record');

  await test('a record holding the index tree: exit 0 and the stand-down line', async () => {
    const r = codeCommit();
    proveTree(r);
    passes(await judge(r, 'feat: thing'), NOTICE.proved, 'a proved tree passes');
    assert(!suiteRan(r), 'the gate never runs the suite');
  });

  await test('no record: blocked, naming npm test at the repo root', async () => {
    const r = codeCommit();
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  await test('no record and npm\'s script-shell unset: blocked, naming workkit setup', async () => {
    const r = codeCommit();
    r.scriptShell = '';
    blocks(await judge(r, 'feat: thing'), T.unwired, 'the cause and its fix');
    assert(!suiteRan(r), 'the gate never runs the suite');
  });

  await test('no record, the wrapper wired: the bounce names the suite log', async () => {
    const r = codeCommit();
    const deny = denyOf(await judge(r, 'feat: thing'));
    recordBlocks({ deny });
    const logFile = deny.slice(deny.indexOf('writes its output to ') + 'writes its output to '.length, deny.length - T.recordTail.length);
    assert(logFile.includes('suite.log'), `the bounce names the suite log, got: ${logFile}`);
  });

  // The Windows compare: npm's value spelled with a drive, read through cygpath,
  // against the executable setup builds into the machine folder.
  const onWindows = (shellOf, { built = true } = {}) => {
    const home = mkTmp('cg-workkit-home-');
    const exe = path.join(home, 'script-shell.exe');
    if (built) fs.writeFileSync(exe, '');
    const r = codeCommit();
    r.isWindows = true;
    r.scriptShell = `C:${shellOf(exe)}`;
    r.scriptShellExe = exe;
    return r;
  };

  await test('Windows, npm\'s script-shell naming the built executable: the plain block', async () => {
    const r = onWindows((exe) => exe);
    const v = await judge(r, 'feat: thing');
    recordRequired(v, r);
    assert(!denyOf(v).includes('workkit setup'), `no setup hint, got: ${denyOf(v)}`);
  });

  await test('Windows, npm\'s script-shell naming the executable, deleted: blocked, naming workkit setup', async () => {
    blocks(await judge(onWindows((exe) => exe, { built: false }), 'feat: thing'), T.unwired, 'a deleted executable is not the wrapper');
  });

  await test('Windows, npm\'s script-shell naming another program: blocked, naming workkit setup', async () => {
    const r = onWindows((exe) => {
      const other = path.join(path.dirname(exe), 'other.exe');
      fs.writeFileSync(other, '');
      return other;
    });
    blocks(await judge(r, 'feat: thing'), T.unwired, 'another program is not the wrapper');
  });

  await test('a stale record, holding another tree: blocked', async () => {
    const r = codeCommit();
    proveTree(r, '0000000000000000000000000000000000000000');
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  await test('a record holding the disk tree while the index holds another: blocked, naming the gap', async () => {
    const r = codeCommit();
    write(r, 'app.js', 'const x = 3;\n');
    proveTree(r);
    diskProved(await judge(r, 'feat: thing'), r);
  });

  await test('a repo with no root test script: code commits need no record', async () => {
    const r = mkReleaseRepo(`${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`);
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    passes(await judge(r, 'feat: thing'), '', 'there is no suite to prove, and nothing said about one');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
