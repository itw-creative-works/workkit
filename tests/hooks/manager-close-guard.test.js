// manager/close-guard hook — the warn-only end-of-turn read of the manager's
// own behavior. Covers both rules over fixture transcripts, the turn window
// (only entries after the last real user prompt, sidechain entries excluded),
// the threshold override, the fail-open preconditions, and the invariant that
// the hook never continues a turn: no decision, no additionalContext.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'close-guard', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const ladder = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'manager', 'ladder.json'), 'utf8'));
const id = (rung) => ladder.ladder[rung];
const FRONTIER = ladder.tiers.frontier;

let tmp;
const freshTmp = () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'close-guard-test-'));
  return tmp;
};

// Transcript entry builders — the shapes a real .jsonl carries.
const prompt = (text = 'do the thing') => ({ type: 'user', message: { role: 'user', content: text } });
const meta = () => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'system reminder' }] } });
// The system-injected pseudo-prompts: ordinary user entries by every field the
// hook can see (isMeta null, isSidechain false), told apart only by the tag
// their text opens with. Both content spellings occur in real transcripts.
const injected = (text, asArray = false) => ({
  type: 'user',
  message: { role: 'user', content: asArray ? [{ type: 'text', text }] : text },
});
const result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const toolUse = (name, model, input = {}, extra = {}) => ({
  type: 'assistant',
  message: { model, content: [{ type: 'tool_use', id: `t${Math.random().toString(36).slice(2)}`, name, input }] },
  ...extra,
});
const edit = (model) => toolUse('Edit', model, { file_path: '/x', old_string: 'a', new_string: 'b' });
const spawn = (cls, model) => toolUse('Task', model, { subagent_type: cls, prompt: 'brief' });
const edits = (n, model) => Array.from({ length: n }, () => [edit(model), result()]).flat();

// Writes a transcript and returns its path. `model` rides on every assistant
// entry, which is where hook_session_model reads the session tier from.
const transcript = (entries) => {
  const p = path.join(tmp, 't.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n'));
  return p;
};

const runHook = (input, env = {}) => {
  const res = spawnSync('bash', [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      TMPDIR: tmp,
      MANAGER_USER_SETTINGS: path.join(tmp, 'no-user-settings.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// The Stop payload. The session cache is never written by this suite, so the
// tier always comes from the transcript's own assistant entries.
const payload = (transcriptPath, extra = {}) => ({
  session_id: 'sess1',
  transcript_path: transcriptPath,
  hook_event_name: 'Stop',
  stop_hook_active: false,
  ...extra,
});

const warn = (out) => (out.stdout ? JSON.parse(out.stdout).systemMessage : '');

const run = async () => {
  const F = id(FRONTIER);

  group('manager-close-guard: rule 3 — the frontier model implementing itself');
  await test('6 edits and no worker in a frontier session warns', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), ...edits(6, F)])));
    assertEq(out.code, 0, out.stderr);
    const msg = warn(out);
    assert(msg.includes('6 edits'), msg);
    assert(msg.includes('workkit:worker'), msg);
  });
  await test('6 edits WITH a worker spawn is silent on rule 3', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), ...edits(6, F), spawn('worker', F), result(), spawn('verifier', F), result(),
    ])));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('4 edits stays under the default threshold', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), ...edits(4, F)])));
    assertEq(out.stdout, '');
  });
  await test('a sonnet session doing the same editing is silent', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), ...edits(6, id('sonnet'))])));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('MANAGER_CLOSE_EDITS lowers the threshold', () => {
    freshTmp();
    const t = transcript([prompt(), ...edits(2, F)]);
    assertEq(runHook(payload(t)).stdout, '');
    assert(warn(runHook(payload(t), { MANAGER_CLOSE_EDITS: '2' })).includes('2 edits'));
  });
  await test('a Write call counts as an edit', () => {
    freshTmp();
    const t = transcript([prompt(), toolUse('Write', F, { file_path: '/x', content: 'y' })]);
    assert(warn(runHook(payload(t), { MANAGER_CLOSE_EDITS: '1' })).includes('1 edits'));
  });
  await test('a Read call does not', () => {
    freshTmp();
    const t = transcript([prompt(), toolUse('Read', F, { file_path: '/x' })]);
    assertEq(runHook(payload(t), { MANAGER_CLOSE_EDITS: '1' }).stdout, '');
  });

  group('manager-close-guard: rule 4 — built work ending unreviewed');
  await test('a worker with no verifier warns', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), spawn('worker', F), result()])));
    assertEq(out.code, 0, out.stderr);
    const msg = warn(out);
    assert(msg.includes('verifier'), msg);
    assert(msg.includes('consider'), `the wording should suggest, not scold: ${msg}`);
  });
  await test('workkit:worker (the prefixed spelling) reads the same', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), spawn('workkit:worker', F), result()])));
    assert(warn(out).includes('verifier'), out.stdout);
  });
  await test('a worker followed by a verifier is silent', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), spawn('worker', F), result(), spawn('workkit:verifier', F), result(),
    ])));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('a scout alone is silent', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), spawn('scout', F), result()])));
    assertEq(out.stdout, '');
  });
  await test('rule 4 fires in a sonnet session too', () => {
    freshTmp();
    const s = id('sonnet');
    assert(warn(runHook(payload(transcript([prompt(), spawn('worker', s), result()])))).includes('verifier'));
  });
  await test('a heavy-editing turn that DID spawn a worker warns once, on rule 4', () => {
    freshTmp();
    // A frontier turn that edited heavily AND spawned only a verifier-less
    // worker fires rule 4 alone (the worker spawn clears rule 3).
    const out = runHook(payload(transcript([prompt(), ...edits(6, F), spawn('worker', F), result()])));
    const msg = warn(out);
    assertEq(msg.split('\n').length, 1, `one line per stop: ${msg}`);
    assert(msg.includes('verifier'), msg);
    assert(!msg.includes('6 edits'), msg);
  });

  group('manager-close-guard: the turn window');
  await test('a previous turn\'s edits do not count', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), ...edits(6, F), prompt('and now something else'), ...edits(1, F),
    ])));
    assertEq(out.stdout, '');
  });
  await test('a previous turn\'s worker does not count', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), spawn('worker', F), result(), prompt('next'), ...edits(1, F),
    ])));
    assertEq(out.stdout, '');
  });
  await test('a meta user entry is not a turn boundary', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), ...edits(3, F), meta(), ...edits(3, F),
    ])));
    assert(warn(out).includes('6 edits'), out.stdout);
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
  for (const text of PSEUDO) {
    const tag = text.slice(0, text.indexOf('>') + 1);
    await test(`${tag} mid-turn does not reset the window`, () => {
      freshTmp();
      const out = runHook(payload(transcript([
        prompt(), ...edits(3, F), injected(text), ...edits(3, F),
      ])));
      assert(warn(out).includes('6 edits'), `window was reset by ${tag}: ${out.stdout}`);
    });
  }
  await test('a pseudo-prompt in array (text block) form is rejected too', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), ...edits(3, F), injected(PSEUDO[0], true), ...edits(3, F),
    ])));
    assert(warn(out).includes('6 edits'), out.stdout);
  });
  await test('a pseudo-prompt between a worker and the stop still leaves rule 4 armed', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), spawn('worker', F), result(), injected(PSEUDO[2]),
    ])));
    assert(warn(out).includes('verifier'), out.stdout);
  });
  await test('a real prompt that merely MENTIONS a tag still resets the window', () => {
    freshTmp();
    const out = runHook(payload(transcript([
      prompt(), ...edits(6, F), prompt('why does <ide_opened_file> show up?'), ...edits(1, F),
    ])));
    assertEq(out.stdout, '');
  });
  await test('a subagent\'s own edits (isSidechain) do not count', () => {
    freshTmp();
    const side = edits(6, F).map((e) => ({ ...e, isSidechain: true }));
    const out = runHook(payload(transcript([prompt(), ...side, spawn('worker', F), result(), spawn('verifier', F)])));
    assertEq(out.stdout, '');
  });
  await test('a transcript with no user prompt in view is silent', () => {
    freshTmp();
    const out = runHook(payload(transcript(edits(6, F))));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('manager-close-guard: the session model comes from the tail');
  // A statusline cache exists in terminal sessions and is EMPTY in VS Code
  // ones, so it can never be the source this hook depends on; the tail it
  // already read is. These pin that order, and that a whole-file read is not
  // on the normal path.
  const cacheSession = (modelId) => {
    const dir = path.join(tmp, 'claude-session-state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sess1.json'), JSON.stringify({ model: { id: modelId }, thinking: { enabled: true } }));
  };
  await test('the tail\'s own assistant model wins over the statusline cache', () => {
    freshTmp();
    cacheSession(id('sonnet'));
    const out = runHook(payload(transcript([prompt(), ...edits(6, F)])));
    assert(warn(out).includes('6 edits'), `the frontier tail should have decided: ${out.stdout}`);
  });
  await test('a sonnet tail is silent even with a frontier cache', () => {
    freshTmp();
    cacheSession(id(FRONTIER));
    const out = runHook(payload(transcript([prompt(), ...edits(6, id('sonnet'))])));
    assertEq(out.stdout, '');
  });
  await test('assistant entries carrying no model fall back to the cache', () => {
    freshTmp();
    cacheSession(id(FRONTIER));
    const out = runHook(payload(transcript([prompt(), ...edits(6, undefined)])));
    assert(warn(out).includes('6 edits'), out.stdout);
  });
  await test('no model anywhere is silent on rule 3', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), ...edits(6, undefined)])));
    assertEq(out.stdout, '');
  });
  await test('the read stops at the tail — a turn beyond it is not seen', () => {
    freshTmp();
    // The turn worth warning about sits in the HEAD; 4200 lines of quiet
    // tool-result traffic follow it. Reading the whole file would warn.
    const head = [prompt(), ...edits(6, F)];
    const filler = Array.from({ length: 4200 }, () => result());
    const p = path.join(tmp, 'long.jsonl');
    fs.writeFileSync(p, [...head, ...filler].map((e) => JSON.stringify(e)).join('\n'));
    const out = runHook(payload(p));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('manager-close-guard: fail open');
  await test('a missing transcript is silent', () => {
    freshTmp();
    const out = runHook(payload(path.join(tmp, 'nope.jsonl')));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('an absent transcript_path is silent', () => {
    freshTmp();
    const out = runHook({ session_id: 'sess1', hook_event_name: 'Stop' });
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('a garbage transcript is silent', () => {
    freshTmp();
    const p = path.join(tmp, 'junk.jsonl');
    fs.writeFileSync(p, 'not json\n{half written');
    const out = runHook(payload(p));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('garbage lines among good ones are ignored', () => {
    freshTmp();
    const p = path.join(tmp, 'mixed.jsonl');
    fs.writeFileSync(p, ['{oops', ...[prompt(), ...edits(6, F)].map((e) => JSON.stringify(e)), '{half'].join('\n'));
    assert(warn(runHook(payload(p))).includes('6 edits'));
  });
  await test('garbage stdin is silent', () => {
    freshTmp();
    const out = runHook('this is not json');
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('stop_hook_active is silent (the turn was judged once)', () => {
    freshTmp();
    const out = runHook(payload(transcript([prompt(), ...edits(6, F)]), { stop_hook_active: true }));
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('enabled: false silences the guard', () => {
    freshTmp();
    const settings = path.join(tmp, 'user-settings.json');
    fs.writeFileSync(settings, JSON.stringify({ version: 1, manager: { enabled: false } }));
    const out = runHook(payload(transcript([prompt(), ...edits(6, F)])), { MANAGER_USER_SETTINGS: settings });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('manager-close-guard: warn-only invariant');
  await test('the output never continues the turn', () => {
    freshTmp();
    for (const entries of [
      [prompt(), ...edits(6, F)],
      [prompt(), spawn('worker', F), result()],
    ]) {
      const out = runHook(payload(transcript(entries)));
      assertEq(out.code, 0, out.stderr);
      assert(out.stdout.length > 0, 'expected a warning for this case');
      const parsed = JSON.parse(out.stdout);
      assertEq(parsed.decision, undefined, 'decision must be absent');
      assertEq(parsed.hookSpecificOutput, undefined, 'additionalContext would continue the turn');
      assert(typeof parsed.systemMessage === 'string', 'the warning is a systemMessage');
    }
  });

  group('manager-close-guard: loader integration');
  await test('loader routes manager:close-guard', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'manager:close-guard'], {
      input: JSON.stringify(payload(transcript([prompt(), ...edits(6, F)]))),
      env: { ...process.env, TMPDIR: tmp, MANAGER_USER_SETTINGS: path.join(tmp, 'none.json') },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert(JSON.parse(res.stdout).systemMessage.includes('manager:close-guard'), res.stdout);
  });
  await test('HOOK_DISABLE=1 is a silent no-op', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'manager:close-guard'], {
      input: JSON.stringify(payload(transcript([prompt(), ...edits(6, F)]))),
      env: { ...process.env, TMPDIR: tmp, HOOK_DISABLE: '1' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0);
    assertEq(res.stdout, '');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
