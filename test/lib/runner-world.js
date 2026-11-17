// A scratch repo the kit's runner (packages/core/test/run.js) runs in, as a case
// starts it: suites on the door, a leftover list file, a plugin's files, a recording
// `claude`, and the run with its exit and output. Consumers:
// test/runner-folders.test.js, runner-filter.test.js, runner-skip.test.js, runner-color.test.js,
// members.test.js, app-cases.test.js, test/scripts/script-shell.test.js and script-shell-detached.test.js
// (SUITE, RUNNER), runner-skip.test.js (listFile), test/runner.test.js (MOD_FILES, listFile, claudeStub)
// and test/mod-case.test.js (MOD_FILES, claudeStub).

const fs = require('fs');
const path = require('path');
const { mkTmp, start, SPAWN_DEADLINE } = require('./harness');
const {
  spawnSync, homeEnv, stubTool, shellPath, joinPath,
} = require('./platform');
const { aloneEnv } = require('./alone-env');

const CORE_TEST = path.join(__dirname, '..', '..', 'packages', 'core', 'test');
const RUNNER = path.join(CORE_TEST, 'run.js');
const HARNESS = path.join(CORE_TEST, 'lib', 'harness.js');

/** A suite on the door, its top level `inner`. */
const SUITE = (inner) => `const { describe, test, expect } = require(${JSON.stringify(HARNESS)});\n${inner}\n`;

/** A list file's text, a leftover `test/lib/serial.js` or `test/lib/skip.js`, exporting `lists`. */
const listFile = (lists) => `module.exports = ${JSON.stringify(lists)};\n`;

// A plugin: its manifest and hooks module, beside one test/mods suite.
const MOD_FILES = {
  '.claude-plugin/plugin.json': '{ "name": "fixture", "version": "0.0.1" }\n',
  'hooks/hooks.json': '{ "modules": ["./register.js"] }\n',
  'hooks/register.js': 'export function register(on) {}\n',
  'test/mods/a.test.ts': "import { test, expect } from 'claude-code/testing'\ntest('the mod case', async () => { expect(1).toBe(1) })\n",
};

/**
 * The runner's env: this process's less what a run must not inherit. npm's own
 * config of the run that started this suite goes (its local prefix would send a
 * member's `npm test` to this repo), and `CI` unless the case sets it.
 */
const runEnv = (home, extra) => {
  const env = homeEnv(home, aloneEnv(extra));
  for (const key of Object.keys(env)) if (/^npm_/i.test(key)) delete env[key];
  if (!('CI' in extra)) delete env.CI;
  return env;
};

/**
 * A fresh scratch repo, a git work tree unless `git` is false, with a scratch home.
 * `write(files)` writes each path from the root (a string as text, anything else as JSON);
 * `read(rel)` is a file's text or null; `run(args, { cwd, env, bins })` runs the
 * runner in the root (or `cwd` under it), each of `bins` first on PATH, to its end;
 * `start` with the same arguments leaves it running.
 */
const mkWorld = ({ git = true } = {}) => {
  const root = mkTmp('runner-world-');
  const home = mkTmp('runner-world-home-');
  if (git) spawnSync('git', ['init', '-q'], { cwd: root, env: homeEnv(home, { PATH: process.env.PATH }) });
  const write = (files) => {
    for (const [rel, body] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body)}\n`);
    }
  };
  const read = (rel) => {
    const file = path.join(root, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  const optsOf = ({ cwd = '', env = {}, bins = [] }) => ({
    cwd: path.join(root, cwd),
    env: runEnv(home, { PATH: joinPath(...bins, process.env.PATH), ...env }),
  });
  const run = (args = [], opts = {}) => {
    const res = spawnSync(process.execPath, [RUNNER, ...args], { ...optsOf(opts), encoding: 'utf8', timeout: SPAWN_DEADLINE });
    return { code: res.status, output: `${res.stdout || ''}${res.stderr || ''}`, stderr: res.stderr || '' };
  };
  // The runner left running, as the door's `start` hands it back.
  const startRun = (args = [], opts = {}) => start(process.execPath, [RUNNER, ...args], optsOf(opts));
  return {
    root, home, write, read, run, start: startRun,
  };
};

/**
 * A scratch bin holding a `claude` that prints `lines`, exits `code`, and notes each
 * argument it was started with; `started()` says whether it was, `args()` is the last start's.
 * With `hang` it never ends after its lines until `release()` (a case's `t.after`), or until it is ended.
 */
const claudeStub = ({ lines = [], code = 0, hang = false } = {}) => {
  const bin = mkTmp('runner-claude-');
  const marker = path.join(bin, 'started');
  const stop = path.join(bin, 'stop');
  stubTool(bin, 'claude', [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$@" > "${shellPath(marker)}"`,
    ...lines.map((line) => `printf '%s\\n' ${JSON.stringify(line)}`),
    ...(hang ? ["trap 'exit 130' INT", `while [ ! -e "${shellPath(stop)}" ]; do sleep 0.1; done`] : []),
    `exit ${code}`,
  ]);
  const started = () => fs.existsSync(marker);
  return {
    bin,
    started,
    args: () => (started() ? fs.readFileSync(marker, 'utf8').split('\n').slice(0, -1) : null),
    release: () => fs.writeFileSync(stop, ''),
  };
};

module.exports = {
  RUNNER, HARNESS, SUITE, MOD_FILES, listFile, mkWorld, claudeStub,
};
