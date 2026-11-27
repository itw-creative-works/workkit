/**
 * workflow/lib/tree-copy.js: the Node home of a tree copy, CJS: a folder copied
 * less `.git`, every package's node_modules and the kit's own paths; the fill
 * that then makes each package's node_modules a real folder of links to the live
 * repo's; and the detached worktree a copy is made in, added, checked out,
 * filled with the live repo's gitignored files, and removed. The snapshot
 * (lib/snapshot.js), `workkit prove`, `workkit proof red` and `workkit ship
 * publish` share it, and npm's script shell its path under the physical root (relIn).
 * Usage: const { copyTree, fillCopy, copyEntry, heldModules, checkOut, fillIgnored, worktreeAdd, worktreeRemove, relIn } = require('./tree-copy');
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('./run');
const { gitIn } = require('./git');
const { pause } = require('./pause');
const { present } = require('./read');
const { isDir } = require('./lock');
const { userDirOf } = require('../../hooks/mods/log.js');
const { markersDir, shellEnvOf } = require('../../hooks/mods/markers.js');
const { snapshotHome } = require('../../hooks/mods/snapshot.js');

// The tries of a worktree add, a second apart: another add or prune racing on
// the repo's worktree list fails one.
const ADD_TRIES = 3;
const ADD_WAIT_S = 1;

/** git in `root`; its status and its output as text. */
const git = (root, args) => gitIn(root, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A path's parts joined with `/`, as git spells a path. */
const slashed = (rel) => rel.split(path.sep).join('/');

/** Whether a root-relative path lies in a node_modules. */
const inModules = (rel) => `/${rel}/`.includes('/node_modules/');

/** `p` under the physical `root`, links resolved, as git spells it; null when it is not there or lies outside. */
const relIn = (root, p) => {
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return null;
  }
  const rel = path.relative(root, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return slashed(rel);
};

/**
 * Each package's node_modules folder in `root`: one beside every package.json
 * git lists there, tracked or untracked and not ignored, none under a
 * node_modules, kept when the folder exists. Empty outside a git work tree (a
 * snapshot's tree holds no package's node_modules).
 * @param {string} root
 * @returns {string[]} the folders, root-relative as git spells them
 * @throws {Error} git could not list the package.json files
 */
const heldModules = (root) => {
  if (git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') return [];
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/package.json']);
  if (listed.status !== 0) throw new Error(`could not list the package node_modules folders under ${root}`);
  const held = new Set();
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (inModules(file)) continue;
    const rel = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/node_modules` : 'node_modules';
    if (isDir(path.join(root, rel))) held.add(rel);
  }
  return [...held];
};

/**
 * The kit's paths inside `root` by real path: the snapshot home, where a
 * snapshot is built; the markers folder, the kit's live state; and each path
 * of the machine folder git ignores there.
 */
const kitPaths = (root) => {
  let real;
  try {
    real = fs.realpathSync(root);
  } catch {
    return [];
  }
  const env = shellEnvOf(process.env, process.platform);
  const user = userDirOf(env);
  const found = [snapshotHome(env), markersDir(user)].map((p) => relIn(real, p)).filter((rel) => rel !== null);
  const userRel = relIn(real, user);
  if (userRel === null) return found;
  const ignored = git(real, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', `:(literal)${userRel}`]);
  if (ignored.status !== 0) throw new Error(`could not list the kit's paths under ${root}`);
  return [...found, ...ignored.stdout.split('\0').filter(Boolean).map((rel) => rel.replace(/\/$/, ''))];
};

/** Whether a left-out path lies under `rel`. */
const holdsUnder = (left, rel) => left.some((out) => out.startsWith(`${rel}/`));

/**
 * A link at `at` holding `target` as written. A folder's is a junction where
 * the target is absolute, which needs no privilege on Windows, else a folder
 * link; any other, a dangling one too, a file link. The type is never guessed.
 */
const linkAs = (target, at, folder) => {
  let type = 'file';
  if (folder) type = path.isAbsolute(target) ? 'junction' : 'dir';
  fs.symlinkSync(target, at, type);
};

/**
 * Node's own copy of one entry, `from` to `to`: a folder walked, a file's
 * mode and times kept, a link (a dangling one too) made again as a link with
 * its type, never followed. Windows' tree copy and red-proof's paths use it.
 * @param {string} from
 * @param {string} to the path made, its parent there; a folder there is filled
 */
const copyEntry = (from, to) => {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    fs.rmSync(to, { force: true });
    linkAs(fs.readlinkSync(from), to, isDir(from));
  } else if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyEntry(path.join(from, name), path.join(to, name));
  } else {
    fs.copyFileSync(from, to);
    fs.utimesSync(to, stat.atime, stat.mtime);
  }
};

/**
 * One entry copied whole, links kept as links: `cp` with the platform's flags,
 * a clone on macOS and a reflink where Linux can, and Node's own copy
 * (copyEntry) on Windows.
 * @throws {Error} the copy's own words
 */
const copyOne = (from, to) => {
  if (process.platform === 'win32') {
    copyEntry(from, to);
    return;
  }
  const flags = { darwin: ['-c', '-pPR'], linux: ['-a', '--reflink=auto'] }[process.platform] ?? ['-pPR'];
  const res = spawnSync('cp', [...flags, from, `${path.dirname(to)}/`], {
    encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  if (res.status === 0) {
    if (res.stderr) process.stderr.write(res.stderr);
    return;
  }
  throw new Error((res.stderr || '').trim() || `cp ${res.error ? `could not be run, ${res.error.code}` : 'failed'} on ${from}`);
};

/** `rel` copied whole into `dest`, unless left out; a folder holding a left-out path is made and walked entry by entry. */
const put = (src, dest, rel, left) => {
  if (left.includes(rel)) return;
  if (!holdsUnder(left, rel)) {
    copyOne(path.join(src, rel), path.join(dest, rel));
    return;
  }
  fs.mkdirSync(path.join(dest, rel), { recursive: true });
  for (const name of fs.readdirSync(path.join(src, rel))) put(src, dest, `${rel}/${name}`, left);
};

/**
 * Every entry of `src` but `.git`, or only the paths in `only` whose parent
 * `dest` holds, copied into `dest`. Each package's node_modules the repo
 * `root` holds and the kit's paths inside it are left out (heldModules, kitPaths).
 * @param {string} src the folder copied: the repo itself, or a snapshot's tree
 * @param {string} root the live repo, whose package node_modules and kit paths are left out
 * @param {string} dest the folder copied into, which exists
 * @param {string[]} [only] root-relative paths as git spells them; none copies the whole folder
 * @throws {Error} a step that failed, its words the message
 */
const copyTree = (src, root, dest, only = []) => {
  const left = [...heldModules(root), ...kitPaths(root)];
  const rels = only.length > 0
    ? only.map((rel) => rel.replace(/\/$/, '')).filter((rel) => !left.includes(rel) && (!rel.includes('/') || isDir(path.join(dest, path.dirname(rel)))))
    : fs.readdirSync(src).filter((name) => name !== '.git');
  for (const rel of rels) put(src, dest, rel, left);
};

/**
 * The physical path a link resolves to: a folder's whole, a file's (a .bin
 * entry) through its own folder; null when it cannot be resolved.
 */
const targetOf = (link) => {
  try {
    if (isDir(link)) return fs.realpathSync(link);
    const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
    return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  } catch {
    return null;
  }
};

/**
 * `rel` made a real folder in `dest`, each live entry linked in absolutely; a
 * workspace link (resolving inside the root and outside every node_modules)
 * points at the same path inside `dest` instead, and a scope folder or .bin is
 * filled one level down.
 */
const linkModules = (root, dest, rel, scoped = false) => {
  try {
    fs.mkdirSync(path.join(dest, rel), { recursive: true });
  } catch {
    throw new Error(`could not make ${rel} in the copy`);
  }
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const entry = path.join(root, rel, name);
    const isLink = fs.lstatSync(entry).isSymbolicLink();
    const target = isLink ? targetOf(entry) : null;
    const inside = target === null ? null : relIn(root, target);
    let to = entry;
    if (inside !== null && !inModules(inside)) {
      to = path.join(dest, inside);
    } else if (!scoped && (name.startsWith('@') || name === '.bin') && !isLink && isDir(entry)) {
      linkModules(root, dest, `${rel}/${name}`, true);
      continue;
    }
    try {
      linkAs(to, path.join(dest, rel, name), isDir(entry));
    } catch {
      throw new Error(`could not link ${rel}/${name} into the copy`);
    }
  }
};

/**
 * The copy (copyTree), then each package's node_modules the live repo `root`
 * holds made a real folder wherever the copy holds its parent and lacks it
 * (linkModules), on every platform.
 * @param {string} src the folder copied
 * @param {string} root the live repo, spelled physically
 * @param {string} dest the folder filled, which exists
 * @param {string[]} [only] as copyTree's
 * @throws {Error} a step that failed, its words the message
 */
const fillCopy = (src, root, dest, only = []) => {
  copyTree(src, root, dest, only);
  const real = fs.realpathSync(root);
  for (const rel of heldModules(root)) {
    const at = path.join(dest, rel);
    if (present(at) || !isDir(path.dirname(at))) continue;
    linkModules(real, dest, rel);
  }
};

/** git in `root` with its stderr this process's own; its status and stdout as text. */
const gitLoud = (root, args) => gitIn(root, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/**
 * The gitignored paths of `root`, read without refreshing its index.
 * @param {string} root
 * @returns {string[]} root-relative as git spells them
 * @throws {Error} git could not list them
 */
const ignoredOf = (root) => {
  const status = gitLoud(root, ['--no-optional-locks', 'status', '--porcelain', '-z', '--ignored=matching', '--no-renames']);
  if (status.status !== 0) throw new Error(`could not list the gitignored files of ${root}`);
  return status.stdout.split('\0').filter((entry) => entry.startsWith('!! ')).map((entry) => entry.slice(3));
};

/**
 * The tree `tree` checked out into the worktree `copy` an add left empty.
 * @param {string} copy
 * @param {string} tree a tree or commit git names
 * @returns {boolean} false when either step failed, git's words on stderr
 */
const checkOut = (copy, tree) => gitLoud(copy, ['read-tree', tree]).status === 0 && gitLoud(copy, ['checkout-index', '-a']).status === 0;

/**
 * The copy `dest` of the live repo `root` filled with only the paths an ignore
 * pattern matches there (fillCopy): an untracked or unstaged file is held work
 * the copy leaves out. None at all would copy the whole folder, so none fills nothing.
 * @param {string} root
 * @param {string} dest
 * @throws {Error} its line; a failed fill's own words are its `cause`
 */
const fillIgnored = (root, dest) => {
  const ignored = ignoredOf(root);
  if (ignored.length === 0) return;
  try {
    fillCopy(root, root, dest, ignored);
  } catch (err) {
    throw new Error(`could not fill the copy's gitignored files from ${root}`, { cause: err });
  }
};

/**
 * A detached worktree of `root`'s HEAD at `dest`, nothing checked out, tried
 * ADD_TRIES times a second apart.
 * @param {string} root
 * @param {string} dest
 * @throws {Error} the last try's words from git
 */
const worktreeAdd = (root, dest) => {
  let res;
  for (let tried = 1; tried <= ADD_TRIES; tried += 1) {
    res = git(root, ['worktree', 'add', '-q', '--no-checkout', '--detach', dest, 'HEAD']);
    if (res.status === 0) return;
    if (tried < ADD_TRIES) pause(ADD_WAIT_S);
  }
  throw new Error(`${res.stdout}${res.stderr}`.trim());
};

/**
 * The worktree at `dest` gone from `root`'s list: removed by git, else the
 * folder deleted and the list pruned.
 * @param {string} root
 * @param {string} dest
 * @returns {boolean} false when the prune failed too, the worktree still listed
 */
const worktreeRemove = (root, dest) => {
  if (git(root, ['worktree', 'remove', '--force', dest]).status === 0) return true;
  try {
    fs.rmSync(dest, { recursive: true, force: true });
  } catch {
    // What stays is the prune's to judge: a folder still there keeps its entry.
  }
  return git(root, ['worktree', 'prune']).status === 0;
};

module.exports = {
  copyTree, fillCopy, copyEntry, heldModules, checkOut, fillIgnored, worktreeAdd, worktreeRemove, relIn,
};
