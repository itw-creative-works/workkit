//
// Tests for tower/api/lib/telemetry.js: reading usage off a transcript (the
// sums, the dedupe by message.id, the damaged and missing files) and the
// incremental read.
//
// The incremental read is asserted through `bytesRead`, which counts the bytes
// this process actually pulled off disk: a second call after an append must
// read only the appended bytes, never the file again.
// The shared prologue (the transcript line builders, the scratch world and its sessions, the collect call, the module under test) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  readUsage, resetCache, cachedPaths, mkTmp, cleanup, assistantLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

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
    // usage, and a resumed session replays its history - both must dedupe.
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

  await test('an append is read as an append - the file is never re-read from zero', () => {
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

    // Rewritten SHORTER - the stored offset now points past the end.
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
