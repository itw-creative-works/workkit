/**
 * The world the workflow/script-shell.sh suites run npm in: a scratch machine
 * (its own home and TMPDIR), a committed scratch repo, npm spawned with the
 * wrapper named by `--script-shell`, and the record a green root run leaves.
 * Consumers: tests/scripts/script-shell.test.js and script-shell-detached.test.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert, skipSuite } = require('./harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, SYSTEM_PATH, shellPath, which, joinPath, homeEnv,
} = require('./platform');
const { mkTmp } = require('./scratch');
const { suiteMarkerPath } = require('./suite-record');
const { FIXTURE_ORIGIN } = require('./git-repo');
const { WRAPPER, EXE_CLAUDE_HOME } = require('../hooks/commit-gate/helpers');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
  { cwd: dir, encoding: 'utf8' }).stdout.trim();

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

/** Both suites' preconditions: a script shell to name, and an npm to call it. */
const skipWithoutWrapper = () => {
  if (!WRAPPER) skipSuite('no C# compiler on this Windows, so the script shell cannot be built');
  if (!which('npm', NODE_DIR)) skipSuite('no npm beside this node, so no script shell is ever called');
};

/**
 * A committed repo: the root package.json (<pkg> merged over a name), app.js,
 * and any <extra> files by relative path, a string as text, anything else as JSON.
 */
const mkRepo = (pkg, extra = {}) => {
  const dir = mkTmp('script-shell-');
  git(dir, 'init', '-q');
  writeJson(path.join(dir, 'package.json'), { name: 'fixture', ...pkg });
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
  for (const [rel, value] of Object.entries(extra)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  git(dir, 'remote', 'add', 'origin', FIXTURE_ORIGIN);
  return dir;
};

/**
 * A scratch machine: its own home and TMPDIR, node and npm on PATH; on Windows
 * a claude home through which the built executable reaches this checkout.
 */
const mkWorld = () => {
  const root = mkTmp('script-shell-world-');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  return {
    root,
    tmp,
    env: homeEnv(home, {
      TMPDIR: shellPath(tmp),
      PATH: joinPath(NODE_DIR, SYSTEM_PATH),
      ...(IS_WINDOWS ? { WORKFLOW_CLAUDE_HOME: EXE_CLAUDE_HOME } : {}),
    }),
  };
};

/**
 * npm run in <cwd> with <args>, through the wrapper unless `shell` names another,
 * with <extra> merged over the world's env. The flag goes first: after a `--`
 * npm hands it to the script instead.
 */
const npm = (world, cwd, args, shell = WRAPPER, extra = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', `--script-shell=${shell}`, ...args], {
    cwd, env: { ...world.env, ...extra }, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `npm ${args.join(' ')} finished: ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** The record a green root run left for <repo> in <world>, or undefined. */
const recorded = (world, repo) => {
  const marker = suiteMarkerPath(world.tmp, repo);
  return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
};

module.exports = {
  cleanup, git, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded,
};
