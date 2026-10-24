// Tests for safety:capture-guard's logic on the Read path, gated by the triage
// marker's age, and every other file left open. Each case ports the HEAD case
// its name quotes; the shared facts are ./helpers.js.

const {
  group, test, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, FRESH, STALE, READ, read, refuses, allows,
} = require('./helpers');

const run = async () => {
  group('capture-guard: the Read path');

  await test('ports "reading the capture file with no marker: exit 2, names the rule and the skill"', async () => {
    await refuses(read(CAPTURE), READ, 'an unannounced read');
  });

  await test('ports "reading the capture file with a fresh marker: exit 0"', async () => {
    await allows(read(CAPTURE, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  await test('ports "a marker 31 minutes old: exit 2"', async () => {
    await refuses(read(CAPTURE, { markerAgeS: STALE }), READ, 'a stale marker is not a triage run');
  });

  await test('ports "a relative capture path is gated too: exit 2"', async () => {
    await refuses(read(`${W}/capture.md`), READ, 'the path is matched by suffix, not by shape');
  });

  await test('ports "any other file: exit 0"', async () => {
    for (const f of [`${REPO}/${W}/agents/session.md`, `${REPO}/capture.md`, `${REPO}/README.md`]) {
      await allows(read(f), f);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
