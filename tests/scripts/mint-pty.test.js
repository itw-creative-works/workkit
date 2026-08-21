//
// Tests for run_under_pty's expect path (issue #187) — the Ctrl-C escape the
// token mint needs. The claude CLI holds its PTY in raw mode and discards the
// ^C byte, so `workflow/mint-pty.exp` binds it one layer out and ends the run
// itself; these cases prove the binding with a child that IGNORES SIGINT the
// way the CLI ignores the byte, and prove a finished child's exit status and
// screen still pass through.
//
// The whole suite runs under an OUTER expect: the path under test is gated on
// stdin being a real terminal, and a pty is the only honest way to answer that
// gate — a pipe would route every case to the `script` fallback and prove
// nothing. No expect on this machine, nothing to test: the fallback is the
// only path that can run here, and workkit-cli.test.js already covers it.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skipSuite, selfRun, summary,
} = require('../lib/harness');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.sh');

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-mintpty-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const hasExpect = () => spawnSync('expect', ['-v'], { encoding: 'utf8' }).status === 0;

/**
 * Run `run_under_pty <capture> <child>` at a (nested) terminal, optionally
 * sending one key after the child announces itself, and return what the outer
 * harness observed: the wrapper's exit code line and the capture's content.
 *
 * `set -e` is live in the sourced CLI, so the wrapper's status is read through
 * `||` — the same disarm the real mint uses.
 */
const runMint = (root, { child, send = '' }) => {
  const childFile = path.join(root, 'child.sh');
  fs.writeFileSync(childFile, child, { mode: 0o755 });
  const capture = path.join(root, 'capture.txt');
  fs.writeFileSync(capture, '');
  const resultFile = path.join(root, 'result.txt');
  const harness = path.join(root, 'harness.exp');
  fs.writeFileSync(harness, [
    'set timeout 20',
    `set log [open ${JSON.stringify(resultFile)} w]`,
    `spawn bash -c ". ${CLI} help >/dev/null 2>&1; run_under_pty ${capture} ${childFile} && echo WRAPPER-EXIT:0 || echo WRAPPER-EXIT:\\$?"`,
    'expect {',
    '    "CHILD-UP" {}',
    '    timeout { puts $log "no child"; close $log; exit 1 }',
    '}',
    ...(send ? ['sleep 1', `send ${JSON.stringify(send)}`] : []),
    'expect {',
    '    -re {WRAPPER-EXIT:(\\d+)} { puts $log "exit=$expect_out(1,string)" }',
    '    timeout { puts $log "no exit" }',
    '}',
    'close $log',
    'catch {close}',
    'catch {wait}',
  ].join('\n'));
  const res = spawnSync('expect', [harness], { cwd: root, encoding: 'utf8', timeout: 60000 });
  return {
    status: res.status,
    result: fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim() : '',
    capture: fs.readFileSync(capture, 'utf8'),
  };
};

const run = async () => {
  if (!hasExpect()) skipSuite('expect is not installed — only the script fallback can run here');

  group('workflow: mint-pty — Ctrl-C ends a mint whose child ignores it (#187)');

  await test('one ^C ends an INT-ignoring child and answers 130', () => {
    const root = mkTmp();
    try {
      const out = runMint(root, {
        child: '#!/bin/bash\ntrap "" INT\necho CHILD-UP\nsleep 60\necho CHILD-DONE\n',
        send: '\x03',
      });
      assertEq(out.result, 'exit=130', 'the outer binding ends the run the CLI would sit through');
      assert(!out.capture.includes('CHILD-DONE'), 'and the child never reached its own end');
    } finally { cleanup(root); }
  });

  await test('a child that finishes passes its screen and its exit status through', () => {
    const root = mkTmp();
    try {
      const out = runMint(root, {
        child: '#!/bin/bash\necho CHILD-UP\necho FAKE-TOKEN-LINE\nexit 3\n',
      });
      assertEq(out.result, 'exit=3', 'the child’s own status is the wrapper’s answer');
      assert(out.capture.includes('FAKE-TOKEN-LINE'), 'and the screen the token rides on is in the capture');
    } finally { cleanup(root); }
  });

  return summary();
};

module.exports = run;
if (require.main === module) selfRun(run);
