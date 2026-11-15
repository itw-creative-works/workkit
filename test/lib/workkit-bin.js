// A scratch bin holding a `workkit` that runs this checkout's workflow/workkit.sh,
// standing in for the ~/.local/bin link setup makes: what a skill's bare
// `workkit <verb>` line finds on PATH. Consumers: test/hooks/commit-gate/marker.test.js
// and test/hooks/capture-guard/user-level.test.js.
// `coreBin` is the other `workkit`, the workkit-core package's bin as npm links it
// for a repo on the package: what a member's `workkit test` script finds. Consumers:
// test/members.test.js, test/scripts/script-shell.test.js and test/scripts/red-proof.test.js.

const path = require('path');
const { mkTmp } = require('./harness');
const { stubTool, shellPath } = require('./platform');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.sh');
const CORE_BIN = path.join(__dirname, '..', '..', 'packages', 'core', 'bin', 'workkit.js');

/** A fresh scratch folder holding the one `workkit` command; returns the folder. */
const workkitBin = () => {
  const bin = mkTmp('workkit-bin-');
  stubTool(bin, 'workkit', ['#!/usr/bin/env bash', `exec bash "${shellPath(CLI)}" "$@"`]);
  return bin;
};

/** A fresh scratch folder holding a `workkit` that runs this checkout's package bin; returns the folder. */
const coreBin = () => {
  const bin = mkTmp('core-bin-');
  stubTool(bin, 'workkit', ['#!/usr/bin/env bash', `exec "${shellPath(process.execPath)}" "${shellPath(CORE_BIN)}" "$@"`]);
  return bin;
};

module.exports = { workkitBin, coreBin };
