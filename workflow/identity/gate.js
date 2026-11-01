/**
 * workflow/identity/gate.js: the gh shim's gate, `node gate.js <cwd> <gh argv...>`.
 * It reads the call from its real argv: the leak scan (safety:issue-guard) on
 * every call but a send to the secret store, and where the shim found the session's gates rule
 * (`WORKKIT_GATE_JUDGES=1`, its `wk_session_judges`) the label and filing
 * gates (safety:proof-guard, spec-guard, findings-guard), each through its
 * verdict in hooks/mods. Exit 0 passes, its stdout the journal line for a
 * write; exit 1 bounces, the hook's text on stderr. The repo is the one the
 * shim resolved (`WORKKIT_GATE_REPO`), and every gh read runs the real gh
 * (`WORKKIT_REAL_GH`), never the shim.
 */

const path = require('path');
const { ioIn } = require('../lib/io');
const { slugFromRemote } = require('../slug');

const MODS = path.join(__dirname, '..', '..', 'hooks', 'mods');
const REST = path.join(__dirname, 'rest.js');

// The subcommands that post nothing, so their calls write no journal line: the
// shim's READ_SUBCOMMANDS (./gh), plus `checkout`, which the shim keeps the
// owner's as a pr subcommand instead.
const READS = new Set(['list', 'view', 'status', 'checks', 'diff', 'checkout']);
const JOURNALED = new Set(['issue', 'pr', 'label']);
// The verbs a cloud session's shim hands to rest.js, so the gate's reads go there too.
const CLOUD_VERBS = new Set(['issue', 'label']);

// The flags that take no value, by `<verb> <subcommand>` (the endpoint's call
// for api); `-h`/`--help` takes none on every call.
const COMMENT_BOOLEANS = ['-e', '--editor', '-w', '--web', '--edit-last', '--create-if-none', '--delete-last', '--yes'];
const BOOLEANS = {
  'issue create': ['-w', '--web', '-e', '--editor'],
  'issue edit': ['--remove-milestone'],
  'issue comment': COMMENT_BOOLEANS,
  'issue delete': ['--yes'],
  'issue develop': ['-c', '--checkout', '-l', '--list'],
  'pr create': ['-d', '--draft', '-w', '--web', '-f', '--fill', '--fill-first', '--fill-verbose', '--no-maintainer-edit', '--dry-run', '-e', '--editor'],
  'pr merge': ['-m', '--merge', '-r', '--rebase', '-s', '--squash', '-d', '--delete-branch', '--auto', '--disable-auto', '--admin'],
  'pr close': ['-d', '--delete-branch'],
  'pr edit': ['--remove-milestone'],
  'pr comment': COMMENT_BOOLEANS,
  'pr review': ['-a', '--approve', '-r', '--request-changes', '-c', '--comment'],
  'pr ready': ['--undo'],
  'label create': ['-f', '--force'],
  'label delete': ['--yes'],
  'label clone': ['-f', '--force'],
  api: ['-i', '--include', '--paginate', '--silent', '--slurp', '--verbose'],
};

// The short flags the gate reads that take a value, as their long names, by verb.
const PR_ALIASES = { '-R': '--repo', '-b': '--body', '-F': '--body-file', '-t': '--title', '-l': '--label' };
const ALIASES = {
  issue: { ...PR_ALIASES, '-r': '--reason' },
  pr: PR_ALIASES,
  label: { '-R': '--repo' },
  api: { '-X': '--method', '-f': '--raw-field', '-F': '--field' },
};

const ISSUE_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/([0-9]+)([/?#].*)?$/;
const ISSUE_PATH = /^repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)(\/labels(?:\/([^/]+))?)?$/;

const mod = (name) => require(path.join(MODS, `${name}.js`));

/**
 * The subcommand's place: the first word after the verb that is neither a
 * flag nor the value of `-R`/`--repo`, -1 for none. The rule's one Node home,
 * ./rest.js calls it; its bash twin is `bot_verb` in ./gh: change both together.
 * @param {string[]} rest gh's argv after the verb
 * @returns {number}
 */
function subAt(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-R' || rest[i] === '--repo') i++;
    else if (!rest[i].startsWith('-')) return i;
  }
  return -1;
}

// The words after the verb, the subcommand taken out: each flag's values by
// its long name, and the positionals in order.
function argsOf(rest, verb, key) {
  const bools = new Set(['-h', '--help', ...(BOOLEANS[key] ?? [])]);
  const aliases = ALIASES[verb] ?? {};
  const flags = {};
  const positionals = [];
  const put = (name, value) => { (flags[name] ??= []).push(value); };
  const named = (name) => aliases[name] ?? name;
  let opts = true;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!opts || !word.startsWith('-') || word === '-') positionals.push(word);
    else if (word === '--') opts = false;
    else if (word.startsWith('--') && word.includes('=')) put(word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1));
    else if (!word.startsWith('--') && word.length > 2) put(named(word.slice(0, 2)), word.slice(2));
    else if (bools.has(word)) put(word, true);
    else put(named(word), rest[++i] ?? '');
  }
  return { flags, positionals };
}

// A label flag's values, each comma list split and trimmed.
const labelsOf = (values = []) => values.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);

// An api field's `key=value` pairs, `-f` and `-F` alike.
const fieldsOf = (flags) => [...(flags['--field'] ?? []), ...(flags['--raw-field'] ?? [])]
  .map((pair) => String(pair))
  .map((pair) => ({ key: pair.slice(0, Math.max(pair.indexOf('='), 0)), value: pair.slice(pair.indexOf('=') + 1) }));

// The api endpoint as GitHub's path: the host and leading slash off, the
// query dropped, `{owner}` and `{repo}` filled from the resolved repo.
function endpointOf(raw, repo) {
  const [owner = '', name = ''] = repo.split('/');
  return String(raw ?? '').replace(/^https:\/\/api\.github\.com\//, '').replace(/^\/+/, '').replace(/\?.*$/, '')
    .replace(/\{owner\}/g, owner).replace(/\{repo\}/g, name);
}

// An api call: its method, its write kind, and the issue steps a write to an
// issue or its labels carries.
function apiCall(flags, positionals, repo) {
  const endpoint = endpointOf(positionals[0], repo);
  const fields = fieldsOf(flags);
  const sends = fields.length > 0 || Boolean(flags['--input']);
  const method = String(flags['--method']?.[0] || (sends ? 'POST' : 'GET')).toUpperCase();
  const write = endpoint === 'graphql'
    ? fields.some(({ value }) => /\bmutation\b/i.test(value))
    : method !== 'GET' && method !== 'HEAD';
  const field = (key) => fields.filter((f) => f.key === key).map((f) => f.value);
  const at = endpoint.match(ISSUE_PATH);
  const steps = [];
  let nothingBuilt = false;
  if (at && write) {
    const number = at[3];
    const labels = [...field('labels[]'), ...field('labels')];
    if (method === 'DELETE') {
      if (at[5]) steps.push({ sub: 'edit', number, add: [], remove: [decodeURIComponent(at[5])] });
    } else {
      if (!at[4] && field('state').includes('closed')) {
        steps.push({ sub: 'close', number, add: [], remove: [] });
        nothingBuilt = field('state_reason').some((r) => r === 'not_planned' || r === 'duplicate');
      }
      if (labels.length > 0) steps.push({ sub: 'edit', number, add: labels, remove: [] });
    }
  }
  const bodyFiles = [
    ...(flags['--input'] ?? []),
    ...(flags['--field'] ?? []).map(String).filter((pair) => pair.includes('=@')).map((pair) => pair.slice(pair.indexOf('=@') + 2)),
  ];
  return {
    sub: steps.length > 0 ? (steps.some((s) => s.sub === 'close') ? 'close' : 'edit') : method.toLowerCase(),
    repo: at ? `${at[1]}/${at[2]}` : repo,
    numbers: at ? [at[3]] : [],
    add: steps.flatMap((s) => s.add),
    remove: steps.flatMap((s) => s.remove),
    title: null,
    bodyFiles,
    method,
    endpoint,
    steps,
    nothingBuilt,
    kind: write ? 'write' : 'read',
  };
}

/**
 * The call a gh argv makes: its verb and subcommand, the repo (an api path's
 * own, else `repo`, else the argv's `--repo` or issue URL), the issue numbers,
 * the labels added and removed, the title, the body files, the api method and
 * endpoint, one step per issue or pull request the call names (an api write's
 * to an issue as the `edit` or `close` it makes, an issue create's one step
 * carrying its title), whether a close builds nothing, and whether it is a write.
 * @param {string[]} argv gh's argv, the verb first
 * @param {string} [repo] the repo the shim resolved, '' for none
 * @returns {object}
 */
function classify(argv, repo = '') {
  const [verb = '', ...rest] = argv;
  const at = verb === 'api' ? -1 : subAt(rest);
  const sub = at >= 0 ? rest[at] : '';
  const { flags, positionals } = argsOf(rest.filter((_, i) => i !== at), verb, verb === 'api' ? 'api' : `${verb} ${sub}`);
  const help = Boolean(flags['--help'] || flags['-h']);
  if (verb === 'api') return { verb, ...apiCall(flags, positionals, repo), ...(help ? { kind: 'read' } : {}) };
  let urlRepo = '';
  const numbers = [];
  for (const word of verb === 'label' ? [] : positionals) {
    const url = word.match(ISSUE_URL);
    if (url) urlRepo ||= `${url[1]}/${url[2]}`;
    const n = url ? url[4] : word.replace(/^#/, '');
    if (/^[0-9]+$/.test(n) && !numbers.includes(n)) numbers.push(n);
  }
  const flagRepo = flags['--repo']?.[0] ? slugFromRemote(`/${flags['--repo'][0]}`) ?? '' : '';
  const add = labelsOf(sub === 'create' ? flags['--label'] : flags['--add-label']);
  const remove = labelsOf(flags['--remove-label']);
  const reason = String(flags['--reason']?.[0] ?? '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
  const body = Boolean(flags['--body'] || flags['--body-file']);
  const labeled = sub === 'edit' || sub === 'create';
  const title = flags['--title']?.[0] ?? null;
  const steps = numbers.map((number) => ({
    sub, number, add: labeled ? add : [], remove: labeled ? remove : [], ...(body && sub === 'edit' ? { body } : {}),
  }));
  // An issue create names no number yet, so its one step carries the title instead.
  if (verb === 'issue' && sub === 'create') steps.push({ sub, number: null, add, remove, title });
  return {
    verb,
    sub,
    repo: repo || flagRepo || urlRepo,
    numbers,
    add,
    remove,
    title,
    bodyFiles: (flags['--body-file'] ?? []).map(String),
    method: null,
    endpoint: null,
    steps,
    nothingBuilt: sub === 'close' && (reason === 'not planned' || Boolean(flags['--duplicate-of'])),
    kind: JOURNALED.has(verb) && sub && !READS.has(sub) && !help ? 'write' : 'read',
  };
}

/**
 * The journal line of a write: tab-separated epoch ms, verb, subcommand,
 * repo, numbers and the labels added and removed (each comma-joined), and the
 * cwd, a tab or line break inside a field read as a space.
 * @param {object} call classify's answer
 * @param {string} cwd the call's folder
 * @param {number} ms the time now
 * @returns {string}
 */
function journalLine(call, cwd, ms) {
  return [ms, call.verb, call.sub, call.repo, call.numbers.join(','), call.add.join(','), call.remove.join(','), cwd]
    .map((field) => String(field).replace(/[\t\r\n]/g, ' ')).join('\t');
}

// The verdicts' reads, the real machine's, built as the git hooks' judge builds
// them (bashFacts): a gh read runs the real gh the shim found, or in a cloud
// session rest.js over it, as the shim hands it.
function factsIn(cwd, env) {
  const io = ioIn(env);
  const run = (argv, init = {}) => {
    if (argv[0] !== 'gh') return io.run(argv, init);
    const gh = env.WORKKIT_REAL_GH;
    if (!gh) throw new Error('gate.js: no real gh to run; the shim hands its path over in WORKKIT_REAL_GH');
    if (env.CLAUDE_CODE_REMOTE !== 'true' || !CLOUD_VERBS.has(argv[1])) return io.run([gh, ...argv.slice(1)], init);
    const flag = argv.indexOf('--repo');
    const handed = { WORKKIT_REAL_GH: gh, GH_REPO: (flag >= 0 && argv[flag + 1]) || env.WORKKIT_GATE_REPO || '' };
    return io.run([process.execPath, REST, ...argv.slice(1)], { ...init, env: { ...init.env, ...handed } });
  };
  return mod('guards').bashFacts({ ...io, run }, env, { command: '', cwd });
}

// A call whose whole job is sending a value to GitHub's encrypted store, which
// the leak scan skips: `gh secret` and `gh variable`, and an api write to an
// Actions secret or variable (a secret is PUT, a variable POSTed then PATCHed).
const STORE_VERBS = new Set(['secret', 'variable']);
const STORE_PATH = /\/actions\/(?:secrets|variables)(?:\/|$)/;
const sendsToStore = (call) => STORE_VERBS.has(call.verb)
  || (call.verb === 'api' && call.kind === 'write' && STORE_PATH.test(call.endpoint));

// The leak scan over the argv and every body file it sends.
async function leakOf(argv, call, facts, platform) {
  const { leakVerdict, leakFacts } = mod('issue-guard');
  const { shellDirOf } = mod('markers');
  const bodies = [];
  for (const file of call.bodyFiles) {
    const text = await facts.read(file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file) ? shellDirOf(file, facts.env, platform) : `${facts.cwd}/${file}`);
    if (text !== null) bodies.push(text);
  }
  return leakVerdict({ text: argv.join('\n'), bodies, ...(await leakFacts(facts)) });
}

// The Claude session's gates, in the Bash chain's order: proof, spec, findings.
async function sessionGates(call, facts) {
  const { cwd } = facts;
  const repo = call.repo;
  const verdicts = [];
  // The label gates judge issues alone, an api issue write as the edit or close it makes.
  const steps = call.verb === 'issue' || call.verb === 'api' ? call.steps : [];
  const proofSteps = steps.filter((s) => (s.sub === 'close' && !call.nothingBuilt) || s.sub === 'edit');
  const gated = (labels) => (s) => s.sub === 'edit' && labels.some((label) => s.add.includes(label));
  if (proofSteps.some((s) => s.sub === 'close' || gated(['status:qa', 'status:complete'])(s))) {
    const { proofVerdict, proofFacts } = mod('proof-guard');
    verdicts.push(await proofVerdict({ steps: proofSteps, cwd, repo, facts: await proofFacts(facts) }));
    if (verdicts.at(-1)?.deny) return verdicts;
  }
  if (steps.some(gated(['status:specced']))) {
    const { specVerdict, specFacts } = mod('spec-guard');
    verdicts.push(await specVerdict({ steps, cwd, repo, facts: specFacts(facts) }));
    if (verdicts.at(-1)?.deny) return verdicts;
  }
  if (steps.some((s) => s.sub === 'create' && s.title !== null)) {
    const { findingsVerdict, findingsRouteOf } = mod('findings-guard');
    verdicts.push(findingsVerdict({ steps, cwd, repo, facts: { route: await findingsRouteOf(facts) } }));
  }
  return verdicts;
}

/**
 * Judges one gh call: the leak scan (skipped on a send to the secret store),
 * then where the session judges the gates. A block goes to stderr and answers
 * 1; a pass writes each verdict's notice on stderr, prints the journal line of
 * a write on stdout and answers 0.
 * @param {string[]} args the cwd, then gh's argv
 * @param {object} env the variables: WORKKIT_GATE_JUDGES, WORKKIT_REAL_GH, WORKKIT_GATE_REPO
 * @param {{platform?: string, now?: function}} [opts] the platform and clock
 * @returns {Promise<number>}
 */
async function main([given = '', ...argv], env, { platform = process.platform, now = Date.now } = {}) {
  const { shellDirOf } = mod('markers');
  const cwd = shellDirOf(given || process.cwd(), env, platform);
  const call = classify(argv, env.WORKKIT_GATE_REPO || '');
  const facts = factsIn(cwd, env);
  const verdicts = [sendsToStore(call) ? null : await leakOf(argv, call, facts, platform)];
  if (!verdicts[0]?.deny && env.WORKKIT_GATE_JUDGES === '1') verdicts.push(...(await sessionGates(call, facts)));
  const denied = verdicts.find((verdict) => verdict?.deny);
  if (denied) {
    process.stderr.write(`${denied.deny}\n`);
    return 1;
  }
  for (const verdict of verdicts) if (verdict?.context) process.stderr.write(`${verdict.context}\n`);
  if (call.kind === 'write') process.stdout.write(`${journalLine(call, cwd, now())}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`gh: the workkit gate failed before it could judge this call, so the call did not run: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { classify, journalLine, main, subAt };
