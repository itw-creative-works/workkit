// Tests for workflow/home.sh: the setup wizard's Discussions step (enabled, the
// categories page opened and polled until they are there).
// The shared prologue is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/home: the wizard, Discussions and the categories poll');

  await test('Discussions are enabled, and missing categories get a one-time pointer', () => {
    // GitHub has no mutation that creates a discussion category, probed
    // against the live schema, so the only honest step is to name the page.
    const world = mkWorld({ login: 'owner', categories: ['General'] });
    const { code, out } = inHome(world, 'wk_home_discussions owner/workkit');
    assertEq(code, 0, 'exit 0');
    assert(/Discussions enabled/.test(out), `it turns them on, got: ${out}`);
    assert(/Daily, Weekly, Monthly, Brief/.test(out), 'names every category that is missing, the brief\'s included (#244)');
    assert(/discussions\/categories/.test(out), 'and the page that makes them');
    assert(/no API that creates one/.test(out), 'saying why it cannot do it itself');
    assertEq(world.openerCalls().length, 0, 'and nothing opened: this run has no terminal');
    cleanup(world.root);
  });

  // Keys arrive through a process substitution, so they can land after the poll
  // started; a spawnSync `input` is read at once and its close reads as a skip.
  // The feeder lets go of the transcript's streams first, or a sleeping feeder
  // would hold the run open past the step it is feeding.
  const atTerminal = (world, stdin) => inHome(world,
    `interactive() { return 0; }\nwk_home_discussions owner/workkit < <(exec 2>/dev/null; ${stdin})`);
  const categoriesCalls = (world) => world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;

  await test('at a terminal, setup opens the page that makes the categories and polls until they are there (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'] });
    const { code, out } = atTerminal(world, "printf '\\n'");
    assertEq(code, 0, 'exit 0');
    assert(/Make the Daily, Weekly, Monthly, Brief categories on this page/.test(out), `it says what to do there, got: ${out}`);
    assert(/URL: https:\/\/github.com\/owner\/workkit\/discussions\/categories/.test(out), 'and prints the URL before asking');
    assert(/\? Press Enter to open the categories page in your browser\.\.\./.test(out), 'the one Enter gate, in omega\'s words');
    const opened = world.openerCalls();
    assertEq(opened.length, 1, `the page opened once: ${fmtCalls(opened)}`);
    assertEq(opened[0][0], 'https://github.com/owner/workkit/discussions/categories', 'the page that makes them');
    assert(/\(enter\)=check now, \(s\)=skip/.test(out), 'then the poll names its keys');
    assert(/✓.*Daily, Weekly, Monthly and Brief categories are there/.test(out), `the first check found what the owner made, got: ${out}`);
    assert(!/no API that creates one/.test(out), 'so no pointer is printed');
    cleanup(world.root);
  });

  await test('Enter checks now, ahead of the interval (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    // An interval no run outlasts, and the pipe closes right after the Enter:
    // the only second check this run can make is the one the Enter asked for.
    world.env.WORKKIT_HOME_POLL_INTERVAL = '600';
    const { code, out } = atTerminal(world, "printf '\\n\\n'");
    assertEq(code, 0, 'exit 0');
    assertEq(categoriesCalls(world), 4, `enable, the step's own read, the poll's first check, then the one Enter asked for: ${categoriesCalls(world)} reads`);
    assert(/✓.*categories are there/.test(out), `the Enter's check passed, got: ${out}`);
    assertEq((out.match(/⏳ Waiting for the categories/g) || []).length, 1, `inside the one wait that began, got: ${out}`);
    cleanup(world.root);
  });

  await test('with no key pressed, the poll checks again on its own once the interval is out (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    // Three seconds, the fewest in which a closed pipe still reads as a skip; the
    // feeder holds stdin open past the run's own spawn cap, so the check that
    // passes is the interval's.
    world.env.WORKKIT_HOME_POLL_INTERVAL = '3';
    const { code, out } = atTerminal(world, "printf '\\n'; sleep 30");
    assertEq(code, 0, 'exit 0');
    assert(/✓.*categories are there/.test(out), `the interval's own check passed, got: ${out}`);
    assertEq(categoriesCalls(world), 4, `enable, the step's own read, the poll's first check, the interval's: ${categoriesCalls(world)} reads`);
    cleanup(world.root);
  });

  await test('s skips the poll and keeps the pointer; the pipe closing counts as a skip too (#244)', () => {
    const skipped = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    skipped.installOpener();
    const s = atTerminal(skipped, "printf '\\ns'");
    assertEq(s.code, 0, 'exit 0');
    assertEq(skipped.openerCalls().length, 1, 'the open is never declined; skipping happens at the poll');
    assert(/no API that creates one/.test(s.out), `the pointer stands, got: ${s.out}`);
    cleanup(skipped.root);

    // A read that fails during the poll must not blank the pointer's names.
    const broken = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    broken.installOpener({ breaks: true });
    const b = atTerminal(broken, "printf '\ns'");
    assertEq(b.code, 0, 'exit 0');
    assert(/the Daily, Weekly, Monthly, Brief categories do not exist yet/.test(b.out), `the pointer keeps the names the step read itself, got: ${b.out}`);
    cleanup(broken.root);

    const partial = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    partial.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly'] });
    const p = atTerminal(partial, "printf '\\n'");
    assertEq(p.code, 0, 'exit 0');
    assert(/the Brief categories do not exist yet/.test(p.out), `the pointer names only what is still missing, got: ${p.out}`);
    cleanup(partial.root);
  });

  await test('a terminal with no browser opener still asks and polls, and says the URL is by hand (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    // The base PATH keeps a real `open` on a Mac and a real `xdg-open` on a
    // Linux runner, so the gate's own `command -v` is answered no by hand.
    const noOpener = 'command() { [[ "$1" == "-v" && ("$2" == "open" || "$2" == "xdg-open") ]] && return 1; builtin command "$@"; }';
    const { code, out } = inHome(world, `${noOpener}\ninteractive() { return 0; }\nwk_home_discussions owner/workkit < <(printf '\\n')`);
    assertEq(code, 0, 'exit 0');
    assert(/Press Enter to open/.test(out), `the gate still asks, got: ${out}`);
    assert(/no browser could be launched: open the URL above by hand/.test(out), 'and says the open did not happen');
    assert(/no API that creates one/.test(out), 'the pointer stands once the pipe closes');
    cleanup(world.root);
  });

  await test('Discussions already on are left alone', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { out } = inHome(world, 'wk_home_discussions owner/workkit');
    assert(/Discussions are on/.test(out), `it reports the state, got: ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(!calls.some((c) => c.includes('updateRepository')), `and never writes: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
