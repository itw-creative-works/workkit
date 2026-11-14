// Tests for `workkit setup --cloud`: the links a cloud session can take, and
// the identity step it has no use for. Each run is a scratch kit on a scratch
// machine, node and jq real, npm and gh argv recorders on PATH.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect,
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

describe('workkit setup --cloud', () => {
  test('the identity step is one not-applicable line and no warning, exit 0', () => {
    cloudSetup({}, ({ code, out, said }) => {
      expect(code, `exit 0, got: ${said}`).toBe(0);
      expect(out.includes(IDENTITY_NA), `the not-applicable line prints, got: ${said}`).toBeTruthy();
      expect(!said.includes('not signed in'), `and no sign-in warning, got: ${said}`).toBeTruthy();
    });
  });

  test('case 3: a machine with no ~/.local/bin gets the folder, the workkit command link and the gh shim link', () => {
    cloudSetup({ localBin: false }, ({ world, kit, said }) => {
      expect(fs.existsSync(world.localBin), `~/.local/bin is made, got: ${said}`).toBeTruthy();
      const target = (name) => {
        const link = path.join(world.localBin, name);
        expect(fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink(), `${name} is a link in ~/.local/bin, got: ${said}`).toBeTruthy();
        return fs.realpathSync(link);
      };
      expect(target('workkit'), 'the workkit command resolves to the kit\'s').toBe(fs.realpathSync(path.join(kit, 'workflow', 'workkit.sh')));
      expect(target('gh'), 'the gh shim resolves to the kit\'s').toBe(fs.realpathSync(path.join(kit, 'workflow', 'identity', 'gh')));
    });
  });
});
