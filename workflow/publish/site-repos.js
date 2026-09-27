#!/usr/bin/env node
// The roster the published site sweeps: the `owner/name` slugs this machine's
// board covers, read through the tower's own module, plus the home repo under
// `home`. Written to the home repo's default branch, never beside the public
// pages (`workflow/README.md` § Publishing the dashboard).
//
// Usage: node workflow/publish/site-repos.js <outfile> [workflow-home]

const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverRepos, readRoster } = require('../../tower/api/lib/repos');

/** Parse JSON from a file, or null when it is absent or unparseable. */
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The slug list. The home repo is named twice on purpose: in `repos` for its
 * queue, and as `home` for its Discussions, even with no clone on this machine.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default
 * @param {Function} [opts.exec] (cmd, args) => stdout: the git seam
 * @returns {{repos: string[], home: string|null}}
 * @throws when the roster could not be read, rather than composing an empty one
 */
const composeSlugs = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome || path.join(home, '.workkit');

  // An unreadable roster raises, so the caller keeps the published list; an
  // empty machine still writes `[]`.
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
 * Write the slug list, making the directory it goes in, unless what is already
 * there says the same thing. A publish is a commit, and a roster nobody changed
 * must not produce one a day.
 *
 * @param {string} outfile
 * @param {object} [opts] passed through to composeSlugs
 * @returns {boolean} whether the file was written
 * @throws whatever composeSlugs raises: the outfile is untouched
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
    process.stderr.write(`site-repos: ${err.message}; nothing was written\n`);
    process.exit(1);
  }
}
