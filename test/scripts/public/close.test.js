// Tests for `workkit public close <version> <N>...`: the close wording on a
// linked private issue's public issue, its summary the issue's CHANGELOG entry,
// then the public issue closed, one already closed skipped. Each case runs the
// verb whole against the fake GitHub in ./helpers.js.

const {
  group, testUnless, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB } = require('../../lib/platform');
const {
  mkPublicWorld, publicLine, said, PUBLIC,
} = require('./helpers');

// The verb's Node half starts gh by name, which no stub answers on Windows.
const test = testUnless(IS_WINDOWS, NO_NODE_STUB);

// The close wording over #12's entry in the seeded CHANGELOG, its own period not doubled.
const CLOSE = 'Fixed in v1.4.0: Lists over 20 MB split into parts, so jsDelivr serves each one. Thanks for reporting it.';

const cases = async () => {
  group('workkit public close');

  await test('close comments the close wording with the version and the entry\'s summary, then closes the public issue', () => {
    const world = mkPublicWorld({
      issues: {
        private: [{
          number: 12, title: 'Split the lists', body: `${publicLine(44)}\n\nThe fix.`, labels: ['status:complete', 'type:bug'],
        }],
        public: [{
          number: 44, title: 'jsDelivr serves nothing over 20 MB', author: 'proxyfan', labels: ['status:complete'],
        }],
      },
    });
    const res = world.run(['close', '1.4.0', '12']);
    assertEq(res.code, 0, `close exits 0 (${said(res)})`);

    const pub = world.gh.issue(PUBLIC, 44);
    assertEq(JSON.stringify(pub.comments.map((c) => c.body.trim())), JSON.stringify([CLOSE]),
      'one comment on the public issue, the close wording with v1.4.0 and #12\'s entry');
    assertEq(pub.state, 'closed', 'the public issue is closed');

    // One call, so a comment never lands on an issue the close then missed.
    const writes = world.gh.calls().filter((argv) => argv.includes(PUBLIC) && argv[1] !== 'view');
    assertEq(JSON.stringify(writes), JSON.stringify([['issue', 'close', '44', '--repo', PUBLIC, '--comment', CLOSE]]),
      'the public issue is commented and closed in one gh issue close');
  });

  await test('a public issue already closed is a quiet skip, even with no CHANGELOG entry to read', () => {
    const world = mkPublicWorld({
      issues: {
        private: [{
          number: 14, title: 'Fixed upstream', body: `${publicLine(46)}\n\nNothing shipped.`, labels: ['status:complete', 'type:bug'],
        }],
        public: [{
          number: 46, title: 'Closed by the reporter', author: 'proxyfan', labels: ['status:complete'], state: 'closed',
        }],
      },
    });
    const res = world.run(['close', '1.4.0', '14']);
    assertEq(res.code, 0, `close exits 0 (${said(res)})`);
    assertEq(res.err.trim(), '', 'no warning');
    assertEq(JSON.stringify(world.gh.writes()), '[]', 'nothing was written');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
