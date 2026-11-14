// Tests for workflow/workkit.sh: `update`: the three links, the quiet
// `--auto` variant, and on macOS the schedule and a checkout or an installer
// that cannot answer.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, hasLaunchd, mkTmp,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, WINDOWS_CSC, gitPath, which,
} = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  WORKFLOW_DIR, CLI, LABEL, cleanup, mkWorld, withNpm, runCli, signInEnv, ACTED, mkRepo, installSchedule,
  mkPartialKit, mkSetupKit,
} = require('./helpers');
const { writeLogin } = require('../../lib/identity');

describe('workkit update: the three links', () => {
  test('the engine address is pointed at this checkout', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, out } = runCli(world, ['update']);
    expect(code, `exit 0: stderr says: ${out}`).toBe(0);
    expect(fs.realpathSync(world.engineLink), 'the address resolves to the engine').toBe(fs.realpathSync(WORKFLOW_DIR));
    expect(out.includes('engine:'), `and it reported the link, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a second run reads the address back before calling it current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { out } = runCli(world, ['update']);
    expect(out.includes(`engine: ${gitPath(world.engineLink)} is current`), `an address that resolves here IS current, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('an engine that refuses the address never reports "is current"', () => {
    // A copy of the engine outside any checkout: standards.sh declines to take
    // the machine's address and says nothing, and silence is not agreement.
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const kit = mkTmp('workkit-cli-');
    fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
    const { code, out } = runCli(world, ['update'], { script: path.join(kit, 'workflow', 'workkit.sh') });
    expect(code, 'exit 0').toBe(0);
    expect(!fs.existsSync(world.engineLink), 'nothing was written at the address').toBeTruthy();
    expect(!out.includes('is current'), `a refusal never reads as up to date, got: ${out}`).toBeTruthy();
    expect(out.includes('was left as it is'), `and the run says the address went unwritten, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('the command is linked into ~/.local/bin', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    expect(fs.readlinkSync(world.link), 'the symlink points at this script').toBe(CLI);
    expect(out.includes('linked'), `and says so, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a link left by a moved checkout is repointed', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync('/somewhere/else/workflow/workkit.sh', world.link);
    const { out } = runCli(world, ['update']);
    expect(fs.readlinkSync(world.link), 'repointed at this checkout').toBe(CLI);
    expect(out.includes('repointed'), `and says so, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a real file at the address is reported, never replaced', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.writeFileSync(world.link, 'someone else’s script\n');
    const { code, said } = runCli(world, ['update']);
    expect(code, 'exit 0').toBe(0);
    expect(said.includes('is a real file'), `it says what is in the way, got: ${said}`).toBeTruthy();
    expect(fs.readFileSync(world.link, 'utf8'), 'and the file is untouched').toBe('someone else’s script\n');
    cleanup(world.root);
  });

  test('run THROUGH the symlink, it still stands in the real checkout', () => {
    // The failure this guards: taking the dirname before resolving the link
    // makes ~/.local/bin the checkout, so every path under it (the engine, the
    // installer, the symlink itself) names a file that does not exist, and the
    // command repoints its own address at nothing.
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    const { kit, script } = mkSetupKit();
    runCli(world, ['setup'], { cwd: repo, script });

    const viaLink = runCli(world, ['update'], { cwd: repo, script: world.link });
    expect(viaLink.code, `exit 0: stderr: ${viaLink.err}`).toBe(0);
    expect(viaLink.out.includes(gitPath(kit)), `it names the real checkout, got: ${viaLink.out}`).toBeTruthy();
    expect(fs.readlinkSync(world.link), 'and its own address still points at the real CLI').toBe(script);

    // The world has no node, so the identity check is a skip and counts nothing.
    const doctor = runCli(world, ['doctor'], { cwd: repo, script: world.link });
    expect(doctor.out.includes('Everything this command can see is current'), `no invented drift through the link, got: ${doctor.out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('a PATH without ~/.local/bin gets the export line, and no rc file is touched', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    expect(out.includes('export PATH='), `it prints the line to add, got: ${out}`).toBeTruthy();
    expect(!fs.existsSync(path.join(world.home, '.zshrc')), 'and writes nobody’s shell rc').toBeTruthy();
    cleanup(world.root);
  });

  test('a second update reports nothing to do', () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.mkdirSync(world.localBin, { recursive: true });
    const first = runCli(world, ['update']);
    expect(ACTED.test(first.said), `the first run had something to do, got: ${first.said}`).toBeTruthy();
    // The answer is structural, not a word list: `--auto` is the same run with
    // QUIET=1, which silences every skip and note, so an empty stdout is
    // "nothing was done".
    const { code, out } = runCli(world, ['update', '--auto']);
    expect(code, 'exit 0').toBe(0);
    expect(out, `nothing was done the second time, got: ${out}`).toBe('');
    cleanup(world.root);
  });
});

describe('workkit update --auto: the quiet variant', () => {
  test('it introduces no ~/.local/bin to a machine that has none', () => {
    // The same restraint the engine shows with ~/.claude: the automatic path
    // keeps an address current, and never invents a convention at session start.
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    expect(code, 'exit 0').toBe(0);
    expect(!fs.existsSync(world.localBin), 'the directory is a human’s to ask for').toBeTruthy();
    expect(out, `and nothing is said about it, got: ${out}`).toBe('');
    cleanup(world.root);
  });

  test('an existing ~/.local/bin gets the link kept current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    const { out } = runCli(world, ['update', '--auto']);
    expect(fs.readlinkSync(world.link), 'a machine with the convention gets the address').toBe(CLI);
    expect(out.includes('command:'), `and hears about it, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  const scriptShellSkip = (IS_WINDOWS && !fs.existsSync(WINDOWS_CSC)
    && `no C# compiler at ${WINDOWS_CSC}, so the script shell cannot be built`)
    || (!which('npm', NODE_DIR) && 'no npm beside this node');
  test('an unset npm script-shell is left unset and unsaid; a human update sets it', { skip: scriptShellSkip }, () => {
    // The automatic path runs at session start, so the machine's npm config is
    // changed only on a human's run, and the commit gate is where it is named.
    const world = mkWorld();
    // A claude home lets the update lay the engine address the wrapper is named through.
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { npmrc, env } = withNpm(world);
    const auto = runCli(world, ['update', '--auto'], { env });
    expect(auto.code, 'exit 0').toBe(0);
    expect(!auto.said.includes('npm:'), `session start hears nothing about npm, got: ${auto.said}`).toBeTruthy();
    expect(!fs.existsSync(npmrc), 'and no npm config was written').toBeTruthy();
    runCli(world, ['update'], { env });
    expect(fs.readFileSync(npmrc, 'utf8').includes('script-shell='), 'a human update sets it').toBeTruthy();
    const again = runCli(world, ['update', '--auto'], { env });
    expect(!again.said.includes('npm:'), `a current value is silent under --auto, got: ${again.said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a foreign npm script-shell is unsaid under --auto and warned about on a human update', { skip: scriptShellSkip }, () => {
    const world = mkWorld();
    const { npmrc, env } = withNpm(world);
    fs.writeFileSync(npmrc, 'script-shell=/opt/other/shell\n');
    const auto = runCli(world, ['update', '--auto'], { env });
    expect(auto.code, 'exit 0').toBe(0);
    expect(!auto.said.includes('npm:'), `session start hears nothing about npm, got: ${auto.said}`).toBeTruthy();
    const human = runCli(world, ['update'], { env });
    expect(/npm: script-shell is \/opt\/other\/shell, set by someone else/.test(human.err), `a human hears it, got: ${human.said}`).toBeTruthy();
    expect(human.err.includes('`npm config set script-shell'), `with the command that changes it, got: ${human.err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('an exported npm_config_script_shell is named as the source, not npm config set', { skip: scriptShellSkip }, () => {
    // npm's environment outranks every npmrc, so `npm config set` would change
    // nothing npm sees. The value is git's spelling, which Git Bash leaves alone
    // in a child's env: it rewrites only a value starting with `/`.
    const world = mkWorld();
    const other = gitPath(path.join(world.root, 'other-shell'));
    const { env } = withNpm(world);
    const { code, err, said } = runCli(world, ['update'], { env: { ...env, npm_config_script_shell: other } });
    expect(code, 'exit 0').toBe(0);
    expect(err.includes(`npm: script-shell is ${other}, exported as npm_config_script_shell by your shell`),
      `the export is named, got: ${said}`).toBeTruthy();
    expect(!said.includes('npm config set'), `and no config command is offered, got: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('an unknown option is refused', () => {
    const world = mkWorld();
    const { code, err } = runCli(world, ['update', '--everything']);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('unknown option'), `says so, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('with no schedule installed, launchd is never asked', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    expect(code, 'exit 0').toBe(0);
    expect(!fs.existsSync(world.plist()), 'the quiet path never installs a schedule fresh').toBeTruthy();
    expect(world.launchctl().length, `and launchd is not touched: ${fmtCalls(world.launchctl())}`).toBe(0);
    expect(!out.includes('schedule'), `the missing schedule is not news at session start, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit update: the sign-in line', () => {
  test('--auto with no login file warns naming workkit setup --login and still exits 0', () => {
    const world = mkWorld();
    try {
      const { code, said } = runCli(world, ['update', '--auto'], { env: signInEnv(world) });
      expect(code, `exit 0, got: ${said}`).toBe(0);
      expect(said.includes('identity: not signed in; run `workkit setup --login`'), `session start hears the sign-in is missing, got: ${said}`).toBeTruthy();
    } finally {
      cleanup(world.root);
    }
  });

  test('--auto with a login file holding a token prints no identity line', () => {
    const world = mkWorld();
    try {
      writeLogin(world.home, { token: 'ghu_updateuser', login: 'octocat' });
      const { code, said } = runCli(world, ['update', '--auto'], { env: signInEnv(world) });
      expect(code, `exit 0, got: ${said}`).toBe(0);
      expect(!said.includes('identity:'), `a signed-in machine hears nothing about it at session start, got: ${said}`).toBeTruthy();
    } finally {
      cleanup(world.root);
    }
  });

  test('a human update with a login file holding octocat names the login', () => {
    const world = mkWorld();
    try {
      writeLogin(world.home, { token: 'ghu_updateuser', login: 'octocat' });
      const { code, said } = runCli(world, ['update'], { env: signInEnv(world) });
      expect(code, `exit 0, got: ${said}`).toBe(0);
      expect(said.includes('identity: signed in as @octocat'), `a human run prints the ok line, got: ${said}`).toBeTruthy();
    } finally {
      cleanup(world.root);
    }
  });
});

// Everything below is launchd's: a machine without `launchctl` has no
// schedule to name, install or keep current, and the engine says so itself
// rather than acting (`launchd is macOS`). The cases are named as skips there
// instead of asserting a capability that is not on the machine.
describe('workkit update: the schedule (macOS)', { skip: !hasLaunchd() && 'launchd is macOS (#114)' }, () => {
  test('run by a human, a missing schedule names the command that installs it', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    expect(out.includes('workkit setup'), `it points at setup, got: ${out}`).toBeTruthy();
    expect(!fs.existsSync(world.plist()), 'and still installs nothing').toBeTruthy();
    cleanup(world.root);
  });

  test('a current schedule is left alone, and launchd is not asked', () => {
    const world = mkWorld();
    installSchedule(world);
    const before = world.launchctl().length;
    const { out } = runCli(world, ['update', '--auto']);
    expect(world.launchctl().length, `no launchctl call for a current schedule: ${fmtCalls(world.launchctl())}`).toBe(before);
    expect(!out.includes('schedule'), `and nothing to report, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a schedule that drifted is re-rendered and reloaded', () => {
    const world = mkWorld();
    installSchedule(world);
    fs.appendFileSync(world.plist(), '\n<!-- from an older checkout -->\n');
    const before = world.launchctl().length;

    const { code, out } = runCli(world, ['update', '--auto']);
    expect(code, 'exit 0').toBe(0);
    expect(!fs.readFileSync(world.plist(), 'utf8').includes('older checkout'), 'the stale plist is replaced').toBeTruthy();
    const added = world.launchctl().slice(before);
    expect(added.some((c) => isCall(c, 'bootstrap')), `and it is reloaded: ${fmtCalls(added)}`).toBeTruthy();
    expect(out.includes('schedule:'), `the session hears what changed, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit: a checkout or an installer that cannot answer (macOS)', { skip: !hasLaunchd() && 'launchd is macOS (#114)' }, () => {
  test('a checkout missing its installer says so, never "current"', () => {
    const world = mkWorld();
    world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
    const { kit, script } = mkPartialKit();
    const { code, said } = runCli(world, ['update'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(said.includes('standards.sh is missing'), `the missing engine is named, got: ${said}`).toBeTruthy();
    expect(said.includes('installer is missing'), `and so is the missing installer, got: ${said}`).toBeTruthy();
    expect(!said.includes('is current'), 'an incomplete checkout never reads as up to date').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('an installer that fails is reported, and the run still finishes', () => {
    // install.sh exits hard on a missing template or a plist that fails lint.
    // Unguarded under `set -e` that abort is invisible inside the hook, which
    // discards stderr, and retries silently every day.
    const world = mkWorld();
    world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
    const { kit, script } = mkPartialKit({
      installer: [
        'if [[ "$1" == \'--check\' ]]; then printf \'com.workkit.claude-daily → out of date for this kit\\n\'; exit 0; fi',
        'printf \'template missing\\n\' >&2',
        'exit 1',
      ],
    });
    const { code, said } = runCli(world, ['update', '--auto'], { script });
    expect(code, 'a failed install never aborts the caller').toBe(0);
    expect(said.includes('did not finish'), `it says the install failed, got: ${said}`).toBeTruthy();
    expect(said.includes('install.sh'), 'and names the command to run by hand').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a drift check that cannot answer is not "current" either', () => {
    const world = mkWorld();
    world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
    const { kit, script } = mkPartialKit({ installer: ['exit 3'] });
    const { code, said } = runCli(world, ['update', '--auto'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(said.includes('drift check did not finish'), `it says the check failed, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });
});
