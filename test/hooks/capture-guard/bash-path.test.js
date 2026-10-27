// Tests for safety:capture-guard's logic on the Bash path, where a
// content-reading command is gated and a count or another file stays open.
// Each case ports the HEAD case its name quotes; the shared facts are ./helpers.js.

const {
  group, test, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const {
  FRESH, READ, bash, refuses, allows,
} = require('./helpers');

const cases = async () => {
  group('capture-guard: the Bash path');

  await test('ports "a content-reading command: exit 2"', async () => {
    for (const c of [
      `cat ${W}/capture.md`,
      `head -20 ${W}/capture.md`,
      `tail -n 5 ${W}/capture.md`,
      `grep -n "note" ${W}/capture.md`,
      `sed -n 1,10p ${W}/capture.md`,
      `awk 'NR<5' ${W}/capture.md`,
    ]) {
      await refuses(bash(c), READ, c);
    }
  });

  await test('ports "a fresh marker opens the Bash path too: exit 0"', async () => {
    await allows(bash(`cat ${W}/capture.md`, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  await test('ports "counting the entries: exit 0"', async () => {
    for (const c of [`wc -l ${W}/capture.md`, `wc -l < ${W}/capture.md`]) await allows(bash(c), c);
  });

  await test('ports "a command naming another file: exit 0"', async () => {
    await allows(bash(`cat ${W}/agents/session.md`), 'only the capture file is gated');
  });

  // The two halves of the path need not be contiguous: a `cd` into .workkit
  // leaves the file named on its own, and that is the same read.
  await test('ports "a read split across a cd: exit 2"', async () => {
    await refuses(bash(`cd ${W} && cat capture.md`), READ, 'the cd names the directory the read names the file');
  });

  await test('ports "a split command that only counts: exit 0"', async () => {
    await allows(bash(`cd ${W} && wc -l capture.md`), 'counts stay open however they are spelled');
  });

  await test('ports "an capture.md with no .workkit anywhere: exit 0"', async () => {
    for (const c of ['echo x >> notes/capture.md', 'cat notes/capture.md']) await allows(bash(c), c);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
