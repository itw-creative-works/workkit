// Tests for workflow/proof/reading.js, how `workkit proof red` reads a finished command:
// summaryOf, the counts from the kit runner's summary file (it wins when it holds anything)
// or else from node's whole summary blocks in the output; loadFailures, each module node could
// not load and the file that asked for it. Every input and every expected value is written here.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');

const { summaryOf, loadFailures } = require('../../workflow/proof/reading');

// node's eight summary lines under `prefix`, in node's order.
const block = (prefix, { tests, pass, fail, cancelled = 0, skipped = 0 }) => [
  `tests ${tests}`, 'suites 0', `pass ${pass}`, `fail ${fail}`, `cancelled ${cancelled}`, `skipped ${skipped}`, 'todo 0', 'duration_ms 41.5',
].map((line) => `${prefix}${line}`).join('\n');

// A summary file holding `text`, in a scratch folder of its own.
const summaryFile = (text) => {
  const file = path.join(mkTmp('proof-reading-'), 'summary');
  fs.writeFileSync(file, text);
  return file;
};
const NO_FILE = () => path.join(mkTmp('proof-reading-'), 'summary');

describe('summaryOf: the runner\'s summary file', () => {
  test('its lines summed, a test being a pass or a failure; it wins over a block in the output', async () => {
    const file = summaryFile('{"passed":3,"failed":1}\n{"passed":2,"failed":0}\n');
    const out = `${block('# ', { tests: 9, pass: 9, fail: 0 })}\n`;
    expect(await summaryOf({ out, err: '', file })).toEqual({ tests: 6, failed: 1 });
  });

  test('an empty file, or none, leaves the output to decide', async () => {
    const out = `${block('# ', { tests: 2, pass: 1, fail: 1 })}\n`;
    expect(await summaryOf({ out, err: '', file: summaryFile('') }), 'an empty file').toEqual({ tests: 2, failed: 1 });
    expect(await summaryOf({ out, err: '', file: NO_FILE() }), 'no file').toEqual({ tests: 2, failed: 1 });
  });
});

describe('summaryOf: node\'s summary blocks', () => {
  test('a tap block on stdout and a spec block on stderr are summed, fail and cancelled both failed, CR line ends read', async () => {
    const out = `ok 1 - x\n${block('# ', { tests: 3, pass: 2, fail: 1 }).replace(/\n/g, '\r\n')}\r\n`;
    const err = `noise\n${block('ℹ ', { tests: 4, pass: 2, fail: 0, cancelled: 2 })}\n`;
    expect(await summaryOf({ out, err, file: NO_FILE() })).toEqual({ tests: 7, failed: 3 });
  });

  test('a fragment, an indented block and a block mixing its prefixes count nothing: null', async () => {
    const whole = block('# ', { tests: 5, pass: 5, fail: 0 });
    const fragment = whole.split('\n').slice(0, 7).join('\n');
    const indented = whole.split('\n').map((line) => `  ${line}`).join('\n');
    const mixed = whole.split('\n').map((line, i) => (i === 3 ? line.replace('# ', 'ℹ ') : line)).join('\n');
    expect(await summaryOf({ out: `${fragment}\nnext\n${indented}\n`, err: `${mixed}\n`, file: NO_FILE() })).toBeNull();
  });

  test('no file and no block: null', async () => {
    expect(await summaryOf({ out: 'all good\n', err: '', file: NO_FILE() })).toBeNull();
  });
});

describe('loadFailures', () => {
  test('each Cannot find module or package line, its spec and the file that asked, in order: CommonJS through its require stack, ESM through imported from, under a tap prefix and CR ends', async () => {
    const out = [
      "Error: Cannot find module '../src/x'",
      'Require stack:',
      '- /w/copy/tests/x.test.js',
      '- /w/copy/node_modules/runner/index.js',
    ].join('\n');
    const err = [
      "#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dep' imported from /w/copy/src/a.mjs\r",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/w/copy/src/y.mjs' imported from /w/copy/tests/y.test.mjs",
    ].join('\n');
    expect(await loadFailures({ out: `${out}\n`, err: `${err}\n` })).toEqual([
      { spec: '../src/x', from: '/w/copy/tests/x.test.js' },
      { spec: 'dep', from: '/w/copy/src/a.mjs' },
      { spec: '/w/copy/src/y.mjs', from: '/w/copy/tests/y.test.mjs' },
    ]);
  });

  test('a failure that names no requiring file: its spec, with no from', async () => {
    const found = await loadFailures({ out: "Error: Cannot find module 'ghost'\nsomething else\n", err: '' });
    expect(found.map((f) => f.spec), 'the one spec').toEqual(['ghost']);
    expect(found[0].from, 'no requiring file').toBeFalsy();
  });

  test('output with no such line: none', async () => {
    expect(await loadFailures({ out: 'ok 1 - x\n', err: 'a warning\n' })).toEqual([]);
  });
});
