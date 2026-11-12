// Tests for safety:commit-attribution's logic, commitAttributionVerdict(message) in
// hooks/mods/commit-attribution.js, over the message git commits: a Claude co-author line or a
// "Generated with Claude Code" line is denied, quoting the line; a person's co-author line, a
// Claude-Session link and the word Claude in a subject pass. The setting that turns the check on
// is attributionOff (test/hooks/settings.test.js); the real commit-msg run is test/scripts/githooks.test.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const judge = (message) => mods('commit-attribution').commitAttributionVerdict(message);

const PREFIX = 'commit-attribution: BLOCKED this commit:';

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny : null);

// A refusal opens with the check's prefix and quotes the attribution line.
const refuses = async (message, line) => {
  const deny = denyOf(await judge(message));
  assert(deny !== null, `must refuse: ${message}`);
  assert(deny.startsWith(PREFIX), `opens with the prefix: ${message}, got: ${deny}`);
  assert(deny.includes(line), `quotes the line ${line}, got: ${deny}`);
};

const passes = async (message) => {
  const r = await judge(message);
  assertEq(denyOf(r), null, `must pass: ${message}`);
  assertEq(textOf(r), '', `silently: ${message}`);
};

const cases = async () => {
  group('commit-attribution: refused');

  await test('a message ending in the Claude co-author line is refused, the deny quoting the line', async () => {
    const line = 'Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>';
    await refuses(`fix(hooks): read the settings once\n\nThe body.\n\n${line}`, line);
  });

  await test('a co-author line naming Claude in any letter case, or an anthropic.com address, is refused', async () => {
    for (const line of ['co-authored-by: claude <someone@example.com>', 'CO-AUTHORED-BY: Helper <noreply@anthropic.com>']) {
      await refuses(`fix(hooks): read the settings once\n\n${line}`, line);
    }
  });

  await test('a Generated with Claude Code line, with or without an emoji or the link brackets, is refused', async () => {
    for (const line of [
      'Generated with [Claude Code](https://claude.com/claude-code)',
      `${String.fromCodePoint(0x1F916)} Generated with [Claude Code](https://claude.com/claude-code)`,
      'Generated with Claude Code',
    ]) {
      await refuses(`fix(hooks): read the settings once\n\nThe body.\n\n${line}`, line);
    }
  });

  group('commit-attribution: passed');

  await test('a co-author line for a person passes', async () => {
    await passes('fix(hooks): read the settings once\n\nCo-Authored-By: Ana Diaz <ana@example.com>');
  });

  await test('a co-author line for a person whose name holds the word Claude passes', async () => {
    await passes('fix(hooks): read the settings once\n\nCo-Authored-By: Jean-Claude Van <j@example.com>');
  });

  await test('a Claude-Session link passes', async () => {
    await passes('fix(hooks): read the settings once\n\nClaude-Session: https://claude.ai/code/session_x');
  });

  await test('the word Claude in a subject passes', async () => {
    await passes('fix(claude): read the settings once');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
