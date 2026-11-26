#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/script-shell.js: a `test` event of npm's script shell, started by
// script-shell.sh under a node at the kit's floor with npm's `-c <script>`. Its
// detached bodies are this file again, `--suite-body <root> -c <script>` and
// `--test-body <root> <pkg> -c <script>`.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('./lib/run');
const { repoRoot, gitIn } = require('./lib/git');
const { run } = require('./lib/runs');
const { bodyEnd, endTraps } = require('./lib/body');
const {
  exitOf, startFailed, isSupervised, END_SIGNALS,
} = require('./lib/detach');
const { samePath } = require('./lib/attach');
const {
  runPaths, lockPathOf, clearSlot, removeSlot, LogsDirError,
} = require('./lib/run-paths');
const { sweepSlots } = require('./lib/run-lock');
const { treeId } = require('./lib/tree-hash');
const { relIn } = require('./lib/tree-copy');
const { writeSuiteRecord, writePkgRecord } = require('./lib/records');
const { suiteHold } = require('./lib/hold');
const { sayAs } = require('./lib/say');
const { isChangelog, linterPath } = require('../hooks/mods/changelog-guard.js');
const { lintText } = require('../hooks/mods/commit-gate.js');

const KIT = path.join(__dirname, '..');
const SUITE_BODY = '--suite-body';
const TEST_BODY = '--test-body';

// The words a recorded run's lines use, the whole root suite's or a package run's.
const WORDS = {
  suite: {
    what: 'suite',
    record: 'record',
    changed: 'the tree changed during the run, so no record was written; run npm test again',
    ci: 'CI is set, so no record was written; run npm test again without CI',
  },
  run: {
    what: 'run',
    record: 'package record',
    changed: 'the tree changed during it, so no record was written; run it again',
    ci: 'CI is set, so no record was written; run it again without CI',
  },
};

const say = sayAs('script-shell');

/** `sh <args>` with this process's streams, its code; `onStart` handed the child. */
const sh = (args, onStart = () => {}) => new Promise((resolve) => {
  const child = spawn('sh', args, { stdio: 'inherit', windowsHide: true });
  onStart(child);
  child.on('error', (err) => {
    say(`could not start sh: ${err.message}`);
    resolve(startFailed);
  });
  child.on('close', (code, signal) => resolve(exitOf(code, signal)));
});

/** The script run plain, in the stead of the shell's `exec sh`: a HUP, INT or TERM to this process is passed on to it. */
const plain = (args) => sh(args, (child) => {
  for (const signal of END_SIGNALS) process.on(signal, () => child.kill(signal));
});

/**
 * `work(stop)` with a shell's traps, for a run under a supervisor: a HUP, INT or
 * TERM ends nothing at once and aborts `stop`, and once the work has ended the
 * call answers the first signal's code (129, 130, 143).
 */
const trapped = async (work) => {
  const traps = endTraps();
  const rc = await work(traps.stop);
  return traps.code() ?? rc;
};

/**
 * The repo root and the package npm is running, as a folder relative to the
 * root (`.` the root itself), or null for a run outside a git repo, with no
 * package file, or of a package outside the root. npm may hand a native Windows
 * path, so either separator ends the folder.
 */
const packageOf = (env, cwd) => {
  const root = repoRoot(cwd);
  const file = env.npm_package_json || '';
  const cut = file.search(/[/\\][^/\\]*$/);
  if (root === null || cut <= 0) return null;
  let dir;
  let realRoot;
  try {
    dir = fs.realpathSync(file.slice(0, cut));
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  if (samePath(dir, realRoot)) return { root, rel: '.' };
  const rel = relIn(realRoot, dir);
  return rel === null ? null : { root, rel };
};

/** The tree id of <pkg> in <root>, the whole tree for '' or '.'; null when it cannot be taken. */
const hashOf = (root, pkg) => {
  try {
    return treeId(root, pkg);
  } catch (err) {
    console.error(err.message);
    return null;
  }
};

/**
 * Whether the run was narrowed by the runner's `--filter=`: read only in what
 * npm appended to the package's own script (`npm_lifecycle_script`), bare or
 * quoted, so a script's own `--filter=` for another tool is no flag.
 */
const filtered = (script, own = process.env.npm_lifecycle_script || '') => {
  const added = own !== '' && script.length > own.length && script.startsWith(own) ? script.slice(own.length) : '';
  return /\s['"]?--filter=/.test(added);
};

/**
 * A test run recorded: hash, run, hash, record, the whole root suite when <pkg>
 * is ''. Hashed before and after on <pkg>'s own id, so an edit made while it
 * runs is never proved; a failed first hash is its own answer, never asked
 * twice. A `stop` aborted by a signal ends it at its next step.
 * @param {string} root
 * @param {string} pkg '' for the root suite, else the package folder (`.` the root)
 * @param {string[]} args npm's `-c <script>`
 * @param {AbortSignal} stop bodyEnd's for a body, trapped's under a supervisor
 * @returns {Promise<number>} the exit code
 */
const recordedRun = async (root, pkg, args, stop) => {
  const halted = () => stop.aborted;
  const words = pkg === '' ? WORDS.suite : WORDS.run;
  const passed = (text) => say(`the ${words.what} passed, but ${text}`);
  const before = hashOf(root, pkg);
  if (halted()) return 1;
  const started = Date.now();
  const rc = await sh(args);
  const ms = Date.now() - started;
  // One turn of the loop, so a signal that came before the script's end is seen
  // before its code is read, as bash runs a trap once its command ends.
  await new Promise(setImmediate);
  if (halted()) return 1;
  if (rc !== 0) return rc;
  if (filtered(args[1] ?? '')) {
    say('the run passed, but --filter left cases out, so no record was written');
    return 0;
  }
  // CI set records nothing whatever the hashes say, so its line comes first.
  if (process.env.CI) {
    passed(words.ci);
    return 0;
  }
  const after = before === null ? null : hashOf(root, pkg);
  if (after === null) {
    passed(`the tree of ${root} could not be hashed, so no record was written`);
    return 1;
  }
  if (before !== after) {
    passed(words.changed);
    return 0;
  }
  let written = false;
  try {
    written = pkg === '' ? await writeSuiteRecord(root, before, ms) : await writePkgRecord(root, before, pkg);
  } catch (err) {
    console.error(`records: ${err.message}`);
  }
  if (!written) {
    passed(`the ${words.record} of ${root} could not be written`);
    return 1;
  }
  return 0;
};

/** A run's log and lock, or null once a bad `logs.dir` said its line. */
const pathsOf = async (root, which, slot) => {
  try {
    return await runPaths(root, which, slot);
  } catch (err) {
    if (!(err instanceof LogsDirError)) throw err;
    console.error(err.message);
    return null;
  }
};

/**
 * The repo's narrowed-run slots left behind (lock folder, log, done record)
 * removed: each lock sweepSlots retires, then its log and record.
 */
const sweep = async (root) => {
  for (const slot of await sweepSlots(await lockPathOf(root, 'test'))) await clearSlot(root, slot);
};

/**
 * The tracked CHANGELOG.md files the working tree changes, read from
 * `git status -z`, so a path with a space reads as it is; a deleted one left out.
 */
const changedLogs = (root) => {
  const res = gitIn(root, ['status', '--porcelain', '-z', '--untracked-files=no'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const fields = (res.stdout || '').split('\0');
  const found = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (entry === '') continue;
    const status = entry.slice(0, 2);
    // A rename or a copy names its origin as the next field.
    if (/^([RC]|.[RC])/.test(status)) i += 1;
    if (!status.includes('D') && isChangelog(entry.slice(3))) found.push(entry.slice(3));
  }
  return found;
};

/**
 * The commit gate's message for the first changed CHANGELOG whose added entries
 * fail the linter, run under this process's own Node; or null. No linter
 * stands aside.
 */
const changelogFault = (root) => {
  const linter = linterPath(process.env, KIT);
  if (!fs.existsSync(linter)) return null;
  for (const file of changedLogs(root)) {
    const res = spawnSync(process.execPath, [linter, `${root}/${file}`, '--added-only'], {
      encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
    });
    if (res.status !== 0) return lintText(res.stderr);
  }
  return null;
};

/**
 * A bare root run: the full-suite hold, the CHANGELOG check, then the suite
 * detached on the suite's log and lock in its own session, checked by the
 * root's tests.check (a frozen run exits 124, a look 125 with the run going on).
 */
const rootRun = async (root, args) => {
  if (!(await suiteHold(root, treeId))) return 1;
  const fault = changelogFault(root);
  if (fault !== null) {
    say(fault);
    return 1;
  }
  const paths = await pathsOf(root, 'suite');
  if (paths === null) return 1;
  const suite = async () => {
    const done = await run({ ...paths, root, argv: [process.execPath, __filename, SUITE_BODY, root, ...args] });
    if (done.held !== null) {
      say(`a root npm test is already running (pid ${done.held}); its output is in ${paths.log}`);
      return 1;
    }
    return done.rc;
  };
  return isSupervised(process.env) ? trapped(suite) : suite();
};

/**
 * A narrowed or nested run, detached in a slot named by this process's pid, so
 * several run at once in one repo. Its log and lock go once this call reads the
 * end or Ctrl-C ends it; a look, or a Ctrl-C whose end failed, leaves them for
 * `workkit watch <pid>`.
 */
const packageRun = async (root, rel, args) => {
  // The paths first: a bad `logs.dir` says its line before a sweep could throw on it.
  const paths = await pathsOf(root, 'test', process.pid);
  if (paths === null) return 1;
  await sweep(root);
  // The name attachRun's look line gives `workkit watch`.
  process.env.WK_WATCH_NAME = String(process.pid);
  const done = await run({ ...paths, root, argv: [process.execPath, __filename, TEST_BODY, root, rel, ...args] });
  if (done.held !== null) {
    say(`a run already holds this slot (pid ${done.held}); its output is in ${paths.log}`);
    return 1;
  }
  // At once, never awaited: a Ctrl-C before the supervisor's pid ends this process on the loop's next turn.
  if (done.int ? !fs.existsSync(paths.lock) : !done.look) removeSlot(paths);
  return done.rc;
};

/**
 * The call. npm appends a narrowed run's arguments to the script text, so only
 * the root's bare script is the whole suite; every other test run is a package
 * run, with no hold and no CHANGELOG check. Under a supervisor already a package
 * run runs here in the foreground, never detached again.
 * @param {string[]} argv `-c <script>`, or a body's
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  if (argv[0] === SUITE_BODY) return recordedRun(argv[1], '', argv.slice(2), bodyEnd('script-shell'));
  if (argv[0] === TEST_BODY) return recordedRun(argv[1], argv[2], argv.slice(3), bodyEnd('script-shell'));
  const at = packageOf(process.env, process.cwd());
  if (at === null) return plain(argv);
  if (at.rel !== '.' || (argv[1] ?? '') !== (process.env.npm_lifecycle_script || '')) {
    if (isSupervised(process.env)) return trapped((stop) => recordedRun(at.root, at.rel, argv, stop));
    return packageRun(at.root, at.rel, argv);
  }
  return rootRun(at.root, argv);
};

if (require.main === module) {
  // Set the code, never process.exit(): a body's last line follows its output.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
