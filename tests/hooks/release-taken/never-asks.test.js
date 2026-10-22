// Tests for safety:release-taken's logic: what it never asks about. Each case
// ports the HEAD case its name quotes.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { judge } = require('./helpers');

const TAKEN_WORLD = { npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] };

// Silence, and neither provider asked.
const neverAsks = async (command, world = TAKEN_WORLD) => {
  const { deny, text, calls } = await judge(command, world);
  assertEq(deny, null, `not this hook's business: ${command}`);
  assertEq(text, '', `and nothing said: ${command}`);
  assertEq(calls.npm.length, 0, `npm is never asked for ${command}, got: ${calls.npm.join(' ')}`);
  assertEq(calls.github.length, 0, `gh is never asked for ${command}, got: ${calls.github.join(' ')}`);
};

const run = async () => {
  group('release-taken: what it never asks about');

  await test('ports "a commit that is not a release, and a command that is no commit at all"', async () => {
    for (const c of ['git commit -m "feat: x"', 'git status', 'npm run build']) await neverAsks(c);
  });

  await test('ports "the release subject mentioned mid-message is not a subject"', async () => {
    await neverAsks('git commit -m "docs(ship): explain how chore(release): 1.2.3 is judged"');
  });

  await test('ports "a dry run publishes nothing, so it is not a publish"', async () => {
    for (const c of ['npm publish --dry-run', 'npm publish --dry-run=true']) await neverAsks(c, { npmTaken: ['widget@1.2.3'] });
  });

  await test('ports "a quoted mention of the release subject is not a commit"', async () => {
    await neverAsks('echo "chore(release): 1.2.3"');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
