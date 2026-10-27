//
// Tests for tower/api/lib/board.js: the label vocabulary, read from the real
// workflow/labels.json. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, mkTmp } = require('../../lib/harness');
const {
  REPO, fetchBoard, labelGroups, LABELS_FILE, cleanup, labels, assignees, issue, fakeGh, ROSTER,
} = require('./helpers');

const cases = async () => {
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
                  labels: labels('status:specced', 'type:enhancement', 'priority:high', 'agent:ok', 'agent:claimed', 'area:tower'),
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
    assertEq(a.agentClaimed, true, 'agent:claimed');
    assertEq(a.assignees.join(','), 'alice', 'assignees are logins');
    assertEq(b.status, null, 'a bare label is not a group');
    assertEq(b.type, null, 'no type');
    assertEq(b.priority, null, 'absence of priority means normal');
    assertEq(b.agentOk, false, 'humans only');
  });

  // The claim is the agent:claimed label and an assignee is a person, so the
  // projection's agentClaimed reads the label and nothing else.
  await test('agentClaimed is the agent:claimed label, never the assignee', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 3,
              nodes: [
                issue(17, { labels: labels('status:specced', 'agent:claimed'), assignees: assignees() }),
                issue(18, { labels: labels('status:specced'), assignees: assignees('alice') }),
                issue(19, { labels: labels('status:building', 'agent:claimed'), assignees: assignees('alice') }),
              ],
            },
          },
        },
      }),
    });
    const by = Object.fromEntries(res.issues.map((i) => [i.number, i]));
    assertEq(by[17].agentClaimed, true, 'the label with nobody assigned is a claim');
    assertEq(by[18].agentClaimed, false, 'an assignee without the label is not');
    assertEq(by[19].agentClaimed, true, 'and the label beside an assignee is still the claim');
    assertEq(by[19].assignees.join(','), 'alice', 'while the assignee is carried as the person it is');
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
    const tmp = mkTmp('tower-board-');
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

module.exports = cases;

if (require.main === module) selfRun(cases);
