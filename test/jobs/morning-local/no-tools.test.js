// Tests for jobs/morning.sh as this machine runs it, on a machine with none of
// the programs the shell morning leaned on: no jq, awk, sed, base64 or timeout,
// and a whole morning still runs every step. Stand-ins are `claude`, `gh` and
// the notifier alone; git and node are real.
// The shared prologue (world factory, job runner, the bare PATH) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { which } = require('../../lib/platform');
const {
  BRIEF_TITLE_PREFIX, cleanup, mkWorld, runJob, plantStaleRunner, subjects, REFRESH,
  SHELL_TOOLS, withoutTools, settle,
} = require('./helpers');

describe('jobs/morning (local): no jq, awk, sed, base64 or timeout', () => {
  test('a whole morning runs every step', async () => {
    const world = mkWorld({
      home: 'owner/private-home',
      dispatch: true,
      homeClone: true,
      posted: [{ title: `${BRIEF_TITLE_PREFIX}2026-08-17` }],
    });
    plantStaleRunner(world);
    const ranFile = path.join(world.root, 'morning-d.log');
    const script = path.join(world.workflowHome, 'morning.d', '10-a.sh');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, `#!/bin/bash\nprintf 'ran\\n' >> ${JSON.stringify(ranFile)}\n`, { mode: 0o755 });
    withoutTools(world);
    expect(SHELL_TOOLS.filter((tool) => which(tool, world.env.PATH)).join(','), 'the PATH holds none of the five').toBe('');

    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const logText = world.log();
    expect(fs.existsSync(world.nightlyLog), `the summaries ran: ${logText}`).toBeTruthy();
    expect(subjects(world.homeRemote).includes(REFRESH), `the runner was reconciled and pushed: ${logText}`).toBeTruthy();
    expect(world.dispatched().length, `the day was handed to the cloud: ${logText}`).toBe(1);
    expect(subjects(world.homeRemote).some((s) => /^chore\(home\): (sync the tower project|refresh the repo list)$/.test(s)),
      `the publish committed the repo list to the home repo: ${subjects(world.homeRemote).join(' | ')}`).toBeTruthy();
    expect(JSON.parse(world.marker() || '{}').lastBrief, `the marker read the board: ${logText}`).toBe('2026-08-17');
    expect(fs.existsSync(ranFile), `and the morning.d script ran: ${logText}`).toBeTruthy();
    await settle(world);
    cleanup(world.root);
  });
});
