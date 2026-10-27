// Tests for the label vocabulary manifest (labels.json): its shape.
// The shared prologue is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { MANIFEST, desiredLabels } = require('./helpers');

const cases = async () => {
  group('labels.json: manifest shape');

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
    // The labels API 422s past 100 characters.
    for (const { name, description } of desiredLabels()) {
      assert(description.length <= 100, `${name} description is ${description.length} chars (max 100)`);
    }
  });

  await test('every value resolves a 6-digit hex color', () => {
    for (const { name, color } of desiredLabels()) {
      assert(/^[0-9A-Fa-f]{6}$/.test(color || ''), `${name} color must be bare 6-digit hex, got ${color}`);
    }
  });

  await test('a hex repeats across the groups but never inside one (#149)', () => {
    // The rule the palette is built on: a colour is unique within a vocabulary,
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

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
