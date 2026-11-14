//
// Tests for tower/start.sh: the log filter (the quiet default, the refusals it never
// swallows, the phase boundary, the doors to the whole wall). Prologue: ./helpers.js.
//

const { describe, test, expect, mkTmp } = require('../../lib/harness');
const {
  cleanup, until, start, QUIET_PORTS, NOISY_APP, FAILURE_SHAPES, FAILING_APP,
  REFUSING_APP, REFUSING_API, ANNOUNCED_APP, ANNOUNCING_APP, BENIGN_APP, STARTING, WEB_APP,
  PHASED_APP, CHATTY_API, BUMPED_APP,
} = require('./helpers');

describe('tower/start: the log filter', () => {
  test('the default run is quiet: the log wall is dropped, the problems and one URL line survive', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced').toBeTruthy();
      expect(await until(() => /the board failed to load/.test(out())), 'the error line came through').toBeTruthy();
      const text = out();
      expect(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'at the URL the app itself named').toBeTruthy();
      expect(text.match(/✓ dashboard at/g).length, 'once, not once per URL the app printed').toBe(1);
      expect(/WARN missing key/.test(text), 'the warning came through too').toBeTruthy();
      // The prefix is the whole test, deliberately: omega's benign notes ride in
      // beside its refusals. A note is one line; a swallowed refusal is a blank
      // terminal.
      expect(/omega: no cloudflare account id configured/.test(text), 'and so did the line omega says as itself').toBeTruthy();
      expect(!/compiled 42 files/.test(text), 'but not the build timings - the wall is still dropped').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('the shapes a failure really arrives in all survive the filter', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', FAILING_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /ELIFECYCLE/.test(out())), 'the app half was read to its last line').toBeTruthy();
      const text = out();
      FAILURE_SHAPES.forEach((line) => {
        expect(text.includes(line), `"${line}" came through`).toBeTruthy();
      });
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a refused boot reaches the terminal - the framework\'s own words, and the half that ended', async () => {
    // omega's refusal carries none of the keep net's words; dropped, it leaves a
    // terminal showing only "starting the dashboard…" while both halves end.
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', REFUSING_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /ended before the dashboard/.test(out())), 'the run said a half ended before the dashboard came up').toBeTruthy();
      const text = out();
      expect(/omega: the monorepo src-to-dist watch is not running/.test(text), "the framework naming a problem came through").toBeTruthy();
      expect(/omega: dist is not built/.test(text), 'and the remedy it printed with it').toBeTruthy();
      expect(/the app half ended before the dashboard/.test(text), 'the line names which half ended').toBeTruthy();
      expect(/--verbose/.test(text), 'and points at the run that shows everything').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('the half named is the one that ended - the API side says so too', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, REFUSING_API, 'exec sleep 30', QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /ended before the dashboard/.test(out())), 'the run explained itself').toBeTruthy();
      const text = out();
      expect(/the API half ended before the dashboard/.test(text), 'and named the half that actually ended').toBeTruthy();
      expect(/omega: linked packages are read-only/.test(text), 'with its refusal above it').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a run that got its dashboard explains nothing when it ends', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', ANNOUNCED_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => tower.child.exitCode !== null), 'the run ended when its app half did').toBeTruthy();
      const text = out();
      expect(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard had been announced').toBeTruthy();
      expect(!/ended before the dashboard/.test(text), 'so its ending is ordinary shutdown, not a refusal to explain').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a signal to the script is a shutdown, not a boot that never happened', async () => {
    // A TERM to the script's own pid runs cleanup from the trap, which removes
    // the fifo directory and the announce marker with it, so the block after the
    // poll loop must not read a run that had its dashboard as one that never
    // came up.
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', ANNOUNCING_APP, QUIET_PORTS);
    const out = tower.output;
    const closed = new Promise((resolve) => { tower.child.on('close', resolve); });
    try {
      expect(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced').toBeTruthy();
      tower.child.kill('SIGTERM');
      await closed;
      const text = out();
      expect(!/ended before the dashboard/.test(text), 'the interrupted run explained nothing - it got its dashboard').toBeTruthy();
      expect(!/API half/.test(text), 'and named no half, least of all the wrong one').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('the known-benign lines are dropped, and a summary with real failures is not', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', BENIGN_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      // The error is the app half's last line, so seeing it means every line
      // above it has been through the filter - and it is the keep net's own
      // regression here, the way the quiet case above pins it.
      expect(await until(() => /the board failed to load/.test(out())), 'the error line still came through').toBeTruthy();
      const text = out();
      expect(!/GNotificationCenterDelegate/.test(text), 'the duplicate-library warning did not').toBeTruthy();
      expect(!/objc\[/.test(text), 'nor any of it').toBeTruthy();
      expect(!/6 passed, 0 failed, 1 warned, 20 skipped/.test(text), 'nor the check summary of a run where nothing failed').toBeTruthy();
      expect(/4 passed, 2 failed, 1 warned, 20 skipped/.test(text), 'a summary with real failures is still read out').toBeTruthy();
      expect(/4 passed, 10 failed, 1 warned, 20 skipped/.test(text), 'ten of them too - the zero it exempts is a whole number').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('it says it is starting before anything else - in a verbose run too', async () => {
    // The quiet phase is otherwise a blank terminal: omega builds for a while
    // before it names a URL, and every line of that is filtered.
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS);
    const out = tower.output;
    const loud = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { args: ['--verbose'] });
    const loudOut = loud.output;
    try {
      expect(await until(() => out().includes('\n')), 'the quiet run printed').toBeTruthy();
      expect(STARTING.test(out().split('\n')[0]), `and its very first line says so, got: ${out().split('\n')[0]}`).toBeTruthy();
      expect(await until(() => loudOut().includes('\n')), 'the verbose run printed').toBeTruthy();
      expect(STARTING.test(loudOut().split('\n')[0]), `the same first line - one story, both modes, got: ${loudOut().split('\n')[0]}`).toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      await loud.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('the web target\'s own tag is the phase boundary - the manage cycle before it is not', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', WEB_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      // The last line of the run, carrying no keep-net word at all, so seeing
      // it is itself proof the switch happened.
      expect(await until(() => /watching for changes/.test(out())), 'the app half was read to its last line').toBeTruthy();
      const text = out();
      expect(!/\[11ty\]/.test(text), "the manage cycle's own bracketed line stayed hidden").toBeTruthy();
      expect(!/some manage step/.test(text), 'and did not open the phase for the line after it').toBeTruthy();
      expect(/\[web\] Using existing mkcert certificates/.test(text), 'the first tagged line came through - no keep-net word in it').toBeTruthy();
      expect(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard was still announced').toBeTruthy();
      expect(text.match(/✓ dashboard at/g).length, 'once').toBe(1);
      expect(/\[web\] Dev server: https:\/\/localhost:14300/.test(text), "and the app's own URL line printed beside it, not instead of it").toBeTruthy();
      expect(!/objc\[/.test(text), 'the drop list outlives the boundary - the objc warning is gone').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('an app that never tags a line still switches at the URL it names', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', PHASED_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      // The last line of the run, and one that carries no keep-net word at all,
      // so seeing it is itself proof the switch happened.
      expect(await until(() => /app\.css/.test(out())), 'the app half was read to its last line').toBeTruthy();
      const text = out();
      expect(!/copying 12 assets/.test(text), 'the pre-announce chatter stayed hidden').toBeTruthy();
      expect(/omega: some build step/.test(text), 'the line beside it did not - what omega says as itself is kept in either phase (#170)').toBeTruthy();
      expect(/GET \/index\.html 200 in 12ms/.test(text), 'the post-announce request came through').toBeTruthy();
      expect(/GET \/assets\/app\.css 200 in 3ms/.test(text), 'and the one after it').toBeTruthy();
      expect(!/objc\[/.test(text), 'the drop list outlives the boundary - the objc warning is gone').toBeTruthy();
      expect(!/6 passed, 0 failed, 1 warned, 20 skipped/.test(text), 'and so is the passing check summary').toBeTruthy();
      expect(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard was announced').toBeTruthy();
      expect(text.match(/✓ dashboard at/g).length, 'once').toBe(1);
      // A trigger line is judged in the phase it opens, so the URL line prints
      // as itself too, the announce beside it naming the dashboard in the
      // wrapper's own voice.
      expect(/Dev server: https:\/\/localhost:14300/.test(text), "the app's own URL line came through as well").toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('the API half owns no port, so it never switches - chatter stays hidden for its whole life', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, CHATTY_API, 'exec sleep 30', QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /sweep token is missing/.test(out())), 'its problem line came through').toBeTruthy();
      const text = out();
      expect(!/board sweep done/.test(text), 'its ordinary chatter did not').toBeTruthy();
      expect(!/✓ dashboard at/.test(text), 'and a URL in ITS output announces nothing - it owns no dashboard').toBeTruthy();
      expect(!/api: listening on/.test(text), 'so that line is just chatter too').toBeTruthy();
      expect(!/\[web\] hello/.test(text), 'nor does the app half\'s tag open a phase over here').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('an app on a bumped port is still announced - and says it was bumped', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', BUMPED_APP, QUIET_PORTS);
    const out = tower.output;
    try {
      expect(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced').toBeTruthy();
      const text = out();
      expect(/✓ dashboard at https:\/\/localhost:14301/.test(text), 'at the port it actually took, not the one it was asked for').toBeTruthy();
      expect(text.match(/✓ dashboard at/g).length, 'once').toBe(1);
      expect(/bumped to 14301/.test(text), 'and the line explaining the move survived too').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('--verbose passes the whole wall through, as before', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { args: ['--verbose'] });
    const out = tower.output;
    try {
      // The app half's last line, the way the quiet case above polls for it: a
      // snapshot taken at an earlier line can be read before the lines after it
      // have arrived, and the assertions below are about those later lines.
      expect(await until(() => /the board failed to load/.test(out())), 'the app half was read to its last line').toBeTruthy();
      const text = out();
      expect(/compiled 42 files/.test(text), 'the build timings are back').toBeTruthy();
      expect(/cloudflare/.test(text), 'and the framework chatter with them').toBeTruthy();
      expect(/Dev server: https:\/\/localhost:14300/.test(text), "the app's own URL line stands unrewritten").toBeTruthy();
      expect(!/✓ dashboard at/.test(text), 'so the wrapper adds no second one').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('WORKKIT_TOWER_VERBOSE=1 is the same door, for callers that pass no arguments', async () => {
    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS,
      { env: { WORKKIT_TOWER_VERBOSE: '1' } });
    const out = tower.output;
    try {
      expect(await until(() => /compiled 42 files/.test(out())), 'the env var opens the wall too').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });
});
