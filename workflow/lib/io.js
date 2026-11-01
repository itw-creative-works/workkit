/**
 * workflow/lib/io.js: the real machine as the hooks module's io, the chain
 * hooks/register.js hands a guard (its `ioOf`), answered here by git, bash, npm
 * and node run for real with the env given, and files read and statted off disk.
 * The gh shim's gate, the git hooks' judge and the test library's real-gate.js
 * build their facts from it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawnNpm } = require('../ship/plan');

const KIT = path.join(__dirname, '..', '..');

/** A run result in the engine's shape, as `$.process.run` answers. */
const runResult = ({ exitCode = 0, stdout = '', stderr = '' } = {}) => ({
  exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false,
});

// A program run the way $.process.run runs it: the env merged over the session's.
const runIn = (env) => async (argv, init = {}) => {
  const opts = {
    cwd: init.cwd, input: init.stdin, env: { ...env, ...(init.env || {}) }, encoding: 'utf8', timeout: init.timeoutMs,
  };
  const res = argv[0] === 'npm'
    ? spawnNpm(argv.slice(1), opts)
    : spawnSync(argv[0], argv.slice(1), opts);
  // A run that did not start (isStarted false) carries its error as stderr, as the
  // engine's does; a null exitCode means that, or a child ended by a signal.
  const stderr = res.stderr || (res.error ? res.error.message : '');
  return { ...runResult({ stdout: res.stdout || '', stderr }), exitCode: res.error ? null : res.status, isStarted: !res.error };
};

const statOf = (p) => {
  try {
    const s = fs.lstatSync(p);
    return { kind: s.isDirectory() ? 'dir' : 'file', size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
  } catch { return null; }
};

/** The io chain for a process whose variables are `env`, `pluginRoot` this kit. */
const ioIn = (env) => ({
  top: async (dir) => {
    if (!fs.existsSync(dir)) return null;
    const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    return res.status === 0 ? res.stdout.trim() : null;
  },
  read: async (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
  exists: async (p) => fs.existsSync(p),
  list: async (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  run: runIn(env),
  pluginRoot: KIT,
  stat: async (p) => statOf(p),
  real: async (p) => { try { return fs.realpathSync(p); } catch { return null; } },
  write: async (p, text) => fs.writeFileSync(p, text),
  now: () => Date.now(),
});

module.exports = { ioIn, runResult };
