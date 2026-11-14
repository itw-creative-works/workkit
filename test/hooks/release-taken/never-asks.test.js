// Tests for safety:release-taken's logic: the commits it never asks about.
// The shared prologue (the verdict call, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { judgeRelease } = require('./helpers');

const TAKEN_WORLD = { npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] };

// Silence, and neither provider asked, for the release commit's verdict over `subject`.
const neverAsks = async (subject) => {
  const { deny, text, calls } = await judgeRelease(subject, TAKEN_WORLD);
  expect(deny, `not this hook's business: ${subject}`).toBe(null);
  expect(text, `and nothing said: ${subject}`).toBe('');
  expect(calls.npm.length, `npm is never asked for ${subject}, got: ${calls.npm.join(' ')}`).toBe(0);
  expect(calls.github.length, `gh is never asked for ${subject}, got: ${calls.github.join(' ')}`).toBe(0);
};

describe('release-taken: what it never asks about', () => {
  test('a commit that is not a release', async () => {
    await neverAsks('feat: x');
  });

  test('the release subject mentioned mid-message is not a subject', async () => {
    await neverAsks('docs(ship): explain how chore(release): 1.2.3 is judged');
  });
});
