// Tests for workflow/workkit.js: `publish`, `doctor` (the schedule on each
// system among it, an incomplete kit, and on Windows the workkit.cmd and PATH
// lines), and the output contract the two speak with `update --auto`.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const {
  LABEL, cleanup, mkWorld, runCli, mkRepo, mkPartialKit, mkSetupKit, signIn, signInEnv, mkScheduleKit, inNode, windowsForm,
  npmrcEnv, machineLinks, lines,
} = require('./helpers');

/** `doctor(kit)` of the kit at `script` (the real one by default), called in a node of its own as `platform` runs it. */
const doctorOn = (world, platform, { script, env } = {}) => inNode(world, {
  ...(script ? { engine: path.dirname(script) } : {}), file: 'workkit/doctor.js', fn: 'doctor', kit: { platform }, env,
});

describe('workkit publish', () => {
  test('publish delegates to the engine’s script, which skips an untouched machine', () => {
    // An untouched machine has no home repo, the first thing the engine asks
    // for: the roster refresh needs the clone and runs above the publish switch.
    // The engine's reason, printed in this voice.
    const world = mkWorld();
    const { code, out } = runCli(world, ['publish']);
    expect(code, 'a machine that publishes nothing is not broken').toBe(0);
    expect(/publish: no home repo/.test(out), `the engine's own reason comes through, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit doctor', () => {
  test('a bare machine hears what is missing and how to fix each', () => {
    const world = mkWorld({ pluginInstalled: false, ghAuthed: false });
    const { code, said } = runCli(world, ['doctor']);
    expect(code, 'a report is a report: exit 0').toBe(0);
    expect(said.includes('plugin:') && said.includes('workkit setup'), `the plugin is missing, got: ${said}`).toBeTruthy();
    expect(said.includes('gh auth login'), 'gh is not authenticated').toBeTruthy();
    expect(said.includes('engine:'), 'the engine address is reported').toBeTruthy();
    expect(said.includes('command:'), 'and the symlink').toBeTruthy();
    expect(/\d+ item\(s\) need attention/.test(said), `it counts them, got: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a set-up machine reports everything current', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    const { kit, script } = mkSetupKit();
    runCli(world, ['setup'], { cwd: repo, script });
    // Signed in, the identity check counts nothing; the repo has no origin, so
    // no installation is asked.
    signIn(world);
    const { out } = runCli(world, ['doctor'], { cwd: repo, script });
    expect(out.includes('Everything this command can see is current'), `no drift after a setup, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('the global layer is reported: the roster count and the home repo', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const repo = mkRepo({ optIn: true });
    // A heal of the repo is what puts it on the roster, so `doctor` has a real
    // count to read rather than a seeded one.
    runCli(world, ['enable', repo]);
    const { said } = runCli(world, ['doctor'], { cwd: repo });
    expect(/roster: 1 repo\(s\) registered/.test(said), `it counts the roster, got: ${said}`).toBeTruthy();
    expect(/home: not set/.test(said) && said.includes('workkit setup'), `and says which command makes one, got: ${said}`).toBeTruthy();

    const settings = path.join(world.workflowHome, 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    parsed.site = { ...(parsed.site || {}), repo: 'owner/private-home' };
    fs.writeFileSync(settings, JSON.stringify(parsed, null, 2));
    const named = runCli(world, ['doctor'], { cwd: repo }).said;
    expect(/home: owner\/private-home/.test(named), `it reports the home repo once it is named, got: ${named}`).toBeTruthy();
    expect(/nothing is cloned at/.test(named), `and that the tower is not cloned yet, got: ${named}`).toBeTruthy();
    expect(/tower/.test(named), 'naming the path setup would clone it into').toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });

  test('a machine with no user settings yet is told the first heal writes it', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['doctor']);
    expect(/roster: .*does not exist yet/.test(out), `no invented count, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a checkout without home.js names it once under the home repo, as an incomplete kit, and doctor still finishes', () => {
    // The home steps start home.js; a kit without it keeps the one guarded line.
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const { code, err, said } = runCli(world, ['doctor'], { script });
    expect(code, `doctor still finishes, got: ${said}`).toBe(0);
    const home = err.split('\n').filter((l) => /^ +⚠ home: /.test(l));
    expect(home.length, `one home warning, got: ${said}`).toBe(1);
    expect(home[0].includes('home.js') && home[0].includes('the kit is incomplete'), `it names home.js and the incomplete kit, got: ${home[0]}`).toBeTruthy();
    expect(/\d+ item\(s\) need attention/.test(said), `and it is counted, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('an empty roster reports as a notice, not as a green check', () => {
    // Zero registered means the tower, the board and the brief have nothing to
    // read: the one count that must not read as everything being fine.
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.workflowHome, { recursive: true });
    fs.writeFileSync(
      path.join(world.workflowHome, '.repos.json'),
      JSON.stringify({ version: 1, repos: {} }, null, 2),
    );
    const { out } = runCli(world, ['doctor']);
    const line = out.split('\n').find((l) => l.includes('roster:'));
    expect(line && !/repo\(s\) registered/.test(line), `an empty roster never reads as a count, got: ${line}`).toBeTruthy();
    expect(/fills as a session opens/.test(line), `and it says how it fills, got: ${line}`).toBeTruthy();
    cleanup(world.root);
  });
});

// The road a Mac and a Windows machine share, read from the installer's
// `--check` alone: the system handed to the doctor, the installer a stand-in.
describe('workkit doctor: the schedule on each system', () => {
  const attention = (said) => Number((said.match(/(\d+) item\(s\) need attention/) || [])[1] || 0);

  for (const [system, platform] of [['a Mac', 'darwin'], ['Windows', 'win32']]) {
    test(`${system}: a current job is reported, one not installed or out of date is one more thing to fix`, () => {
      const world = mkWorld();
      const sched = mkScheduleKit('');
      const current = doctorOn(world, platform, { script: sched.script }).said;
      expect(current.includes(`schedule: ${LABEL} is installed and current`), `current, got: ${current}`).toBeTruthy();

      sched.check(`${LABEL} → not installed`);
      const missing = doctorOn(world, platform, { script: sched.script }).said;
      expect(missing.includes('schedule: the 9am job is not installed; run `workkit setup`'), `not installed, got: ${missing}`).toBeTruthy();
      expect(attention(missing), `one more item than a current job: ${missing}`).toBe(attention(current) + 1);

      sched.check(`${LABEL} → out of date for this kit`);
      const drifted = doctorOn(world, platform, { script: sched.script }).said;
      expect(drifted.includes(`schedule: ${LABEL} → out of date for this kit; run \`workkit update\``), `out of date, got: ${drifted}`).toBeTruthy();
      expect(attention(drifted), `one more item than a current job: ${drifted}`).toBe(attention(current) + 1);
      expect(sched.installs(), `the doctor installs nothing: ${fmtCalls(sched.runs())}`).toEqual([]);
      cleanup(world.root); cleanup(sched.kit);
    });
  }

  test('any other system: the skip line, and the installer never runs', () => {
    const world = mkWorld();
    const sched = mkScheduleKit(`${LABEL} → not installed`);
    const { code, said } = doctorOn(world, 'linux', { script: sched.script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(said.split('\n').some((l) => / schedule: the 9am job runs on macOS and Windows$/.test(l)), `the skip line, got: ${said}`).toBeTruthy();
    expect(sched.runs(), `no installer run at all: ${fmtCalls(sched.runs())}`).toEqual([]);
    cleanup(world.root); cleanup(sched.kit);
  });
});

describe('workkit doctor on each system: workkit.cmd and the PATH line', () => {
  /**
   * The doctor of the real kit as `platform` runs it, on a machine whose command
   * link the machine steps of a Mac made (so no workkit.cmd), with ~/.local/bin
   * off its PATH; every reporting line on stderr, so the lines read in their order.
   */
  const doctorLines = (platform) => {
    const world = mkWorld();
    const env = { ...signInEnv(world, { node: false }), ...npmrcEnv(world) };
    machineLinks(world, { kit: { platform: 'darwin' }, env });
    const res = doctorOn(world, platform, { env: { ...env, WK_LOG_STDERR: '1' } });
    cleanup(world.root);
    return { world, res, lines: lines(res.err) };
  };

  test('on Windows the workkit.cmd line and the PATH line come with the command link under This machine; on a Mac neither', () => {
    const win = doctorLines('win32');
    const at = (match) => win.lines.findIndex(match);
    const machine = at((l) => l === '💻 This machine');
    const home = at((l) => l === '🏠 Home repo');
    const link = at((l) => l.startsWith(`✓ command: ${gitPath(win.world.link)} → `));
    const shim = at((l) => /^\S+ gh shim: /.test(l));
    const cmd = at((l) => l === `⚠ command: ${gitPath(path.join(win.world.localBin, 'workkit.cmd'))} is missing or differs; run \`workkit update\``);
    const onPath = at((l) => l.startsWith('⚠ command:') && l.includes(windowsForm(win.world.localBin)) && l.includes('PATH'));
    expect(machine >= 0 && home > machine && link > machine, `the sections and the command link's line, got: ${win.res.said}`).toBe(true);
    expect(cmd > link && cmd < shim && shim < home, `the workkit.cmd line follows the command link, before the gh shim, got: ${win.res.said}`).toBe(true);
    expect(onPath > link && onPath < shim, `the PATH line follows the command link, before the gh shim, got: ${win.res.said}`).toBe(true);

    const mac = doctorLines('darwin');
    expect(mac.lines.some((l) => l.includes('workkit.cmd')), `a Mac's doctor names no workkit.cmd, got: ${mac.res.said}`).toBe(false);
    expect(mac.lines.some((l) => l.includes(windowsForm(mac.world.localBin))), `nor the folder in its Windows form, got: ${mac.res.said}`).toBe(false);
    expect(mac.lines.includes(`⚠ command: ${gitPath(mac.world.localBin)} is not on your PATH; add \`export PATH="$HOME/.local/bin:$PATH"\` to your shell rc`),
      `its PATH line is the shell rc line, got: ${mac.res.said}`).toBe(true);
  });
});

describe('workkit-cli: the output contract (#237)', () => {
  // One shape for every line a person reads: a glyph, the message, and no
  // timestamp or module tag; a heading opens with its caller's emoji instead.
  // `setup` is left out because a prompt has no newline, so it is not a log line.
  const LEVEL = /^ {0,2}[✓·›⚠✖⏳] /;
  const HEADING = /^[^\x00-\x7F]+ \S/;
  const OLD_TAG = /\[\d\d:\d\d:\d\d\]|\[workkit:/;

  for (const [name, args] of [['doctor', ['doctor']], ['update --auto', ['update', '--auto']], ['publish', ['publish']]]) {
    test(`${name} speaks the one line shape, a glyph per outcome`, () => {
      const world = mkWorld({ pluginInstalled: true, binOnPath: true });
      // ~/.local/bin exists here, so `update --auto` has the one thing it will
      // actually do in this world: a run that said nothing would pass every
      // check below without meaning any of them.
      fs.mkdirSync(world.localBin, { recursive: true });
      const { out, err, said } = runCli(world, args);
      expect(said.trim().length > 0, `${name} said something, got: ${JSON.stringify(said)}`).toBeTruthy();
      expect(!OLD_TAG.test(said), `no timestamp and no module tag, got: ${JSON.stringify(said)}`).toBeTruthy();
      for (const [stream, text] of [['stdout', out], ['stderr', err]]) {
        for (const line of text.split('\n').filter(Boolean)) {
          expect(LEVEL.test(line) || HEADING.test(line),
            `every line on ${stream} is a glyph line or a heading, got: ${JSON.stringify(line)}`).toBeTruthy();
        }
      }
      cleanup(world.root);
    });
  }
});
