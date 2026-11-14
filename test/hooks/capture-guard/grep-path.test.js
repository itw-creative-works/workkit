// Tests for safety:capture-guard's logic on the Grep path, gated when a search is pointed at the
// capture file and open when it only sweeps the repo. "a .workkit Grep where no capture file
// exists: exit 0" asks whether the file is there, so it is the wiring's, in
// test/mods/pre-tool-use-files.test.ts. Shared facts: ./helpers.js.

const {
  describe, test, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, DRIVE_CWD, DRIVE_CAPTURE, DRIVE_FACTS, FRESH, READ, grep, refuses, allows,
} = require('./helpers');

const label = (input) => JSON.stringify(input);

describe('capture-guard: the Grep path', () => {
  test('a Grep whose path IS the capture file: exit 2', async () => {
    for (const input of [
      { pattern: 'salary', path: CAPTURE, output_mode: 'content' },
      { pattern: 'salary', path: `${W}/capture.md` },
      { pattern: 'salary', path: CAPTURE, output_mode: 'files_with_matches' },
    ]) {
      await refuses(grep(input), READ, label(input));
    }
  });

  test('a Grep whose path is the .workkit directory: exit 2', async () => {
    for (const p of [`${REPO}/${W}`, W]) await refuses(grep({ pattern: 'salary', path: p }), READ, p);
  });

  test('a Grep whose path is the file or its folder spelled with backslashes: exit 2', async () => {
    for (const p of [DRIVE_CAPTURE, `${DRIVE_CWD}\\${W}`]) await refuses(grep({ pattern: 'salary', path: p }, DRIVE_FACTS), READ, p);
  });

  test('a glob spelling the capture file out: exit 2', async () => {
    await refuses(grep({ pattern: 'salary', path: REPO, glob: '**/capture.md' }), READ, 'the glob names the file');
  });

  test('a fresh marker opens the Grep path too: exit 0', async () => {
    await allows(grep({ pattern: 'salary', path: CAPTURE, output_mode: 'content' }, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  test('a broad repo-wide Grep: exit 0', async () => {
    for (const input of [
      { pattern: 'salary', path: REPO, output_mode: 'content' },
      { pattern: 'salary' },
      { pattern: 'salary', path: REPO, glob: '**/*.md' },
      { pattern: 'salary', path: `${REPO}/docs` },
    ]) {
      await allows(grep(input), label(input));
    }
  });

  test('a .workkit Grep narrowed away from the capture file by its glob: exit 0', async () => {
    for (const input of [
      { pattern: 'salary', path: `${REPO}/${W}`, glob: 'agents/session.md' },
      { pattern: 'salary', path: `${REPO}/${W}`, glob: '*.json' },
    ]) {
      await allows(grep(input), label(input));
    }
  });

  test('a glob merely mentioning capture is still pointed at it: exit 2', async () => {
    await refuses(grep({ pattern: 'salary', path: REPO, glob: '*capture*' }), READ, 'the glob names the capture file');
  });

  test('a trailing slash does not slip the Grep gate: exit 2', async () => {
    for (const p of [`${REPO}/${W}/`, `${CAPTURE}/`]) await refuses(grep({ pattern: 'salary', path: p }), READ, p);
  });
});
