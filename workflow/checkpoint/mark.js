#!/usr/bin/env node
// workflow/checkpoint/mark.js (`workkit checkpoint safe`): record that a
// workkit:checkpoint run put every item on the board, keyed by the session
// (CLAUDE_CODE_SESSION_ID), and print the marker's path. The marker holds the
// time it was written in milliseconds; a harness reads it, the kit nowhere.

const { sayAs } = require('../lib/say');
const { writeMarker } = require('../lib/lock');
const { home } = require('../lib/records');
const { checkpointMarkerPath } = require('../../hooks/mods/markers.js');

const say = sayAs('checkpoint-marker');

/**
 * Write the session's checkpoint marker and print its path.
 * @returns {Promise<number>} the exit code
 */
const main = async () => {
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  if (!session) {
    say('no session to mark (CLAUDE_CODE_SESSION_ID is not set)');
    return 1;
  }
  const marker = checkpointMarkerPath(session, home());
  writeMarker(marker, home(), String(Date.now()));
  process.stdout.write(`${marker}\n`);
  return 0;
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
