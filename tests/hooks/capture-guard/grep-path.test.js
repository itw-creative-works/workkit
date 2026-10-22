// Tests for safety:capture-guard's logic on the Grep path, gated when a search
// is pointed at the capture file and open when it only sweeps the repo. Each
// case ports the HEAD case its name quotes; "a .workkit Grep where no capture
// file exists: exit 0" asks whether the file is there, so it is the wiring's,
// in tests/mods/pre-tool-use-files.test.ts. Shared facts: ./helpers.js.

const {
  group, test, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const {
  REPO, CAPTURE, FRESH, READ, grep, refuses, allows,
} = require('./helpers');

const label = (input) => JSON.stringify(input);

const run = async () => {
  group('capture-guard: the Grep path');

  await test('ports "a Grep whose path IS the capture file: exit 2"', async () => {
    for (const input of [
      { pattern: 'salary', path: CAPTURE, output_mode: 'content' },
      { pattern: 'salary', path: `${W}/capture.md` },
      { pattern: 'salary', path: CAPTURE, output_mode: 'files_with_matches' },
    ]) {
      await refuses(grep(input), READ, label(input));
    }
  });

  await test('ports "a Grep whose path is the .workkit directory: exit 2"', async () => {
    for (const p of [`${REPO}/${W}`, W]) await refuses(grep({ pattern: 'salary', path: p }), READ, p);
  });

  await test('ports "a glob spelling the capture file out: exit 2"', async () => {
    await refuses(grep({ pattern: 'salary', path: REPO, glob: '**/capture.md' }), READ, 'the glob names the file');
  });

  await test('ports "a fresh marker opens the Grep path too: exit 0"', async () => {
    await allows(grep({ pattern: 'salary', path: CAPTURE, output_mode: 'content' }, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  await test('ports "a broad repo-wide Grep: exit 0"', async () => {
    for (const input of [
      { pattern: 'salary', path: REPO, output_mode: 'content' },
      { pattern: 'salary' },
      { pattern: 'salary', path: REPO, glob: '**/*.md' },
      { pattern: 'salary', path: `${REPO}/docs` },
    ]) {
      await allows(grep(input), label(input));
    }
  });

  await test('ports "a .workkit Grep narrowed away from the capture file by its glob: exit 0"', async () => {
    for (const input of [
      { pattern: 'salary', path: `${REPO}/${W}`, glob: 'agents/session.md' },
      { pattern: 'salary', path: `${REPO}/${W}`, glob: '*.json' },
    ]) {
      await allows(grep(input), label(input));
    }
  });

  await test('ports "a glob merely mentioning capture is still pointed at it: exit 2"', async () => {
    await refuses(grep({ pattern: 'salary', path: REPO, glob: '*capture*' }), READ, 'the glob names the capture file');
  });

  await test('ports "a trailing slash does not slip the Grep gate: exit 2"', async () => {
    for (const p of [`${REPO}/${W}/`, `${CAPTURE}/`]) await refuses(grep({ pattern: 'salary', path: p }), READ, p);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
