// Tests for workflow/home.sh: the setup wizard's Discussions step (enabled, the
// categories page opened and polled until they are there).
// The shared prologue is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, inHome } = require('./helpers');

describe('workflow/home: the wizard, Discussions and the categories poll', () => {
  test('Discussions are enabled, and missing categories get a one-time pointer', () => {
    // GitHub has no mutation that creates a discussion category, probed
    // against the live schema, so the only honest step is to name the page.
    const world = mkWorld({ login: 'owner', categories: ['General'] });
    const { code, out } = inHome(world, 'wk_home_discussions owner/workkit');
    expect(code, 'exit 0').toBe(0);
    expect(/Discussions enabled/.test(out), `it turns them on, got: ${out}`).toBeTruthy();
    expect(/Daily, Weekly, Monthly, Brief/.test(out), 'names every category that is missing, the brief\'s included (#244)').toBeTruthy();
    expect(/discussions\/categories/.test(out), 'and the page that makes them').toBeTruthy();
    expect(/no API that creates one/.test(out), 'saying why it cannot do it itself').toBeTruthy();
    expect(world.openerCalls().length, 'and nothing opened: this run has no terminal').toBe(0);
    cleanup(world.root);
  });

  // Keys arrive through a process substitution, so they can land after the poll
  // started; a spawnSync `input` is read at once and its close reads as a skip.
  // The feeder lets go of the transcript's streams first, or a sleeping feeder
  // would hold the run open past the step it is feeding.
  const atTerminal = (world, stdin) => inHome(world,
    `interactive() { return 0; }\nwk_home_discussions owner/workkit < <(exec 2>/dev/null; ${stdin})`);
  const categoriesCalls = (world) => world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;

  test('at a terminal, setup opens the page that makes the categories and polls until they are there (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'] });
    const { code, out } = atTerminal(world, "printf '\\n'");
    expect(code, 'exit 0').toBe(0);
    expect(/Make the Daily, Weekly, Monthly, Brief categories on this page/.test(out), `it says what to do there, got: ${out}`).toBeTruthy();
    expect(/URL: https:\/\/github.com\/owner\/workkit\/discussions\/categories/.test(out), 'and prints the URL before asking').toBeTruthy();
    expect(/\? Press Enter to open the categories page in your browser\.\.\./.test(out), 'the one Enter gate, in omega\'s words').toBeTruthy();
    const opened = world.openerCalls();
    expect(opened.length, `the page opened once: ${fmtCalls(opened)}`).toBe(1);
    expect(opened[0][0], 'the page that makes them').toBe('https://github.com/owner/workkit/discussions/categories');
    expect(/\(enter\)=check now, \(s\)=skip/.test(out), 'then the poll names its keys').toBeTruthy();
    expect(/✓.*Daily, Weekly, Monthly and Brief categories are there/.test(out), `the first check found what the owner made, got: ${out}`).toBeTruthy();
    expect(!/no API that creates one/.test(out), 'so no pointer is printed').toBeTruthy();
    cleanup(world.root);
  });

  test('Enter checks now, ahead of the interval (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    // An interval no run outlasts, and the pipe closes right after the Enter:
    // the only second check this run can make is the one the Enter asked for.
    world.env.WORKKIT_HOME_POLL_INTERVAL = '600';
    const { code, out } = atTerminal(world, "printf '\\n\\n'");
    expect(code, 'exit 0').toBe(0);
    expect(categoriesCalls(world), `enable, the step's own read, the poll's first check, then the one Enter asked for: ${categoriesCalls(world)} reads`).toBe(4);
    expect(/✓.*categories are there/.test(out), `the Enter's check passed, got: ${out}`).toBeTruthy();
    expect((out.match(/⏳ Waiting for the categories/g) || []).length, `inside the one wait that began, got: ${out}`).toBe(1);
    cleanup(world.root);
  });

  test('with no key pressed, the poll checks again on its own once the interval is out (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    // Three seconds, the fewest in which a closed pipe still reads as a skip; the
    // feeder holds stdin open past the run's own spawn cap, so the check that
    // passes is the interval's.
    world.env.WORKKIT_HOME_POLL_INTERVAL = '3';
    const { code, out } = atTerminal(world, "printf '\\n'; sleep 30");
    expect(code, 'exit 0').toBe(0);
    expect(/✓.*categories are there/.test(out), `the interval's own check passed, got: ${out}`).toBeTruthy();
    expect(categoriesCalls(world), `enable, the step's own read, the poll's first check, the interval's: ${categoriesCalls(world)} reads`).toBe(4);
    cleanup(world.root);
  });

  test('s skips the poll and keeps the pointer; the pipe closing counts as a skip too (#244)', () => {
    const skipped = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    skipped.installOpener();
    const s = atTerminal(skipped, "printf '\\ns'");
    expect(s.code, 'exit 0').toBe(0);
    expect(skipped.openerCalls().length, 'the open is never declined; skipping happens at the poll').toBe(1);
    expect(/no API that creates one/.test(s.out), `the pointer stands, got: ${s.out}`).toBeTruthy();
    cleanup(skipped.root);

    // A read that fails during the poll must not blank the pointer's names.
    const broken = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    broken.installOpener({ breaks: true });
    const b = atTerminal(broken, "printf '\ns'");
    expect(b.code, 'exit 0').toBe(0);
    expect(/the Daily, Weekly, Monthly, Brief categories do not exist yet/.test(b.out), `the pointer keeps the names the step read itself, got: ${b.out}`).toBeTruthy();
    cleanup(broken.root);

    const partial = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    partial.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly'] });
    const p = atTerminal(partial, "printf '\\n'");
    expect(p.code, 'exit 0').toBe(0);
    expect(/the Brief categories do not exist yet/.test(p.out), `the pointer names only what is still missing, got: ${p.out}`).toBeTruthy();
    cleanup(partial.root);
  });

  test('a terminal with no browser opener still asks and polls, and says the URL is by hand (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    // The base PATH keeps a real `open` on a Mac and a real `xdg-open` on a
    // Linux runner, so the gate's own `command -v` is answered no by hand.
    const noOpener = 'command() { [[ "$1" == "-v" && ("$2" == "open" || "$2" == "xdg-open") ]] && return 1; builtin command "$@"; }';
    const { code, out } = inHome(world, `${noOpener}\ninteractive() { return 0; }\nwk_home_discussions owner/workkit < <(printf '\\n')`);
    expect(code, 'exit 0').toBe(0);
    expect(/Press Enter to open/.test(out), `the gate still asks, got: ${out}`).toBeTruthy();
    expect(/no browser could be launched: open the URL above by hand/.test(out), 'and says the open did not happen').toBeTruthy();
    expect(/no API that creates one/.test(out), 'the pointer stands once the pipe closes').toBeTruthy();
    cleanup(world.root);
  });

  test('Discussions already on are left alone', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { out } = inHome(world, 'wk_home_discussions owner/workkit');
    expect(/Discussions are on/.test(out), `it reports the state, got: ${out}`).toBeTruthy();
    const calls = world.ghCalls().map((c) => c.join(' '));
    expect(!calls.some((c) => c.includes('updateRepository')), `and never writes: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    cleanup(world.root);
  });
});
