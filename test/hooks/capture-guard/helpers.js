// The shared prologue of the safety:capture-guard suites beside this one, one
// suite per path the capture file is reached by: the facts
// captureGuardVerdict({ tool, input, cwd, root, markerAgeS, route }) in
// hooks/mods/capture-guard.js takes, the two refusals, and the two route
// sentences findingsRoute in hooks/mods/settings.js answers.

const { expect, WORKKIT_DIR: W } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
// The read refusal, shared with the wiring suites.
const { CAPTURE_READ: READ } = require('../../lib/mod-fixtures.mjs');

const REPO = '/w/repo';
const HOME = '/w/home';
const CAPTURE = `${REPO}/${W}/capture.md`;
const HOME_CAPTURE = `${HOME}/${W}/capture.md`;

// The repo as a Windows session hands it over, the top level Windows git prints
// for it, its capture file spelled with backslashes, and the facts of a call there.
const DRIVE_CWD = 'D:\\a\\repo';
const DRIVE_TOP = 'D:/a/repo';
const DRIVE_CAPTURE = `${DRIVE_CWD}\\${W}\\capture.md`;
const DRIVE_FACTS = { cwd: DRIVE_CWD, root: DRIVE_TOP };

// A marker written this moment, and one past the 30 minutes a triage run holds.
const FRESH = 0;
const STALE = 31 * 60;

const ROUTE_OFF = 'Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.';
const ROUTE_ON = 'File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide.';
const lower = (s) => `${s[0].toLowerCase()}${s.slice(1)}`;

const REWRITE = (route = ROUTE_OFF) => `capture-guard: BLOCKED rewriting ${W}/capture.md: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: ${lower(route)}`;

/** The verdict on one call; `markerAgeS` null is no marker at all. */
const judge = (tool, input, { markerAgeS = null, route = ROUTE_OFF, cwd = REPO, root = REPO } = {}) => mods('capture-guard')
  .captureGuardVerdict({ tool, input, cwd, root, markerAgeS, route });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const read = (file, facts) => judge('Read', { file_path: file }, facts);
const edit = (file, facts) => judge('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, facts);
const write = (file, facts) => judge('Write', { file_path: file, content: '' }, facts);
const grep = (input, facts) => judge('Grep', input, facts);

/** Asserts the call is refused with exactly `expected`. */
const refuses = async (call, expected, label) => {
  expect(denyOf(await call), `must block: ${label}`).toBe(expected);
};

/** Asserts the call passes, saying nothing. */
const allows = async (call, label) => {
  const r = await call;
  expect(denyOf(r), `must pass: ${label}`).toBe(null);
  expect(r ?? null, `silently: ${label}`).toBe(null);
};

module.exports = {
  REPO, HOME, CAPTURE, HOME_CAPTURE, DRIVE_CWD, DRIVE_TOP, DRIVE_CAPTURE, DRIVE_FACTS, FRESH, STALE, ROUTE_ON, READ, REWRITE,
  judge, denyOf, read, edit, write, grep, refuses, allows,
};
