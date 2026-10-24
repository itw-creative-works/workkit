// Tests for workflow:feature's logic, featureContext(prompt, marker) in
// hooks/mods/feature.js: a line about working an issue loads the
// workkit:feature skill. With no marker given, every match answers the line;
// the marker, its strong-only write and the later silence are per-session
// state, test/mods/user-prompt-submit.test.ts.

// HEAD cases retired with the mod (the engine parses the input; a module has no jq):
// "garbage stdin exits 0 silently", "no jq on PATH exits 0 silently".
// HEAD case ported under a new name in test/mods/user-prompt-submit.test.ts:
// "loader routes workflow:feature" as "an opted-in repo: the contexts arrive in the order ...".

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const LINE = '[Issue work detected (#374): load the workkit:feature skill before working the issue.]';
const say = (prompt, marker) => textOf(mods('feature').featureContext(prompt, marker));

// The owner's real lines about working the queue, plus an issue number with
// and without `#`, the curly apostrophe a phone types, and one line per phrase
// no other line fires by alone.
const FIRING = [
  'ok go now, work on the issues we discussed',
  'continue', 'ok whats next?', '#42', 'we do 878 880 and 879', "Let's finish up these issues",
  'resume', 'what is in the batch', 'the open items', 'what’s next', 'let’s do it',
  'keep going', 'what now', 'next one', "what's left", 'whats left', 'work the backlog', 'do issue twelve',
  'look at the issues', 'grab the next issue', 'what next', 'go now', 'lets do it', 'check my task list',
  'clear the queue', 'show the board',
];

// A single digit, a run glued to letters, and a phrase inside a longer word.
const SILENT = [
  'ship the release when CI is green',
  'version 1.2.3', 'a1234b', 'does the framework only run on mac', 'I presume this is fine', 'this api is discontinued',
];

const run = async () => {
  group('workflow-feature: the issue-work lines fire');
  for (const prompt of FIRING) {
    await test(`ports "fires on "${prompt}""`, () => {
      const ctx = say(prompt);
      assert(ctx.includes('workkit:feature'), `the injection must name the skill, got: ${ctx}`);
      assert(ctx.includes('#374'), 'the injection must cite its issue');
    });
  }

  group('workflow-feature: everything else is silence');
  for (const prompt of SILENT) {
    await test(`ports "silent on "${prompt}""`, () => {
      assertEq(say(prompt), '', 'an unrelated prompt produces nothing');
    });
  }

  group('workflow-feature: the line');
  await test('ports "valid UserPromptSubmit JSON shape": the injection is exactly the one line', () => {
    assertEq(say('work on #12'), LINE, 'the line, whole');
  });

  await test('ports "empty stdin exits 0 silently": an empty prompt is silence', () => {
    assertEq(say(''), '', 'nothing to match');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
