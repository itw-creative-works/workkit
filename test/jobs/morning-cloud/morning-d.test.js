// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the owner's
// morning.d folder, which a runner never reads. The machine's own run of the
// folder is ../morning-local/morning-d.test.js.
// The shared prologue (world factory, job runner) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, runJob } = require('./helpers');

const cases = async () => {
  group('jobs/morning (cloud): the morning.d folder');

  await test('a cloud run does not read the folder, and names the skip', () => {
    const world = mkWorld();
    const ran = path.join(world.root, 'ran.log');
    const folder = path.join(world.workflowHome, 'morning.d');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '10-a.sh'), `#!/bin/bash\nprintf 'ran\\n' >> ${JSON.stringify(ran)}\n`, { mode: 0o755 });
    const res = runJob(world);
    assertEq(res.status, 0, `the cloud run went through: ${res.stderr}`);
    assert(!fs.existsSync(ran), 'the script did not run');
    const logFile = path.join(world.home, 'Library', 'Logs', 'claude-daily.log');
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    // A step that died on the way in also runs nothing: the gate is proved by
    // its own skip line, never by the silence of a crash.
    assert(!/unbound variable/.test(`${res.stderr}\n${logText}`), `nothing died on an unset name: ${res.stderr}\n${logText}`);
    const output = [res.stdout, res.stderr, logText].join('\n');
    assert(output.includes('morning.d: a runner owns no scripts folder; skipped'), `the step names its skip: ${output}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
