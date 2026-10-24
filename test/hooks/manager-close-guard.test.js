// Tests for manager:close-guard's logic: turnFacts(messages, isSystemPrompt) and closeGuardWarning(facts, { tier,
// frontier, closeEdits }) in hooks/mods/close-guard.js, over $.session.messages() rows. Both rules, the turn window
// (after the last owner prompt) and the threshold. Each case ports the HEAD case its name quotes; the event, the
// session model, the settings and the log are test/mods/stop.test.ts.

// HEAD cases retired with the transcript scan: "a meta user entry is not a turn boundary" and "a subagent's own edits
// (isSidechain) do not count" (the rows carry no isMeta or isSidechain), "a pseudo-prompt in array (text block) form
// is rejected too" (a row's text is its blocks joined), "the read stops at the tail: a turn beyond it is not seen",
// and the fail-open cases "a missing transcript", "an absent transcript_path", "a garbage transcript", "garbage lines".

// Also retired: "garbage stdin is silent" (the engine parses the input); the statusline fallback, "the tail's own
// assistant model wins over the statusline cache", "a sonnet tail is silent even with a frontier cache", "assistant
// entries carrying no model fall back to the cache" (the model is $.session.model()); the loader integration, "loader
// routes manager:close-guard".

// HEAD cases ported in test/mods/stop.test.ts: "stop_hook_active is silent (the turn was judged once)", "enabled:
// false silences the guard", "the output never continues the turn", "HOOK_DISABLE=1 is a silent no-op".

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const {
  mods, textOf, MODELS, row,
} = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const ladder = JSON.parse(fs.readFileSync(path.join(KIT, 'hooks', 'manager', 'resources', 'ladder.json'), 'utf8'));
const FRONTIER = ladder.tiers.frontier;
const FRONTIER_MODEL = MODELS[FRONTIER];

const edit = () => row.tool('Edit', { file_path: '/x', old_string: 'a', new_string: 'b' });
const edits = (n) => Array.from({ length: n }, () => [edit(), row.result()]).flat();
const spawn = (type, tool = 'Task') => row.tool(tool, type === undefined ? { prompt: 'brief' } : { subagent_type: type, prompt: 'brief' });

/** The warning for a turn's rows in a session on `model`, '' for silence. */
const warn = (rows, { model = FRONTIER_MODEL, closeEdits = 5 } = {}) => {
  const facts = mods('close-guard').turnFacts(rows, mods('frame').isSystemPrompt);
  const tier = mods('manager').modelTier(model);
  return textOf(mods('close-guard').closeGuardWarning(facts, { tier, frontier: FRONTIER, closeEdits }));
};

const run = async () => {
  group('manager-close-guard: rule 3, the frontier model implementing itself');

  await test('ports "6 edits and no worker in a frontier session warns"', () => {
    const msg = warn([row.user(), ...edits(6)]);
    const rule3 = 'the frontier model made 6 edits itself this turn with no worker spawn: implementation belongs with workkit:worker';
    assert(msg.includes(rule3), `rule 3, in its own words: ${msg}`);
  });

  await test('ports "6 edits WITH a worker spawn is silent on rule 3"', () => {
    const rows = [row.user(), ...edits(6), spawn('worker'), row.result(), spawn('verifier'), row.result()];
    assertEq(warn(rows), '', 'a worker spawn clears rule 3, a verifier clears rule 4');
  });

  await test('ports "4 edits stays under the default threshold"', () => {
    assertEq(warn([row.user(), ...edits(4)]), '', 'four is under five');
  });

  await test('five edits is the default threshold', () => {
    assert(warn([row.user(), ...edits(5)]).includes('made 5 edits'), 'five warns');
  });

  await test('ports "a sonnet session doing the same editing is silent"', () => {
    assertEq(warn([row.user(), ...edits(6)], { model: MODELS.sonnet }), '', 'rule 3 is the frontier model\'s');
  });

  await test('ports "MANAGER_CLOSE_EDITS lowers the threshold"', () => {
    const rows = [row.user(), ...edits(2)];
    assertEq(warn(rows), '', 'two is under the default');
    assert(warn(rows, { closeEdits: 2 }).includes('2 edits'), 'and at a threshold of two it warns');
  });

  await test('ports "a Write call counts as an edit"', () => {
    const rows = [row.user(), row.tool('Write', { file_path: '/x', content: 'y' })];
    assert(warn(rows, { closeEdits: 1 }).includes('1 edits'), 'a Write is an edit');
  });

  await test('ports "a Read call does not"', () => {
    assertEq(warn([row.user(), row.tool('Read', { file_path: '/x' })], { closeEdits: 1 }), '', 'a Read is no edit');
  });

  await test('a spawn naming no subagent_type is no worker: rule 3 still warns', () => {
    assert(warn([row.user(), ...edits(6), spawn(undefined), row.result()]).includes('6 edits'), 'an untyped spawn clears nothing');
  });

  group('manager-close-guard: rule 4, built work ending unreviewed');

  await test('ports "a worker with no verifier warns"', () => {
    const msg = warn([row.user(), spawn('worker'), row.result()]);
    assert(msg.includes('verifier'), msg);
    assert(msg.includes('consider'), `the wording should suggest, not scold: ${msg}`);
  });

  await test('ports "workkit:worker (the prefixed spelling) reads the same"', () => {
    assert(warn([row.user(), spawn('workkit:worker'), row.result()]).includes('verifier'), 'the prefix is stripped');
  });

  await test('an Agent tool use is a spawn as a Task one is', () => {
    assert(warn([row.user(), spawn('workkit:worker', 'Agent'), row.result()]).includes('verifier'), 'an Agent worker arms rule 4');
    assertEq(warn([row.user(), spawn('worker', 'Agent'), row.result(), spawn('workkit:verifier', 'Agent'), row.result()]), '',
      'and an Agent verifier clears it');
  });

  await test('ports "a worker followed by a verifier is silent"', () => {
    assertEq(warn([row.user(), spawn('worker'), row.result(), spawn('workkit:verifier'), row.result()]), '', 'reviewed');
  });

  await test('ports "a scout alone is silent"', () => {
    assertEq(warn([row.user(), spawn('scout'), row.result()]), '', 'a scout builds nothing');
  });

  await test('ports "rule 4 fires in a sonnet session too"', () => {
    assert(warn([row.user(), spawn('worker'), row.result()], { model: MODELS.sonnet }).includes('verifier'), 'any tier');
  });

  await test('ports "a heavy-editing turn that DID spawn a worker warns once, on rule 4"', () => {
    const msg = warn([row.user(), ...edits(6), spawn('worker'), row.result()]);
    assertEq(msg.split('\n').length, 1, `one line per stop: ${msg}`);
    assert(msg.includes('verifier'), msg);
    assert(!msg.includes('6 edits'), msg);
  });

  group('manager-close-guard: the turn window');

  await test('ports "a previous turn\'s edits do not count"', () => {
    assertEq(warn([row.user(), ...edits(6), row.user('and now something else'), ...edits(1)]), '', 'the window opens at the last prompt');
  });

  await test('ports "a previous turn\'s worker does not count"', () => {
    assertEq(warn([row.user(), spawn('worker'), row.result(), row.user('next'), ...edits(1)]), '', 'the worker was last turn\'s');
  });

  // The IDE injects these constantly mid-turn; counting one as a prompt would
  // reset the window exactly when a VS Code session is editing heavily.
  const PSEUDO = [
    '<ide_opened_file>The user opened the file /x/y.ts in the IDE</ide_opened_file>',
    '<ide_selection>The user selected the lines 1 to 4</ide_selection>',
    '<task-notification>a background task finished</task-notification>',
    '<task-id>b3k013660</task-id>',
    '<command-name>/compact</command-name>',
    '<command-message>claude:handoff</command-message>',
    '<local-command-stdout>Compacted the conversation</local-command-stdout>',
    '<system-reminder>keep the issue true</system-reminder>',
  ];
  await test('ports "<tag> mid-turn does not reset the window", each of the eight tags', () => {
    for (const text of PSEUDO) {
      const tag = text.slice(0, text.indexOf('>') + 1);
      assert(warn([row.user(), ...edits(3), row.user(text), ...edits(3)]).includes('6 edits'), `window was reset by ${tag}`);
    }
  });

  await test('ports "a pseudo-prompt between a worker and the stop still leaves rule 4 armed"', () => {
    assert(warn([row.user(), spawn('worker'), row.result(), row.user(PSEUDO[2])]).includes('verifier'), 'the notification is no prompt');
  });

  await test('ports "a subagent hand-back after the edits does not reset the window"', () => {
    const handBack = row.user('[Subagent hand-back]\nDONE: the brief is built.');
    assert(warn([row.user(), ...edits(5), handBack]).includes('5 edits'), 'the hand-back started a new turn');
  });

  await test('ports "an owner paste opening with <pasted_content counts as the turn\'s prompt"', () => {
    for (const open of ['<pasted_content>', '<pasted_content lines="2">']) {
      const paste = row.user(`${open}\nline one\nline two\n</pasted_content>\nwhat does this do?`);
      assert(warn([paste, ...edits(6)]).includes('6 edits'), `${open}: the paste was read as no prompt`);
    }
  });

  await test('ports "a real prompt that merely MENTIONS a tag still resets the window"', () => {
    assertEq(warn([row.user(), ...edits(6), row.user('why does <ide_opened_file> show up?'), ...edits(1)]), '', 'a new turn');
  });

  await test('a user row answering a tool is no prompt, whatever its text', () => {
    const answered = { ...row.result(), text: 'tool output that reads like a prompt' };
    assert(warn([row.user(), ...edits(3), answered, ...edits(3)]).includes('6 edits'), 'the window stays open');
  });

  await test('ports "a transcript with no user prompt in view is silent"', () => {
    assertEq(warn(edits(6)), '', 'no owner prompt, no turn');
  });

  group('manager-close-guard: the session model');

  await test('ports "no model anywhere is silent on rule 3"', () => {
    assertEq(warn([row.user(), ...edits(6)], { model: '' }), '', 'an unknown model is no frontier model');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
