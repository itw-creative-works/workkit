#!/usr/bin/env node
/**
 * workflow/workkit.js: the one command, the front door to the engine. A Node
 * below the kit's floor gets one line and stops; any other runs main
 * (workkit/main.js) and ends with the code it answers. Written in syntax an
 * older Node still reads, so the floor's line prints there.
 * Usage: workkit <command> [args]   (`workkit help` is the map)
 */

const floor = require('./lib/floor');

const argv = process.argv.slice(2);
const below = floor.floorLine(process.version, floor.floorOf());

if (below) {
  process.stderr.write(`${below}\n`);
  process.exitCode = floor.floorCode(argv);
} else {
  // Both streams drained first, so a piped reader gets every line before the exit.
  const { drained } = require('./lib/say');
  require('./workkit/main').main(argv).then((code) => drained(process.stdout)
    .then(() => drained(process.stderr))
    .then(() => { process.exit(code); }));
}
