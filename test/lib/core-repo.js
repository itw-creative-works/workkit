// A repo on the workkit-core package, the way a repo installs it: a test script
// of `workkit test`, the package linked in by a real `npm install` from the
// kit's packages/core, a test/lib/harness.js re-exporting `workkit-core/test`,
// and two suites, a and b. Consumers: test/scripts/workkit-core.test.js,
// test/scripts/workkit-cli/test-verb.test.js and test/scripts/release.test.js
// (the npm precondition and env alone).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert, skipSuite, mkTmp, seeded, SPAWN_DEADLINE } = require('./harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, SYSTEM_PATH, which, joinPath, homeEnv,
} = require('./platform');

const CORE = path.join(__dirname, '..', '..', 'packages', 'core');

// A suite in the harness's shape, its one case named `name`.
const SUITE = (name) => `
const { test, assert, summary, selfRun } = require('./lib/harness');
module.exports = async () => {
  await test('${name}', () => { assert(true); });
  return summary();
};
if (require.main === module) selfRun(module.exports);
`;

/** The precondition every consumer shares: an npm beside this node. */
const skipWithoutNpm = () => {
  if (!which('npm', NODE_DIR)) skipSuite('no npm beside this node, so no package is ever installed');
};

/**
 * The env npm runs under on a machine with no kit: the scratch home `home` and
 * an empty user npmrc in it, node and the system tools alone on PATH.
 * @param {string} home - the scratch home, which must exist
 * @param {object} [extra] - more of the child's env
 * @returns {object}
 */
const npmEnv = (home, extra = {}) => {
  const npmrc = path.join(home, 'npmrc');
  fs.writeFileSync(npmrc, '');
  return homeEnv(home, {
    PATH: joinPath(NODE_DIR, SYSTEM_PATH),
    NPM_CONFIG_USERCONFIG: npmrc,
    // npm runs a script through ComSpec on Windows, and cmd.exe reads SystemRoot.
    ...(IS_WINDOWS ? { ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot } : {}),
    ...extra,
  });
};

/**
 * npm in `cwd` with `args`, on a machine with no kit (npmEnv), npm's own script shell.
 * @returns {{code: ?number, output: string}}
 */
const npmIn = (cwd, args) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', ...args], {
    cwd,
    env: npmEnv(mkTmp('core-npm-home-')),
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `npm ${args.join(' ')} finished: ${res.error || ''}`);
  return { code: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
};

const copyCoreRepo = seeded((seed) => {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(seed, rel)), { recursive: true });
    fs.writeFileSync(path.join(seed, rel), text);
  };
  write('package.json', `${JSON.stringify({
    name: 'fixture', private: true, scripts: { test: 'workkit test' }, devDependencies: { 'workkit-core': `file:${CORE}` },
  }, null, 2)}\n`);
  write('.gitignore', 'node_modules/\n');
  write('test/lib/harness.js', "module.exports = require('workkit-core/test');\n");
  write('test/a.test.js', SUITE('a case'));
  write('test/b.test.js', SUITE('b case'));
  const installed = npmIn(seed, ['install', '--offline', '--no-audit', '--no-fund', '--no-package-lock']);
  assert(installed.code === 0, `npm install links workkit-core, got: ${installed.output}`);
  // npm links relative, which a copy at another depth would break.
  const link = path.join(seed, 'node_modules', 'workkit-core');
  if (!path.isAbsolute(fs.readlinkSync(link))) {
    fs.unlinkSync(link);
    fs.symlinkSync(path.resolve(CORE), link, 'junction');
  }
});

/** A git repo holding a copy of the seeded repo on the package. */
const mkCoreRepo = () => {
  const repo = mkTmp('core-repo-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  copyCoreRepo(repo);
  return repo;
};

// The totals line: `passed` passing cases, none failed, across `suites` suites.
const TOTALS = (passed, suites) => new RegExp(`^${passed} passed, 0 failed \\(\\d+(?:\\.\\d+)?s, ${suites} suites?\\)$`);

module.exports = {
  CORE, SUITE, TOTALS, skipWithoutNpm, npmEnv, npmIn, mkCoreRepo,
};
