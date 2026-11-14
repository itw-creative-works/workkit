//
// Tests for tower/api/lib/board.js: the label vocabulary, read from the real
// workflow/labels.json. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const {
  REPO, fetchBoard, labelGroups, LABELS_FILE, cleanup, labels, assignees, issue, fakeGh, ROSTER,
} = require('./helpers');

describe('tower/board: the label vocabulary', () => {
  test('the group names come from the real workflow/labels.json', () => {
    const groups = labelGroups();
    expect(LABELS_FILE, 'points at the SSOT').toBe(path.join(REPO, 'workflow', 'labels.json'));
    for (const g of ['status', 'type', 'priority', 'agent']) {
      expect(groups.has(g), `${g} is a known group`).toBeTruthy();
    }
  });

  test('status, type, priority and the agent flags parse; unknown groups are ignored', () => {
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
    expect(a.status, 'status').toBe('specced');
    expect(a.type, 'type').toBe('enhancement');
    expect(a.priority, 'priority').toBe('high');
    expect(a.agentOk, 'agent:ok').toBe(true);
    expect(a.agentClaimed, 'agent:claimed').toBe(true);
    expect(a.assignees.join(','), 'assignees are logins').toBe('alice');
    expect(b.status, 'a bare label is not a group').toBe(null);
    expect(b.type, 'no type').toBe(null);
    expect(b.priority, 'absence of priority means normal').toBe(null);
    expect(b.agentOk, 'humans only').toBe(false);
  });

  // The claim is the agent:claimed label and an assignee is a person, so the
  // projection's agentClaimed reads the label and nothing else.
  test('agentClaimed is the agent:claimed label, never the assignee', () => {
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
    expect(by[17].agentClaimed, 'the label with nobody assigned is a claim').toBe(true);
    expect(by[18].agentClaimed, 'an assignee without the label is not').toBe(false);
    expect(by[19].agentClaimed, 'and the label beside an assignee is still the claim').toBe(true);
    expect(by[19].assignees.join(','), 'while the assignee is carried as the person it is').toBe('alice');
  });

  // Documentation, not a vocabulary proof: parseLabels matches on the group
  // name and passes any status value through, so this case also passes without
  // the fifth label. The vocabulary itself is proven by the server and app
  // suites (MOVE_STATUSES, STATUSES).
  test('status:building parses like any other status - in-flight work reaches the board', () => {
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
    expect(res.issues[0].status, 'the status group passes the value through').toBe('building');
    expect(res.issues[0].assignees.join(','), 'and the assignee still says who holds it').toBe('alice');
  });

  test('an unparseable vocabulary file leaves every group unparsed rather than crashing', () => {
    const tmp = mkTmp('tower-board-');
    const file = path.join(tmp, 'labels.json');
    fs.writeFileSync(file, '{ not json');
    const res = fetchBoard([ROSTER[0]], {
      labelsFile: file,
      exec: fakeGh({ data: { r0: { issues: { totalCount: 1, nodes: [issue(17, { labels: labels('status:specced') })] } } } }),
    });
    expect(res.ok, 'still renders').toBe(true);
    expect(res.issues[0].status, 'no vocabulary, no groups').toBe(null);
    cleanup(tmp);
  });
});
