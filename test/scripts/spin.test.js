// Tests for workflow/lib/spin.js, the Node spinner: `spin(message, run)` around a real child program, in a node of
// its own, since where the frames land and when the line clears is the wiring under test. The driver and the
// held call are test/lib/spin-call.js; the frames and the one line at each voice are test/hooks/twins.test.js's.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { SYSTEM_PATH, homeEnv } = require('../lib/platform');
const { PTY, atTerminal } = require('../lib/identity');
const {
  driveSpin, spinArgs, framesIn, CLEAR, ANSWER, MESSAGE,
} = require('../lib/spin-call');

/** A scratch home's env with no spin, quiet or color setting carried in, <vars> beside it. */
const worldEnv = (vars = {}) => homeEnv(mkTmp('spin-home-'), { PATH: SYSTEM_PATH, ...vars });

/** Asserts <before> is frames alone, at least <least> of them, each opening on its carriage return. */
const onlyFrames = (before, least, what) => {
  const pieces = before.split('\r').length - 1;
  expect(framesIn(before).length >= least, `${what}: frames were drawn while the call ran, got: ${JSON.stringify(before)}`).toBe(true);
  expect(framesIn(before).length, `${what}: and nothing else came before the clear, got: ${JSON.stringify(before)}`).toBe(pieces);
};

describe('spin: the frames forced', () => {
  test('frames reach stderr while the call runs, the clear comes after the last of them and before the caller goes on, and stdout holds the call\'s output alone', async () => {
    const res = await driveSpin('call', { env: worldEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
    const tail = `${CLEAR}after\n`;
    expect(res.stderr.endsWith(tail), `the line cleared, then the caller's own line, got: ${JSON.stringify(res.stderr)}`).toBe(true);
    onlyFrames(res.stderr.slice(0, -tail.length), 2, 'stderr');
    expect(res.stdout, 'the call\'s stdout carries its answer and no frame').toBe(ANSWER);
    expect(res.status, `the driver ends clean, stderr: ${res.stderr}`).toBe(0);
  });

  test('what run hands back comes back: the same value, a promise of the same value, and a rejection as a rejection', async () => {
    const res = await driveSpin('answer', { env: worldEnv({ WORKKIT_SPIN: '1' }) });
    expect(res.answers, `the driver's reading of what spin handed back, stderr: ${res.stderr}`).toEqual({
      sync: true, thenable: true, resolved: true, rejected: 'the promise broke',
    });
  });

  test('an error run throws reaches the caller, the line already cleared', async () => {
    const res = await driveSpin('throws', { env: worldEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
    const tail = `${CLEAR}caught: the call broke\n`;
    expect(res.stderr.endsWith(tail), `the clear, then the caller's catch, got: ${JSON.stringify(res.stderr)}`).toBe(true);
    onlyFrames(res.stderr.slice(0, -tail.length), 2, 'stderr');
  });

  test('a run that hands back a promise: the line is cleared before the caller sees its value, or its rejection', async () => {
    for (const [mode, line] of [['resolves', 'value: the value'], ['rejects', 'caught: the promise broke']]) {
      const res = await driveSpin(mode, { env: worldEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
      const tail = `${CLEAR}${line}\n`;
      expect(res.stderr.endsWith(tail), `${mode}: the clear, then what the caller saw, got: ${JSON.stringify(res.stderr)}`).toBe(true);
      onlyFrames(res.stderr.slice(0, -tail.length), 2, mode);
    }
  });

  test('a process whose last work was a spin ends by itself', async () => {
    const res = await driveSpin('last', { env: worldEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
    expect(res.timedOut, `nothing held the process open, stderr: ${JSON.stringify(res.stderr)}`).toBe(false);
    expect(res.status, 'and it exits 0').toBe(0);
  });

});

describe('spin: under a logged command, the terminal by name', () => {
  /** A logged command's variables: the raw log's path, and the terminal device <terminal> names when given. */
  const loggedEnv = (vars = {}) => worldEnv({ WK_COMMAND_LOGGED: path.join(mkTmp('spin-log-'), 'setup.log.raw'), ...vars });

  test('WK_COMMAND_TERMINAL naming a file: the frames and the clear land in that file, and none reach stderr', async () => {
    const terminal = path.join(mkTmp('spin-device-'), 'tty');
    const res = await driveSpin('call', { env: loggedEnv({ WORKKIT_SPIN: '1' }), frames: 2, terminal });
    expect(res.drawn.endsWith(CLEAR), `the device ends on the clear, got: ${JSON.stringify(res.drawn)}`).toBe(true);
    onlyFrames(res.drawn.slice(0, -CLEAR.length), 2, 'the device');
    expect(res.stderr, 'stderr, the stream the log reads, holds the caller\'s line alone').toBe('after\n');
    expect(res.stdout, 'stdout is the call\'s').toBe(ANSWER);
  });

  test('WK_COMMAND_TERMINAL unset: the frames forced by WORKKIT_SPIN=1 and the clear go to stderr', async () => {
    const res = await driveSpin('call', { env: loggedEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
    const tail = `${CLEAR}after\n`;
    expect(res.stderr.endsWith(tail), `the clear, then the caller's line, got: ${JSON.stringify(res.stderr)}`).toBe(true);
    onlyFrames(res.stderr.slice(0, -tail.length), 2, 'stderr');
  });

  test('a WK_COMMAND_TERMINAL that does not open draws as if unset: forced frames on stderr, else the one line there', async () => {
    const terminal = path.join(mkTmp('spin-device-'), 'no-such-folder', 'tty');
    const forced = await driveSpin('call', { env: loggedEnv({ WORKKIT_SPIN: '1', WK_COMMAND_TERMINAL: terminal }), frames: 2 });
    const tail = `${CLEAR}after\n`;
    expect(forced.stderr.endsWith(tail), `forced: the clear, then the caller's line, got: ${JSON.stringify(forced.stderr)}`).toBe(true);
    onlyFrames(forced.stderr.slice(0, -tail.length), 2, 'forced');
    const plain = await driveSpin('call', { env: loggedEnv({ WK_COMMAND_TERMINAL: terminal }) });
    expect(plain.stderr, 'unforced and no terminal: the one line, then the caller\'s').toBe(`⏳ ${MESSAGE}...\nafter\n`);
  });
});

describe('spin: the one line', () => {
  const LINE = `⏳ ${MESSAGE}...\n`;

  test('with no terminal and WORKKIT_SPIN unset, and with WORKKIT_SPIN=0: the one line on stderr and no frame', async () => {
    for (const [what, vars] of [['unset', {}], ['WORKKIT_SPIN=0', { WORKKIT_SPIN: '0' }]]) {
      const res = await driveSpin('call', { env: worldEnv(vars) });
      expect(res.stderr, `${what}: the line, then the caller's`).toBe(`${LINE}after\n`);
      expect(res.stdout, `${what}: stdout is the call's`).toBe(ANSWER);
    }
  });

  test('at a terminal, WORKKIT_SPIN=0 still prints the one line and draws no frame', { skip: !PTY && 'no `script` here to give the spin a terminal' }, async () => {
    const dir = mkTmp('spin-tty-');
    const { args, release } = spinArgs('call', dir);
    fs.writeFileSync(release, '');
    const tty = atTerminal([process.execPath, ...args], { env: worldEnv({ WORKKIT_SPIN: '0' }), cwd: dir, dir });
    // The terminal turns each newline into a return and a newline; BSD script opens on its echo of the empty stdin's end.
    const shown = tty.terminal.replace(/^\^D\x08\x08/, '').replace(/\r\n/g, '\n');
    expect(shown, 'the one line and the caller\'s, nothing drawn').toBe(`${LINE}after\n`);
    expect(tty.stdout, 'stdout is the call\'s').toBe(ANSWER);
  });

  test('with { line: false }: no line where no frames are drawn, and the frames still drawn where they are forced', async () => {
    const off = await driveSpin('unlined', { env: worldEnv() });
    expect(off.stderr, 'off a terminal: the caller\'s line alone').toBe('after\n');
    expect(off.stdout, 'stdout is the call\'s').toBe(ANSWER);
    const forced = await driveSpin('unlined', { env: worldEnv({ WORKKIT_SPIN: '1' }), frames: 2 });
    const tail = `${CLEAR}after\n`;
    expect(forced.stderr.endsWith(tail), `forced: the clear, then the caller's line, got: ${JSON.stringify(forced.stderr)}`).toBe(true);
    onlyFrames(forced.stderr.slice(0, -tail.length), 2, 'forced');
  });

  test('under QUIET=1 nothing is printed, and the call still answers', async () => {
    const res = await driveSpin('call', { env: worldEnv({ QUIET: '1' }) });
    expect(res.stderr, 'the caller\'s line alone').toBe('after\n');
    expect(res.stdout, 'stdout is the call\'s').toBe(ANSWER);
  });
});
