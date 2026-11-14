//
// Tests for tower/api/lib/telemetry.js: reading usage off a transcript, and the
// incremental read (`bytesRead`: an append reads only its bytes). Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const {
  readUsage, resetCache, cachedPaths, cleanup, assistantLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

describe('tower/telemetry: reading usage', () => {
  test('usage sums across many assistant lines, and lines without a usage block are skipped', () => {
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
    expect(usage.tokens.input, 'input summed').toBe(11);
    expect(usage.tokens.output, 'output summed').toBe(7);
    expect(usage.tokens.cacheRead, 'cache reads summed').toBe(103);
    expect(usage.tokens.cacheCreation, 'cache creation summed').toBe(54);
    expect(usage.tokens.total, 'total is the four counters').toBe(175);
    cleanup(w.root);
  });

  test('one API response written as several lines is counted ONCE, by message.id', () => {
    const w = mkWorld();
    // Claude Code writes a line per content block, each repeating the same
    // usage, and a resumed session replays its history - both must dedupe.
    const line = assistantLine({ id: 'dup', input: 100, output: 20 });
    const file = mkSession(w, { lines: [line, line, assistantLine({ id: 'other', input: 1 }), line] });
    expect(readUsage(file).tokens.total, 'the repeat is not a second charge').toBe(121);
    cleanup(w.root);
  });

  test('a malformed JSON line is skipped rather than thrown, and is counted', () => {
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
    expect(usage.tokens.total, 'the readable lines still count').toBe(12);
    expect(usage.malformed, 'and the damage is reported, not hidden').toBe(2);
    cleanup(w.root);
  });

  test('a missing transcript reads zeros instead of throwing', () => {
    const w = mkWorld();
    const usage = readUsage(path.join(w.root, 'nothing-here.jsonl'));
    expect(usage.tokens.total, 'no tokens').toBe(0);
    expect(usage.cost, 'and no cost either').toBe(0);
    cleanup(w.root);
  });

  test('a final line with no trailing newline is still counted', () => {
    const w = mkWorld();
    const file = path.join(mkTmp('tower-telemetry-'), 'x.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, assistantLine({ id: 'tail', input: 42 }));
    expect(readUsage(file).tokens.total, 'a whole record is a whole record').toBe(42);
    cleanup(path.dirname(file));
    cleanup(w.root);
  });
});

describe('tower/telemetry: the incremental read', () => {
  test('an append is read as an append - the file is never re-read from zero', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'a', input: 100 })] });
    const first = readUsage(file);
    expect(first.tokens.total, 'the first pass').toBe(100);
    const firstSize = fs.statSync(file).size;
    expect(first.bytesRead, 'which read the whole file').toBe(firstSize);

    fs.appendFileSync(file, `${assistantLine({ id: 'b', input: 25 })}\n`);
    const second = readUsage(file);
    expect(second.tokens.total, 'the totals grew').toBe(125);
    expect(second.bytesRead, 'and only the appended bytes were read').toBe(fs.statSync(file).size);
    expect(second.bytesRead < firstSize * 2, 'the first pass was not paid for twice').toBeTruthy();

    const third = readUsage(file);
    expect(third.bytesRead, 'an unchanged file is not read at all').toBe(second.bytesRead);
    expect(third.tokens.total, 'and answers from the stored totals').toBe(125);
    cleanup(w.root);
  });

  test('a truncated or rewritten file is read again from zero', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [assistantLine({ id: 'a', input: 100 }), assistantLine({ id: 'b', input: 100 })],
    });
    expect(readUsage(file).tokens.total, 'both lines').toBe(200);

    // Rewritten shorter: the stored offset now points past the end.
    fs.writeFileSync(file, `${assistantLine({ id: 'c', input: 7 })}\n`);
    const after = readUsage(file);
    expect(after.tokens.total, 'the old totals were discarded, not added to').toBe(7);
    expect(after.bytesRead, 'and the new file was read whole').toBe(fs.statSync(file).size);
    cleanup(w.root);
  });

  test('a file rewritten to the SAME size with an older mtime restarts too', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'aaa', input: 100 })] });
    expect(readUsage(file).tokens.total, 'read once').toBe(100);
    fs.writeFileSync(file, `${assistantLine({ id: 'bbb', input: 100 })}\n`);
    const back = (Date.now() - 60 * 60 * 1000) / 1000;
    fs.utimesSync(file, back, back);
    expect(readUsage(file).tokens.total, 'the same size, but a different file').toBe(100);
    cleanup(w.root);
  });

  test('a line split across an append boundary is counted once it completes', () => {
    const w = mkWorld();
    const whole = assistantLine({ id: 'split', input: 60 });
    const file = mkSession(w, { lines: [] });
    fs.writeFileSync(file, whole.slice(0, 40));
    expect(readUsage(file).tokens.total, 'half a record is no record').toBe(0);
    fs.appendFileSync(file, `${whole.slice(40)}\n`);
    expect(readUsage(file).tokens.total, 'the held fragment joined its tail').toBe(60);
    cleanup(w.root);
  });

  test('resetCache forgets every file, so a fixture path is never reused stale', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'a', input: 100 })] });
    readUsage(file);
    resetCache();
    expect(readUsage(file).bytesRead, 'read whole again').toBe(fs.statSync(file).size);
    cleanup(w.root);
  });

  test('a collection pass forgets the transcripts it no longer names', () => {
    const w = mkWorld();
    const staying = mkSession(w, { pid: 7001, session: 'sess-stays', lines: [assistantLine({ id: 'a', input: 10 })] });
    const going = mkSession(w, { pid: 7002, session: 'sess-goes', lines: [assistantLine({ id: 'b', input: 20 })] });
    const sub = mkSubagent(going, 'gone', { lines: [assistantLine({ id: 'c', input: 30 })], meta: {} });

    collect(w);
    expect(cachedPaths().includes(going), 'the first pass held the session it read').toBeTruthy();
    expect(cachedPaths().includes(sub), 'and its subagent').toBeTruthy();

    // The session ends: its marker is gone, so the second pass never names it.
    fs.rmSync(path.join(w.markerDir, '7002'));
    collect(w);
    expect(!cachedPaths().includes(going), 'the finished session is forgotten').toBeTruthy();
    expect(!cachedPaths().includes(sub), 'and so is its subagent').toBeTruthy();
    expect(cachedPaths().includes(staying), 'the session still running keeps its read state').toBeTruthy();
    cleanup(w.root);
  });
});
