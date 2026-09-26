//
// Tests for tower/start.sh: the terminal (the colors a half keeps, the
// FORCE_COLOR it is handed on and off a terminal, a real Ctrl-C under a pty)
// and the wrapper's contract with the two commands that run it.
// The shared prologue (the wrapper runner, the stub halves, the poll, the pty run) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  SCRIPT, mkTmp, cleanup, until, start, collect, QUIET_PORTS, RED, CYAN, OFF, COLORED_APP,
  probeStub, ptyRun, hasExpect,
} = require('./helpers');

const run = async () => {
  group("tower/start: the terminal, and the wrapper's contract");

  await test('a colored log keeps its colors, and the filter still judges what is under them', async () => {
    // The failure this pins (#179): once the halves are painting again, the
    // escapes sit on the very anchors the filter matches. A filter reading the
    // raw line finds an escape where `^omega: ` and `^objc[` should be, so the
    // framework's refusal falls out of the keep net, the duplicate-library
    // warning rides through on the word "failures" the drop list exists to
    // forgive, and the tag no longer opens the flowing phase.
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', COLORED_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
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
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a tower that is not on a terminal hands its halves no FORCE_COLOR', async () => {
    // The other half of #179: a run piped or redirected - this suite, a log
    // file, a CI job - asked for plain text, and the halves must be left to
    // decide as they always did.
    const dir = mkTmp();
    const { app, seen } = probeStub(dir);
    const child = start(dir, 'exec sleep 30', app, QUIET_PORTS);
    try {
      assert(await until(() => fs.existsSync(seen)), 'the half started and reported what it was given');
      assertEq(fs.readFileSync(seen, 'utf8'), 'unset', 'which is nothing at all');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  if (hasExpect()) {
    await test('a tower on a real terminal hands its halves the colors back', async () => {
      // What #179 is actually about, and what only a pty can show: the half
      // writes to a fifo, so it sees a non-tty and paints nothing unless it is
      // told to. The tower is the one that knows a terminal is watching.
      const dir = mkTmp();
      const { app, seen } = probeStub(dir);
      const child = ptyRun(dir, app);
      try {
        assert(await until(() => fs.existsSync(seen), 25000), 'the half started under the terminal');
        assertEq(fs.readFileSync(seen, 'utf8'), '1', 'and was told to color its log');
      } finally {
        child.kill('SIGKILL');
        cleanup(dir);
      }
    });

    await test('a FORCE_COLOR the caller exported is the caller\'s - a deliberate 0 included', async () => {
      const dir = mkTmp();
      const { app, seen } = probeStub(dir);
      const child = ptyRun(dir, app, ['export FORCE_COLOR=0']);
      try {
        assert(await until(() => fs.existsSync(seen), 25000), 'the half started under the terminal');
        assertEq(fs.readFileSync(seen, 'utf8'), '0', 'with the answer its caller gave, not the one the tower would have');
      } finally {
        child.kill('SIGKILL');
        cleanup(dir);
      }
    });

    await test('a real Ctrl-C ends it silently - no job-control lines under a terminal', async () => {
      // Only a pty shows this (#138 review, B1): the suite's own runs redirect
      // both streams and never signal, so bash's "Terminated: 15 … Done …"
      // announcements - which it makes for a job some OTHER shell killed -
      // were invisible here while filling the terminal of everyone who typed
      // the command and pressed Ctrl-C.
      const dir = mkTmp();
      const runner = path.join(dir, 'runner.sh');
      const script = path.join(dir, 'ctrl-c.exp');
      fs.writeFileSync(runner, [
        '#!/usr/bin/env bash',
        `export WORKKIT_TOWER_PORTS='${QUIET_PORTS}'`,
        "export WORKKIT_TOWER_API='exec sleep 30'",
        'export WORKKIT_TOWER_APP="echo \'Dev server: https://localhost:14300\'; exec sleep 30"',
        `exec bash '${shellPath(SCRIPT)}'`,
        '',
      ].join('\n'));
      fs.writeFileSync(script, [
        'set timeout 20',
        `spawn bash ${shellPath(runner)}`,
        'expect -re "dashboard at"',
        'send \\003',
        'expect eof',
        '',
      ].join('\n'));

      const child = spawn('expect', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      const out = collect(child);
      try {
        assert(await until(() => child.exitCode !== null, 25000), 'the run came down on the interrupt');
        const text = out();
        assert(/✓ dashboard at/.test(text), 'the terminal saw the one line it should');
        assert(!/Terminated/.test(text), 'and no job-control obituary for the halves');
        assert(!/\bDone\b/.test(text), 'nor for their filters');
      } finally {
        child.kill('SIGKILL');
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

  await test('workkit tower hands this script its arguments, so --verbose gets here', () => {
    // The other door, and the one that dropped the flag on the floor: the CLI
    // exec'd the wrapper with nothing, so `workkit tower --verbose` was quiet.
    const cli = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'workkit.sh'), 'utf8');
    assert(/exec bash "\$TOWER_START" "\$@"/.test(cli), 'the CLI forwards what it was given');
  });

  await test('npm run tower is this script, and its defaults are the two real servers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
    assertEq(pkg.scripts.tower, 'bash tower/start.sh', 'the root command runs the wrapper');
    const script = fs.readFileSync(SCRIPT, 'utf8');
    assert(script.includes('tower/api/server.js'), 'one default is the JSON API');
    assert(/tower\/app.*npm run dev/.test(script), 'the other is the dashboard dev server');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
