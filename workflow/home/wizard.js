/**
 * workflow/home/wizard.js: the home half of `workkit setup`. Every failure
 * warns and goes on, except something already at the clone's path, which
 * stops the rest.
 * Usage: const { setup } = require('./wizard');
 */

const { interactive, askYes } = require('../lib/flows');
const { nativePath } = require('../lib/platform');
const { skip, info, warn, ok } = require('../lib/voice');
const { towerDir } = require('../user-dir');
const { slug, setSlug } = require('./options');
const {
  HOME_REPO_NAME, login, ensureRepo, clone, empty,
} = require('./repo');
const { seed } = require('./seed');
const { seedRunner } = require('./runner');
const {
  install, catchUp, commitPush, heal,
} = require('./install');
const { discussions, pages } = require('./services');

/** The steps a clone this setup just seeded gets. */
const firstMachine = async (slug, io) => {
  if (!seed()) return;
  await seedRunner();
  await install();
  await discussions(slug, io);
  await pages(slug);
  await commitPush('chore(home): seed the tower project');
  await heal();
};

/**
 * The second machine's path: caught up first, so the runner refresh and the
 * heal push onto origin's tip. A clone that cannot catch up is left unwritten
 * (a stale base would commit what it can never push); only the GitHub-side
 * steps run, and the next setup finishes the job.
 */
const nextMachine = async (slug, io) => {
  skip(`home: the tower project is already in ${nativePath(towerDir())}`);
  if (!(await catchUp('home'))) {
    skip(`home: the clone in ${nativePath(towerDir())} was not written to; settle it and run \`workkit setup\` again for the runner refresh, the install and the heal`);
    await discussions(slug, io);
    await pages(slug);
    return;
  }
  if ((await seedRunner()) === 0) await commitPush('chore(home): refresh the cloud brief runner');
  await install();
  await discussions(slug, io);
  await pages(slug);
  await heal();
};

/**
 * The home repo, its clone and its services. Unforced, a run with no
 * terminal prints what it would do; at one it asks, no the default. Forced
 * (`setup --home`) it asks nothing.
 * @param {boolean} [force]
 * @param {{stdin: object, stderr: object}} [io] the terminal the questions use, the process's own by default
 * @returns {Promise<boolean>} false only for a forced run that stopped before writing anything
 */
const setup = async (force = false, io) => {
  const done = !force;
  const who = await login();
  if (!who) {
    info('home: gh could not say who you are; run `gh auth login`, then `workkit setup` again to create the home repo');
    return done;
  }
  const repo = `${who}/${HOME_REPO_NAME}`;
  const home = nativePath(towerDir());
  if (!force && slug() !== repo) {
    if (!interactive(io)) {
      info(`home: no home repo is configured; \`workkit setup --home\` creates the private ${repo} and makes ${home} its clone`);
      return true;
    }
    if (!(await askYes(`Create the private home repo ${repo} and make ${home} its clone?`, 'n', io))) {
      skip('home: left as it is; `workkit setup` offers again');
      return true;
    }
  }
  const made = await ensureRepo(repo);
  if (made === 0) {
    ok(`home: created the private repo ${repo}`);
  } else if (made === 2) {
    skip(`home: ${repo} already exists; using it`);
  } else {
    warn(`home: could not create ${repo}; \`gh repo create ${repo} --private\` reports why`);
    return done;
  }
  // Neither 3 (something else at the path) nor 1 leaves anything safe to write.
  if ((await clone(repo)) !== 0) return done;
  await setSlug(repo);
  // Only an empty clone is seeded; one carrying the project is left as it is.
  if (empty()) await firstMachine(repo, io);
  else await nextMachine(repo, io);
  return true;
};

module.exports = { setup };
