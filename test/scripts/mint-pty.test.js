// Tests for runUnderPty's expect path (workflow/workkit/pty.js): the Ctrl-C escape
// the token mint needs, proved with a child that ignores SIGINT the way the claude
// CLI ignores ^C. The suite runs under an outer expect, since the path is gated on
// a real terminal; with no expect, workkit-cli/cloud-secrets.test.js covers the fallbacks.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const { jsPath, spawnSync, which } = require('../lib/platform');
const { WORKFLOW_DIR, cleanup } = require('./workkit-cli/helpers');

const KIT_JS = path.join(WORKFLOW_DIR, 'workkit', 'kit.js');
const PTY_JS = path.join(WORKFLOW_DIR, 'workkit', 'pty.js');

/**
 * Run `runUnderPty(kit, [<child>], <capture>)` at a (nested) terminal, in a node
 * of its own, optionally sending one key after the child announces itself, and
 * return what the outer harness observed: the call's answer line and the capture.
 */
const runMint = (root, { child, send = '' }) => {
  const childFile = path.join(root, 'child.sh');
  fs.writeFileSync(childFile, child, { mode: 0o755 });
  const capture = path.join(root, 'capture.txt');
  fs.writeFileSync(capture, '');
  const driver = path.join(root, 'driver.js');
  fs.writeFileSync(driver, [
    `const { kitOf } = require(${jsPath(KIT_JS)});`,
    `const { runUnderPty } = require(${jsPath(PTY_JS)});`,
    `Promise.resolve(runUnderPty(kitOf({}), [${jsPath(childFile)}], ${jsPath(capture)}, { stdout: 'inherit', stderr: 'inherit' }))`,
    "  .then((code) => process.stdout.write(`WRAPPER-EXIT:${code}\\n`));",
  ].join('\n'));
  const resultFile = path.join(root, 'result.txt');
  const harness = path.join(root, 'harness.exp');
  fs.writeFileSync(harness, [
    `set timeout ${SPAWN_DEADLINE / 1000}`,
    `set log [open ${JSON.stringify(resultFile)} w]`,
    `spawn {${process.execPath}} {${driver}}`,
    'expect {',
    '    "CHILD-UP" {}',
    '    timeout { puts $log "no child"; close $log; exit 1 }',
    '}',
    ...(send ? [`send ${JSON.stringify(send)}`] : []),
    'expect {',
    '    -re {WRAPPER-EXIT:(\\d+)} { puts $log "exit=$expect_out(1,string)" }',
    '    timeout { puts $log "no exit" }',
    '}',
    'close $log',
    'catch {close}',
    'catch {wait}',
  ].join('\n'));
  const res = spawnSync('expect', [harness], { cwd: root, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return {
    status: res.status,
    result: fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim() : '',
    capture: fs.readFileSync(capture, 'utf8'),
  };
};

describe('workflow: mint-pty: Ctrl-C ends a mint whose child ignores it (#187)', {
  skip: !which('expect') && 'expect is not installed: only the script fallback can run here',
}, () => {
  test('one ^C ends an INT-ignoring child and answers 130', () => {
    const root = mkTmp('workkit-mintpty-');
    try {
      const out = runMint(root, {
        child: '#!/bin/bash\ntrap "" INT\necho CHILD-UP\nsleep 60\necho CHILD-DONE\n',
        send: '\x03',
      });
      expect(out.result, 'the outer binding ends the run the CLI would sit through').toBe('exit=130');
      expect(!out.capture.includes('CHILD-DONE'), 'and the child never reached its own end').toBeTruthy();
    } finally { cleanup(root); }
  });

  test('a child that finishes passes its screen and its exit status through', () => {
    const root = mkTmp('workkit-mintpty-');
    try {
      const out = runMint(root, {
        child: '#!/bin/bash\necho CHILD-UP\necho FAKE-TOKEN-LINE\nexit 3\n',
      });
      expect(out.result, 'the child’s own status is the wrapper’s answer').toBe('exit=3');
      expect(out.capture.includes('FAKE-TOKEN-LINE'), 'and the screen the token rides on is in the capture').toBeTruthy();
    } finally { cleanup(root); }
  });
});
