// Tests for workflow/lib/ports.js: the processes listening on a TCP port and the end of one, the tower's port
// takeover. A real listener answers on this machine's own tools (lsof, or netstat on Windows); the Windows rows'
// near misses are held on every machine against a stand-in netstat, through the platform seam.

const net = require('net');
const {
  describe, test, expect, mkTmp, start, until, needs,
} = require('../lib/harness');
const { IS_WINDOWS, joinPath, stubToolJs } = require('../lib/platform');
const { kitUnder } = require('../lib/kit-under');
const { caught } = require('../lib/caught');
const { portPids, endPid } = require('../../workflow/lib/ports');

// Off Windows the read asks lsof alone.
const noPortTool = !IS_WINDOWS && needs('lsof');

/**
 * A child listening on a free port, as the harness `start()` handle, and the port it took. Written with
 * process.stdout rather than console.log, which paints a number under FORCE_COLOR. `ignoreTerm` gives it a SIGTERM
 * handler that does nothing: the listener only a forced end ends.
 * @param {boolean} [ignoreTerm]
 */
const listener = (ignoreTerm = false) => new Promise((resolve, reject) => {
  const handle = start(process.execPath, ['-e', [
    ignoreTerm ? "process.on('SIGTERM',()=>{});" : '',
    "const s=require('net').createServer();",
    "s.listen(0,'127.0.0.1',()=>process.stdout.write(`${s.address().port}\\n`));",
    'setInterval(()=>{},1000);',
  ].join('')]);
  handle.done.catch(reject);
  handle.child.stdout.on('data', () => {
    if (handle.stdout().includes('\n')) resolve({ ...handle, port: Number(handle.stdout().trim()) });
  });
});

/** Whether <child> has exited. */
const gone = (child) => child.exitCode !== null || child.signalCode !== null;

describe('ports.js: portPids', () => {
  test('a port a real listener holds answers with its pid, and a free one with none', { skip: noPortTool }, async () => {
    const server = net.createServer();
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    try {
      expect(await portPids(port), 'the pid holding the port, as a number').toEqual([process.pid]);
    } finally {
      await new Promise((resolve) => { server.close(resolve); });
    }
    expect(await portPids(port), 'nothing listens there now').toEqual([]);
  });

  test('on Windows the netstat rows give each listening pid once, by the port\'s whole suffix, and none for a free port', () => {
    // One pid on both stacks (one answer), a port this one is only a suffix or a prefix of, a connection whose
    // foreign port matches, and a UDP row; CRLF ends, as Windows prints them.
    const dir = mkTmp('lib-ports-');
    const rows = [
      '',
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:8693           0.0.0.0:0              LISTENING       4242',
      '  TCP    [::]:8693              [::]:0                 LISTENING       4242',
      '  TCP    127.0.0.1:18693        0.0.0.0:0              LISTENING       5151',
      '  TCP    0.0.0.0:86930          0.0.0.0:0              LISTENING       5252',
      '  TCP    10.0.0.5:51300         93.184.216.34:8693     ESTABLISHED     5353',
      '  UDP    0.0.0.0:8693           *:*                                    5454',
    ];
    stubToolJs(dir, 'netstat', `process.stdout.write(${JSON.stringify(rows.map((row) => `${row}\r\n`).join(''))});\n`);
    const env = { ...process.env, PATH: joinPath(dir, process.env.PATH) };
    const WINDOWS = { platform: 'win32' };
    expect(kitUnder(env, 'ports.js', 'portPids', [[8693, WINDOWS], [8694, WINDOWS]]), 'the one listener of 8693, and none of 8694').toEqual([[4242], []]);
  });
});

describe('ports.js: endPid', () => {
  test('the pid a port answered with is ended, the polite signal and the forced one alike, and a pid already gone is no error', { skip: noPortTool }, async () => {
    // The forced pass gets a child that ignores SIGTERM: one that dies on the polite signal would answer the same
    // whether the signal was carried or dropped.
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const forced = signal === 'SIGKILL';
      const { child, port, end } = await listener(forced);
      try {
        expect(await portPids(port), 'the child holds the port').toEqual([child.pid]);
        if (forced && !IS_WINDOWS) {
          // Only where a polite end exists: Windows has none for a windowless process and ends it on the first call.
          await endPid(child.pid, 'SIGTERM');
          expect(await until(() => gone(child), 2000), 'the polite signal left the stubborn listener alive').toBe(false);
        }
        await endPid(child.pid, signal);
        expect(await until(() => gone(child)), `${signal} ended it`).toBe(true);
        expect(await caught(() => endPid(child.pid, signal)), 'a second end of the gone pid').toBe(null);
      } finally {
        await end('SIGKILL');
      }
    }
  });
});
