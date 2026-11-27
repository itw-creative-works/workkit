// Tests for workflow/lib/bounded.js: a program run to its end or to its bound,
// its streams kept apart and together, the whole tree ended at the bound, and a
// command that cannot start. Each program is a small node stand-in. Then the
// rule a wait's variable is read by, nonNegativeOf.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn,
} = require('../lib/harness');
const { jsPath } = require('../lib/platform');
const { bounded, nonNegativeOf } = require('../../workflow/lib/bounded');

// The stand-in's module, named apart from the import shape so run-home's check never reads it as this file's own.
const CP = 'child_process';

/** A node stand-in at `<dir>/<name>.js` holding `lines`. */
const program = (dir, name, lines) => {
  const file = path.join(dir, `${name}.js`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};

describe('bounded', () => {
  test('a program that ends: its code, each stream alone, both together, not timed out', async () => {
    const dir = mkTmp('lib-bounded-');
    const file = program(dir, 'ends', [
      "process.stdout.write('the out line\\n');",
      "process.stderr.write('the err line\\n');",
      'process.exitCode = 3;',
    ]);
    const res = await bounded(process.execPath, [file], { bound: 60000 });
    expect(res.status, `its own code, got: ${JSON.stringify(res)}`).toBe(3);
    expect(res.stdout, 'stdout alone').toBe('the out line\n');
    expect(res.stderr, 'stderr alone').toBe('the err line\n');
    expect(res.output.includes('the out line\n') && res.output.includes('the err line\n'), `output holds both, got: ${JSON.stringify(res.output)}`).toBe(true);
    expect(res.timedOut, 'not timed out').toBe(false);
  });

  test('a program that outlives the bound, with a child that would too: 124, timed out, and the whole tree ended', async () => {
    const dir = mkTmp('lib-bounded-');
    const parentPid = path.join(dir, 'parent.pid');
    const childPid = path.join(dir, 'child.pid');
    const child = program(dir, 'child', [
      `require('fs').writeFileSync(${jsPath(childPid)}, String(process.pid));`,
      'setInterval(() => {}, 1000);',
    ]);
    const parent = program(dir, 'parent', [
      `require('fs').writeFileSync(${jsPath(parentPid)}, String(process.pid));`,
      `require(${JSON.stringify(CP)}).spawn(process.execPath, [${jsPath(child)}], { stdio: 'ignore' });`,
      'setInterval(() => {}, 1000);',
    ]);
    const res = await bounded(process.execPath, [parent], { bound: 3000 });
    expect(res.status, `the bound's code, got: ${JSON.stringify(res)}`).toBe(124);
    expect(res.timedOut, 'timed out').toBe(true);
    const pids = [pidIn(parentPid), pidIn(childPid)];
    expect(pids.every((pid) => pid > 0), `both started before the bound, got: ${pids}`).toBe(true);
    expect(await until(() => pids.every((pid) => !alive(pid))), `the program and its child are both gone: ${pids.filter(alive)}`).toBe(true);
  });

  test('no usable bound: a TypeError naming the value, before anything is started', async () => {
    const dir = mkTmp('lib-bounded-');
    const marker = path.join(dir, 'started');
    const file = program(dir, 'marks', [`require('fs').writeFileSync(${jsPath(marker)}, '');`]);
    for (const [what, options, shown] of [
      ['left out', {}, 'undefined'],
      ['0', { bound: 0 }, '0'],
      ['negative', { bound: -5 }, '-5'],
      ['NaN', { bound: NaN }, 'NaN'],
      ['a string', { bound: '1000' }, '1000'],
    ]) {
      let caught = null;
      try {
        await bounded(process.execPath, [file], options);
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof TypeError, `${what}: a TypeError, got: ${caught}`).toBe(true);
      expect(caught.message, `${what}: the message`).toBe(`bounded: bound must be a positive number of milliseconds, got ${shown}`);
    }
    expect(fs.existsSync(marker), 'the program never ran').toBe(false);
  });

  test('a command that does not exist: 127, and the command named with the reason in stderr and output', async () => {
    const command = 'lib-bounded-no-such-command';
    const res = await bounded(command, [], { bound: 60000 });
    expect(res.status, `127, got: ${JSON.stringify(res)}`).toBe(127);
    expect(res.stderr.startsWith(`${command}: `) && res.stderr.trim().length > `${command}:`.length, `stderr names the command and the reason, got: ${JSON.stringify(res.stderr)}`).toBe(true);
    expect(res.output.includes(res.stderr.trim()), `and output holds the same line, got: ${JSON.stringify(res.output)}`).toBe(true);
  });
});

describe('nonNegativeOf', () => {
  test('unset, empty, a word, a negative and an infinite number give the fallback; 0 gives 0; 2.5 gives 2.5', () => {
    expect(nonNegativeOf(undefined, 30), 'unset').toBe(30);
    for (const value of ['', 'abc', '-1', 'Infinity']) {
      expect(nonNegativeOf(value, 30), JSON.stringify(value)).toBe(30);
    }
    expect(nonNegativeOf('0', 30), '"0"').toBe(0);
    expect(nonNegativeOf('2.5', 30), '"2.5"').toBe(2.5);
  });
});
