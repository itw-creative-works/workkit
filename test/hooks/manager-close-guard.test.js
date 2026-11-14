// Tests for manager:close-guard's logic: turnFacts(messages, isSystemPrompt) and closeGuardWarning(facts, { tier,
// frontier, closeEdits }) in hooks/mods/close-guard.js, over $.session.messages() rows. Both rules, the turn window
// (after the last owner prompt) and the threshold. The event, the session model, the settings and the log are
// test/mods/stop.test.ts.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../lib/harness');
const {
  mods, textOf, MODELS, row,
} = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const { tiers } = JSON.parse(fs.readFileSync(path.join(KIT, 'defaults', 'settings.json'), 'utf8')).manager;
const FRONTIER = tiers.frontier;
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

describe('manager-close-guard: rule 3, the frontier model implementing itself', () => {
  test('6 edits and no worker in a frontier session warns', () => {
    const msg = warn([row.user(), ...edits(6)]);
    const rule3 = 'the frontier model made 6 edits itself this turn with no worker spawn: implementation belongs with workkit:worker';
    expect(msg.includes(rule3), `rule 3, in its own words: ${msg}`).toBeTruthy();
  });

  test('6 edits WITH a worker spawn is silent on rule 3', () => {
    const rows = [row.user(), ...edits(6), spawn('worker'), row.result(), spawn('verifier'), row.result()];
    expect(warn(rows), 'a worker spawn clears rule 3, a verifier clears rule 4').toBe('');
  });

  test('4 edits stays under the default threshold', () => {
    expect(warn([row.user(), ...edits(4)]), 'four is under five').toBe('');
  });

  test('five edits is the default threshold', () => {
    expect(warn([row.user(), ...edits(5)]).includes('made 5 edits'), 'five warns').toBeTruthy();
  });

  test('a sonnet session doing the same editing is silent', () => {
    expect(warn([row.user(), ...edits(6)], { model: MODELS.sonnet }), 'rule 3 is the frontier model\'s').toBe('');
  });

  test('MANAGER_CLOSE_EDITS lowers the threshold', () => {
    const rows = [row.user(), ...edits(2)];
    expect(warn(rows), 'two is under the default').toBe('');
    expect(warn(rows, { closeEdits: 2 }).includes('2 edits'), 'and at a threshold of two it warns').toBeTruthy();
  });

  test('a Write call counts as an edit', () => {
    const rows = [row.user(), row.tool('Write', { file_path: '/x', content: 'y' })];
    expect(warn(rows, { closeEdits: 1 }).includes('1 edits'), 'a Write is an edit').toBeTruthy();
  });

  test('a Read call does not', () => {
    expect(warn([row.user(), row.tool('Read', { file_path: '/x' })], { closeEdits: 1 }), 'a Read is no edit').toBe('');
  });

  test('a spawn naming no subagent_type is no worker: rule 3 still warns', () => {
    expect(warn([row.user(), ...edits(6), spawn(undefined), row.result()]).includes('6 edits'), 'an untyped spawn clears nothing').toBeTruthy();
  });
});

describe('manager-close-guard: rule 4, built work ending unreviewed', () => {
  test('a worker with no verifier warns', () => {
    const msg = warn([row.user(), spawn('worker'), row.result()]);
    expect(msg.includes('verifier'), msg).toBeTruthy();
    expect(msg.includes('consider'), `the wording should suggest, not scold: ${msg}`).toBeTruthy();
  });

  test('workkit:worker (the prefixed spelling) reads the same', () => {
    expect(warn([row.user(), spawn('workkit:worker'), row.result()]).includes('verifier'), 'the prefix is stripped').toBeTruthy();
  });

  test('an Agent tool use is a spawn as a Task one is', () => {
    expect(warn([row.user(), spawn('workkit:worker', 'Agent'), row.result()]).includes('verifier'), 'an Agent worker arms rule 4').toBeTruthy();
    expect(warn([row.user(), spawn('worker', 'Agent'), row.result(), spawn('workkit:verifier', 'Agent'), row.result()]), 'and an Agent verifier clears it').toBe('');
  });

  test('a worker followed by a verifier is silent', () => {
    expect(warn([row.user(), spawn('worker'), row.result(), spawn('workkit:verifier'), row.result()]), 'reviewed').toBe('');
  });

  test('a scout alone is silent', () => {
    expect(warn([row.user(), spawn('scout'), row.result()]), 'a scout builds nothing').toBe('');
  });

  test('rule 4 fires in a sonnet session too', () => {
    expect(warn([row.user(), spawn('worker'), row.result()], { model: MODELS.sonnet }).includes('verifier'), 'any tier').toBeTruthy();
  });

  test('a heavy-editing turn that DID spawn a worker warns once, on rule 4', () => {
    const msg = warn([row.user(), ...edits(6), spawn('worker'), row.result()]);
    expect(msg.split('\n').length, `one line per stop: ${msg}`).toBe(1);
    expect(msg.includes('verifier'), msg).toBeTruthy();
    expect(!msg.includes('6 edits'), msg).toBeTruthy();
  });
});

describe('manager-close-guard: the turn window', () => {
  test('a previous turn\'s edits do not count', () => {
    expect(warn([row.user(), ...edits(6), row.user('and now something else'), ...edits(1)]), 'the window opens at the last prompt').toBe('');
  });

  test('a previous turn\'s worker does not count', () => {
    expect(warn([row.user(), spawn('worker'), row.result(), row.user('next'), ...edits(1)]), 'the worker was last turn\'s').toBe('');
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
  test('<tag> mid-turn does not reset the window, each of the eight tags', () => {
    for (const text of PSEUDO) {
      const tag = text.slice(0, text.indexOf('>') + 1);
      expect(warn([row.user(), ...edits(3), row.user(text), ...edits(3)]).includes('6 edits'), `window was reset by ${tag}`).toBeTruthy();
    }
  });

  test('a pseudo-prompt between a worker and the stop still leaves rule 4 armed', () => {
    expect(warn([row.user(), spawn('worker'), row.result(), row.user(PSEUDO[2])]).includes('verifier'), 'the notification is no prompt').toBeTruthy();
  });

  test('a subagent hand-back after the edits does not reset the window', () => {
    const handBack = row.user('[Subagent hand-back]\nDONE: the brief is built.');
    expect(warn([row.user(), ...edits(5), handBack]).includes('5 edits'), 'the hand-back started a new turn').toBeTruthy();
  });

  test('an owner paste opening with <pasted_content counts as the turn\'s prompt', () => {
    for (const open of ['<pasted_content>', '<pasted_content lines="2">']) {
      const paste = row.user(`${open}\nline one\nline two\n</pasted_content>\nwhat does this do?`);
      expect(warn([paste, ...edits(6)]).includes('6 edits'), `${open}: the paste was read as no prompt`).toBeTruthy();
    }
  });

  test('a real prompt that merely MENTIONS a tag still resets the window', () => {
    expect(warn([row.user(), ...edits(6), row.user('why does <ide_opened_file> show up?'), ...edits(1)]), 'a new turn').toBe('');
  });

  test('a user row answering a tool is no prompt, whatever its text', () => {
    const answered = { ...row.result(), text: 'tool output that reads like a prompt' };
    expect(warn([row.user(), ...edits(3), answered, ...edits(3)]).includes('6 edits'), 'the window stays open').toBeTruthy();
  });

  test('a transcript with no user prompt in view is silent', () => {
    expect(warn(edits(6)), 'no owner prompt, no turn').toBe('');
  });
});

describe('manager-close-guard: the session model', () => {
  test('no model anywhere is silent on rule 3', () => {
    expect(warn([row.user(), ...edits(6)], { model: '' }), 'an unknown model is no frontier model').toBe('');
  });
});
