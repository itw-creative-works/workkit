#!/usr/bin/env node
//
// The roster the published site sweeps: which repos its board covers.
//
// Nothing is baked into the site itself. The published dashboard reads GitHub
// live from the browser with the viewer's own token (issue #81) — every issue,
// every count, every summary — so the only thing it cannot work out for itself
// is which repositories this machine's board covers. That is a list of
// `owner/name` strings and nothing more: no titles, no bodies, no labels, no
// counts.
//
// It is written to the HOME REPO's default branch and never beside the pages
// (issue #110): Pages is public even from a private repo, and repo NAMES are
// themselves private when the repos are. Readers fetch it through the GitHub
// API — the browser with the viewer's token, the cloud brief with its own — and
// the only thing published beside the pages is which repo to ask.
//
// The list is read through the tower's own module, so the site sweeps exactly
// the repos the dashboard and the morning brief do; the home repo rides along
// under `home`, which is where the published summaries are read from.
//
// Usage:
//   node workflow/site-repos.js <outfile> [workflow-home]
//   composeSlugs({ workflowHome, exec })   // offline, against fixtures
//

const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverRepos, readRoster } = require('../tower/api/lib/repos');

/** Parse JSON from a file, or null when it is absent or unparseable. */
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The slug list.
 *
 * The home repo is named twice on purpose — once in `repos`, because its issues
 * are the cross-project queue and the board shows them, and once as `home`,
 * because the summaries are Discussions on that one repo and the site has to
 * know which it is. It is included even when its clone is not on this machine:
 * the site sweeps GitHub, not the disk.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git seam
 * @returns {{repos: string[], home: string|null}}
 * @throws when the roster could not be read, rather than composing an empty one
 */
const composeSlugs = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome || path.join(home, '.workkit');

  // A machine that registers nothing and a roster that cannot be READ compose
  // the same empty list, and only one of them is true (issue #116). The failure
  // is raised so the caller keeps whatever list is already published — the
  // readers believe this file, and an empty one tells them there is no board.
  // The genuinely empty machine still writes `[]`, which is what it has.
  const { status } = readRoster(workflowHome);
  if (status === 'unreadable') {
    throw new Error(`the roster at ${path.join(workflowHome, '.repos.json')} could not be read`);
  }

  const slugs = discoverRepos({ workflowHome, home, exec: opts.exec })
    .map((repo) => repo.slug)
    .filter((slug) => typeof slug === 'string' && slug.includes('/'));

  const settings = readJson(path.join(workflowHome, 'settings.json'));
  const site = (settings && settings.site) || {};
  const homeSlug = typeof site.repo === 'string' && site.repo.includes('/') ? site.repo : null;
  if (homeSlug && !slugs.includes(homeSlug)) slugs.push(homeSlug);

  return { repos: slugs, home: homeSlug };
};

/**
 * Write the slug list, making the directory it goes in — unless what is already
 * there says the same thing. A publish is a commit, and a roster nobody changed
 * must not produce one a day.
 *
 * @param {string} outfile
 * @param {object} [opts] passed through to composeSlugs
 * @returns {boolean} whether the file was written
 * @throws whatever composeSlugs raises — the outfile is untouched
 */
const writeSlugs = (outfile, opts = {}) => {
  const next = composeSlugs(opts);
  const previous = readJson(outfile);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return false;
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, `${JSON.stringify(next, null, 2)}\n`);
  return true;
};

module.exports = { composeSlugs, writeSlugs };

if (require.main === module) {
  const outfile = process.argv[2];
  if (!outfile) {
    process.stderr.write('usage: site-repos.js <outfile> [workflow-home]\n');
    process.exit(1);
  }
  try {
    writeSlugs(outfile, { workflowHome: process.argv[3] || process.env.WORKFLOW_HOME || undefined });
  } catch (err) {
    process.stderr.write(`site-repos: ${err.message} — nothing was written\n`);
    process.exit(1);
  }
}
