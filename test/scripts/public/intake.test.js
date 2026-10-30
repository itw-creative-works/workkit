// Tests for `workkit public intake`: an open public issue with no status: label
// becomes a private status:inbox issue linked by its `Public:` line, with the
// intake comment and status:inbox on the public one. Each case runs the verb
// whole against the fake GitHub in ./helpers.js.

const {
  group, testUnless, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../../lib/platform');
const {
  mkPublicWorld, publicLine, said, PRIVATE, PUBLIC,
} = require('./helpers');

// The verb's Node half starts gh by name, which no stub answers on Windows.
const test = testUnless(IS_WINDOWS, NO_NODE_STUB);

const REPORT = {
  number: 44,
  title: 'jsDelivr serves nothing over 20 MB',
  author: 'proxyfan',
  body: 'The http list 404s on jsDelivr.\nIt is 23 MB today.',
  labels: ['bug'],
};
const PRIVATE_OPEN = { number: 7, title: 'An older private issue', labels: ['status:backlog', 'type:idea'] };

const INTAKE_WORDING = "Thanks for the report. We're tracking this internally. This issue stays open and its label shows where the work is.";

// The private issues intake made: every one past the seeded #7.
const madeIssues = (world) => world.gh.issues(PRIVATE).filter((i) => i.number > PRIVATE_OPEN.number);

const cases = async () => {
  group('workkit public intake');

  await test('intake takes an open public issue with no status: label: one private inbox issue with the Public: line and the quoted report, one intake comment, status:inbox on the public issue', () => {
    const world = mkPublicWorld({ issues: { public: [REPORT], private: [PRIVATE_OPEN] } });
    const res = world.run(['intake']);
    assertEq(res.code, 0, `intake exits 0 (${said(res)})`);

    const made = madeIssues(world);
    assertEq(made.length, 1, `one private issue, got: ${JSON.stringify(made)}`);
    const [issue] = made;
    assertEq(JSON.stringify([...issue.labels].sort()), JSON.stringify(['status:inbox', 'type:idea']),
      'it carries status:inbox and type:idea, as every capture does');
    const lines = issue.body.split('\n');
    assertEq(lines[0], publicLine(44), 'its first body line is the Public: link');
    assert(issue.body.includes(REPORT.author), `the reporter's login is named, got: ${issue.body}`);
    const quoted = lines.filter((l) => l.startsWith('>'));
    for (const want of [REPORT.title, ...REPORT.body.split('\n')]) {
      assert(quoted.some((l) => l.includes(want)), `the report's ${JSON.stringify(want)} is quoted, got: ${issue.body}`);
    }

    const pub = world.gh.issue(PUBLIC, 44);
    assertEq(pub.comments.length, 1, `one comment on the public issue, got: ${JSON.stringify(pub.comments)}`);
    assertEq(pub.comments[0].body.trim(), INTAKE_WORDING,
      'the intake wording, naming no private repo');
    assert(pub.labels.includes('status:inbox'), `the public issue carries status:inbox, got: ${pub.labels}`);
    assert(pub.labels.includes('bug'), `and keeps its own label, got: ${pub.labels}`);
    assertEq(pub.state, 'open', 'the public issue stays open');
  });

  await test('intake names the reporter as a bare mention: Reported by @octo on the public repo#N, no backticks', () => {
    const world = mkPublicWorld({ issues: { public: [{ ...REPORT, author: 'octo' }], private: [PRIVATE_OPEN] } });
    const res = world.run(['intake']);
    assertEq(res.code, 0, `intake exits 0 (${said(res)})`);
    const [issue] = madeIssues(world);
    assert(issue.body.split('\n').includes(`Reported by @octo on ${PUBLIC}#44:`),
      `the body carries the bare mention line, got: ${issue.body}`);
  });

  await test('intake skips a public issue that already has a status: label', () => {
    const labelled = {
      number: 45, title: 'Already routed', author: 'someone', body: 'x', labels: ['status:building'],
    };
    const world = mkPublicWorld({ issues: { public: [REPORT, labelled], private: [PRIVATE_OPEN] } });
    const res = world.run(['intake']);
    assertEq(res.code, 0, `intake exits 0 (${said(res)})`);

    const made = madeIssues(world);
    assertEq(JSON.stringify(made.map((i) => i.body.split('\n')[0])), JSON.stringify([publicLine(44)]),
      'only the unrouted issue is taken in');
    const writes = world.gh.writes().filter((w) => w.slug === PUBLIC && w.number === 45);
    assertEq(writes.length, 0, `public #45 is left alone, got: ${JSON.stringify(writes)}`);
  });

  await test('intake run twice takes nothing the second time', () => {
    const world = mkPublicWorld({ issues: { public: [REPORT], private: [PRIVATE_OPEN] } });
    const first = world.run(['intake']);
    assertEq(first.code, 0, `the first intake exits 0 (${said(first)})`);
    const writesAfterFirst = world.gh.writes().length;
    assert(writesAfterFirst > 0, 'the first run took the issue in');
    const second = world.run(['intake']);
    assertEq(second.code, 0, `the second intake exits 0 (${said(second)})`);
    assertEq(madeIssues(world).length, 1, 'still one private issue');
    assertEq(world.gh.issue(PUBLIC, 44).comments.length, 1, 'still one intake comment');
    assertEq(JSON.stringify(world.gh.writes().slice(writesAfterFirst)), '[]', 'the second run wrote nothing');
  });

  await test('a retry after a failed public label edit makes no second private issue', () => {
    const world = mkPublicWorld({
      issues: { public: [REPORT], private: [PRIVATE_OPEN] }, fail: [{ slug: PUBLIC, number: 44, op: 'labels' }],
    });
    const first = world.run(['intake']);
    assertEq(first.code, 1, `the first intake exits 1 on the refused label edit (${said(first)})`);
    assertEq(madeIssues(world).length, 1, 'the first run made the private issue');
    const retry = world.run(['intake']);
    assertEq(retry.code, 0, `the retry exits 0 (${said(retry)})`);

    const made = madeIssues(world);
    assertEq(made.length, 1, `still one private issue, got: ${JSON.stringify(made.map((i) => i.number))}`);
    const pub = world.gh.issue(PUBLIC, 44);
    assert(pub.labels.includes('status:inbox'), `the retry labelled the public issue, got: ${pub.labels}`);
    assertEq(JSON.stringify(pub.comments.map((c) => c.body.trim())),
      JSON.stringify([INTAKE_WORDING]),
      'one intake comment, after the private issue the first run made');
  });

  await test('a comment refused once, then a retry, ends with one comment and the label', () => {
    const world = mkPublicWorld({
      issues: { public: [REPORT], private: [PRIVATE_OPEN] }, fail: [{ slug: PUBLIC, number: 44, op: 'comment' }],
    });
    const first = world.run(['intake']);
    assertEq(first.code, 1, `the first intake exits 1 on the refused comment (${said(first)})`);
    assertEq((first.err.match(/public:/g) || []).length, 1, `the warning names public: once (${said(first)})`);
    const retry = world.run(['intake']);
    assertEq(retry.code, 0, `the retry exits 0 (${said(retry)})`);

    const made = madeIssues(world);
    assertEq(made.length, 1, `one private issue, got: ${JSON.stringify(made.map((i) => i.number))}`);
    const pub = world.gh.issue(PUBLIC, 44);
    assertEq(JSON.stringify(pub.comments.map((c) => c.body.trim())),
      JSON.stringify([INTAKE_WORDING]),
      'one intake comment');
    assert(pub.labels.includes('status:inbox'), `the public issue carries status:inbox, got: ${pub.labels}`);
  });

  group('workkit public: a repo with no public key');

  await test('a repo with no public key: intake and mirror do nothing', () => {
    const linked = {
      number: 12, title: 'Split the lists', body: `${publicLine(44)}\n\nThe fix.`, labels: ['status:qa', 'type:bug'],
    };
    const world = mkPublicWorld({
      paired: false,
      issues: { public: [{ ...REPORT, labels: ['status:building'] }, { ...REPORT, number: 47, labels: [] }], private: [linked] },
    });
    const intake = world.run(['intake']);
    assertEq(intake.code, 0, `intake exits 0 (${said(intake)})`);
    const mirror = world.run(['mirror', '12']);
    assertEq(mirror.code, 0, `mirror exits 0 (${said(mirror)})`);
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written on either repo');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
