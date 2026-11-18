#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/proof/red.js (`workkit proof red [--live] <path>... -- <command>...`):
// prove the tests check the source. The command runs in a worktree of HEAD filled
// from the claim's snapshot (place.js), the named paths as the snapshot holds
// them; --live swaps them in the live tree instead. Red exits 0, green 1, any
// other stop 2 with a `red-proof:` line on stderr; the verdict is stdout's last line.
// A reader that closes while the command runs ends it, a stop. The copy mode's
// HUP, INT or TERM ends the command, then the place, then the proof by the signal.

const fs = require('fs');
const path = require('path');
const { spawn } = require('../lib/run');
const { repoRoot, gitIn } = require('../lib/git');
const { signalCode, exitOf, END_SIGNALS } = require('../lib/detach');
const { proofBase, proofDir } = require('../lib/proof-dir');
const { workingPaths } = require('../lib/snapshot');
const { present } = require('../lib/read');
const { isDir } = require('../lib/lock');
const { sayAs } = require('../lib/say');
const { copyPlace, livePlace, isNamed } = require('./place');
const { summaryOf, loadFailures } = require('./reading');
const { snapshotPath } = require('../../hooks/mods/snapshot.js');
const { shellDirOf, shellEnvOf } = require('../../hooks/mods/markers.js');

const USAGE = 'usage: workkit proof red [--live] <path>... -- <command>...';
const NO_SNAPSHOT = 'not runnable: no snapshot for this repo (the claim to status:building takes it)';

// The node flags that take the next word, so it names no test file.
const VALUE_FLAGS = ['-r', '--require', '--import', '--loader', '--env-file', '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern'];
const SCRIPT_FLAGS = ['-e', '--eval', '-p', '--print'];

const say = sayAs('red-proof');

// Whether this process's own streams are still read: a reader that closed
// (EPIPE) is written nothing more.
const open = { stdout: true, stderr: true };

/** A `red-proof:` line on stderr, unless its reader is gone. */
const tell = (text) => {
  if (!open.stderr) return;
  try {
    say(text);
  } catch {
    open.stderr = false;
  }
};

/** A stop: its `red-proof:` line, the run ending with 2. */
class Stop extends Error {
  constructor(line) {
    super(line);
    this.name = 'Stop';
  }
}

const fail = (line) => {
  throw new Stop(line);
};

const usage = (why) => fail(`${why} (${USAGE})`);

/** A path as a line prints it: the native spelling, in forward slashes on Windows. */
const spelled = (p) => shellDirOf(p, process.env, process.platform);

/** A path in forward slashes, the spelling every marker compare reads. */
const forward = (p) => p.replace(/\\/g, '/');

/** The words before `--`, the words after it, and whether --live came first alone. */
const parsed = (argv) => {
  const live = argv[0] === '--live';
  const words = live ? argv.slice(1) : argv;
  const cut = words.indexOf('--');
  if (cut < 0) usage('no -- between the paths and the command');
  const paths = words.slice(0, cut);
  const cmd = words.slice(cut + 1);
  if (paths.length === 0) usage('no path before --');
  if (cmd.length === 0) usage('no command after --');
  return { live, paths, cmd };
};

/**
 * The path with its nearest folder that exists resolved physically (links
 * followed) and the rest joined, so a deleted path still resolves.
 */
const physical = (abs) => {
  let head = path.resolve(abs);
  const tail = [];
  while (!isDir(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  try {
    return path.join(fs.realpathSync(head), ...tail);
  } catch {
    return null;
  }
};

/** A named path as the root spells it, read from the caller's folder through physical; '' the root, null outside it. */
const rootRelative = (root, here, given) => {
  const phys = physical(path.resolve(here, shellDirOf(given, process.env, process.platform)));
  if (phys === null) return null;
  const rel = path.relative(root, phys);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
};

/**
 * The files a node command names: every positional under --test, else the
 * script alone (an -e or -p script names none). Flags, the module a loader
 * flag takes and globs are skipped; only a word that reads as a path counts.
 */
const nodeTestFiles = (args) => {
  const files = [];
  const test = args.includes('--test');
  let skip = false;
  let first = true;
  for (const word of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (SCRIPT_FLAGS.includes(word)) return files;
    if (VALUE_FLAGS.includes(word)) {
      skip = true;
      continue;
    }
    if (word.startsWith('-') || /[*?[]/.test(word)) continue;
    if (!first && !test) return files;
    first = false;
    if (/\/|\.(?:js|mjs|cjs)$/.test(word)) files.push(word);
  }
  return files;
};

/**
 * A module's physical path: a relative one read against the requiring file, a
 * bare one with a subpath against its package folder in the nearest
 * node_modules at or above it; null for a bare package name or one not there.
 */
const modulePath = (spec, from) => {
  const s = forward(spec);
  const f = forward(from);
  if (s === '.' || s === '..' || s.startsWith('./') || s.startsWith('../')) return f ? physical(`${path.dirname(f)}/${s}`) : null;
  if (s.startsWith('/') || /^[A-Za-z]:\//.test(s)) return physical(s);
  if (!f) return null;
  const parts = s.split('/');
  const take = s.startsWith('@') ? 2 : 1;
  if (parts.length <= take) return null;
  const name = parts.slice(0, take).join('/');
  for (let dir = path.dirname(f); ; dir = path.dirname(dir)) {
    if (isDir(path.join(dir, 'node_modules', name))) {
      return physical(path.join(dir, 'node_modules', name, ...parts.slice(take)));
    }
    if (path.dirname(dir) === dir) return null;
  }
};

/**
 * The load check's judge: a module that failed to load in this run's place
 * (its requiring file or its path holding the place's marker) stops the proof,
 * unless it resolves to a named path the place lacks by design (the path, the
 * path less its extension, or a file in a named folder).
 */
const loadStops = (marker, named, { spec, from }) => {
  const p = modulePath(spec, from);
  const at = p === null ? null : forward(p);
  if (!forward(from).includes(marker) && !(at && at.includes(marker))) return false;
  if (!at || !at.includes(marker)) return true;
  const rel = at.slice(at.indexOf(marker) + marker.length);
  if (isNamed(named, rel)) return false;
  return !named.some((n) => path.posix.basename(n).includes('.') && n.slice(0, n.lastIndexOf('.')) === rel);
};

/**
 * Settles once everything written to `stream` so far has been handed on: an
 * empty write's callback comes after every write before it, pending or not,
 * so a line written straight to the fd next lands after them.
 * @param {import('stream').Writable} stream
 * @returns {Promise<void>} settles on a failed stream too
 */
const drained = (stream) => new Promise((resolve) => {
  stream.write('', () => resolve());
});

/**
 * The proof's end asked for while it runs, the first ask kept: `{ code }` or
 * `{ signal }`. With `kill`, the command the proof started is sent it.
 */
const endWith = (job, end, kill) => {
  if (job.end !== null) return;
  job.end = end;
  if (!kill || job.child === null) return;
  // Windows takes TERM, INT and KILL alone (each a forced end); a send that
  // fails anyway leaves the command to end on its own, the restore still due.
  const sent = process.platform === 'win32' && !['SIGTERM', 'SIGINT'].includes(kill) ? 'SIGTERM' : kill;
  try {
    job.child.kill(sent);
  } catch {
    // The await on the command and finish(job) run as they would.
  }
};

/**
 * The command run with both streams live and kept, its output passed on before
 * the answer to each stream still read; its code, a shell's 127 or 126 for one
 * that cannot start. The child is on the job while it runs, for an end to reach.
 */
const runCommand = (job, [cmd, ...args], cwd, env) => new Promise((resolve) => {
  const out = [];
  const err = [];
  const child = spawn(cmd, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  job.child = child;
  child.stdout?.on('data', (chunk) => {
    if (open.stdout) process.stdout.write(chunk);
    out.push(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    if (open.stderr) process.stderr.write(chunk);
    err.push(chunk);
  });
  // A turn of the loop too, so a signal that came before the command's end is seen first.
  const done = (rc) => {
    job.child = null;
    const flushed = ['stdout', 'stderr'].filter((name) => open[name]).map((name) => drained(process[name]));
    Promise.all([...flushed, new Promise(setImmediate)])
      .then(() => resolve({ rc, out: Buffer.concat(out).toString(), err: Buffer.concat(err).toString() }));
  };
  child.on('error', (error) => done(error.code === 'ENOENT' ? 127 : 126));
  child.on('close', (code, signal) => done(exitOf(code, signal)));
});

/** A verdict line on stdout, unless its reader is gone. */
const verdict = (text) => {
  if (open.stdout) console.log(`red-proof: ${text}`);
};

/**
 * The proof in its place: the command run, then the verdict read from its
 * summary and its load failures. An end asked for meanwhile (job.end) reads nothing.
 * @returns {Promise<number>} 0 red, 1 green; a stop throws
 */
const judge = async (job, place, { cmd, paths }) => {
  const where = job.live ? 'the repo' : 'the copy';
  if (cmd[0] === 'node') {
    for (const file of nodeTestFiles(cmd.slice(1))) {
      if (!fs.existsSync(path.resolve(place.dir, file))) fail(`test file not in ${where}: ${file}`);
    }
  }
  // The kit's runner adds one line of counts per run to this file.
  const file = `${job.tmp}/summary`;
  const ran = await runCommand(job, cmd, place.dir, { ...process.env, WORKKIT_TEST_SUMMARY: spelled(file) });
  if (job.end !== null) return 2;
  let summary;
  try {
    summary = summaryOf({ out: ran.out, err: ran.err, file });
  } catch (err) {
    fail(`not runnable: ${err.message}`);
  }
  if (summary?.tests === 0) fail('not runnable: no test ran');
  if (ran.rc === 0) {
    verdict(`green: the tests pass without ${paths.join(' ')}`);
    return 1;
  }
  if (ran.rc === 126 || ran.rc === 127) fail(`command not runnable: ${cmd[0]}`);
  // The copy's own folder, unique to this run (its parent and its run id), so
  // another run's copy never matches; in the live mode the repo root.
  const marker = job.live ? `${forward(job.root)}/` : `/${path.basename(path.dirname(job.tmp))}/${path.basename(job.tmp)}/copy/`;
  const stopped = loadFailures(ran).find((failure) => loadStops(marker, job.named, failure));
  if (stopped) fail(`not runnable: a module failed to load: ${stopped.spec}`);
  if (summary?.failed === 0) fail('not runnable: no test failed; the command stopped another way');
  verdict('red');
  return 0;
};

/** The named paths as the root spells them, each in the tree or the working diff; the root itself is ''. */
const namedOf = (job, given) => {
  const listed = Buffer.from(job.paths).toString().split('\0').filter(Boolean);
  return given.map((p) => {
    const rel = rootRelative(job.root, job.here, p);
    const known = rel === '' || (rel !== null && (present(path.join(job.snap, 'tree', rel))
      || gitIn(job.root, ['cat-file', '-e', `HEAD:${rel}`], { stdio: 'ignore' }).status === 0
      || listed.some((l) => l === rel || l.startsWith(`${rel}/`))));
    if (!known) fail(`${p} is not in this repo's tree or working diff`);
    return rel;
  });
};

/**
 * The run folder's end: the place restored, then the folder removed, or kept
 * with its line when the live tree is not restored. Before the folder, nothing.
 */
const finish = (job) => {
  if (!job.tmp) return true;
  const whole = job.restore ? job.restore() : true;
  if (!whole) {
    tell(`the live tree is not restored; ${spelled(job.tmp)} is kept`);
    return false;
  }
  fs.rmSync(job.tmp, { recursive: true, force: true });
  return true;
};

/**
 * The ends that come from outside, each through endWith, so the command is
 * awaited and the place restored before the proof ends: a reader of stdout or
 * stderr gone (EPIPE) ends the command and the proof with 2; a HUP, INT or TERM
 * in the copy mode is sent on to the command, and the proof ends by it; in the
 * --live mode the command runs on, and the proof ends with the signal's code.
 */
const endsFor = (job) => {
  for (const name of ['stdout', 'stderr']) {
    process[name].on('error', () => {
      open[name] = false;
      endWith(job, { code: 2, closed: name }, 'SIGTERM');
    });
  }
  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      if (job.live) endWith(job, { code: signalCode(signal) });
      else endWith(job, { signal }, signal);
    });
  }
};

/**
 * The call.
 * @param {string[]} argv `[--live] <path>... -- <command>...`
 * @returns {Promise<number>} 0 red, 1 green, 2 a stop, 129, 130 or 143 a --live run a signal ended
 */
const main = async (argv) => {
  const job = {
    end: null, child: null, fail, spelled,
  };
  endsFor(job);
  const call = parsed(argv);
  const root = repoRoot(process.cwd());
  if (root === null) usage('not inside a git repository, so there is no HEAD to copy');
  const prefix = gitIn(process.cwd(), ['rev-parse', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout.trim();
  const snap = await snapshotPath(root, shellEnvOf(process.env, process.platform));
  if (!fs.existsSync(path.join(snap, 'tree'))) fail(NO_SNAPSHOT);
  const tmp = proofDir();
  if (tmp === null) fail(`could not make a run folder under ${proofBase()}`);
  Object.assign(job, {
    live: call.live, root, snap, tmp, prefix, here: fs.realpathSync(process.cwd()),
  });
  let code = 2;
  try {
    job.paths = workingPaths(root);
    if (job.paths === null) fail('could not list the working diff');
    job.named = namedOf(job, call.paths);
    const place = call.live ? livePlace(job) : copyPlace(job);
    // One turn of the loop, so an end that came while the place was built is seen.
    await new Promise(setImmediate);
    if (job.end === null) code = await judge(job, place, call);
  } catch (err) {
    if (!(err instanceof Stop)) {
      finish(job);
      throw err;
    }
    tell(err.message);
  }
  // A closed stderr has nowhere to say its stop; a closed stdout says it there.
  if (job.end?.closed === 'stdout') tell('stopped: its stdout was closed');
  const whole = finish(job);
  if (!whole) return 2;
  // The copy mode ends by the signal it was sent, its place gone first. Windows
  // has no signal to end by, and its forced end answers 1 (green), so there the
  // signal's code is the exit code, as a snapshot take and a detached body end.
  if (job.end?.signal) {
    if (process.platform === 'win32') return signalCode(job.end.signal);
    process.removeAllListeners(job.end.signal);
    process.kill(process.pid, job.end.signal);
  }
  return job.end?.code ?? code;
};

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => {
      // An error of the proof's own is a stop too, never a code that reads as a verdict.
      tell(err instanceof Stop ? err.message : `stopped by an error: ${String(err)}`);
      return 2;
    })
    // Set the code, never process.exit(): the verdict follows the command's output.
    .then((code) => { process.exitCode = code; });
}

module.exports = { drained };
