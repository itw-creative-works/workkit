// Tests for the label vocabulary manifest (labels.json): its shape.
// The shared prologue is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { MANIFEST, desiredLabels } = require('./helpers');

describe('labels.json: manifest shape', () => {
  test('values are single lowercase words: no hyphens', () => {
    for (const { name } of desiredLabels()) {
      const value = name.split(':')[1];
      expect(/^[a-z]+$/.test(value), `${name}: value must be one lowercase word`).toBeTruthy();
    }
  });

  test('every value carries a non-empty description', () => {
    for (const { name, description } of desiredLabels()) {
      expect(typeof description === 'string' && description.trim().length > 0, `${name} needs a description`).toBeTruthy();
    }
  });

  test('descriptions fit the GitHub API limit (100 chars)', () => {
    // The labels API 422s past 100 characters.
    for (const { name, description } of desiredLabels()) {
      expect(description.length <= 100, `${name} description is ${description.length} chars (max 100)`).toBeTruthy();
    }
  });

  test('every value resolves a 6-digit hex color', () => {
    for (const { name, color } of desiredLabels()) {
      expect(/^[0-9A-Fa-f]{6}$/.test(color || ''), `${name} color must be bare 6-digit hex, got ${color}`).toBeTruthy();
    }
  });

  test('a hex repeats across the groups but never inside one (#149)', () => {
    // The rule the palette is built on: a colour is unique within a vocabulary,
    // since a column header, a card chip and a chart slice are read by hue,
    // and free across them, since every chip carries its own word and glyph.
    for (const group of ['status', 'type', 'priority']) {
      const colors = Object.values(MANIFEST.groups[group].values).map((body) => body.color.toUpperCase());
      expect(new Set(colors).size, `no two ${group}: labels share a colour`).toBe(colors.length);
    }
    expect(MANIFEST.groups.type.values.idea.color, 'idea and specced share the purple').toBe(MANIFEST.groups.status.values.specced.color);
    expect(MANIFEST.groups.priority.values.high.color, 'high and blocked share the alarm red').toBe(MANIFEST.groups.status.values.blocked.color);
    expect(MANIFEST.groups.priority.values.low.color, 'low and backlog share the faint gray').toBe(MANIFEST.groups.status.values.backlog.color);
  });
});
