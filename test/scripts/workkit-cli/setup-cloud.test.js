// Tests for `workkit setup --cloud`: the links and the sign-in a cloud session
// can take, the sign-in written from WORKKIT_LOGIN. Each run is a scratch kit on
// a scratch machine, node and jq real, npm and gh argv recorders on PATH.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, skip, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const { recordArgv } = require('../../lib/argv-log');
const { readWrittenLogin } = require('../../lib/identity');
const {
  cleanup, writeStub, mkWorld, runCli, signInEnv, mkSetupKit,
} = require('./helpers');

// A made-up sign-in, shaped like login.json.
const LOGIN = { token: 'ghu_cloudfixture', login: 'cloudbot' };

/**
 * Run `workkit setup --cloud` the way a cloud session does: CLAUDE_CODE_REMOTE
 * true, stdin closed, WORKKIT_LOGIN set to `login` as JSON when given. The
 * machine's ~/.local/bin exists unless `localBin` is false. `fn` reads the
 * result; the world and the kit are removed after it.
 */
const cloudSetup = ({ login, localBin = true } = {}, fn) => {
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
    const extra = { CLAUDE_CODE_REMOTE: 'true', ...(login ? { WORKKIT_LOGIN: JSON.stringify(login) } : {}) };
    const res = runCli(world, ['setup', '--cloud'], { script, env: signInEnv(world, { extra }) });
    fn({ world, kit, ...res });
  } finally {
    cleanup(world.root); cleanup(kit);
  }
};

const loginFile = (world) => path.join(world.home, '.workkit', 'identity', 'login.json');

const cases = async () => {
  group('workkit setup --cloud');

  await test('case 1: WORKKIT_LOGIN set and no login.json: the file is written owner-only with both fields, and the identity line says signed in', () => {
    cloudSetup({ login: LOGIN }, ({ world, said }) => {
      assert(fs.existsSync(loginFile(world)), `login.json is written, got: ${said}`);
      const written = readWrittenLogin(world.home);
      assertEq(JSON.stringify({ token: written.token, login: written.login }), JSON.stringify(LOGIN), 'the token and the login are the variable\'s');
      // Windows carries no POSIX mode, so the question is asked where it can be answered.
      if (IS_WINDOWS) skip('login.json is readable by this user and nobody else', 'Windows keeps no POSIX file mode');
      else assertEq((fs.statSync(loginFile(world)).mode & 0o777).toString(8), '600', 'login.json is readable by this user and nobody else');
      assert(said.includes('identity: signed in as @cloudbot'), `the identity line names the login, got: ${said}`);
    });
  });

  await test('case 2: WORKKIT_LOGIN unset: the identity warning names WORKKIT_LOGIN and setup --cloud, no login.json is written, exit 0', () => {
    cloudSetup({}, ({ world, code, said }) => {
      assertEq(code, 0, `exit 0, got: ${said}`);
      assert(/not signed in[^\n]*WORKKIT_LOGIN[^\n]*workkit setup --cloud/.test(said), `the cloud's sign-in hint, got: ${said}`);
      assert(!said.includes('workkit setup --login'), `and not the device flow a session cannot run, got: ${said}`);
      assertEq(fs.existsSync(loginFile(world)), false, 'no login.json is written');
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
