// Tests for jobs/morning.sh as this machine runs it: the morning.d folder, the
// user's own scripts run as the job's sixth step, each under its own log header.
// The shared prologue (world factory, job runner) is ./helpers.js; a runner's
// skip of the folder is ../morning-cloud/morning-d.test.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, alive, pidIn } = require('../../lib/harness');
const { stubTool, which } = require('../../lib/platform');
const { skipUnlessDarwin, cleanup, mkWorld, runJob } = require('./helpers');

// The job bounds a step only where a `timeout` exists, so the timeout case
// needs a real one to hand the short bound to.
const REAL_TIMEOUT = which('timeout') || which('gtimeout');

// A script in <dir>/morning.d that appends its name to `order` and prints a
// line the log can be searched for; `body` replaces that, `mode` its bits.
const plant = (dir, name, { order, body, mode = 0o755 } = {}) => {
  const folder = path.join(dir, 'morning.d');
  fs.mkdirSync(folder, { recursive: true });
  const lines = body || [`printf '%s\\n' ${name} >> ${JSON.stringify(order)}`, `echo "output of ${name}"`];
  fs.writeFileSync(path.join(folder, name), `#!/bin/bash\n${lines.join('\n')}\n`, { mode });
  fs.chmodSync(path.join(folder, name), mode);
};

const ran = (order) => (fs.existsSync(order) ? fs.readFileSync(order, 'utf8').split('\n').filter(Boolean) : []);

const headerAt = (log, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^--- .+ morning\\.d/${escaped} ---$`, 'm').exec(log);
  return m ? m.index : -1;
};

// Every line the run said anywhere: the log, the screen, the error stream.
const allLines = (world, res) => [world.log(), res.stdout, res.stderr].join('\n').split('\n');

// A line naming the script that is not its block header: the warning.
const warnedAbout = (world, res, name) => allLines(world, res)
  .filter((l) => l.includes(name) && !/^--- .+ ---$/.test(l));

describe('jobs/morning (local): the morning.d folder', { skip: skipUnlessDarwin() }, () => {
  test('two executable scripts run in name order after the brief status, each under its own header', () => {
    const world = mkWorld();
    const order = path.join(world.root, 'order.log');
    // Written out of order, so the run order is the names', not the files'.
    plant(world.workflowHome, '20-b.sh', { order });
    plant(world.workflowHome, '10-a.sh', { order });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(ran(order).join(','), 'both ran, in name order').toBe('10-a.sh,20-b.sh');

    const logText = world.log();
    const a = headerAt(logText, '10-a.sh');
    const b = headerAt(logText, '20-b.sh');
    expect(a >= 0 && b >= 0, `each script has its own header: ${logText}`).toBeTruthy();
    const outA = logText.indexOf('output of 10-a.sh');
    const outB = logText.indexOf('output of 20-b.sh');
    expect(a < outA && outA < b && b < outB, `each output sits under its own header: ${logText}`).toBeTruthy();
    const status = logText.indexOf('marker: ');
    expect(status >= 0 && status < a, `the brief status comes first: ${logText}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a failing script is warned about by name, the next still runs, the exit code unchanged', () => {
    const world = mkWorld();
    const order = path.join(world.root, 'order.log');
    plant(world.workflowHome, '10-a.sh', {
      body: [`printf '%s\\n' 10-a.sh >> ${JSON.stringify(order)}`, 'exit 1'],
    });
    plant(world.workflowHome, '20-b.sh', { order });
    const res = runJob(world);
    expect(res.status, `a script's failure is not the morning's: ${res.stderr}`).toBe(0);
    expect(ran(order).join(','), 'the next script still ran').toBe('10-a.sh,20-b.sh');
    expect(warnedAbout(world, res, '10-a.sh').length > 0, `a warn line names it: ${world.log()}\n${res.stderr}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a script past the timeout is ended and warned about, and the next still runs', { skip: !REAL_TIMEOUT && 'no timeout or gtimeout on this machine to bound a script with' }, () => {
    const world = mkWorld();
    const order = path.join(world.root, 'order.log');
    // The job's own bound is minutes; this `timeout` hands the slow script two
    // seconds and passes every other step, the next script included, through untouched.
    const stub = [
      '#!/bin/bash',
      `case "$*" in */morning.d/10-slow.sh) shift; exec ${JSON.stringify(REAL_TIMEOUT)} 2 "$@" ;; esac`,
      `exec ${JSON.stringify(REAL_TIMEOUT)} "$@"`,
    ];
    stubTool(path.join(world.root, 'bin'), 'timeout', stub);
    stubTool(path.join(world.home, '.local', 'bin'), 'timeout', stub);
    // exec, so the recorded pid is the sleep itself and nothing outlives it.
    const pidFile = path.join(world.root, 'slow.pid');
    plant(world.workflowHome, '10-slow.sh', { body: [`echo $$ > ${JSON.stringify(pidFile)}`, 'echo started', 'exec sleep 30'] });
    plant(world.workflowHome, '20-b.sh', { order });

    const res = runJob(world);
    expect(res.status, `a script's timeout is not the morning's failure: ${res.stderr}`).toBe(0);
    expect(ran(order).join(','), 'the next script still ran').toBe('20-b.sh');
    expect(warnedAbout(world, res, '10-slow.sh').length > 0, `a warn line names it: ${world.log()}\n${res.stderr}`).toBeTruthy();
    // A loaded machine can end the script before it records its pid: ended either way.
    const pid = pidIn(pidFile);
    if (pid > 0) expect(!alive(pid), `the slow script ${pid} was ended, not waited out`).toBeTruthy();
    cleanup(world.root);
  });

  test('a non-executable file in the folder is skipped without a line', () => {
    const world = mkWorld();
    const order = path.join(world.root, 'order.log');
    plant(world.workflowHome, '10-a.sh', { order, mode: 0o644 });
    plant(world.workflowHome, '20-b.sh', { order });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(ran(order).join(','), 'only the executable one ran').toBe('20-b.sh');
    const named = allLines(world, res).filter((l) => l.includes('10-a.sh'));
    expect(named.length, `no line names the skipped file: ${named.join('\n')}`).toBe(0);
    cleanup(world.root);
  });

  test('no folder: no line and no error', () => {
    const world = mkWorld();
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const named = allLines(world, res).filter((l) => l.includes('morning.d'));
    expect(named.length, `nothing mentions the folder: ${named.join('\n')}`).toBe(0);
    cleanup(world.root);
  });

  test('a <message> run does not read the folder', () => {
    const world = mkWorld();
    const order = path.join(world.root, 'order.log');
    plant(world.workflowHome, '10-a.sh', { order });
    const res = runJob(world, ['hello']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(ran(order).length, 'the script did not run').toBe(0);
    expect(headerAt(world.log(), '10-a.sh'), `and no header was logged: ${world.log()}`).toBe(-1);
    // The same world on a scheduled run does run it, so the skip is the
    // message's doing and not the fixture's.
    runJob(world);
    expect(ran(order).join(','), 'a scheduled run of the same world runs it').toBe('10-a.sh');
    cleanup(world.root);
  });
});
