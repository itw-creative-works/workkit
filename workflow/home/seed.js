/**
 * workflow/home/seed.js: the one-time seed of the tower project into an empty
 * clone, the by-content sync that keeps it current, and the export of a
 * folder's committed files both read from, with git alone.
 * Usage: const { seed, sync, source, file, tracked, manifestsOf } = require('./seed');
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitIn, textAt } = require('../lib/git');
const { isDir, isFile } = require('../lib/lock');
const { filesUnder } = require('../lib/read');
const { nativePath } = require('../lib/platform');
const { ok, skip, warn } = require('../lib/voice');
const { towerDir } = require('../user-dir');
const { towerApp, homeReady } = require('./options');
const { repointFileSpecs } = require('./repo');
const { downgrades, stampFolders, stampWrite } = require('./stamp');

// What a copy of the app never carries: `tower/app/.gitignore` plus `.git` and
// `.DS_Store`, matched by name at every depth. One list for the seed and the
// sync on both sides, so they agree on what the project is.
const TOWER_APP_EXCLUDE = ['node_modules', 'package-lock.json', '.omega', '.cache', '.temp', 'dist', '.env', '.env.*', 'logs', '.claude', '.git', '.DS_Store'];

// Top-level folders earlier app layouts shipped before the sync's stamp kept a
// list of its own; the sync retires them whole where the app lacks them.
const TOWER_APP_RETIRED = ['apps'];

// The gitignore's own `!` lines, root names only: what the exclusions would
// take that the copy still needs.
const TOWER_APP_KEEP = ['.env.example'];

// Each exclusion as a whole-name pattern, `*` any run of characters.
const EXCLUDE_PATTERNS = TOWER_APP_EXCLUDE.map((name) => new RegExp(`^${name.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));

// A tree entry's git mode, as the export makes it again.
const MODE_EXEC = '100755';
const MODE_LINK = '120000';
const MODE_COMMIT = '160000';

/** Whether an entry's name is one the copy never carries. */
const pruned = (name) => EXCLUDE_PATTERNS.some((pattern) => pattern.test(name));


/**
 * Does a git repo track the folder? The one test the copies agree on: a
 * folder sitting untracked inside some other repo is not tracked.
 * @param {string} folder
 * @returns {boolean}
 */
const tracked = (folder) => gitIn(folder, ['ls-files', '--error-unmatch', '.'], { stdio: 'ignore' }).status === 0;

/**
 * Whether TOWER_APP_EXCLUDE names this top-level folder, as written.
 * @param {string} name
 * @returns {boolean}
 */
const excluded = (name) => TOWER_APP_EXCLUDE.includes(name);

/**
 * The app's own top-level folders, undotted and not excluded: what the seed
 * and the sync record in the stamp, and where the sync retires.
 * @param {string} app
 * @returns {string[]}
 */
const appFolders = (app) => {
  let names;
  try {
    names = fs.readdirSync(app);
  } catch {
    return [];
  }
  return names.sort().filter((name) => !name.startsWith('.') && isDir(path.join(app, name)) && !excluded(name));
};

/** HEAD's entries under `folder`: mode, object and path from the folder, or null when git cannot list them. */
const headEntries = (folder) => {
  const res = gitIn(folder, ['ls-tree', '-r', '-z', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (res.status !== 0) return null;
  return res.stdout.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, , object] = line.slice(0, tab).split(' ');
    return { mode, object, rel: line.slice(tab + 1) };
  });
};

/** Each object's raw bytes, by object name, from one `git cat-file --batch`: no filter, so no line ending changes. */
const blobsOf = (folder, objects) => {
  const res = gitIn(folder, ['cat-file', '--batch'], { input: objects.map((o) => `${o}\n`).join(''), stdio: ['pipe', 'pipe', 'ignore'] });
  if (res.status !== 0) throw new Error('git cat-file --batch failed');
  const blobs = new Map();
  let at = 0;
  while (at < res.stdout.length) {
    const end = res.stdout.indexOf(10, at);
    const [object, type, size] = res.stdout.subarray(at, end).toString('utf8').split(' ');
    if (type === 'missing') throw new Error(`git cat-file: ${object} is missing`);
    const start = end + 1;
    blobs.set(object, res.stdout.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return blobs;
};

/** HEAD's files under `folder` written into `dest`, each its bytes and its run bit; throws on any failure. */
const exportHead = (folder, dest) => {
  const entries = headEntries(folder);
  if (entries === null) throw new Error('git ls-tree failed');
  const blobs = blobsOf(folder, [...new Set(entries.filter((e) => e.mode !== MODE_COMMIT).map((e) => e.object))]);
  for (const { mode, object, rel } of entries) {
    const at = path.join(dest, rel);
    if (mode === MODE_COMMIT) {
      fs.mkdirSync(at, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(at), { recursive: true });
    if (mode === MODE_LINK) fs.symlinkSync(blobs.get(object).toString('utf8'), at);
    else fs.writeFileSync(at, blobs.get(object), { mode: mode === MODE_EXEC ? 0o755 : 0o644 });
  }
};

/**
 * The folder a copy reads from. A folder a repo TRACKS gives HEAD's copy of
 * it, exported into `<scratch>/src`, so an uncommitted edit never travels; a
 * folder no repo tracks (even one inside some other repo) is itself. An
 * export holding no file is a failure too.
 * @param {string} scratch a scratch folder the caller removes
 * @param {string} folder
 * @returns {string} the folder to read, or '' when the export failed
 */
const exportOf = (scratch, folder) => {
  if (!tracked(folder)) return folder;
  const dest = path.join(scratch, 'src');
  try {
    fs.mkdirSync(dest, { recursive: true });
    exportHead(folder, dest);
    return filesUnder(dest).length > 0 ? dest : '';
  } catch {
    return '';
  }
};

/**
 * exportOf, a failed export named in the seed's voice.
 * @param {string} scratch a scratch folder the caller removes
 * @param {string} folder
 * @returns {string} the folder to read, or '' when the export failed (warned)
 */
const source = (scratch, folder) => {
  const from = exportOf(scratch, folder);
  if (!from) warn(`home: could not export the committed files from ${nativePath(folder)} (HEAD holds none of it, or the extract failed); nothing was copied from it`);
  return from;
};

/**
 * One file's text by the same rule: HEAD's copy when a repo tracks the
 * folder, else the disk's.
 * @param {string} folder
 * @param {string} rel the path from the folder
 * @returns {string|null} null when that side lacks it
 */
const file = (folder, rel) => {
  if (tracked(folder)) return textAt(folder, 'HEAD', `./${rel}`);
  const at = path.join(folder, rel);
  if (!isFile(at)) return null;
  try {
    return fs.readFileSync(at, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A scratch folder, or null when one cannot be made.
 * @returns {string|null}
 */
const scratchDir = () => {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-home.'));
  } catch {
    return null;
  }
};

// The seed's two copies are its own, not tree-copy.js's copyEntry: that file
// loads the hook layer, which the cloud runner must not need.

/** `from` copied into `to` whole, a pruned name left out at every depth, modes kept and links copied as links. */
const copyPruned = (from, to) => {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (pruned(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyPruned(src, dest);
    } else if (entry.isSymbolicLink()) {
      fs.rmSync(dest, { force: true });
      fs.symlinkSync(fs.readlinkSync(src), dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
};

/** `src` over `dest`, its mode kept; false when it could not be written. */
const copyKept = (src, dest) => {
  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether two files hold the same bytes, `cmp -s`; false when either cannot be read.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
const sameBytes = (a, b) => {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
};

/**
 * A project's manifests that are files: the root `package.json`, then each
 * target's, a dot-named folder skipped as the shell's `targets/*` was.
 * @param {string} home the project folder
 * @returns {string[]}
 */
const manifestsOf = (home) => {
  let targets;
  try {
    targets = fs.readdirSync(path.join(home, 'targets')).filter((name) => !name.startsWith('.')).sort();
  } catch {
    targets = [];
  }
  return [path.join(home, 'package.json'), ...targets.map((name) => path.join(home, 'targets', name, 'package.json'))].filter(isFile);
};

/** Each manifest of the clone repointed from the one it was copied from: the root first, then every target. */
const repointManifests = (home, app) => {
  for (const pkg of manifestsOf(home)) repointFileSpecs(pkg, path.join(app, path.relative(home, path.dirname(pkg))));
};

/**
 * The seed: the tower app's committed files copied into the empty clone, its
 * `file:` specs made absolute, and the stamp written from the first commit.
 * @returns {boolean} true seeded, false not (warned)
 */
const seed = () => {
  const app = towerApp();
  const home = towerDir();
  if (!app || !isDir(app)) {
    warn(`home: the tower app is missing at ${app || 'this kit'}; nothing to seed the project from`);
    return false;
  }
  const scratch = scratchDir();
  if (scratch === null) {
    warn(`home: could not make a scratch directory; nothing was seeded into ${nativePath(home)}`);
    return false;
  }
  try {
    const from = source(scratch, app);
    if (!from) return false;
    try {
      copyPruned(from, home);
    } catch {
      warn(`home: could not copy the tower app into ${nativePath(home)}`);
      return false;
    }
    for (const name of TOWER_APP_KEEP) {
      if (!isFile(path.join(from, name))) continue;
      if (!copyKept(path.join(from, name), path.join(home, name))) {
        warn(`home: could not copy ${name} into ${nativePath(home)}`);
        return false;
      }
    }
    const folders = appFolders(from);
    repointManifests(home, app);
    // From the very first commit the clone says which kit wrote it, and which
    // folders, so the first sync agrees.
    stampWrite(folders);
    ok(`home: seeded the tower project in ${nativePath(home)} from ${nativePath(app)}`);
    return true;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

/** The app's files to sync, the kept root names after the walk. */
const appFiles = (from) => [
  ...filesUnder(from, pruned),
  ...TOWER_APP_KEEP.map((name) => path.join(from, name)).filter(isFile),
];

/**
 * The app's files into the clone by content, a manifest composed first so the
 * compare is against what would land.
 * @returns {{rc: number, copied: number, manifests: boolean}}
 */
const syncIn = (from, app, home, tmp) => {
  let copied = 0;
  let manifests = false;
  for (const src of appFiles(from)) {
    const rel = path.relative(from, src).split(path.sep).join('/');
    const dest = path.join(home, rel);
    let want = src;
    const manifest = path.basename(rel) === 'package.json';
    if (manifest) {
      want = path.join(tmp, 'package.json');
      if (!copyKept(src, want)) {
        warn(`sync: could not stage ${rel} for comparison; the tower project in ${nativePath(home)} is part-refreshed`);
        return { rc: 3, copied, manifests };
      }
      repointFileSpecs(want, path.dirname(path.join(app, rel)));
    }
    if (sameBytes(want, dest)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } catch {
      // The copy below names the failure.
    }
    if (!copyKept(want, dest)) {
      warn(`sync: could not write ${rel} into ${nativePath(home)}`);
      return { rc: 3, copied, manifests };
    }
    if (manifest) manifests = true;
    copied += 1;
  }
  return { rc: 0, copied, manifests };
};

/**
 * What the app retired, out: inside its own top-level folders, then each
 * whole folder the last sync recorded or an older layout shipped that the app
 * dropped. The root is shared with other steps, and emptied folders stay.
 * @returns {{rc: number, removed: number, synced: string[]}}
 */
const retire = (from, home) => {
  let removed = 0;
  const synced = appFolders(from);
  for (const top of synced) {
    if (!isDir(path.join(home, top))) continue;
    for (const found of filesUnder(path.join(home, top), pruned)) {
      const rel = path.relative(home, found).split(path.sep).join('/');
      if (isFile(path.join(from, rel))) continue;
      try {
        fs.rmSync(found, { force: true });
      } catch {
        warn(`sync: could not remove the retired ${rel} from ${nativePath(home)}`);
        return { rc: 3, removed, synced };
      }
      removed += 1;
    }
  }
  // A plain undotted name only, so no stamp line reaches outside those folders.
  for (const name of [...stampFolders(), ...TOWER_APP_RETIRED]) {
    if (!name || name.startsWith('.') || name.includes('/') || excluded(name)) continue;
    if (isDir(path.join(from, name)) || !isDir(path.join(home, name))) continue;
    try {
      fs.rmSync(path.join(home, name), { recursive: true, force: true });
    } catch {
      warn(`sync: could not remove the retired folder ${name} from ${nativePath(home)}`);
      return { rc: 3, removed, synced };
    }
    removed += 1;
  }
  return { rc: 0, removed, synced };
};

/**
 * The catch-up ahead of the build: the clone made the app's committed copy by
 * content, the stamp counted as a write of its own.
 * @returns {{code: number, manifests: boolean}} code 0 changed, 2 already current, 1 nothing to sync from, 3 a mid-walk write failed; manifests true when a manifest changed
 */
const sync = () => {
  const home = towerDir();
  const app = towerApp();
  if (!homeReady()) {
    skip(`sync: nothing is cloned at ${nativePath(home)}; the tower project was not refreshed`);
    return { code: 1, manifests: false };
  }
  if (!app || !isDir(app)) {
    skip(`sync: the tower app is not beside this engine (${app || 'no tower/app was found'}); ${nativePath(home)} is left exactly as it is`);
    return { code: 1, manifests: false };
  }
  // Never over a newer kit's work: nothing was written.
  if (downgrades()) return { code: 1, manifests: false };
  const tmp = scratchDir();
  if (tmp === null) {
    warn(`sync: could not make a scratch directory; the tower project in ${nativePath(home)} was not refreshed`);
    return { code: 1, manifests: false };
  }
  let copied;
  let manifests;
  let removed;
  let synced;
  try {
    const from = source(tmp, app);
    if (!from) return { code: 1, manifests: false };
    const into = syncIn(from, app, home, tmp);
    ({ copied, manifests } = into);
    // Never the benign skip: committing or building it publishes half a refresh.
    if (into.rc !== 0) return { code: into.rc, manifests };
    const out = retire(from, home);
    if (out.rc !== 0) return { code: out.rc, manifests };
    ({ removed, synced } = out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // The stamp last: a kit that moved on reaches the remote even when the app
  // did not change, and it records what this sync synced.
  if (stampWrite(synced)) copied += 1;
  if (copied + removed === 0) {
    skip(`sync: the tower project in ${nativePath(home)} is already current with ${nativePath(app)}`);
    return { code: 2, manifests };
  }
  ok(`sync: refreshed the tower project in ${nativePath(home)} (${copied} file(s) from ${nativePath(app)}, ${removed} retired)`);
  return { code: 0, manifests };
};

module.exports = {
  TOWER_APP_EXCLUDE, TOWER_APP_RETIRED, TOWER_APP_KEEP, tracked, excluded, appFolders, exportOf, source, file, scratchDir, sameBytes, manifestsOf, seed, sync,
};
