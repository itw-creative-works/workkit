//
// Tests for tower/start.sh: the two halves' lifecycle (one interrupt or either
// ending ends both) and a held port, replaced not collided with. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, endTree,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const {
  cleanup, alive, until, pidIn, pidOnSight, start, standIn, STARTING, skipOnMsysPid,
} = require('./helpers');

// A half stub that puts a child between itself and the sleeper, the way npm
// and omega put children between the wrapper and the real server.
const grandchild = (pidFile) => `bash -c "echo \\$\\$ > '${pidFile}'; exec sleep 30" & wait`;

// The pids recorded so far by the grandchild stubs writing <files>.
const recorded = (files) => files.map(pidIn).filter(Boolean);

describe('tower/start: one command, both processes', () => {
  test('both halves start, and one interrupt ends both', { skip: skipOnMsysPid() }, async () => {
    const dir = mkTmp('tower-start-');
    const apiPid = path.join(dir, 'api.pid');
    const appPid = path.join(dir, 'app.pid');
    const tower = start(dir,
      `echo $$ > '${apiPid}'; exec sleep 30`,
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      expect(await until(() => pidIn(apiPid) > 0 && pidIn(appPid) > 0), 'both commands were started').toBeTruthy();
      const pids = [pidIn(apiPid), pidIn(appPid)];
      expect(pids.every(alive), 'and both are running').toBeTruthy();

      tower.child.kill('SIGTERM');
      expect(await until(() => pids.every((pid) => !alive(pid))), 'one interrupt took both down').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('either half ending takes the other with it - nothing lingers half-up', { skip: skipOnMsysPid() }, async () => {
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const tower = start(dir,
      'sleep 0.3',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      expect(await until(() => pidIn(appPid) > 0), 'the surviving half started').toBeTruthy();
      const pid = pidIn(appPid);
      expect(await until(() => !alive(pid)), 'and ended when its sibling did').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'the wrapper itself ended too').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a half that exits leaving a background child behind still ends the other', { skip: skipOnMsysPid() }, async () => {
    // With the filter downstream in a pipeline, the pid to watch is not the
    // pipeline's wrapper, which lives until every writer of the pipe has closed;
    // this stub's leftover child holds that pipe.
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const tower = start(dir,
      'sleep 15 & exit 0',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      expect(await until(() => pidIn(appPid) > 0), 'the surviving half started').toBeTruthy();
      const pid = pidIn(appPid);
      expect(await until(() => !alive(pid)), 'and ended when its sibling exited').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'the wrapper itself ended too').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('ending a half ends its whole tree - a grandchild server dies with it', { skip: skipOnMsysPid() }, async () => {
    const dir = mkTmp('tower-start-');
    const kidPid = path.join(dir, 'kid.pid');
    const tower = start(dir, 'exec sleep 30', grandchild(kidPid));
    try {
      expect(await until(() => pidIn(kidPid) > 0), 'the grandchild started').toBeTruthy();
      const pid = pidIn(kidPid);
      tower.child.kill('SIGTERM');
      expect(await until(() => !alive(pid)), 'and died with the tree, not orphaned').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a signal the instant a grandchild appears ends every tree promptly, ten times over', { skip: skipOnMsysPid() }, async () => {
    // The signal goes the moment the app's grandchild records itself, while a
    // trap may still sit behind a foreground wait: by the time the wrapper has
    // exited, every tree must already be gone. Both halves carry a grandchild,
    // so the case holds whichever half spawns first.
    for (let round = 1; round <= 10; round += 1) {
      const dir = mkTmp('tower-start-');
      const kids = [path.join(dir, 'api-kid.pid'), path.join(dir, 'app-kid.pid')];
      const tower = start(dir, grandchild(kids[0]), grandchild(kids[1]));
      try {
        const pid = await pidOnSight(kids[1]);
        tower.child.kill('SIGTERM');
        expect(pid > 0, `round ${round}: the app's grandchild started`).toBeTruthy();
        expect(await until(() => tower.child.exitCode !== null || tower.child.signalCode !== null), `round ${round}: the wrapper never exited`).toBeTruthy();
        expect(recorded(kids).every((kid) => !alive(kid)),
          `round ${round}: every grandchild was gone when the wrapper exited, none orphaned`).toBeTruthy();
      } finally {
        await tower.end('SIGKILL');
        recorded(kids).forEach((kid) => endTree(kid, 'SIGKILL'));
        cleanup(dir);
      }
    }
  });

  test('a previous instance on a tower port is replaced, not collided with', async (t) => {
    // A stand-in for a leftover server: a child of this test listening on an
    // ephemeral port, handed to the wrapper as the tower's port.
    const listener = standIn(
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    t.after(() => listener.end('SIGKILL'));
    expect(await until(() => listener.stdout().trim().length > 0), 'the stand-in took a port').toBeTruthy();
    const port = listener.stdout();

    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      expect(await until(() => listener.child.exitCode !== null || listener.child.signalCode !== null),
        'the wrapper ended it before starting its own').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'and the run itself completed').toBeTruthy();
      expect(tower.child.exitCode, 'cleanly').toBe(0);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a listener that ignores the polite signal is escalated, not collided with', async (t) => {
    // A TERM-resistant listener must not ride out the 5s deadline and leave the
    // fresh server dying EADDRINUSE with nothing explaining why.
    const listener = standIn(
      "process.on('SIGTERM',()=>{});const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    t.after(() => listener.end('SIGKILL'));
    expect(await until(() => listener.stdout().trim().length > 0), 'the stubborn stand-in took a port').toBeTruthy();
    const port = listener.stdout();

    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      expect(await until(() => listener.child.exitCode !== null || listener.child.signalCode !== null),
        'the wrapper ended it anyway - the escalation exists').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'and the run completed').toBeTruthy();
      expect(tower.child.exitCode, 'cleanly, on the freed port').toBe(0);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a signal before either half has spawned is a clean exit with no error line',
    { skip: IS_WINDOWS && 'Windows sends bash no TERM its trap can answer' }, async () => {
      // The signal goes on the tower's first line, before it has started a half,
      // with no port to reclaim: the run must end there, spawning nothing into
      // the fifo folder its cleanup already removed.
      const dir = mkTmp('tower-start-');
      const halves = [path.join(dir, 'api.pid'), path.join(dir, 'app.pid')];
      const tower = start(dir,
        `echo $$ > '${halves[0]}'; exec sleep 30`,
        `echo $$ > '${halves[1]}'; exec sleep 30`,
        '');
      const out = tower.output;
      let signalled = false;
      tower.child.stdout.on('data', () => {
        if (!signalled && out().split('\n').some((line) => STARTING.test(line))) { signalled = true; tower.child.kill('SIGTERM'); }
      });
      let closed = false;
      tower.child.on('close', () => { closed = true; });
      try {
        expect(await until(() => signalled), 'the tower said it was starting').toBeTruthy();
        expect(await until(() => tower.child.exitCode !== null || tower.child.signalCode !== null), 'the wrapper ended on the signal').toBeTruthy();
        await until(() => closed);
        expect(`${tower.child.exitCode}/${tower.child.signalCode}`, 'with status 0, its own exit rather than the signal\'s').toBe('0/null');
        const errors = out().split('\n').filter((line) => line.trim() && !STARTING.test(line));
        expect(errors.join('\n'), 'and it printed no error line, only that it was starting').toBe('');
        // A half spawned late would still be writing its pid file; give it time.
        expect(!(await until(() => halves.some((file) => fs.existsSync(file)), 300)), 'nor spawned a half after the signal').toBeTruthy();
      } finally {
        await tower.end('SIGKILL');
        cleanup(dir);
      }
    });
});
