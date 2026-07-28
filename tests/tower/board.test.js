//
// Tests for tower/api/lib/board.js — the cross-repo issue sweep.
//
// `gh` is the one thing that cannot be exercised for real here: a live call
// needs auth and the network, and the point of the seam is that the tower
// renders without either. So the exec seam takes a fake that answers the two
// commands the module issues, and every OTHER fact — the label vocabulary
// especially — comes from the real in-repo workflow/labels.json.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const { fetchBoard, buildQuery, labelGroups, LABELS_FILE, PAGE_SIZE, BODY_LIMIT } = require(path.join(REPO, 'tower', 'api', 'lib', 'board.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-board-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const labels = (...names) => ({ nodes: names.map((name) => ({ name })) });
const assignees = (...logins) => ({ nodes: logins.map((login) => ({ login })) });

const issue = (number, extra = {}) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: labels(),
  assignees: assignees(),
  ...extra,
});

/**
 * The error execFileSync throws on a non-zero exit: the message, the streams it
 * captured, and the status. `gh api graphql` exits 1 whenever the response
 * carries an errors array — WITH the complete payload on stdout — so this shape
 * is the difference between a partial board and a blank one.
 */
const execError = (message, { stdout = '', stderr = '', status = 1, code = null } = {}) => {
  const err = new Error(message);
  err.stdout = stdout;
  err.stderr = stderr;
  err.status = status;
  if (code) err.code = code;
  return err;
};

/** A fake `gh`: the version probe passes, graphql answers with the given payload. */
const fakeGh = (payload, { versionFails = false, graphqlError = null, calls = [] } = {}) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === '--version') {
    if (versionFails) throw execError('spawnSync gh ENOENT', { code: 'ENOENT', status: null });
    return 'gh version 2.0.0\n';
  }
  if (graphqlError) throw graphqlError;
  return JSON.stringify(payload);
};

const ROSTER = [
  { name: 'workkit', path: '/x/workkit', slug: 'ITW-Creative-Works/workkit' },
  { name: '.dotfiles', path: '/x/.dotfiles', slug: 'ianwieds/.dotfiles' },
];

const run = async () => {
  group('tower/board: the soft skip');

  await test('gh missing returns the skip shape, never throws', () => {
    const res = fetchBoard(ROSTER, { exec: fakeGh({}, { versionFails: true }) });
    assertEq(res.ok, false, 'not ok');
    assertEq(res.reason, 'gh not found', 'the reason names it');
    assertEq(res.issues.length, 0, 'no issues');
  });

  await test('a lapsed token is judged from the sweep itself — no auth round trip per refresh', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        calls,
        // The real shape of a bad token: gh prints the API's JSON to STDOUT and
        // nothing useful to stderr — the reason must be judged from that stream.
        graphqlError: execError('Command failed: gh api graphql -f query=...', {
          stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}\n',
          stderr: '',
        }),
      }),
    });
    assertEq(res.ok, false, 'not ok');
    assertEq(res.reason, 'gh not authenticated', 'the auth-shaped failure is recognized');
    assertEq(calls.filter((c) => c[1] === 'auth').length, 0, 'gh auth status is never called');
  });

  await test('a graphql failure with no payload is reported, not thrown', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, { graphqlError: execError('HTTP 502', { stderr: 'gateway' }) }),
    });
    assertEq(res.ok, false, 'not ok');
    assert(/502/.test(res.reason), 'the underlying message survives');
    assertEq(res.issues.length, 0, 'no issues');
  });

  await test('a roster with no slugs never calls graphql', () => {
    const calls = [];
    const res = fetchBoard([{ name: 'local', path: '/x/local', slug: null }], { exec: fakeGh({}, { calls }) });
    assertEq(res.ok, true, 'ok — nothing to ask');
    assertEq(res.issues.length, 0, 'no issues');
    assertEq(calls.filter((c) => c[1] === 'api').length, 0, 'no graphql call');
  });

  group('tower/board: one call, per-repo aliases');

  await test('the query aliases every repo and asks for totalCount', () => {
    const q = buildQuery([['ITW-Creative-Works', 'workkit'], ['ianwieds', '.dotfiles']]);
    assert(q.includes('r0: repository(owner: "ITW-Creative-Works", name: "workkit")'), 'r0 alias');
    assert(q.includes('r1: repository(owner: "ianwieds", name: ".dotfiles")'), 'r1 alias');
    assert(q.includes('totalCount'), 'truncation is answerable');
    assert(q.includes(`first: ${PAGE_SIZE}`), 'the page cap is in the query');
    // The dashboard's issue dialog reads these off the sweep — there is no
    // second request behind a click.
    assert(q.includes('body'), 'the body the dialog renders');
    assert(q.includes('createdAt'), 'when it was filed');
    assert(q.includes('comments { totalCount }'), 'and how much conversation is waiting');
  });

  await test('an issue carries what the dialog shows, with a long body cut and reported', () => {
    const long = 'x'.repeat(BODY_LIMIT + 500);
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 2,
              nodes: [
                issue(17, { body: '## Spec\n\nnone', createdAt: '2026-07-01T00:00:00Z', comments: { totalCount: 3 } }),
                issue(18, { body: long }),
              ],
            },
          },
        },
      }),
    });
    const [a, b] = res.issues;
    assertEq(a.body, '## Spec\n\nnone', 'the body arrives as it was written');
    assertEq(a.bodyTruncated, false, 'and whole');
    assertEq(a.createdAt, '2026-07-01T00:00:00Z', 'the filing date');
    assertEq(a.comments, 3, 'the comment count');
    assertEq(b.body.length, BODY_LIMIT, 'a body longer than the cap is cut to it');
    assertEq(b.bodyTruncated, true, 'and says so, so the dialog can point at GitHub');
    assertEq(b.comments, 0, 'an issue with no comment count reads as none');
  });

  await test('two repos come back as one flat, normalized issue list', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 2, nodes: [issue(17), issue(18)] } },
          r1: { issues: { totalCount: 1, nodes: [issue(22)] } },
        },
      }, { calls }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.issues.length, 3, 'all three issues');
    assertEq(res.issues.map((i) => `${i.repo}#${i.number}`).join(' '),
      'ITW-Creative-Works/workkit#17 ITW-Creative-Works/workkit#18 ianwieds/.dotfiles#22',
      'each issue carries its repo slug');
    assertEq(calls.filter((c) => c[1] === 'api').length, 1, 'ONE graphql call for the whole roster');
  });

  group('tower/board: the label vocabulary');

  await test('the group names come from the real workflow/labels.json', () => {
    const groups = labelGroups();
    assertEq(LABELS_FILE, path.join(REPO, 'workflow', 'labels.json'), 'points at the SSOT');
    for (const g of ['status', 'type', 'priority', 'agent']) {
      assert(groups.has(g), `${g} is a known group`);
    }
  });

  await test('status, type, priority and the agent flags parse; unknown groups are ignored', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 2,
              nodes: [
                issue(17, {
                  labels: labels('status:specced', 'type:enhancement', 'priority:high', 'agent:ok', 'agent:working', 'area:tower'),
                  assignees: assignees('ianwieds'),
                }),
                issue(18, { labels: labels('bug', 'wontfix') }),
              ],
            },
          },
        },
      }),
    });
    const [a, b] = res.issues;
    assertEq(a.status, 'specced', 'status');
    assertEq(a.type, 'enhancement', 'type');
    assertEq(a.priority, 'high', 'priority');
    assertEq(a.agentOk, true, 'agent:ok');
    assertEq(a.agentWorking, true, 'agent:working');
    assertEq(a.assignees.join(','), 'ianwieds', 'assignees are logins');
    assertEq(b.status, null, 'a bare label is not a group');
    assertEq(b.type, null, 'no type');
    assertEq(b.priority, null, 'absence of priority means normal');
    assertEq(b.agentOk, false, 'humans only');
  });

  // Documentation, not a vocabulary proof: parseLabels matches on the group
  // name and passes any status value through, so this case also passes without
  // the fifth label. The vocabulary itself is proven by the server and app
  // suites (MOVE_STATUSES, STATUSES).
  await test('status:building parses like any other status — in-flight work reaches the board', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 1,
              nodes: [issue(17, { labels: labels('status:building', 'type:bug'), assignees: assignees('ianwieds') })],
            },
          },
        },
      }),
    });
    assertEq(res.issues[0].status, 'building', 'the status group passes the value through');
    assertEq(res.issues[0].assignees.join(','), 'ianwieds', 'and the assignee still says who holds it');
  });

  await test('an unparseable vocabulary file leaves every group unparsed rather than crashing', () => {
    const tmp = mkTmp();
    const file = path.join(tmp, 'labels.json');
    fs.writeFileSync(file, '{ not json');
    const res = fetchBoard([ROSTER[0]], {
      labelsFile: file,
      exec: fakeGh({ data: { r0: { issues: { totalCount: 1, nodes: [issue(17, { labels: labels('status:specced') })] } } } }),
    });
    assertEq(res.ok, true, 'still renders');
    assertEq(res.issues[0].status, null, 'no vocabulary, no groups');
    cleanup(tmp);
  });

  group('tower/board: truncation');

  await test('a repo with more open issues than the page cap is flagged truncated', () => {
    const nodes = Array.from({ length: 3 }, (_, i) => issue(i + 1));
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 140, nodes } },
          r1: { issues: { totalCount: 3, nodes } },
        },
      }),
    });
    assertEq(res.repos[0].truncated, true, 'r0 hit the cap');
    assertEq(res.repos[0].totalCount, 140, 'the real total is reported');
    assertEq(res.repos[0].count, 3, 'what actually came back');
    assertEq(res.repos[1].truncated, false, 'r1 is complete');
  });

  group('tower/board: a partial answer is kept');

  await test('one unresolvable repo does not blank the board — gh exits 1 with the data on stdout', () => {
    // Exactly what `gh api graphql` does when an alias fails: non-zero exit,
    // the complete payload for every other alias on stdout, the failure in an
    // errors array naming the alias.
    const partial = JSON.stringify({
      data: {
        r0: null,
        r1: { issues: { totalCount: 1, nodes: [issue(9, { labels: labels('status:inbox') })] } },
      },
      errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository with the name.' }],
    });
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        graphqlError: execError('Command failed: gh api graphql', { stdout: partial, stderr: 'gh: Could not resolve to a Repository' }),
      }),
    });
    assertEq(res.ok, true, 'the board still renders');
    assertEq(res.issues.length, 1, 'the repo that resolved keeps its issues');
    assertEq(res.issues[0].repo, 'ianwieds/.dotfiles', 'and they are attributed correctly');
    assertEq(res.issues[0].status, 'inbox', 'normalized as usual');
    assert(/Could not resolve/.test(res.repos[0].error), 'the unresolved repo carries its reason');
    assertEq(res.repos[1].error, null, 'the healthy repo carries none');
  });

  await test('an errors array on a clean exit still lands on the repo it names', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(1)] } },
          r1: null,
        },
        errors: [{ path: ['r1'], message: 'Resource not accessible by integration' }],
      }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.issues.length, 1, 'r0 survives');
    assertEq(res.repos[0].error, null, 'r0 is fine');
    assertEq(res.repos[1].error, 'Resource not accessible by integration', 'r1 says why');
  });

  await test('an alias that is simply absent reports "not resolved"', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({ data: { r0: { issues: { totalCount: 0, nodes: [] } } } }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.repos[0].error, null, 'present and empty is not an error');
    assertEq(res.repos[1].error, 'not resolved', 'absent is');
  });

  await test('a non-zero exit whose stdout has no data is a real failure', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        graphqlError: execError('Command failed', { stdout: '{"errors":[{"message":"Bad credentials"}]}', stderr: '' }),
      }),
    });
    assertEq(res.ok, false, 'nothing usable came back');
    assertEq(res.issues.length, 0, 'no issues');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
