// The PATH-shim `gh` the workflow-snapshot and identity shim suites run against:
// a stub answering `issue view` (and `issue list`) from a fixture, and `gh api`
// from route fixtures, recording each call, its directory and the env names
// asked for; the world with no `gh` at all. Run as a program, it is the stub's
// `gh api` half.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { shellPath, stubTool, basePathWithout } = require('./platform');
const { recordArgv, readArgv } = require('./argv-log');
const { mkTmp } = require('./harness');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A `gh` on its own bin folder answering `issue view <N> --json <field>` with `{ <field>: issues[N] }`
 * (an unknown number exits 1) and, given `list`, every `issue list` with that array whatever its flags.
 * @param {object} [opts]
 * @param {string} [opts.field] - the JSON field the fixture fills (`comments`, `body`)
 * @param {object} [opts.issues] - issue number to that field's value
 * @param {object[]} [opts.list] - the `issue list` answer, shaped like gh's (`[{ number, labels: [{ name }] }]`)
 * @param {boolean} [opts.fails] - every view (and list) exits 1 with a line on stderr, the way an offline gh does
 * @param {string[]} [opts.env] - variable names each call records, one JSON line per call, read by `ghEnvs`
 * @param {object} [opts.api] - `gh api` answers by `<METHOD> <route>`, each `{ status, body }` or `{ pages }` (`answerApi`)
 * @returns {{binDir: string, logFile: string, cwdFile: string, envFile: string, requestFile: string, dir: string}}
 */
const makeGhStub = ({
  field, issues = {}, list = null, fails = false, env = [], api = null,
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
  const apiFile = path.join(dir, 'api.json');
  const requestFile = path.join(dir, 'requests.jsonl');
  if (api) fs.writeFileSync(apiFile, JSON.stringify(api));
  const offline = ['  echo "error connecting to api.github.com" >&2', '  exit 1'];
  // Every path here crosses into a shell, so each is spelled the way the shell
  // reads one; the values handed back stay native, because Node reads those.
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    `printf '%s\\n' "$PWD" >> "${shellPath(cwdFile)}"`,
    ...(env.length ? recordEnv(envFile, env) : []),
    ...(api ? [
      'if [[ "$1" == "api" ]]; then',
      `  exec "${shellPath(process.execPath)}" "${shellPath(__filename)}" "${shellPath(apiFile)}" "${shellPath(requestFile)}" "$@"`,
      'fi',
    ] : []),
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
  return {
    binDir, logFile, cwdFile, envFile, requestFile, dir,
  };
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

/** Every `gh api` request the stub answered, `{ method, path, query, body }` each, in order. */
const ghRequests = (stub) => {
  if (!fs.existsSync(stub.requestFile)) return [];
  return fs.readFileSync(stub.requestFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

// The `gh api` flags the stub serves: those taking a value, then those standing alone.
// Any other flag stops the stub, so a request it would misread never passes.
const API_VALUE_FLAGS = new Set(['-X', '-f', '-q', '--jq']);
const API_BARE_FLAGS = new Set(['--paginate', '--slurp']);

/** `gh api` argv (from `api` on) read the way gh reads it, into the request it would send. */
const parseApi = (argv) => {
  const flags = {};
  const fields = [];
  let endpoint = null;
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('-')) { endpoint = endpoint ?? flag; continue; }
    if (API_BARE_FLAGS.has(flag)) { flags[flag] = true; continue; }
    if (!API_VALUE_FLAGS.has(flag)) throw new Error(`the stub does not serve gh api ${flag}`);
    i += 1;
    if (flag !== '-f') { flags[flag] = argv[i]; continue; }
    const at = argv[i].indexOf('=');
    fields.push([argv[i].slice(0, at), argv[i].slice(at + 1)]);
  }
  const [route, qs = ''] = endpoint.split('?');
  const method = (flags['-X'] || (fields.length ? 'POST' : 'GET')).toUpperCase();
  const query = Object.fromEntries(new URLSearchParams(qs));
  let body = null;
  if (method === 'GET') {
    for (const [key, value] of fields) query[key.replace(/\[\]$/, '')] = value;
  } else if (fields.length) {
    body = {};
    for (const [key, value] of fields) {
      if (key.endsWith('[]')) (body[key.slice(0, -2)] = body[key.slice(0, -2)] || []).push(value);
      else body[key] = value;
    }
  }
  return {
    method, path: decodeURIComponent(route).replace(/^\//, ''), query, body,
    jq: flags['-q'] || flags['--jq'], paginate: Boolean(flags['--paginate']), slurp: Boolean(flags['--slurp']),
  };
};

/** `value` through `--jq` as gh prints it: a string raw, null as an empty line, the rest compact with sorted keys. */
const viaJq = (expr, value) => {
  const res = spawnSync('jq', ['-c', '-S', expr], { input: JSON.stringify(value), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`the stub's jq failed on ${expr}: ${res.stderr}`);
  return res.stdout.split('\n').filter(Boolean).map((line) => {
    const parsed = JSON.parse(line);
    if (parsed === null) return '\n';
    return typeof parsed === 'string' ? `${parsed}\n` : `${line}\n`;
  }).join('');
};

/**
 * Answer one `gh api` call as the real gh would: record the request, then print the route's fixture
 * (`--jq` applied), exit 0. A `pages` fixture serves `--paginate` every page merged into one array
 * (`--slurp`: an array of pages) and a plain call its first page. A status of 400 or more, or a route
 * with no fixture (GitHub's 404), prints the body on stdout and `gh: <message> (HTTP <status>)` on
 * stderr, exit 1.
 */
const answerApi = ([fixtureFile, requestFile, ...argv]) => {
  const req = parseApi(argv);
  fs.appendFileSync(requestFile, `${JSON.stringify({
    method: req.method, path: req.path, query: req.query, body: req.body,
  })}\n`);
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))[`${req.method} ${req.path}`]
    || { status: 404, body: { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' } };
  const status = fixture.status || 200;
  if (status >= 400) {
    process.stdout.write(JSON.stringify(fixture.body));
    process.stderr.write(`gh: ${fixture.body.message} (HTTP ${status})\n`);
    return 1;
  }
  let outputs;
  if (!fixture.pages) outputs = [fixture.body];
  else if (req.slurp) outputs = [fixture.pages];
  else if (req.paginate) outputs = req.jq ? fixture.pages : [fixture.pages.flat()];
  else outputs = [fixture.pages[0]];
  if (outputs[0] === undefined) return 0;
  process.stdout.write(outputs.map((out) => (req.jq ? viaJq(req.jq, out) : JSON.stringify(out))).join(''));
  return 0;
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
  cleanup, makeGhStub, ghCalls, ghEnvs, ghRequests, pathWithoutGh, dropPathWithoutGh,
};

if (require.main === module) process.exitCode = answerApi(process.argv.slice(2));
