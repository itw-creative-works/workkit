// Tests for workflow/workkit.sh: `publish`, `doctor`, and the output
// contract the two speak with `update --auto`.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const {
  cleanup, mkWorld, runCli, mkRepo, mkPartialKit, mkSetupKit,
} = require('./helpers');

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
    // The world has no node, so the identity check is a skip and counts nothing.
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

  test('a checkout without the engine library names the gap, never a roster path', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const { code, said } = runCli(world, ['doctor'], { script });
    expect(code, 'doctor still finishes').toBe(0);
    const line = said.split('\n').find((l) => l.includes('roster:'));
    expect(line && line.includes('library is missing'), `the missing library is named, got: ${line}`).toBeTruthy();
    expect(!line.includes('.repos.json'), `and no path it cannot know, got: ${line}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a checkout without the platform library still answers the cloud read', () => {
    // doctor asks wk_is_cloud in several sections; a kit missing platform.sh
    // gets the entry's own fallback, never a shell error in the report.
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const { code, said } = runCli(world, ['doctor'], { script });
    expect(code, `doctor still finishes, got: ${said}`).toBe(0);
    expect(!said.includes('command not found'), `no function is missing, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a checkout without the platform library reads links that already exist', () => {
    // An existing engine address and command link are each asked whether a
    // clone outranks this kit, a question platform.sh alone answers.
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const elsewhere = path.join(world.root, 'elsewhere', 'workflow');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.symlinkSync(elsewhere, world.engineLink);
    fs.symlinkSync(path.join(elsewhere, 'workkit.sh'), world.link);
    const { code, said } = runCli(world, ['doctor'], { script });
    expect(code, `doctor still finishes, got: ${said}`).toBe(0);
    expect(!said.includes('command not found'), `no function is missing, got: ${said}`).toBeTruthy();
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
