// The PATH-shim `gh` the hook suites (safety/proof-guard, safety/spec-guard,
// safety/suite-guard) run their hook against: the stub that answers `issue view`
// (and `issue list`, when handed one) from a fixture and records each call and
// the directory it ran in, the world with no `gh` at all, and the runner that
// hands a hook one command.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  BASH, NO_RC, NODE_DIR, shellPath, stubTool, basePathWithout, systemPathWith, homeEnv,
} = require('./platform');
const { recordArgv, readArgv } = require('./argv-log');
const { mkTmp } = require('./scratch');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A `gh` on its own bin folder that answers `issue view <N> --json <field>`
 * with `{ <field>: issues[N] }`, an unknown number exiting 1, and, given
 * `list`, answers every `issue list` with that array whatever its flags.
 * @param {object} [opts]
 * @param {string} [opts.field] - the JSON field the fixture fills (`comments`, `body`)
 * @param {object} [opts.issues] - issue number to that field's value
 * @param {object[]} [opts.list] - the `issue list` answer, shaped like gh's (`[{ number, labels: [{ name }] }]`)
 * @param {boolean} [opts.fails] - every view (and list) exits 1 with a line on stderr, the way an offline gh does
 * @returns {{binDir: string, logFile: string, cwdFile: string, dir: string}}
 */
const makeGhStub = ({ field, issues = {}, list = null, fails = false } = {}) => {
  const dir = mkTmp('gh-stub-');
  const logFile = path.join(dir, 'gh.log');
  const issuesDir = path.join(dir, 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });
  for (const [number, value] of Object.entries(issues)) {
    fs.writeFileSync(path.join(issuesDir, `${number}.json`), JSON.stringify({ [field]: value }));
  }
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const cwdFile = path.join(dir, 'cwd');
  const listFile = path.join(dir, 'list.json');
  if (list) fs.writeFileSync(listFile, JSON.stringify(list));
  const offline = ['  echo "error connecting to api.github.com" >&2', '  exit 1'];
  // Every path here crosses into a shell, so each is spelled the way the shell
  // reads one; the values handed back stay native, because Node reads those.
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    `printf '%s\\n' "$PWD" >> "${shellPath(cwdFile)}"`,
    'if [[ "$1 $2" == "issue view" ]]; then',
    ...(fails ? offline : [
      `  file="${shellPath(issuesDir)}/$3.json"`,
      '  [[ -f "$file" ]] || exit 1',
      '  cat "$file"',
      '  exit 0',
    ]),
    'fi',
    ...(list ? [
      'if [[ "$1 $2" == "issue list" ]]; then',
      ...(fails ? offline : [`  cat "${shellPath(listFile)}"`, '  exit 0']),
      'fi',
    ] : []),
    'exit 0',
  ]);
  return { binDir, logFile, cwdFile, dir };
};

/** Every call the stub recorded, each an argv array. */
const ghCalls = (stub) => readArgv(stub.logFile);

// The machine without `gh`: a runner ships the real one in /usr/bin, so a case
// about its absence takes it off the PATH. Built once, dropped by the suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('gh-stub-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

/**
 * The runner for one hook: `runHook(command, stub, cwd, envPath)` feeds the
 * hook a Bash PreToolUse input from a scratch home. The PATH is the stub's bin
 * and this run's node on the system PATH (no stub: the world without gh);
 * `envPath` replaces it whole, for the world a case builds itself.
 * @param {string} hook - the hook script's native path
 * @param {object} [env] - more variables every run is handed (a scratch `TMPDIR`)
 * @param {string} [givenHome] - the home every run reads, the case's own and left
 *   in place; without one, each run gets a fresh empty home, removed after it
 * @returns {Function}
 */
const hookRunner = (hook, env = {}, givenHome = null) => (command, stub, cwd = os.tmpdir(), envPath = null) => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd: shellPath(cwd), tool_input: { command } });
  const home = givenHome || mkTmp('gh-stub-');
  try {
    const res = spawnSync(BASH, [...NO_RC, shellPath(hook)], {
      input,
      env: homeEnv(home, {
        ...env,
        PATH: envPath || (stub ? systemPathWith(stub.binDir, NODE_DIR) : pathWithoutGh()),
      }),
      encoding: 'utf8',
      timeout: 30000,
    });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  } finally {
    if (!givenHome) cleanup(home);
  }
};

module.exports = {
  cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, hookRunner,
};
