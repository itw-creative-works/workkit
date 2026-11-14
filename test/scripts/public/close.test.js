// Tests for `workkit public close <version> <N>...`: the close wording on a
// linked private issue's public issue, its summary the issue's CHANGELOG entry,
// then the public issue closed, one already closed skipped. Each case runs the
// verb whole against the fake GitHub in ./helpers.js.

const {
  describe, test, expect,
} = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  mkPublicWorld, publicLine, said, PUBLIC,
} = require('./helpers');

// The verb's Node half starts gh by name; written before the stub launcher, it still skips on Windows.

// The close wording over #12's entry in the seeded CHANGELOG, its own period not doubled.
const CLOSE = 'Fixed in v1.4.0: Lists over 20 MB split into parts, so jsDelivr serves each one. Thanks for reporting it.';

describe('workkit public close', () => {
  test('close comments the close wording with the version and the entry\'s summary, then closes the public issue', { skip: skipWithoutNodeStub() }, () => {
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
    expect(res.code, `close exits 0 (${said(res)})`).toBe(0);

    const pub = world.gh.issue(PUBLIC, 44);
    expect(JSON.stringify(pub.comments.map((c) => c.body.trim())), 'one comment on the public issue, the close wording with v1.4.0 and #12\'s entry').toBe(JSON.stringify([CLOSE]));
    expect(pub.state, 'the public issue is closed').toBe('closed');

    // One call, so a comment never lands on an issue the close then missed.
    const writes = world.gh.calls().filter((argv) => argv.includes(PUBLIC) && argv[1] !== 'view');
    expect(JSON.stringify(writes), 'the public issue is commented and closed in one gh issue close').toBe(JSON.stringify([['issue', 'close', '44', '--repo', PUBLIC, '--comment', CLOSE]]));
  });

  test('a public issue already closed is a quiet skip, even with no CHANGELOG entry to read', { skip: skipWithoutNodeStub() }, () => {
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
    expect(res.code, `close exits 0 (${said(res)})`).toBe(0);
    expect(res.err.trim(), 'no warning').toBe('');
    expect(JSON.stringify(world.gh.writes()), 'nothing was written').toBe('[]');
  });
});
