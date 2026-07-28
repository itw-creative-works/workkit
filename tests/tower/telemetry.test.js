//
// Tests for tower/api/lib/telemetry.js — the token ledger read from transcripts.
//
// Everything is a fixture: a scratch ~/.claude projects tree written in the
// exact shapes Claude Code uses (an assistant line carrying message.usage, a
// subagents/ folder holding agent-<id>.jsonl beside agent-<id>.meta.json), a
// scratch marker directory, and a fake `ps`. Nothing here reads the real
// transcripts on this machine, and nothing here goes near the network.
//
// The incremental read is asserted through `bytesRead`, which counts the bytes
// this process actually pulled off disk: a second call after an append must
// read only the appended bytes, never the file again.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const lib = path.join(__dirname, '..', '..', 'tower', 'api', 'lib');
const {
  collectTelemetry, sessionTelemetry, readUsage, resetCache, cachedPaths,
  costOf, className, dayKey, PRICING, OVERTIME_DAYS,
} = require(path.join(lib, 'telemetry.js'));
const { transcriptPath } = require(path.join(lib, 'sessions.js'));
const { createServer } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'server.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-telemetry-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const PRICED = 'claude-opus-4-1';

/**
 * An assistant line in the shape Claude Code writes, usage block and all.
 * `ttl5`/`ttl1h` add the `cache_creation` split the real blocks carry; without
 * them the line is the legacy shape that names only the total.
 */
const assistantLine = ({
  id, model = PRICED, input = 0, output = 0, cacheRead = 0, cacheCreation = 0,
  ttl5 = null, ttl1h = null, timestamp = '2026-07-27T12:00:00.000Z', content = null,
} = {}) => {
  const usage = {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
  };
  if (ttl5 !== null || ttl1h !== null) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: ttl5 || 0,
      ephemeral_1h_input_tokens: ttl1h || 0,
    };
  }
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp,
    message: {
      id, model, role: 'assistant', content: content || [{ type: 'text', text: 'hi' }], usage,
    },
  });
};

/** The `Agent` tool_use line that spawns a subagent, carrying its class. */
const spawnLine = ({ id, toolUseId, subagentType, timestamp = '2026-07-27T12:00:00.000Z' }) => assistantLine({
  id,
  timestamp,
  output: 0,
  content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: subagentType, description: 'go' } }],
});

/** A scratch world: fake home, marker dir, statusline cache, and a fake `ps`. */
const mkWorld = () => {
  const root = mkTmp();
  const world = {
    root,
    home: path.join(root, 'home'),
    markerDir: path.join(root, 'claude-keep-awake'),
    stateDir: path.join(root, 'claude-session-state'),
  };
  fs.mkdirSync(world.markerDir, { recursive: true });
  fs.mkdirSync(world.stateDir, { recursive: true });
  world.exec = (cmd, args) => {
    if (cmd === 'ps') return `caffeinate -d -i -w ${args[args.length - 1] - 1000}\n`;
    throw new Error(`unexpected exec: ${cmd}`);
  };
  resetCache();
  return world;
};

/** A live marker plus its transcript. Returns the transcript path. */
const mkSession = (world, { pid = 7001, cwd = '/x/fixture', session = 'sess-1', lines = [] } = {}) => {
  fs.writeFileSync(path.join(world.markerDir, String(pid)), `caffeinate=${pid + 1000}\ncwd=${cwd}\nsession=${session}\n`);
  const file = transcriptPath(world.home, cwd, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
  return file;
};

/** A subagent transcript and its sidecar meta, under a parent transcript. */
const mkSubagent = (transcript, id, { lines = [], meta = {} } = {}) => {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${id}.jsonl`);
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
  if (meta) fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
  return file;
};

const collect = (world, opts = {}) => collectTelemetry({
  home: world.home,
  markerDir: world.markerDir,
  stateDir: world.stateDir,
  exec: world.exec,
  ...opts,
});

/** Listen on port 0 and hand back a client bound to whatever port that was. */
const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      port,
      url: (p) => `http://127.0.0.1:${port}${p}`,
      stop: () => new Promise((done) => server.close(done)),
    });
  });
});

const getJson = async (client, p) => {
  const res = await fetch(client.url(p));
  return { status: res.status, body: await res.json() };
};

const run = async () => {
  group('tower/telemetry: reading usage');

  await test('usage sums across many assistant lines, and lines without a usage block are skipped', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'm1', input: 10, output: 5, cacheRead: 100, cacheCreation: 50 }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'no usage here' } }),
        JSON.stringify({ type: 'system', subtype: 'hook', content: '' }),
        assistantLine({ id: 'm2', input: 1, output: 2, cacheRead: 3, cacheCreation: 4 }),
      ],
    });
    const usage = readUsage(file);
    assertEq(usage.tokens.input, 11, 'input summed');
    assertEq(usage.tokens.output, 7, 'output summed');
    assertEq(usage.tokens.cacheRead, 103, 'cache reads summed');
    assertEq(usage.tokens.cacheCreation, 54, 'cache creation summed');
    assertEq(usage.tokens.total, 175, 'total is the four counters');
    cleanup(w.root);
  });

  await test('one API response written as several lines is counted ONCE, by message.id', () => {
    const w = mkWorld();
    // Claude Code writes a line per content block, each repeating the same
    // usage, and a resumed session replays its history — both must dedupe.
    const line = assistantLine({ id: 'dup', input: 100, output: 20 });
    const file = mkSession(w, { lines: [line, line, assistantLine({ id: 'other', input: 1 }), line] });
    assertEq(readUsage(file).tokens.total, 121, 'the repeat is not a second charge');
    cleanup(w.root);
  });

  await test('a malformed JSON line is skipped rather than thrown, and is counted', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'ok1', input: 5 }),
        '{"type":"assistant","message":{"usage":',
        'not json at all',
        assistantLine({ id: 'ok2', output: 7 }),
      ],
    });
    const usage = readUsage(file);
    assertEq(usage.tokens.total, 12, 'the readable lines still count');
    assertEq(usage.malformed, 2, 'and the damage is reported, not hidden');
    cleanup(w.root);
  });

  await test('a missing transcript reads zeros instead of throwing', () => {
    const w = mkWorld();
    const usage = readUsage(path.join(w.root, 'nothing-here.jsonl'));
    assertEq(usage.tokens.total, 0, 'no tokens');
    assertEq(usage.cost, 0, 'and no cost either');
    cleanup(w.root);
  });

  await test('a final line with no trailing newline is still counted', () => {
    const w = mkWorld();
    const file = path.join(mkTmp(), 'x.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, assistantLine({ id: 'tail', input: 42 }));
    assertEq(readUsage(file).tokens.total, 42, 'a whole record is a whole record');
    cleanup(path.dirname(file));
    cleanup(w.root);
  });

  group('tower/telemetry: the incremental read');

  await test('an append is read as an append — the file is never re-read from zero', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'a', input: 100 })] });
    const first = readUsage(file);
    assertEq(first.tokens.total, 100, 'the first pass');
    const firstSize = fs.statSync(file).size;
    assertEq(first.bytesRead, firstSize, 'which read the whole file');

    fs.appendFileSync(file, `${assistantLine({ id: 'b', input: 25 })}\n`);
    const second = readUsage(file);
    assertEq(second.tokens.total, 125, 'the totals grew');
    assertEq(second.bytesRead, fs.statSync(file).size, 'and only the appended bytes were read');
    assert(second.bytesRead < firstSize * 2, 'the first pass was not paid for twice');

    const third = readUsage(file);
    assertEq(third.bytesRead, second.bytesRead, 'an unchanged file is not read at all');
    assertEq(third.tokens.total, 125, 'and answers from the stored totals');
    cleanup(w.root);
  });

  await test('a truncated or rewritten file is read again from zero', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [assistantLine({ id: 'a', input: 100 }), assistantLine({ id: 'b', input: 100 })],
    });
    assertEq(readUsage(file).tokens.total, 200, 'both lines');

    // Rewritten SHORTER — the stored offset now points past the end.
    fs.writeFileSync(file, `${assistantLine({ id: 'c', input: 7 })}\n`);
    const after = readUsage(file);
    assertEq(after.tokens.total, 7, 'the old totals were discarded, not added to');
    assertEq(after.bytesRead, fs.statSync(file).size, 'and the new file was read whole');
    cleanup(w.root);
  });

  await test('a file rewritten to the SAME size with an older mtime restarts too', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'aaa', input: 100 })] });
    assertEq(readUsage(file).tokens.total, 100, 'read once');
    fs.writeFileSync(file, `${assistantLine({ id: 'bbb', input: 100 })}\n`);
    const back = (Date.now() - 60 * 60 * 1000) / 1000;
    fs.utimesSync(file, back, back);
    assertEq(readUsage(file).tokens.total, 100, 'the same size, but a different file');
    cleanup(w.root);
  });

  await test('a line split across an append boundary is counted once it completes', () => {
    const w = mkWorld();
    const whole = assistantLine({ id: 'split', input: 60 });
    const file = mkSession(w, { lines: [] });
    fs.writeFileSync(file, whole.slice(0, 40));
    assertEq(readUsage(file).tokens.total, 0, 'half a record is no record');
    fs.appendFileSync(file, `${whole.slice(40)}\n`);
    assertEq(readUsage(file).tokens.total, 60, 'the held fragment joined its tail');
    cleanup(w.root);
  });

  await test('resetCache forgets every file, so a fixture path is never reused stale', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'a', input: 100 })] });
    readUsage(file);
    resetCache();
    assertEq(readUsage(file).bytesRead, fs.statSync(file).size, 'read whole again');
    cleanup(w.root);
  });

  await test('a collection pass forgets the transcripts it no longer names', () => {
    const w = mkWorld();
    const staying = mkSession(w, { pid: 7001, session: 'sess-stays', lines: [assistantLine({ id: 'a', input: 10 })] });
    const going = mkSession(w, { pid: 7002, session: 'sess-goes', lines: [assistantLine({ id: 'b', input: 20 })] });
    const sub = mkSubagent(going, 'gone', { lines: [assistantLine({ id: 'c', input: 30 })], meta: {} });

    collect(w);
    assert(cachedPaths().includes(going), 'the first pass held the session it read');
    assert(cachedPaths().includes(sub), 'and its subagent');

    // The session ends: its marker is gone, so the second pass never names it.
    fs.rmSync(path.join(w.markerDir, '7002'));
    collect(w);
    assert(!cachedPaths().includes(going), 'the finished session is forgotten');
    assert(!cachedPaths().includes(sub), 'and so is its subagent');
    assert(cachedPaths().includes(staying), 'the session still running keeps its read state');
    cleanup(w.root);
  });

  group('tower/telemetry: cost');

  await test('a known model prices per million tokens, each counter at its own rate', () => {
    const rate = PRICING[PRICED];
    const cost = costOf(PRICED, {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheCreation: 1000000,
    });
    assertEq(cost, rate.input + rate.output + rate.cacheRead + rate.cacheCreation, 'a million of each is one rate each');
    assertEq(costOf(`${PRICED}-20250805`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), rate.input, 'a dated build is the same model');
    assertEq(costOf(`${PRICED}[1m]`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), rate.input, 'and so is a context variant');
  });

  await test('an unknown model prices null, never zero, and still reports its tokens', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'x', model: 'claude-from-the-future', input: 500, output: 10 })] });
    const usage = readUsage(file);
    assertEq(usage.tokens.total, 510, 'the tokens are known even when the price is not');
    assertEq(usage.cost, null, 'and the price says so rather than claiming free');
    assertEq(costOf(null, { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }), null, 'no model at all is null too');
    cleanup(w.root);
  });

  await test('one unpriced line makes the whole file unpriced — never a partial total', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'p', model: PRICED, input: 1000000 }),
        assistantLine({ id: 'u', model: 'claude-from-the-future', input: 1000000 }),
      ],
    });
    assertEq(readUsage(file).cost, null, 'an under-count would read as a real number');
    cleanup(w.root);
  });

  await test('an unpriced line that spent NOTHING does not make the file unpriced', () => {
    const w = mkWorld();
    // Claude Code writes `<synthetic>` lines with an all-zero usage block for
    // messages it generated locally. One of those must not turn a fully priced
    // session's cost to null — zero tokens cost zero at any rate.
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'p', model: PRICED, input: 1000000 }),
        assistantLine({ id: 'z', model: '<synthetic>' }),
      ],
    });
    assertEq(readUsage(file).cost, PRICING[PRICED].input, 'the real spend is still reported');
    cleanup(w.root);
  });

  await test('claude-opus-5 is priced, so the model everything runs on reports a cost', () => {
    assertEq(costOf('claude-opus-5', {
      input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0,
    }), 5, 'input at $5 per million');
    assertEq(costOf('claude-opus-5[1m]', {
      input: 0, output: 1000000, cacheRead: 0, cacheCreation: 0,
    }), 25, 'output at $25, context variant and all');
  });

  await test('every row derives its three cache rates from its own input rate', () => {
    // Rounded, because 3 * 0.1 is 0.30000000000000004 in binary floating point
    // and the table carries the rate a human would write.
    const near = (n) => Math.round(n * 1e6);
    // claude-3-haiku is the one row taken from published cache rates instead,
    // and they do NOT follow the multipliers — $0.03 against a derived $0.025.
    // The published number is what gets billed, so the table keeps it and this
    // check names the exception rather than bending the rate to fit.
    const published = new Set(['claude-3-haiku']);
    for (const [model, rate] of Object.entries(PRICING)) {
      assertEq(near(rate.cacheCreation1h), near(rate.input * 2), `${model}: a 1-hour cache write is 2x input`);
      if (published.has(model)) continue;
      assertEq(near(rate.cacheRead), near(rate.input * 0.1), `${model}: a cache read is 0.1x input`);
      assertEq(near(rate.cacheCreation), near(rate.input * 1.25), `${model}: and a 5-minute cache write 1.25x`);
    }
    assertEq(PRICING['claude-3-haiku'].cacheRead, 0.03, 'the published rate, not the derived 0.025');
  });

  await test('the models the crew actually runs on are all priced', () => {
    // Every model seen in a live transcript on this machine. A gap here is the
    // Usage page's cost column going empty for whoever is running that model.
    for (const model of ['claude-opus-5', 'claude-fable-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      assert(costOf(model, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }) > 0, `${model} has a rate`);
    }
    assertEq(PRICING['claude-sonnet-5'].input, 3, 'sonnet-5 carries the STANDARD rate, not the promotion through 2026-08-31');
  });

  await test('a cache write is priced by its TTL — 1.25x input at 5 minutes, 2x at an hour', () => {
    const rate = PRICING['claude-opus-5'];
    // The whole write at each TTL, so the two rates are visible on their own.
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 0,
    }), rate.cacheCreation, 'all five-minute');
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 1000000,
    }), rate.cacheCreation1h, 'all one-hour');
    // A block carrying no split at all is the legacy shape and stays at 5m.
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000,
    }), rate.cacheCreation, 'no split named, so the default TTL');
  });

  await test('a transcript carrying both TTL counters blends the two rates', () => {
    const w = mkWorld();
    const rate = PRICING['claude-opus-5'];
    const file = mkSession(w, {
      lines: [
        assistantLine({
          id: 'blend', model: 'claude-opus-5', cacheCreation: 1000000, ttl5: 400000, ttl1h: 600000,
        }),
      ],
    });
    const usage = readUsage(file);
    assertEq(usage.tokens.cacheCreation, 1000000, 'the counter stays ONE total — the contract is untouched');
    assertEq(usage.tokens.total, 1000000, 'and so does the token total');
    assertEq(usage.cost, 0.4 * rate.cacheCreation + 0.6 * rate.cacheCreation1h, 'the cost carries the split');
    cleanup(w.root);
  });

  await test('the legacy shape, with only the total and no split, prices at five minutes', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [assistantLine({ id: 'legacy', model: 'claude-opus-5', cacheCreation: 1000000 })],
    });
    assertEq(readUsage(file).cost, PRICING['claude-opus-5'].cacheCreation, 'the default TTL');
    cleanup(w.root);
  });

  group('tower/telemetry: subagent attribution');

  await test('a subagent is attributed to its class through the parent tool_use', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 'spawn', toolUseId: 'toolu_1', subagentType: 'workkit:worker' }),
        assistantLine({ id: 'root', input: 30 }),
      ],
    });
    mkSubagent(transcript, 'aaa', {
      lines: [assistantLine({ id: 's1', input: 200, output: 40 })],
      meta: { agentType: 'workkit:worker', toolUseId: 'toolu_1', spawnDepth: 1 },
    });
    const [session] = collect(w).sessions;
    assertEq(session.subagents.length, 1, 'one subagent');
    assertEq(session.subagents[0].id, 'agent-aaa', 'named by its file');
    assertEq(session.subagents[0].class, 'worker', 'the namespace is stripped');
    assertEq(session.subagents[0].tokens.total, 240, 'with its own tokens');
    assertEq(session.tokens.total, 30, 'and the parent keeps only its own');
    cleanup(w.root);
  });

  await test('the sidecar answers when the parent line is gone, and neither reads unknown', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'bbb', {
      lines: [assistantLine({ id: 's', input: 10 })],
      meta: { agentType: 'workkit:scout', toolUseId: 'toolu_compacted_away' },
    });
    mkSubagent(transcript, 'ccc', { lines: [assistantLine({ id: 't', input: 10 })], meta: null });
    const classes = Object.fromEntries(collect(w).sessions[0].subagents.map((s) => [s.id, s.class]));
    assertEq(classes['agent-bbb'], 'scout', 'the meta carries the same value');
    assertEq(classes['agent-ccc'], 'unknown', 'and nothing at all is never a guess');
    assertEq(className('general-purpose'), 'general-purpose', 'an unnamespaced type passes through');
    cleanup(w.root);
  });

  await test('byClass credits the root session to manager and each subagent to its class', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's1', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        spawnLine({ id: 's2', toolUseId: 'toolu_s', subagentType: 'workkit:scout' }),
        assistantLine({ id: 'root', input: 1000 }),
      ],
    });
    mkSubagent(transcript, 'w1', { lines: [assistantLine({ id: 'a', input: 500 })], meta: { toolUseId: 'toolu_w' } });
    mkSubagent(transcript, 's1', { lines: [assistantLine({ id: 'b', input: 100 })], meta: { toolUseId: 'toolu_s' } });
    const { byClass } = collect(w);
    assertEq(byClass.manager, 1000, 'the session drives, so it is the manager');
    assertEq(byClass.worker, 500, 'the worker');
    assertEq(byClass.scout, 100, 'the scout');
    cleanup(w.root);
  });

  await test('a subagent is working while its transcript is fresh and done once it goes quiet', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const at = (minutesAgo) => new Date(now - minutesAgo * 60 * 1000).toISOString();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1, timestamp: at(1) })] });
    mkSubagent(transcript, 'fresh', { lines: [assistantLine({ id: 'f', input: 10, timestamp: at(2) })], meta: {} });
    mkSubagent(transcript, 'quiet', { lines: [assistantLine({ id: 'q', input: 10, timestamp: at(180) })], meta: {} });
    mkSubagent(transcript, 'silent', { lines: [], meta: {} });

    const states = Object.fromEntries(collect(w, { now }).sessions[0].subagents.map((s) => [s.id, s.state]));
    assertEq(states['agent-fresh'], 'working', 'two minutes quiet is still working');
    assertEq(states['agent-quiet'], 'done', 'three hours quiet is finished');
    assertEq(states['agent-silent'], 'done', 'one that never spoke is not live crew');
    cleanup(w.root);
  });

  await test('the subagent window is the SAME one sessions.js reads, override and all', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'edge', {
      lines: [assistantLine({ id: 'e', input: 10, timestamp: new Date(now - 60 * 60 * 1000).toISOString() })],
      meta: {},
    });
    // An hour quiet: outside the 45-minute default, inside a widened window.
    assertEq(collect(w, { now }).sessions[0].subagents[0].state, 'done', 'the default window closed on it');
    resetCache();
    assertEq(collect(w, { now, idleMinutes: 120 }).sessions[0].subagents[0].state, 'working', 'the override moves both tiers');
    cleanup(w.root);
  });

  group('tower/telemetry: the whole payload');

  await test('byModel counts tokens per model across the session and its subagents', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'r', model: PRICED, input: 100 })] });
    mkSubagent(transcript, 'x', {
      lines: [assistantLine({ id: 'a', model: 'claude-haiku-4-5', input: 20 })],
      meta: { agentType: 'workkit:scout' },
    });
    const { byModel } = collect(w);
    assertEq(byModel[PRICED], 100, 'the parent model');
    assertEq(byModel['claude-haiku-4-5'], 20, 'and the subagent model');
    cleanup(w.root);
  });

  await test('overTime is 30 days ending today, quiet days present with zero', () => {
    const w = mkWorld();
    const now = Date.now();
    const today = dayKey(new Date(now));
    const threeAgo = dayKey(new Date(now - 3 * 24 * 60 * 60 * 1000));
    const longAgo = dayKey(new Date(now - 200 * 24 * 60 * 60 * 1000));
    mkSession(w, {
      lines: [
        assistantLine({ id: 'a', input: 10, timestamp: new Date(now).toISOString() }),
        assistantLine({ id: 'b', input: 5, timestamp: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }),
        assistantLine({ id: 'c', input: 999, timestamp: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString() }),
      ],
    });
    const { overTime } = collect(w, { now });
    assertEq(overTime.length, OVERTIME_DAYS, 'thirty entries');
    assertEq(overTime[overTime.length - 1].label, today, 'ending today');
    const byLabel = Object.fromEntries(overTime.map((d) => [d.label, d.tokens]));
    assertEq(byLabel[today], 10, "today's tokens");
    assertEq(byLabel[threeAgo], 5, 'three days back');
    assertEq(byLabel[longAgo], undefined, 'and nothing older than the window');
    assertEq(overTime.filter((d) => d.tokens === 0).length, OVERTIME_DAYS - 2, 'every quiet day is present at zero');
    cleanup(w.root);
  });

  await test('a session row carries the marker facts, the statusline pair and its span', () => {
    const w = mkWorld();
    fs.writeFileSync(path.join(w.stateDir, 'sess_1.json'), JSON.stringify({
      model: { id: 'claude-opus-4-1' },
      effort: { level: 'high' },
    }));
    mkSession(w, {
      lines: [
        JSON.stringify({ type: 'summary', customTitle: 'The tower build' }),
        assistantLine({ id: 'a', input: 10, timestamp: '2026-07-27T09:00:00.000Z' }),
        assistantLine({ id: 'b', input: 10, timestamp: '2026-07-27T11:00:00.000Z' }),
      ],
    });
    const [session] = collect(w).sessions;
    assertEq(session.id, 'sess-1', 'the session id');
    assertEq(session.cwd, '/x/fixture', 'its cwd');
    assertEq(session.chatName, 'The tower build', 'its name');
    assertEq(session.state, 'working', 'a live assertion and a fresh transcript');
    assertEq(session.model, 'claude-opus-4-1', 'model from the statusline cache');
    assertEq(session.effort, 'high', 'and effort with it');
    assertEq(session.startedAt, '2026-07-27T09:00:00.000Z', 'the first stamp');
    assertEq(session.lastAt, '2026-07-27T11:00:00.000Z', 'and the last');
    assert(session.cost > 0, 'a priced model reports a cost');
    cleanup(w.root);
  });

  await test('a row says what it last reached for, where its transcript is, and the file times', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        assistantLine({
          id: 'r',
          input: 5,
          timestamp: '2026-07-27T12:30:00.000Z',
          content: [{ type: 'tool_use', id: 'toolu_r', name: 'Read', input: { file_path: '/x/a.js' } }],
        }),
      ],
    });
    const sub = mkSubagent(transcript, 'k1', {
      lines: [assistantLine({
        id: 'w1',
        input: 3,
        timestamp: '2026-07-27T12:31:00.000Z',
        content: [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: {} }],
      })],
      meta: { toolUseId: 'toolu_w' },
    });
    const [session] = collect(w).sessions;
    assertEq(session.lastTool, 'Read', 'the last tool_use in the parent transcript, not the first');
    assertEq(session.lastToolAt, '2026-07-27T12:30:00.000Z', 'stamped when the line was written');
    assertEq(session.transcript, transcript, 'the file every one of these was read from');
    assert(typeof session.lastActivity === 'number', 'listSessions\' mtime probe travels');
    assert(typeof session.aliveSince === 'number', 'and its birth time');
    const [agent] = session.subagents;
    assertEq(agent.lastTool, 'Edit', 'a subagent says its own last tool');
    assertEq(agent.lastToolAt, '2026-07-27T12:31:00.000Z', 'with its own stamp');
    assertEq(agent.transcript, sub, 'and carries its own transcript path');
    cleanup(w.root);
  });

  await test('a transcript that has called no tool says so with a null, never a guess', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 1 })] });
    const [session] = collect(w).sessions;
    assertEq(session.lastTool, null, 'nothing was called');
    assertEq(session.lastToolAt, null, 'so there is no when either');
    cleanup(w.root);
  });

  await test('with no statusline cache the model comes from the transcript instead', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', model: 'claude-sonnet-4-5', input: 1 })] });
    assertEq(collect(w).sessions[0].model, 'claude-sonnet-4-5', 'a VS Code session still names one');
    cleanup(w.root);
  });

  await test('no markers at all is an empty payload, still the right shape', () => {
    const w = mkWorld();
    const payload = collect(w);
    assertEq(payload.sessions.length, 0, 'nobody running');
    assertEq(Object.keys(payload.byModel).length, 0, 'no models');
    assertEq(payload.overTime.length, OVERTIME_DAYS, 'the series is always thirty long');
    cleanup(w.root);
  });

  await test('sessionTelemetry finds one by id and answers null for anything else', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 42 })] });
    const opts = { home: w.home, markerDir: w.markerDir, stateDir: w.stateDir, exec: w.exec };
    assertEq(sessionTelemetry('sess-1', opts).tokens.total, 42, 'the drill-down');
    assertEq(sessionTelemetry('sess-nope', opts), null, 'and nothing invented');
    cleanup(w.root);
  });

  group('tower/telemetry: the endpoints');

  await test('/api/telemetry serves the whole payload through the real server', async () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        assistantLine({ id: 'r', input: 100, output: 10 }),
      ],
    });
    mkSubagent(transcript, 'w1', { lines: [assistantLine({ id: 'a', input: 60 })], meta: { toolUseId: 'toolu_w' } });
    const c = await listen(createServer({
      root: path.join(w.root, 'no-repos'),
      workflowHome: path.join(w.root, 'workflow-home'),
      home: w.home,
      markerDir: w.markerDir,
      stateDir: w.stateDir,
      exec: w.exec,
    }));
    const { status, body } = await getJson(c, '/api/telemetry');
    assertEq(status, 200, 'ok');
    assertEq(body.sessions.length, 1, 'one session');
    assertEq(body.sessions[0].tokens.total, 110, 'its own tokens');
    assertEq(body.sessions[0].subagents[0].class, 'worker', 'with its crew attributed');
    assertEq(body.byClass.manager, 110, 'byClass is there');
    assertEq(body.overTime.length, OVERTIME_DAYS, 'and the series');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/telemetry/<id> drills into one session, and an unknown id is a 404', async () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'r', input: 77 })] });
    const c = await listen(createServer({
      root: path.join(w.root, 'no-repos'),
      workflowHome: path.join(w.root, 'workflow-home'),
      home: w.home,
      markerDir: w.markerDir,
      stateDir: w.stateDir,
      exec: w.exec,
    }));
    const found = await getJson(c, '/api/telemetry/sess-1');
    assertEq(found.status, 200, 'ok');
    assertEq(found.body.id, 'sess-1', 'the session object itself, not a list');
    assertEq(found.body.tokens.total, 77, 'with its tokens');

    const missing = await getJson(c, '/api/telemetry/sess-nope');
    assertEq(missing.status, 404, 'no such session');
    assertEq(missing.body.ok, false, 'the soft shape everywhere');
    assert(/no such session/.test(missing.body.reason), 'the reason names it');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
