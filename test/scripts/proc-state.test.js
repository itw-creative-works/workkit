// Tests for workflow/lib/proc-state.js: ended(), handed the kit's spawnSync, reads
// a running child as not ended, and a child that exited while its parent never
// collects it as ended.

const path = require('path');
const {
  describe, test, expect, until, alive, start,
} = require('../lib/harness');
const { IS_WINDOWS } = require('../lib/platform');
const { startNeverCollects, childOf } = require('../lib/never-collects');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const { ended } = require(path.join(LIB, 'proc-state.js'));
const { spawnSync } = require(path.join(LIB, 'run.js'));

/** Whether <pid> still answers signal 0, as a process its parent has yet to collect does. */
const answers = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('proc-state.js: ended', { skip: IS_WINDOWS && 'Windows has no ended process left for its parent to collect' }, () => {
  test('a running child: false', (t) => {
    const child = start(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    t.after(() => child.end('SIGKILL'));
    expect(ended(child.pid, spawnSync), `ended(${child.pid}) of a running child`).toBe(false);
  });

  test('a child that exited while its parent, which never collects it, still lives: true, the pid still answering signal 0', async () => {
    const parent = startNeverCollects();
    try {
      const child = await childOf(parent);
      expect(await until(() => ended(child, spawnSync)), `ended(${child}) turned true once the child exited`).toBe(true);
      expect(answers(child), `the pid ${child} is not yet collected`).toBe(true);
      expect(alive(parent.pid), 'the parent that never collects it still lives').toBe(true);
    } finally {
      await parent.end('SIGKILL');
    }
  });
});
