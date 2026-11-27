#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/prove.js: `workkit prove`, the root `npm test` on exactly the staged
// tree, in a detached worktree under ~/.cache/workkit/proof (lib/proof-dir.js)
// with its gitignored files filled from the live folder; the index's tree is
// recorded on green. The working folder and the index are never changed.

const fs = require('fs');
const path = require('path');
const { spawn, onPath } = require('./lib/run');
const { repoRoot, headSha, gitIn } = require('./lib/git');
const { run } = require('./lib/runs');
const { bodyEnd } = require('./lib/body');
const { exitOf, startFailed } = require('./lib/detach');
const { runPaths, LogsDirError } = require('./lib/run-paths');
const { proofBase, proofDir, proofClaudeHome } = require('./lib/proof-dir');
const {
  copyIndex, writeTree, treeId, indexTreeId,
} = require('./lib/tree-hash');
const {
  checkOut, fillIgnored, worktreeAdd, worktreeRemove,
} = require('./lib/tree-copy');
const { writeSuiteRecord } = require('./lib/records');
const { suiteHold } = require('./lib/hold');
const { sayAs } = require('./lib/say');
const { readJsonOrNull } = require('./lib/read');
const { hasTestScript } = require('../hooks/mods/suite.js');

const BODY = '--body';

const say = sayAs('prove');

/** The call's end with its code, its line said already. */
class Done extends Error {
  constructor(code) {
    super(`prove: exit ${code}`);
    this.name = 'Done';
    this.code = code;
  }
}

/** One `prove:` line on stderr, then the end with 1. */
const fail = (line) => {
  say(line);
  throw new Done(1);
};

/** git in `root` with its stdin closed, its stderr this process's own unless `quiet`; its status and stdout as text. */
const git = (root, args, { env = process.env, quiet = false } = {}) => gitIn(root, args, {
  env, encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
});

/** `npm test` in `dir` with npm's script shell `sh` under `env`, its output on this process's own; its code. */
const npmTest = (dir, sh, env) => new Promise((resolve) => {
  const child = spawn('npm', ['test', `--script-shell=${sh}`], {
    cwd: dir, env, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', () => resolve(startFailed));
  child.on('close', (code, signal) => resolve(exitOf(code, signal)));
});

/**
 * The detached run: copy, fill, run, record. Its last line is always
 * `prove: exit <code>` (bodyEnd); only a green run whose copy still holds the
 * index's tree writes the record. The worktree and the run folder go on every exit.
 * @param {string} root
 * @returns {Promise<number>} the exit code
 */
const body = async (root) => {
  const state = { tmp: null, copy: null };
  const stop = bodyEnd('prove', () => {
    if (state.copy !== null && !worktreeRemove(root, state.copy)) {
      fs.writeSync(1, `prove: git still lists the removed worktree ${state.copy} (run git -C ${root} worktree prune)\n`);
    }
    if (state.tmp !== null) fs.rmSync(state.tmp, { recursive: true, force: true });
  });
  // A signal ends the body at its next step; bodyEnd gives the signal's code.
  const halted = () => {
    if (stop.aborted) throw new Done(1);
  };
  state.tmp = proofDir();
  if (state.tmp === null) fail(`could not make a run folder under ${proofBase()}`);
  // One scratch copy of the index, the real one never written: the copy's whole
  // tree first, then the record's id, the same copy less .workkit/.
  const index = copyIndex(root, state.tmp);
  if (index === null) fail(`could not copy the index of ${root} into ${state.tmp}`);
  const staged = git(root, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: index }, quiet: true });
  if (staged.status !== 0 || !staged.stdout.trim()) {
    fail("could not write the whole index's tree for the copy (an unmerged path blocks it); resolve it and stage again");
  }
  const tree = writeTree(root, index);
  if (!tree) fail("could not write the index's tree (an unmerged path blocks it); resolve it and stage again");
  if (headSha(root) === null) fail(`${root} has no commit to add a worktree of`);
  halted();
  const copy = `${state.tmp}/copy`;
  try {
    worktreeAdd(root, copy);
  } catch (err) {
    fail(`could not add a worktree at ${copy}: ${err.message}`);
  }
  state.copy = copy;
  if (!checkOut(copy, staged.stdout.trim())) fail(`could not check the index's tree ${staged.stdout.trim()} out into the copy`);
  try {
    fillIgnored(root, copy);
  } catch (err) {
    if (err.cause) console.error(err.cause.message);
    fail(err.message);
  }
  halted();
  const before = treeId(copy);
  if (!before) fail("could not hash the copy's tree");
  if (before !== tree) {
    fail(`the copy holds tree ${before}, not the index's ${tree} (a gitignored file the staged .gitignore does not ignore), so nothing was run`);
  }
  // npm runs the script with plain sh, the one `command -v sh` names, so the
  // copy writes no record of its own.
  const sh = onPath('sh');
  if (sh === null) fail('no sh on PATH for npm to run the suite with');
  // The suite's own empty Claude home, beside the copy (why: proofClaudeHome).
  const claudeHome = proofClaudeHome(state.tmp);
  if (claudeHome === null) fail(`could not make a Claude home in ${state.tmp}`);
  halted();
  const started = Date.now();
  const rc = await npmTest(copy, sh, { ...process.env, WORKFLOW_CLAUDE_HOME: claudeHome });
  const ms = Date.now() - started;
  // One turn of the loop, so a signal that came before the suite's end is seen
  // before its code is read, as bash runs a trap once its command ends.
  await new Promise(setImmediate);
  halted();
  if (rc !== 0) {
    console.log(`prove: red: the suite failed on the staged tree ${tree}, so no record was written`);
    return rc;
  }
  const after = treeId(copy);
  if (!after) fail("the suite passed, but the copy's tree could not be hashed, so no record was written");
  if (after !== tree) fail("the suite passed, but it changed the copy's tree, so no record was written");
  let written = false;
  try {
    written = await writeSuiteRecord(root, tree, ms);
  } catch (err) {
    console.error(`records: ${err.message}`);
  }
  if (!written) fail(`the suite passed, but the record of ${root} could not be written`);
  console.log(`prove: green: the staged tree ${tree} is proved; a commit of it passes the gate`);
  return 0;
};

/**
 * The call: the full-suite hold (lib/hold.js) judged against the index's
 * tree, then the body run detached on the suite's log and lock, checked by the
 * root's tests.check (a frozen run exits 124, a look at an unclear one 125 with
 * the run going on).
 * @param {string[]} argv none, or `--body <root>`
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  if (argv[0] === BODY) return body(argv[1]);
  if (argv.length > 0) {
    say('takes no arguments (usage: workkit prove)');
    return 2;
  }
  // Its only product is the record, and a run with CI set writes none.
  if (process.env.CI) fail('CI is set, so no record would be written; run workkit prove again without CI');
  const root = repoRoot(process.cwd());
  if (root === null) fail('not inside a git repository');
  if (!hasTestScript(readJsonOrNull(path.join(root, 'package.json')))) fail(`${root} declares no test script, so there is no suite to prove`);
  if (onPath('npm') === null) fail('npm is not on PATH');
  if (!(await suiteHold(root, indexTreeId))) return 1;
  let paths;
  try {
    paths = await runPaths(root, 'suite');
  } catch (err) {
    if (!(err instanceof LogsDirError)) throw err;
    console.error(err.message);
    return 1;
  }
  // One full run at a time, and a kill of this call leaves the run going to its record and its cleanup.
  const done = await run({ ...paths, root, argv: [process.execPath, __filename, BODY, root] });
  if (done.held !== null) {
    say(`a root suite run is already running (pid ${done.held}); its output is in ${paths.log}`);
    return 1;
  }
  return done.rc;
};

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => {
      if (!(err instanceof Done)) throw err;
      return err.code;
    })
    // Set the code, never process.exit(): the body's last line follows its output.
    .then((code) => { process.exitCode = code; });
}
