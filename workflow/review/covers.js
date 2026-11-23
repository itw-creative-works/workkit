#!/usr/bin/env node
// workflow/review/covers.js (`workkit review covers`): does a full-panel review
// cover the working diff? The full-panel marker (`workkit review mark full`,
// keyed on the repo root) must be newer than every modified, staged and
// untracked path but the heal's removal of the retired version key, and than
// the folder a deleted path left. A diff of that removal or nothing is stale,
// since commits are unseen. Covered exits 0, stale 1, a failed read 2.

const fs = require('fs');
const { repoRoot, textAt } = require('../lib/git');
const { sayAs } = require('../lib/say');
const { isFile } = require('../lib/lock');
const { readOrNull } = require('../lib/read');
const { home } = require('../lib/records');
const { workingPaths } = require('../lib/snapshot');
const { outLine } = require('../public/lib');
const { reviewFullMarkerPath } = require('../../hooks/mods/markers.js');
const { versionOnly } = require('../../hooks/mods/commit-gate/checks.js');
const { repoSettingsFile } = require('../../hooks/mods/settings.js');

const say = sayAs('review-covers');

/** A stdout line of the verb's own. */
const out = (text) => outLine(`review-covers: ${text}`);

/** A path's mtime in whole seconds, the path itself if a link, 0 when unreadable. */
const mtimeS = (file) => {
  try {
    return Math.floor(fs.lstatSync(file).mtimeMs / 1000);
  } catch {
    return 0;
  }
};

/** Whether the path is the repo settings file and differs from HEAD in its version alone, the heal's removal. */
const healBookkeeping = (root, rel) => {
  const file = `${root}/${rel}`;
  if (file !== repoSettingsFile(root) || !isFile(file)) return false;
  const head = textAt(root, 'HEAD', rel);
  const copy = readOrNull(file);
  return head !== null && copy !== null && versionOnly(head, copy);
};

/** The path itself, or its nearest folder still standing when it is gone. */
const standing = (root, rel) => {
  let at = `${root}/${rel}`;
  while (!fs.existsSync(at) && at !== root) at = at.slice(0, at.lastIndexOf('/'));
  return at;
};

/**
 * The verb: one stdout line for covered or stale, a stderr line for a failed read.
 * @returns {Promise<number>} the exit code
 */
const main = async () => {
  const root = repoRoot(process.cwd());
  if (root === null) {
    say('not inside a git repository, so there is no marker to read.');
    return 2;
  }

  const marker = await reviewFullMarkerPath(root, home());
  if (!isFile(marker)) {
    out('stale: no full-panel marker');
    return 1;
  }
  const marked = mtimeS(marker);

  const list = workingPaths(root);
  if (list === null) {
    say('could not list the working diff.');
    return 2;
  }
  const paths = list.toString('utf8').split('\0').slice(0, -1);

  let judged = false;
  for (const rel of paths) {
    if (healBookkeeping(root, rel)) continue;
    judged = true;
    // An edit in the marker's own second may postdate it.
    if (mtimeS(standing(root, rel)) >= marked) {
      out(`stale: ${rel}`);
      return 1;
    }
  }
  if (!judged) {
    out('stale: no working diff');
    return 1;
  }
  out('covered');
  return 0;
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
