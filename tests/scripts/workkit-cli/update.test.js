//
// Tests for workflow/workkit.sh: `update`: the two links, the quiet
// `--auto` variant, and on macOS the schedule and a checkout or an installer
// that cannot answer.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, hasLaunchd,
} = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  WORKFLOW_DIR, CLI, LABEL, mkTmp, cleanup, mkWorld, runCli, ACTED, mkRepo, installSchedule,
  mkPartialKit,
} = require('./helpers');

const run = async () => {
  group('workkit update: the two links');

  await test('the engine address is pointed at this checkout', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, out } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0: stderr says: ${out}`);
    assertEq(fs.realpathSync(world.engineLink), fs.realpathSync(WORKFLOW_DIR), 'the address resolves to the engine');
    assert(out.includes('engine:'), `and it reported the link, got: ${out}`);
    cleanup(world.root);
  });

  await test('a second run reads the address back before calling it current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { out } = runCli(world, ['update']);
    assert(out.includes(`engine: ${shellPath(world.engineLink)} is current`), `an address that resolves here IS current, got: ${out}`);
    cleanup(world.root);
  });

  await test('an engine that refuses the address never reports "is current"', () => {
    // A copy of the engine outside any checkout: standards.sh declines to take
    // the machine's address, and says nothing about it. Silence read as
    // agreement printed a link that was never written.
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const kit = mkTmp();
    fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
    const { code, out } = runCli(world, ['update'], { script: path.join(kit, 'workflow', 'workkit.sh') });
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.engineLink), 'nothing was written at the address');
    assert(!out.includes('is current'), `a refusal never reads as up to date, got: ${out}`);
    assert(out.includes('was left as it is'), `and the run says the address went unwritten, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('the command is linked into ~/.local/bin', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    assertEq(fs.readlinkSync(world.link), CLI, 'the symlink points at this script');
    assert(out.includes('linked'), `and says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a link left by a moved checkout is repointed', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync('/somewhere/else/workflow/workkit.sh', world.link);
    const { out } = runCli(world, ['update']);
    assertEq(fs.readlinkSync(world.link), CLI, 'repointed at this checkout');
    assert(out.includes('repointed'), `and says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a real file at the address is reported, never replaced', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.writeFileSync(world.link, 'someone else’s script\n');
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, 'exit 0');
    assert(said.includes('is a real file'), `it says what is in the way, got: ${said}`);
    assertEq(fs.readFileSync(world.link, 'utf8'), 'someone else’s script\n', 'and the file is untouched');
    cleanup(world.root);
  });

  await test('run THROUGH the symlink, it still stands in the real checkout', () => {
    // The failure this guards: taking the dirname before resolving the link
    // makes ~/.local/bin the checkout, so every path under it (the engine, the
    // installer, the symlink itself) names a file that does not exist, and the
    // command repoints its own address at nothing.
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });

    const viaLink = runCli(world, ['update'], { cwd: repo, script: world.link });
    assertEq(viaLink.code, 0, `exit 0: stderr: ${viaLink.err}`);
    assert(viaLink.out.includes(shellPath(path.dirname(WORKFLOW_DIR))), `it names the real checkout, got: ${viaLink.out}`);
    assertEq(fs.readlinkSync(world.link), CLI, 'and its own address still points at the real CLI');

    const doctor = runCli(world, ['doctor'], { cwd: repo, script: world.link });
    assert(doctor.out.includes('Everything this command can see is current'), `no invented drift through the link, got: ${doctor.out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('a PATH without ~/.local/bin gets the export line, and no rc file is touched', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    assert(out.includes('export PATH='), `it prints the line to add, got: ${out}`);
    assert(!fs.existsSync(path.join(world.home, '.zshrc')), 'and writes nobody’s shell rc');
    cleanup(world.root);
  });

  await test('a second update reports nothing to do', () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.mkdirSync(world.localBin, { recursive: true });
    const first = runCli(world, ['update']);
    assert(ACTED.test(first.said), `the first run had something to do, got: ${first.said}`);
    // The answer is STRUCTURAL, not a word list: `--auto` is the same run with
    // QUIET=1, which silences every skip and note, so an empty stdout IS
    // "nothing was done" (issue #237).
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assertEq(out, '', `nothing was done the second time, got: ${out}`);
    cleanup(world.root);
  });

  group('workkit update --auto: the quiet variant');

  await test('a machine with nothing to do says nothing at all', () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assertEq(out, '', `session start hears nothing, got: ${out}`);
    cleanup(world.root);
  });

  await test('it introduces no ~/.local/bin to a machine that has none', () => {
    // The same restraint the engine shows with ~/.claude: the automatic path
    // keeps an address current, and never invents a convention at session start.
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.localBin), 'the directory is a human’s to ask for');
    assertEq(out, '', `and nothing is said about it, got: ${out}`);
    cleanup(world.root);
  });

  await test('an existing ~/.local/bin gets the link kept current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    const { out } = runCli(world, ['update', '--auto']);
    assertEq(fs.readlinkSync(world.link), CLI, 'a machine with the convention gets the address');
    assert(out.includes('command:'), `and hears about it, got: ${out}`);
    cleanup(world.root);
  });

  await test('an unknown option is refused', () => {
    const world = mkWorld();
    const { code, err } = runCli(world, ['update', '--everything']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('unknown option'), `says so, got: ${err}`);
    cleanup(world.root);
  });

  await test('with no schedule installed, launchd is never asked', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.plist()), 'the quiet path never installs a schedule fresh');
    assertEq(world.launchctl().length, 0, `and launchd is not touched: ${fmtCalls(world.launchctl())}`);
    assert(!out.includes('schedule'), `the missing schedule is not news at session start, got: ${out}`);
    cleanup(world.root);
  });

  // Everything below is launchd's: a machine without `launchctl` has no
  // schedule to name, install or keep current, and the engine says so itself
  // rather than acting (`launchd is macOS`). The cases are named as skips there
  // instead of asserting a capability that is not on the machine (#114).
  if (hasLaunchd()) {
    group('workkit update: the schedule (macOS)');

    await test('run by a human, a missing schedule names the command that installs it', () => {
      const world = mkWorld();
      const { out } = runCli(world, ['update']);
      assert(out.includes('workkit setup'), `it points at setup, got: ${out}`);
      assert(!fs.existsSync(world.plist()), 'and still installs nothing');
      cleanup(world.root);
    });

    await test('a current schedule is left alone, and launchd is not asked', () => {
      const world = mkWorld();
      installSchedule(world);
      const before = world.launchctl().length;
      const { out } = runCli(world, ['update', '--auto']);
      assertEq(world.launchctl().length, before, `no launchctl call for a current schedule: ${fmtCalls(world.launchctl())}`);
      assert(!out.includes('schedule'), `and nothing to report, got: ${out}`);
      cleanup(world.root);
    });

    await test('a schedule that drifted is re-rendered and reloaded', () => {
      const world = mkWorld();
      installSchedule(world);
      fs.appendFileSync(world.plist(), '\n<!-- from an older checkout -->\n');
      const before = world.launchctl().length;

      const { code, out } = runCli(world, ['update', '--auto']);
      assertEq(code, 0, 'exit 0');
      assert(!fs.readFileSync(world.plist(), 'utf8').includes('older checkout'), 'the stale plist is replaced');
      const added = world.launchctl().slice(before);
      assert(added.some((c) => isCall(c, 'bootstrap')), `and it is reloaded: ${fmtCalls(added)}`);
      assert(out.includes('schedule:'), `the session hears what changed, got: ${out}`);
      cleanup(world.root);
    });

    group('workkit: a checkout or an installer that cannot answer (macOS)');

    await test('a checkout missing its installer says so, never "current"', () => {
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit();
      const { code, said } = runCli(world, ['update'], { script });
      assertEq(code, 0, 'exit 0');
      assert(said.includes('standards.sh is missing'), `the missing engine is named, got: ${said}`);
      assert(said.includes('installer is missing'), `and so is the missing installer, got: ${said}`);
      assert(!said.includes('is current'), 'an incomplete checkout never reads as up to date');
      cleanup(world.root); cleanup(kit);
    });

    await test('an installer that fails is reported, and the run still finishes', () => {
      // install.sh exits hard on a missing template or a plist that fails lint.
      // Unguarded under `set -e` that abort is invisible inside the hook, which
      // discards stderr, and retries silently every day.
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit({
        installer: [
          'if [[ "$1" == \'--check\' ]]; then printf \'com.workkit.claude-daily → out of date for this checkout\\n\'; exit 0; fi',
          'printf \'template missing\\n\' >&2',
          'exit 1',
        ],
      });
      const { code, said } = runCli(world, ['update', '--auto'], { script });
      assertEq(code, 0, 'a failed install never aborts the caller');
      assert(said.includes('did not finish'), `it says the install failed, got: ${said}`);
      assert(said.includes('install.sh'), 'and names the command to run by hand');
      cleanup(world.root); cleanup(kit);
    });

    await test('a drift check that cannot answer is not "current" either', () => {
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit({ installer: ['exit 3'] });
      const { code, said } = runCli(world, ['update', '--auto'], { script });
      assertEq(code, 0, 'exit 0');
      assert(said.includes('drift check did not finish'), `it says the check failed, got: ${said}`);
      cleanup(world.root); cleanup(kit);
    });
  } else {
    group('workkit update: the schedule: skipped, launchd is macOS (#114)');
  }

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
