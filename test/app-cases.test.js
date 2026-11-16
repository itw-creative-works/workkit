// Tests for the host session (workkit-core's `appCases`): a suite lists its in-app
// cases, its drive starts a plain Node child printing event lines, and the kit's
// runner shows each in-app case as one case, plus the session's own `app session`.

const path = require('path');
const {
  describe, test, expect, appCases,
} = require('./lib/harness');
const {
  linesOf, marksOf, totalsOf, failuresOf,
} = require('./lib/run-lists');
const { HARNESS, SUITE, mkWorld } = require('./lib/runner-world');

// An event line as any program prints one.
const wire = (event) => `__WORKKIT_TEST__${JSON.stringify(event)}`;
const passed = (id, name) => wire({
  id, name, status: 'passed', durationMs: 1,
});
const A = passed('a', 'alpha');
const B = passed('b', 'beta');

// The case list every host suite hands appCases, as the suite's text spells it.
const CASES = "[{ id: 'a', name: 'alpha' }, { id: 'b', name: 'beta' }]";

// The host suite: cases a (alpha) and b (beta), its drive starting app.js and
// handing each stdout line on; `after` runs once the child is done, and `place`
// sets the appCases call in the suite (the top level when not given).
const HOST = (after = '', place = (call) => call) => SUITE(`
const readline = require('readline');
const path = require('path');
const { appCases, start } = require(${JSON.stringify(HARNESS)});
const drive = async (onLine) => {
  const app = start(process.execPath, [path.join(__dirname, '..', 'app.js')]);
  readline.createInterface({ input: app.child.stdout }).on('line', onLine);
  await app.done;
  ${after}
};
${place(`appCases(${CASES}, drive);`)}
`);

// The kit's runner over the host suite `suite`, with `files` written beside it.
const runHost = (suite, files = {}) => {
  const w = mkWorld();
  w.write({ 'test/x.test.js': suite, ...files });
  return w.run([path.join('test', 'x.test.js')]);
};

// A suite with a plain case beside a host whose drive adds one line to the file
// `drove` at the root each time it is called, then reports a and b.
const MIXED_HOST = SUITE(`
const fs = require('fs');
const path = require('path');
const { appCases } = require(${JSON.stringify(HARNESS)});
test('plain', () => {});
appCases(${CASES}, async (onLine) => {
  fs.appendFileSync(path.join(__dirname, '..', 'drove'), 'drove\\n');
  onLine(${JSON.stringify(A)});
  onLine(${JSON.stringify(B)});
});
`);

// The kit's runner over MIXED_HOST under `--filter=<filter>`, with what `drove` holds after.
const runFiltered = (filter) => {
  const w = mkWorld();
  w.write({ 'test/x.test.js': MIXED_HOST });
  return { ...w.run([`--filter=${filter}`]), drove: w.read('drove') };
};

// The kit's runner over HOST, its child printing `lines` in order.
const runApp = (lines, after, place) => runHost(HOST(after, place), {
  'app.js': `for (const line of ${JSON.stringify(lines)}) console.log(line);\n`,
});

// A host whose child prints the line for a, then waits on its stdin, which the
// drive closes only once the case alpha has settled; the child then prints b's.
const WAITING_HOST = SUITE(`
const readline = require('readline');
const path = require('path');
const { appCases, afterEach } = require(${JSON.stringify(HARNESS)});
const { spawn } = require(${JSON.stringify(path.join(__dirname, 'lib', 'platform.js'))});
const alphaSettled = Promise.withResolvers();
afterEach((t) => { if (t.name === 'alpha') alphaSettled.resolve(); });
const drive = async (onLine) => {
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: app.stdout }).on('line', onLine);
  const closed = new Promise((resolve) => { app.once('close', resolve); });
  await alphaSettled.promise;
  app.stdin.end();
  await closed;
};
appCases(${CASES}, drive);
`);
const WAITING_APP = `console.log(${JSON.stringify(A)});
process.stdin.on('end', () => console.log(${JSON.stringify(B)}));
process.stdin.resume();
`;

// A host with a 300 ms limit whose drive reports a, then holds until the case
// beta has settled, so it outlasts that limit and ends right after it.
const LIMITED_HOST = SUITE(`
const { appCases, afterEach } = require(${JSON.stringify(HARNESS)});
const betaSettled = Promise.withResolvers();
afterEach((t) => { if (t.name === 'beta') betaSettled.resolve(); });
appCases(${CASES}, async (onLine) => {
  onLine(${JSON.stringify(A)});
  await betaSettled.promise;
}, { timeout: 300 });
`);

describe('appCases: each in-app case is one case of the run', () => {
  test('a passed line for a and b: a case by each name, both passed, and app session passes', () => {
    const { code, output } = runApp(['booting', A, B]);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✓ app session']);
    expect(totalsOf(output).startsWith('3 passed, 0 failed'), `got: ${output}`).toBe(true);
  });

  test('a failed line for b with a message: b fails, and the failure list names b with it', () => {
    const failed = wire({
      id: 'b', name: 'beta', status: 'failed', durationMs: 3, error: { message: 'the widget broke', stack: 'Error: the widget broke\n    at page.js:4:2' },
    });
    const { code, output } = runApp([A, failed]);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toContain('✗ beta');
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › beta: the widget broke');
  });

  test('a skipped line for b with a reason: b is skipped, and the skip list names it with the reason', () => {
    const skipped = wire({
      id: 'b', name: 'beta', status: 'skipped', durationMs: 0, reason: 'no board here',
    });
    const { code, output } = runApp([A, skipped]);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toContain('⊘ beta: no board here');
    expect(linesOf(output).some((line) => line.includes('test/x.test.js › beta: no board here')), `the skip list, got: ${output}`).toBe(true);
  });

  test('the child ends with no line for b: b fails with no event reported for b', () => {
    const { code, output } = runApp([A]);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toContain('✗ beta');
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › beta: no event reported for b');
  });

  test('ordinary lines among the event lines change nothing', () => {
    const { code, output } = runApp(['starting the app', A, '', '{"id":"b","name":"beta","status":"failed","durationMs":1}', B, 'done']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✓ app session']);
  });

  test('a passed line for b before the one for a: both pass, in the list\'s order', () => {
    const { code, output } = runApp([B, A]);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✓ app session']);
  });
});

describe('appCases: the app session case names each fault', () => {
  test('two lines for a: app session fails naming a reported twice', () => {
    const { code, output } = runApp([A, A, B]);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toContain('✗ app session');
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › app session');
    expect(failuresOf(output), `got: ${output}`).toContain('a reported twice');
  });

  test('a line for an id the list does not hold: app session fails naming event for an unknown id', () => {
    const { code, output } = runApp([A, passed('z', 'zeta'), B]);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toContain('✗ app session');
    expect(failuresOf(output), `got: ${output}`).toContain('event for an unknown id z');
  });

  test('a prefixed line that is no valid event: app session fails naming it, and the other cases still settle', () => {
    const { code, output } = runApp([A, '__WORKKIT_TEST__{"id":"b",', B]);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✗ app session']);
    expect(failuresOf(output), `got: ${output}`).toContain('not a valid event line: __WORKKIT_TEST__{"id":"b",');
  });
});

describe('appCases: a drive that rejects', () => {
  test('drive rejects before b reported: b fails with that error, and a keeps its pass', () => {
    const { code, output } = runApp([A], "throw new Error('the app crashed');");
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toContain('✓ alpha');
    expect(marksOf(output), `got: ${output}`).toContain('✗ beta');
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › beta: the app crashed');
  });

  test('drive rejects after every case reported: each case keeps its result, and app session fails with that error', () => {
    const { code, output } = runApp([A, B], "throw new Error('the app crashed');");
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✗ app session']);
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › app session: the app crashed');
  });
});

describe('appCases: when and where a case settles', () => {
  test('the child prints the line for a and then waits: a settles while drive is still running', () => {
    const { code, output } = runHost(WAITING_HOST, { 'app.js': WAITING_APP });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✓ beta', '✓ app session']);
  });

  test('options.timeout and a drive that outlasts it with no line for b: b fails by that limit, not the default one', () => {
    const { code, output } = runHost(LIMITED_HOST);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ alpha', '✗ beta', '✓ app session']);
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › beta: test timed out after 300ms');
  });

  test('appCases inside a describe: its cases and app session sit under that describe\'s name', () => {
    const failed = wire({
      id: 'b', name: 'beta', status: 'failed', durationMs: 3, error: { message: 'the widget broke' },
    });
    const { code, output } = runApp([A, A, failed], '', (call) => `describe('popup', () => { ${call} });`);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › popup › beta: the widget broke');
    expect(failuresOf(output), `got: ${output}`).toContain('test/x.test.js › popup › app session: a reported twice');
  });
});

describe('appCases: drive starts with the first case a run selects', () => {
  test('a filter selecting only the plain case, or no case at all: drive is never called', () => {
    const plain = runFiltered('plain');
    expect(plain.code, `exit 0, got: ${plain.output}`).toBe(0);
    expect(marksOf(plain.output), `got: ${plain.output}`).toEqual(['✓ plain']);
    expect(plain.drove, `drive was called, got: ${plain.output}`).toBeNull();
    const none = runFiltered('nothing-matches');
    expect(none.output, `got: ${none.output}`).toContain('No case matches nothing-matches');
    expect(none.drove, `drive was called, got: ${none.output}`).toBeNull();
  });

  test('a filter selecting one case of the host: drive is called once, and that case settles by its line', () => {
    const { code, output, drove } = runFiltered('beta');
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `got: ${output}`).toEqual(['✓ beta']);
    expect(drove, `got: ${output}`).toBe('drove\n');
  });
});

describe('appCases: a case list it cannot run throws at the call', () => {
  test('an id listed twice, or an entry with no string id and name, throws naming the fault', () => {
    const drive = async () => {};
    expect(() => appCases([{ id: 'a', name: 'alpha' }, { id: 'a', name: 'again' }], drive)).toThrow('appCases() lists the id a twice');
    for (const cases of [[{ id: 'a' }], [{ name: 'alpha' }], [{ id: 1, name: 'alpha' }]]) {
      expect(() => appCases(cases, drive), `for: ${JSON.stringify(cases)}`).toThrow('appCases() takes a list of { id, name }, each a string');
    }
  });
});
