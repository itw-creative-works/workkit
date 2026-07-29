#!/usr/bin/env node
//
// The published site's data — the board snapshot the home repo bakes in.
//
// The dashboard is normally LIVE: it reads the tower API on this machine. A
// published copy has no tower behind it, so what it ships with instead is one
// sweep of the same board the API serves, taken at publish time and written
// beside the built pages. Same libs as the tower and the morning brief, so the
// three cannot tell different stories about the same issues.
//
// It is written only when the tower project's config/workkit.json says
// `site.board: true` — publish.sh holds that gate. Pages is public even on a
// private repo, so
// baking every issue title of every repo into the site is the owner's call, and
// the default is off.
//
// A sweep that FAILED is written as a failure (`ok: false` with its reason),
// never as an empty board — the same doctrine the brief runs under, for the
// same reason: an empty board and a board nobody could read are opposite facts.
//
// Usage:
//   node workflow/site-data.js <outfile>       // write the snapshot
//   composeSnapshot({ workflowHome, exec })    // offline, against fixtures
//

const fs = require('fs');
const path = require('path');

const { discoverRepos } = require('../tower/api/lib/repos');
const { fetchBoard } = require('../tower/api/lib/board');

/**
 * The snapshot: who is on the roster, and every issue across them.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the libs that resolve it
 * @param {string} [opts.generatedAt] ISO stamp, injectable so the suite is not a clock test
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git/gh seam
 * @returns {object} the snapshot the site ships with
 */
const composeSnapshot = (opts = {}) => {
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const { exec } = opts;

  let repos;
  try {
    repos = discoverRepos({ workflowHome: opts.workflowHome, home: opts.home, exec });
  } catch (err) {
    return {
      generatedAt,
      repos: [],
      board: { ok: false, reason: `the roster read failed: ${err.message}`, issues: [] },
    };
  }

  return {
    generatedAt,
    repos: repos.map((repo) => ({ name: repo.name, slug: repo.slug })),
    board: fetchBoard(repos, exec ? { exec } : {}),
  };
};

/** The snapshot without its stamp — what "did anything actually change?" asks. */
const substance = (snapshot) => JSON.stringify({ ...snapshot, generatedAt: null });

/**
 * Write the snapshot, making the directory it goes in — UNLESS the only thing
 * that would change is the stamp. A publish is a commit, and a board nobody
 * touched must not produce one every day just because time passed.
 *
 * @param {string} outfile
 * @param {object} [opts] passed through to composeSnapshot
 * @returns {boolean} whether the file was written
 */
const writeSnapshot = (outfile, opts = {}) => {
  const next = composeSnapshot(opts);
  try {
    if (substance(JSON.parse(fs.readFileSync(outfile, 'utf8'))) === substance(next)) return false;
  } catch {
    // No previous snapshot, or one nobody can read: write this one.
  }
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, `${JSON.stringify(next, null, 2)}\n`);
  return true;
};

module.exports = { composeSnapshot, writeSnapshot };

if (require.main === module) {
  const outfile = process.argv[2];
  if (!outfile) {
    process.stderr.write('usage: site-data.js <outfile>\n');
    process.exit(1);
  }
  writeSnapshot(outfile);
}
