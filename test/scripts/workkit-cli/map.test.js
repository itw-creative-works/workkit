// Tests for workflow/workkit.sh: the map (no arguments, help, every verb it
// lists, an unknown command) and the script itself.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath } = require('../../lib/platform');
const { CLI, cleanup, mkWorld, runCli } = require('./helpers');

describe('workkit: the map', () => {
  test('no arguments print the map', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, []);
    expect(code, 'exit 0').toBe(0);
    for (const word of ['usage: workkit', 'setup', 'setup --cloud', 'update', 'doctor', 'enable', 'decline', 'heal [repo]', 'note']) {
      expect(out.includes(word), `the map names ${word}, got: ${out}`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('the map names every script verb with each of its subcommands, and state', () => {
    const world = mkWorld();
    const entries = runCli(world, []).out.split('\n').map((l) => l.trim());
    const verbs = [
      'ship items', 'ship release', 'ship watch', 'ship plan', 'ship publish', 'ship cut', 'ship deploy', 'review covers', 'review mark',
      'triage mark', 'proof red', 'changelog lint', 'state [repo]',
    ];
    const missing = verbs.filter((v) => !entries.some((l) => l.startsWith(v)));
    expect(missing.join(', '), 'the map entries it lacks').toBe('');
    cleanup(world.root);
  });

  test('help prints the same map', () => {
    const world = mkWorld();
    expect(runCli(world, ['help']).out, 'no arguments IS help').toBe(runCli(world, []).out);
    cleanup(world.root);
  });

  test('an unknown command prints usage on stderr and exits 1', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['dance']);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('unknown command dance'), `names what it did not understand, got: ${err}`).toBeTruthy();
    expect(err.includes('usage: workkit'), 'and shows the map').toBeTruthy();
    expect(out, 'nothing on stdout').toBe('');
    cleanup(world.root);
  });

  test('it is executable and parses', async (t) => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) await t.test('workkit.sh carries the executable bit', { skip: NO_EXEC_BIT });
    else expect((fs.statSync(CLI).mode & 0o111) !== 0, 'the executable bit is set').toBeTruthy();
    expect(spawnSync(BASH, [...NO_RC, '-n', shellPath(CLI)], { encoding: 'utf8' }).status, 'bash -n is clean').toBe(0);
  });
});
