// Tests for the gh shim's cloud path: in a Claude Code cloud session the kit's
// issue, label and auth verbs reach GitHub as REST calls through the real gh,
// printed in gh's own shape. Each case runs a scratch kit's shim with
// CLAUDE_CODE_REMOTE=true against a stub gh answering `gh api` routes from
// fixtures shaped like GitHub's REST answers, then reads the requests and output.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun, mkTmp, seeded, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, IS_WINDOWS, NO_NODE_STUB, shellPath, systemPathWith, homeEnv,
} = require('../../lib/platform');
const { makeGhStub, ghCalls, ghRequests } = require('../../lib/gh-stub');
const { eqArgv, fmtCalls } = require('../../lib/argv-log');
const { mkOriginRepo } = require('../../lib/git-repo');
const { scratchKit } = require('../../lib/identity');

const CREATED = '2026-10-20T08:00:00Z';
const UPDATED = '2026-10-28T21:38:46Z';

// The proxy's answer for a repo the session has not attached.
const NOT_ATTACHED = 'GitHub access to this repository is not enabled for this session. Use add_repo to request access';

// A kit, a repo whose origin is acme/rostered, and an empty home, copied per case.
const seed = seeded((dir) => {
  fs.cpSync(scratchKit(), path.join(dir, 'kit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'repo'));
  mkOriginRepo(path.join(dir, 'repo'), 'https://github.com/acme/rostered.git');
  fs.mkdirSync(path.join(dir, 'home'));
});

const mkWorld = () => {
  const root = mkTmp('wk-gh-rest-');
  seed(root);
  return {
    root, shim: path.join(root, 'kit', 'workflow', 'identity', 'gh'), repo: path.join(root, 'repo'), home: path.join(root, 'home'),
  };
};

/**
 * Run the shim in a cloud session with `args` from the acme/rostered repo, the
 * real gh a stub answering `api` (keyed `<METHOD> <route>`); `env` adds variables.
 * Returns the exit, both streams, every call the stub saw and every `gh api` request it answered.
 */
const runCloud = (args, { api = {}, env: extra = {} } = {}) => {
  const world = mkWorld();
  const stub = makeGhStub({ api });
  const env = homeEnv(world.home, {
    PATH: systemPathWith(path.dirname(world.shim), stub.binDir, NODE_DIR),
    CLAUDECODE: '1',
    CLAUDE_CODE_REMOTE: 'true',
    ...extra,
  });
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const res = spawnSync(BASH, [...NO_RC, shellPath(world.shim), ...args],
    { cwd: world.repo, env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return {
    code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', calls: ghCalls(stub), requests: ghRequests(stub), root: world.root,
  };
};

const assertSame = (actual, expected, msg) => {
  assert(isDeepStrictEqual(actual, expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Exit 0, or a failure naming what the shim said and asked. */
const assertOk = (res, what) => {
  assertEq(res.code, 0, `${what}: the exit (stderr: ${res.stderr.trim()}, requests: ${JSON.stringify(res.requests)})`);
};

/** What the shim printed, parsed as the JSON gh prints; a failure naming the text when it is not. */
const printedJson = (res, what) => {
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`${what}: stdout is not JSON, got: ${res.stdout}`);
  }
};

/** The requests that change something, as `[method, path]` pairs. */
const writes = (res) => res.requests.filter((r) => r.method !== 'GET');
const routes = (reqs) => reqs.map((r) => [r.method, r.path]);

/** A label as GitHub's REST API answers one. */
const restLabel = (name) => ({
  id: 9000 + name.length,
  node_id: `LA_${name.replace(/\W/g, '')}`,
  url: `https://api.github.com/repos/acme/rostered/labels/${encodeURIComponent(name)}`,
  name,
  color: 'C47206',
  default: false,
  description: `The ${name} label.`,
});

/** An issue as GitHub's REST issues routes answer one; `pr` makes it a pull request. */
const restIssue = (repo, number, {
  labels = [], updatedAt = UPDATED, pr = false, ...rest
} = {}) => ({
  url: `https://api.github.com/repos/${repo}/issues/${number}`,
  html_url: `https://github.com/${repo}/${pr ? 'pull' : 'issues'}/${number}`,
  id: 3000000 + number,
  node_id: `I_kwDO${number}`,
  number,
  title: `Item ${number}`,
  user: { login: 'octocat' },
  labels: labels.map(restLabel),
  state: 'open',
  state_reason: null,
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  comments: 0,
  author_association: 'OWNER',
  created_at: CREATED,
  updated_at: updatedAt,
  closed_at: null,
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
  issue_dependencies_summary: {
    blocked_by: 0, blocking: 0, total_blocked_by: 0, total_blocking: 0,
  },
  body: '',
  ...(pr ? { pull_request: { url: `https://api.github.com/repos/${repo}/pulls/${number}`, html_url: `https://github.com/${repo}/pull/${number}` } } : {}),
  ...rest,
});

/** A comment as GitHub's REST comments routes answer one, never edited. */
const restComment = (number, id, {
  body, login, createdAt, association = 'OWNER',
}) => ({
  id,
  node_id: `IC_kwDO${id}`,
  url: `https://api.github.com/repos/acme/rostered/issues/comments/${id}`,
  html_url: `https://github.com/acme/rostered/issues/${number}#issuecomment-${id}`,
  issue_url: `https://api.github.com/repos/acme/rostered/issues/${number}`,
  user: { login },
  author_association: association,
  minimized: null,
  created_at: createdAt,
  updated_at: createdAt,
  body,
});

// acme/rostered's open status:building issues, two pages of REST: a full page of
// 100 (numbers 300 down to 201, number 250 a pull request), then 200, 199, 198.
const LIST_PAGES = [
  Array.from({ length: 100 }, (_, i) => 300 - i).map((n) => restIssue('acme/rostered', n, {
    labels: n === 300 ? ['status:building', 'agent:claimed'] : ['status:building'],
    updatedAt: n === 300 ? '2026-10-27T09:15:00Z' : UPDATED,
    pr: n === 250,
  })),
  [200, 199, 198].map((n) => restIssue('acme/rostered', n, { labels: ['status:building'] })),
];
const LISTED = [...Array.from({ length: 100 }, (_, i) => 300 - i).filter((n) => n !== 250), 200, 199, 198];

const cases = async () => {
  // rest.js starts the stub `gh` from Node, which Windows cannot do by name.
  const runTest = testUnless(IS_WINDOWS, NO_NODE_STUB);
  group('identity/gh in a cloud session: auth');

  await runTest('case 1: auth status names the login gh api user answers, exit 0; an empty login exits 1 with gh\'s not-logged-in line', async () => {
    const res = runCloud(['auth', 'status'], { api: { 'GET user': { body: { login: 'octocat', id: 583231, type: 'User' } } } });
    assertOk(res, 'auth status with a login');
    const lines = `${res.stdout}${res.stderr}`.split('\n').filter((l) => l.trim());
    assertEq(lines.length, 1, `one line, got: ${JSON.stringify(lines)}`);
    assert(lines[0].includes('octocat'), `the line names the login, got: ${lines[0]}`);
    assert(res.requests.some((r) => r.method === 'GET' && r.path === 'user'), `it asked gh api user, got: ${JSON.stringify(res.requests)}`);

    const none = runCloud(['auth', 'status'], { api: { 'GET user': { body: { login: '' } } } });
    assertEq(none.code, 1, `an empty login exits 1, stdout: ${none.stdout}, stderr: ${none.stderr}`);
    assert(none.stderr.includes('You are not logged into any GitHub hosts. To log in, run: gh auth login'),
      `with gh's not-logged-in line, got: ${none.stderr}`);
  });

  group('identity/gh in a cloud session: issue reads');

  await runTest('case 2: issue list reads every page of open issues with the label, drops the pull request, and prints gh\'s array', async () => {
    const api = {
      'GET repos/acme/rostered/issues': { pages: LIST_PAGES },
      'GET repos/other/rostered/issues': { pages: [[restIssue('other/rostered', 12, { labels: ['status:building'] })]] },
    };
    const list = (limit) => ['issue', 'list', '--state', 'open', '--label', 'status:building', '--json', 'number,labels,updatedAt', '--limit', limit];

    const res = runCloud(list('1000'), { api });
    assertOk(res, 'issue list');
    assert(res.requests.length > 0, 'it asked gh api');
    const first = res.requests[0];
    assertSame([first.method, first.path], ['GET', 'repos/acme/rostered/issues'], 'the issues route of the cwd\'s repo');
    assertSame([first.query.state, first.query.labels, first.query.per_page], ['open', 'status:building', '100'],
      `with state, labels and per_page, got: ${JSON.stringify(first.query)}`);
    const printed = printedJson(res, 'issue list');
    assertSame(printed.map((i) => i.number), LISTED, 'every issue on both pages, in order, #250 the pull request dropped');
    assertSame(printed[0].labels.map((l) => l.name), ['status:building', 'agent:claimed'], 'labels[].name');
    assertEq(printed[0].updatedAt, '2026-10-27T09:15:00Z', 'updatedAt is the issue\'s updated_at');
    assertEq(printed[101].updatedAt, UPDATED, 'and on the second page too');

    const capped = runCloud(list('5'), { api });
    assertOk(capped, 'issue list --limit 5');
    assertSame(printedJson(capped, '--limit 5').map((i) => i.number), [300, 299, 298, 297, 296], '--limit caps the array');

    for (const [label, args, env] of [
      ['--repo', [...list('1000'), '--repo', 'other/rostered'], {}],
      ['GH_REPO', list('1000'), { GH_REPO: 'other/rostered' }],
    ]) {
      const other = runCloud(args, { api, env });
      assertOk(other, `issue list, repo from ${label}`);
      assertSame(other.requests.map((r) => r.path), ['repos/other/rostered/issues'], `${label} picks the repo`);
      assertSame(printedJson(other, label).map((i) => i.number), [12], `${label}: that repo's issues`);
    }
  });

  await runTest('case 2: issue list --search sends the search to search/issues scoped to the repo\'s open issues, and prints every page\'s items', async () => {
    const page = (numbers) => ({
      total_count: 3, incomplete_results: false, items: numbers.map((n) => restIssue('acme/rostered', n, { labels: ['status:qa'] })),
    });
    const api = { 'GET search/issues': { pages: [page([12, 11]), page([10])] } };
    const res = runCloud(['issue', 'list', '--search', 'no:assignee sort:created-asc', '--json', 'number,labels'], { api });
    assertOk(res, 'issue list --search');
    assertSame(res.requests.map((r) => [r.method, r.path]), [['GET', 'search/issues']], 'one search request');
    const terms = res.requests[0].query.q.split(/\s+/);
    for (const term of ['repo:acme/rostered', 'is:issue', 'state:open', 'no:assignee', 'sort:created-asc']) {
      assert(terms.includes(term), `the query carries ${term}, got: ${res.requests[0].query.q}`);
    }
    const printed = printedJson(res, 'issue list --search');
    assertSame(printed.map((i) => i.number), [12, 11, 10], 'every page\'s items, in order');
    assertSame(printed[0].labels.map((l) => l.name), ['status:qa'], 'labels[].name');
  });

  await runTest('case 2: issue list with no --json prints gh\'s plain rows: number, state, title, labels in their order, updatedAt', async () => {
    const api = {
      'GET repos/acme/rostered/issues': {
        pages: [[
          restIssue('acme/rostered', 9, { labels: ['type:bug', 'status:qa'] }),
          restIssue('acme/rostered', 8, { labels: ['status:building'], updatedAt: '2026-10-27T09:15:00Z' }),
          restIssue('acme/rostered', 5, { pr: true }),
        ]],
      },
    };
    const res = runCloud(['issue', 'list'], { api });
    assertOk(res, 'issue list');
    assertEq(res.stdout, [
      '9\tOPEN\tItem 9\ttype:bug, status:qa\t2026-10-28T21:38:46Z',
      '8\tOPEN\tItem 8\tstatus:building\t2026-10-27T09:15:00Z',
      '',
    ].join('\n'), 'gh\'s rows, the pull request dropped');
  });

  await runTest('case 3: issue view reads the issue and its comments and prints them with gh\'s field names, state upper-cased', async () => {
    const api = {
      'GET repos/acme/rostered/issues/7': {
        body: restIssue('acme/rostered', 7, { labels: ['status:qa', 'type:bug'], body: 'The body of #7.\n\n## Spec\nIt works.' }),
      },
      'GET repos/acme/rostered/issues/7/comments': {
        pages: [[
          restComment(7, 1001, { body: 'Claimed.', login: 'octocat', createdAt: '2026-10-28T20:00:00Z' }),
          restComment(7, 1002, { body: 'Parked.\nProof: green.', login: 'hubot', createdAt: '2026-10-28T21:00:00Z' }),
        ]],
      },
    };
    const res = runCloud(['issue', 'view', '7', '--json', 'state,labels,comments,url,body'], { api });
    assertOk(res, 'issue view');
    const view = printedJson(res, 'issue view');
    assertEq(view.state, 'OPEN', 'state as gh prints it');
    assertEq(view.url, 'https://github.com/acme/rostered/issues/7', 'url is the issue\'s page');
    assertEq(view.body, 'The body of #7.\n\n## Spec\nIt works.', 'body');
    assertSame(view.labels.map((l) => l.name), ['status:qa', 'type:bug'], 'labels[].name');
    assertSame(view.comments.map((c) => [c.body, c.author.login, c.createdAt]), [
      ['Claimed.', 'octocat', '2026-10-28T20:00:00Z'],
      ['Parked.\nProof: green.', 'hubot', '2026-10-28T21:00:00Z'],
    ], 'comments[].body, author.login and createdAt');

    const bare = runCloud(['issue', 'view', '7', '--json', 'state,labels'], { api });
    assertOk(bare, 'issue view without comments');
    assertSame(bare.requests.map((r) => r.path), ['repos/acme/rostered/issues/7'], 'no comments asked, no /comments request');
  });

  await runTest('case 3: issue view and issue view --comments with no --json print gh\'s plain text', async () => {
    const api = {
      'GET repos/acme/rostered/issues/7': {
        body: restIssue('acme/rostered', 7, { labels: ['type:bug', 'status:qa'], comments: 2, body: 'The body of #7.\n' }),
      },
      'GET repos/acme/rostered/issues/7/comments': {
        pages: [[
          restComment(7, 1001, { body: 'Claimed.', login: 'octocat', createdAt: '2026-10-28T20:00:00Z' }),
          restComment(7, 1002, {
            body: 'Parked.\nProof: green.', login: 'hubot', createdAt: '2026-10-28T21:00:00Z', association: 'NONE',
          }),
        ]],
      },
    };
    const view = runCloud(['issue', 'view', '7'], { api });
    assertOk(view, 'issue view');
    assertEq(view.stdout, [
      'title:\tItem 7', 'state:\tOPEN', 'author:\toctocat', 'labels:\tstatus:qa, type:bug', 'comments:\t2',
      'assignees:\t', 'projects:\t', 'milestone:\t', 'issue-type:\t', 'parent:\t', 'sub-issues:\t',
      'sub-issues-completed:\t', 'blocked-by:\t', 'blocking:\t', 'number:\t7', '--', 'The body of #7.', '', '',
    ].join('\n'), 'gh\'s header, labels sorted, then the body');

    const comments = runCloud(['issue', 'view', '7', '--comments'], { api });
    assertOk(comments, 'issue view --comments');
    assertEq(comments.stdout, [
      'author:\toctocat', 'association:\towner', 'edited:\tfalse', 'status:\tnone', '--', 'Claimed.', '--',
      'author:\thubot', 'association:\tnone', 'edited:\tfalse', 'status:\tnone', '--', 'Parked.', 'Proof: green.', '--', '',
    ].join('\n'), 'each comment\'s header, its body, and the rule');
  });

  group('identity/gh in a cloud session: issue writes');

  await runTest('case 4: issue edit adds labels with one POST then one DELETE per removed label; a title and body become one PATCH', async () => {
    const base = 'repos/acme/rostered/issues/7';
    const api = {
      [`POST ${base}/labels`]: { body: [restLabel('status:qa')] },
      [`DELETE ${base}/labels/status:building`]: { body: [restLabel('agent:claimed'), restLabel('status:qa')] },
      [`DELETE ${base}/labels/agent:claimed`]: { body: [restLabel('status:qa')] },
      [`PATCH ${base}`]: { body: restIssue('acme/rostered', 7) },
    };
    const flip = runCloud(['issue', 'edit', '7', '--add-label', 'status:qa', '--remove-label', 'status:building,agent:claimed'], { api });
    assertOk(flip, 'issue edit --add-label --remove-label');
    assertSame(routes(writes(flip)), [
      ['POST', `${base}/labels`], ['DELETE', `${base}/labels/status:building`], ['DELETE', `${base}/labels/agent:claimed`],
    ], 'the add, then each removal');
    const added = writes(flip)[0].body;
    assertSame(Array.isArray(added) ? added : added.labels, ['status:qa'], 'the POST carries the added label');

    const text = runCloud(['issue', 'edit', '7', '--title', 'A new title', '--body', 'A new body.'], { api });
    assertOk(text, 'issue edit --title --body');
    assertSame(routes(writes(text)), [['PATCH', base]], 'one PATCH');
    assertSame([writes(text)[0].body.title, writes(text)[0].body.body], ['A new title', 'A new body.'], 'carrying the title and body');

    const dir = mkTmp('wk-gh-rest-body-');
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, '## Spec\n\nFrom a file.\n');
    const fromFile = runCloud(['issue', 'edit', '7', '--body-file', file], { api });
    assertOk(fromFile, 'issue edit --body-file');
    assertSame(routes(writes(fromFile)), [['PATCH', base]], 'one PATCH');
    assertEq(writes(fromFile)[0].body.body, '## Spec\n\nFrom a file.\n', 'carrying the file\'s text as the body');
  });

  await runTest('case 5: issue comment posts the body, from --body or --body-file, and prints the comment\'s URL', async () => {
    const url = 'https://github.com/acme/rostered/issues/7#issuecomment-2002';
    const api = {
      'POST repos/acme/rostered/issues/7/comments': { status: 201, body: restComment(7, 2002, { body: 'x', login: 'octocat', createdAt: UPDATED }) },
    };
    const res = runCloud(['issue', 'comment', '7', '--body', 'Parked at status:qa.'], { api });
    assertOk(res, 'issue comment --body');
    assertSame(routes(writes(res)), [['POST', 'repos/acme/rostered/issues/7/comments']], 'one POST to the comments');
    assertEq(writes(res)[0].body.body, 'Parked at status:qa.', 'carrying the body');
    assertEq(res.stdout, `${url}\n`, 'the comment URL, as gh prints it');

    const dir = mkTmp('wk-gh-rest-comment-');
    const file = path.join(dir, 'comment.md');
    fs.writeFileSync(file, 'Line one.\nProof: green.\n');
    const fromFile = runCloud(['issue', 'comment', '7', '--body-file', file], { api });
    assertOk(fromFile, 'issue comment --body-file');
    assertEq(writes(fromFile)[0].body.body, 'Line one.\nProof: green.\n', 'the file\'s text is the body');
    assertEq(fromFile.stdout, `${url}\n`, 'and the comment URL prints');
  });

  await runTest('case 6: issue close --comment posts the comment, then PATCHes the issue closed', async () => {
    const api = {
      'POST repos/acme/rostered/issues/7/comments': { status: 201, body: restComment(7, 2003, { body: 'x', login: 'octocat', createdAt: UPDATED }) },
      'PATCH repos/acme/rostered/issues/7': { body: restIssue('acme/rostered', 7, { state: 'closed' }) },
    };
    const res = runCloud(['issue', 'close', '7', '--comment', 'Shipped in 1.2.0.'], { api });
    assertOk(res, 'issue close --comment');
    assertSame(routes(writes(res)), [['POST', 'repos/acme/rostered/issues/7/comments'], ['PATCH', 'repos/acme/rostered/issues/7']],
      'the comment, then the close');
    assertEq(writes(res)[0].body.body, 'Shipped in 1.2.0.', 'the comment\'s body');
    assertEq(writes(res)[1].body.state, 'closed', 'the PATCH closes it');
  });

  await runTest('case 6: issue close --reason "not planned" PATCHes the issue closed with REST\'s not_planned reason', async () => {
    const api = { 'PATCH repos/acme/rostered/issues/7': { body: restIssue('acme/rostered', 7, { state: 'closed', state_reason: 'not_planned' }) } };
    const res = runCloud(['issue', 'close', '7', '--reason', 'not planned'], { api });
    assertOk(res, 'issue close --reason');
    assertSame(routes(writes(res)), [['PATCH', 'repos/acme/rostered/issues/7']], 'one PATCH');
    assertSame([writes(res)[0].body.state, writes(res)[0].body.state_reason], ['closed', 'not_planned'], 'closed, with the reason');
  });

  await runTest('case 7: issue create posts the title, body and labels and prints the new issue\'s URL', async () => {
    const api = {
      'POST repos/acme/rostered/issues': { status: 201, body: restIssue('acme/rostered', 475, { labels: ['status:inbox', 'type:feature'] }) },
    };
    const res = runCloud(['issue', 'create', '--title', 'A note', '--body', 'Noted.', '--label', 'status:inbox,type:feature'], { api });
    assertOk(res, 'issue create');
    assertSame(routes(writes(res)), [['POST', 'repos/acme/rostered/issues']], 'one POST to the issues');
    const sent = writes(res)[0].body;
    assertSame([sent.title, sent.body, sent.labels], ['A note', 'Noted.', ['status:inbox', 'type:feature']], 'title, body and labels');
    assertEq(res.stdout, 'https://github.com/acme/rostered/issues/475\n', 'the issue URL, as gh prints it');
  });

  group('identity/gh in a cloud session: labels');

  await runTest('case 8: label list reads every page; label create POSTs and label edit PATCHes the named label', async () => {
    const names = [...Array.from({ length: 100 }, (_, i) => `area:${String(i).padStart(3, '0')}`), 'status:qa', 'type:bug'];
    const api = {
      'GET repos/acme/rostered/labels': { pages: [names.slice(0, 100).map(restLabel), names.slice(100).map(restLabel)] },
      'POST repos/acme/rostered/labels': { status: 201, body: restLabel('status:new') },
      'PATCH repos/acme/rostered/labels/status:qa': { body: restLabel('status:qa') },
    };
    const res = runCloud(['label', 'list', '--json', 'name,description,color', '--limit', '300'], { api });
    assertOk(res, 'label list');
    const printed = printedJson(res, 'label list');
    assertSame(printed.map((l) => l.name), names, 'every label on both pages');
    assertSame([printed[100].description, printed[100].color], ['The status:qa label.', 'C47206'], 'with its description and color');

    const created = runCloud(['label', 'create', 'status:new', '--description', 'A new stage.', '--color', '0E8A16'], { api });
    assertOk(created, 'label create');
    assertSame(routes(writes(created)), [['POST', 'repos/acme/rostered/labels']], 'one POST to the labels');
    const sent = writes(created)[0].body;
    assertSame([sent.name, sent.description, sent.color], ['status:new', 'A new stage.', '0E8A16'], 'name, description and color');

    const edited = runCloud(['label', 'edit', 'status:qa', '--description', 'Built, checking.', '--color', 'FBCA04'], { api });
    assertOk(edited, 'label edit');
    assertSame(routes(writes(edited)), [['PATCH', 'repos/acme/rostered/labels/status:qa']], 'one PATCH to the label');
    const patch = writes(edited)[0].body;
    assertSame([patch.description, patch.color], ['Built, checking.', 'FBCA04'], 'description and color');
  });

  await runTest('case 8: label edit --name PATCHes the old label with the new name', async () => {
    const api = { 'PATCH repos/acme/rostered/labels/status:qa': { body: restLabel('status:check') } };
    const res = runCloud(['label', 'edit', 'status:qa', '--name', 'status:check'], { api });
    assertOk(res, 'label edit --name');
    assertSame(routes(writes(res)), [['PATCH', 'repos/acme/rostered/labels/status:qa']], 'one PATCH to the old label');
    assertEq(writes(res)[0].body.new_name, 'status:check', 'carrying the new name');
  });

  group('identity/gh in a cloud session: the proxy\'s refusal');

  await runTest('case 11: a repo the session has not attached answers the proxy\'s 403, relayed with its message, exit 1', async () => {
    const api = { 'GET repos/other/unattached/issues': { status: 403, body: { message: NOT_ATTACHED } } };
    const res = runCloud(['issue', 'list', '--state', 'open', '--json', 'number', '--repo', 'other/unattached'], { api });
    assertEq(res.code, 1, `gh's exit 1, stderr: ${res.stderr}`);
    assert(res.stderr.includes(NOT_ATTACHED), `stderr carries the proxy's message, got: ${res.stderr}`);
    assert(res.stderr.includes('HTTP 403'), `and its code, got: ${res.stderr}`);
  });

  group('identity/gh in a cloud session: what REST does not serve');

  await test('a --json field the shim does not serve (blockedBy) exits 1 with one line naming it', async () => {
    const res = runCloud(['issue', 'view', '7', '--json', 'state,blockedBy'], { api: {} });
    assertEq(res.code, 1, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`);
    const lines = `${res.stdout}${res.stderr}`.split('\n').filter((l) => l.trim());
    assertEq(lines.length, 1, `one line, got: ${JSON.stringify(lines)}`);
    assert(lines[0].includes('blockedBy'), `the line names the field, got: ${lines[0]}`);
  });

  await test('issue create --assignee is an unserved flag: exit 1 with one line naming it, and no issue is created', async () => {
    const api = { 'POST repos/acme/rostered/issues': { status: 201, body: restIssue('acme/rostered', 476) } };
    const res = runCloud(['issue', 'create', '--title', 'A note', '--body', 'Noted.', '--assignee', 'x'], { api });
    assertEq(res.code, 1, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`);
    const lines = `${res.stdout}${res.stderr}`.split('\n').filter((l) => l.trim());
    assertEq(lines.length, 1, `one line, got: ${JSON.stringify(lines)}`);
    assert(lines[0].includes('--assignee'), `the line names the flag, got: ${lines[0]}`);
    assertSame(writes(res), [], 'no issue is created');
  });

  await runTest('a subcommand REST does not serve (issue develop) runs the real gh once, whole, with no gh api call', async () => {
    const argv = ['issue', 'develop', '7', '--name', 'fix-7'];
    const res = runCloud(argv, { api: {} });
    assertOk(res, 'issue develop');
    assertEq(res.calls.length, 1, `the real gh runs once, got ${fmtCalls(res.calls)}`);
    assert(eqArgv(res.calls[0], argv), `every argument passed through, got ${fmtCalls(res.calls)}`);
    assertEq(res.requests.length, 0, `no gh api call, got: ${JSON.stringify(res.requests)}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
