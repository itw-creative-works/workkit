// Tests for safety:capture-guard's logic on the Read path, gated by the triage
// marker's age, and every other file left open. The shared facts are ./helpers.js.

const {
  describe, test, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, DRIVE_CWD, DRIVE_CAPTURE, DRIVE_FACTS, FRESH, STALE, READ, read, refuses, allows,
} = require('./helpers');

describe('capture-guard: the Read path', () => {
  test('reading the capture file with no marker: exit 2, names the rule and the skill', async () => {
    await refuses(read(CAPTURE), READ, 'an unannounced read');
  });

  test('reading the capture file with a fresh marker: exit 0', async () => {
    await allows(read(CAPTURE, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  test('a marker 31 minutes old: exit 2', async () => {
    await refuses(read(CAPTURE, { markerAgeS: STALE }), READ, 'a stale marker is not a triage run');
  });

  test('a relative capture path is gated too: exit 2', async () => {
    await refuses(read(`${W}/capture.md`), READ, 'the path is matched by suffix, not by shape');
  });

  test('any other file: exit 0', async () => {
    for (const f of [`${REPO}/${W}/agents/session.md`, `${REPO}/capture.md`, `${REPO}/README.md`]) {
      await allows(read(f), f);
    }
  });
});

describe('capture-guard: the Read path spelled with backslashes', () => {
  test('reading the capture file with no marker: exit 2, the read refusal', async () => {
    await refuses(read(DRIVE_CAPTURE, DRIVE_FACTS), READ, DRIVE_CAPTURE);
  });

  test('any other file: exit 0', async () => {
    const f = `${DRIVE_CWD}\\README.md`;
    await allows(read(f, DRIVE_FACTS), f);
  });
});
