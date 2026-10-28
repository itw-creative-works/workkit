// Tests for `workkit setup --cloud`: the links a cloud session can take, and
// the identity step it has no use for. Each run is a scratch kit on a scratch
// machine, node and jq real, npm and gh argv recorders on PATH.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { recordArgv } = require('../../lib/argv-log');
const { IDENTITY_NA } = require('../../lib/identity');
const {
  cleanup, writeStub, mkWorld, runCli, signInEnv, mkSetupKit,
} = require('./helpers');

/**
 * Run `workkit setup --cloud` the way a cloud session does: CLAUDE_CODE_REMOTE
 * true, stdin closed. The machine's ~/.local/bin exists unless `localBin` is
 * false. `fn` reads the result; the world and the kit are removed after it.
 */
const cloudSetup = ({ localBin = true } = {}, fn) => {
  const world = mkWorld({ pluginInstalled: true });
  // npm answers an unset key as null, the way the real one does.
  writeStub(path.join(world.bin, 'npm'), [
    recordArgv(path.join(world.root, 'npm-argv.log')),
    'if [[ "$1" == \'config\' && "$2" == \'get\' ]]; then printf \'null\\n\'; fi',
    'exit 0',
  ]);
  if (localBin) fs.mkdirSync(world.localBin, { recursive: true });
  const { kit, script } = mkSetupKit();
  try {
    const res = runCli(world, ['setup', '--cloud'], { script, env: signInEnv(world, { extra: { CLAUDE_CODE_REMOTE: 'true' } }) });
    fn({ world, kit, ...res });
  } finally {
    cleanup(world.root); cleanup(kit);
  }
};

const cases = async () => {
  group('workkit setup --cloud');

  await test('the identity step is one not-applicable line and no warning, exit 0', () => {
    cloudSetup({}, ({ code, out, said }) => {
      assertEq(code, 0, `exit 0, got: ${said}`);
      assert(out.includes(IDENTITY_NA), `the not-applicable line prints, got: ${said}`);
      assert(!said.includes('not signed in'), `and no sign-in warning, got: ${said}`);
    });
  });

  await test('case 3: a machine with no ~/.local/bin gets the folder, the workkit command link and the gh shim link', () => {
    cloudSetup({ localBin: false }, ({ world, kit, said }) => {
      assert(fs.existsSync(world.localBin), `~/.local/bin is made, got: ${said}`);
      const target = (name) => {
        const link = path.join(world.localBin, name);
        assert(fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink(), `${name} is a link in ~/.local/bin, got: ${said}`);
        return fs.realpathSync(link);
      };
      assertEq(target('workkit'), fs.realpathSync(path.join(kit, 'workflow', 'workkit.sh')), 'the workkit command resolves to the kit\'s');
      assertEq(target('gh'), fs.realpathSync(path.join(kit, 'workflow', 'identity', 'gh')), 'the gh shim resolves to the kit\'s');
    });
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
