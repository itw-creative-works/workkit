#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/snapshot.js: the repo snapshot `workkit proof red` runs against,
// which workflow:snapshot takes at the claim to status:building: take, add
// issues, the stale check and drop, as exports and as the command the hook runs.
// Its folder is snapshotPath's (hooks/mods/snapshot.js), keyed by the root as given.
// Usage: node snapshot.js take <root> [issue]... | add <root> <issue>... | stale <root> [repo] | drop <root>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('./run');
const { ioIn } = require('./io');
const { headSha, gitIn } = require('./git');
const { signalCode, exitOf, END_SIGNALS } = require('./detach');
const { sayAs } = require('./say');
const { snapshotPath } = require('../../hooks/mods/snapshot.js');
const { shellEnvOf } = require('../../hooks/mods/markers.js');
const { buildingList } = require('../../hooks/mods/gh.js');
const { issuesAt } = require('../../hooks/mods/proof.js');
const { WORKING_READS, UNBORN_READS } = require('../../hooks/mods/proof-guard.js');

const USAGE_CODE = 64;

// A sibling older than the hook's 600s timeout is a killed take's, never a live one.
const STALE_SIBLING_MS = 10 * 60 * 1000;

const SIBLING_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// The copy as a child Node process, so a take awaits it and a signal reaches the take meanwhile.
const TREE_COPY = path.join(__dirname, 'tree-copy.js');
const COPY_SCRIPT = 'try { require(process.argv[1]).copyTree(process.argv[2], process.argv[2], process.argv[3]); } catch (err) { process.stderr.write(`${err.message}\\n`); process.exitCode = 1; }';

// Off Windows the copy leads its own process group, so a signal ends it and every cp under it.
const OWN_GROUP = process.platform !== 'win32';

// The command's own lines open with `snapshot:`; a step's error is its words
// alone, which the hook puts after its own notice.
const say = sayAs('snapshot');

/** A step's error on stderr, as its words alone, and the step's failed code. */
const failed = (text) => {
  console.error(text);
  return 1;
};

/** git in `root`: its status and its stdout as bytes. */
const git = (root, args) => gitIn(root, args, { stdio: ['ignore', 'pipe', 'ignore'] });

/** The snapshot folder of a root, under the kit's cache folder. */
const snapshotDir = (root) => snapshotPath(root, shellEnvOf(process.env, process.platform));

/**
 * The working diff's root-relative paths, NUL-separated: modified, staged and
 * deleted against HEAD (a rename as both halves), then the untracked files; in
 * a repo with no commit the staged list stands in for the diff against HEAD.
 * The reads are the qa check's (WORKING_READS in hooks/mods/proof-guard.js).
 * @param {string} root
 * @returns {Buffer|null} the list, null when a read failed
 */
const workingPaths = (root) => {
  const born = headSha(root) !== null;
  const lists = [];
  for (const args of born ? WORKING_READS : UNBORN_READS) {
    const res = git(root, args);
    if (res.status !== 0) return null;
    lists.push(res.stdout);
  }
  return Buffer.concat(lists);
};

/** The numbers recorded in `file`, each once, appended in order. */
const record = (file, issues) => {
  const lines = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []);
  for (const n of issues) {
    if (lines.has(n)) continue;
    fs.appendFileSync(file, `${n}\n`);
    lines.add(n);
  }
};

/** A name beside `dir` no folder holds yet: `<dir>.<six characters>`. */
const asideOf = (dir) => `${dir}.${Array.from(crypto.randomBytes(6), (b) => SIBLING_CHARS[b % SIBLING_CHARS.length]).join('')}`;

/** Each sibling `<dir>.<six characters>` older than STALE_SIBLING_MS removed. */
const sweepSiblings = (dir) => {
  const base = path.basename(dir);
  for (const name of fs.readdirSync(path.dirname(dir))) {
    if (name.length !== base.length + 7 || !name.startsWith(`${base}.`)) continue;
    const sibling = path.join(path.dirname(dir), name);
    try {
      if (Date.now() - fs.lstatSync(sibling).mtimeMs > STALE_SIBLING_MS) fs.rmSync(sibling, { recursive: true, force: true });
    } catch {
      // A sibling the sweep cannot remove waits for a later take.
    }
  }
};

/** The old snapshot removed, else moved aside under a sibling's name, said; false when neither worked. */
const clearOld = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    const aside = asideOf(dir);
    try {
      fs.renameSync(dir, aside);
    } catch {
      return false;
    }
    console.error(`the old snapshot at ${dir} could not be removed and was moved aside to ${aside}`);
    return true;
  }
};

/** The tree copied into `dest` by a child process (COPY_SCRIPT), its words on stderr; its code. */
const copyApart = (root, dest, stop) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['-e', COPY_SCRIPT, TREE_COPY, root, dest], {
    stdio: ['ignore', 'inherit', 'inherit'], detached: OWN_GROUP, windowsHide: true,
  });
  stop.child = child;
  child.on('error', (err) => resolve(failed(err.message)));
  child.on('close', (code, signal) => {
    stop.child = null;
    resolve(exitOf(code, signal));
  });
});

/** A signal's end of the copy running for `stop`: its whole group off Windows, the child alone on it. */
const endCopy = (stop, signal) => {
  const { child } = stop;
  if (child === null || child.pid === undefined) return;
  try {
    if (OWN_GROUP) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // Gone already: its close is on its way.
  }
};

/**
 * The sibling `part` filled (head, paths, issues, then the tree) and moved into
 * place at `dir`, so a half snapshot is never found; 1 with the error said. A
 * signal (`stop.code`) ends it at the copy or right after, before the move.
 */
const build = async (root, dir, part, issues, stop) => {
  const sha = headSha(root);
  if (!sha) return failed(`${root} has no HEAD commit`);
  try {
    fs.writeFileSync(path.join(part, 'head'), `${sha}\n`);
    fs.writeFileSync(path.join(part, 'issues'), '');
  } catch {
    return failed(`could not write into ${part}`);
  }
  try {
    const paths = workingPaths(root);
    if (paths === null) throw new Error('unread');
    fs.writeFileSync(path.join(part, 'paths'), paths);
  } catch {
    return failed(`could not list the working diff of ${root}`);
  }
  try {
    record(path.join(part, 'issues'), issues);
  } catch {
    return failed(`could not record the issues in ${part}`);
  }
  try {
    fs.mkdirSync(path.join(part, 'tree'));
  } catch (err) {
    return failed(err.message);
  }
  if (stop.code !== null) return stop.code;
  const copied = await copyApart(root, path.join(part, 'tree'), stop);
  if (stop.code !== null) return stop.code;
  if (copied !== 0) return 1;
  if (!clearOld(dir)) return failed(`could not replace the snapshot at ${dir}`);
  try {
    fs.renameSync(part, dir);
  } catch {
    // A racing take moved its folder in first; this take's numbers go on that one.
  }
  fs.rmSync(part, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dir, 'tree'))) return failed(`could not move ${part} into place at ${dir}`);
  try {
    record(path.join(dir, 'issues'), issues);
    return 0;
  } catch {
    return failed(`could not record the issues in ${dir}`);
  }
};

/**
 * A fresh snapshot of `root`, replacing any there, built in a sibling moved
 * into place last. A failed take removes the sibling and keeps any snapshot; a
 * HUP, INT or TERM while it runs ends the copy, removes the sibling and answers
 * 129, 130 or 143. Its signal handlers are gone once it answers.
 * @param {string} root the repo root, the snapshot's key as given
 * @param {string[]} [issues] the claimed numbers, recorded each once
 * @returns {Promise<number>} 0, 1 with the error on stderr, or a signal's code
 */
const take = async (root, issues = []) => {
  const dir = await snapshotDir(root);
  let part;
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    sweepSiblings(dir);
    part = fs.mkdtempSync(`${dir}.`);
  } catch {
    return failed(`could not make a folder beside ${dir}`);
  }
  const stop = { code: null, child: null };
  const handlers = END_SIGNALS.map((signal) => [signal, () => {
    stop.code ??= signalCode(signal);
    endCopy(stop, signal);
  }]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const rc = await build(root, dir, part, issues, stop);
    if (rc !== 0) fs.rmSync(part, { recursive: true, force: true });
    return rc;
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
};

/**
 * The numbers recorded on the snapshot's issues list, each once.
 * @param {string} root
 * @param {string[]} issues
 * @returns {Promise<number>} 0, or 1 when the list cannot be written
 */
const add = async (root, issues) => {
  const dir = await snapshotDir(root);
  try {
    record(path.join(dir, 'issues'), issues);
    return 0;
  } catch (err) {
    return failed(err.message);
  }
};

/**
 * Whether the snapshot is stale: 0 when none of its issues is still at
 * status:building, 1 while one is or none is recorded (a claim whose numbers
 * could not be read), 2 when GitHub cannot answer. The read runs in `root`.
 * @param {string} root
 * @param {string} [repo] the repo the read names, the folder's own when empty
 * @returns {Promise<number>}
 */
const stale = async (root, repo = '') => {
  const dir = await snapshotDir(root);
  let recorded;
  try {
    recorded = fs.readFileSync(path.join(dir, 'issues'), 'utf8');
  } catch {
    return 1;
  }
  if (!/\S/.test(recorded)) return 1;
  const building = issuesAt(await buildingList(ioIn(process.env).run, { repo, cwd: root }), 'status:building');
  if (building === null) return 2;
  const numbers = new Set(building.map(String));
  return recorded.split('\n').some((n) => numbers.has(n.trim())) ? 1 : 0;
};

/**
 * The snapshot removed, whole.
 * @param {string} root
 * @returns {Promise<number>} 0, or 1 when it cannot be removed
 */
const drop = async (root) => {
  try {
    fs.rmSync(await snapshotDir(root), { recursive: true, force: true });
    return 0;
  } catch (err) {
    return failed(err.message);
  }
};

const MODES = {
  take: (root, args) => take(root, args),
  add: (root, args) => add(root, args),
  stale: (root, [repo]) => stale(root, repo),
  drop: (root) => drop(root),
};

/**
 * The command the hook runs: each mode's code, 64 for a call it does not take.
 * @param {string[]} argv `<mode> <root> [args...]`
 * @returns {Promise<number>}
 */
const main = async ([mode, root, ...args]) => {
  if (!root) {
    say('usage: take|add|stale|drop <root> [args]');
    return USAGE_CODE;
  }
  if (!Object.hasOwn(MODES, mode)) {
    say(`unknown mode ${mode} (take, add, stale or drop)`);
    return USAGE_CODE;
  }
  return MODES[mode](root, args);
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = {
  take, add, stale, drop, workingPaths,
};
