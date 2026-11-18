// workflow/ship/triggers.js: whether a workflow file's top-level `on:` names an
// event, by triggers.awk beside it: the one Node caller of that rule, shared by
// the CI watch (ship/watch.js) and the release job (.github/scripts/ci-release.js).
// Usage: const { listensTo } = require('./triggers');

const path = require('path');
const { spawnSync } = require('../lib/run');

const TRIGGERS = path.join(__dirname, 'triggers.awk');

/**
 * Whether the workflow file's top-level `on:` names the event.
 * @param {string} file the workflow file
 * @param {string} event `push`, `pull_request`, `release`...
 * @returns {boolean}
 */
const listensTo = (file, event) => spawnSync('awk', ['-v', `ev=${event}`, '-f', TRIGGERS, file], { stdio: 'ignore', windowsHide: true }).status === 0;

module.exports = { listensTo };
