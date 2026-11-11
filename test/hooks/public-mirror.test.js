// Tests for workflow:public-mirror: after a Bash call whose gh journal lines add
// a status: label in a paired repo, the public issue takes that label. Each case
// runs the hook's entry on the post-Bash chain (hooks/mods/guards.js) over those
// lines with a real io, so the mirror it starts meets the fake GitHub of
// test/scripts/public/helpers.js.

const {
  group, test: testEverywhere, testUnless, assert, assertEq, until, summary, selfRun,
} = require('../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../lib/platform');
const { mods, ghEntry } = require('../lib/mods-inputs');
const { ioIn } = require('../../workflow/lib/io');
const { mkPublicWorld, publicLine, PUBLIC, PRIVATE } = require('../scripts/public/helpers');

const HOOK = 'workflow:public-mirror';

// The mirror the hook starts runs gh by name from Node; written before the stub launcher, it still skips on Windows.
const test = testUnless(IS_WINDOWS, NO_NODE_STUB);

/** The journal line of a gh issue edit of #12 in the private repo, adding and removing those labels. */
const edit = (world, add, remove = []) => ghEntry({
  repo: PRIVATE, numbers: [12], add, remove, cwd: world.repo,
});

/** The post-Bash chain's public-mirror entry over a Bash call in the repo that journaled `lines`. */
const posted = async (world, lines) => {
  const { POST_BASH_GUARDS, runChain } = mods('guards');
  const entry = POST_BASH_GUARDS.filter((g) => g.hook === HOOK);
  assertEq(entry.length, 1, `${HOOK} is on the post-Bash chain once`);
  const chain = await runChain(ioIn(world.env), world.env, entry, { lines, cwd: world.repo });
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

  await test('case 2: a journal line adding status:qa to #12 in a paired repo runs the mirror for #12', async () => {
    const world = linkedWorld();
    await posted(world, [edit(world, ['status:qa'])]);
    assert(await until(() => publicLabels(world) === QA), `the public issue took status:qa, got: ${publicLabels(world)}`);
  });

  await test('case 2: a journal line adding no status: label runs nothing', async () => {
    const world = linkedWorld();
    await posted(world, [edit(world, ['priority:high'])]);
    assert(!(await until(() => publicLabels(world) !== BUILDING, QUIET_MS)),
      `the public issue kept status:building, got: ${publicLabels(world)}`);
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written');
  });

  await testEverywhere('a line adding no status: label returns before the hook reads anything', async () => {
    const { publicMirrorGuard } = mods('public-mirror');
    const touched = [];
    const record = (what) => async (arg) => {
      touched.push(`${what} ${arg}`);
      return null;
    };
    const verdict = await publicMirrorGuard({
      lines: [ghEntry({ numbers: [12], add: ['priority:high'], remove: ['status:inbox'], cwd: '/nowhere' })],
      cwd: '/nowhere',
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
    await posted(world, [edit(world, ['status:qa'])]);
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
