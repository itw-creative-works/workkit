// Tests for workflow/home.sh: the setup wizard's Pages step (the gh-pages root
// asked for, a refusal warned, no branch made by setup).
// The shared prologue is ./helpers.js.

const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, inHome, setup } = require('./helpers');

const cases = async () => {
  group('workflow/home: the wizard, Pages');

  await test('Pages is asked for the gh-pages branch at its root, and a refusal warns with the fix', () => {
    const world = mkWorld({ login: 'owner' });
    const ok = inHome(world, 'wk_home_pages owner/workkit');
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('POST'));
    assert(posted && posted.includes('source[branch]=gh-pages'), `the branch that carries only the build: ${fmtCalls(world.ghCalls())}`);
    assert(posted.includes('source[path]=/'), 'served from its root, so no folder is named for a Pages rule');
    assert(!posted.includes('/docs'), 'and nothing on main is published at all');
    assert(/serves .* from gh-pages \//.test(ok.out), `and it says so, got: ${ok.out}`);

    const refused = mkWorld({ login: 'owner', pagesFails: true });
    const { code, out } = inHome(refused, 'wk_home_pages owner/workkit');
    assertEq(code, 0, 'a refusal never stops the wizard');
    assert(/paid plan/.test(out) && /settings\/pages/.test(out), `it warns with the fix, got: ${out}`);
    cleanup(world.root); cleanup(refused.root);
  });

  await test('setup creates no branch: the publish makes gh-pages when it first pushes', () => {
    // The wizard creates the repo, Discussions and Pages;
    // a branch is generated output and belongs to whatever generates it.
    const world = mkWorld({ login: 'owner' });
    setup(world);
    const branches = spawnSync('git', ['-C', world.tower, 'branch', '-a'], { encoding: 'utf8' }).stdout;
    assert(!/gh-pages/.test(branches), `no gh-pages anywhere yet: ${branches}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
