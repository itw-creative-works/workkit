// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the owner's
// morning.d folder, which a runner never reads. The machine's own run of the
// folder is ../morning-local/morning-d.test.js.
// The shared prologue (world factory, job runner) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, mkWorld, runJob } = require('./helpers');

describe('jobs/morning (cloud): the morning.d folder', () => {
  test('a cloud run does not read the folder, and names the skip', () => {
    const world = mkWorld();
    const ran = path.join(world.root, 'ran.log');
    const folder = path.join(world.workflowHome, 'morning.d');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '10-a.sh'), `#!/bin/bash\nprintf 'ran\\n' >> ${JSON.stringify(ran)}\n`, { mode: 0o755 });
    const res = runJob(world);
    expect(res.status, `the cloud run went through: ${res.stderr}`).toBe(0);
    expect(!fs.existsSync(ran), 'the script did not run').toBeTruthy();
    const logFile = path.join(world.home, 'Library', 'Logs', 'claude-daily.log');
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    // A step that died on the way in also runs nothing: the gate is proved by
    // its own skip line, never by the silence of a crash.
    expect(!/unbound variable/.test(`${res.stderr}\n${logText}`), `nothing died on an unset name: ${res.stderr}\n${logText}`).toBeTruthy();
    const output = [res.stdout, res.stderr, logText].join('\n');
    expect(output.includes('morning.d: a runner owns no scripts folder; skipped'), `the step names its skip: ${output}`).toBeTruthy();
    cleanup(world.root);
  });
});
