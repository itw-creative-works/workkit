/**
 * jobs/morning/cloud-machine.js: the brief on a GitHub Actions runner. First
 * the machine it has to pretend to be (a settings file and a roster, which
 * the composers read from ~/.workkit), then compose, send and post. Every
 * failure is a red run: the Actions log is the delivery (jobs/README.md § The
 * brief runs in the cloud).
 * Usage: const { cloudBrief } = require('./cloud-machine');
 */

const fs = require('fs');
const path = require('path');
const { ready } = require('../../workflow/lib/discussions');
const { gitIn } = require('../../workflow/lib/git');
const { isFile } = require('../../workflow/lib/lock');
const { nativePath } = require('../../workflow/lib/platform');
const { spawnSync } = require('../../workflow/lib/run');
const { homeSlug } = require('../../workflow/lib/settings');
const { spin } = require('../../workflow/lib/spin');
const { error } = require('../../workflow/lib/voice');
const { writeWhole } = require('../../workflow/lib/write');
const { WORKKIT_DIR } = require('../../workflow/user-dir');
const { publishBrief } = require('./brief-publish');
const { compose, send } = require('./brief');
const { chomp } = require('../../hooks/mods/text.js');
const { rosterFile } = require('../../hooks/mods/log.js');

/** A gh read's stdout as a capture holds it, its stderr sent away; '' when it said nothing. */
const ghRead = (message, args) => {
  const res = spin(message, () => spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }), { line: false });
  return chomp(res.stdout);
};

/** The slugs a `data/repos.json` text lists, the strings of its `repos`. */
const slugsOf = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const repos = parsed?.repos;
  const listed = Array.isArray(repos) ? repos : Object.values(repos && typeof repos === 'object' ? repos : {});
  return listed.filter((each) => typeof each === 'string' && each);
};

/**
 * The slug list the published dashboard sweeps, `data/repos.json` on the home
 * repo's default branch, which is asked for: a hardcoded `main` is a 404 and
 * a silently home-only board.
 * @param {string} home the home slug
 * @returns {{branch: string, slugs: string[]}}
 */
const sweepList = (home) => {
  if (!ready()) return { branch: 'main', slugs: [] };
  const branch = ghRead(`reading ${home}`, ['api', `repos/${home}`, '-q', '.default_branch']) || 'main';
  const content = ghRead('reading the slug list', ['api', `repos/${home}/contents/data/repos.json?ref=${branch}`, '-q', '.content']);
  return { branch, slugs: slugsOf(Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8')) };
};

/**
 * A synthetic checkout per slug, the minimum `discoverRepos` reads: the
 * committed opt-in and an origin. Nothing else is faked, so health reads zeroes.
 * @param {string} dir the machine folder
 * @param {string[]} slugs
 * @returns {string[]} the checkouts made
 */
const checkoutsOf = (dir, slugs) => {
  const entries = [];
  for (const slug of slugs) {
    if (!slug.includes('/')) continue;
    const repo = path.join(dir, 'cloud', slug);
    fs.mkdirSync(path.join(repo, WORKKIT_DIR), { recursive: true });
    writeWhole(path.join(repo, WORKKIT_DIR, 'settings.json'), '{\n  "enabled": true\n}\n');
    if (!fs.existsSync(path.join(repo, '.git'))
      && spawnSync('git', ['init', '-q', repo], { stdio: 'ignore', windowsHide: true }).status !== 0) continue;
    gitIn(repo, ['remote', 'remove', 'origin'], { stdio: 'ignore', windowsHide: true });
    gitIn(repo, ['remote', 'add', 'origin', `https://github.com/${slug}.git`], { stdio: 'ignore', windowsHide: true });
    entries.push(repo);
  }
  return entries;
};

/**
 * The machine a runner pretends to be: the settings file, from
 * GITHUB_REPOSITORY when there is none, and the roster the brief sweeps.
 * @param {object} run the morning's run
 * @returns {boolean} false when there is no home repo, its line said
 */
const cloudMachine = (run) => {
  const { note } = run.notes;
  const settings = path.join(run.wkDir, 'settings.json');
  const roster = rosterFile(run.wkDir);
  if (!isFile(settings)) {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) {
      error(`GITHUB_REPOSITORY is unset and ${nativePath(settings)} does not exist, so there is no home repo to sweep or publish to`);
      return false;
    }
    fs.mkdirSync(run.wkDir, { recursive: true });
    writeWhole(settings, `${JSON.stringify({ version: 1, site: { repo } }, null, 2)}\n`);
    note(`settings: wrote ${nativePath(settings)} for ${repo}`);
  }
  const home = homeSlug(run.wkDir);
  if (!home) {
    error(`${nativePath(settings)} names no home repo (.site.repo), so there is no board to sweep or publish to`);
    return false;
  }
  const { branch, slugs: listed } = sweepList(home);
  // The home repo alone rather than an empty roster: its issues are the
  // cross-project queue, and an empty board would say nothing is waiting.
  if (listed.length === 0) note(`roster: no slug list on ${home} (${branch} data/repos.json); sweeping the home repo alone`);
  const slugs = listed.includes(home) ? listed : [...listed, home];
  const entries = checkoutsOf(run.wkDir, slugs);
  const repos = Object.fromEntries(entries.map((entry) => [entry, 'enabled']));
  writeWhole(roster, `${JSON.stringify({ version: 1, repos }, null, 2)}\n`);
  note(`roster: ${entries.length} repos in ${nativePath(roster)}`);
  return true;
};

/**
 * `run(...)` with GH_TOKEN set to WORKKIT_POST_TOKEN, the one call that speaks
 * to this repo with the workflow's own token; an empty one is left alone,
 * since gh reads an empty GH_TOKEN as a token.
 * @param {() => Promise<*>} run
 * @returns {Promise<*>}
 */
const asPoster = async (run) => {
  const saved = process.env.GH_TOKEN;
  if (process.env.WORKKIT_POST_TOKEN) process.env.GH_TOKEN = process.env.WORKKIT_POST_TOKEN;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = saved;
  }
};

/**
 * The brief on a runner: the machine, compose, send, post.
 * @param {object} run the morning's run
 * @returns {Promise<number|undefined>} the code to stop the morning on, or nothing when it posted or had nothing to post
 */
const cloudBrief = async (run) => {
  const { note, noteSkip, noteWarn } = run.notes;
  if (!cloudMachine(run)) return 1;
  const payload = compose();
  if (payload.status !== 0) {
    error(`brief-payload exit ${payload.status}: ${payload.err}`);
    return payload.status;
  }
  if (payload.err) noteWarn(payload.err);
  const { status, response, err } = send(payload.message);
  if (status !== 0) {
    // The status and what the CLI said, never the payload or half a digest.
    error(`the digest send exit ${status}: ${err}`);
    return status;
  }
  // The digest never reaches this log: it summarizes private repos, and an
  // Actions log could be made public. The log needs only proof of life.
  note(`digest: ${response.split('\n')[0]} (${Array.from(response).length} bytes)`);
  const bodyFile = path.join(run.scratch, 'brief.md');
  const { code, line } = await asPoster(() => publishBrief({ response, markFile: run.markFile, bodyFile }));
  if (code === 1) noteWarn(line);
  else if (code === 2) noteSkip(line);
  else note(line);
  // 2 is nothing to post, an ordinary morning; 1 did not land, the red run.
  return code === 1 ? 1 : undefined;
};

module.exports = { cloudBrief };
