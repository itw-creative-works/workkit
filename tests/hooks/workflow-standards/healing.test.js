// Tests for workflow:standards's logic: healing a repo, and relaying only the
// lines the engine itself printed, with the indent and the glyph taken off.
// The heal results are the real engine's. The shared prologue is ./helpers.js;
// "a subdirectory session resolves to the repo root" is hooks/session-start.test.ts.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath, homeEnv } = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { runResult } = require('../../lib/mods-inputs');
const {
  WORKFLOW_DIR, BASE_PATH, cleanup, makeRepo, heal, say, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: healing a repo');

  await test('ports "unstandardized repo: heals it and reports what changed"', () => {
    const repo = makeRepo();
    const ctx = say({ participation: 'enabled' }, heal(repo));
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the engine healed the repo');
    assert(ctx.includes('issue forms'), `reports the forms, got: ${ctx}`);
    assert(ctx.includes('gitignore'), `reports the gitignore heal, got: ${ctx}`);
    assert(!ctx.includes('\x1b'), 'no ANSI colors');
    cleanup(repo);
  });

  await test('ports "already-standardized repo: silent (skips are not news)"', () => {
    const repo = makeRepo();
    assert(say({ participation: 'enabled' }, heal(repo)).length > 0, 'the first heal reported');
    assertEq(say({ participation: 'enabled' }, heal(repo)), '', 'an all-skip run stays silent');
    cleanup(repo);
  });

  // The heal's capture is both streams, so a child tool the engine ran writes
  // into it too; only a line in the engine's own voice is a heal action.
  await test('ports "a raw line from a child tool is not relayed as a heal action"', () => {
    const result = runResult({ stderr: '  ✓ gitignore: added .workkit/*\ncp: /nowhere/thing: No such file or directory\n' });
    const ctx = say({ participation: 'enabled' }, result);
    assert(ctx.includes('gitignore: added'), `the engine's own line is relayed, got: ${ctx}`);
    assert(!ctx.includes('cp:'), `and the child tool's is not, got: ${ctx}`);
  });

  // A real logger line through the relay, so the shape it filters on can never
  // drift from the shape the engine prints.
  await test('ports "the relay\'s pattern matches a line the engine really prints"', () => {
    const lib = shellPath(path.join(WORKFLOW_DIR, 'lib.sh'));
    const said = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(lib)}; WK_LOG_INDENT='  '; WK_LOG_STDERR=1 wk_ok 'engine: linked a to b'`], {
      encoding: 'utf8', env: homeEnv(mkTmp('wf-hook-'), { PATH: BASE_PATH, WORKKIT_COLOR: '0' }),
    });
    assertEq(said.status, 0, `the logger ran, got: ${said.stderr}`);
    const ctx = say({ participation: 'enabled' }, runResult({ stdout: said.stdout, stderr: said.stderr }));
    assert(ctx.split('\n').includes('engine: linked a to b'), `relayed whole, indent and glyph off, got: ${JSON.stringify(ctx)}`);
  });

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
