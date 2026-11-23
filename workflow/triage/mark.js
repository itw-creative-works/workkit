#!/usr/bin/env node
// workflow/triage/mark.js (`workkit triage mark`): record that a workkit:triage
// drain is under way and print the marker's path. safety:capture-guard reads
// the marker at the same path (triageMarkerPath in hooks/mods/markers.js) before
// it opens `.workkit/capture.md`. The anchor is the repo root, or the home
// folder outside every repo, the one the guard derives from the capture path.

const { repoRoot } = require('../lib/git');
const { writeMarker } = require('../lib/lock');
const { home } = require('../lib/records');
const { shellEnvOf, triageMarkerPath } = require('../../hooks/mods/markers.js');
const { homeOf } = require('../../hooks/mods/log.js');

/**
 * Write the triage marker for the anchor and print its path.
 * @returns {Promise<number>} the exit code
 */
const main = async () => {
  const anchor = repoRoot(process.cwd()) ?? homeOf(shellEnvOf(process.env, process.platform));
  const marker = await triageMarkerPath(anchor, home());
  writeMarker(marker, home());
  process.stdout.write(`${marker}\n`);
  return 0;
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
