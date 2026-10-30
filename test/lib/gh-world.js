// A stateful GitHub behind a PATH `gh`, for a script that reads back what it
// wrote (the public pairing's intake, mirror and close): every repo's issues,
// labels and comments live in one JSON file each call rewrites. `gh issue` is
// served; a command, flag or field it does not know exits 1 naming it.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { shellPath, stubTool } = require('./platform');
const { mkTmp } = require('./harness');
const { viaJq } = require('./gh-stub');

const HOST = 'https://github.com';
const STAMP = '2026-10-29T00:00:00Z';

/**
 * A `gh` on its own bin folder answering from `repos`, each slug's issues as
 * `{ number, title, body, author, labels: [names], state, comments: [{ author, body }] }`
 * (author `octocat`, state `open` by default).
 * @param {object} repos - `owner/name` to its issue list
 * @param {{fail?: Array<{slug: string, number: number, op: string}>}} [opts] - each entry
 *   refuses the first label edit (`op` 'labels') or comment (`op` 'comment') of that issue once, as GitHub's 502
 * @returns {{binDir: string, issue: Function, issues: Function, writes: Function, calls: Function}}
 *   `issue(slug, n)` and `issues(slug)` read the state now; `writes()` lists each
 *   change as `{ slug, number, op }` in order; `calls()` every argv the stub got
 */
const mkGhWorld = (repos, { fail = [] } = {}) => {
  const dir = mkTmp('gh-world-');
  const stateFile = path.join(dir, 'state.json');
  const full = (i) => ({
    title: '', body: '', author: 'octocat', labels: [], state: 'open', comments: [], ...i,
  });
  const state = {
    repos: Object.fromEntries(Object.entries(repos).map(([slug, list]) => [slug, list.map(full)])),
    writes: [],
    calls: [],
    fail,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    `exec "${shellPath(process.execPath)}" "${shellPath(__filename)}" "${shellPath(stateFile)}" "$@"`,
  ]);
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return {
    binDir,
    dir,
    issues: (slug) => read().repos[slug] || [],
    issue: (slug, n) => (read().repos[slug] || []).find((i) => i.number === n),
    writes: () => read().writes,
    calls: () => read().calls,
  };
};

// The program half: one gh call against the state file.

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

const slugOf = (value) => value.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
const URL_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/;

// Each command's flags: name, then whether it takes a value. Short forms alias.
const FLAGS = {
  'issue list': { repo: 1, state: 1, label: 1, json: 1, jq: 1, limit: 1, author: 1 },
  'issue view': { repo: 1, json: 1, jq: 1, comments: 0 },
  'issue create': { repo: 1, title: 1, body: 1, 'body-file': 1, label: 1, assignee: 1 },
  'issue comment': { repo: 1, body: 1, 'body-file': 1 },
  'issue edit': { repo: 1, 'add-label': 1, 'remove-label': 1, title: 1, body: 1, 'body-file': 1 },
  'issue close': { repo: 1, comment: 1, reason: 1 },
};
const SHORT = {
  R: 'repo', s: 'state', l: 'label', q: 'jq', L: 'limit', A: 'author', c: 'comment', t: 'title', b: 'body',
  F: 'body-file', r: 'reason', a: 'assignee',
};

/** argv read against `spec` into `{ flags: name -> [values], args }`; any flag not in it refuses. */
const parse = (argv, spec, command) => {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i];
    if (!word.startsWith('-') || word === '-') { args.push(word); continue; }
    const [raw, inline] = word.startsWith('--') ? word.slice(2).split(/=(.*)/s) : [word.slice(1), undefined];
    const name = word.startsWith('--') ? raw : SHORT[raw];
    if (!name || !(name in spec)) refuse(`the fake gh does not serve ${command} ${word}`);
    let value = true;
    if (spec[name]) value = inline !== undefined ? inline : argv[(i += 1)];
    (flags[name] = flags[name] || []).push(value);
  }
  return { flags, args };
};
const one = (flags, name) => (flags[name] ? flags[name][flags[name].length - 1] : undefined);
const listOf = (flags, name) => (flags[name] || []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);

/** The repo a call acts on: an issue URL argument, -R, GH_REPO, then the cwd's origin. */
const repoOf = (flags, args) => {
  const url = args.map((a) => URL_RE.exec(a)).find(Boolean);
  if (url) return url[1];
  if (one(flags, 'repo')) return slugOf(one(flags, 'repo'));
  if (process.env.GH_REPO) return slugOf(process.env.GH_REPO);
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (origin.status !== 0) refuse('the fake gh found no repo: no -R, no GH_REPO and no origin');
  return slugOf(origin.stdout.trim());
};

const numberOf = (arg) => {
  const url = URL_RE.exec(arg || '');
  if (url) return Number(url[2]);
  if (!/^#?\d+$/.test(arg || '')) refuse(`the fake gh reads no issue number in ${JSON.stringify(arg)}`);
  return Number(arg.replace('#', ''));
};

const urlOf = (slug, i) => `${HOST}/${slug}/issues/${i.number}`;

// One issue as `gh issue --json` names its fields.
const ghFields = (slug, i) => ({
  number: i.number,
  title: i.title,
  body: i.body,
  state: i.state.toUpperCase(),
  closed: i.state === 'closed',
  author: { login: i.author },
  labels: i.labels.map((name) => ({ name })),
  comments: i.comments.map((c) => ({ author: { login: c.author }, body: c.body })),
  url: urlOf(slug, i),
  id: `I_${i.number}`,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const pick = (value, fields) => Object.fromEntries(fields.split(',').map((f) => {
  if (!(f in value)) refuse(`Unknown JSON field: "${f}"`);
  return [f, value[f]];
}));

/** One gh call over `state`: what it prints, and its exit. */
const serve = (state, argv) => {
  const out = [];
  const repoIssues = (slug) => (state.repos[slug] = state.repos[slug] || []);
  const find = (slug, n) => repoIssues(slug).find((i) => i.number === n) || refuse(`GraphQL: Could not resolve to an issue with the number of ${n}. (repository.issue)`);
  const wrote = (slug, number, op) => state.writes.push({ slug, number, op });
  const failOnce = (slug, number, op) => {
    const at = state.fail.findIndex((f) => f.slug === slug && f.number === number && f.op === op);
    if (at === -1) return;
    state.fail.splice(at, 1);
    refuse('HTTP 502: Server Error');
  };
  const bodyOf = (flags) => {
    const file = one(flags, 'body-file');
    if (file === undefined) return one(flags, 'body');
    return fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  };
  const emit = (value, jq) => out.push(jq ? viaJq(jq, value) : `${JSON.stringify(value)}\n`);
  const command = `${argv[0]} ${argv[1]}`;
  if (!FLAGS[command]) refuse(`the fake gh does not serve gh ${command}`);
  const { flags, args } = parse(argv.slice(2), FLAGS[command], command);

  const slug = repoOf(flags, args);
  const sub = argv[1];
  if (sub === 'list') {
    const want = one(flags, 'state') || 'open';
    const labels = listOf(flags, 'label');
    const rows = repoIssues(slug)
      .filter((i) => want === 'all' || i.state === want)
      .filter((i) => labels.every((l) => i.labels.includes(l)))
      .filter((i) => !one(flags, 'author') || i.author === one(flags, 'author'))
      .sort((a, b) => b.number - a.number)
      .slice(0, Number(one(flags, 'limit') || 30));
    if (one(flags, 'json')) emit(rows.map((i) => pick(ghFields(slug, i), one(flags, 'json'))), one(flags, 'jq'));
    else for (const i of rows) out.push(`${i.number}\t${i.state.toUpperCase()}\t${i.title}\t${i.labels.join(', ')}\t${STAMP}\n`);
    return { out, code: 0 };
  }
  if (sub === 'create') {
    const number = Math.max(0, ...repoIssues(slug).map((i) => i.number)) + 1;
    const issue = {
      number, title: one(flags, 'title') || '', body: bodyOf(flags) || '', author: 'owner',
      labels: listOf(flags, 'label'), state: 'open', comments: [],
    };
    repoIssues(slug).push(issue);
    wrote(slug, number, 'create');
    out.push(`${urlOf(slug, issue)}\n`);
    return { out, code: 0 };
  }
  const numbers = (sub === 'edit' ? args : args.slice(0, 1)).map(numberOf);
  if (numbers.length === 0) refuse(`gh issue ${sub} names no issue`);
  for (const number of numbers) {
    const issue = find(slug, number);
    if (sub === 'view') {
      if (one(flags, 'json')) emit(pick(ghFields(slug, issue), one(flags, 'json')), one(flags, 'jq'));
      else out.push(`title:\t${issue.title}\nstate:\t${issue.state.toUpperCase()}\nauthor:\t${issue.author}\nlabels:\t${issue.labels.join(', ')}\nnumber:\t${number}\n--\n${issue.body}\n`);
    } else if (sub === 'comment') {
      failOnce(slug, number, 'comment');
      issue.comments.push({ author: 'owner', body: bodyOf(flags) || '' });
      wrote(slug, number, 'comment');
      out.push(`${urlOf(slug, issue)}#issuecomment-${issue.comments.length}\n`);
    } else if (sub === 'edit') {
      const add = listOf(flags, 'add-label');
      const drop = listOf(flags, 'remove-label');
      if (add.length || drop.length) {
        failOnce(slug, number, 'labels');
        issue.labels = [...issue.labels.filter((l) => !drop.includes(l)), ...add.filter((l) => !issue.labels.includes(l))];
        wrote(slug, number, 'labels');
      }
      if (one(flags, 'title') !== undefined) { issue.title = one(flags, 'title'); wrote(slug, number, 'title'); }
      const body = bodyOf(flags);
      if (body !== undefined) { issue.body = body; wrote(slug, number, 'body'); }
      out.push(`${urlOf(slug, issue)}\n`);
    } else if (sub === 'close') {
      if (one(flags, 'comment') !== undefined) {
        issue.comments.push({ author: 'owner', body: one(flags, 'comment') });
        wrote(slug, number, 'comment');
      }
      issue.state = 'closed';
      wrote(slug, number, 'close');
    } else {
      refuse(`the fake gh does not serve gh issue ${sub}`);
    }
  }
  return { out, code: 0 };
};

const main = ([stateFile, ...argv]) => {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.calls.push(argv);
  let result;
  try {
    result = serve(state, argv);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    result = { out: [], err: `${err.message}\n`, code: 1 };
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  process.stdout.write(result.out.join(''));
  if (result.err) process.stderr.write(result.err);
  return result.code;
};

module.exports = { mkGhWorld };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
