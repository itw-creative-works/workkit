//
// Tests for hooks/safety/capture-guard: the Bash path, where a content-reading
// command is gated and a count or another file stays open.
// The shared prologue (the scratch repo and TMPDIR, the marker helpers, the hook runner) is ./helpers.js.
//

const {
  group, test, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const { skipWithoutDigest, clearMarker, touchMarker, bash } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('capture-guard: the Bash path');

  await test('a content-reading command: exit 2', () => {
    clearMarker();
    for (const c of [
      `cat ${W}/capture.md`,
      `head -20 ${W}/capture.md`,
      `tail -n 5 ${W}/capture.md`,
      `grep -n "note" ${W}/capture.md`,
      `sed -n 1,10p ${W}/capture.md`,
      `awk 'NR<5' ${W}/capture.md`,
    ]) {
      assertEq(bash(c).code, 2, `must block: ${c}`);
    }
  });

  await test('a fresh marker opens the Bash path too: exit 0', () => {
    touchMarker();
    const { code, stderr } = bash(`cat ${W}/capture.md`);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('counting the entries: exit 0', () => {
    clearMarker();
    for (const c of [`wc -l ${W}/capture.md`, `wc -l < ${W}/capture.md`]) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `counts stay open: ${c}, got: ${stderr}`);
    }
  });

  await test('a command naming another file: exit 0', () => {
    clearMarker();
    assertEq(bash(`cat ${W}/agents/session.md`).code, 0, 'only the capture file is gated');
  });

  // The two halves of the path need not be contiguous: a `cd` into .workkit
  // leaves the file named on its own, and that is the same read.
  await test('a read split across a cd: exit 2', () => {
    clearMarker();
    assertEq(bash(`cd ${W} && cat capture.md`).code, 2, 'the cd names the directory the read names the file');
  });

  await test('a split command that only counts: exit 0', () => {
    clearMarker();
    const { code, stderr } = bash(`cd ${W} && wc -l capture.md`);
    assertEq(code, 0, `counts stay open however they are spelled, got: ${stderr}`);
  });

  await test('an capture.md with no .workkit anywhere: exit 0', () => {
    clearMarker();
    for (const c of ['echo x >> notes/capture.md', 'cat notes/capture.md']) {
      const { code, stderr } = bash(c);
      assertEq(code, 0, `somebody else's capture.md is not ours: ${c}, got: ${stderr}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
