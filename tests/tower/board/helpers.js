//
// The shared prologue of the tower/api/lib/board suites, the `*.test.js`
// files beside this one, which test tower/api/lib/board.js (the cross-repo
// issue sweep) one concern each. A plain module, never a suite: the runner
// only loads files ending in `.test.js`.
//
// `gh` is the one thing that cannot be exercised for real here: a live call
// needs auth and the network, and the point of the seam is that the tower
// renders without either. So the exec seam takes a fake that answers the two
// commands the module issues, and every OTHER fact - the label vocabulary
// especially - comes from the real in-repo workflow/labels.json.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execError } = require('../../lib/gh');

const REPO = path.join(__dirname, '..', '..', '..');
const { fetchBoard, splitResponse, rateLimitReason, buildBoardQuery, labelGroups, LABELS_FILE, PAGE_SIZE, MAX_OPEN_ISSUES, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, REPOS_PER_REQUEST } = require(path.join(REPO, 'tower', 'api', 'lib', 'board.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-board-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const labels = (...names) => ({ nodes: names.map((name) => ({ name })) });
const assignees = (...logins) => ({ nodes: logins.map((login) => ({ login })) });

const issue = (number, extra = {}) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: labels(),
  assignees: assignees(),
  ...extra,
});

/** A fake `gh`: the version probe passes, graphql answers with the given payload. */
const fakeGh = (payload, { versionFails = false, graphqlError = null, calls = [] } = {}) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === '--version') {
    if (versionFails) throw execError('spawnSync gh ENOENT', { code: 'ENOENT', status: null });
    return 'gh version 2.0.0\n';
  }
  if (graphqlError) throw graphqlError;
  return JSON.stringify(payload);
};

const ROSTER = [
  { name: 'workkit', path: '/x/workkit', slug: 'ITW-Creative-Works/workkit' },
  { name: '.dotfiles', path: '/x/.dotfiles', slug: 'alice/.dotfiles' },
];

module.exports = {
  REPO, fetchBoard, splitResponse, rateLimitReason, buildBoardQuery, labelGroups, LABELS_FILE,
  PAGE_SIZE, MAX_OPEN_ISSUES, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, REPOS_PER_REQUEST,
  mkTmp, cleanup, labels, assignees, issue, fakeGh, ROSTER,
};
