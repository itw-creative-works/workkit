//
// Tests for workflow/workkit.sh: `publish`, `doctor`, and the output
// contract the two speak with `update --auto`.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, runCli, mkRepo } = require('./helpers');

const run = async () => {
  group('workkit publish');

  await test('publish delegates to the engine’s script, which skips an untouched machine', () => {
    // An untouched machine has no home repo, and since issue #111 that is the
    // first thing the engine asks for: the roster refresh needs the clone and
    // runs above the publish switch, so a machine with neither hears about the
    // one `workkit setup` fixes. The engine's reason, printed in this voice.
    const world = mkWorld();
    const { code, out } = runCli(world, ['publish']);
    assertEq(code, 0, 'a machine that publishes nothing is not broken');
    assert(/publish: no home repo/.test(out), `the engine's own reason comes through, got: ${out}`);
    cleanup(world.root);
  });

  await test('the map names it', () => {
    const world = mkWorld();
    assert(runCli(world, ['help']).out.includes('publish'), 'one command, and publish is reachable from it');
    cleanup(world.root);
  });

  await test('update --auto never builds a site at session start', () => {
    // The daily job publishes; a session start that ran an app build would cost
    // minutes nobody asked for.
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { out } = runCli(world, ['update', '--auto']);
    assert(!/publish:/.test(out), `the quiet path says nothing about the site, got: ${out}`);
    cleanup(world.root);
  });

  group('workkit doctor');

  await test('a bare machine hears what is missing and how to fix each', () => {
    const world = mkWorld({ pluginInstalled: false, ghAuthed: false });
    const { code, said } = runCli(world, ['doctor']);
    assertEq(code, 0, 'a report is a report: exit 0');
    assert(said.includes('plugin:') && said.includes('workkit setup'), `the plugin is missing, got: ${said}`);
    assert(said.includes('gh auth login'), 'gh is not authenticated');
    assert(said.includes('engine:'), 'the engine address is reported');
    assert(said.includes('command:'), 'and the symlink');
    assert(/\d+ item\(s\) need attention/.test(said), `it counts them, got: ${said}`);
    cleanup(world.root);
  });

  await test('a set-up machine reports everything current', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });
    const { out } = runCli(world, ['doctor'], { cwd: repo });
    assert(out.includes('Everything this command can see is current'), `no drift after a setup, got: ${out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('the global layer is reported: the roster count and the home repo', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const repo = mkRepo({ optIn: true });
    // A heal of the repo is what puts it on the roster, so `doctor` has a real
    // count to read rather than a seeded one.
    runCli(world, ['enable', repo]);
    const { said } = runCli(world, ['doctor'], { cwd: repo });
    assert(/roster: 1 repo\(s\) registered/.test(said), `it counts the roster, got: ${said}`);
    assert(/home: not set/.test(said) && said.includes('workkit setup'), `and says which command makes one, got: ${said}`);

    const settings = path.join(world.workflowHome, 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    parsed.site = { ...(parsed.site || {}), repo: 'owner/private-home' };
    fs.writeFileSync(settings, JSON.stringify(parsed, null, 2));
    const named = runCli(world, ['doctor'], { cwd: repo }).said;
    assert(/home: owner\/private-home/.test(named), `it reports the home repo once it is named, got: ${named}`);
    assert(/nothing is cloned at/.test(named), `and that the tower is not cloned yet, got: ${named}`);
    assert(/tower/.test(named), 'naming the path setup would clone it into');
    cleanup(world.root); cleanup(repo);
  });

  await test('a machine with no user settings yet is told the first heal writes it', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['doctor']);
    assert(/roster: .*does not exist yet/.test(out), `no invented count, got: ${out}`);
    cleanup(world.root);
  });

  await test('an empty roster reports as a notice, not as a green check', () => {
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
    assert(line && !/repo\(s\) registered/.test(line), `an empty roster never reads as a count, got: ${line}`);
    assert(/fills as a session opens/.test(line), `and it says how it fills, got: ${line}`);
    cleanup(world.root);
  });

  group('workkit-cli: the output contract (#237)');

  // One shape for every line a person reads: a GLYPH for what happened, the
  // message after it, and no timestamp or module tag anywhere on the line. A
  // heading (a command's title, a section, the closing line) is the one other
  // shape, and it opens with the emoji its caller chose. The commands below are
  // the three a piped run can drive end to end with the stubs this suite
  // already has; `setup` is left out because its prompts are not log lines (a
  // prompt has no newline: the answer is typed on it).
  const LEVEL = /^ {0,2}[✓·›⚠✖⏳] /;
  const HEADING = /^[^\x00-\x7F]+ \S/;
  const OLD_TAG = /\[\d\d:\d\d:\d\d\]|\[workkit:/;

  for (const [name, args] of [['doctor', ['doctor']], ['update --auto', ['update', '--auto']], ['publish', ['publish']]]) {
    await test(`${name} speaks the one line shape, a glyph per outcome`, () => {
      const world = mkWorld({ pluginInstalled: true, binOnPath: true });
      // ~/.local/bin exists here, so `update --auto` has the one thing it will
      // actually DO in this world: a run that said nothing would pass every
      // check below without meaning any of them.
      fs.mkdirSync(world.localBin, { recursive: true });
      const { out, err, said } = runCli(world, args);
      assert(said.trim().length > 0, `${name} said something, got: ${JSON.stringify(said)}`);
      assert(!OLD_TAG.test(said), `no timestamp and no module tag, got: ${JSON.stringify(said)}`);
      for (const [stream, text] of [['stdout', out], ['stderr', err]]) {
        for (const line of text.split('\n').filter(Boolean)) {
          assert(LEVEL.test(line) || HEADING.test(line),
            `every line on ${stream} is a glyph line or a heading, got: ${JSON.stringify(line)}`);
        }
      }
      cleanup(world.root);
    });
  }

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
