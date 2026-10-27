// The PATH-shim `gh` the workflow-snapshot and identity shim suites run against:
// a stub answering `issue view` (and `issue list`) from a fixture, recording each
// call, its directory and the env names asked for; the world with no `gh` at all.

const fs = require('fs');
const path = require('path');
const { shellPath, stubTool, basePathWithout } = require('./platform');
const { recordArgv, readArgv } = require('./argv-log');
const { mkTmp } = require('./harness');

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
 * @param {string[]} [opts.env] - variable names each call records, one JSON line per call, read by `ghEnvs`
 * @returns {{binDir: string, logFile: string, cwdFile: string, envFile: string, dir: string}}
 */
const makeGhStub = ({
  field, issues = {}, list = null, fails = false, env = [],
} = {}) => {
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
  const envFile = path.join(dir, 'env.jsonl');
  const listFile = path.join(dir, 'list.json');
  if (list) fs.writeFileSync(listFile, JSON.stringify(list));
  const offline = ['  echo "error connecting to api.github.com" >&2', '  exit 1'];
  // Every path here crosses into a shell, so each is spelled the way the shell
  // reads one; the values handed back stay native, because Node reads those.
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    `printf '%s\\n' "$PWD" >> "${shellPath(cwdFile)}"`,
    ...(env.length ? recordEnv(envFile, env) : []),
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
  return { binDir, logFile, cwdFile, envFile, dir };
};

/**
 * Bash lines appending one JSON object per call to `envFile`: each name in
 * `names` mapped to its value, or to null when the variable is unset, so a
 * blank value and an absent one read apart. Names must be plain identifiers.
 * @param {string} envFile - absolute path to append to
 * @param {string[]} names
 * @returns {string[]} bash source
 */
const recordEnv = (envFile, names) => [
  "line='{'; sep=''",
  `for name in ${names.join(' ')}; do`,
  '  if [[ -n "${!name+set}" ]]; then',
  '    value=${!name//\\\\/\\\\\\\\}; value=${value//\\"/\\\\\\"}',
  '    line+="$sep\\"$name\\":\\"$value\\""',
  '  else',
  '    line+="$sep\\"$name\\":null"',
  '  fi',
  "  sep=','",
  'done',
  `printf '%s}\\n' "$line" >> "${shellPath(envFile)}"`,
];

/** Every call the stub recorded, each an argv array. */
const ghCalls = (stub) => readArgv(stub.logFile);

/** Every call's recorded env, one object per call; a stub never called reads as none. */
const ghEnvs = (stub) => {
  if (!fs.existsSync(stub.envFile)) return [];
  return fs.readFileSync(stub.envFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

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

module.exports = {
  cleanup, makeGhStub, ghCalls, ghEnvs, pathWithoutGh, dropPathWithoutGh,
};
