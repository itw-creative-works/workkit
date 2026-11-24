// Tests for `workkit checkpoint safe`, the marker a clean checkpoint leaves for its
// session. Each case runs the verb through the kit's entry under a scratch kit
// home, the session handed to the child or left out of its env by the case itself.
// The shared prologue is ./workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../lib/harness');
const { NODE_DIR, joinPath, samePath } = require('../lib/platform');
const { agedFile } = require('../lib/workflow-home');
const { cleanup, mkWorld, runCli } = require('./workkit-cli/helpers');

const NO_SESSION = 'checkpoint-marker: no session to mark (CLAUDE_CODE_SESSION_ID is not set)\n';

const lines = (text) => text.split('\n').filter(Boolean);

// `workkit <args>` with node on PATH and the session given, or with `undefined` none
// at all: Node leaves an undefined value out of the child's env, whatever this process holds.
const checkpoint = (world, args, session) => runCli(world, args, {
  env: { PATH: joinPath(NODE_DIR, world.env.PATH), CLAUDE_CODE_SESSION_ID: session },
});

// The folder the markers land in, spelled out here rather than asked of the kit.
const markerDir = (world) => path.join(world.workflowHome, 'markers', 'claude-checkpoint-marker');
const markerFiles = (world) => (fs.existsSync(markerDir(world)) ? fs.readdirSync(markerDir(world)).sort() : []);

// The marker's time: one whole number of milliseconds, a line end after it allowed.
const markedAt = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  expect(/^\d+\n?$/.test(text), `the marker holds one whole number, got: ${JSON.stringify(text)}`).toBeTruthy();
  return Number(text);
};

describe('workkit checkpoint safe: the marker', () => {
  test('with a session set it writes the marker under the kit home, prints its path, and exits 0, the file holding the time it was written', () => {
    const world = mkWorld();
    const before = Date.now();
    const { code, out, err } = checkpoint(world, ['checkpoint', 'safe'], 'sess42');
    const after = Date.now();
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    const file = path.join(world.workflowHome, 'markers', 'claude-checkpoint-marker', 'sess42');
    const printed = lines(out);
    expect(printed.length, `one line on stdout, got: ${out}`).toBe(1);
    expect(samePath(printed[0], file, process.platform), `the printed path is ${file}, got: ${printed[0]}`).toBeTruthy();
    const at = markedAt(file);
    expect(at >= before && at <= after, `a time in milliseconds within the run, ${before} to ${after}, got: ${at}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a second run for the same session leaves one file, rewritten to hold the one time of the second run', () => {
    const world = mkWorld();
    const first = checkpoint(world, ['checkpoint', 'safe'], 'sess42');
    expect(first.code, `the first run exits 0, got: ${first.out}${first.err}`).toBe(0);
    const before = Date.now();
    const second = checkpoint(world, ['checkpoint', 'safe'], 'sess42');
    const after = Date.now();
    expect(second.code, `the second run exits 0, got: ${second.out}${second.err}`).toBe(0);
    expect(JSON.stringify(markerFiles(world)), 'one marker for the one session').toBe(JSON.stringify(['sess42']));
    // One whole number within the second run: an appended time fails the shape or the bound.
    const at = markedAt(path.join(markerDir(world), 'sess42'));
    expect(at >= before && at <= after, `a time within the second run, ${before} to ${after}, got: ${at}`).toBeTruthy();
    cleanup(world.root);
  });

  test('two sessions get two files, and an id\'s every character but a letter or a digit lands as _', () => {
    const world = mkWorld();
    for (const session of ['alpha1', 'ab-12.x']) {
      const { code, out, err } = checkpoint(world, ['checkpoint', 'safe'], session);
      expect(code, `${session} exits 0, got: ${out}${err}`).toBe(0);
    }
    expect(JSON.stringify(markerFiles(world)), 'one file per session, ab-12.x as ab_12_x').toBe(JSON.stringify(['ab_12_x', 'alpha1']));
    cleanup(world.root);
  });
});

describe('workkit checkpoint safe: no session', () => {
  for (const [what, session] of [['unset', undefined], ['empty', '']]) {
    test(`CLAUDE_CODE_SESSION_ID ${what}: nothing written, the one line on stderr, exit 1`, () => {
      const world = mkWorld();
      const { code, out, err } = checkpoint(world, ['checkpoint', 'safe'], session);
      expect(code, `exit 1, got: ${out}${err}`).toBe(1);
      expect(out, 'nothing on stdout').toBe('');
      expect(err, 'the no-session line').toBe(NO_SESSION);
      expect(JSON.stringify(markerFiles(world)), 'no checkpoint marker').toBe('[]');
      cleanup(world.root);
    });
  }
});

describe('workkit checkpoint safe: the sweep', () => {
  test('a checkpoint marker older than the keep is gone after the verb runs for another session', () => {
    const world = mkWorld();
    const old = agedFile(path.join(markerDir(world), 'old-session'), 8);
    const { code, out, err } = checkpoint(world, ['checkpoint', 'safe'], 'sess42');
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(fs.existsSync(old), 'the 8-day-old marker is swept').toBe(false);
    expect(JSON.stringify(markerFiles(world)), 'the new marker alone is left').toBe(JSON.stringify(['sess42']));
    cleanup(world.root);
  });
});
