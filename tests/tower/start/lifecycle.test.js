//
// Tests for tower/start.sh: the two halves' lifecycle (one interrupt or either
// ending ends both) and a held port, replaced not collided with. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const { elapsedUntil } = require('../../lib/process');
const {
  cleanup, alive, until, readPid, pidIn, pidOnSight, start, standIn, collect, STARTING, pidTest,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

// A half stub that puts a child between itself and the sleeper, the way npm
// and omega put children between the wrapper and the real server.
const grandchild = (pidFile) => `bash -c "echo \\$\\$ > '${pidFile}'; exec sleep 30" & wait`;

// The pids recorded so far by the grandchild stubs writing <files>.
const recorded = (files) => files.map(pidIn).filter(Boolean);

const run = async () => {
  group('tower/start: one command, both processes');

  await pidTest('both halves start, and one interrupt ends both', async () => {
    const dir = mkTmp('tower-start-');
    const apiPid = path.join(dir, 'api.pid');
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      `echo $$ > '${apiPid}'; exec sleep 30`,
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(apiPid) && fs.existsSync(appPid)), 'both commands were started');
      const pids = [readPid(apiPid), readPid(appPid)];
      assert(pids.every(alive), 'and both are running');

      child.kill('SIGTERM');
      assert(await until(() => pids.every((pid) => !alive(pid))), 'one interrupt took both down');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await pidTest('either half ending takes the other with it - nothing lingers half-up', async () => {
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      'sleep 0.3',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(appPid)), 'the surviving half started');
      const pid = readPid(appPid);
      assert(await until(() => !alive(pid)), 'and ended when its sibling did');
      assert(await until(() => child.exitCode !== null), 'the wrapper itself ended too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await pidTest('a half that exits leaving a background child behind still ends the other', async () => {
    // With the filter downstream in a pipeline, the pid to watch is not the
    // pipeline's wrapper, which lives until every writer of the pipe has closed;
    // this stub's leftover child holds that pipe.
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      'sleep 15 & exit 0',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(appPid)), 'the surviving half started');
      const pid = readPid(appPid);
      assert(await until(() => !alive(pid)), 'and ended when its sibling exited');
      assert(await until(() => child.exitCode !== null), 'the wrapper itself ended too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await pidTest('ending a half ends its whole tree - a grandchild server dies with it', async () => {
    const dir = mkTmp('tower-start-');
    const kidPid = path.join(dir, 'kid.pid');
    const child = start(dir, 'exec sleep 30', grandchild(kidPid));
    try {
      assert(await until(() => fs.existsSync(kidPid)), 'the grandchild started');
      const pid = readPid(kidPid);
      child.kill('SIGTERM');
      assert(await until(() => !alive(pid)), 'and died with the tree, not orphaned');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await pidTest('a signal the instant a grandchild appears ends every tree promptly, ten times over', async () => {
    // The signal goes the moment the app's grandchild records itself, and the
    // trees must be gone well inside a second: a trap held behind a foreground
    // wait still ends them, just late. Both halves carry a grandchild, so the
    // case holds whichever half spawns first.
    for (let round = 1; round <= 10; round += 1) {
      const dir = mkTmp('tower-start-');
      const kids = [path.join(dir, 'api-kid.pid'), path.join(dir, 'app-kid.pid')];
      const child = start(dir, grandchild(kids[0]), grandchild(kids[1]));
      try {
        const pid = await pidOnSight(kids[1]);
        child.kill('SIGTERM');
        assert(pid > 0, `round ${round}: the app's grandchild started`);
        const took = await elapsedUntil(() => recorded(kids).every((kid) => !alive(kid)));
        assert(took !== Infinity, `round ${round}: every grandchild died with its tree, none orphaned`);
        assert(took < 800, `round ${round}: and within 800 ms of the signal, not ${took} ms`);
      } finally {
        child.kill('SIGKILL');
        recorded(kids).forEach((kid) => { try { process.kill(kid, 'SIGKILL'); } catch {} });
        cleanup(dir);
      }
    }
  });

  await test('a previous instance on a tower port is replaced, not collided with', async () => {
    // A stand-in for a leftover server: a child of this test listening on an
    // ephemeral port, handed to the wrapper as the tower's port.
    const listener = standIn(
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stand-in took a port');

    const dir = mkTmp('tower-start-');
    const child = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      assert(await until(() => listener.exitCode !== null || listener.signalCode !== null),
        'the wrapper ended it before starting its own');
      assert(await until(() => child.exitCode !== null), 'and the run itself completed');
      assertEq(child.exitCode, 0, 'cleanly');
    } finally {
      child.kill('SIGKILL');
      listener.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a listener that ignores the polite signal is escalated, not collided with', async () => {
    // A TERM-resistant listener must not ride out the 5s deadline and leave the
    // fresh server dying EADDRINUSE with nothing explaining why.
    const listener = standIn(
      "process.on('SIGTERM',()=>{});const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stubborn stand-in took a port');

    const dir = mkTmp('tower-start-');
    const child = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      assert(await until(() => listener.exitCode !== null || listener.signalCode !== null, 15000),
        'the wrapper ended it anyway - the escalation exists');
      assert(await until(() => child.exitCode !== null, 15000), 'and the run completed');
      assertEq(child.exitCode, 0, 'cleanly, on the freed port');
    } finally {
      child.kill('SIGKILL');
      listener.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await testUnless(IS_WINDOWS, 'Windows sends bash no TERM its trap can answer')(
    'a signal before either half has spawned is a clean exit with no error line',
    async () => {
      // The signal goes on the tower's first line, before it has started a half,
      // with no port to reclaim: the run must end there, spawning nothing into
      // the fifo folder its cleanup already removed.
      const dir = mkTmp('tower-start-');
      const halves = [path.join(dir, 'api.pid'), path.join(dir, 'app.pid')];
      const child = start(dir,
        `echo $$ > '${halves[0]}'; exec sleep 30`,
        `echo $$ > '${halves[1]}'; exec sleep 30`,
        '', { capture: true });
      const out = collect(child);
      let signalled = false;
      child.stdout.on('data', () => {
        if (!signalled && out().split('\n').some((line) => STARTING.test(line))) { signalled = true; child.kill('SIGTERM'); }
      });
      let closed = false;
      child.on('close', () => { closed = true; });
      try {
        assert(await until(() => signalled), 'the tower said it was starting');
        assert(await until(() => child.exitCode !== null || child.signalCode !== null), 'the wrapper ended on the signal');
        await until(() => closed, 3000);
        assertEq(`${child.exitCode}/${child.signalCode}`, '0/null', 'with status 0, its own exit rather than the signal\'s');
        const errors = out().split('\n').filter((line) => line.trim() && !STARTING.test(line));
        assertEq(errors.join('\n'), '', 'and it printed no error line, only that it was starting');
        // A half spawned late would still be writing its pid file; give it time.
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        assert(halves.every((file) => !fs.existsSync(file)), 'nor spawned a half after the signal');
      } finally {
        child.kill('SIGKILL');
        cleanup(dir);
      }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
