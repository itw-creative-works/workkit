// Tests for the suite record and the qa record that hooks/_lib.sh sources from
// workflow/lib/suite.sh: the tree hash, the two records' paths, their write and
// their read, and which command runs the root suite. The rest of _lib.sh is
// tests/hooks/lib.test.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skipSuite, selfRun, summary } = require('../lib/harness');
const { SYSTEM_PATH, shellPath, digestTool } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { plantRecord } = require('../lib/suite-record');
const { runLib } = require('../lib/hook-lib');

// Two tree ids a record can hold, neither a real tree.
const ID = '1111111111111111111111111111111111111111';
const OTHER_ID = '2222222222222222222222222222222222222222';

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

const run = async () => {
  if (!digestTool(SYSTEM_PATH)) {
    skipSuite('this machine has neither shasum nor sha1sum, so no record path can be keyed');
  }
  // TMPDIR is handed over explicitly: a record lives under whatever temp dir
  // the session has.
  const TMP = mkTmp('lib-record-');

  group('_lib.sh: the suite record');

  const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const treeHash = (dir) => runLib(`wk_tree_hash "${shellPath(dir)}"`, { TMPDIR: shellPath(TMP) }).stdout.trim();

  await test('the record and the test-script predicate keep their engine names, with no hook_ second name', () => {
    const names = ['suite_marker_path', 'tree_hash', 'suite_index_tree', 'suite_proved', 'has_test_script',
      'qa_marker_path', 'qa_marker_write', 'qa_proved'];
    const out = runLib(names.map((n) => `declare -F wk_${n} hook_${n}`).join('; ')).stdout;
    assertEq(out.trim(), names.map((n) => `wk_${n}`).join('\n'), `only the engine names, got: ${out}`);
  });

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
    const tracked = runLib(`wk_tree_hash "${shellPath(dir)}" -u`, { TMPDIR: shellPath(TMP) }).stdout.trim();
    assertEq(tracked, edited, 'under -u, the tree `git commit -a` carries: the untracked file is out');
    git(dir, 'add', '-A');
    assertEq(untracked, git(dir, 'write-tree'), 'the hash is what a real add -A then write-tree names');
  });

  await test("wk_tree_hash: a same-size edit in the index's own second is still seen", () => {
    const dir = mkTmp('lib-racy-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'seed');
    fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
    // Past the index's second, so a copy stamped now would trust the stale stat.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
    const index = path.join(mkTmp('lib-racy-index-'), 'index');
    const fresh = { ...process.env, GIT_INDEX_FILE: index };
    spawnSync('git', ['add', '-A'], { cwd: dir, env: fresh });
    const want = spawnSync('git', ['write-tree'], { cwd: dir, env: fresh, encoding: 'utf8' }).stdout.trim();
    assertEq(treeHash(dir), want, 'the edited content, not the stat cache');
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

  await test('wk_suite_proved: true only when the marker holds the tree it is handed', () => {
    const dir = mkTmp('lib-proved-');
    git(dir, 'init', '-q');
    // The root as a hook hands it over, and the record planted at its native
    // path: the lib answers a shell path, which Node on Windows cannot open.
    const root = git(dir, 'rev-parse', '--show-toplevel');
    const env = { TMPDIR: shellPath(TMP) };
    const proved = (tree) => runLib(`wk_suite_proved "${root}" "${tree}"`, env).code === 0;
    assert(!proved(ID), 'no marker proves nothing');
    const marker = plantRecord(TMP, dir, ID);
    assert(proved(ID), 'the recorded tree is proved');
    assert(!proved(OTHER_ID), 'another tree is not');
    assert(!proved(''), 'an empty tree (a failed hash) is never a match');
    fs.rmSync(marker);
  });

  await test('hook_suite_root_run: the root suite from the root or a nested dir, never a nested package npm run', () => {
    const dir = mkTmp('lib-rootrun-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node tests/run.js' } }));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const ask = (cmd, cwd) => runLib(`hook_suite_root_run "${cmd}" "${shellPath(dir)}" "${shellPath(cwd)}"`).stdout.trim();
    assertEq(ask('npm test', dir), 'full', "npm at the root runs the root's suite");
    assertEq(ask('node tests/run.js', dir), 'full', "the root's script run directly");
    assertEq(ask('npm test', path.join(dir, 'sub')), '', "npm inside a nested tested package runs that package's suite");
    assertEq(ask('cd .. && node tests/run.js', path.join(dir, 'sub')), 'full', "the root's script from a nested dir");
  });

  group('_lib.sh: the qa record');

  // A git root and its own TMPDIR, so no case reads another's record.
  const qaWorld = () => {
    const dir = mkTmp('lib-qa-');
    git(dir, 'init', '-q');
    const tmp = mkTmp('lib-qa-tmp-');
    const env = { TMPDIR: shellPath(tmp) };
    const root = git(dir, 'rev-parse', '--show-toplevel');
    const ask = (fn, tree) => runLib(`${fn} "${root}" "${tree}"`, env).code === 0;
    return { dir, tmp, ask };
  };

  await test('wk_qa_marker_path is the qa marker dir plus the sha of the root, never the suite record', () => {
    const out = runLib('wk_qa_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-qa-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
    const suite = runLib('wk_suite_marker_path /repos/thing', { TMPDIR: shellPath(TMP) }).stdout.trim();
    assert(out.stdout.trim() !== suite, `a different file from the suite record, got: ${suite}`);
  });

  await test('wk_qa_proved: true only when the record holds the tree it is handed', () => {
    const { tmp, ask } = qaWorld();
    assert(!ask('wk_qa_proved', ID), 'no record proves nothing');
    assert(!ask('wk_qa_marker_write', ''), 'an empty tree is refused');
    assert(!fs.existsSync(path.join(tmp, 'claude-qa-marker')), 'and leaves no record');
    assert(ask('wk_qa_marker_write', ID), 'the record is written');
    assert(ask('wk_qa_proved', ID), 'the recorded tree is proved');
    assert(!ask('wk_qa_proved', OTHER_ID), 'another tree is not');
    assert(!ask('wk_qa_proved', ''), 'an empty tree (a failed hash) is never a match');
  });

  await test('the suite record and the qa record never stand in for each other', () => {
    const suiteOnly = qaWorld();
    plantRecord(suiteOnly.tmp, suiteOnly.dir, ID);
    assert(suiteOnly.ask('wk_suite_proved', ID), 'the planted suite record proves its tree');
    assert(!suiteOnly.ask('wk_qa_proved', ID), 'a suite record is no qa record');
    const qaOnly = qaWorld();
    assert(qaOnly.ask('wk_qa_marker_write', ID), 'the qa record is written');
    assert(qaOnly.ask('wk_qa_proved', ID), 'the qa record proves its tree');
    assert(!qaOnly.ask('wk_suite_proved', ID), 'a qa record is no suite record');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
