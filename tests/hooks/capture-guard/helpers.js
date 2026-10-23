// The shared prologue of the safety:capture-guard suites beside this one, one
// suite per path the capture file is reached by: the facts
// captureGuardVerdict({ tool, input, cwd, root, markerAgeS, route }) in
// hooks/mods/capture-guard.js takes, the three refusals, and the two route
// sentences findingsRoute in hooks/mods/settings.js answers.

const { assertEq, WORKKIT_DIR: W } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');

const REPO = '/w/repo';
const HOME = '/w/home';
const CAPTURE = `${REPO}/${W}/capture.md`;
const HOME_CAPTURE = `${HOME}/${W}/capture.md`;

// A marker written this moment, and one past the 30 minutes a triage run holds.
const FRESH = 0;
const STALE = 31 * 60;

const ROUTE_OFF = 'Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.';
const ROUTE_ON = 'File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide.';
const lower = (s) => `${s[0].toLowerCase()}${s.slice(1)}`;

const READ = `capture-guard: BLOCKED reading ${W}/capture.md: it is the owner's capture surface, and its contents are read only during a triage run.\nRun the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) stays open.`;
const WRITE = (route = ROUTE_OFF) => `capture-guard: BLOCKED writing ${W}/capture.md: it is the owner's capture surface, and the agent never adds to it.\nIts entries are cleared only by the triage drain: run the workkit:triage skill, which records the marker this guard checks. ${route}`;
const REWRITE = (route = ROUTE_OFF) => `capture-guard: BLOCKED rewriting ${W}/capture.md: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: ${lower(route)}`;

/** The verdict on one call; `markerAgeS` null is no marker at all. */
const judge = (tool, input, { markerAgeS = null, route = ROUTE_OFF, cwd = REPO, root = REPO } = {}) => mods('capture-guard')
  .captureGuardVerdict({ tool, input, cwd, root, markerAgeS, route });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const bash = (command, facts) => judge('Bash', { command }, facts);
const read = (file, facts) => judge('Read', { file_path: file }, facts);
const edit = (file, facts) => judge('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, facts);
const write = (file, facts) => judge('Write', { file_path: file, content: '' }, facts);
const grep = (input, facts) => judge('Grep', input, facts);

/** Asserts the call is refused with exactly `expected`. */
const refuses = async (call, expected, label) => {
  assertEq(denyOf(await call), expected, `must block: ${label}`);
};

/** Asserts the call passes, saying nothing. */
const allows = async (call, label) => {
  const r = await call;
  assertEq(denyOf(r), null, `must pass: ${label}`);
  assertEq(r ?? null, null, `silently: ${label}`);
};

module.exports = {
  REPO, HOME, CAPTURE, HOME_CAPTURE, FRESH, STALE, ROUTE_ON, READ, WRITE, REWRITE,
  judge, denyOf, bash, read, edit, write, grep, refuses, allows,
};
