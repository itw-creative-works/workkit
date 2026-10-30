// A scratch bin holding a `workkit` that runs this checkout's workflow/workkit.sh,
// standing in for the ~/.local/bin link setup makes: what a skill's bare
// `workkit <verb>` line finds on PATH. Consumers: test/hooks/commit-gate/marker.test.js
// and test/hooks/capture-guard/user-level.test.js.

const path = require('path');
const { mkTmp } = require('./harness');
const { stubTool, shellPath } = require('./platform');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.sh');

/** A fresh scratch folder holding the one `workkit` command; returns the folder. */
const workkitBin = () => {
  const bin = mkTmp('workkit-bin-');
  stubTool(bin, 'workkit', ['#!/usr/bin/env bash', `exec bash "${shellPath(CLI)}" "$@"`]);
  return bin;
};

module.exports = { workkitBin };
