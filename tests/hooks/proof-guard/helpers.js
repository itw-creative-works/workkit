//
// The shared prologue of the hooks/safety/proof-guard suites, the `*.test.js`
// files beside this one: the hook runner, the PATH-shim `gh` that answers
// `issue view` from a fixture so nothing reaches GitHub, and the world with no
// `gh` at all. A plain module, never a suite: the runner only loads files
// ending in `.test.js`.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  BASH, NO_RC, NODE_DIR, shellPath, stubTool, basePathWithout, systemPathWith, homeEnv,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { mkTmp } = require('../../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'proof-guard', 'run.sh');
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// PATH shim: records each `gh` invocation and answers `issue view <N> --json
// comments` from a fixture keyed by issue number. `fails: true` makes every
// view exit non-zero, the way an unauthenticated or offline gh does.
const makeGhStub = ({ comments = {}, fails = false } = {}) => {
  const dir = mkTmp('proof-guard-');
  const logFile = path.join(dir, 'gh.log');
  const bodiesDir = path.join(dir, 'issues');
  fs.mkdirSync(bodiesDir, { recursive: true });
  for (const [number, bodies] of Object.entries(comments)) {
    fs.writeFileSync(path.join(bodiesDir, `${number}.json`),
      JSON.stringify({ comments: bodies.map((body) => ({ body })) }));
  }
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const cwdFile = path.join(dir, 'cwd');
  // Every path here crosses INTO a shell, so each is spelled the way the shell
  // reads one; the values handed back stay native, because Node reads those.
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    `printf '%s\\n' "$PWD" >> "${shellPath(cwdFile)}"`,
    'if [[ "$1 $2" == "issue view" ]]; then',
    ...(fails ? ['  exit 1'] : [
      `  file="${shellPath(bodiesDir)}/$3.json"`,
      '  [[ -f "$file" ]] || exit 1',
      '  cat "$file"',
      '  exit 0',
    ]),
    'fi',
    'exit 0',
  ]);
  return { binDir, logFile, cwdFile, dir };
};

const ghCalls = (stub) => readArgv(stub.logFile);

// The machine that does NOT have `gh`. A runner ships the real one in /usr/bin,
// so a case about its absence has to take it off the PATH rather than trust the
// system one, or the REAL gh answers and the case passes for another reason.
// Built once, since the mirror links every system tool, and removed with the
// suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('proof-guard-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

// The stub world carries this run's node, which no system PATH holds, since
// the flip to status:qa runs the touched test files with it. `envPath` replaces
// the whole PATH, for the world a case builds itself. Each run gets its own
// scratch home, so no git or node child reads the developer's.
const runHook = (command, stub, cwd = os.tmpdir(), envPath = null) => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd: shellPath(cwd), tool_input: { command } });
  const home = mkTmp('proof-guard-');
  try {
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input,
      env: homeEnv(home, {
        PATH: envPath || (stub ? systemPathWith(stub.binDir, NODE_DIR) : pathWithoutGh()),
      }),
      encoding: 'utf8',
      timeout: 30000,
    });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  } finally {
    cleanup(home);
  }
};

// One issue with a proof, one without, in every world.
const WORLD = { comments: { 7: ['Proof: unit: node tests/hooks/x.test.js'], 9: ['looks good to me'] } };

module.exports = {
  HOOK, cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, runHook, WORLD,
};
