// The one fake `gh` the suites put on PATH, a Node stand-in: `writeGh` is its
// body, recording each call and answering it in process through an export of
// a `*-answers.js` module. `makeGhStub` is the fixture `gh` the
// workflow-snapshot, hold, suite-hold and identity suites run against: `issue
// view` (and `issue list`, one answer or one per repo) from a fixture, and
// `gh api` from route fixtures, recording each call, its directory and the env
// names asked for (gh-stub-answers.js); the world with no `gh` at all.

const fs = require('fs');
const path = require('path');
const { stubToolJs, basePathWithout, mirrorDirOf } = require('./platform');
const { recordArgvJs, readArgv } = require('./argv-log');
const { mkTmp } = require('./harness');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * Write the stand-in `name` into `binDir`: each call is appended to `log` (when given)
 * in argv-log's framing, then answered by `answer.name`, an export of the
 * module `answer.module`, called as `(config, argv)` in the stand-in's own
 * process; what it returns is the call's exit code, and it writes the streams itself.
 * The module is a `*-answers.js` file loading no harness, platform or helpers file,
 * since the stand-in runs on the PATH of the program under test.
 * @param {string} binDir - the PATH directory, which must exist
 * @param {string} name - the program the stand-in is found by
 * @param {{log?: string|null, answer: {module: string, name: string}, config?: *}} spec - `config` plain JSON
 * @returns {string} the stand-in that was written
 */
const writeAnswered = (binDir, name, { log = null, answer, config = null }) => stubToolJs(binDir, name, [
  ...(log ? [recordArgvJs(JSON.stringify(log))] : []),
  `process.exitCode = require(${JSON.stringify(answer.module)})[${JSON.stringify(answer.name)}](${JSON.stringify(config)}, process.argv.slice(2));`,
].join('\n'));

/** The fake `gh`: writeAnswered named `gh`. */
const writeGh = (binDir, spec) => writeAnswered(binDir, 'gh', spec);

/**
 * A `gh` on its own bin folder answering `issue view <N> --json <field>` with `{ <field>: issues[N] }`
 * (an unknown number exits 1) and, given `list`, every `issue list` with that array whatever its flags;
 * given `lists`, an `issue list` answers per repo instead (`-R`/`--repo`, else the folder's origin, keyed
 * by its last path segment, `repo` for FIXTURE_ORIGIN; `[]` for any other repo). `field` is the JSON field
 * the fixture fills (`comments`, `body`); `list` is shaped like gh's (`[{ number, labels: [{ name }] }]`);
 * `fails`: every view (and list) exits 1 with a line on stderr, as an offline gh does; `env`: variable
 * names each call records, read by `ghEnvs`; `api`: `gh api` answers by `<METHOD> <route>`, each
 * `{ status, body }` or `{ pages }` (`answerApi`, gh-stub-answers.js), kept in `<dir>/api.json` and read on every call.
 * @param {{field?: string, issues?: object, list?: object[], lists?: object, fails?: boolean, env?: string[], api?: object}} [opts]
 * @returns {{binDir: string, logFile: string, cwdFile: string, envFile: string, requestFile: string, dir: string}}
 */
const makeGhStub = ({
  field, issues = {}, list = null, lists = null, fails = false, env = [], api = null,
} = {}) => {
  const dir = mkTmp('gh-stub-');
  const logFile = path.join(dir, 'gh.log');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const cwdFile = path.join(dir, 'cwd');
  const envFile = path.join(dir, 'env.jsonl');
  const apiFile = path.join(dir, 'api.json');
  const requestFile = path.join(dir, 'requests.jsonl');
  if (api) fs.writeFileSync(apiFile, JSON.stringify(api));
  writeGh(binDir, {
    log: logFile,
    answer: { module: require.resolve('./gh-stub-answers'), name: 'answerFixtures' },
    config: {
      cwdFile, envFile, env, apiFile: api ? apiFile : null, requestFile, field, issues, list, lists, fails,
    },
  });
  return {
    binDir, logFile, cwdFile, envFile, requestFile, dir,
  };
};

/** Every call the stub recorded, each an argv array. */
const ghCalls = (stub) => readArgv(stub.logFile);

/** Every call's recorded env, one object per call; a stub never called reads as none. */
const ghEnvs = (stub) => {
  if (!fs.existsSync(stub.envFile)) return [];
  return fs.readFileSync(stub.envFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

/** Every `gh api` request the stub answered, `{ method, path, query, body }` each, in order. */
const ghRequests = (stub) => {
  if (!fs.existsSync(stub.requestFile)) return [];
  return fs.readFileSync(stub.requestFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

// The machine without `gh`: a runner ships the real one in /usr/bin, so a case
// about its absence takes it off the PATH. Built once, dropped by the suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('gh-stub-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(mirrorDirOf(noGhPath)));
  noGhPath = null;
};

module.exports = {
  cleanup, writeAnswered, writeGh, makeGhStub, ghCalls, ghEnvs, ghRequests, pathWithoutGh, dropPathWithoutGh,
};
