//
// Tests for workflow/workkit.sh: the map (no arguments, help, an unknown command)
// and the script itself.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath } = require('../../lib/platform');
const { CLI, cleanup, mkWorld, runCli } = require('./helpers');

const run = async () => {
  group('workkit: the map');

  await test('no arguments print the map', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, []);
    assertEq(code, 0, 'exit 0');
    for (const word of ['usage: workkit', 'setup', 'update', 'doctor', 'enable', 'decline', 'heal [repo]', 'note']) {
      assert(out.includes(word), `the map names ${word}, got: ${out}`);
    }
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

module.exports = run;

if (require.main === module) selfRun(run);
