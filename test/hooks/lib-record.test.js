// Tests for the suite record and the package record that hooks/_lib.sh sources
// from workflow/lib/suite.sh: the tree hash, a package's own id in a workspaces
// repo, the two records' paths, their write and their read. The rest of _lib.sh
// is test/hooks/lib.test.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skipSuite, selfRun, summary, mkTmp, until } = require('../lib/harness');
const { SYSTEM_PATH, shellPath, digestTool, stubNode } = require('../lib/platform');
const { plantRecord, pkgRecord, kitIndexTree } = require('../lib/suite-record');
const { mkRepo } = require('../lib/script-shell');
const { runLib } = require('../lib/hook-lib');
const { scratchWorkflowHome, agedFile } = require('../lib/workflow-home');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

// Two tree ids a record can hold, neither a real tree.
const ID = '1111111111111111111111111111111111111111';
const OTHER_ID = '2222222222222222222222222222222222222222';

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

const TREE_HASH = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree-hash.sh'));

// A committed workspaces repo: members a, b and c under packages/, c depending on a.
const WORKSPACES = {
  'packages/a/package.json': { name: 'a', version: '1.0.0' },
  'packages/a/index.js': 'module.exports = 1;\n',
  'packages/b/package.json': { name: 'b', version: '1.0.0' },
  'packages/b/index.js': 'module.exports = 2;\n',
  'packages/c/package.json': { name: 'c', version: '1.0.0', dependencies: { a: '1.0.0' } },
  'packages/c/index.js': 'module.exports = 3;\n',
};
const mkWorkspaces = (extra = {}) => mkRepo({ private: true, workspaces: ['packages/*'] }, { ...WORKSPACES, ...extra });

// A repo's settings at the retired shape, tracked; the heal leaves OPT_IN_SHAPES.current.
const STAMPED = { '.workkit/settings.json': OPT_IN_SHAPES.retired };

const cases = async () => {
  if (!digestTool(SYSTEM_PATH)) {
    skipSuite('this machine has neither shasum nor sha1sum, so no record path can be keyed');
  }
  // TMPDIR is handed over explicitly: the tree hash's throwaway index lives
  // under whatever temp dir the session has.
  const TMP = mkTmp('lib-record-');
  // So are HOME and WORKFLOW_HOME: a record lives under the workflow home's
  // markers folder, never the machine's.
  const HOME = scratchWorkflowHome('lib-record-home-');

  group('_lib.sh: the suite record');

  const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const treeHash = (dir) => runLib(`wk_tree_hash "${shellPath(dir)}"`, { TMPDIR: shellPath(TMP) }).stdout.trim();

  await test('wk_tree_hash: the working tree as write-tree names it, untracked in, ignored out, index untouched', () => {
    const dir = mkTmp('lib-tree-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'seed');
    fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
    const edited = treeHash(dir);
    assert(/^[0-9a-f]{40,64}$/.test(edited), `a tree id, got: ${edited}`);
    assertEq(git(dir, 'diff', '--cached', '--name-only'), '', 'the real index is never touched');
    assertEq(git(dir, 'status', '--porcelain'), 'M a.js', 'and the edit is still unstaged');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x\n');
    assertEq(treeHash(dir), edited, 'an ignored file never counts');
    fs.writeFileSync(path.join(dir, 'new.js'), 'x\n');
    const untracked = treeHash(dir);
    assert(untracked !== edited, 'an untracked file changes the hash');
    git(dir, 'add', '-A');
    assertEq(untracked, git(dir, 'write-tree'), 'the hash is what a real add -A then write-tree names');
  });

  await test("wk_tree_hash: a same-size edit in the index's own second is still seen", async () => {
    const dir = mkTmp('lib-racy-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'seed');
    const added = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
    // Past the index's second, so a copy stamped now would trust the stale stat.
    await until(() => Math.floor(Date.now() / 1000) > added);
    const index = path.join(mkTmp('lib-racy-index-'), 'index');
    const fresh = { ...process.env, GIT_INDEX_FILE: index };
    spawnSync('git', ['add', '-A'], { cwd: dir, env: fresh });
    const want = spawnSync('git', ['write-tree'], { cwd: dir, env: fresh, encoding: 'utf8' }).stdout.trim();
    assertEq(treeHash(dir), want, 'the edited content, not the stat cache');
  });

  group('_lib.sh: a package\'s own id in a workspaces repo');

  // The id of <pkg> (the whole tree with none), always a tree id.
  const idOf = (dir, pkg) => {
    const out = runLib(`wk_tree_hash "${shellPath(dir)}"${pkg ? ` "${pkg}"` : ''}`,
      { TMPDIR: shellPath(TMP), WORKKIT_NODE: shellPath(process.execPath) });
    const id = out.stdout.trim();
    assert(/^[0-9a-f]{40,64}$/.test(id), `a tree id for ${pkg || 'the whole tree'}, got: ${out.stdout}|${out.stderr}`);
    return id;
  };
  const ids = (dir) => ({ a: idOf(dir, 'packages/a'), b: idOf(dir, 'packages/b'), c: idOf(dir, 'packages/c'), all: idOf(dir) });

  await test('wk_tree_hash <root> <pkg>: an edit changes the ids of the packages that can see it, and leaves the rest', () => {
    const dir = mkWorkspaces();
    const start = ids(dir);
    fs.writeFileSync(path.join(dir, 'packages', 'b', 'index.js'), 'module.exports = 20;\n');
    const bEdited = ids(dir);
    assertEq(bEdited.a, start.a, "an edit in packages/b leaves a's id");
    assert(bEdited.b !== start.b, "and changes b's");
    assert(bEdited.all !== start.all, "and the whole tree's");
    fs.writeFileSync(path.join(dir, 'packages', 'a', 'index.js'), 'module.exports = 10;\n');
    const aEdited = ids(dir);
    assert(aEdited.a !== bEdited.a, "an edit in packages/a changes a's id");
    assert(aEdited.c !== bEdited.c, "and c's, which depends on a");
    assertEq(aEdited.b, bEdited.b, "and leaves b's");
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', private: true, description: 'edited', workspaces: ['packages/*'] }));
    const rootEdited = ids(dir);
    for (const pkg of ['a', 'b', 'c']) assert(rootEdited[pkg] !== aEdited[pkg], `an edit to the root package.json changes ${pkg}'s id`);
    assertEq(idOf(dir, '.'), rootEdited.all, '`.` is the whole tree');
  });

  await test('wk_tree_hash <root> <pkg> in a repo with no workspaces field: every package is the whole tree', () => {
    const dir = mkRepo({ private: true }, {
      'packages/foo/package.json': { name: 'foo', scripts: { test: 'exit 0' } },
      'packages/bar/index.js': 'module.exports = 1;\n',
    });
    assertEq(idOf(dir, 'packages/foo'), idOf(dir), "packages/foo's id is the whole tree's");
  });

  await test('wk_tree_hash <root> <pkg> with no node at the floor: the whole tree, and one line saying so', () => {
    const dir = mkWorkspaces();
    const old = stubNode(path.join(mkTmp('lib-old-node-'), 'bin'), '20.15.1');
    // HOME is the scratch one, so no node a machine's nvm keeps is found instead.
    const out = runLib(`wk_tree_hash "${shellPath(dir)}" packages/a`,
      { ...HOME.env, TMPDIR: shellPath(TMP), WORKKIT_NODE: shellPath(old) });
    assertEq(out.stdout.trim(), idOf(dir), "packages/a's id is the whole tree's");
    const said = out.stderr.split('\n').filter(Boolean);
    assertEq(said.length, 1, `one stderr line, got: ${out.stderr}`);
    assert(said[0].includes('no node') && said[0].includes('keyed to the whole tree'), `it names the missing node and the whole tree, got: ${said[0]}`);
  });

  await test("wk_suite_index_tree: the real index's write-tree id, never the edit on disk", () => {
    const dir = mkTmp('lib-index-tree-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
    git(dir, 'add', '-A');
    const staged = git(dir, 'write-tree');
    fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
    const out = runLib(`wk_suite_index_tree "${shellPath(dir)}"`, { TMPDIR: shellPath(TMP) }).stdout.trim();
    assertEq(out, staged, 'the staged content names the tree');
    assert(out !== treeHash(dir), 'and the unstaged edit is not in it');
  });

  group('_lib.sh: a proof id leaves .workkit/ out');

  const indexTree = (dir) => runLib(`wk_suite_index_tree "${shellPath(dir)}"`, { TMPDIR: shellPath(TMP) }).stdout.trim();

  await test('wk_tree_hash: the settings losing its version key and a suite log written leave the whole and the package id as recorded', () => {
    const dir = mkWorkspaces(STAMPED);
    const before = { all: idOf(dir), a: idOf(dir, 'packages/a') };
    fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    fs.writeFileSync(path.join(dir, '.workkit', 'suite.log'), 'script-shell: exit 0\n');
    assertEq(idOf(dir), before.all, 'the whole tree keeps the id its record holds');
    assertEq(idOf(dir, 'packages/a'), before.a, "and so does packages/a's own id");
  });

  await test('wk_suite_index_tree and tree-hash.sh -i: a staged settings edit leaves the index id as it was', () => {
    const dir = mkRepo({ private: true }, STAMPED);
    const before = indexTree(dir);
    assert(/^[0-9a-f]{40,64}$/.test(before), `a tree id, got: ${before}`);
    fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    git(dir, 'add', '-A');
    assertEq(git(dir, 'diff', '--cached', '--name-only'), '.workkit/settings.json', 'the edit is staged');
    assertEq(indexTree(dir), before, 'the index id the record holds stands');
    assertEq(kitIndexTree(dir, { TMPDIR: shellPath(TMP) }), before, "tree-hash.sh -i prints wk_suite_index_tree's id");
    assertEq(git(dir, 'diff', '--cached', '--name-only'), '.workkit/settings.json', 'and the real index still holds the staged edit');
  });

  await test('tree-hash.sh: -i with anything after it, or anywhere but second, exits 1 with no id', () => {
    const dir = mkRepo({ private: true }, STAMPED);
    for (const flags of ['-i extra', '. -i']) {
      const res = runLib(`"$BASH" "${TREE_HASH}" "${shellPath(dir)}" ${flags}`, { TMPDIR: shellPath(TMP) });
      assertEq(res.code, 1, `${flags}: exit 1`);
      assertEq(res.stdout, '', `${flags}: nothing on stdout`);
      assertEq(res.stderr, 'tree-hash: -i takes no other flag or package\n', `${flags}: the one stderr line`);
    }
  });

  await test('wk_tree_hash: an edit to .gitignore, CHANGELOG.md or the checks workflow changes the id, only .workkit/ is left out', () => {
    const dir = mkRepo({ private: true }, {
      ...STAMPED, '.gitignore': 'node_modules/\n', 'CHANGELOG.md': '# Changelog\n', '.github/workflows/checks.yml': 'name: checks\n',
    });
    let last = idOf(dir);
    for (const rel of ['.gitignore', 'CHANGELOG.md', '.github/workflows/checks.yml']) {
      fs.appendFileSync(path.join(dir, rel), '# edited\n');
      const now = idOf(dir);
      assert(now !== last, `an edit to ${rel} changes the id`);
      last = now;
    }
  });

  await test('wk_suite_proved: true only when the marker holds the tree it is handed', () => {
    const dir = mkTmp('lib-proved-');
    git(dir, 'init', '-q');
    // The root as a hook hands it over, and the record planted at its native
    // path: the lib answers a shell path, which Node on Windows cannot open.
    const root = git(dir, 'rev-parse', '--show-toplevel');
    const proved = (tree) => runLib(`wk_suite_proved "${root}" "${tree}"`, HOME.env).code === 0;
    assert(!proved(ID), 'no marker proves nothing');
    const marker = plantRecord(HOME.workflowHome, dir, ID);
    assert(proved(ID), 'the recorded tree is proved');
    assert(!proved(OTHER_ID), 'another tree is not');
    assert(!proved(''), 'an empty tree (a failed hash) is never a match');
    fs.rmSync(marker);
  });

  group('_lib.sh: the package record');

  // A git root and its own workflow home, so no case reads another's record.
  const pkgWorld = () => {
    const dir = mkTmp('lib-pkg-');
    git(dir, 'init', '-q');
    const { workflowHome: wh, env } = scratchWorkflowHome('lib-pkg-home-');
    const root = git(dir, 'rev-parse', '--show-toplevel');
    const ask = (fn, ...args) => runLib(`${fn} "${root}" ${args.map((a) => `"${a}"`).join(' ')}`, env).code === 0;
    return { dir, wh, root, env, ask, lines: () => JSON.stringify(pkgRecord(wh, dir)) };
  };

  await test('wk_pkg_marker_path is the package marker dir plus the sha of the root, never the suite record', () => {
    const out = runLib('wk_pkg_marker_path /repos/thing', HOME.env);
    assertEq(out.stdout.trim(),
      shellPath(path.join(HOME.workflowHome, 'markers', 'claude-package-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
    const suite = runLib('wk_suite_marker_path /repos/thing', HOME.env).stdout.trim();
    assert(out.stdout.trim() !== suite, `a different file from the suite record, got: ${suite}`);
  });

  await test('wk_pkg_marker_write: a fresh record is one line, the tree id and the package folder', () => {
    const { ask, lines } = pkgWorld();
    assert(ask('wk_pkg_marker_write', ID, '.'), 'the record is written');
    assertEq(lines(), JSON.stringify([`${ID} .`]), 'the tree, then the root package, on one line');
  });

  await test('wk_pkg_marker_write: each package keeps its own line on its own tree, a rewrite keeping the others and appending its own', () => {
    const { ask, lines } = pkgWorld();
    const [TA, TB, TA2] = ['a', 'b', 'c'].map((ch) => ch.repeat(40));
    assert(ask('wk_pkg_marker_write', TA, 'packages/a'), 'a on Ta is written');
    assert(ask('wk_pkg_marker_write', TB, 'packages/b'), 'b on Tb is written');
    assertEq(lines(), JSON.stringify([`${TA} packages/a`, `${TB} packages/b`]), 'two lines, each package on its own tree');
    assert(ask('wk_pkg_marker_write', TA2, 'packages/a'), 'a on Ta2 is written');
    assertEq(lines(), JSON.stringify([`${TB} packages/b`, `${TA2} packages/a`]), "b's line kept, then a's new line");
    assert(ask('wk_pkg_proved', TA2, 'packages/a'), 'a is proved on Ta2');
    assert(ask('wk_pkg_proved', TB, 'packages/b'), 'b is still proved on Tb');
    assert(!ask('wk_pkg_proved', TA, 'packages/a'), "a's old tree proves it no longer");
  });

  await test('wk_pkg_marker_write: twelve writes at once, one per package, leave all twelve lines', () => {
    const { root, env, ask, lines } = pkgWorld();
    const pkgs = Array.from({ length: 12 }, (_, i) => `packages/p${i + 1}`);
    const body = `${pkgs.map((pkg) => `wk_pkg_marker_write "${root}" "${ID}" "${pkg}" &`).join('\n')}\nwait`;
    const out = runLib(body, env);
    assertEq(out.code, 0, `every write and the wait end, stderr: ${out.stderr}`);
    assertEq(JSON.stringify(JSON.parse(lines() || '[]').sort()), JSON.stringify(pkgs.map((pkg) => `${ID} ${pkg}`).sort()),
      'one line per package, none lost');
    for (const pkg of pkgs) assert(ask('wk_pkg_proved', ID, pkg), `${pkg} is proved`);
  });

  await test('wk_pkg_marker_write sweeps the markers folder: a file 8 days old goes, the new record stands', () => {
    const { wh, ask, lines } = pkgWorld();
    const old = agedFile(path.join(wh, 'markers', 'claude-review-marker', 'old'), 8);
    assert(ask('wk_pkg_marker_write', ID, '.'), 'the record is written');
    assert(!fs.existsSync(old), 'the 8-day-old file is swept');
    assertEq(lines(), JSON.stringify([`${ID} .`]), 'and the new record stands');
  });

  await test('wk_pkg_marker_write: an empty tree is refused and leaves no record', () => {
    const { wh, ask } = pkgWorld();
    assert(!ask('wk_pkg_marker_write', '', '.'), 'an empty tree (a failed hash) is refused');
    assert(!fs.existsSync(path.join(wh, 'markers', 'claude-package-marker')), 'and leaves no record');
  });

  await test('wk_pkg_proved: the first package line and a later one, on the recorded tree only', () => {
    const { ask } = pkgWorld();
    assert(!ask('wk_pkg_proved', ID, '.'), 'no record proves nothing');
    assert(ask('wk_pkg_marker_write', ID, '.'), 'the root is written');
    assert(ask('wk_pkg_marker_write', ID, 'packages/foo'), 'the nested package is written');
    assert(ask('wk_pkg_proved', ID, '.'), 'the first package line is proved');
    assert(ask('wk_pkg_proved', ID, 'packages/foo'), 'a later package line is proved');
    assert(!ask('wk_pkg_proved', ID, 'packages/bar'), 'a package never recorded is not');
    assert(!ask('wk_pkg_proved', ID, 'packages/fo'), 'a prefix of a recorded folder is not');
    assert(!ask('wk_pkg_proved', OTHER_ID, '.'), 'another tree is not');
    assert(!ask('wk_pkg_proved', '', '.'), 'an empty tree (a failed hash) is never a match');
  });

  await test('the suite record and the package record never stand in for each other', () => {
    const suiteOnly = pkgWorld();
    plantRecord(suiteOnly.wh, suiteOnly.dir, ID);
    assert(suiteOnly.ask('wk_suite_proved', ID), 'the planted suite record proves its tree');
    assert(!suiteOnly.ask('wk_pkg_proved', ID, '.'), 'a suite record is no package record');
    const pkgOnly = pkgWorld();
    assert(pkgOnly.ask('wk_pkg_marker_write', ID, '.'), 'the package record is written');
    assert(!pkgOnly.ask('wk_suite_proved', ID), 'a package record is no suite record');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
