#!/usr/bin/env node
// workflow/review/mark.js (`workkit review mark [full]`): record that the
// workkit:review skill ran on this repo, keyed on the repo root, and print the
// marker's path; `full` (the whole panel ran) writes the full-panel marker
// covers.js reads as well. The paths are the ones the hooks read.

const { repoRoot } = require('../lib/git');
const { sayAs } = require('../lib/say');
const { writeMarker } = require('../lib/lock');
const { home } = require('../lib/records');
const { reviewMarkerPath, reviewFullMarkerPath } = require('../../hooks/mods/markers.js');

const say = sayAs('review-marker');

/**
 * Write the review marker, and with `full` the full-panel marker after it,
 * each path printed once written.
 * @param {string[]} argv the verb's arguments
 * @returns {Promise<number>} the exit code
 */
const main = async ([arg = '']) => {
  const root = repoRoot(process.cwd());
  if (root === null) {
    say('not inside a git repository, so there is no repo to key the marker to.');
    return 1;
  }
  if (arg !== '' && arg !== 'full') {
    say(`unknown argument ${arg} (usage: workkit review mark [full])`);
    return 1;
  }
  const paths = arg === 'full' ? [reviewMarkerPath, reviewFullMarkerPath] : [reviewMarkerPath];
  for (const pathOf of paths) {
    const marker = await pathOf(root, home());
    writeMarker(marker, home());
    process.stdout.write(`${marker}\n`);
  }
  return 0;
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
