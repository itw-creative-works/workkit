//
// Tests for hooks/loader.sh — the router that resolves a hook name to its
// script. Loader-level failures fail OPEN (a broken loader must never wedge
// the session); the hook's own exit code propagates untouched so blocking
// hooks actually block.
//

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assertEq, summary } = require('../lib/harness');

const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');

const runLoader = (args, input = '{}', env = {}) => {
  const res = spawnSync('bash', [LOADER, ...args], {
    input,
    env: { ...process.env, HOME: os.homedir(), ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// A command the safety/commit-language hook must block (exit 2) — used to
// observe routing and exit-code propagation without any repo state.
const BLOCKED_COMMIT = JSON.stringify({ tool_input: { command: 'git commit -m "kill the watcher"' } });

const run = async () => {
  group('loader: fail-open');

  await test('no hook name — exit 0', () => {
    const { code } = runLoader([]);
    assertEq(code, 0, 'missing name must fail open');
  });

  await test('unknown hook name — exit 0', () => {
    const { code } = runLoader(['no-such-prefix:no-such-hook']);
    assertEq(code, 0, 'missing script must fail open');
  });

  group('loader: routing + propagation');

  await test('colon spelling routes to the nested script and propagates exit 2', () => {
    const { code } = runLoader(['safety:commit-language'], BLOCKED_COMMIT);
    assertEq(code, 2, 'safety:commit-language must resolve to safety/commit-language/run.sh and block');
  });

  await test('slash spelling routes identically', () => {
    const { code } = runLoader(['safety/commit-language'], BLOCKED_COMMIT);
    assertEq(code, 2, 'slash spelling must route the same');
  });

  await test('passing hook exits 0 through the loader', () => {
    const { code } = runLoader(['safety:commit-language'], JSON.stringify({ tool_input: { command: 'git status' } }));
    assertEq(code, 0, 'non-blocking result propagates as 0');
  });

  group('loader: HOOK_DISABLE');

  await test('HOOK_DISABLE=1 no-ops a hook that would block', () => {
    const { code } = runLoader(['safety:commit-language'], BLOCKED_COMMIT, { HOOK_DISABLE: '1' });
    assertEq(code, 0, 'the per-command hatch must bypass the hook');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
