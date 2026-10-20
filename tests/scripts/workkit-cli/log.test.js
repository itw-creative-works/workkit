// Tests for workflow/workkit.sh: `workkit log`, which prints the tail of the
// hook log in the workkit home (WORKFLOW_HOME/hooks.log).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkWorld, runCli } = require('./helpers');

// A world whose hook log holds `count` numbered lines; returns them too.
const withLog = (count) => {
  const world = mkWorld();
  const lines = Array.from({ length: count }, (_, i) => `2026-10-18T00:00:${String(i).padStart(2, '0')}Z\tdocs:checkpoint\tUserPromptSubmit\ts1\t/repo\trun ${i + 1}`);
  fs.mkdirSync(world.workflowHome, { recursive: true });
  fs.writeFileSync(path.join(world.workflowHome, 'hooks.log'), `${lines.join('\n')}\n`);
  return { world, lines };
};

const printed = (out) => out.split('\n').filter(Boolean);

const run = async () => {
  group('workkit log');

  await test('a 60-line log prints its last 40 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log']);
    assertEq(code, 0, 'exit 0');
    assertEq(JSON.stringify(printed(out)), JSON.stringify(lines.slice(-40)), 'the last 40 lines, in order');
    cleanup(world.root);
  });

  await test('-n 5 prints the last 5 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log', '-n', '5']);
    assertEq(code, 0, 'exit 0');
    assertEq(JSON.stringify(printed(out)), JSON.stringify(lines.slice(-5)), 'the last 5 lines, in order');
    cleanup(world.root);
  });

  await test('no log prints one skip line and exits 0', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['log']);
    assertEq(code, 0, 'exit 0');
    assertEq(printed(said).length, 1, `one line, got: ${JSON.stringify(said)}`);
    assert(!/unknown command/.test(said), `the command is known, got: ${said}`);
    assert(!fs.existsSync(path.join(world.workflowHome, 'hooks.log')), 'reading creates no log');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
