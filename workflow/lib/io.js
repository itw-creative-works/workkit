/**
 * workflow/lib/io.js: the real machine as the hooks module's io, the chain
 * hooks/register.js hands a guard (its `ioOf`), answered here by git, bash, npm
 * and node run for real with the env given, and files read and statted off disk.
 * The gh shim's gate, the git hooks' judge and the test library's real-gate.js
 * build their facts from it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('./run');
const { repoRoot } = require('./git');
const { readOrNull } = require('./read');

const KIT = path.join(__dirname, '..', '..');

/** A run result in the engine's shape, as `$.process.run` answers. */
const runResult = ({ exitCode = 0, stdout = '', stderr = '' } = {}) => ({
  exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false,
});

// A program run the way $.process.run runs it: the env merged over the session's.
// A child named `node` runs under this process's own Node, so a caller whose
// PATH holds no node still runs the kit's Node files.
const runIn = (env) => async (argv, init = {}) => {
  const opts = {
    cwd: init.cwd, input: init.stdin, env: { ...env, ...(init.env || {}) }, encoding: 'utf8', timeout: init.timeoutMs,
  };
  const res = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1), opts);
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

// As the engine's ranged read: at most `length` bytes from `offset`, empty past
// the end, null for a file that cannot be read.
const readRangeOf = (p, offset, length) => {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const bytes = new Uint8Array(Math.min(length, Math.max(fs.fstatSync(fd).size - offset, 0)));
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, offset));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

/** The io chain for a process whose variables are `env`, `pluginRoot` this kit. */
const ioIn = (env) => ({
  top: async (dir) => repoRoot(dir),
  read: async (p) => readOrNull(p),
  readRange: async (p, offset, length) => readRangeOf(p, offset, length),
  exists: async (p) => fs.existsSync(p),
  list: async (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  run: runIn(env),
  pluginRoot: KIT,
  stat: async (p) => statOf(p),
  real: async (p) => { try { return fs.realpathSync(p); } catch { return null; } },
  // As the engine's write: the file's missing folders made first.
  write: async (p, text) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  },
  now: () => Date.now(),
});

module.exports = { ioIn, runResult };
