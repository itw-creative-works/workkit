// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js, check 5: a commit carrying code needs the record a
// green root `npm test` wrote for the tree it carries (the index's write-tree,
// or `indexTreeId()` under -a; `treeId` is the working tree); the gate runs no
// suite. Each case ports the HEAD case its name quotes; the script-shell compare
// reads physical paths through `real`. The prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const { mkTmp } = require('../../lib/scratch');
const {
  T, NOTICE, stage, write, commit, touchMarker, proveTree, factsOf, judge, denyOf, blocks, passes, recordBlocks,
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
  blocks(await judge(r, 'git commit -m "chore: bump sub"'), T.noReview, 'the nested file is code: the review marker is demanded');
  touchMarker(r);
  recordRequired(await judge(r, 'git commit -m "chore: bump sub"'), r);
};

const NESTED_MANIFEST = 'agent-plugins/claude/.claude-plugin/plugin.json';
const mkNestedPluginRepo = () => {
  const r = mkReleaseRepo();
  stage(r, NESTED_MANIFEST, manifest('1.0.0'));
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

const run = async () => {
  group('commit-gate: the record is required only for commits carrying code');

  await test('ports "docs-only commit: no record required"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'README.md', '# docs\n');
    recordNotRequired(await judge(r, 'git commit -m "docs: readme"'), r);
  });

  await test('ports "version-only root package.json bump: no record required"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'git commit -m "chore(release): 1.0.1"'), r);
  });

  await test('ports "version bump plus a second changed key: gates as code"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1', { description: 'now with a second change' }));
    blocks(await judge(r, 'git commit -m "chore: bump"'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'git commit -m "chore: bump"'), r);
  });

  await test('ports "a code file alongside the version bump: record required"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    recordRequired(await judge(r, 'git commit -m "feat: thing"'), r);
  });

  await test('ports "version-only plugin.json bump: no record required"', async () => {
    const r = mkPluginRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1'));
    recordNotRequired(await judge(r, 'git commit -m "chore(release): 1.0.1"'), r);
  });

  await test('ports "plugin.json version bump plus a second changed key: gates as code"', async () => {
    const r = mkPluginRepo();
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1', { description: 'reworded' }));
    blocks(await judge(r, 'git commit -m "chore: bump"'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'git commit -m "chore: bump"'), r);
  });

  await test('ports "a script under a docs PATH is code: record required"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho hi\n');
    commit(r);
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho tweaked\n');
    blocks(await judge(r, 'git commit -m "fix: the hook"'), T.noReview, 'a code extension wins over the docs path');
    touchMarker(r);
    recordRequired(await judge(r, 'git commit -m "fix: the hook"'), r);
  });

  await test('ports "a .md under a docs path is still docs: no record required"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'docs/notes.md', '# notes\n');
    recordNotRequired(await judge(r, 'git commit -m "docs: notes"'), r);
  });

  await test('ports "-am: the working tree decides the version bump, not the index"', async () => {
    const clean = mkReleaseRepo();
    stage(clean, 'package.json', pkg('1.0.1'));
    recordNotRequired(await judge(clean, 'git commit -am "chore(release): 1.0.1"'), clean);

    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    write(r, 'package.json', pkg('1.0.1', { description: 'edited past the bump' }));
    touchMarker(r);
    recordRequired(await judge(r, 'git commit -am "chore(release): 1.0.1"'), r);
  });

  await test('ports "a nested package.json version bump is a version stamp: no record required"', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0'));
    stage(r, 'sub/package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'git commit -m "chore: bump sub"'), r);
  });

  await test('ports "a nested package.json lockstep bump moves version and exact pins together: no record required"', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'git commit -m "chore: bump sub"'), r);
  });

  await test('ports "a version bumped alone past a pin equal to the old version: no record required"', async () => {
    const r = mkReleaseRepo(pkg('1.0.0', { dependencies: { foo: '1.0.0' } }));
    stage(r, 'package.json', pkg('1.0.1', { dependencies: { foo: '1.0.0' } }));
    recordNotRequired(await judge(r, 'git commit -m "chore(release): 1.0.1"'), r);
  });

  await test('ports "a nested package.json lockstep bump moves a devDependencies pin too: no record required"', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { devDependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { devDependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'git commit -m "chore: bump sub"'), r);
  });

  await test('ports "a range pin moved with the version gates as code: only exact pins are lockstep"', async () => {
    const range = { ...DEPS, '@fixture/other': '^1.0.0' };
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: range }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...range, '@fixture/other': '^1.0.1' } }));
    await gatesAsCode(r);
  });

  await test('ports "a pin moved to a value other than the version gates as code"', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.2' } }));
    await gatesAsCode(r);
  });

  await test('ports "a dependency added beside the bump gates as code"', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1', '@fixture/third': '1.0.1' } }));
    await gatesAsCode(r);
  });

  await test('ports "a nested plugin.json version-only bump is a version stamp: no record required"', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1'));
    recordNotRequired(await judge(r, 'git commit -m "chore(release): 1.0.1"'), r);
  });

  await test('ports "a nested plugin.json bump with an added key gates as code"', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1', { homepage: 'https://example.com' }));
    await gatesAsCode(r);
  });

  group('commit-gate: the suite record');

  await test('ports "a record holding the index tree: exit 0 and the stand-down line"', async () => {
    const r = codeCommit();
    proveTree(r);
    passes(await judge(r, 'git commit -m "feat: thing"'), NOTICE.proved, 'a proved tree passes');
    assert(!suiteRan(r), 'the gate never runs the suite');
  });

  await test('ports "no record: blocked, naming npm test at the repo root"', async () => {
    const r = codeCommit();
    recordRequired(await judge(r, 'git commit -m "feat: thing"'), r);
  });

  await test('ports "no record and npm\'s script-shell unset: blocked, naming workkit setup"', async () => {
    const r = codeCommit();
    r.scriptShell = '';
    blocks(await judge(r, 'git commit -m "feat: thing"'), T.unwired, 'the cause and its fix');
    assert(!suiteRan(r), 'the gate never runs the suite');
  });

  await test('ports "no record, the wrapper wired: the bounce names the suite log"', async () => {
    const r = codeCommit();
    const deny = denyOf(await judge(r, 'git commit -m "feat: thing"'));
    recordBlocks({ deny });
    const log = deny.slice(deny.indexOf('writes its output to ') + 'writes its output to '.length, deny.length - T.recordTail.length);
    assert(log.includes('suite.log'), `the bounce names the suite log, got: ${log}`);
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

  await test('ports "Windows, npm\'s script-shell naming the built executable: the plain block"', async () => {
    const r = onWindows((exe) => exe);
    const v = await judge(r, 'git commit -m "feat: thing"');
    recordRequired(v, r);
    assert(!denyOf(v).includes('workkit setup'), `no setup hint, got: ${denyOf(v)}`);
  });

  await test('ports "Windows, npm\'s script-shell naming the executable, deleted: blocked, naming workkit setup"', async () => {
    blocks(await judge(onWindows((exe) => exe, { built: false }), 'git commit -m "feat: thing"'), T.unwired, 'a deleted executable is not the wrapper');
  });

  await test('ports "Windows, npm\'s script-shell naming another program: blocked, naming workkit setup"', async () => {
    const r = onWindows((exe) => {
      const other = path.join(path.dirname(exe), 'other.exe');
      fs.writeFileSync(other, '');
      return other;
    });
    blocks(await judge(r, 'git commit -m "feat: thing"'), T.unwired, 'another program is not the wrapper');
  });

  await test('ports "a stale record, holding another tree: blocked"', async () => {
    const r = codeCommit();
    proveTree(r, '0000000000000000000000000000000000000000');
    recordRequired(await judge(r, 'git commit -m "feat: thing"'), r);
  });

  await test('ports "a record holding the disk tree while the index holds another: blocked, naming the gap"', async () => {
    const r = codeCommit();
    write(r, 'app.js', 'const x = 3;\n');
    proveTree(r);
    diskProved(await judge(r, 'git commit -m "feat: thing"'), r);
  });

  await test('ports "a pathspec code commit: blocked even when the record matches the index"', async () => {
    const r = codeCommit();
    proveTree(r);
    blocks(await judge(r, 'git commit -m "feat: thing" -- app.js'), T.pathspec, 'a pathspec tree is never compared');
    assert(!suiteRan(r), 'the gate never runs the suite');
  });

  await test('-a with tracked edits and an untracked file: the record of the tree -a carries passes, the disk tree\'s names the gap', async () => {
    const r = mkReleaseRepo();
    write(r, 'app.js', 'const x = 2;\n');
    write(r, 'notes.txt', 'scratch\n');
    touchMarker(r);
    proveTree(r);
    blocks(await judge(r, 'git commit -am "feat: thing"'), T.disk, 'the untracked file is not in what -a carries');
    proveTree(r, await factsOf(r, 'git commit -am "feat: thing"').indexTreeId());
    passes(await judge(r, 'git commit -am "feat: thing"'), NOTICE.proved, 'the tree -a carries is proved');
  });

  await test('ports "a repo with no root test script: code commits need no record"', async () => {
    const r = mkReleaseRepo(`${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`);
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    passes(await judge(r, 'git commit -m "feat: thing"'), '', 'there is no suite to prove, and nothing said about one');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
