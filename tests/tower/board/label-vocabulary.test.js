//
// Tests for tower/api/lib/board.js: the label vocabulary, read from the
// real workflow/labels.json.
// The shared prologue (the fake gh, the issue and label builders, the roster, the module under test) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  REPO, fetchBoard, labelGroups, LABELS_FILE, mkTmp, cleanup, labels, assignees, issue, fakeGh, ROSTER,
} = require('./helpers');

const run = async () => {
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
                  assignees: assignees('alice'),
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
    assertEq(a.assignees.join(','), 'alice', 'assignees are logins');
    assertEq(b.status, null, 'a bare label is not a group');
    assertEq(b.type, null, 'no type');
    assertEq(b.priority, null, 'absence of priority means normal');
    assertEq(b.agentOk, false, 'humans only');
  });

  // Documentation, not a vocabulary proof: parseLabels matches on the group
  // name and passes any status value through, so this case also passes without
  // the fifth label. The vocabulary itself is proven by the server and app
  // suites (MOVE_STATUSES, STATUSES).
  await test('status:building parses like any other status - in-flight work reaches the board', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 1,
              nodes: [issue(17, { labels: labels('status:building', 'type:bug'), assignees: assignees('alice') })],
            },
          },
        },
      }),
    });
    assertEq(res.issues[0].status, 'building', 'the status group passes the value through');
    assertEq(res.issues[0].assignees.join(','), 'alice', 'and the assignee still says who holds it');
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
