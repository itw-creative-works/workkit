// Tests for workflow/workkit.sh: the map (no arguments, help, every verb it
// lists, an unknown command) and the script itself.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath } = require('../../lib/platform');
const { CLI, cleanup, mkWorld, runCli } = require('./helpers');

const cases = async () => {
  group('workkit: the map');

  await test('no arguments print the map', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, []);
    assertEq(code, 0, 'exit 0');
    for (const word of ['usage: workkit', 'setup', 'setup --cloud', 'update', 'doctor', 'enable', 'decline', 'heal [repo]', 'note']) {
      assert(out.includes(word), `the map names ${word}, got: ${out}`);
    }
    cleanup(world.root);
  });

  await test('the map names every script verb with each of its subcommands, and state', () => {
    const world = mkWorld();
    const entries = runCli(world, []).out.split('\n').map((l) => l.trim());
    const verbs = [
      'ship items', 'ship release', 'ship watch', 'ship plan', 'ship publish', 'review covers', 'review mark',
      'triage mark', 'proof red', 'changelog lint', 'state [repo]',
    ];
    const missing = verbs.filter((v) => !entries.some((l) => l.startsWith(v)));
    assertEq(missing.join(', '), '', 'the map entries it lacks');
    cleanup(world.root);
  });

  await test('help prints the same map', () => {
    const world = mkWorld();
    assertEq(runCli(world, ['help']).out, runCli(world, []).out, 'no arguments IS help');
    cleanup(world.root);
  });

  await test('an unknown command prints usage on stderr and exits 1', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['dance']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('unknown command dance'), `names what it did not understand, got: ${err}`);
    assert(err.includes('usage: workkit'), 'and shows the map');
    assertEq(out, '', 'nothing on stdout');
    cleanup(world.root);
  });

  await test('it is executable and parses', () => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('workkit.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(CLI).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(CLI)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
