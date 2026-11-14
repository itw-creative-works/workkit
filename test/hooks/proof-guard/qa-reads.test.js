// Tests for safety:proof-guard's touched read at the flip to status:qa, through
// the real facts (proofFacts over the machine's io): a working-diff read git
// fails, or cannot start, leaves the touched test files unknown, so the flip is
// denied; a failed ref read changes nothing, and in a repo with no commit yet
// the staged list stands in for the diff against HEAD.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { mkRepo } = require('../../lib/script-shell');
const { runResult } = require('../../lib/mods-inputs');
const {
  flip, sessionOf, QA_BLOCK, DIFF_BLOCK, assertBlocks, passText,
} = require('./helpers');

const PKG = { name: 'fixture', scripts: { test: 'node test/a.test.js' } };
const TEST_FILE = path.join('test', 'a.test.js');
const ON_ROOT = QA_BLOCK(1, 'the repo root: test/a.test.js');

// A committed repo, no record planted, whose test file only `tracked` (committed, then edited:
// git diff HEAD alone reports it) or untracked (git ls-files --others alone reports it) is touched.
const world = (prefix, { tracked }) => {
  const dir = mkRepo(PKG, tracked ? { [TEST_FILE]: "require('../app.js');\n" } : {});
  if (!tracked) fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, TEST_FILE), "require('../app.js');\nrequire('../app.js');\n");
  return sessionOf(dir, prefix);
};

// A repo with no commit yet, its package.json untracked, `staged` written and added, `untracked` written.
const unborn = (prefix, { staged, untracked }) => {
  const dir = mkTmp(prefix);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(PKG));
  for (const [rel, body] of Object.entries({ ...staged, ...untracked })) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const added = spawnSync('git', ['add', '--', ...Object.keys(staged)], { cwd: dir, encoding: 'utf8' });
  expect(added.status === 0, `git add staged the files: ${added.stderr}`).toBeTruthy();
  return dir;
};

// One git read answered by <result>, the rest run for real; `asked` holds that read's args.
const standIn = (matches, result) => {
  const read = { asked: null };
  read.answer = (argv) => {
    if (argv[0] !== 'git' || !matches(argv.slice(1))) return undefined;
    read.asked = argv.slice(1).join(' ');
    return result;
  };
  return read;
};
const exited = (rc) => runResult({ exitCode: rc, stderr: "fatal: bad revision 'HEAD'\n" });
const DIFF = (args) => args[0] === 'diff' && args[1] === 'HEAD';
const OTHERS = (args) => args[0] === 'ls-files' && args.includes('--others');

describe('proof-guard: a git read the touched files hang on, failing', () => {
  test('git diff HEAD exiting 128 over a tracked, edited test file: the qa flip is denied, naming the read, its exit and the root', async () => {
    const { dir, env, root } = world('qa-reads-diff-', { tracked: true });
    const diff = standIn(DIFF, exited(128));
    const r = await flip(dir, env, diff.answer);
    expect(diff.asked, 'the working diff was read').toBeTruthy();
    assertBlocks(r, DIFF_BLOCK(root, diff.asked, 'exited 128'), 'an unread diff is never "no touched test files"');
  });

  test('git ls-files --others exiting 128 over an untracked test file: the qa flip is denied the same way', async () => {
    const { dir, env, root } = world('qa-reads-others-', { tracked: false });
    const others = standIn(OTHERS, exited(128));
    const r = await flip(dir, env, others.answer);
    expect(others.asked, 'the untracked list was read').toBeTruthy();
    assertBlocks(r, DIFF_BLOCK(root, others.asked, 'exited 128'), 'an unread untracked list is never "no touched test files"');
  });

  test('git diff HEAD that did not start: the qa flip is denied, naming the read as not started', async () => {
    const { dir, env, root } = world('qa-reads-nostart-', { tracked: true });
    const diff = standIn(DIFF, { ...runResult({ exitCode: null }), isStarted: false });
    const r = await flip(dir, env, diff.answer);
    expect(diff.asked, 'the working diff was read').toBeTruthy();
    assertBlocks(r, DIFF_BLOCK(root, diff.asked, 'did not start'), 'a read that never ran is never "no touched test files"');
  });

  test('git symbolic-ref failing alone: the flip is judged as with no upstream, the touched file blocking on its missing record', async () => {
    const { dir, env } = world('qa-reads-ref-', { tracked: false });
    const ref = standIn((args) => args[0] === 'symbolic-ref', exited(1));
    const r = await flip(dir, env, ref.answer);
    expect(ref.asked, 'the ref was read').toBeTruthy();
    assertBlocks(r, ON_ROOT, 'the ref read keeps tolerating failure');
  });
});

describe('proof-guard: a repo with no commit yet', () => {
  test('a staged and an untracked test file, no record: the qa flip is denied naming both, never a Fix git deny', async () => {
    const dir = unborn('qa-reads-unborn-', {
      staged: { [TEST_FILE]: "require('../app.js');\n" },
      untracked: { 'test/b.test.js': "require('../app.js');\n" },
    });
    const { env } = sessionOf(dir, 'qa-reads-unborn-home-');
    assertBlocks(await flip(dir, env), QA_BLOCK(2, 'the repo root: test/a.test.js test/b.test.js'), 'the staged file is never dropped');
  });

  test('no staged or untracked test file: the flip passes with the no-touched-test-files notice', async () => {
    const dir = unborn('qa-reads-unborn-none-', { staged: { 'app.js': 'const x = 1;\n' }, untracked: {} });
    const { env } = sessionOf(dir, 'qa-reads-unborn-none-home-');
    const msg = passText(await flip(dir, env), 'nothing test-shaped is touched');
    expect(msg.startsWith('proof-guard: no touched test files in the working diff, so the qa flip needs no test record.'),
      `the notice is about the touched test files, got: ${msg}`).toBeTruthy();
  });
});
