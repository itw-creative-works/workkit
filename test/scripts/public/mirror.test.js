// Tests for `workkit public mirror <N>...`: a linked private issue's status:
// label replaces every status: label on its public issue, silently; and the
// `Public:` line is the only link mirror and close follow. Each case runs the
// verb whole against the fake GitHub in ./helpers.js.

const {
  group, testUnless, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../../lib/platform');
const {
  mkPublicWorld, publicLine, said, PRIVATE, PUBLIC,
} = require('./helpers');

// The verb's Node half starts gh by name, which no stub answers on Windows.
const test = testUnless(IS_WINDOWS, NO_NODE_STUB);

const sorted = (labels) => JSON.stringify([...labels].sort());

const cases = async () => {
  group('workkit public mirror');

  await test('mirror sets the public label to the private one\'s and removes any other status: label, posting no comment', () => {
    const world = mkPublicWorld({
      issues: {
        private: [{
          number: 12, title: 'Split the lists', body: `${publicLine(44)}\n\nThe fix.`, labels: ['status:qa', 'type:bug'],
        }],
        public: [{
          number: 44, title: 'jsDelivr serves nothing over 20 MB', author: 'proxyfan', labels: ['status:inbox', 'status:building', 'bug'],
        }],
      },
    });
    const res = world.run(['mirror', '12']);
    assertEq(res.code, 0, `mirror exits 0 (${said(res)})`);
    const pub = world.gh.issue(PUBLIC, 44);
    assertEq(sorted(pub.labels), sorted(['bug', 'status:qa']), 'the public issue carries the private status alone, its own label kept');
    assertEq(pub.comments.length, 0, `no comment is posted, got: ${JSON.stringify(pub.comments)}`);
    assertEq(pub.state, 'open', 'the public issue stays open');
    assertEq(sorted(world.gh.issue(PRIVATE, 12).labels), sorted(['status:qa', 'type:bug']), 'the private issue is untouched');
  });

  await test('mirror --all mirrors every open linked issue and skips unlinked and closed ones', () => {
    const world = mkPublicWorld({
      issues: {
        private: [
          { number: 12, title: 'Split the lists', body: `${publicLine(44)}\n\nThe fix.`, labels: ['status:qa', 'type:bug'] },
          { number: 13, title: 'Retry a slow source', body: 'No public report.', labels: ['status:building', 'type:bug'] },
          {
            number: 14, title: 'Drop dead sources', body: `${publicLine(45)}\n\nShipped.`, labels: ['status:complete', 'type:bug'], state: 'closed',
          },
        ],
        public: [
          { number: 44, title: 'jsDelivr serves nothing over 20 MB', labels: ['status:building'] },
          { number: 45, title: 'Dead sources in the list', labels: ['status:building'] },
        ],
      },
    });
    const res = world.run(['mirror', '--all']);
    assertEq(res.code, 0, `mirror --all exits 0 (${said(res)})`);
    assertEq(sorted(world.gh.issue(PUBLIC, 44).labels), sorted(['status:qa']), 'the open linked issue\'s status reached its public issue');
    assertEq(JSON.stringify(world.gh.writes()), JSON.stringify([{ slug: PUBLIC, number: 44, op: 'labels' }]),
      'the one write is that label edit: the unlinked and the closed issues are skipped');
  });

  await test('mirror --all reads each public repo once, never one view per linked issue', () => {
    const world = mkPublicWorld({
      issues: {
        private: [44, 45, 46].map((n) => ({
          number: n - 30, title: `Report ${n}`, body: `${publicLine(n)}\n\nThe fix.`, labels: ['status:qa', 'type:bug'],
        })),
        public: [44, 45, 46].map((n) => ({ number: n, title: `Report ${n}`, labels: ['status:building'] })),
      },
    });
    const res = world.run(['mirror', '--all']);
    assertEq(res.code, 0, `mirror --all exits 0 (${said(res)})`);
    const reads = world.gh.calls().filter((a) => a.includes(PUBLIC) && (a[1] === 'view' || a[1] === 'list')).map((a) => a[1]);
    assertEq(JSON.stringify(reads), JSON.stringify(['list']), 'the public repo is read by one list call');
    for (const n of [44, 45, 46]) assertEq(sorted(world.gh.issue(PUBLIC, n).labels), sorted(['status:qa']), `#${n} carries the private status`);
  });

  group('workkit public: the Public: line is the link');

  await test('a private issue with no Public: line: mirror and close skip it', () => {
    // The public URL in the prose is no link: only a first-line `Public:` is.
    const world = mkPublicWorld({
      issues: {
        private: [{
          number: 13, title: 'Retry a slow source', body: `Seen while fixing https://github.com/${PUBLIC}/issues/44.`, labels: ['status:qa', 'type:bug'],
        }],
        public: [{ number: 44, title: 'jsDelivr serves nothing over 20 MB', labels: ['status:building'] }],
      },
    });
    const mirror = world.run(['mirror', '13']);
    assertEq(mirror.code, 0, `mirror exits 0 (${said(mirror)})`);
    const close = world.run(['close', '1.4.0', '13']);
    assertEq(close.code, 0, `close exits 0 (${said(close)})`);
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written on either repo');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
