// Tests for workflow/lib/say.js: sayAs writes its whole line, once, to a stderr
// pipe that is full when it is called, and returns once a slow reader drains it;
// lastErrLine reads the last thing a child said on stderr.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, start, until, mkTmp, needs,
} = require('../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, spawnSync } = require('../lib/platform');

const SAY = path.join(__dirname, '..', '..', 'workflow', 'lib', 'say.js');
const { lastErrLine } = require(SAY);

// Past ASCII throughout and longer than a pipe takes in one write, so a retry
// that goes on from the wrong byte cuts a character or repeats one.
const LINE = `drained ${'é✓漢'.repeat(1000)}`;

// Touches process.stderr, which sets its pipe non-blocking, writes dots to it
// until the pipe is full, says on stdout how many bytes went, then says LINE.
const CHILD = `
  const fs = require("fs");
  const { sayAs } = require(${JSON.stringify(SAY)});
  void process.stderr;
  const dots = Buffer.alloc(4096, ".");
  let burst = 0;
  for (;;) {
    try {
      burst += fs.writeSync(2, dots);
    } catch (err) {
      if (err.code !== "EAGAIN") throw err;
      break;
    }
  }
  fs.writeSync(1, burst + "\\n");
  sayAs("probe")(${JSON.stringify(LINE)});
`;

/** Every byte the fifo's read end <fd> holds now, added to <chunks>; true once its writer is gone. */
const drain = (fd, chunks) => {
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(fd, buf);
    } catch (err) {
      if (err.code === 'EAGAIN') return false;
      throw err;
    }
    if (n === 0) return true;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
};

describe('say.js: sayAs on a full stderr pipe', {
  skip: IS_WINDOWS ? 'a Windows pipe blocks its writer, so a full one never answers EAGAIN' : needs('mkfifo'),
}, () => {
  test('after a burst that fills the pipe, the line arrives whole and once when the reader drains, and the child exits 0', async (t) => {
    const fifo = path.join(mkTmp('say-'), 'stderr');
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    expect(made.status, `mkfifo ${fifo}: ${made.stderr}`).toBe(0);
    // Nothing reads this end until the child says the pipe is full.
    const fd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    t.after(() => fs.closeSync(fd));
    const child = start(BASH, [...NO_RC, '-c', 'exec "$0" -e "$1" 2>"$2"', process.execPath, CHILD, fifo]);
    t.after(() => child.end('SIGKILL'));

    expect(await until(() => /^\d+\n/.test(child.stdout())), `the child filled its stderr and said how much, got: ${child.output()}`).toBe(true);
    const burst = Number(child.stdout().split('\n')[0]);
    const chunks = [];
    expect(await until(() => drain(fd, chunks)), 'the reader drained the pipe to its close').toBe(true);
    const { status } = await child.done;

    const tail = Buffer.concat(chunks).subarray(burst).toString();
    const seen = `${tail.length} characters after the ${burst}-byte burst, starting ${JSON.stringify(tail.slice(0, 120))}`;
    expect(status, `the child's exit, sayAs throwing nothing; ${seen}`).toBe(0);
    expect(tail === `probe: ${LINE}\n`, `the line whole and once after the burst; ${seen}`).toBe(true);
  });
});

describe('say.js: lastErrLine', () => {
  test('a stderr in CRLF lines ending on a blank one: its last line with words, trimmed; none at all: the empty string', () => {
    const res = { status: 1, stderr: 'WARNING: first\r\n  ERROR: the value is incorrectly formatted.  \r\n\r\n' };
    expect(lastErrLine(res), 'the last line that says something').toBe('ERROR: the value is incorrectly formatted.');
    expect(lastErrLine({ status: 1, stderr: ' \r\n\r\n' }), 'a stderr of blank lines').toBe('');
    expect(lastErrLine({ status: null, stderr: null }), 'a child that never started').toBe('');
  });
});
