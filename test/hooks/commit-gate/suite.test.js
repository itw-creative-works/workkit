// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in hooks/mods/commit-gate.js, check 5:
// a commit carrying code needs the record a green root `npm test` wrote for the tree it carries
// (`treeId`, the commit's index tree as tree-hash.js -i takes it); the gate runs no suite. The script-shell compare
// reads physical paths through `real`. The prologue is ./helpers.js; the tree id case reads the real facts (test/lib/real-gate.js's io).

const path = require('path');
const fs = require('fs');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const {
  NODE_DIR, joinPath, basePathWithout, runsProgram,
} = require('../../lib/platform');
const { mods } = require('../../lib/mods-inputs');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { ioIn } = require('../../lib/real-gate');
const { treeHash } = require('../../lib/suite-record');
const {
  T, NOTICE, ROOT, stage, write, commit, touchMarker, proveTree, judge, denyOf, blocks, passes, recordBlocks,
  suiteRan, pkg, mkReleaseRepo,
} = require('./helpers');

// A no-code commit passes with the stand-down line and no suite.
const recordNotRequired = (v, r) => {
  passes(v, NOTICE.noCode, 'the no-code stand-down');
  expect(!suiteRan(r), 'the gate never runs the suite').toBeTruthy();
};

// The record block, and proof the gate ran nothing on the way.
const recordRequired = (v, r) => {
  recordBlocks(v);
  expect(!suiteRan(r), 'the gate never runs the suite').toBeTruthy();
};

// The block when the record proves the disk tree and the commit carries another.
const diskProved = (v, r) => {
  blocks(v, T.disk, 'the disk tree is not the commit\'s');
  expect(!suiteRan(r), 'the gate never runs the suite').toBeTruthy();
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

describe('commit-gate: the record is required only for commits carrying code', () => {
  test('docs-only commit: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'README.md', '# docs\n');
    recordNotRequired(await judge(r, 'docs: readme'), r);
  });

  test('version-only root package.json bump: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  test('version bump plus a second changed key: gates as code', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1', { description: 'now with a second change' }));
    blocks(await judge(r, 'chore: bump'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'chore: bump'), r);
  });

  test('a code file alongside the version bump: record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  test('version-only plugin.json bump: no record required', async () => {
    const r = mkPluginRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  test('plugin.json version bump plus a second changed key: gates as code', async () => {
    const r = mkPluginRepo();
    stage(r, '.claude-plugin/plugin.json', manifest('1.0.1', { description: 'reworded' }));
    blocks(await judge(r, 'chore: bump'), T.noReview, 'any second change restores code classification');
    touchMarker(r);
    recordRequired(await judge(r, 'chore: bump'), r);
  });

  test('a script under a docs PATH is code: record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho hi\n');
    commit(r);
    stage(r, 'hooks/docs/x/run.sh', '#!/bin/bash\necho tweaked\n');
    blocks(await judge(r, 'fix: the hook'), T.noReview, 'a code extension wins over the docs path');
    touchMarker(r);
    recordRequired(await judge(r, 'fix: the hook'), r);
  });

  test('a .md under a docs path is still docs: no record required', async () => {
    const r = mkReleaseRepo();
    stage(r, 'docs/notes.md', '# notes\n');
    recordNotRequired(await judge(r, 'docs: notes'), r);
  });

  test('a nested package.json version bump is a version stamp: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0'));
    stage(r, 'sub/package.json', pkg('1.0.1'));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  test('a nested package.json lockstep bump moves version and exact pins together: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  test('a version bumped alone past a pin equal to the old version: no record required', async () => {
    const r = mkReleaseRepo(pkg('1.0.0', { dependencies: { foo: '1.0.0' } }));
    stage(r, 'package.json', pkg('1.0.1', { dependencies: { foo: '1.0.0' } }));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  test('a nested package.json lockstep bump moves a devDependencies pin too: no record required', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { devDependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { devDependencies: { ...DEPS, '@fixture/other': '1.0.1' } }));
    recordNotRequired(await judge(r, 'chore: bump sub'), r);
  });

  test('a range pin moved with the version gates as code: only exact pins are lockstep', async () => {
    const range = { ...DEPS, '@fixture/other': '^1.0.0' };
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: range }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...range, '@fixture/other': '^1.0.1' } }));
    await gatesAsCode(r);
  });

  test('a pin moved to a value other than the version gates as code', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.2' } }));
    await gatesAsCode(r);
  });

  test('a dependency added beside the bump gates as code', async () => {
    const r = mkWorkspaceRepo(pkg('1.0.0', { dependencies: DEPS }));
    stage(r, 'sub/package.json', pkg('1.0.1', { dependencies: { ...DEPS, '@fixture/other': '1.0.1', '@fixture/third': '1.0.1' } }));
    await gatesAsCode(r);
  });

  test('a nested plugin.json version-only bump is a version stamp: no record required', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  test('a nested plugin.json bump with an added key gates as code', async () => {
    const r = mkNestedPluginRepo();
    stage(r, NESTED_MANIFEST, manifest('1.0.1', { homepage: 'https://example.com' }));
    await gatesAsCode(r);
  });

  test('a release commit whose lockfile moves only its version spots: no record required', async () => {
    const r = mkLockRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'package-lock.json', lockfile('1.0.1'));
    recordNotRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });

  test('a lockfile whose dependency entry moves beside the version spots gates as code', async () => {
    const r = mkLockRepo();
    stage(r, 'package.json', pkg('1.0.1'));
    stage(r, 'package-lock.json', lockfile('1.0.1', '4.17.22'));
    blocks(await judge(r, 'chore(release): 1.0.1'), T.noReview, 'a moved dependency is code');
    touchMarker(r);
    recordRequired(await judge(r, 'chore(release): 1.0.1'), r);
  });
});

describe('commit-gate: the suite record', () => {
  test('a record holding the index tree: exit 0 and the stand-down line', async () => {
    const r = codeCommit();
    proveTree(r);
    passes(await judge(r, 'feat: thing'), NOTICE.proved, 'a proved tree passes');
    expect(!suiteRan(r), 'the gate never runs the suite').toBeTruthy();
  });

  test('no record: blocked, naming npm test at the repo root', async () => {
    const r = codeCommit();
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  test('no record and npm\'s script-shell unset: blocked, naming workkit setup', async () => {
    const r = codeCommit();
    r.scriptShell = '';
    blocks(await judge(r, 'feat: thing'), T.unwired, 'the cause and its fix');
    expect(!suiteRan(r), 'the gate never runs the suite').toBeTruthy();
  });

  test('no record, the wrapper wired: the bounce names the suite log', async () => {
    const r = codeCommit();
    const deny = denyOf(await judge(r, 'feat: thing'));
    recordBlocks({ deny });
    const logFile = deny.slice(deny.indexOf('writes its output to ') + 'writes its output to '.length, deny.length - T.recordTail.length);
    expect(/^\/w\/user\/markers\/claude-suite\.log\/[0-9a-f]{40}$/.test(logFile), `the bounce names the suite log under the machine's folder, got: ${logFile}`).toBeTruthy();
  });

  test('logs.dir logs, git ignoring logs/: the bounce for a missing record names logs/suite.log', async () => {
    const r = mkReleaseRepo();
    stage(r, '.workkit/settings.json', `${JSON.stringify({ enabled: true, logs: { dir: 'logs' } }, null, 2)}\n`);
    commit(r);
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    // git's own answer for a repo whose .gitignore holds `logs/`: ignored there, nowhere else.
    r.failOn = (argv) => (path.basename(argv[0]) === 'git' && argv.includes('check-ignore')
      ? { exitCode: /^logs(\/|$)/.test(argv[argv.length - 1].replace(`${ROOT}/`, '')) ? 0 : 1 }
      : null);
    const deny = denyOf(await judge(r, 'feat: thing'));
    recordBlocks({ deny });
    const logFile = deny.slice(deny.indexOf('writes its output to ') + 'writes its output to '.length, deny.length - T.recordTail.length);
    expect(logFile, 'the bounce names the log in the repo\'s log folder').toBe(`${ROOT}/logs/suite.log`);
  });

  test('logs.dir ../x: the bounce for a missing record names the bad setting', async () => {
    const r = mkReleaseRepo();
    stage(r, '.workkit/settings.json', `${JSON.stringify({ enabled: true, logs: { dir: '../x' } }, null, 2)}\n`);
    commit(r);
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    const deny = denyOf(await judge(r, 'feat: thing'));
    expect(deny !== null && deny.split('\n').some((l) => l.includes('workkit: logs.dir must be a folder inside the repo')),
      `the deny holds the logs.dir line, got: ${deny}`).toBeTruthy();
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

  test('Windows, npm\'s script-shell naming the built executable: the plain block', async () => {
    const r = onWindows((exe) => exe);
    const v = await judge(r, 'feat: thing');
    recordRequired(v, r);
    expect(!denyOf(v).includes('workkit setup'), `no setup hint, got: ${denyOf(v)}`).toBeTruthy();
  });

  test('Windows, npm\'s script-shell naming the executable, deleted: blocked, naming workkit setup', async () => {
    blocks(await judge(onWindows((exe) => exe, { built: false }), 'feat: thing'), T.unwired, 'a deleted executable is not the wrapper');
  });

  test('Windows, npm\'s script-shell naming another program: blocked, naming workkit setup', async () => {
    const r = onWindows((exe) => {
      const other = path.join(path.dirname(exe), 'other.exe');
      fs.writeFileSync(other, '');
      return other;
    });
    blocks(await judge(r, 'feat: thing'), T.unwired, 'another program is not the wrapper');
  });

  test('a stale record, holding another tree: blocked', async () => {
    const r = codeCommit();
    proveTree(r, '0000000000000000000000000000000000000000');
    recordRequired(await judge(r, 'feat: thing'), r);
  });

  test('a record holding the disk tree while the index holds another: blocked, naming the gap', async () => {
    const r = codeCommit();
    write(r, 'app.js', 'const x = 3;\n');
    proveTree(r);
    diskProved(await judge(r, 'feat: thing'), r);
  });

  test('a repo with no root test script: code commits need no record', async () => {
    const r = mkReleaseRepo(`${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`);
    stage(r, 'app.js', 'const x = 2;\n');
    touchMarker(r);
    passes(await judge(r, 'feat: thing'), '', 'there is no suite to prove, and nothing said about one');
  });
});

describe('commit-gate: the tree ids, through the real gate', () => {
  test('the gate takes the index\'s and the disk\'s tree ids with node running tree-hash.js, and starts no bash', async () => {
    const w = mkGitRepo('cg-tree-ids-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
    w.write('app.js', 'const x = 2;\n');
    w.git('add', 'app.js');
    const staged = treeHash(w.repo);
    w.write('extra.js', 'const y = 1;\n');
    const env = { ...w.env, PATH: joinPath(NODE_DIR, w.env.PATH) };
    const io = ioIn(env);
    const calls = [];
    const run = (argv, init) => { calls.push([...argv]); return io.run(argv, init); };
    const root = await io.top(w.repo);
    const facts = mods('commit-gate').commitFacts(mods('facts').bashFacts({ ...io, run }, env, { cwd: root }), root);
    expect(await facts.treeId, 'the commit\'s tree: the index, the untracked file out').toBe(staged);
    expect(await facts.diskTreeId, 'the folder\'s tree: the untracked file in').toBe(treeHash(w.repo));
    const hashes = calls.filter((argv) => argv.some((a) => a.endsWith('tree-hash.js')));
    expect(hashes.some((argv) => argv.includes('-i')) && hashes.some((argv) => !argv.includes('-i')),
      `a tree-hash.js child for the index and one for the disk, got: ${JSON.stringify(calls)}`).toBeTruthy();
    expect(hashes.every((argv) => runsProgram(argv, 'node')), `each tree-hash.js child is node, got: ${JSON.stringify(hashes)}`).toBeTruthy();
    expect(JSON.stringify(calls.filter((argv) => runsProgram(argv, 'bash'))), 'no child is bash').toBe('[]');
  });

  test('a gate under real node with no node on its PATH still takes the tree id, through tree-hash.js', async () => {
    const w = mkGitRepo('cg-no-node-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
    w.write('app.js', 'const x = 2;\n');
    w.git('add', 'app.js');
    // The machine as a program with no node on its PATH sees it: git and the system tools, a scratch HOME.
    const env = { ...w.env, PATH: basePathWithout(mkTmp('cg-no-node-path-'), 'node') };
    const io = ioIn(env);
    const calls = [];
    const run = (argv, init) => { calls.push([...argv]); return io.run(argv, init); };
    const root = await io.top(w.repo);
    const facts = mods('commit-gate').commitFacts(mods('facts').bashFacts({ ...io, run }, env, { cwd: root }), root);
    expect(await facts.treeId, `the commit's tree id, got children: ${JSON.stringify(calls)}`).toBe(treeHash(w.repo));
    expect(calls.some((argv) => argv.some((a) => a.endsWith('tree-hash.js'))), `taken by tree-hash.js, got: ${JSON.stringify(calls)}`).toBeTruthy();
  });
});
