//
// Tests for the label vocabulary manifest (labels.json): its shape.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { MANIFEST, desiredLabels } = require('./helpers');

const run = async () => {
  group('labels.json: manifest shape');

  await test('all four groups present', () => {
    const groups = Object.keys(MANIFEST.groups).sort();
    assertEq(groups.join(','), 'agent,priority,status,type', 'the day-one groups');
  });

  await test('exact values per group', () => {
    const values = (g) => Object.keys(MANIFEST.groups[g].values).sort().join(',');
    assertEq(values('status'), 'backlog,blocked,building,complete,inbox,qa,specced', 'status values');
    assertEq(values('type'), 'bug,enhancement,idea', 'type values');
    assertEq(values('priority'), 'high,low', 'priority values');
    assertEq(values('agent'), 'ok,working', 'agent values');
  });

  await test('status:complete is the stage after qa, and its label teaches what it means (#196)', () => {
    // The manifest lists the statuses in PIPELINE order: inbox, specced,
    // building, qa, complete, then the side pockets, so a reader with nothing
    // but `gh label list` learns the road in the order it is walked. The stage
    // a ship reads from sits directly after the one whose passing check grants
    // it, and it wears the verdict green qa gave up.
    const status = MANIFEST.groups.status.values;
    assertEq(Object.keys(status).slice(0, 5).join(','), 'inbox,specced,building,qa,complete', 'the pipeline in order');
    assertEq(status.complete.description, 'QA passed, ready to ship. Exactly one status: label per open issue.', 'complete says QA passed');
    assertEq(status.complete.color, '12925C', 'complete wears the verdict green');
    assertEq(status.qa.color, 'B0416A', 'qa moved off it: qa only means waiting on the check');
  });

  await test('values are single lowercase words: no hyphens', () => {
    for (const { name } of desiredLabels()) {
      const value = name.split(':')[1];
      assert(/^[a-z]+$/.test(value), `${name}: value must be one lowercase word`);
    }
  });

  await test('every value carries a non-empty description', () => {
    for (const { name, description } of desiredLabels()) {
      assert(typeof description === 'string' && description.trim().length > 0, `${name} needs a description`);
    }
  });

  await test('descriptions fit the GitHub API limit (100 chars)', () => {
    // Learned live 2026-07-24: the labels API 422s past 100 characters.
    for (const { name, description } of desiredLabels()) {
      assert(description.length <= 100, `${name} description is ${description.length} chars (max 100)`);
    }
  });

  await test('every value resolves a 6-digit hex color', () => {
    for (const { name, color } of desiredLabels()) {
      assert(/^[0-9A-Fa-f]{6}$/.test(color || ''), `${name} color must be bare 6-digit hex, got ${color}`);
    }
  });

  await test('a fixed label’s hex is its board token’s light value: the pairing, pinned', () => {
    // A label's colour on GitHub is not free-chosen: it is the LIGHT-mode value
    // of the theme token the tower draws that label in, so the board and the
    // issue page agree. Only this half can be pinned here: the token values
    // live in the omega framework, so an edit that breaks the pairing from the
    // hex side fails loudly instead of drifting. Every fixed label is in it
    // since #149: `priority:high` gave up the brand accent, which no fixed hex
    // could track, for the danger red that `status:blocked` also wears.
    const expected = {
      status: {
        inbox: '0F8FA9', specced: '7A45B5', building: 'C47206', qa: 'B0416A', complete: '12925C', blocked: 'D92D20', backlog: 'A1A19E',
      },
      type: { bug: 'D92D20', enhancement: 'A06A08', idea: '7A45B5' },
      priority: { high: 'D92D20', low: 'A1A19E' },
    };
    for (const [group, values] of Object.entries(expected)) {
      for (const [value, color] of Object.entries(values)) {
        assertEq(MANIFEST.groups[group].values[value].color, color, `${group}:${value} wears its token's light value`);
      }
    }
  });

  await test('a hex repeats across the groups but never inside one (#149)', () => {
    // The rule the palette is built on: a colour is unique WITHIN a vocabulary,
    // since a column header, a card chip and a chart slice are read by hue,
    // and free across them, since every chip carries its own word and glyph.
    for (const group of ['status', 'type', 'priority']) {
      const colors = Object.values(MANIFEST.groups[group].values).map((body) => body.color.toUpperCase());
      assertEq(new Set(colors).size, colors.length, `no two ${group}: labels share a colour`);
    }
    assertEq(MANIFEST.groups.type.values.idea.color, MANIFEST.groups.status.values.specced.color, 'idea and specced share the purple');
    assertEq(MANIFEST.groups.priority.values.high.color, MANIFEST.groups.status.values.blocked.color, 'high and blocked share the alarm red');
    assertEq(MANIFEST.groups.priority.values.low.color, MANIFEST.groups.status.values.backlog.color, 'low and backlog share the faint gray');
  });

  await test('status is exclusive and every status description says so', () => {
    assertEq(MANIFEST.groups.status.exclusive, true, 'status.exclusive');
    for (const [value, body] of Object.entries(MANIFEST.groups.status.values)) {
      assert(/exactly one status:/i.test(body.description), `status:${value} must state the one-per-issue rule`);
    }
  });

  await test('priority is exclusive: high plus low on one issue is a contradiction', () => {
    assertEq(MANIFEST.groups.priority.exclusive, true, 'priority.exclusive');
  });

  await test('status and type are the required groups: priority absence means normal', () => {
    for (const [name, body] of Object.entries(MANIFEST.groups)) {
      assertEq(body.required === true, name === 'status' || name === 'type', `${name}.required`);
    }
  });

  await test('type is exclusive: an issue is one kind of thing', () => {
    assertEq(MANIFEST.groups.type.exclusive, true, 'type.exclusive');
  });

  await test('inbox description names triage as the drain', () => {
    assert(/triage/i.test(MANIFEST.groups.status.values.inbox.description), 'status:inbox points at triage');
  });

  await test('building description says the work is in flight', () => {
    assert(/in flight/i.test(MANIFEST.groups.status.values.building.description),
      'status:building is the label in-flight work carries');
  });

  await test('priority descriptions state that absence means normal', () => {
    for (const [value, body] of Object.entries(MANIFEST.groups.priority.values)) {
      assert(/absence/i.test(body.description) && /normal/i.test(body.description),
        `priority:${value} must state absence = normal`);
    }
    assert(!Object.keys(MANIFEST.groups.priority.values).includes('normal'), 'no priority:normal label exists');
  });

  await test('agent:ok grants autonomous work', () => {
    assert(/agent may work/i.test(MANIFEST.groups.agent.values.ok.description), 'agent:ok states the permission');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
