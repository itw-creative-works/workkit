// Tests for workflow:public-mirror: after a `gh issue edit` adding a status:
// label in a paired repo, the public issue takes that label. Each case runs the
// hook's entry on the post-Bash chain (hooks/mods/guards.js) with a real io, so
// the mirror it starts meets the fake GitHub of test/scripts/public/helpers.js.

const {
  group, test: testEverywhere, testUnless, assert, assertEq, until, summary, selfRun,
} = require('../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../lib/platform');
const { mods } = require('../lib/mods-inputs');
const { ioIn } = require('../lib/real-gate');
const { mkPublicWorld, publicLine, PUBLIC } = require('../scripts/public/helpers');

const HOOK = 'workflow:public-mirror';

// The mirror the hook starts runs gh by name from Node, which no stub answers on Windows.
const test = testUnless(IS_WINDOWS, NO_NODE_STUB);

/** The post-Bash chain's public-mirror entry over a Bash call that ran `command` in the repo. */
const posted = async (world, command) => {
  const { POST_BASH_GUARDS, runChain } = mods('guards');
  const entry = POST_BASH_GUARDS.filter((g) => g.hook === HOOK);
  assertEq(entry.length, 1, `${HOOK} is on the post-Bash chain once`);
  const chain = await runChain(ioIn(world.env), world.env, entry, { command, cwd: world.repo, failed: false });
  assert(!chain.error && !chain.deny, `the hook neither crashed nor denied, got: ${chain.error || chain.deny}`);
  return chain;
};

// The private issue is already at status:qa, its public one still at status:building.
const linkedWorld = (opts = {}) => mkPublicWorld({
  ...opts,
  issues: {
    private: [{
      number: 12, title: 'Split the lists', body: `${publicLine(44)}\n\nThe fix.`, labels: ['status:qa', 'type:bug', 'priority:high'],
    }],
    public: [{ number: 44, title: 'jsDelivr serves nothing over 20 MB', labels: ['status:building'] }],
  },
});
const publicLabels = (world) => JSON.stringify(world.gh.issue(PUBLIC, 44).labels);
const QA = JSON.stringify(['status:qa']);
const BUILDING = JSON.stringify(['status:building']);
// A negative case waits this long for a mirror that must not come.
const QUIET_MS = 1500;

const cases = async () => {
  group('workflow:public-mirror');

  await test('the hook fires on gh issue edit <N> --add-label status:qa in a paired repo', async () => {
    const world = linkedWorld();
    await posted(world, 'gh issue edit 12 --add-label status:qa');
    assert(await until(() => publicLabels(world) === QA), `the public issue took status:qa, got: ${publicLabels(world)}`);
  });

  await test('and not on an edit with no status: label', async () => {
    const world = linkedWorld();
    await posted(world, 'gh issue edit 12 --add-label priority:high');
    assert(!(await until(() => publicLabels(world) !== BUILDING, QUIET_MS)),
      `the public issue kept status:building, got: ${publicLabels(world)}`);
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written');
  });

  await testEverywhere('an edit adding no status: label returns before the hook reads anything', async () => {
    const { publicMirrorGuard } = mods('public-mirror');
    const touched = [];
    const record = (what) => async (arg) => {
      touched.push(`${what} ${arg}`);
      return null;
    };
    const verdict = await publicMirrorGuard({
      command: 'gh issue edit 12 --remove-label status:inbox --add-label priority:high',
      cwd: '/nowhere',
      failed: false,
      env: {},
      read: record('read'),
      top: record('top'),
      run: record('run'),
    });
    assertEq(verdict, null, 'no notice');
    assertEq(JSON.stringify(touched), '[]', 'no read, git root or program run');
  });

  group('workflow:public-mirror: a repo with no public key');

  await test('a repo with no public key: the hook does nothing', async () => {
    const world = linkedWorld({ paired: false });
    await posted(world, 'gh issue edit 12 --add-label status:qa');
    assert(!(await until(() => publicLabels(world) !== BUILDING, QUIET_MS)),
      `the public issue kept status:building, got: ${publicLabels(world)}`);
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
