/**
 * workflow/home/install.js: the clone's dependencies, the catch-up and the
 * commit and push its writers use, and the clone's own heal, the committed
 * kit's `standards.sh --home` read through seed.js's export.
 * Usage: const { install, catchUp, commitPush, heal } = require('./install');
 */

const fs = require('fs');
const path = require('path');
const { gitIn, commitIdentity } = require('../lib/git');
const { isDir, isFile } = require('../lib/lock');
const { executable } = require('../lib/participation');
const { nativePath } = require('../lib/platform');
const { spawnSync, onPath } = require('../lib/run');
const { writeErr } = require('../lib/say');
const { spin, spinFd } = require('../lib/spin');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { install: buildInstall } = require('../publish/build');
const { towerDir } = require('../user-dir');
const {
  kitDir, homeBranch, homeReady,
} = require('./options');
const { source, scratchDir } = require('./seed');

/** git in the clone, its output read as text and its stderr dropped. */
const git = (args) => gitIn(towerDir(), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** git in the clone whose output is dropped; whether it exited 0. */
const gitQuiet = (args) => gitIn(towerDir(), args, { stdio: 'ignore' }).status === 0;

/** A git read as a shell capture holds it, '' when it failed. */
const read = (args) => {
  const res = git(args);
  return res.status === 0 ? res.stdout.replace(/\n+$/, '') : '';
};

/** git in the clone with its stdout on this process's and its stderr dropped, for a call spin wraps. */
const gitShown = (args) => gitIn(towerDir(), args, { stdio: ['ignore', 'inherit', 'ignore'] });

/** Whether the clone's omega binary is there and runs, the gate of the install. */
const canBuild = () => executable(path.join(towerDir(), 'node_modules', '.bin', 'omega'));

/**
 * The clone's dependencies, on both setup paths, since a clone another
 * machine seeded arrives without them. An installed omega binary is the gate.
 * @returns {Promise<number>} 0
 */
const install = async () => {
  const home = towerDir();
  if (canBuild()) {
    skip(`home: the tower project's dependencies are already installed in ${nativePath(home)}`);
    return 0;
  }
  if (!onPath('npm')) {
    skip('home: npm is not on this machine; the tower project\'s dependencies are not installed, so nothing publishes from here yet');
    return 0;
  }
  info(`home: installing the tower project's dependencies in ${nativePath(home)}`);
  // The exit status proves nothing, so the binary is the check. One retry: on
  // a fresh tree npm's workspace linking can take two runs to fill .bin.
  if (isDir(home)) await buildInstall(home, { stdio: 'ignore' });
  if (!canBuild() && isDir(home)) await buildInstall(home, { stdio: 'ignore' });
  if (canBuild()) {
    ok('home: the tower project can build here');
  } else {
    warn(`home: the tower project's build tooling did not install (no node_modules/.bin/omega); \`npm install\` in ${nativePath(home)} did not produce the omega binary, so nothing publishes until it does; run it there and read its output`);
  }
  return 0;
};

/**
 * Catch the clone up with origin before anything writes into it.
 * `--autostash` keeps a hand-taken upstream edit from reading as a divergence.
 * @param {string} prefix the warnings' prefix: publish, home, runner
 * @returns {Promise<boolean>} false when it could not, the warning saying where the tree was left
 */
const catchUp = async (prefix) => {
  const home = nativePath(towerDir());
  const preHead = read(['rev-parse', 'HEAD']);
  const stashBefore = read(['stash', 'list']);
  const pulled = await spin('catching the tower clone up with origin', () => gitShown(['pull', '--rebase', '--autostash', '--quiet']), { line: false });
  if (pulled.status !== 0) {
    gitQuiet(['rebase', '--abort']);
    warn(`${prefix}: ${home} could not catch up with its upstream; \`git -C ${home} pull --rebase\` on a clean tree reports why and reconciles it; nothing was forced`);
    return false;
  }
  // A conflicting autostash exits 0 over a tree of conflict markers; the
  // surviving stash entry is the tell. Reset to the start commit, then pop,
  // which applies onto the stash's own base and cannot conflict again.
  if (read(['stash', 'list']) === stashBefore) return true;
  if (preHead && gitQuiet(['reset', '--hard', preHead]) && gitQuiet(['stash', 'pop'])) {
    warn(`${prefix}: the uncommitted changes in ${home} conflict with what its upstream now carries; the tree was put back exactly as this run found it; settle it with \`git -C ${home} pull --rebase\` and run it again`);
  } else {
    warn(`${prefix}: the uncommitted changes in ${home} conflict with what its upstream now carries, and putting the tree back did not finish; the changes are safe in \`git -C ${home} stash list\`; settle it by hand`);
  }
  return false;
};

/**
 * Commit what changed and push; nothing staged means no commit. Never forces.
 * @param {string} subject
 * @returns {Promise<boolean>}
 */
const commitPush = async (subject) => {
  if (!homeReady()) return false;
  const home = nativePath(towerDir());
  // `.workkit` is excluded rather than trusted to be absent: in the clone it
  // can only be scratch.
  gitQuiet(['add', '-A', '--', ':!.workkit']);
  if (!gitQuiet(['diff', '--cached', '--quiet'])) {
    if (!gitQuiet([...commitIdentity(), 'commit', '-q', '-m', subject])) {
      warn(`home: the commit did not finish in ${home}`);
      return false;
    }
  }
  const branch = homeBranch();
  if ((await spin(`pushing ${branch}`, () => gitShown(['push', '-q', '-u', 'origin', branch]), { line: false })).status === 0) return true;
  warn(`home: could not push ${branch} to origin; the commit is local; \`git -C ${home} push\` reports why`);
  return false;
};

/**
 * The heal run whole, its stdout and stderr in the one order they came, as
 * `2>&1` captures them; a command log's 7, 8 and 9 kept, so its spinner
 * draws on the terminal.
 * @returns {{rc: number, out: string}}
 */
const runHeal = (heal, log) => {
  const fd = fs.openSync(log, 'w');
  const logged = spinFd() === 8 ? ['ignore', 'ignore', 'ignore', 'ignore', 7, 8, 9] : [];
  let res;
  try {
    res = spawnSync('bash', [heal, '--home', towerDir()], { stdio: ['ignore', fd, fd, ...logged], windowsHide: true });
  } finally {
    fs.closeSync(fd);
  }
  return { rc: res.status ?? 1, out: fs.readFileSync(log, 'utf8').replace(/\n+$/, '') };
};

/**
 * The clone's own heal, the committed kit's `standards.sh --home`. Every
 * failure is a named warning and 0.
 * @param {boolean} [quiet] print the heal's lines only when it failed or changed something
 * @returns {Promise<number>} 0
 */
const heal = async (quiet = false) => {
  const home = nativePath(towerDir());
  const kit = kitDir();
  if (!homeReady()) {
    warn(`home: nothing is cloned at ${home}; the home repo's labels and issue templates were not healed; \`workkit setup\` clones it`);
    return 0;
  }
  if (!kit || !isDir(kit)) {
    warn('home: the kit could not be resolved beside this engine; the home repo\'s labels and issue templates were not healed');
    return 0;
  }
  const scratch = scratchDir();
  if (scratch === null) {
    warn('home: could not make a scratch directory; the home repo\'s labels and issue templates were not healed');
    return 0;
  }
  let healed;
  try {
    // The heal, its templates and its labels all come from the one export.
    const from = source(scratch, kit);
    if (!from) {
      warn('home: the home repo\'s labels and issue templates were not healed');
      return 0;
    }
    if (!isFile(path.join(from, 'workflow', 'standards.sh'))) {
      warn(`home: the heal is missing at ${nativePath(from)}/workflow/standards.sh; the home repo's labels and issue templates were not healed`);
      return 0;
    }
    healed = runHeal(path.join(from, 'workflow', 'standards.sh'), path.join(scratch, 'heal.log'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  // Asked of the forms only, the one thing this heal writes into the tree, and
  // then of a commit a past failed push stranded locally.
  const changed = read(['status', '--porcelain', '--', '.github/ISSUE_TEMPLATE']) !== ''
    || Number(read(['rev-list', '--count', '@{upstream}..HEAD']) || 0) > 0;
  if (healed.out && (!quiet || healed.rc !== 0 || changed)) writeErr(`${healed.out}\n`);
  if (healed.rc !== 0) warn(`home: the heal of ${home} did not finish; see the warning above; it runs again tomorrow`);
  // commitPush names its own failure; the ahead check retries it tomorrow.
  if (changed) await commitPush('chore(home): install the issue templates');
  return 0;
};

module.exports = {
  install, catchUp, commitPush, heal,
};
