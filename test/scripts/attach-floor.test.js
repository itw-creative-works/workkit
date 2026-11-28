// Tests for workflow/lib/attach.js and the kit's Node floor: a call's view is
// painted only when its own node is at the floor the kit's package.json names,
// so a copy of the kit with another engines.node answers another view.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded, run,
} = require('../lib/harness');
const { NODE_DIR, jsPath, systemPathWith, homeEnv } = require('../lib/platform');
const { COLOR_ON } = require('../lib/supervise-world');
const { deadPid } = require('../lib/supervise');

const ROOT = path.join(__dirname, '..', '..');
const ESC = '\x1b';

// The kit, copied with the package.json its floor is read from, engines.node set to <engines>.
const copyKit = seeded((seed, engines) => {
  for (const part of ['workflow', 'hooks', 'defaults', path.join('packages', 'core')]) {
    fs.cpSync(path.join(ROOT, part), path.join(seed, part), { recursive: true });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(seed, 'package.json'), `${JSON.stringify({ ...pkg, engines: { node: engines } }, null, 2)}\n`);
});

/**
 * What a call attached to a run that already ended prints at a terminal the
 * color gate answers yes for, through the attach.js of a kit whose engines.node
 * is <engines>: the log's one pass line, read back before the recorded code.
 */
const attachedOutput = (engines) => {
  const kit = mkTmp('attach-floor-kit-');
  copyKit(kit, engines);
  const dir = mkTmp('attach-floor-run-');
  const log = path.join(dir, 'run.log');
  const lock = path.join(dir, 'lock');
  const pid = deadPid();
  fs.writeFileSync(log, '  ✓ done\n');
  fs.writeFileSync(`${lock}.done`, `${pid} 0\n`);
  const res = run(process.execPath, ['-e', [
    `const { attachRun } = require(${jsPath(path.join(kit, 'workflow', 'lib', 'attach.js'))});`,
    `attachRun(${jsPath(log)}, ${jsPath(lock)}, ${pid}, 0).then((done) => { process.exitCode = done.rc; });`,
  ].join('\n')], { env: homeEnv(mkTmp('attach-floor-home-'), { PATH: systemPathWith(NODE_DIR), ...COLOR_ON }) });
  expect(res.status, `the call returned the run's code, got: ${res.output}`).toBe(0);
  return res.stdout;
};

describe('attach.js: the view by the kit\'s floor', () => {
  test('a kit whose floor this node meets paints the pass line', () => {
    expect(attachedOutput('>=22.22'), 'the mark painted green').toBe(`  ${ESC}[32m✓${ESC}[39m done\n`);
  });

  test('a kit whose engines.node names a floor above this node shows the plain line', () => {
    expect(attachedOutput('>=99.0'), 'the line as the log holds it').toBe('  ✓ done\n');
  });
});
