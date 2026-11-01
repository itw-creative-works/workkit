/**
 * safety:commit-gate judged through the hooks module over a real scratch repo:
 * preCommitVerdict over commitFacts (hooks/mods/commit-gate.js) built on
 * bashFacts (hooks/mods/guards.js) from the real machine's io
 * (workflow/lib/io.js), as the pre-commit judge builds them. Consumers:
 * test/hooks/commit-gate/{first-commit,marker}.test.js,
 * test/scripts/prove.test.js and script-shell.test.js.
 */

const { mods, textOf } = require('./mods-inputs');
const { ioIn } = require('../../workflow/lib/io');

// A run that never started, as $.process.run answers a program it could not spawn.
const NOT_STARTED = (argv) => ({
  exitCode: null, stdout: '', stderr: `spawn ${argv[0]} ENOENT`, isStdoutTruncated: false, isStderrTruncated: false, isStarted: false,
});

/**
 * The pre-commit verdict on what <repo> has staged, in a session whose
 * variables are <env> (the workflow home holds the markers and records): `deny` the block
 * or null, `context` the stand-down notice as text, '' for none. A run whose argv
 * `unstarted` answers true for never starts; every other run is real.
 */
const gateOn = async (repo, env, { unstarted = () => false } = {}) => {
  const io = ioIn(env);
  const run = async (argv, init) => (unstarted(argv) ? NOT_STARTED(argv) : io.run(argv, init));
  // The root as the pre-commit judge is handed it: git's own spelling of it.
  const root = await io.top(repo);
  const g = mods('guards').bashFacts({ ...io, run }, env, { command: '', cwd: root });
  const v = await mods('commit-gate').preCommitVerdict(mods('commit-gate').commitFacts(g, root));
  return {
    deny: v && typeof v.deny === 'string' ? v.deny : null,
    context: v && v.context !== undefined ? textOf(v.context) : '',
  };
};

module.exports = { gateOn, ioIn };
