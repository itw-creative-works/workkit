// Tests for docs:checkpoint's logic, checkpointContext(prompt, marker) in hooks/mods/checkpoint.js, and the
// prompt-shape test it stands on, isSystemPrompt(text) in hooks/mods/frame.js, the frame shapes' one home: a
// compaction line fires the workkit:checkpoint skill. The marker and the delta it asks for are per-session state,
// test/mods/user-prompt-submit.test.ts.

// HEAD cases retired with the mod (the engine parses the input; a module has no jq):
// "garbage stdin exits 0 silently", "no jq on PATH exits 0 silently".
// HEAD cases ported under new names in test/mods/user-prompt-submit.test.ts:
// "loader routes docs:checkpoint" and "valid UserPromptSubmit JSON shape" as "an opted-in repo: the contexts arrive in the order ...".

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const say = (prompt, marker) => textOf(mods('checkpoint').checkpointContext(prompt, marker));

// [label, prompt text, delivered by Claude Code itself]: each frame line alone
// and inside longer text, a tag opening, the owner's paste, plain text.
const PROMPTS = [
  ['the notification frame alone', '[SYSTEM NOTIFICATION - NOT USER INPUT]', true],
  ['the notification frame in longer text', 'A background task ended.\n[SYSTEM NOTIFICATION - NOT USER INPUT]\nIt exited 0.', true],
  ['the session frame alone', 'Another Claude session sent a message', true],
  ['the session frame in longer text', 'Heads up. Another Claude session sent a message:\nthe build is green', true],
  ['the agent-message frame alone', '<agent-message ', true],
  ['the agent-message frame in longer text', 'From the scout:\n<agent-message from="scout">recon done</agent-message>', true],
  ['the hand-back frame alone', '[Subagent hand-back]', true],
  ['the hand-back frame in longer text', 'DONE: the brief is built.\n[Subagent hand-back]\nall four suites green', true],
  ['a task-notification opening', '<task-notification>\n<task-id>b1</task-id>\nfinished\n</task-notification>', true],
  ['an indented tag opening', '  <ide_opened_file>x</ide_opened_file>', true],
  ['a pasted_content opening', '<pasted_content lines="2">\nline one\nline two\n</pasted_content>\nwhat does this do?', false],
  ['a bare pasted_content opening', '<pasted_content>\nline one\n</pasted_content>\nwhat does this do?', false],
  ['plain text', 'work on #12 and then compact', false],
  ['plain text that mentions a tag', 'why does <ide_opened_file> show up?', false],
  ['a frame word without its brackets', 'Subagent hand-back is what this is called', false],
];

// Every phrase the skill's own trigger paragraph names, plus the question form.
const FIRING = [
  'Can I compact?', 'my context is running out',
  'context window is full', 'the context is low', 'we are running out of context here', 'I am running low on context',
  'almost out of context, what next', 'clear the chat', 'clear this chat', 'new chat', 'fresh session', 'start over',
];

// `context` with none of its four followers, and words that contain one.
const SILENT = [
  'ship the release when CI is green',
  'in this context, follow the steps below',
  'the context of the bug is issue #12',
];

const run = async () => {
  group('docs-checkpoint: the compaction phrases fire');
  for (const prompt of FIRING) {
    await test(`ports "fires on "${prompt}""`, () => {
      const ctx = say(prompt);
      assert(ctx.includes('workkit:checkpoint'), `the injection must name the skill, got: ${ctx}`);
      assert(ctx.includes('#238'), 'the injection must cite its issue');
    });
  }

  group('docs-checkpoint: everything else is silence');
  for (const prompt of SILENT) {
    await test(`ports "silent on "${prompt}""`, () => {
      assertEq(say(prompt), '', 'an unrelated prompt produces nothing');
    });
  }

  group('docs-checkpoint: a system-delivered prompt is silence');
  await test("isSystemPrompt: a frame line, alone or inside longer text, or a tag opening is Claude Code's; a paste or plain text is the owner's", () => {
    for (const [label, text, system] of PROMPTS) {
      assertEq(mods('frame').isSystemPrompt(text), system, label);
      assertEq(say(`${text}\ncompact`) === '', system, `${label}: a compaction line inside it is ${system ? 'silent' : 'heard'}`);
    }
  });

  group('docs-checkpoint: robustness');
  await test('ports "empty stdin exits 0 silently": an empty prompt is silence', () => {
    assertEq(say(''), '', 'nothing to match');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
