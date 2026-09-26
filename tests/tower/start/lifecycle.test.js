//
// Tests for tower/start.sh: the lifecycle of the two halves (both start, one
// interrupt ends both, either ending takes the other with it) and the port
// a previous instance holds, replaced rather than collided with.
// The shared prologue (the wrapper runner, the stub halves, the poll, the pty run) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  mkTmp, cleanup, alive, until, readPid, start, standIn, pidTest,
} = require('./helpers');

const run = async () => {
  group('tower/start: one command, both processes');

  await pidTest('both halves start, and one interrupt ends both', async () => {
    const dir = mkTmp();
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
    const dir = mkTmp();
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
    // The failure this pins (#138 review, B2): with the filter DOWNSTREAM in a
    // pipeline, the pid the down-taker watched was the pipeline's wrapper,
    // which lives until every writer of the pipe has closed. This stub's
    // leftover child holds that pipe, so the wrapper never ended and the tower
    // sat half-up forever instead of coming down.
    const dir = mkTmp();
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
    const dir = mkTmp();
    const kidPid = path.join(dir, 'kid.pid');
    // The app stub puts a child between itself and the sleeper, the way npm
    // and omega put children between the wrapper and the real server.
    const child = start(dir,
      'exec sleep 30',
      `bash -c "echo \\$\\$ > '${kidPid}'; exec sleep 30" & wait`);
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

  await test('a previous instance on a tower port is replaced, not collided with', async () => {
    // A stand-in for a leftover server: a child of THIS test listening on an
    // ephemeral port, handed to the wrapper as the tower's port.
    const listener = standIn(
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stand-in took a port');

    const dir = mkTmp();
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
    // The failure this pins (#97 review, B1): reclaim's wait loop always
    // returned 0, so a TERM-resistant listener rode out the 5s deadline and
    // the fresh server died EADDRINUSE with nothing explaining why.
    const listener = standIn(
      "process.on('SIGTERM',()=>{});const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stubborn stand-in took a port');

    const dir = mkTmp();
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
