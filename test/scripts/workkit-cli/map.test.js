// Tests for workflow/workkit.js: the map (no arguments, every verb it lists).
// The shared prologue is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const {
  cleanup, mkWorld, runCli, lines,
} = require('./helpers');

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
    const entries = lines(runCli(world, []).out);
    const verbs = [
      'ship items', 'ship release', 'ship watch', 'ship plan', 'ship publish', 'ship cut', 'ship deploy', 'review covers', 'review mark',
      'triage mark', 'checkpoint safe', 'proof red', 'changelog lint', 'state [repo]',
    ];
    const missing = verbs.filter((v) => !entries.some((l) => l.startsWith(v)));
    expect(missing.join(', '), 'the map entries it lacks').toBe('');
    cleanup(world.root);
  });
});
