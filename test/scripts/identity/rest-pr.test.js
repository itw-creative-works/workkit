// Tests for the gh shim's cloud pr verbs: in a Claude Code cloud session `gh pr
// create`, `list`, `view`, `checks` and `merge` reach GitHub as REST calls through
// the real gh, printed in gh's own shape, since the session's proxy refuses GraphQL.
// Each case runs a scratch kit's shim with CLAUDE_CODE_REMOTE=true from a repo on
// branch claude/work, against a stub gh answering `gh api` routes from fixtures
// shaped like GitHub's REST answers, then reads the requests and output.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, start, until,
} = require('../../lib/harness');
const {
  BASH, NO_RC, skipWithoutNodeStub, shellPath,
} = require('../../lib/platform');
const { makeGhStub, ghRequests } = require('../../lib/gh-stub');
const { eqArgv, fmtCalls } = require('../../lib/argv-log');
const {
  git, cloudEnv, cloudWorld, assertSame, assertOk, printedJson, writes, routes,
} = require('../../lib/identity');

const CREATED = '2026-10-20T08:00:00Z';
const HEAD_SHA = '9f3c2a1b7d4e5f60718293a4b5c6d7e8f9012345';
const MERGE_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const PULLS = 'repos/acme/rostered/pulls';

// A world whose repo has one commit, on claude/work.
const { mkWorld, runCloud } = cloudWorld({ branch: 'claude/work' });

const asked = (res, route) => res.requests.filter((r) => r.method === 'GET' && r.path === route);
const lines = (text) => text.split('\n').filter((l) => l.trim());

/** A pull request as GitHub's REST pulls routes answer one. */
const restPull = (number, {
  head = 'claude/work', base = 'main', state = 'open', mergedAt = null, draft = false, title = `Pull ${number}`, body = '', createdAt = CREATED,
  headRepo = 'acme/rostered',
} = {}) => ({
  url: `https://api.github.com/${PULLS}/${number}`,
  html_url: `https://github.com/acme/rostered/pull/${number}`,
  id: 5000000 + number,
  node_id: `PR_kwDO${number}`,
  number,
  state,
  locked: false,
  title,
  body,
  user: { login: 'octocat' },
  created_at: createdAt,
  updated_at: createdAt,
  closed_at: mergedAt,
  merged_at: mergedAt,
  // GitHub fills this for an open pull request too: its test merge, never the merge.
  merge_commit_sha: MERGE_SHA,
  draft,
  head: { label: `${headRepo.split('/')[0]}:${head}`, ref: head, sha: HEAD_SHA, repo: { full_name: headRepo } },
  base: { label: `acme:${base}`, ref: base, sha: 'b'.repeat(40), repo: { full_name: 'acme/rostered' } },
});

/** A check run as GitHub's REST check-runs route answers one; `status` other than completed has no conclusion. */
const checkRun = (name, status, conclusion = null) => ({
  id: 7000 + name.length,
  name,
  head_sha: HEAD_SHA,
  status,
  conclusion,
  started_at: '2026-11-05T10:00:00Z',
  completed_at: status === 'completed' ? '2026-11-05T10:01:30Z' : null,
  html_url: `https://github.com/acme/rostered/actions/runs/1/job/${name}`,
  details_url: `https://github.com/acme/rostered/actions/runs/1/job/${name}`,
});
const runsPage = (runs, total = runs.length) => ({ total_count: total, check_runs: runs });

/** The combined status route's answer, each status `[context, state]`. */
const combined = (statuses) => ({
  state: statuses.length ? statuses[0][1] : 'pending',
  sha: HEAD_SHA,
  total_count: statuses.length,
  statuses: statuses.map(([context, state]) => ({
    context, state, target_url: `https://ci.example.com/${context}`, description: '', created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:02:00Z',
  })),
});

/** The routes `pr checks 12` reads: the pull request, every page of its head's check runs, its combined status. */
const checksApi = (runPages, statuses = []) => ({
  [`GET ${PULLS}/12`]: { body: restPull(12) },
  [`GET repos/acme/rostered/commits/${HEAD_SHA}/check-runs`]: { pages: runPages },
  [`GET repos/acme/rostered/commits/${HEAD_SHA}/status`]: { body: combined(statuses) },
});

/** Each printed check line as `[name, bucket, url]`, sorted by name, every line four tab-separated fields. */
const checkLines = (res) => lines(res.stdout).map((l) => {
  const f = l.split('\t');
  expect(f.length, `a check line is name, bucket, elapsed, url, got: ${JSON.stringify(l)}`).toBe(4);
  return [f[0], f[1], f[3]];
}).sort((a, b) => a[0].localeCompare(b[0]));

// The shim starts the stub `gh` from Node through rest.js, as rest.test.js does; on Windows these skip alike.
describe('identity/gh in a cloud session: pr create', () => {
  test('pr create with no --head or --base posts the current branch against the repo\'s default branch and prints the PR\'s URL', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      'GET repos/acme/rostered': { body: { full_name: 'acme/rostered', default_branch: 'develop' } },
      [`POST ${PULLS}`]: { status: 201, body: restPull(42, { base: 'develop' }) },
    };
    const res = runCloud(['pr', 'create', '--title', 'feat: a thing', '--body', 'Fixes #7'], { api });
    assertOk(res, 'pr create');
    assertSame(routes(writes(res)), [['POST', PULLS]], 'one POST to the pulls');
    const sent = writes(res)[0].body;
    assertSame([sent.title, sent.body, sent.base], ['feat: a thing', 'Fixes #7', 'develop'], 'title, body, and the default branch as base');
    expect(['claude/work', 'acme:claude/work'].includes(sent.head), `the head is the current branch, got: ${sent.head}`).toBeTruthy();
    expect(res.stdout, 'the PR\'s URL, as gh prints it').toBe('https://github.com/acme/rostered/pull/42\n');
  });

  test('pr create -t -F -H -B posts the given title, the file\'s text as body, and the named head and base', { skip: skipWithoutNodeStub() }, async () => {
    const dir = mkTmp('wk-gh-rest-pr-body-');
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, 'Fixes #7\nFixes #8\n');
    const api = { [`POST ${PULLS}`]: { status: 201, body: restPull(43, { head: 'feature/x', base: 'release' }) } };
    const res = runCloud(['pr', 'create', '-t', 'fix: a bug', '-F', file, '-H', 'feature/x', '-B', 'release'], { api });
    assertOk(res, 'pr create with short flags');
    assertSame(routes(writes(res)), [['POST', PULLS]], 'one POST to the pulls');
    const sent = writes(res)[0].body;
    assertSame([sent.title, sent.body, sent.base], ['fix: a bug', 'Fixes #7\nFixes #8\n', 'release'], 'title, the file\'s body, base');
    expect(['feature/x', 'acme:feature/x'].includes(sent.head), `the named head, got: ${sent.head}`).toBeTruthy();
    expect(res.stdout, 'the PR\'s URL').toBe('https://github.com/acme/rostered/pull/43\n');
  });

  test('pr create on a detached HEAD with no --head is refused with a line and opens no PR', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      'GET repos/acme/rostered': { body: { full_name: 'acme/rostered', default_branch: 'main' } },
      [`POST ${PULLS}`]: { status: 201, body: restPull(44) },
    };
    const res = runCloud(['pr', 'create', '-t', 'x', '-b', 'y'], { api, prep: (w) => git(w.repo, w.home, 'checkout', '-q', '--detach') });
    expect(res.code !== 0, `a refusal, got exit ${res.code}, stdout: ${res.stdout}`).toBeTruthy();
    expect(lines(res.stderr).length, `one line on stderr, got: ${JSON.stringify(res.stderr)}`).toBe(1);
    assertSame(writes(res), [], 'no PR is opened');
  });
});

describe('identity/gh in a cloud session: pr list', () => {
  test('pr list --head --state open reads every page with head=<owner>:<branch> and prints gh\'s fields, an open PR\'s mergeCommit null', { skip: skipWithoutNodeStub() }, async () => {
    const api = { [`GET ${PULLS}`]: { pages: [[restPull(12, { draft: true })], [restPull(9, { title: 'Older' })]] } };
    const fields = 'number,url,title,state,headRefName,headRefOid,baseRefName,isDraft,mergedAt,mergeCommit';
    const res = runCloud(['pr', 'list', '--head', 'claude/work', '--state', 'open', '--json', fields], { api });
    assertOk(res, 'pr list');
    const first = asked(res, PULLS)[0];
    expect(first, `it read the pulls route, got: ${JSON.stringify(res.requests)}`).toBeTruthy();
    assertSame([first.query.head, first.query.state], ['acme:claude/work', 'open'], `the head and state filters, got: ${JSON.stringify(first.query)}`);
    const printed = printedJson(res, 'pr list');
    assertSame(printed.map((p) => p.number), [12, 9], 'both pages, in order');
    assertSame(printed[0], {
      number: 12,
      url: 'https://github.com/acme/rostered/pull/12',
      title: 'Pull 12',
      state: 'OPEN',
      headRefName: 'claude/work',
      headRefOid: HEAD_SHA,
      baseRefName: 'main',
      isDraft: true,
      mergedAt: null,
      mergeCommit: null,
    }, 'gh\'s fields for an open draft');
  });

  test('pr list --state merged reads the closed pulls and keeps only the merged, state MERGED with its merge commit', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      [`GET ${PULLS}`]: {
        pages: [[restPull(12, { state: 'closed', mergedAt: '2026-11-05T11:00:00Z' }), restPull(11, { state: 'closed' })]],
      },
    };
    const res = runCloud(['pr', 'list', '--state', 'merged', '--json', 'number,state,mergedAt,mergeCommit'], { api });
    assertOk(res, 'pr list --state merged');
    expect(asked(res, PULLS)[0].query.state, 'REST has no merged state: it asks for closed').toBe('closed');
    assertSame(printedJson(res, '--state merged'), [{
      number: 12, state: 'MERGED', mergedAt: '2026-11-05T11:00:00Z', mergeCommit: { oid: MERGE_SHA },
    }], 'the merged one alone, the closed-unmerged dropped');
  });

  test('pr list with no --json prints one row per PR, number, title, head, STATE, createdAt; --limit caps it', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      [`GET ${PULLS}`]: {
        pages: [[
          restPull(14, { title: 'Third', head: 'claude/c' }),
          restPull(13, { title: 'Second', head: 'claude/b', createdAt: '2026-10-21T08:00:00Z' }),
          restPull(12, { title: 'First' }),
        ]],
      },
    };
    const res = runCloud(['pr', 'list', '--limit', '2'], { api });
    assertOk(res, 'pr list');
    expect(res.stdout, 'gh\'s rows, two of three').toBe([
      '14\tThird\tclaude/c\tOPEN\t2026-10-20T08:00:00Z',
      '13\tSecond\tclaude/b\tOPEN\t2026-10-21T08:00:00Z',
      '',
    ].join('\n'));
  });
});

describe('identity/gh in a cloud session: pr view', () => {
  test('pr view by number, by URL and by branch reads that PR, a merged one printing MERGED and its merge commit', { skip: skipWithoutNodeStub() }, async () => {
    const merged = restPull(12, { state: 'closed', mergedAt: '2026-11-05T11:00:00Z' });
    const api = {
      [`GET ${PULLS}/12`]: { body: merged },
      [`GET ${PULLS}`]: { pages: [[restPull(15, { head: 'claude/other' })]] },
    };
    const byNumber = runCloud(['pr', 'view', '12', '--json', 'number,state,headRefName,mergeCommit'], { api });
    assertOk(byNumber, 'pr view 12');
    assertSame(printedJson(byNumber, 'pr view 12'), {
      number: 12, state: 'MERGED', headRefName: 'claude/work', mergeCommit: { oid: MERGE_SHA },
    }, 'the merged PR\'s fields');

    const byUrl = runCloud(['pr', 'view', 'https://github.com/acme/rostered/pull/12', '--json', 'number'], { api });
    assertOk(byUrl, 'pr view <url>');
    expect(asked(byUrl, `${PULLS}/12`).length, `the URL's number is read, got: ${JSON.stringify(byUrl.requests)}`).toBe(1);
    assertSame(printedJson(byUrl, 'pr view <url>'), { number: 12 }, 'that PR');

    const byBranch = runCloud(['pr', 'view', 'claude/other', '--json', 'number,headRefName'], { api });
    assertOk(byBranch, 'pr view <branch>');
    expect(asked(byBranch, PULLS)[0].query.head, 'the branch is the head filter').toBe('acme:claude/other');
    assertSame(printedJson(byBranch, 'pr view <branch>'), { number: 15, headRefName: 'claude/other' }, 'that branch\'s PR');
  });

  test('pr view with no argument is the current branch\'s open PR; with none, gh\'s no-pull-requests line and exit 1', { skip: skipWithoutNodeStub() }, async () => {
    const found = runCloud(['pr', 'view', '--json', 'number'], { api: { [`GET ${PULLS}`]: { pages: [[restPull(12)]] } } });
    assertOk(found, 'pr view');
    const query = asked(found, PULLS)[0].query;
    assertSame([query.head, query.state], ['acme:claude/work', 'open'], `the current branch's open PR, got: ${JSON.stringify(query)}`);
    assertSame(printedJson(found, 'pr view'), { number: 12 }, 'that PR');

    const none = runCloud(['pr', 'view', '--json', 'number'], { api: { [`GET ${PULLS}`]: { pages: [[]] } } });
    expect(none.code, `exit 1, stdout: ${none.stdout}, stderr: ${none.stderr}`).toBe(1);
    expect(none.stderr.includes('no pull requests found for branch "claude/work"'), `gh's line, got: ${none.stderr}`).toBeTruthy();
  });

  test('pr view with no --json prints the title, state, number and url lines, then --, then the body', { skip: skipWithoutNodeStub() }, async () => {
    const api = { [`GET ${PULLS}/12`]: { body: restPull(12, { title: 'feat: a thing', body: 'Fixes #7\n\nThe change.' }) } };
    const res = runCloud(['pr', 'view', '12'], { api });
    assertOk(res, 'pr view 12');
    const head = 'title:\tfeat: a thing\nstate:\tOPEN\nnumber:\t12\nurl:\thttps://github.com/acme/rostered/pull/12\n--\nFixes #7\n\nThe change.';
    expect(res.stdout.startsWith(head), `gh's header then the body, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
  });

  test('pr view --json naming a field the shim does not serve exits 1 with one line naming it', async () => {
    const res = runCloud(['pr', 'view', '12', '--json', 'number,reviews'], { api: { [`GET ${PULLS}/12`]: { body: restPull(12) } } });
    expect(res.code, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`).toBe(1);
    const said = lines(`${res.stdout}${res.stderr}`);
    expect(said.length, `one line, got: ${JSON.stringify(said)}`).toBe(1);
    expect(said[0].includes('reviews'), `the line names the field, got: ${said[0]}`).toBeTruthy();
  });
});

describe('identity/gh in a cloud session: pr checks', () => {
  test('pr checks reads the head sha\'s check runs on every page and its statuses, one line each, exit 0 when all pass or skip', { skip: skipWithoutNodeStub() }, async () => {
    const api = checksApi(
      [runsPage([checkRun('build', 'completed', 'success'), checkRun('lint', 'completed', 'skipped')], 3), runsPage([checkRun('deploy', 'completed', 'success')], 3)],
      [['ci/legacy', 'success']],
    );
    const res = runCloud(['pr', 'checks', '12'], { api });
    assertOk(res, 'pr checks');
    expect(asked(res, `repos/acme/rostered/commits/${HEAD_SHA}/check-runs`).length > 0, `the head sha's check runs are read, got: ${JSON.stringify(res.requests)}`).toBeTruthy();
    expect(asked(res, `repos/acme/rostered/commits/${HEAD_SHA}/status`).length > 0, `and its combined status, got: ${JSON.stringify(res.requests)}`).toBeTruthy();
    expect(asked(res, `repos/acme/rostered/commits/${HEAD_SHA}/status`)[0].query.per_page, 'up to 100 statuses, past the route\'s 30 default').toBe('100');
    assertSame(checkLines(res), [
      ['build', 'pass', 'https://github.com/acme/rostered/actions/runs/1/job/build'],
      ['ci/legacy', 'pass', 'https://ci.example.com/ci/legacy'],
      ['deploy', 'pass', 'https://github.com/acme/rostered/actions/runs/1/job/deploy'],
      ['lint', 'skipping', 'https://github.com/acme/rostered/actions/runs/1/job/lint'],
    ], 'every run on both pages and the status, each bucketed');
  });

  test('pr checks exits 1 when a run or a status fails, and 8 when one is pending and none fails', { skip: skipWithoutNodeStub() }, async () => {
    const failed = runCloud(['pr', 'checks', '12'], {
      api: checksApi([runsPage([checkRun('build', 'completed', 'success'), checkRun('test', 'completed', 'failure')])]),
    });
    expect(failed.code, `a failed run exits 1, stdout: ${failed.stdout}, stderr: ${failed.stderr}`).toBe(1);
    assertSame(checkLines(failed).map((l) => l.slice(0, 2)), [['build', 'pass'], ['test', 'fail']], 'the failed run reads fail');

    const errored = runCloud(['pr', 'checks', '12'], {
      api: checksApi([runsPage([checkRun('build', 'completed', 'success')])], [['ci/legacy', 'error']]),
    });
    expect(errored.code, `an errored status exits 1, stdout: ${errored.stdout}, stderr: ${errored.stderr}`).toBe(1);

    const pending = runCloud(['pr', 'checks', '12'], {
      api: checksApi([runsPage([checkRun('build', 'completed', 'success'), checkRun('test', 'in_progress')])], [['ci/legacy', 'pending']]),
    });
    expect(pending.code, `a pending run exits 8, stdout: ${pending.stdout}, stderr: ${pending.stderr}`).toBe(8);
    assertSame(checkLines(pending).map((l) => l.slice(0, 2)), [['build', 'pass'], ['ci/legacy', 'pending'], ['test', 'pending']],
      'the run in progress and the pending status read pending');
  });

  test('pr checks with no argument on a branch whose PR has no checks prints gh\'s no-checks line, exit 1', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      [`GET ${PULLS}`]: { pages: [[restPull(12)]] },
      [`GET repos/acme/rostered/commits/${HEAD_SHA}/check-runs`]: { pages: [runsPage([])] },
      [`GET repos/acme/rostered/commits/${HEAD_SHA}/status`]: { body: combined([]) },
    };
    const res = runCloud(['pr', 'checks'], { api });
    expect(res.code, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`).toBe(1);
    expect(`${res.stdout}${res.stderr}`.includes('no checks reported on the \'claude/work\' branch'), `gh's line, got: ${res.stderr}`).toBeTruthy();
  });

  test('pr checks --watch reads again until no check is pending, then exits as the last read says', { skip: skipWithoutNodeStub() }, async () => {
    const world = mkWorld();
    const stub = makeGhStub({ api: checksApi([runsPage([checkRun('build', 'in_progress')])]) });
    const runsRoute = `repos/acme/rostered/commits/${HEAD_SHA}/check-runs`;
    const runReads = () => ghRequests(stub).filter((r) => r.path === runsRoute).length;
    const child = start(BASH, [...NO_RC, shellPath(world.shim), 'pr', 'checks', '12', '--watch', '--interval', '1'],
      { cwd: world.repo, env: cloudEnv(world, stub) });
    try {
      expect(await until(() => runReads() >= 1), `the first read happens, stderr: ${child.stderr()}`).toBeTruthy();
      // The stub reads its fixture file on every call; swap it whole, so no read sees half of it.
      const fixture = path.join(stub.dir, 'api.json');
      fs.writeFileSync(`${fixture}.next`, JSON.stringify(checksApi([runsPage([checkRun('build', 'completed', 'success')])])));
      fs.renameSync(`${fixture}.next`, fixture);
      const done = await child.done;
      expect(done.status, `exit 0 once the run passed, stdout: ${child.stdout()}, stderr: ${child.stderr()}`).toBe(0);
      expect(runReads() >= 2, `it read again after the pending read, got ${runReads()} reads`).toBeTruthy();
      expect(lines(child.stdout()).some((l) => l.startsWith('build\tpass\t')), `the last read's line, got: ${child.stdout()}`).toBeTruthy();
    } finally {
      await child.end('SIGKILL');
    }
  });
});

describe('identity/gh in a cloud session: pr merge', () => {
  test('pr merge PUTs the method, subject and body, from -m/-s/-r, -t, -b or -F, and prints nothing', { skip: skipWithoutNodeStub() }, async () => {
    const dir = mkTmp('wk-gh-rest-pr-merge-');
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, 'Fixes #7\n');
    const api = {
      [`GET ${PULLS}/12`]: { body: restPull(12) },
      [`PUT ${PULLS}/12/merge`]: { body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' } },
    };
    for (const [args, method, body] of [
      [['--merge', '--subject', 'feat: a thing (#12)', '--body', 'Fixes #7'], 'merge', 'Fixes #7'],
      [['-s', '-t', 'feat: a thing (#12)', '-F', file], 'squash', 'Fixes #7\n'],
      [['-r', '-t', 'feat: a thing (#12)', '-b', 'Fixes #7'], 'rebase', 'Fixes #7'],
    ]) {
      const res = runCloud(['pr', 'merge', '12', ...args], { api });
      assertOk(res, `pr merge ${args.join(' ')}`);
      assertSame(routes(writes(res)), [['PUT', `${PULLS}/12/merge`]], `${method}: one PUT to the merge route`);
      const sent = writes(res)[0].body;
      assertSame([sent.merge_method, sent.commit_title, sent.commit_message], [method, 'feat: a thing (#12)', body], `${method}: method, title, message`);
      expect(res.stdout, `${method}: success prints nothing`).toBe('');
    }
  });

  test('pr merge with no method, or with two, exits 1 and merges nothing; with none, gh\'s required line', { skip: skipWithoutNodeStub() }, async () => {
    const api = { [`GET ${PULLS}/12`]: { body: restPull(12) }, [`PUT ${PULLS}/12/merge`]: { body: { merged: true } } };
    const none = runCloud(['pr', 'merge', '12', '--subject', 'x'], { api });
    expect(none.code, `exit 1, stdout: ${none.stdout}, stderr: ${none.stderr}`).toBe(1);
    expect(none.stderr.includes('gh: --merge, --rebase, or --squash required when not running interactively'), `gh's line, got: ${none.stderr}`).toBeTruthy();
    assertSame(writes(none), [], 'nothing merged');

    const two = runCloud(['pr', 'merge', '12', '--merge', '--squash'], { api });
    expect(two.code, `two methods exit 1, stdout: ${two.stdout}, stderr: ${two.stderr}`).toBe(1);
    assertSame(writes(two), [], 'nothing merged');
  });

  test('pr merge --delete-branch deletes the head branch after the merge; a refused delete leaves the merge standing with its line, exit 0', { skip: skipWithoutNodeStub() }, async () => {
    const ref = 'repos/acme/rostered/git/refs/heads/claude/work';
    const base = {
      [`GET ${PULLS}/12`]: { body: restPull(12) },
      [`GET ${PULLS}`]: { pages: [[restPull(12)]] },
      [`PUT ${PULLS}/12/merge`]: { body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' } },
    };
    const deleted = runCloud(['pr', 'merge', '12', '--merge', '--delete-branch'], { api: { ...base, [`DELETE ${ref}`]: { status: 204 } } });
    assertOk(deleted, 'pr merge --delete-branch');
    assertSame(routes(writes(deleted)), [['PUT', `${PULLS}/12/merge`], ['DELETE', ref]], 'the merge, then the branch delete');

    const refusal = { message: 'Write access to this GitHub API path is not permitted through this proxy.' };
    const left = runCloud(['pr', 'merge', '--merge', '-d'], { api: { ...base, [`DELETE ${ref}`]: { status: 403, body: refusal } } });
    assertOk(left, 'pr merge -d, the delete refused');
    assertSame(routes(writes(left)), [['PUT', `${PULLS}/12/merge`], ['DELETE', ref]], 'the current branch\'s PR merged, then the delete tried');
    expect(left.stderr.includes('gh: merged #12; branch claude/work left, this cloud session cannot delete branches'), `the left line, got: ${left.stderr}`).toBeTruthy();
  });

  test('pr merge --delete-branch on a fork\'s PR merges and deletes no branch: the same-named one in the base repo is not the fork\'s', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      [`GET ${PULLS}/12`]: { body: restPull(12, { headRepo: 'fork/rostered' }) },
      [`PUT ${PULLS}/12/merge`]: { body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' } },
      'DELETE repos/acme/rostered/git/refs/heads/claude/work': { status: 204 },
    };
    const res = runCloud(['pr', 'merge', '12', '--merge', '--delete-branch'], { api });
    assertOk(res, 'pr merge --delete-branch on a fork');
    assertSame(routes(writes(res)), [['PUT', `${PULLS}/12/merge`]], 'the merge alone');
  });

  test('a merge GitHub refuses exits 1 with its message and deletes no branch', { skip: skipWithoutNodeStub() }, async () => {
    const api = {
      [`GET ${PULLS}/12`]: { body: restPull(12) },
      [`PUT ${PULLS}/12/merge`]: { status: 405, body: { message: 'Pull Request is not mergeable' } },
      'DELETE repos/acme/rostered/git/refs/heads/claude/work': { status: 204 },
    };
    const res = runCloud(['pr', 'merge', '12', '--merge', '--delete-branch'], { api });
    expect(res.code, `exit 1, stdout: ${res.stdout}, stderr: ${res.stderr}`).toBe(1);
    expect(res.stderr.includes('Pull Request is not mergeable'), `GitHub's message, got: ${res.stderr}`).toBeTruthy();
    assertSame(writes(res).filter((r) => r.method === 'DELETE'), [], 'no branch is deleted');
  });
});

describe('identity/gh in a cloud session: pr subcommands REST does not serve', () => {
  test('pr diff runs the real gh once, whole, with no gh api call', { skip: skipWithoutNodeStub() }, async () => {
    const argv = ['pr', 'diff', '12', '--name-only'];
    const res = runCloud(argv);
    assertOk(res, 'pr diff');
    expect(res.calls.length, `the real gh runs once, got ${fmtCalls(res.calls)}`).toBe(1);
    expect(eqArgv(res.calls[0], argv), `every argument passed through, got ${fmtCalls(res.calls)}`).toBeTruthy();
    expect(res.requests.length, `no gh api call, got: ${JSON.stringify(res.requests)}`).toBe(0);
  });
});
