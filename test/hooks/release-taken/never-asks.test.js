// Tests for safety:release-taken's logic: what it never asks about.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { judge, judgeRelease } = require('./helpers');

const TAKEN_WORLD = { npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] };

// Silence, and neither provider asked: `ask` is the verdict's call, the publish
// half's over a command by default, the release commit's over a subject.
const neverAsks = async (command, world = TAKEN_WORLD, ask = judge) => {
  const { deny, text, calls } = await ask(command, world);
  assertEq(deny, null, `not this hook's business: ${command}`);
  assertEq(text, '', `and nothing said: ${command}`);
  assertEq(calls.npm.length, 0, `npm is never asked for ${command}, got: ${calls.npm.join(' ')}`);
  assertEq(calls.github.length, 0, `gh is never asked for ${command}, got: ${calls.github.join(' ')}`);
};

const cases = async () => {
  group('release-taken: what it never asks about');

  await test('a commit that is not a release, and a command that is no commit at all', async () => {
    await neverAsks('feat: x', TAKEN_WORLD, judgeRelease);
    for (const c of ['git status', 'npm run build']) await neverAsks(c);
  });

  await test('the release subject mentioned mid-message is not a subject', async () => {
    await neverAsks('docs(ship): explain how chore(release): 1.2.3 is judged', TAKEN_WORLD, judgeRelease);
  });

  await test('a dry run publishes nothing, so it is not a publish', async () => {
    for (const c of ['npm publish --dry-run', 'npm publish --dry-run=true']) await neverAsks(c, { npmTaken: ['widget@1.2.3'] });
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
