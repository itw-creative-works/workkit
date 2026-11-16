// Tests for the event line a case inside another program reports by (workkit-core's
// `eventLine` and `parseEventLine`): `__WORKKIT_TEST__` then one JSON object, on one line.

const vm = require('vm');
const {
  describe, test, expect, eventLine, parseEventLine,
} = require('./lib/harness');

// The line and paragraph separators a JavaScript reader may break a line on.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LINE_BREAK = new RegExp(`[\r\n${LS}${PS}]`);

const FAILED = {
  id: 'a',
  name: 'alpha',
  status: 'failed',
  durationMs: 12,
  error: { message: `expected 1\nto be${LS}2${PS}`, stack: 'Error: expected 1\n    at page.js:3:9\r\n    at page.js:7:1' },
};
const SKIPPED = {
  id: 'b', name: 'beta', status: 'skipped', durationMs: 0, reason: 'no board here',
};

describe('eventLine and parseEventLine', () => {
  test('an event with every field comes back equal, on a line with no line break', () => {
    for (const event of [FAILED, SKIPPED]) {
      const line = eventLine(event);
      expect(LINE_BREAK.test(line), `no line break in: ${line}`).toBe(false);
      expect(parseEventLine(line)).toEqual(event);
    }
  });

  test('eventLine\'s text called in a bare realm gives a line the host reads back', () => {
    const realm = vm.createContext({});
    const line = vm.runInContext(`(${eventLine.toString()})(${JSON.stringify(FAILED)})`, realm);
    expect(parseEventLine(line)).toEqual(FAILED);
  });

  test('a line without the prefix gives null', () => {
    for (const line of ['starting the app', '{"id":"a","name":"alpha","status":"passed","durationMs":1}']) {
      expect(parseEventLine(line), `for: ${line}`).toBeNull();
    }
  });

  test('a prefixed line with broken JSON, no id or an unknown status throws naming the line', () => {
    const lines = [
      '__WORKKIT_TEST__{"id":"a",',
      '__WORKKIT_TEST__{"name":"alpha","status":"passed","durationMs":1}',
      '__WORKKIT_TEST__{"id":"a","name":"alpha","status":"done","durationMs":1}',
    ];
    for (const line of lines) expect(() => parseEventLine(line), `for: ${line}`).toThrow(line);
  });

  test('a prefixed failed line with no error message throws naming the line', () => {
    const lines = [
      '__WORKKIT_TEST__{"id":"a","name":"alpha","status":"failed","durationMs":1}',
      '__WORKKIT_TEST__{"id":"a","name":"alpha","status":"failed","durationMs":1,"error":{"stack":"at page.js:3:9"}}',
    ];
    for (const line of lines) expect(() => parseEventLine(line), `for: ${line}`).toThrow(line);
  });
});
