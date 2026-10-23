/**
 * The world the workflow/script-shell.sh suites run npm in: a scratch machine
 * (its own home and TMPDIR), a committed scratch repo, npm spawned with the
 * wrapper named by `--script-shell`, the record a green root run leaves and the
 * package record every other green test run leaves, and npm's script shell as
 * setup wires it (the wrapper, or on Windows the built executable).
 * Consumers: tests/scripts/script-shell.test.js, script-shell-detached.test.js
 * and prove.test.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert, skipSuite } = require('./harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, SYSTEM_PATH, WINDOWS_CSC, shellPath, gitPath, which, joinPath, homeEnv,
} = require('./platform');
const { mkTmp } = require('./scratch');
const { suiteMarkerPath, pkgRecord } = require('./suite-record');
const { FIXTURE_ORIGIN } = require('./git-repo');
const { SPAWN_DEADLINE } = require('./process');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');

// npm's script shell as setup wires it: the wrapper beside this checkout's
// engine, or on Windows the executable built into a scratch machine folder
// (null with no compiler), which reaches this checkout's wrapper through a
// scratch claude home whose `workkit` is a junction to it.
const EXE_TMP = mkTmp('script-shell-exe-');
const EXE_HOME = path.join(EXE_TMP, 'workkit-home');
const EXE_CLAUDE_HOME = path.join(EXE_TMP, 'claude-home');
const EXE = path.join(EXE_HOME, 'script-shell.exe');
fs.mkdirSync(EXE_HOME, { recursive: true });
const buildExe = () => {
  if (!fs.existsSync(WINDOWS_CSC)) return null;
  const cli = path.join(WORKFLOW_DIR, 'workkit.sh');
  const res = spawnSync(BASH, [...NO_RC, '-c', `. "${shellPath(cli)}" help >/dev/null; script_shell_exe`], {
    env: { ...process.env, WORKFLOW_HOME: shellPath(EXE_HOME) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  // A compile error must never read as a machine without a compiler.
  if (!fs.existsSync(EXE)) throw new Error(`${WINDOWS_CSC} built no ${EXE}: ${res.stderr || res.error || ''}`);
  fs.mkdirSync(EXE_CLAUDE_HOME, { recursive: true });
  fs.symlinkSync(path.resolve(WORKFLOW_DIR), path.join(EXE_CLAUDE_HOME, 'workkit'), 'junction');
  return gitPath(EXE);
};
const WRAPPER = IS_WINDOWS ? buildExe() : path.join(WORKFLOW_DIR, 'script-shell.sh');
// The gate compares npm's value with the machine folder's executable on Windows.
const EXE_ENV = IS_WINDOWS ? { WORKFLOW_HOME: shellPath(EXE_HOME) } : {};
// The gate asks only that the executable exists before it compares paths, so
// with no compiler an empty stand-in wires it.
if (IS_WINDOWS && !fs.existsSync(EXE)) fs.writeFileSync(EXE, '');

/** A scratch user npmrc naming <shell>, so npm's config is never the machine's. */
const scratchNpmrc = (shell) => {
  const file = path.join(mkTmp('script-shell-npmrc-'), 'npmrc');
  fs.writeFileSync(file, shell ? `script-shell=${shell}\n` : '');
  return file;
};

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
    cwd, env: { ...world.env, ...extra }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `npm ${args.join(' ')} finished: ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** The record a green root run left for <repo> in <world>, or undefined. */
const recorded = (world, repo) => {
  const marker = suiteMarkerPath(world.tmp, repo);
  return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
};

/** Assert <text> is the record of a green root run on <tree>: the tree, then `ms=<n>`. */
const assertRecord = (text, tree, msg) => {
  const [first, second] = (text || '').split('\n');
  assert(first === tree && /^ms=\d+$/.test(second || ''), `${msg}: the tree then ms=<n>, got ${JSON.stringify(text)}`);
};

/** The package record's lines for <repo> in <world>, as JSON so a case compares them whole. */
const packaged = (world, repo) => JSON.stringify(pkgRecord(world.tmp, repo));

module.exports = {
  WRAPPER, EXE_ENV, EXE_CLAUDE_HOME, scratchNpmrc,
  cleanup, git, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded, assertRecord, packaged,
};
