// Tests for workflow/lib/flows.js, the terminal questions in Node: the terminal test, the yes or no question, the
// press Enter to open step and the poll, each handed its own streams (test/lib/io-streams.js). Every answer's words
// and keys, the opener's choice and the first frames drawn are test/hooks/twins.test.js's.

const path = require('path');
const {
  describe, test, expect, mkTmp, before, after, until,
} = require('../lib/harness');
const {
  SYSTEM_PATH, stubTool, joinPath, homeEnv,
} = require('../lib/platform');
const { recordArgv, readArgv } = require('../lib/argv-log');
const { ioOf } = require('../lib/io-streams');
const {
  drivePoll, secondsOf, CLEAR, POLL_SECONDS,
} = require('../lib/spin-call');

const {
  interactive, askYes, enterToOpen, poll,
} = require(path.join(__dirname, '..', '..', 'workflow', 'lib', 'flows.js'));

// A poll interval no case waits out: only a key moves the poll on.
const NEVER = 3600;

// The in-process polls draw on this suite's own stderr: the one line, never frames. The frames are drawn in a node of its own.
let spinWas;
before(() => { spinWas = process.env.WORKKIT_SPIN; process.env.WORKKIT_SPIN = '0'; });
after(() => { if (spinWas === undefined) delete process.env.WORKKIT_SPIN; else process.env.WORKKIT_SPIN = spinWas; });

/** A check that answers each of <answers> in turn, counting how often it was asked. */
const checkOf = (answers) => {
  const check = async () => answers[Math.min(check.asked++, answers.length - 1)];
  check.asked = 0;
  return check;
};

describe('flows: interactive', () => {
  test('a stdin that is a terminal is interactive, a pipe is not', async () => {
    expect(await interactive(ioOf('', { tty: true }).io), 'the terminal').toBe(true);
    expect(await interactive(ioOf('').io), 'the pipe').toBe(false);
  });
});

describe('flows: askYes', () => {
  test('it asks with its default in the hint, and Enter takes the default', async () => {
    for (const [fallback, hint, answer] of [['n', '[y/N]', false], ['y', '[Y/n]', true]]) {
      const { io, said } = ioOf('\n');
      expect(await askYes('Create the home repo?', fallback, io), `Enter under the default ${fallback}`).toBe(answer);
      expect(said(), `the question on the stderr it was handed, the hint by the default ${fallback}`).toBe(`Create the home repo? ${hint} `);
    }
  });

  test('y is yes and n is no, whatever the default', async () => {
    expect(await askYes('Create the home repo?', 'n', ioOf('y\n').io), 'y under the default no').toBe(true);
    expect(await askYes('Create the home repo?', 'y', ioOf('n\n').io), 'n under the default yes').toBe(false);
  });
});

describe('flows: enterToOpen', () => {
  test('Enter hands the URL to the browser opener', async (t) => {
    const bin = mkTmp('flows-opener-');
    const log = path.join(bin, 'opener.log');
    // Both names, so whichever this platform's opener is, it is the stand-in and never a real browser.
    for (const tool of ['open', 'xdg-open']) stubTool(bin, tool, ['#!/usr/bin/env bash', recordArgv(log), 'exit 0']);
    const saved = process.env.PATH;
    process.env.PATH = joinPath(bin, SYSTEM_PATH);
    t.after(() => { process.env.PATH = saved; });
    const url = 'https://example.invalid/owner/workkit/discussions/categories';
    const { io, said } = ioOf('', { open: true });
    const opening = enterToOpen(url, 'the categories page', 'Make the Daily category on this page.', io);
    expect(await until(() => readArgv(log).length > 0, 500), 'nothing opens before Enter').toBe(false);
    io.stdin.write('\n');
    await opening;
    expect(readArgv(log), `on Enter the opener got the URL alone, stderr: ${said()}`).toEqual([[url]]);
  });
});

describe('flows: poll', () => {
  test('a check that fails waits, Enter checks again at once, and a check that passes answers true', async () => {
    const check = checkOf([false, true]);
    expect(await poll('Waiting for the categories', NEVER, check, ioOf('\n', { open: true }).io), 'the second check passed').toBe(true);
    expect(check.asked, 'asked once, then again on Enter').toBe(2);
  });

  test('s skips: false, and the check is not asked again', async () => {
    const check = checkOf([false]);
    expect(await poll('Waiting for the categories', NEVER, check, ioOf('s', { open: true }).io), 'skipped').toBe(false);
    expect(check.asked, 'the one check before the key').toBe(1);
  });

  for (const [name, key, answer] of [['Enter', '\n', true], ['s', 's', false]]) {
    test(`with the frames forced, the countdown draws <message>... (<seconds left>s) counting down, and ${name} stops it and clears the line before poll answers ${answer}`, async () => {
      const env = homeEnv(mkTmp('flows-poll-home-'), { PATH: SYSTEM_PATH, WORKKIT_SPIN: '1' });
      const res = await drivePoll(key, { env, frames: 2, counts: 2 });
      const seconds = res.frames.map(secondsOf);
      expect(seconds.every((s, i) => s <= POLL_SECONDS && (i === 0 || s <= seconds[i - 1])), `the seconds left never go up, got: ${JSON.stringify(seconds)}`).toBe(true);
      expect(new Set(seconds).size >= 2, `and they went down while it waited, got: ${JSON.stringify(seconds)}`).toBe(true);
      const tail = `${CLEAR}answer: ${answer}\n`;
      expect(res.stderr.endsWith(tail), `the line cleared, then the answer, got: ${JSON.stringify(res.stderr.slice(-200))}`).toBe(true);
      const before = res.stderr.slice(0, -tail.length);
      expect(before.slice(before.lastIndexOf('\r') + 1), 'a frame is the last thing before the clear').toBe(res.frames[res.frames.length - 1]);
    });
  }

  test('WK_COMMAND_TERMINAL naming a file, the frames forced: the countdown\'s frames and its clear land in that file, and none reach stderr', async () => {
    const terminal = path.join(mkTmp('flows-poll-device-'), 'tty');
    const env = homeEnv(mkTmp('flows-poll-home-'), {
      PATH: SYSTEM_PATH, WORKKIT_SPIN: '1', WK_COMMAND_LOGGED: path.join(mkTmp('flows-poll-log-'), 'setup.log.raw'),
    });
    const res = await drivePoll('\n', { env, frames: 2, terminal });
    expect(res.drawn.endsWith(CLEAR), `the device ends on the clear, got: ${JSON.stringify(res.drawn.slice(-200))}`).toBe(true);
    const before = res.drawn.slice(0, -CLEAR.length);
    expect(res.frames.length >= 2 && before.split('\r').length - 1 === res.frames.length,
      `the device holds the countdown's frames and nothing else before the clear, got: ${JSON.stringify(before.slice(-200))}`).toBe(true);
    expect(res.stderr, 'stderr, the stream the log reads, holds the key hint and the answer, no frame and no clear')
      .toBe('\n(enter)=check now, (s)=skip\n\nanswer: true\n');
  });

  test('a closed stdin skips', async () => {
    const check = checkOf([false]);
    expect(await poll('Waiting for the categories', NEVER, check, ioOf('').io), 'skipped').toBe(false);
    expect(check.asked, 'the one check before the stdin closed').toBe(1);
  });
});
