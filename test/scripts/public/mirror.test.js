// Tests for `workkit public mirror <N>...`: a linked private issue's status:
// label replaces every status: label on its public issue, silently; and the
// `Public:` line is the only link mirror and close follow. Each case runs the
// verb whole against the fake GitHub in ./helpers.js.

const {
  describe, test, expect,
} = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  mkPublicWorld, publicLine, said, PRIVATE, PUBLIC,
} = require('./helpers');

// The verb's Node half starts gh by name; written before the stub launcher, it still skips on Windows.

const sorted = (labels) => JSON.stringify([...labels].sort());

describe('workkit public mirror', () => {
  test('mirror sets the public label to the private one\'s and removes any other status: label, posting no comment', { skip: skipWithoutNodeStub() }, () => {
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
    expect(res.code, `mirror exits 0 (${said(res)})`).toBe(0);
    const pub = world.gh.issue(PUBLIC, 44);
    expect(sorted(pub.labels), 'the public issue carries the private status alone, its own label kept').toBe(sorted(['bug', 'status:qa']));
    expect(pub.comments.length, `no comment is posted, got: ${JSON.stringify(pub.comments)}`).toBe(0);
    expect(pub.state, 'the public issue stays open').toBe('open');
    expect(sorted(world.gh.issue(PRIVATE, 12).labels), 'the private issue is untouched').toBe(sorted(['status:qa', 'type:bug']));
  });

  test('mirror --all mirrors every open linked issue and skips unlinked and closed ones', { skip: skipWithoutNodeStub() }, () => {
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
    expect(res.code, `mirror --all exits 0 (${said(res)})`).toBe(0);
    expect(sorted(world.gh.issue(PUBLIC, 44).labels), 'the open linked issue\'s status reached its public issue').toBe(sorted(['status:qa']));
    expect(JSON.stringify(world.gh.writes()), 'the one write is that label edit: the unlinked and the closed issues are skipped').toBe(JSON.stringify([{ slug: PUBLIC, number: 44, op: 'labels' }]));
  });

  test('mirror --all reads each public repo once, never one view per linked issue', { skip: skipWithoutNodeStub() }, () => {
    const world = mkPublicWorld({
      issues: {
        private: [44, 45, 46].map((n) => ({
          number: n - 30, title: `Report ${n}`, body: `${publicLine(n)}\n\nThe fix.`, labels: ['status:qa', 'type:bug'],
        })),
        public: [44, 45, 46].map((n) => ({ number: n, title: `Report ${n}`, labels: ['status:building'] })),
      },
    });
    const res = world.run(['mirror', '--all']);
    expect(res.code, `mirror --all exits 0 (${said(res)})`).toBe(0);
    const reads = world.gh.calls().filter((a) => a.includes(PUBLIC) && (a[1] === 'view' || a[1] === 'list')).map((a) => a[1]);
    expect(JSON.stringify(reads), 'the public repo is read by one list call').toBe(JSON.stringify(['list']));
    for (const n of [44, 45, 46]) expect(sorted(world.gh.issue(PUBLIC, n).labels), `#${n} carries the private status`).toBe(sorted(['status:qa']));
  });
});

describe('workkit public: the Public: line is the link', () => {
  test('a private issue with no Public: line: mirror and close skip it', { skip: skipWithoutNodeStub() }, () => {
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
    expect(mirror.code, `mirror exits 0 (${said(mirror)})`).toBe(0);
    const close = world.run(['close', '1.4.0', '13']);
    expect(close.code, `close exits 0 (${said(close)})`).toBe(0);
    expect(JSON.stringify(world.gh.writes()), 'nothing was written on either repo').toBe('[]');
  });
});
