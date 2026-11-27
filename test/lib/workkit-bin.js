// A scratch bin holding a `workkit` that runs this checkout's workflow/workkit.js
// under the running node, standing in for the ~/.local/bin link setup makes: what
// a skill's bare `workkit <verb>` line finds on PATH. Consumers: test/hooks/commit-gate/marker.test.js,
// test/hooks/capture-guard/user-level.test.js and test/scripts/supervise.test.js.
// `coreBin` is the other `workkit`, the workkit-core package's bin as npm links it
// for a repo on the package: what a member's `workkit test` script finds. Consumers:
// test/members.test.js, test/scripts/script-shell.test.js and test/scripts/red-proof.test.js.

const path = require('path');
const { mkTmp } = require('./harness');
const { stubTool, shellPath } = require('./platform');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.js');
const CORE_BIN = path.join(__dirname, '..', '..', 'packages', 'core', 'bin', 'workkit.js');

/** A fresh scratch folder holding a `workkit` that runs <program> under the running node; returns the folder. */
const nodeBin = (prefix, program) => {
  const bin = mkTmp(prefix);
  stubTool(bin, 'workkit', ['#!/usr/bin/env bash', `exec "${shellPath(process.execPath)}" "${shellPath(program)}" "$@"`]);
  return bin;
};

/** A fresh scratch folder holding the one `workkit` command; returns the folder. */
const workkitBin = () => nodeBin('workkit-bin-', CLI);

/** A fresh scratch folder holding a `workkit` that runs this checkout's package bin; returns the folder. */
const coreBin = () => nodeBin('core-bin-', CORE_BIN);

module.exports = { workkitBin, coreBin };
