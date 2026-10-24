/**
 * safety:commit-gate judged through the hooks module over a real scratch repo:
 * commitGateGuard over bashFacts (hooks/mods/guards.js) built from engine calls
 * this machine answers, git, bash, npm and node run for real with the env
 * given, files read and statted off disk. Consumers: test/scripts/prove.test.js
 * and script-shell.test.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { IS_WINDOWS, BASH } = require('./platform');
const { mods, runResult, textOf } = require('./mods-inputs');

const KIT = path.join(__dirname, '..', '..');

// A program run the way $.process.run runs it: the env merged over the session's.
const runIn = (env) => async (argv, init = {}) => {
  const res = spawnSync(argv[0] === 'bash' ? BASH : argv[0], argv.slice(1), {
    cwd: init.cwd, input: init.stdin, env: { ...env, ...(init.env || {}) }, encoding: 'utf8',
    timeout: init.timeoutMs, shell: IS_WINDOWS && argv[0] === 'npm',
  });
  return { ...runResult({ stdout: res.stdout || '', stderr: res.stderr || '' }), exitCode: res.error ? null : res.status };
};

const statOf = (p) => {
  try {
    const s = fs.lstatSync(p);
    return { kind: s.isDirectory() ? 'dir' : 'file', size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
  } catch { return null; }
};

// The engine calls register.js hands the chain (its `ioOf`), answered by this machine.
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

/**
 * The guard's verdict on <command> run from <repo> in a session whose
 * variables are <env> (the workflow home holds the markers and records): `deny` the block
 * or null, `context` the stand-down notice as text, '' for none.
 */
const gateOn = async (repo, command, env) => {
  const facts = mods('guards').bashFacts(ioIn(env), env, { command, cwd: repo });
  const v = await mods('commit-gate').commitGateGuard(facts);
  return {
    deny: v && typeof v.deny === 'string' ? v.deny : null,
    context: v && v.context !== undefined ? textOf(v.context) : '',
  };
};

module.exports = { gateOn };
