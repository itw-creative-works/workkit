// workflow/identity/rest-pr.js: the REST forms of the `pr` subcommands the ship
// uses, served by rest.js in a cloud session, whose proxy refuses GraphQL.
// Usage: const PR_VERBS = require('./rest-pr'); (a table in rest.js's VERBS shape)

const { spawnSync } = require('../lib/run');
const {
  api, getJson, send, parse, repoOf, matchNumber, limitOf, bodyOf, fieldsOf, pick, printJson, field, enc, GhFailure, UsageError,
} = require('./rest');

// `pr list --state` values; merged is REST's closed with `merged_at` set.
const PR_STATES = ['open', 'closed', 'merged', 'all'];
const MERGE_METHODS = ['merge', 'squash', 'rebase'];
// gh's `pr checks` exit when any check is still pending.
const PENDING_EXIT = 8;
const DEFAULT_INTERVAL = 10;

// A check's bucket by its REST conclusion or state, gh's own table; anything else is pending.
const BUCKETS = {
  success: 'pass',
  skipped: 'skipping',
  neutral: 'skipping',
  error: 'fail',
  failure: 'fail',
  cancelled: 'fail',
  timed_out: 'fail',
  action_required: 'fail',
};

/**
 * A pull request's state as gh spells it: MERGED when merged, else REST's state uppercased.
 * @param {object} p REST's pull request
 * @returns {string}
 */
const stateOf = (p) => (p.merged_at ? 'MERGED' : p.state.toUpperCase());

// gh's pr `--json` fields the shim serves, each from REST's pull request.
const PR_FIELDS = {
  baseRefName: (p) => p.base.ref,
  headRefName: (p) => p.head.ref,
  headRefOid: (p) => p.head.sha,
  isDraft: (p) => Boolean(p.draft),
  mergeCommit: (p) => (p.merged_at ? { oid: p.merge_commit_sha } : null),
  mergedAt: (p) => p.merged_at || null,
  number: (p) => p.number,
  state: stateOf,
  title: (p) => p.title,
  url: (p) => p.html_url,
};

/**
 * The branch HEAD is on, through git in the call's folder; a detached HEAD is refused.
 * @returns {string}
 */
const currentBranch = () => {
  const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new UsageError(`gh: could not determine the current branch: ${res.stderr.trim()}`);
  const branch = res.stdout.trim();
  if (branch === 'HEAD') throw new UsageError('gh: could not determine the current branch: HEAD is detached; name the branch');
  return branch;
};

/**
 * The open pull request whose head is `branch` in the repo's own owner, or gh's refusal.
 * @returns {object}
 */
const openPrOf = (ctx, branch) => {
  const owner = ctx.repo.split('/')[0];
  const [pr] = getJson(ctx, `repos/${ctx.repo}/pulls?head=${enc(`${owner}:${branch}`)}&state=open&per_page=1`);
  if (!pr) throw new UsageError(`no pull requests found for branch "${branch}"`);
  return pr;
};

/**
 * The pull request a `[<number>|<url>|<branch>]` argument names, the current branch's when absent.
 * @param {object} ctx
 * @param {string[]} args
 * @param {string} sub the subcommand, for the refusal of a second argument
 * @returns {object} REST's pull request
 */
const prOf = (ctx, args, sub) => {
  if (args.length > 1) throw new UsageError(`gh: pr ${sub} takes at most one number, URL or branch`);
  const n = args.length ? matchNumber(args[0], ['pull']) : null;
  if (n) return getJson(ctx, `repos/${ctx.repo}/pulls/${n}`);
  return openPrOf(ctx, args.length ? args[0] : currentBranch());
};

/**
 * `pr create`: one POST, the new pull request's URL printed, as gh prints it.
 * @returns {number}
 */
const prCreate = (ctx, argv) => {
  const { flags } = parse(argv, [['title', 't', 'value'], ['body', 'b', 'value'], ['body-file', 'F', 'value'],
    ['base', 'B', 'value'], ['head', 'H', 'value']]);
  repoOf(ctx);
  const body = bodyOf(flags);
  if (flags.title === undefined || body === undefined) throw new UsageError('gh: must provide --title and --body when not running interactively');
  const head = flags.head ?? currentBranch();
  const base = flags.base ?? getJson(ctx, `repos/${ctx.repo}`).default_branch;
  const fields = [...field('title', flags.title), ...field('head', head), ...field('base', base), ...field('body', body)];
  process.stdout.write(`${send(ctx, 'POST', `repos/${ctx.repo}/pulls`, fields).html_url}\n`);
  return 0;
};

/**
 * `pr list`: REST's pulls route, every page, merged ones told from closed by `merged_at`.
 * @returns {number}
 */
const prList = (ctx, argv) => {
  const { flags } = parse(argv, [['head', 'H', 'value'], ['base', 'B', 'value'], ['state', 's', 'value'],
    ['limit', 'L', 'value'], ['json', null, 'value']]);
  repoOf(ctx);
  const state = flags.state || 'open';
  if (!PR_STATES.includes(state)) throw new UsageError(`gh: invalid state: ${state}`);
  const limit = limitOf(flags.limit);
  const fields = flags.json !== undefined ? fieldsOf(flags.json, PR_FIELDS) : null;
  const query = [`state=${state === 'merged' ? 'closed' : state}`,
    flags.head !== undefined ? `head=${enc(`${ctx.repo.split('/')[0]}:${flags.head}`)}` : '',
    flags.base !== undefined ? `base=${enc(flags.base)}` : '', 'per_page=100'].filter(Boolean).join('&');
  let prs = getJson(ctx, `repos/${ctx.repo}/pulls?${query}`, ['--paginate']);
  if (state === 'merged') prs = prs.filter((p) => p.merged_at);
  prs = prs.slice(0, limit);
  if (fields) {
    printJson(prs.map((p) => pick(p, fields, PR_FIELDS, ctx)));
    return 0;
  }
  for (const p of prs) process.stdout.write(`${p.number}\t${p.title}\t${p.head.ref}\t${stateOf(p)}\t${p.created_at}\n`);
  return 0;
};

/**
 * `pr view`: one pull request, its `--json` fields or gh's plain header lines, `--`, then the body.
 * @returns {number}
 */
const prView = (ctx, argv) => {
  const { flags, args } = parse(argv, [['json', null, 'value']]);
  repoOf(ctx);
  const fields = flags.json !== undefined ? fieldsOf(flags.json, PR_FIELDS) : null;
  const p = prOf(ctx, args, 'view');
  if (fields) {
    printJson(pick(p, fields, PR_FIELDS, ctx));
    return 0;
  }
  process.stdout.write([`title:\t${p.title}`, `state:\t${stateOf(p)}`, `number:\t${p.number}`, `url:\t${p.html_url}`,
    '--', `${p.body || ''}\n`].join('\n'));
  return 0;
};

/**
 * Seconds as Go's Duration prints them, the way gh prints a check's elapsed time.
 * @param {number} total whole seconds, above zero
 * @returns {string}
 */
const goDuration = (total) => {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h${m}m${s}s`;
  return m ? `${m}m${s}s` : `${s}s`;
};

/**
 * One check run as a check row: its bucket from the conclusion once completed, else pending.
 * @returns {{name: string, bucket: string, elapsed: string, url: string}}
 */
const runRow = (c) => {
  const secs = c.started_at && c.completed_at ? Math.round((Date.parse(c.completed_at) - Date.parse(c.started_at)) / 1000) : 0;
  return {
    name: c.name,
    bucket: c.status === 'completed' ? (BUCKETS[c.conclusion] || 'pending') : 'pending',
    elapsed: secs > 0 ? goDuration(secs) : '0',
    url: c.details_url || c.html_url || '',
  };
};

/**
 * Every check on a sha: its check runs, every page, then its commit statuses.
 * @returns {object[]} check rows
 */
const checksOn = (ctx, sha) => {
  const runs = api(ctx, 'GET', `repos/${ctx.repo}/commits/${sha}/check-runs?per_page=100`, ['--paginate', '-q', '.check_runs[]'])
    .split('\n').filter(Boolean).map((line) => runRow(JSON.parse(line)));
  const statuses = getJson(ctx, `repos/${ctx.repo}/commits/${sha}/status?per_page=100`).statuses.map((s) => ({
    name: s.context, bucket: BUCKETS[s.state] || 'pending', elapsed: '0', url: s.target_url || '',
  }));
  return [...runs, ...statuses];
};

/** Blocks the process for `seconds`; the watch's one wait. */
const pause = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

/**
 * `pr checks`: the head sha's checks, one line each, exit 1 on a failure and 8 on
 * a pending one, as gh's; `--watch` reads again every `--interval` seconds until
 * none is pending.
 * @returns {number}
 */
const prChecks = (ctx, argv) => {
  const { flags, args } = parse(argv, [['watch', null, 'bool'], ['interval', 'i', 'value']]);
  repoOf(ctx);
  const interval = flags.interval === undefined ? DEFAULT_INTERVAL : Number(flags.interval);
  if (!Number.isInteger(interval) || interval < 0) throw new UsageError(`gh: invalid interval: ${flags.interval}`);
  const p = prOf(ctx, args, 'checks');
  let rows = checksOn(ctx, p.head.sha);
  while (flags.watch && rows.some((r) => r.bucket === 'pending')) {
    pause(interval);
    rows = checksOn(ctx, p.head.sha);
  }
  if (!rows.length) throw new UsageError(`no checks reported on the '${p.head.ref}' branch`);
  for (const r of rows) process.stdout.write(`${r.name}\t${r.bucket}\t${r.elapsed}\t${r.url}\n`);
  if (rows.some((r) => r.bucket === 'fail')) return 1;
  return rows.some((r) => r.bucket === 'pending') ? PENDING_EXIT : 0;
};

/**
 * `pr merge`: one PUT with the one method asked; `--delete-branch` then DELETEs
 * the head ref, and a refused delete leaves the merge standing with one line.
 * A fork's head ref lives in the fork, so it is left, as gh leaves it.
 * @returns {number}
 */
const prMerge = (ctx, argv) => {
  const { flags, args } = parse(argv, [['merge', 'm', 'bool'], ['squash', 's', 'bool'], ['rebase', 'r', 'bool'],
    ['subject', 't', 'value'], ['body', 'b', 'value'], ['body-file', 'F', 'value'], ['delete-branch', 'd', 'bool']]);
  repoOf(ctx);
  const methods = MERGE_METHODS.filter((m) => flags[m]);
  if (!methods.length) throw new UsageError('gh: --merge, --rebase, or --squash required when not running interactively');
  if (methods.length > 1) throw new UsageError('gh: only one of --merge, --rebase, or --squash can be enabled');
  const n = args.length === 1 ? matchNumber(args[0], ['pull']) : null;
  const p = n && !flags['delete-branch'] ? null : prOf(ctx, args, 'merge');
  const number = n || p.number;
  const body = bodyOf(flags);
  send(ctx, 'PUT', `repos/${ctx.repo}/pulls/${number}/merge`, [...field('merge_method', methods[0]),
    ...(flags.subject !== undefined ? field('commit_title', flags.subject) : []),
    ...(body !== undefined ? field('commit_message', body) : [])]);
  if (!flags['delete-branch'] || p.head.repo?.full_name.toLowerCase() !== ctx.repo.toLowerCase()) return 0;
  try {
    api(ctx, 'DELETE', `repos/${ctx.repo}/git/refs/heads/${p.head.ref}`);
  } catch (err) {
    if (!(err instanceof GhFailure)) throw err;
    process.stderr.write(`gh: merged #${number}; branch ${p.head.ref} left, this cloud session cannot delete branches\n`);
  }
  return 0;
};

module.exports = {
  'pr create': prCreate,
  'pr list': prList,
  'pr view': prView,
  'pr checks': prChecks,
  'pr merge': prMerge,
};
