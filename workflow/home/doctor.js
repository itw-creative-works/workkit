/**
 * workflow/home/doctor.js: the doctor lines for the home clone and the cloud
 * brief's runner, checked and never written. Each answers the number of
 * things needing attention, which is what `workkit doctor` counts.
 * Usage: const { doctor, runnerDoctor } = require('./doctor');
 */

const path = require('path');
const { gitIn } = require('../lib/git');
const { isDir, isFile } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { towerDir } = require('../user-dir');
const {
  kitDir, slug, homeState, homeReady, cloneSlug,
} = require('./options');
const { withScratch } = require('../lib/scratch');
const { exportOf } = require('./committed');
const { sameBytes } = require('./seed');
const { downgrades } = require('./stamp');
const { runnerList, runnerRetired } = require('./runner');

/**
 * The home clone's state, in the voice of whoever called.
 * @returns {number} the lines needing attention
 */
const doctor = () => {
  const repo = slug();
  const home = nativePath(towerDir());
  const state = homeState();
  if (state === 'unset') {
    info(`home: not set; \`workkit setup\` creates the private home repo and clones it into ${home}`);
    return 0;
  }
  if (state === 'absent') {
    warn(`home: ${repo} is configured but nothing is cloned at ${home}; run \`workkit setup\` to clone and seed it`);
    return 1;
  }
  if (state === 'other') {
    const sitting = cloneSlug();
    if (sitting) warn(`home: ${home} is a git repo pointing at ${sitting}, not ${repo}; move it aside, then run \`workkit setup\``);
    else warn(`home: ${home} exists and is not a clone of ${repo}; move it aside, then run \`workkit setup\``);
    return 1;
  }
  // Asked first: a checkout older than the clone's stamp writes nothing, so
  // every answer below would be about a clone it cannot write to.
  if (downgrades()) return 1;
  // `git status -sb` answers ahead, behind and diverged without a network call.
  const res = gitIn(towerDir(), ['status', '-sb'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const track = (res.stdout ?? '').split('\n')[0];
  if (/\[ahead .*behind /.test(track)) {
    warn(`home: ${repo} has diverged from its upstream; \`git -C ${home} pull --rebase\` on a clean tree reconciles it; the engine never force-pushes`);
    return 1;
  }
  if (track.includes('[ahead ')) {
    info(`home: ${repo} is a clone with unpushed commits; the daily publish pushes them`);
    return 0;
  }
  if (track.includes('[behind ')) {
    warn(`home: ${repo} is behind its upstream; \`git -C ${home} pull --rebase\` catches it up`);
    return 1;
  }
  ok(`home: ${repo}; ${home} is its clone`);
  return 0;
};

/** The listed files against the clone: how many were compared, how many differ, and the sources the kit lacks. */
const compareListed = (from, pairs) => {
  let compared = 0;
  let behind = 0;
  const missing = [];
  for (const [src, dest] of pairs) {
    if (!isFile(path.join(from, src))) {
      missing.push(src);
      continue;
    }
    compared += 1;
    if (!sameBytes(path.join(from, src), path.join(towerDir(), dest))) behind += 1;
  }
  return { compared, behind, missing };
};

/**
 * The cloud brief's runner, read only: drift the last morning's reconcile
 * could not heal, fixed by `workkit setup`.
 * @returns {number} 1 when the seeded copy is behind or the committed kit lacks a listed file, 0 otherwise (current, or a skip)
 */
const runnerDoctor = () => {
  const home = nativePath(towerDir());
  const kit = kitDir();
  if (!homeReady()) {
    skip(`runner: no home clone at ${home}; nothing to compare the cloud brief's runner against`);
    return 0;
  }
  if (!kit || !isDir(kit)) {
    skip('runner: the kit could not be resolved beside this engine; the cloud brief\'s runner cannot be compared');
    return 0;
  }
  // The compare answers false when it could not be made (skipped), else the list and its counts.
  const compared = withScratch((scratch) => {
    // The export's own warning is the seed's voice; here a failure is a skip.
    const from = exportOf(scratch, kit);
    if (!from) {
      skip(`runner: could not export the committed kit from ${nativePath(kit)}; the cloud brief's runner cannot be compared`);
      return false;
    }
    const pairs = runnerList(from);
    if (pairs.length === 0) {
      skip(`runner: the committed kit at ${nativePath(kit)} carries no runner list; the cloud brief's runner cannot be compared`);
      return false;
    }
    return { pairs, found: compareListed(from, pairs) };
  }, 'workkit-home.');
  if (compared === null) {
    skip('runner: could not make a scratch directory; the cloud brief\'s runner cannot be compared');
    return 0;
  }
  if (compared === false) return 0;
  const { pairs, found } = compared;
  // The seed's prune waits on a missing file, so setup cannot clear the
  // retired files; the missing ones are what to fix.
  if (found.missing.length > 0) {
    warn(`runner: the committed kit at ${nativePath(kit)} is missing ${found.missing.join(' ')}; the cloud brief's runner is incomplete in ${home} and its retired files wait until the kit is whole`);
    return 1;
  }
  // A retired file awaiting the prune is drift too, counted through the
  // lister the seed removes from.
  const retired = runnerRetired(pairs).length;
  if (found.behind > 0 || retired > 0) {
    const detail = `${found.behind} of ${found.compared} file(s) differ${retired > 0 ? `, ${retired} retired file(s) await pruning` : ''}`;
    warn(`runner: the home repo's brief runner is behind this kit (${detail}); run \`workkit setup\``);
    return 1;
  }
  ok(`runner: the cloud brief's runner in ${home} is current with this kit`);
  return 0;
};

module.exports = { doctor, runnerDoctor };
