// Tests for docs:checkpoint's logic, checkpointContext(prompt, marker) in
// hooks/mods/checkpoint.js, and the prompt-shape test it stands on,
// isSystemPrompt(text) in hooks/mods/frame.js: a compaction line fires the
// workkit:checkpoint skill. The marker and the delta it asks for are
// per-session state, tests/mods/user-prompt-submit.test.ts.

// HEAD cases retired with the mod (the engine parses the input; a module has no jq):
// "garbage stdin exits 0 silently", "no jq on PATH exits 0 silently".
// HEAD cases ported under new names in tests/mods/user-prompt-submit.test.ts:
// "loader routes docs:checkpoint" and "valid UserPromptSubmit JSON shape" as "an opted-in repo: the contexts arrive in the order ...".

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const say = (prompt, marker) => textOf(mods('checkpoint').checkpointContext(prompt, marker));

// One HOOK_PROMPT_* pattern's text as hooks/_lib.sh states it, its one POSIX
// class spelled as a JS regex spells it.
const shellPattern = (name) => {
  const m = new RegExp(`^readonly ${name}='(.*)'$`, 'm').exec(fs.readFileSync(path.join(KIT, 'hooks', '_lib.sh'), 'utf8'));
  assert(m, `hooks/_lib.sh defines ${name}`);
  return m[1].replace(/\[\[:space:\]\]/g, '\\s');
};

// Every regex literal hooks/mods/frame.js carries, as source text.
const frameRegexTexts = () => {
  const source = fs.readFileSync(path.join(KIT, 'hooks', 'mods', 'frame.js'), 'utf8');
  return [...source.matchAll(/\/((?:\\.|\[[^\]]*\]|[^/\\\n[])+)\/[a-z]*/g)].map((m) => m[1]);
};

// Every phrase the skill's own trigger paragraph names, plus the question
// form, the slash command, the noun, and an uppercase line.
const FIRING = [
  'Can I compact?', '/compact', 'compaction', 'should I compact before we continue?', 'my context is running out',
  'context window is full', 'the context is low', 'we are running out of context here', 'I am running low on context',
  'almost out of context, what next', 'clear the chat', 'clear this chat', 'new chat', 'fresh session', 'start over',
  'CONTEXT IS RUNNING OUT, WHAT NOW',
];

// `context` with none of its four followers, and words that contain one.
const SILENT = [
  'ship the release when CI is green',
  'in this context, follow the steps below',
  'the context of the bug is issue #12',
  'give me more context on the resolver',
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
  await test("isSystemPrompt's three patterns equal hooks/_lib.sh's HOOK_PROMPT_TAG_RE, HOOK_PROMPT_PASTE_RE and HOOK_PROMPT_FRAME_RE", () => {
    const texts = frameRegexTexts();
    for (const name of ['HOOK_PROMPT_TAG_RE', 'HOOK_PROMPT_PASTE_RE', 'HOOK_PROMPT_FRAME_RE']) {
      const shell = shellPattern(name);
      assert(texts.includes(shell), `frame.js carries ${name}'s text ${shell}, found: ${JSON.stringify(texts)}`);
    }
    for (const alt of shellPattern('HOOK_PROMPT_FRAME_RE').split('|')) {
      const words = alt.replace(/\\(.)/g, '$1');
      assertEq(mods('frame').isSystemPrompt(`${words}\ncompact`), true, `a prompt framed by ${words} is Claude Code's`);
    }
    assertEq(mods('frame').isSystemPrompt('<pasted_content>compact</pasted_content>'), false, "the owner's paste is the owner's");
    assertEq(mods('frame').isSystemPrompt('<task-notification>compact</task-notification>'), true, 'another opening tag is not');
  });

  await test('ports "a hand-back that says compact prints nothing; the same words typed plain fire"', () => {
    const words = 'the scout is done, should I compact before we continue?';
    const handBack = `[Subagent hand-back]\n${words}`;
    assertEq(mods('frame').isSystemPrompt(handBack), true, 'a hand-back is a system prompt');
    assertEq(mods('frame').isSystemPrompt(words), false, "the owner's words are not");
    assertEq(say(handBack), '', "the agent's words are not the owner's");
    assert(say(words).includes('run the workkit:checkpoint skill before anything else'), "the owner's line fires the full pass");
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
