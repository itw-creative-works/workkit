/**
 * An export of a workflow/lib file asked in a node of its own under a world's env,
 * so the machine folder, the temp folder and git's config are the world's, never
 * this process's: the records, the run paths and the tree ids read them there.
 * And `run` of runs.js the same way, as the script shell calls it, so a signal to the call reaches that node.
 * Consumers: test/lib/run-paths.js, test/hooks/lib-record.test.js, test/scripts/script-shell.test.js,
 * test/scripts/records.test.js, test/scripts/runs.test.js and test/scripts/detach.test.js.
 */

const fs = require('fs');
const path = require('path');
const {
  run, start, mkTmp, expect,
} = require('./harness');
const { jsPath } = require('./platform');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');

/** The source that loads `<name>` of workflow/lib/<file>. */
const exportOf = (file, name) => `require(${jsPath(path.join(LIB, file))})[${JSON.stringify(name)}]`;

// Each argument list in argv[1] awaited in turn: the answers on stdout, with the message of a throw that stopped them.
const askScript = (file, name) => [
  `const fn = ${exportOf(file, name)};`,
  '(async () => {',
  '  const answers = [];',
  '  try {',
  '    for (const args of JSON.parse(process.argv[1])) answers.push(await fn(...args));',
  '    process.stdout.write(JSON.stringify({ answers }));',
  '  } catch (err) {',
  '    process.stdout.write(JSON.stringify({ answers, thrown: err.message }));',
  '  }',
  '})();',
].join('\n');

/** The answers an askScript node printed; a call that threw there throws here, with its message. */
const answersOf = (status, stdout, stderr, file, name) => {
  expect(status, `${name} of ${file} answered under the world's env, stderr: ${stderr}`).toBe(0);
  const { answers, thrown } = JSON.parse(stdout);
  if (thrown !== undefined) throw new Error(`${name} of ${file} threw: ${thrown}`);
  return answers;
};

/**
 * `<name>(...args)` of workflow/lib/<file>, awaited, for each of <asks> in turn, one node under <env>.
 * @param {object} env the node's whole environment
 * @param {string} file the file under workflow/lib (`records.js`)
 * @param {string} name the export
 * @param {Array<Array>} asks one argument list per call, each JSON
 * @returns {Array} one answer per ask, in order, as JSON brings it back
 * @throws {Error} naming the message of a call that threw, the asks after it never made
 */
const kitUnder = (env, file, name, asks) => {
  const res = run(process.execPath, ['-e', askScript(file, name), JSON.stringify(asks)], { env });
  return answersOf(res.status, res.stdout, res.stderr, file, name);
};

/**
 * kitUnder started without waiting, so several nodes ask at one moment.
 * @param {object} env the node's whole environment
 * @param {string} file the file under workflow/lib
 * @param {string} name the export
 * @param {Array<Array>} asks one argument list per call, each JSON
 * @returns {Promise<Array>} one answer per ask, in order; rejects as kitUnder throws
 */
const kitUnderAsync = async (env, file, name, asks) => {
  const call = start(process.execPath, ['-e', askScript(file, name), JSON.stringify(asks)], { env });
  const { status } = await call.done;
  return answersOf(status, call.stdout(), call.stderr(), file, name);
};

/**
 * A run of `node -e <script>` as the script shell hands one to runs.js's `run`.
 * @param {string} dir the folder of its log, and of its lock unless <lock> names one
 * @param {string} script the command's source
 * @param {{lock?: string, root?: (string|null)}} [opts] the lock, and the root whose settings the checks read
 * @returns {{log: string, lock: string, root: (string|null), argv: string[]}}
 */
const runJob = (dir, script, { lock = path.join(dir, 'lock'), root = null } = {}) => ({
  log: path.join(dir, 'log'), lock, root, argv: [process.execPath, '-e', script],
});

// `run` of runs.js on the job in argv[1]: its output the run's, its exit the rc, what it resolved
// written to the file argv[2]. <before> runs once runs.js is loaded; <launch> is a launch seam's source.
const runScript = (before, launch) => [
  `const run = ${exportOf('runs.js', 'run')};`,
  before,
  `run(JSON.parse(process.argv[1]), ${launch ? `{ launch: ${launch} }` : '{}'}).then((answers) => {`,
  "  require('fs').writeFileSync(process.argv[2], JSON.stringify(answers));",
  '  process.exitCode = answers.rc;',
  '});',
].join('\n');

/** The node argv of a runScript call on <job>, and the file its answers land in. */
const runCall = (job, { before = '', launch = null }) => {
  const out = path.join(mkTmp('kit-run-'), 'answers.json');
  return { out, argv: ['-e', runScript(before, launch), JSON.stringify(job), out] };
};

/** What run resolved, or null when the call ended before it resolved. */
const answersIn = (out) => (fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null);

/**
 * `run` of runs.js on <job> in a node of its own under <env>, to its end.
 * @param {object} job runJob's shape
 * @param {{env?: object, before?: string, launch?: string}} [opts] the env; source run before the call; a launch seam's source
 * @returns {{res: object, answers: ?{rc: number, held: ?number, code: ?number, look: boolean, int: boolean}}}
 *   the harness run's result (status the rc, the run's own output), and what run resolved
 */
const runUnder = (job, { env, ...seams } = {}) => {
  const { out, argv } = runCall(job, seams);
  return { res: run(process.execPath, argv, { env }), answers: answersIn(out) };
};

/**
 * runUnder started without waiting: the harness start handle, its pid the call's, and `answers()`, null until run resolved.
 * @param {object} job runJob's shape
 * @param {{env?: object, before?: string, launch?: string, detached?: boolean}} [opts] runUnder's, and start's detached
 * @returns {object} start's handle, with answers()
 */
const startRun = (job, { env, detached, ...seams } = {}) => {
  const { out, argv } = runCall(job, seams);
  const call = start(process.execPath, argv, { env, detached });
  call.answers = () => answersIn(out);
  return call;
};

module.exports = {
  kitUnder, kitUnderAsync, runJob, runUnder, startRun,
};
