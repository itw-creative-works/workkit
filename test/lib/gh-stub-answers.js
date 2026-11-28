// makeGhStub's answers, run in the fake gh's own process (gh-stub.js). It loads
// only Node's modules, the kit's workflow/lib and plain test files, so the
// stand-in starts on any PATH a case narrows (docs/tests.md § The shape).

const fs = require('fs');
const { spawnSync } = require('../../workflow/lib/run');
const { ghJq } = require('./gh-jq');

const OFFLINE = 'error connecting to api.github.com\n';

/** The repo an `issue list` asks about, `-R`/`--repo` (the last one given) or the folder's origin, as its last path segment. */
const listedRepo = (argv) => {
  let repo = '';
  argv.forEach((arg, i) => {
    if (argv[i - 1] === '-R' || argv[i - 1] === '--repo') repo = arg;
    if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length);
  });
  if (!repo) {
    const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    repo = origin.status === 0 ? origin.stdout.trim() : '';
  }
  return repo.replace(/\.git$/, '').split('/').pop();
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

/**
 * Answer one `gh api` call as the real gh would: record the request, then print the route's fixture
 * (`--jq` applied), exit 0. A `pages` fixture serves `--paginate` every page merged into one array
 * (`--slurp`: an array of pages) and a plain call its first page. A status of 400 or more, or a route
 * with no fixture (GitHub's 404), prints the body on stdout and `gh: <message> (HTTP <status>)` on
 * stderr, exit 1.
 */
const answerApi = (fixtureFile, requestFile, argv) => {
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
  process.stdout.write(outputs.map((out) => (req.jq ? ghJq(req.jq, out) : JSON.stringify(out))).join(''));
  return 0;
};

/**
 * makeGhStub's answers to one call: the call's directory and asked-for env
 * recorded, then `gh api` from the route fixtures, `issue view` and `issue list`
 * from their fixtures, and any other call exits 0 saying nothing.
 * @returns {number} the exit code
 */
const answerFixtures = ({
  cwdFile, envFile, env, apiFile, requestFile, field, issues, list, lists, fails,
}, argv) => {
  fs.appendFileSync(cwdFile, `${process.cwd()}\n`);
  // A blank value and an absent one read apart: the absent one is null.
  if (env.length) fs.appendFileSync(envFile, `${JSON.stringify(Object.fromEntries(env.map((name) => [name, name in process.env ? process.env[name] : null])))}\n`);
  if (apiFile && argv[0] === 'api') return answerApi(apiFile, requestFile, argv);
  const command = `${argv[0]} ${argv[1]}`;
  const listed = command === 'issue list' && (list || lists);
  if (command !== 'issue view' && !listed) return 0;
  if (fails) {
    process.stderr.write(OFFLINE);
    return 1;
  }
  if (listed && list) {
    process.stdout.write(JSON.stringify(list));
    return 0;
  }
  if (listed) {
    const name = listedRepo(argv);
    process.stdout.write(Object.hasOwn(lists, name) ? JSON.stringify(lists[name]) : '[]\n');
    return 0;
  }
  if (!Object.hasOwn(issues, String(argv[2]))) return 1;
  process.stdout.write(JSON.stringify({ [field]: issues[argv[2]] }));
  return 0;
};

module.exports = { answerFixtures };
