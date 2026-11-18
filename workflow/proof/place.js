/**
 * workflow/proof/place.js: the place a red proof's command runs in, CJS: a
 * worktree of HEAD filled from the claim's snapshot (copyPlace), or the live
 * tree with the named paths swapped for the snapshot's (livePlace). Each sets
 * its restore on the job before its first step, so a stop mid-build undoes it.
 * Usage: const { copyPlace, livePlace, isNamed } = require('./place');
 */

const fs = require('fs');
const path = require('path');
const { gitIn } = require('../lib/git');
const { present } = require('../lib/read');
const { isDir } = require('../lib/lock');
const { sayAs } = require('../lib/say');
const {
  fillCopy, copyEntry, heldModules, worktreeAdd, worktreeRemove,
} = require('../lib/tree-copy');

// A job is red.js's: root, snap, tmp, here, prefix, named, paths (NUL-separated),
// fail(line) and spelled(path); the place sets its restore on it.

const say = sayAs('red-proof');

/** Whether `p` is a real folder, never a link to one. */
const realDir = (p) => {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Whether a root-relative path is named, or lies in a named folder; the root
 * names everything. red.js's load check reads it too.
 * @param {string[]} named the named paths, `''` the root
 * @param {string} rel
 * @returns {boolean}
 */
const isNamed = (named, rel) => named.some((n) => n === '' || rel === n || rel.startsWith(`${n}/`));

/** A NUL-separated list's paths, the empty ones dropped. */
const entriesOf = (bytes) => Buffer.from(bytes).toString().split('\0').filter(Boolean);

/** `from` moved to `to`, across devices by a copy and a removal. */
const move = (from, to) => {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    copyEntry(from, to);
    fs.rmSync(from, { recursive: true, force: true });
  }
};

/** `step()`, a file step that calls no stop itself, or the stop `line` when it throws. */
const attempt = (job, line, step) => {
  try {
    return step();
  } catch {
    return job.fail(line);
  }
};

/** Removed whole, a missing path no failure. */
const clear = (p) => fs.rmSync(p, { recursive: true, force: true });

/**
 * Every entry under the named folder `top` in the copy that the snapshot
 * lacks removed, `rel` the folder walked; a package's node_modules there is left whole.
 */
const trimNamed = (job, copy, top, rel, held) => {
  const names = attempt(job, `could not list ${top} in the copy`, () => fs.readdirSync(path.join(copy, rel)));
  for (const name of names) {
    const sub = `${rel}/${name}`;
    if (held.includes(sub)) continue;
    if (!present(path.join(job.snap, 'tree', sub))) {
      attempt(job, `could not clear ${sub} in the copy`, () => clear(path.join(copy, sub)));
    } else if (realDir(path.join(copy, sub))) {
      trimNamed(job, copy, top, sub, held);
    }
  }
};

/** Every changed path that is not named given its live version in the copy, or removed where the live tree lacks it. */
const layLive = (job, copy, changed) => {
  for (const rel of changed) {
    if (isNamed(job.named, rel)) continue;
    const live = path.join(job.root, rel);
    const at = path.join(copy, rel);
    // A file turned folder: its files arrive on their own lines, into the folder.
    if (realDir(live)) {
      if (realDir(at)) continue;
      attempt(job, `could not make the folder ${rel} in the copy`, () => {
        clear(at);
        fs.mkdirSync(at, { recursive: true });
      });
      continue;
    }
    attempt(job, `could not clear ${rel} in the copy`, () => clear(at));
    if (!present(live)) continue;
    attempt(job, `could not make the folder for ${rel} in the copy`, () => fs.mkdirSync(path.dirname(at), { recursive: true }));
    attempt(job, `could not copy ${rel} into the copy`, () => copyEntry(live, at));
  }
};

/**
 * A detached worktree of HEAD in the run folder: HEAD checked out as the
 * floor, filled from the snapshot, each named path exactly the snapshot's, and
 * every other path changed since the snapshot live.
 * @param {object} job red.js's job
 * @returns {{dir: string, restore: function(): boolean}} the caller's folder in the copy; restore removes the worktree
 */
const copyPlace = (job) => {
  const copy = `${job.tmp}/copy`;
  let added = false;
  const restore = () => {
    if (added && !worktreeRemove(job.root, copy)) {
      say(`git still lists the removed worktree ${job.spelled(copy)} (run git -C ${job.spelled(job.root)} worktree prune)`);
    }
    added = false;
    return true;
  };
  job.restore = restore;
  try {
    worktreeAdd(job.root, copy);
  } catch (err) {
    job.fail(`could not add a worktree of HEAD at ${job.spelled(copy)}: ${err.message}`);
  }
  added = true;
  // HEAD as the floor, so a tracked file the snapshot lacks is HEAD's, and the
  // index as HEAD has it, so git in the copy reads its files against HEAD.
  const git = (args) => gitIn(copy, args, { stdio: ['ignore', 'ignore', 'inherit'] }).status === 0;
  if (!git(['read-tree', 'HEAD']) || !git(['checkout-index', '-a', '-f'])) job.fail('could not check HEAD out into the copy');
  let head = '';
  let then = null;
  try {
    head = fs.readFileSync(path.join(job.snap, 'head'), 'utf8').replace(/\n+$/, '');
    if (fs.statSync(path.join(job.snap, 'paths')).isFile()) then = fs.readFileSync(path.join(job.snap, 'paths'));
  } catch {
    // Either missing is the line below.
  }
  if (!head || then === null) job.fail(`the snapshot at ${job.spelled(job.snap)} records no head or no paths`);
  const since = gitIn(job.root, ['diff', '--name-only', '--no-renames', '-z', head, 'HEAD'], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (since.status !== 0) job.fail(`could not list the files changed since the snapshot's commit ${head}`);
  // The paths the claim's working diff and the commits since name are cleared
  // first, so the fill lays each down on a clean spot even where it changed
  // between file and folder.
  for (const rel of entriesOf(Buffer.concat([then, since.stdout]))) {
    attempt(job, `could not clear ${rel} in the copy`, () => clear(path.join(copy, rel)));
  }
  try {
    fillCopy(path.join(job.snap, 'tree'), job.root, copy);
  } catch (err) {
    job.fail(`could not fill the copy from the snapshot at ${job.spelled(job.snap)}: ${err.message}`);
  }
  const held = attempt(job, `could not list the package node_modules folders of ${job.spelled(job.root)}`, () => heldModules(job.root));
  // A named path is exactly the snapshot's, whatever HEAD holds there: absent
  // when the snapshot lacks it, and a named folder loses each entry the
  // snapshot lacks (the package node_modules the fill linked stay).
  for (const rel of job.named.filter(Boolean)) {
    if (!present(path.join(job.snap, 'tree', rel))) {
      attempt(job, `could not clear ${rel} in the copy`, () => clear(path.join(copy, rel)));
    } else if (realDir(path.join(copy, rel))) {
      trimNamed(job, copy, rel, rel, held);
    }
  }
  // Every path changed since the snapshot, from three lists: the working diff
  // now, the one at the snapshot, and the commits since its HEAD.
  layLive(job, copy, [...new Set(entriesOf(Buffer.concat([job.paths, then, since.stdout])))].sort());
  const dir = path.join(copy, job.prefix);
  if (!isDir(dir)) job.fail(`could not enter ${job.prefix || 'the root'} in the copy: HEAD and the working diff hold nothing there`);
  return { dir, restore };
};

/**
 * The live tree with each named path's live version moved under the run
 * folder's `live/` and the snapshot's put in its place (none where the
 * snapshot lacks it); restore puts every live version back, once.
 * @param {object} job red.js's job
 * @returns {{dir: string, restore: function(): boolean}} the caller's own folder; restore answers false when a path could not be put back
 */
const livePlace = (job) => {
  const swapped = [];
  let restored = false;
  const restore = () => {
    if (restored) return true;
    restored = true;
    let whole = true;
    for (const { rel, made, absent } of [...swapped].reverse()) {
      const kept = path.join(job.tmp, 'live', rel);
      const at = path.join(job.root, rel);
      const back = present(kept);
      if (!back && !absent) continue;
      try {
        clear(at);
        if (back) move(kept, at);
        else if (made) clear(made);
      } catch {
        say(back
          ? `could not put ${rel} back; its live version is at ${job.spelled(job.tmp)}/live/${rel}`
          : `could not remove ${rel}, which the live tree lacks`);
        whole = false;
      }
    }
    return whole;
  };
  job.restore = restore;
  const held = attempt(job, `could not list the package node_modules folders of ${job.spelled(job.root)}`, () => heldModules(job.root));
  for (const rel of job.named) {
    if (rel && realDir(path.join(job.root, rel)) && held.some((h) => h === rel || h.startsWith(`${rel}/`))) {
      job.fail(`--live cannot name a folder holding node_modules: ${rel}; name the files instead`);
    }
  }
  for (const rel of job.named) {
    if (!rel) job.fail('--live cannot swap the repo root; name the source paths');
    if (job.named.some((n) => rel.startsWith(`${n}/`)) || swapped.some((s) => s.rel === rel)) continue;
    const at = path.join(job.root, rel);
    // The first folder the swap makes, so restore removes it again; none when the parent stands.
    let top = at;
    while (!isDir(path.dirname(top))) top = path.dirname(top);
    const step = { rel, made: top === at ? '' : top, absent: !present(at) };
    swapped.push(step);
    if (!step.absent) {
      attempt(job, `could not move the live ${rel} aside`, () => {
        fs.mkdirSync(path.dirname(path.join(job.tmp, 'live', rel)), { recursive: true });
        move(at, path.join(job.tmp, 'live', rel));
      });
    }
    const theirs = path.join(job.snap, 'tree', rel);
    if (!present(theirs)) continue;
    attempt(job, `could not put the snapshot's ${rel} in place`, () => {
      fs.mkdirSync(path.dirname(at), { recursive: true });
      copyEntry(theirs, at);
    });
  }
  if (!isDir(job.here)) job.fail(`could not enter ${job.spelled(job.here)} with the snapshot's paths in place`);
  return { dir: job.here, restore };
};

module.exports = { copyPlace, livePlace, isNamed };
