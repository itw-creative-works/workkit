// A stateful GitHub behind a PATH `gh`, for a script that reads back what it
// wrote (the public pairing's intake, mirror and close): every repo's issues,
// labels and comments live in one JSON file each call rewrites. `gh issue` is
// served; a command, flag or field it does not know exits 1 naming it (gh-world-answers.js).

const fs = require('fs');
const path = require('path');
const { mkTmp } = require('./harness');
const { writeGh } = require('./gh-stub');

/**
 * A `gh` on its own bin folder answering from `repos`, each slug's issues as
 * `{ number, title, body, author, labels: [names], state, comments: [{ author, body }] }`
 * (author `octocat`, state `open` by default).
 * @param {object} repos - `owner/name` to its issue list
 * @param {{fail?: Array<{slug: string, number: number, op: string}>}} [opts] - each entry
 *   refuses the first label edit (`op` 'labels') or comment (`op` 'comment') of that issue once, as GitHub's 502
 * @returns {{binDir: string, issue: Function, issues: Function, writes: Function, calls: Function}}
 *   `issue(slug, n)` and `issues(slug)` read the state now; `writes()` lists each
 *   change as `{ slug, number, op }` in order; `calls()` every argv the stub got
 */
const mkGhWorld = (repos, { fail = [] } = {}) => {
  const dir = mkTmp('gh-world-');
  const stateFile = path.join(dir, 'state.json');
  const full = (i) => ({
    title: '', body: '', author: 'octocat', labels: [], state: 'open', comments: [], ...i,
  });
  const state = {
    repos: Object.fromEntries(Object.entries(repos).map(([slug, list]) => [slug, list.map(full)])),
    writes: [],
    calls: [],
    fail,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  writeGh(binDir, { answer: { module: require.resolve('./gh-world-answers'), name: 'answerWorld' }, config: stateFile });
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return {
    binDir,
    dir,
    issues: (slug) => read().repos[slug] || [],
    issue: (slug, n) => (read().repos[slug] || []).find((i) => i.number === n),
    writes: () => read().writes,
    calls: () => read().calls,
  };
};

module.exports = { mkGhWorld };
