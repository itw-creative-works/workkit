// workflow/identity/rest.js: the gh shim's cloud half. The cloud proxy serves REST
// alone, as the account, so the kit's issue, label and auth verbs become `gh api`
// calls in gh's own shape; any other call runs the real gh as it came.
// Usage: WORKKIT_REAL_GH=<gh> GH_REPO=<owner/name> node rest.js <gh argv>

const fs = require('fs');
const { spawnSync } = require('child_process');

const HOST = 'https://github.com';
const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';
// gh's own default for `--limit` on both lists.
const DEFAULT_LIMIT = 30;
const STATES = ['open', 'closed', 'all'];
const CLOSE_REASONS = { completed: 'completed', 'not planned': 'not_planned' };
// REST's reaction keys as gh's reactionGroups spell them.
const REACTIONS = {
  '+1': 'THUMBS_UP', '-1': 'THUMBS_DOWN', laugh: 'LAUGH', hooray: 'HOORAY',
  confused: 'CONFUSED', heart: 'HEART', rocket: 'ROCKET', eyes: 'EYES',
};

/** A failed `gh api` call, relayed as it came: its stdout, stderr and code. */
class GhFailure extends Error {
  /** @param {{status: number|null, stdout: string, stderr: string}} result */
  constructor(result) {
    super(result.stderr.trim() || `gh api exited ${result.status}`);
    this.name = 'GhFailure';
    this.result = result;
  }
}

/** A call this translator cannot serve, said on stderr with exit 1. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * A query or path value encoded, the `:` and `,` of a label list kept as GitHub writes them.
 * @param {string} value
 * @returns {string}
 */
const enc = (value) => encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2C/gi, ',');

/**
 * One `-f key=value` pair, or one per item for an array field (`key[]`).
 * @param {string} key
 * @param {string|string[]} value
 * @returns {string[]}
 */
const field = (key, value) => (Array.isArray(value)
  ? value.flatMap((item) => ['-f', `${key}[]=${item}`])
  : ['-f', `${key}=${value}`]);

/**
 * Runs `gh api` through the real gh. A non-zero exit throws GhFailure.
 * @param {{gh: string}} ctx
 * @param {string} method
 * @param {string} route
 * @param {string[]} [extra] fields and flags after the route
 * @returns {string} gh's stdout
 */
const api = (ctx, method, route, extra = []) => {
  const argv = ['api', ...(method === 'GET' ? [] : ['-X', method]), route, ...extra];
  const result = spawnSync(ctx.gh, argv, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new GhFailure(result);
  return result.stdout;
};

/**
 * A GET's JSON; `--paginate` among the extras fetches every page, which gh merges into one array.
 * @param {{gh: string}} ctx
 * @param {string} route
 * @param {string[]} [extra]
 * @returns {any}
 */
const getJson = (ctx, route, extra = []) => JSON.parse(api(ctx, 'GET', route, extra));

/**
 * A write's JSON answer, null when the route answers nothing.
 * @param {{gh: string}} ctx
 * @param {string} method
 * @param {string} route
 * @param {string[]} fields
 * @returns {any}
 */
const send = (ctx, method, route, fields) => {
  const out = api(ctx, method, route, fields);
  return out.trim() ? JSON.parse(out) : null;
};

/**
 * argv parsed against a verb's flags, each `[long, short, kind]`: `value` (the
 * last one wins), `list` (repeatable, commas split) or `bool`. `--repo`/`-R` is
 * every verb's.
 * @param {string[]} argv
 * @param {Array<[string, string|null, string]>} specs
 * @returns {{flags: object, args: string[]}}
 */
const parse = (argv, specs) => {
  const all = [['repo', 'R', 'value'], ...specs];
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('-') || word === '-') { args.push(word); continue; }
    const long = word.startsWith('--');
    const eq = word.indexOf('=');
    const name = long ? word.slice(2, eq > 0 ? eq : undefined) : word.slice(1, 2);
    const spec = all.find(([l, s]) => (long ? l === name : s === name));
    if (!spec) throw new UsageError(`gh: ${word} is not served in a cloud session, where gh reaches GitHub through REST alone`);
    const [key, , kind] = spec;
    if (kind === 'bool') { flags[key] = true; continue; }
    let value;
    if (long && eq > 0) value = word.slice(eq + 1);
    else if (!long && word.length > 2) value = word.slice(2);
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new UsageError(`gh: flag needs an argument: ${word}`);
    flags[key] = kind === 'list' ? [...(flags[key] || []), ...value.split(',').filter(Boolean)] : value;
  }
  return { flags, args };
};

/**
 * The repo a call acts on: the one the shim resolved, `--repo` included, or a
 * refusal when it resolved none.
 * @param {{repo: string}} ctx
 * @returns {string}
 */
const repoOf = (ctx) => {
  if (!ctx.repo) throw new UsageError('gh: no repo to act on; pass --repo owner/name or run inside a clone');
  return ctx.repo;
};

/**
 * An issue number from `N`, `#N` or an issue or pull request URL.
 * @param {string} arg
 * @returns {string}
 */
const numberOf = (arg) => {
  const m = String(arg).match(/^#?(\d+)$/) || String(arg).match(/\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/);
  if (!m) throw new UsageError(`gh: not an issue number or URL: ${arg}`);
  return m[1];
};

/**
 * `--limit`'s value as a positive count, gh's default when absent.
 * @param {string|undefined} value
 * @returns {number}
 */
const limitOf = (value) => {
  if (value === undefined) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`gh: invalid limit: ${value}`);
  return n;
};

/**
 * A body from `--body` or `--body-file` (`-` is stdin); undefined when neither is given.
 * @param {object} flags
 * @returns {string|undefined}
 */
const bodyOf = (flags) => {
  if (flags['body-file'] !== undefined) return fs.readFileSync(flags['body-file'] === '-' ? 0 : flags['body-file'], 'utf8');
  return flags.body;
};

/**
 * The `--json` fields asked for, each one the table serves, or a refusal naming it.
 * @param {string} list comma-joined
 * @param {object} table
 * @returns {string[]} sorted, as gh prints the keys
 */
const fieldsOf = (list, table) => {
  const fields = list.split(',').map((f) => f.trim()).filter(Boolean);
  if (!fields.length) throw new UsageError(`gh: --json needs fields; served: ${Object.keys(table).join(', ')}`);
  const missing = fields.find((f) => !table[f]);
  if (missing) throw new UsageError(`gh: the ${missing} JSON field is not served in a cloud session; served: ${Object.keys(table).join(', ')}`);
  return [...new Set(fields)].sort();
};

/**
 * One record picked to the asked fields, keys in gh's sorted order.
 * @returns {object}
 */
const pick = (record, fields, table, ctx) => Object.fromEntries(fields.map((f) => [f, table[f](record, ctx)]));

const printJson = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const botless = (login) => login.replace(/\[bot\]$/, '');

/**
 * An issue author as gh prints one: an App as `app/<slug>`, a user with its id and name.
 * @param {object} user REST's user
 * @returns {object}
 */
const authorOf = (user) => (user.type === 'Bot'
  ? { is_bot: true, login: `app/${botless(user.login)}` }
  : { id: user.node_id, is_bot: false, login: user.login, name: user.name || '' });

const labelOf = (l) => ({ id: l.node_id, name: l.name, description: l.description || '', color: l.color });

/**
 * A comment as gh prints one. REST carries no minimized state and no viewer, so
 * those keep the values gh prints for an unhidden comment by someone else.
 * @param {object} c REST's comment
 * @returns {object}
 */
const commentOf = (c) => ({
  id: c.node_id,
  author: { login: botless(c.user.login) },
  authorAssociation: c.author_association,
  body: c.body || '',
  createdAt: c.created_at,
  includesCreatedEdit: Boolean(c.updated_at && c.updated_at !== c.created_at),
  isMinimized: false,
  minimizedReason: '',
  reactionGroups: Object.entries(REACTIONS)
    .filter(([key]) => c.reactions?.[key] > 0)
    .map(([key, content]) => ({ content, users: { totalCount: c.reactions[key] } })),
  url: c.html_url,
  viewerDidAuthor: false,
});

/**
 * An issue's comments, every page.
 * @returns {object[]}
 */
const commentsOf = (issue, ctx) => getJson(ctx, `repos/${ctx.repo}/issues/${issue.number}/comments`, ['--paginate']);

// gh's issue `--json` fields the shim serves, each from REST's issue.
const ISSUE_FIELDS = {
  assignees: (i) => i.assignees.map((u) => ({ id: u.node_id, login: u.login, name: u.name || '' })),
  author: (i) => authorOf(i.user),
  body: (i) => i.body || '',
  closed: (i) => i.state === 'closed',
  closedAt: (i) => i.closed_at,
  comments: (i, ctx) => commentsOf(i, ctx).map(commentOf),
  createdAt: (i) => i.created_at,
  id: (i) => i.node_id,
  labels: (i) => i.labels.map(labelOf),
  milestone: (i) => (i.milestone
    ? { number: i.milestone.number, title: i.milestone.title, description: i.milestone.description || '', dueOn: i.milestone.due_on }
    : null),
  number: (i) => i.number,
  state: (i) => i.state.toUpperCase(),
  stateReason: (i) => (i.state_reason || '').toUpperCase(),
  title: (i) => i.title,
  updatedAt: (i) => i.updated_at,
  url: (i) => i.html_url,
};

// gh's label `--json` fields REST can answer, each from REST's label.
const LABEL_FIELDS = {
  color: (l) => l.color,
  description: (l) => l.description || '',
  id: (l) => l.node_id,
  isDefault: (l) => Boolean(l.default),
  name: (l) => l.name,
  url: (l, ctx) => `${HOST}/${ctx.repo}/labels/${enc(l.name)}`,
};

/**
 * `auth status`: the account the proxy signs as, from `gh api user -q .login`.
 * @returns {number}
 */
const authStatus = (ctx, argv) => {
  parse(argv, [['hostname', null, 'value'], ['active', 'a', 'bool']]);
  let login = '';
  try {
    login = api(ctx, 'GET', 'user', ['-q', '.login']).trim();
  } catch (err) {
    if (!(err instanceof GhFailure)) throw err;
    process.stderr.write(err.result.stderr);
  }
  if (!login) {
    process.stderr.write(`${NOT_LOGGED_IN}\n`);
    return 1;
  }
  process.stdout.write(`✓ Logged in to github.com account ${login} (the cloud session's GitHub proxy)\n`);
  return 0;
};

/**
 * The issues a `--search` names, through REST's search route, pull requests left out.
 * @returns {object[]}
 */
const searchIssues = (ctx, state, labels, text) => {
  const terms = [`repo:${ctx.repo}`, 'is:issue', state === 'all' ? '' : `state:${state}`,
    ...labels.map((l) => `label:"${l}"`), text].filter(Boolean).join(' ');
  const pages = getJson(ctx, `search/issues?q=${encodeURIComponent(terms)}&per_page=100`, ['--paginate', '--slurp']);
  return pages.flatMap((page) => page.items);
};

/**
 * `issue list`: REST's issues route, every page, pull requests dropped.
 * @returns {number}
 */
const issueList = (ctx, argv) => {
  const { flags } = parse(argv, [['state', 's', 'value'], ['label', 'l', 'list'], ['limit', 'L', 'value'],
    ['json', null, 'value'], ['search', 'S', 'value']]);
  repoOf(ctx);
  const state = flags.state || 'open';
  if (!STATES.includes(state)) throw new UsageError(`gh: invalid state: ${state}`);
  const labels = flags.label || [];
  const limit = limitOf(flags.limit);
  const fields = flags.json !== undefined ? fieldsOf(flags.json, ISSUE_FIELDS) : null;
  let issues;
  if (flags.search !== undefined) {
    issues = searchIssues(ctx, state, labels, flags.search);
  } else {
    const query = [`state=${state}`, labels.length ? `labels=${labels.map(enc).join(',')}` : '', 'per_page=100'].filter(Boolean).join('&');
    issues = getJson(ctx, `repos/${ctx.repo}/issues?${query}`, ['--paginate']).filter((i) => !i.pull_request);
  }
  issues = issues.slice(0, limit);
  if (fields) {
    printJson(issues.map((i) => pick(i, fields, ISSUE_FIELDS, ctx)));
    return 0;
  }
  for (const i of issues) {
    process.stdout.write(`${i.number}\t${i.state.toUpperCase()}\t${i.title}\t${i.labels.map((l) => l.name).join(', ')}\t${i.updated_at}\n`);
  }
  return 0;
};

/**
 * The `owner/name#N` refs a REST list route answers, comma-joined as gh prints
 * them; a count of none makes no call.
 * @returns {string}
 */
const linkedRefs = (ctx, count, route) => (count
  ? getJson(ctx, route, ['--paginate']).map((i) => `${i.repository_url.split('/repos/')[1]}#${i.number}`).join(', ')
  : '');

/**
 * gh's plain view of one issue: its header lines, `--`, then the body. REST
 * answers no projects or parent, so those two lines print empty.
 * @returns {string}
 */
const issueText = (ctx, i) => {
  const route = `repos/${ctx.repo}/issues/${i.number}`;
  const subs = i.sub_issues_summary;
  const deps = i.issue_dependencies_summary;
  return [
    `title:\t${i.title}`,
    `state:\t${i.state.toUpperCase()}`,
    `author:\t${botless(i.user.login)}`,
    `labels:\t${i.labels.map((l) => l.name).sort().join(', ')}`,
    `comments:\t${i.comments}`,
    `assignees:\t${i.assignees.map((u) => u.login).join(', ')}`,
    'projects:\t',
    `milestone:\t${i.milestone ? i.milestone.title : ''}`,
    `issue-type:\t${i.type ? i.type.name : ''}`,
    'parent:\t',
    `sub-issues:\t${linkedRefs(ctx, subs.total, `${route}/sub_issues`)}`,
    `sub-issues-completed:\t${subs.total ? `${subs.completed}/${subs.total}` : ''}`,
    `blocked-by:\t${linkedRefs(ctx, deps.total_blocked_by, `${route}/dependencies/blocked_by`)}`,
    `blocking:\t${linkedRefs(ctx, deps.total_blocking, `${route}/dependencies/blocking`)}`,
    `number:\t${i.number}`,
    '--',
    `${i.body || ''}\n`,
  ].join('\n');
};

/**
 * gh's plain `--comments` view: per comment its author, association, edit and
 * review status (`none` on an issue comment), `--`, the body, `--`.
 * @returns {string}
 */
const commentsText = (comments) => comments.map((c) => [
  `author:\t${botless(c.user.login)}`,
  `association:\t${String(c.author_association).toLowerCase()}`,
  `edited:\t${Boolean(c.updated_at && c.updated_at !== c.created_at)}`,
  'status:\tnone',
  '--',
  c.body || '',
  '--\n',
].join('\n')).join('');

/**
 * `issue view`: REST's issue, plus its comments when `comments` is asked.
 * @returns {number}
 */
const issueView = (ctx, argv) => {
  const { flags, args } = parse(argv, [['json', null, 'value'], ['comments', 'c', 'bool']]);
  repoOf(ctx);
  if (args.length !== 1) throw new UsageError('gh: issue view takes one issue number or URL');
  const fields = flags.json !== undefined ? fieldsOf(flags.json, ISSUE_FIELDS) : null;
  const issue = getJson(ctx, `repos/${ctx.repo}/issues/${numberOf(args[0])}`);
  if (fields) printJson(pick(issue, fields, ISSUE_FIELDS, ctx));
  else if (flags.comments) process.stdout.write(commentsText(commentsOf(issue, ctx)));
  else process.stdout.write(issueText(ctx, issue));
  return 0;
};

/**
 * Removes one label from an issue. An issue that lacks it is no failure, as with gh.
 */
const removeLabel = (ctx, n, name) => {
  try {
    api(ctx, 'DELETE', `repos/${ctx.repo}/issues/${n}/labels/${enc(name)}`);
  } catch (err) {
    const said = err instanceof GhFailure ? `${err.result.stdout}${err.result.stderr}` : '';
    if (!said.includes('Label does not exist')) throw err;
  }
};

/**
 * `issue edit`: labels added in one POST, each removed one DELETEd, title and
 * body in one PATCH; the issue's URL printed per issue, as gh prints it.
 * @returns {number}
 */
const issueEdit = (ctx, argv) => {
  const { flags, args } = parse(argv, [['add-label', null, 'list'], ['remove-label', null, 'list'],
    ['title', 't', 'value'], ['body', 'b', 'value'], ['body-file', 'F', 'value']]);
  repoOf(ctx);
  if (!args.length) throw new UsageError('gh: issue edit needs an issue number or URL');
  const body = bodyOf(flags);
  const patch = [...(flags.title !== undefined ? field('title', flags.title) : []), ...(body !== undefined ? field('body', body) : [])];
  const add = flags['add-label'] || [];
  const remove = flags['remove-label'] || [];
  if (!add.length && !remove.length && !patch.length) throw new UsageError('gh: field to edit flag required when not running interactively');
  for (const n of args.map(numberOf)) {
    if (add.length) send(ctx, 'POST', `repos/${ctx.repo}/issues/${n}/labels`, field('labels', add));
    for (const name of remove) removeLabel(ctx, n, name);
    if (patch.length) send(ctx, 'PATCH', `repos/${ctx.repo}/issues/${n}`, patch);
    process.stdout.write(`${HOST}/${ctx.repo}/issues/${n}\n`);
  }
  return 0;
};

/**
 * Posts one comment and answers its URL.
 * @returns {string}
 */
const postComment = (ctx, n, body) => send(ctx, 'POST', `repos/${ctx.repo}/issues/${n}/comments`, field('body', body)).html_url;

/**
 * `issue comment`: one POST, the comment's URL printed, as gh prints it.
 * @returns {number}
 */
const issueComment = (ctx, argv) => {
  const { flags, args } = parse(argv, [['body', 'b', 'value'], ['body-file', 'F', 'value']]);
  repoOf(ctx);
  if (args.length !== 1) throw new UsageError('gh: issue comment takes one issue number or URL');
  const body = bodyOf(flags);
  if (body === undefined) throw new UsageError('gh: --body or --body-file required when not running interactively');
  process.stdout.write(`${postComment(ctx, numberOf(args[0]), body)}\n`);
  return 0;
};

/**
 * `issue close`: the comment first when one is given, then the PATCH to closed.
 * @returns {number}
 */
const issueClose = (ctx, argv) => {
  const { flags, args } = parse(argv, [['comment', 'c', 'value'], ['reason', 'r', 'value']]);
  repoOf(ctx);
  if (args.length !== 1) throw new UsageError('gh: issue close takes one issue number or URL');
  const reason = flags.reason !== undefined ? CLOSE_REASONS[flags.reason] : undefined;
  if (flags.reason !== undefined && !reason) throw new UsageError(`gh: invalid reason: ${flags.reason}; use completed or "not planned"`);
  const n = numberOf(args[0]);
  if (flags.comment !== undefined) postComment(ctx, n, flags.comment);
  send(ctx, 'PATCH', `repos/${ctx.repo}/issues/${n}`, [...field('state', 'closed'), ...(reason ? field('state_reason', reason) : [])]);
  return 0;
};

/**
 * `issue create`: one POST, the new issue's URL printed, as gh prints it.
 * @returns {number}
 */
const issueCreate = (ctx, argv) => {
  const { flags } = parse(argv, [['title', 't', 'value'], ['body', 'b', 'value'], ['body-file', 'F', 'value'],
    ['label', 'l', 'list']]);
  repoOf(ctx);
  if (flags.title === undefined) throw new UsageError('gh: --title required when not running interactively');
  const fields = [...field('title', flags.title), ...field('body', bodyOf(flags) || '')];
  if (flags.label) fields.push(...field('labels', flags.label));
  process.stdout.write(`${send(ctx, 'POST', `repos/${ctx.repo}/issues`, fields).html_url}\n`);
  return 0;
};

/**
 * `label list`: REST's labels route, every page.
 * @returns {number}
 */
const labelList = (ctx, argv) => {
  const { flags } = parse(argv, [['json', null, 'value'], ['limit', 'L', 'value']]);
  repoOf(ctx);
  const limit = limitOf(flags.limit);
  const fields = flags.json !== undefined ? fieldsOf(flags.json, LABEL_FIELDS) : null;
  const labels = getJson(ctx, `repos/${ctx.repo}/labels`, ['--paginate']).slice(0, limit);
  if (fields) {
    printJson(labels.map((l) => pick(l, fields, LABEL_FIELDS, ctx)));
    return 0;
  }
  for (const l of labels) process.stdout.write(`${l.name}\t${l.description || ''}\t#${l.color}\n`);
  return 0;
};

/**
 * A label's description and color as REST fields, the color's `#` dropped.
 * @returns {string[]}
 */
const labelFields = (flags) => [
  ...(flags.description !== undefined ? field('description', flags.description) : []),
  ...(flags.color !== undefined ? field('color', flags.color.replace(/^#/, '')) : []),
];

/**
 * `label create NAME`: one POST.
 * @returns {number}
 */
const labelCreate = (ctx, argv) => {
  const { flags, args } = parse(argv, [['description', 'd', 'value'], ['color', 'c', 'value']]);
  repoOf(ctx);
  if (args.length !== 1) throw new UsageError('gh: label create takes one label name');
  send(ctx, 'POST', `repos/${ctx.repo}/labels`, [...field('name', args[0]), ...labelFields(flags)]);
  return 0;
};

/**
 * `label edit NAME`: one PATCH, `--name` its new name.
 * @returns {number}
 */
const labelEdit = (ctx, argv) => {
  const { flags, args } = parse(argv, [['description', 'd', 'value'], ['color', 'c', 'value'], ['name', 'n', 'value']]);
  repoOf(ctx);
  if (args.length !== 1) throw new UsageError('gh: label edit takes one label name');
  const fields = [...(flags.name !== undefined ? field('new_name', flags.name) : []), ...labelFields(flags)];
  if (!fields.length) throw new UsageError('gh: specify at least one of --color, --description, or --name');
  send(ctx, 'PATCH', `repos/${ctx.repo}/labels/${enc(args[0])}`, fields);
  return 0;
};

// The verbs served, as "<verb> <subcommand>".
const VERBS = {
  'auth status': authStatus,
  'issue list': issueList,
  'issue view': issueView,
  'issue edit': issueEdit,
  'issue comment': issueComment,
  'issue close': issueClose,
  'issue create': issueCreate,
  'label list': labelList,
  'label create': labelCreate,
  'label edit': labelEdit,
};

/**
 * Runs the real gh on the call as it came, its stdio this process's.
 * @param {string} gh
 * @param {string[]} argv
 * @returns {number} gh's exit code, 1 when a signal ended it
 */
const passThrough = (gh, argv) => {
  const result = spawnSync(gh, argv, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

/**
 * Serves one gh call: its verb, its subcommand (the first word after the verb
 * that is no flag and no `--repo` value) and the rest as that verb's arguments.
 * A call VERBS does not name, or one asking `-h`/`--help`, goes to the real gh.
 * @param {string[]} argv gh's argv, the verb first
 * @param {{gh: string, repo?: string}} opts the real gh's path and the repo the shim resolved
 * @returns {number} the exit code; a failed `gh api` call's own, its output relayed
 */
const run = (argv, { gh, repo = '' }) => {
  if (!gh) throw new Error('rest.js: no real gh to run; the shim hands its path over in WORKKIT_REAL_GH');
  const [verb, ...rest] = argv;
  // The subcommand rule is the twin of `bot_verb` in ./gh, shape for shape:
  // change one and change the other.
  let at = -1;
  for (let i = 0; i < rest.length && at < 0; i++) {
    if (rest[i] === '-R' || rest[i] === '--repo') i++;
    else if (!rest[i].startsWith('-')) at = i;
  }
  const help = rest.includes('-h') || rest.includes('--help');
  const serve = !help && at >= 0 && VERBS[`${verb} ${rest[at]}`];
  if (!serve) return passThrough(gh, argv);
  try {
    return serve({ gh, repo }, rest.filter((_, i) => i !== at));
  } catch (err) {
    if (err instanceof GhFailure) {
      process.stdout.write(err.result.stdout);
      process.stderr.write(err.result.stderr);
      return err.result.status || 1;
    }
    if (!(err instanceof UsageError)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
};

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2), { gh: process.env.WORKKIT_REAL_GH, repo: process.env.GH_REPO || '' });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
