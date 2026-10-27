//
// Tests for tower/start.sh: the terminal (the colors a half keeps, FORCE_COLOR on and
// off a terminal, a real Ctrl-C under a pty). Prologue: ./helpers.js.
//

const fs = require('fs');
const { group, test, assert, assertEq, skip, summary, selfRun, mkTmp } = require('../../lib/harness');
const {
  cleanup, until, start, QUIET_PORTS, RED, CYAN, OFF, COLORED_APP,
  probeStub, ptyRun, hasExpect,
} = require('./helpers');

const cases = async () => {
  group('tower/start: the terminal');

  await test('a colored log keeps its colors, and the filter still judges what is under them', async () => {
    // Once the halves paint, escapes sit on the very anchors the filter matches
    // (`^omega: `, `^objc[`), so the filter judges the line under its escapes, or
    // a refusal falls out of the keep net, a forgiven warning rides through, and
    // the tag stops opening the flowing phase.
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', COLORED_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      // The last line of the run, carrying no keep-net word, so seeing it is
      // proof the colored tag opened the phase.
      assert(await until(() => /index\.html/.test(out())), 'the untagged line after the tag came through');
      const text = out();
      assert(text.includes(`${RED}omega: the monorepo src-to-dist watch is not running${OFF}`),
        'the colored refusal survived the quiet phase, escapes and all');
      assert(text.includes(`${RED}Error: the board failed to load${OFF}`), 'and the colored error line with its own');
      assert(!/objc\[/.test(text), 'the colored benign warning was still dropped - its prefix is read under the color');
      assert(!/quiet chatter/.test(text), 'and the quiet phase is still quiet');
      assert(text.includes(`${CYAN}[web]${OFF} Using existing mkcert certificates`), 'the colored tag line printed as itself');
      const announce = text.split('\n').find((line) => /✓ dashboard at/.test(line));
      assert(/^✓ dashboard at https:\/\/localhost:14300$/.test(announce || ''),
        `and the announce names the bare URL - the tower composes its own lines uncolored, got: ${announce}`);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a tower that is not on a terminal hands its halves no FORCE_COLOR', async () => {
    // A run piped or redirected (this suite, a log file, a CI job) asked for
    // plain text, so the halves are left to decide for themselves.
    const dir = mkTmp('tower-start-');
    const { app, seen } = probeStub(dir);
    const tower = start(dir, 'exec sleep 30', app, QUIET_PORTS);
    try {
      assert(await until(() => fs.existsSync(seen)), 'the half started and reported what it was given');
      assertEq(fs.readFileSync(seen, 'utf8'), 'unset', 'which is nothing at all');
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  if (hasExpect()) {
    await test('a tower on a real terminal hands its halves the colors back', async () => {
      // Only a pty shows this: the half writes to a fifo, so it sees a non-tty
      // and paints nothing unless told to. The tower is the one that knows a
      // terminal is watching.
      const dir = mkTmp('tower-start-');
      const { app, seen } = probeStub(dir);
      const pty = ptyRun(dir, app);
      try {
        assert(await until(() => fs.existsSync(seen)), 'the half started under the terminal');
        assertEq(fs.readFileSync(seen, 'utf8'), '1', 'and was told to color its log');
      } finally {
        await pty.end('SIGKILL');
        cleanup(dir);
      }
    });

    await test('a FORCE_COLOR the caller exported is the caller\'s - a deliberate 0 included', async () => {
      const dir = mkTmp('tower-start-');
      const { app, seen } = probeStub(dir);
      const pty = ptyRun(dir, app, ['export FORCE_COLOR=0']);
      try {
        assert(await until(() => fs.existsSync(seen)), 'the half started under the terminal');
        assertEq(fs.readFileSync(seen, 'utf8'), '0', 'with the answer its caller gave, not the one the tower would have');
      } finally {
        await pty.end('SIGKILL');
        cleanup(dir);
      }
    });

    await test('a real Ctrl-C ends it silently - no job-control lines under a terminal', async () => {
      // Only a pty shows this: the suite's own runs redirect both streams and
      // never signal, so bash's "Terminated: 15 … Done …" lines, made for a job
      // another shell killed, never appear here.
      const dir = mkTmp('tower-start-');
      const pty = ptyRun(dir, "echo 'Dev server: https://localhost:14300'; exec sleep 30");
      try {
        assert(await until(() => pty.child.exitCode !== null), 'the run came down on the interrupt');
        const text = pty.output();
        assert(/✓ dashboard at/.test(text), 'the terminal saw the one line it should');
        assert(!/Terminated/.test(text), 'and no job-control obituary for the halves');
        assert(!/\bDone\b/.test(text), 'nor for their filters');
      } finally {
        await pty.end('SIGKILL');
        cleanup(dir);
      }
    });
  } else {
    // Named through the harness, so the run's totals say how much was left
    // unanswered instead of three ⊘ lines scrolling past uncounted.
    skip('a tower on a real terminal hands its halves the colors back', 'expect is not installed');
    skip('a FORCE_COLOR the caller exported is the caller\'s', 'expect is not installed');
    skip('a real Ctrl-C ends it silently', 'expect is not installed');
  }

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
