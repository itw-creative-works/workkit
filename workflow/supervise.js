#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/supervise.js: `workkit supervise -- <command> [args...]`, any command
// run the way the root `npm test` runs: detached under the supervisor, which reads
// it (lib/detach.js), its output in the repo's run log and tailed here. One
// supervised run per repo at a time; the command runs in the caller's folder.

const { repoRoot } = require('./lib/git');
const { run } = require('./lib/runs');
const { runHere } = require('./lib/attach');
const { bodyEnd } = require('./lib/body');
const { runPaths, LogsDirError } = require('./lib/run-paths');
const { sayAs } = require('./lib/say');

const USAGE = 'usage: workkit supervise -- <command> [args...]';
const BODY = '--body';

const say = sayAs('supervise');

/** The detached run, `--body -- <command> [args...]`: the command's own code, and its last line `supervise: exit <code>`. */
const body = async (argv) => {
  bodyEnd('supervise');
  return runHere(argv, null, false);
};

/**
 * The call: the command run detached, checked by the root's tests.check (a
 * frozen run exits 124, a look at an unclear one 125 with the run going on).
 * @param {string[]} argv `-- <command> [args...]`, or `--body -- <command> [args...]`
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  if (argv[0] === BODY) return body(argv.slice(2));
  if (argv[0] !== '--' || argv.length < 2) {
    console.error(USAGE);
    return 2;
  }
  const root = repoRoot(process.cwd());
  if (root === null) {
    say('not inside a git repository');
    return 1;
  }
  let paths;
  try {
    paths = await runPaths(root, 'run');
  } catch (err) {
    if (!(err instanceof LogsDirError)) throw err;
    console.error(err.message);
    return 1;
  }
  const done = await run({ ...paths, root, argv: [process.execPath, __filename, BODY, ...argv] });
  if (done.held !== null) {
    say(`a supervised run is already running (pid ${done.held}); its output is in ${paths.log}`);
    return 1;
  }
  return done.rc;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
