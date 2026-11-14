// Tests for workflow:feature's logic, featureContext(prompt, marker) in hooks/mods/feature.js: a line about working
// an issue loads the workkit:feature skill. With no marker given, every match answers the line; the marker, its
// strong-only write and the later silence are per-session state, test/mods/user-prompt-submit.test.ts.

const { describe, test, expect } = require('../lib/harness');
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

describe('workflow-feature: the issue-work lines fire', () => {
  for (const prompt of FIRING) {
    test(`fires on "${prompt}"`, () => {
      const ctx = say(prompt);
      expect(ctx.includes('workkit:feature'), `the injection must name the skill, got: ${ctx}`).toBeTruthy();
      expect(ctx.includes('#374'), 'the injection must cite its issue').toBeTruthy();
    });
  }
});

describe('workflow-feature: everything else is silence', () => {
  for (const prompt of SILENT) {
    test(`silent on "${prompt}"`, () => {
      expect(say(prompt), 'an unrelated prompt produces nothing').toBe('');
    });
  }
});

describe('workflow-feature: the line', () => {
  test('valid UserPromptSubmit JSON shape: the injection is exactly the one line', () => {
    expect(say('work on #12'), 'the line, whole').toBe(LINE);
  });

  test('empty stdin exits 0 silently: an empty prompt is silence', () => {
    expect(say(''), 'nothing to match').toBe('');
  });
});
