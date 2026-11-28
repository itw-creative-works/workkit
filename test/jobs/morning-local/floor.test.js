// Tests for jobs/morning.js as this machine runs it, under a Node below the
// kit's floor: the check runs first, so the morning says one line and does
// nothing else. The shared prologue (world factory) is ./helpers.js.

const fs = require('fs');
const {
  describe, test, expect, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { spawnSync } = require('../../lib/platform');
const { olderNode } = require('../../lib/node-fakes');
const {
  SCRIPT, cleanup, mkWorld, settle,
} = require('./helpers');

describe('jobs/morning (local): a Node below the floor', () => {
  test('the floor line and 1, with no step run, no log written and nothing sent', async () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const preload = olderNode('20.15.1', world.root);
    const res = spawnSync(process.execPath, ['-r', preload, SCRIPT, '--now'], {
      encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env,
    });
    expect(res.status, `the floor's code, stdout: ${res.stdout} stderr: ${res.stderr}`).toBe(1);
    expect(res.stderr, 'the one line').toBe('workkit: this Node is v20.15.1; the kit needs 22.22 or newer\n');
    expect(res.stdout, 'nothing on stdout').toBe('');
    expect(world.log(), 'no step ran to log anything').toBe('');
    expect(fs.existsSync(world.nightlyLog), 'the summaries never started').toBe(false);
    expect(world.calls().length, `nothing was sent: ${fmtCalls(world.calls())}`).toBe(0);
    expect(fmtCalls(world.ghCalls()), 'and GitHub was never asked').toBe('');
    expect(await settle(world), 'and nothing was announced').toBeFalsy();
    cleanup(world.root);
  });
});
