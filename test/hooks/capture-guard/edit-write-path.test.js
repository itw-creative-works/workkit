// Tests for safety:capture-guard's logic on the Edit and Write path: the drain's marker-gated
// rewrite, and the finding route the refusal names, handed over as `route`. Reading findings.file
// for the route is the wiring's, in test/mods/guards-capture-guard.test.ts. A Bash write is the disk
// check's, after the call: test/mods/guards-script-write.test.ts. Shared facts: ./helpers.js.

const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, DRIVE_CAPTURE, DRIVE_FACTS, FRESH, ROUTE_ON, REWRITE, edit, write, denyOf, refuses, allows,
} = require('./helpers');

describe('capture-guard: the Edit and Write path', () => {
  test('editing or writing the capture file with no marker: exit 2: the refusal names the rewrite', async () => {
    await refuses(edit(CAPTURE), REWRITE(), 'Edit');
    await refuses(write(CAPTURE), REWRITE(), 'Write');
    await refuses(edit(`${W}/capture.md`), REWRITE(), 'Edit, relative');
  });

  test('editing or writing it spelled with backslashes, no marker: exit 2: the rewrite refusal', async () => {
    await refuses(edit(DRIVE_CAPTURE, DRIVE_FACTS), REWRITE(), 'Edit');
    await refuses(write(DRIVE_CAPTURE, DRIVE_FACTS), REWRITE(), 'Write');
  });

  test('editing or writing it with a fresh marker: exit 0', async () => {
    await allows(edit(CAPTURE, { markerAgeS: FRESH }), 'Edit');
    await allows(write(CAPTURE, { markerAgeS: FRESH }), 'Write');
  });

  test('writing another file in .workkit/: exit 0', async () => {
    await allows(write(`${REPO}/${W}/agents/session.md`), 'only the capture file is gated');
  });
});

describe('capture-guard: where a finding goes instead follows the route', () => {
  test('findings.file on: the refusal names the status:inbox route', async () => {
    const deny = denyOf(await edit(CAPTURE, { route: ROUTE_ON }));
    expect(deny, 'must block: an Edit of the capture file').toBe(REWRITE(ROUTE_ON));
    expect(deny.includes('status:inbox'), 'points at the issue').toBeTruthy();
  });
});
