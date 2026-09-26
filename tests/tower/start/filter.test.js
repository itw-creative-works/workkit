//
// Tests for tower/start.sh: the log filter (the quiet default, the failures
// and refusals it must never swallow, the phase boundary, and the two doors
// that open the whole wall).
// The shared prologue (the wrapper runner, the stub halves, the poll, the pty run) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  mkTmp, cleanup, until, start, collect, QUIET_PORTS, NOISY_APP, FAILURE_SHAPES, FAILING_APP,
  REFUSING_APP, REFUSING_API, ANNOUNCED_APP, ANNOUNCING_APP, BENIGN_APP, STARTING, WEB_APP,
  PHASED_APP, CHATTY_API, BUMPED_APP,
} = require('./helpers');

const run = async () => {
  group('tower/start: the log filter');

  await test('the default run is quiet: the log wall is dropped, the problems and one URL line survive', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced');
      assert(await until(() => /the board failed to load/.test(out())), 'the error line came through');
      const text = out();
      assert(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'at the URL the app itself named');
      assertEq(text.match(/✓ dashboard at/g).length, 1, 'once, not once per URL the app printed');
      assert(/WARN missing key/.test(text), 'the warning came through too');
      // The cost of #170, taken deliberately: the prefix is the whole test, so
      // omega's benign notes ride in beside its refusals. A note is one line;
      // a swallowed refusal is a blank terminal.
      assert(/omega: no cloudflare account id configured/.test(text), 'and so did the line omega says as itself');
      assert(!/compiled 42 files/.test(text), 'but not the build timings - the wall is still dropped');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the shapes a failure really arrives in all survive the filter', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', FAILING_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /ELIFECYCLE/.test(out())), 'the app half was read to its last line');
      const text = out();
      FAILURE_SHAPES.forEach((line) => {
        assert(text.includes(line), `"${line}" came through`);
      });
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a refused boot reaches the terminal - the framework\'s own words, and the half that ended', async () => {
    // The failure this pins (#170): omega's refusal carries none of the keep
    // net's words, so every line of it was dropped, the app half died, the
    // script took the API down with it, and the terminal showed only "starting
    // the dashboard…" before the prompt came back.
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', REFUSING_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /ended before the dashboard/.test(out())), 'the run said a half ended before the dashboard came up');
      const text = out();
      assert(/omega: the monorepo src-to-dist watch is not running/.test(text), "the framework naming a problem came through");
      assert(/omega: dist is not built/.test(text), 'and the remedy it printed with it');
      assert(/the app half ended before the dashboard/.test(text), 'the line names which half ended');
      assert(/--verbose/.test(text), 'and points at the run that shows everything');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the half named is the one that ended - the API side says so too', async () => {
    const dir = mkTmp();
    const child = start(dir, REFUSING_API, 'exec sleep 30', QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /ended before the dashboard/.test(out())), 'the run explained itself');
      const text = out();
      assert(/the API half ended before the dashboard/.test(text), 'and named the half that actually ended');
      assert(/omega: linked packages are read-only/.test(text), 'with its refusal above it');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a run that got its dashboard explains nothing when it ends', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', ANNOUNCED_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => child.exitCode !== null), 'the run ended when its app half did');
      const text = out();
      assert(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard had been announced');
      assert(!/ended before the dashboard/.test(text), 'so its ending is ordinary shutdown, not a refusal to explain');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a signal to the script is a shutdown, not a boot that never happened', async () => {
    // The failure this pins (#170 review): a TERM delivered to the script's own
    // pid - a supervisor, a bare `kill <pid>` - runs cleanup from the trap,
    // which removes the fifo directory and with it the announce marker. The
    // block after the poll loop then read a run that HAD its dashboard as one
    // that never came up, and named the wrong half besides, since cleanup had
    // already ended both. The suite's first case sends this exact signal with
    // the output discarded, which is why nothing caught it.
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', ANNOUNCING_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    const closed = new Promise((resolve) => { child.on('close', resolve); });
    try {
      assert(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced');
      child.kill('SIGTERM');
      await closed;
      const text = out();
      assert(!/ended before the dashboard/.test(text), 'the interrupted run explained nothing - it got its dashboard');
      assert(!/API half/.test(text), 'and named no half, least of all the wrong one');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the known-benign lines are dropped, and a summary with real failures is not', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', BENIGN_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      // The error is the app half's last line, so seeing it means every line
      // above it has been through the filter - and it is the keep net's own
      // regression here, the way the quiet case above pins it.
      assert(await until(() => /the board failed to load/.test(out())), 'the error line still came through');
      const text = out();
      assert(!/GNotificationCenterDelegate/.test(text), 'the duplicate-library warning did not');
      assert(!/objc\[/.test(text), 'nor any of it');
      assert(!/6 passed, 0 failed, 1 warned, 20 skipped/.test(text), 'nor the check summary of a run where nothing failed');
      assert(/4 passed, 2 failed, 1 warned, 20 skipped/.test(text), 'a summary with real failures is still read out');
      assert(/4 passed, 10 failed, 1 warned, 20 skipped/.test(text), 'ten of them too - the zero it exempts is a whole number');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('it says it is starting before anything else - in a verbose run too', async () => {
    // The quiet phase is otherwise a terminal with nothing on it at all
    // (#158): omega builds for a while before it names a URL, and every line
    // of that is filtered, so the run looked hung.
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    const loud = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true, args: ['--verbose'] });
    const loudOut = collect(loud);
    try {
      assert(await until(() => out().includes('\n')), 'the quiet run printed');
      assert(STARTING.test(out().split('\n')[0]), `and its very first line says so, got: ${out().split('\n')[0]}`);
      assert(await until(() => loudOut().includes('\n')), 'the verbose run printed');
      assert(STARTING.test(loudOut().split('\n')[0]), `the same first line - one story, both modes, got: ${loudOut().split('\n')[0]}`);
    } finally {
      child.kill('SIGKILL');
      loud.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the web target\'s own tag is the phase boundary - the manage cycle before it is not', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', WEB_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      // The last line of the run, carrying no keep-net word at all, so seeing
      // it is itself proof the switch happened.
      assert(await until(() => /watching for changes/.test(out())), 'the app half was read to its last line');
      const text = out();
      assert(!/\[11ty\]/.test(text), "the manage cycle's own bracketed line stayed hidden");
      assert(!/some manage step/.test(text), 'and did not open the phase for the line after it');
      assert(/\[web\] Using existing mkcert certificates/.test(text), 'the first tagged line came through - no keep-net word in it');
      assert(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard was still announced');
      assertEq(text.match(/✓ dashboard at/g).length, 1, 'once');
      assert(/\[web\] Dev server: https:\/\/localhost:14300/.test(text), "and the app's own URL line printed beside it, not instead of it");
      assert(!/objc\[/.test(text), 'the drop list outlives the boundary - the objc warning is gone');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('an app that never tags a line still switches at the URL it names', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', PHASED_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      // The last line of the run, and one that carries no keep-net word at all,
      // so seeing it is itself proof the switch happened.
      assert(await until(() => /app\.css/.test(out())), 'the app half was read to its last line');
      const text = out();
      assert(!/copying 12 assets/.test(text), 'the pre-announce chatter stayed hidden');
      assert(/omega: some build step/.test(text), 'the line beside it did not - what omega says as itself is kept in either phase (#170)');
      assert(/GET \/index\.html 200 in 12ms/.test(text), 'the post-announce request came through');
      assert(/GET \/assets\/app\.css 200 in 3ms/.test(text), 'and the one after it');
      assert(!/objc\[/.test(text), 'the drop list outlives the boundary - the objc warning is gone');
      assert(!/6 passed, 0 failed, 1 warned, 20 skipped/.test(text), 'and so is the passing check summary');
      assert(/✓ dashboard at https:\/\/localhost:14300/.test(text), 'the dashboard was announced');
      assertEq(text.match(/✓ dashboard at/g).length, 1, 'once');
      // A trigger line is judged in the phase it OPENS, so the URL line prints
      // as itself too - the announce stands beside it, naming the dashboard in
      // the wrapper's own voice.
      assert(/Dev server: https:\/\/localhost:14300/.test(text), "the app's own URL line came through as well");
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the API half owns no port, so it never switches - chatter stays hidden for its whole life', async () => {
    const dir = mkTmp();
    const child = start(dir, CHATTY_API, 'exec sleep 30', QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /sweep token is missing/.test(out())), 'its problem line came through');
      const text = out();
      assert(!/board sweep done/.test(text), 'its ordinary chatter did not');
      assert(!/✓ dashboard at/.test(text), 'and a URL in ITS output announces nothing - it owns no dashboard');
      assert(!/api: listening on/.test(text), 'so that line is just chatter too');
      assert(!/\[web\] hello/.test(text), 'nor does the app half\'s tag open a phase over here');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('an app on a bumped port is still announced - and says it was bumped', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', BUMPED_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /✓ dashboard at/.test(out())), 'the dashboard was announced');
      const text = out();
      assert(/✓ dashboard at https:\/\/localhost:14301/.test(text), 'at the port it actually took, not the one it was asked for');
      assertEq(text.match(/✓ dashboard at/g).length, 1, 'once');
      assert(/bumped to 14301/.test(text), 'and the line explaining the move survived too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('--verbose passes the whole wall through, as before', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true, args: ['--verbose'] });
    const out = collect(child);
    try {
      // The app half's LAST line, the way the quiet case above polls for it: a
      // snapshot taken at an earlier line can be read before the lines after it
      // have arrived, and the assertions below are about those later lines.
      assert(await until(() => /the board failed to load/.test(out())), 'the app half was read to its last line');
      const text = out();
      assert(/compiled 42 files/.test(text), 'the build timings are back');
      assert(/cloudflare/.test(text), 'and the framework chatter with them');
      assert(/Dev server: https:\/\/localhost:14300/.test(text), "the app's own URL line stands unrewritten");
      assert(!/✓ dashboard at/.test(text), 'so the wrapper adds no second one');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('WORKKIT_TOWER_VERBOSE=1 is the same door, for callers that pass no arguments', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS,
      { capture: true, env: { WORKKIT_TOWER_VERBOSE: '1' } });
    const out = collect(child);
    try {
      assert(await until(() => /compiled 42 files/.test(out())), 'the env var opens the wall too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
