/**
 * workflow/workkit/commands.js: five commands of the route, `publish`, `brief`,
 * `test`, `tools` and `convert`, each handing its run to a program: the site
 * publish, the brief's dispatch or the morning, the repo's own `npm test`, and
 * the kit's copy of workkit-core's bin.
 * Usage: const { publish, brief, test, tools, convert } = require('./commands');
 */

const path = require('path');
const { nodeRun, nodeRead, missingLine } = require('./kit');
const {
  ok, info, warn, error,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { readJsonOrNull } = require('../lib/read');
const { repoRoot } = require('../lib/git');
const { onPath, spawn } = require('../lib/run');
const { childEnd } = require('../lib/child-end');
const { hasTestScript } = require('../../hooks/mods/suite.js');
const { chomp } = require('../../hooks/mods/text.js');

/** The repo root as prove finds it, else this folder, so a verb runs the same from any folder. */
const rootHere = () => repoRoot(process.cwd()) ?? process.cwd();

/**
 * The site publish, the engine's own program, reachable from the one command.
 * A failure is a line and `kit.run.publishFailed`, never the code.
 * @param {object} kit
 * @param {...string} args handed to publish.js
 * @returns {Promise<number>} 0
 */
const publish = async (kit, ...args) => {
  kit.run.publishFailed = false;
  if (!isFile(kit.files.publish)) {
    warn(missingLine('site', kit.files.publish));
    kit.run.publishFailed = true;
    return 0;
  }
  if (await nodeRun(kit, kit.files.publish, args) !== 0) {
    warn(`site: the publish did not finish; run \`bash ${nativePath(path.join(kit.engine, 'publish.sh'))}\` to see why`);
    kit.run.publishFailed = true;
  }
  return 0;
};

/**
 * The brief dispatch's answer split as its program prints it: line 1 the
 * slug, the rest the line (dispatched) or the reason (refused, and only after
 * a newline), the trailing newlines dropped as a capture drops them.
 * @param {{code: number, stdout: string}} res
 * @returns {{slug: string, line: string, reason: string}}
 */
const dispatchAnswer = ({ code, stdout }) => {
  const out = chomp(stdout);
  const at = out.indexOf('\n');
  const slug = at < 0 ? out : out.slice(0, at);
  const rest = at < 0 ? '' : out.slice(at + 1);
  if (code === 0) return { slug, line: at < 0 ? out : rest, reason: '' };
  return { slug, line: '', reason: rest };
};

/**
 * Today's brief, asked for now: the scheduled morning's own dispatch, but a
 * refusal fails the command. `--local` is the whole local rehearsal.
 * @param {object} kit
 * @param {...string} args `--local`, or none
 * @returns {number|Promise<number>} 0 dispatched; 1 refused, a word it does not
 *   take, or a kit without the program; the morning's code under --local
 */
const brief = (kit, ...args) => {
  if (args[0] === '--local') {
    if (!isFile(kit.files.morning)) {
      error(`no morning job beside this engine (${nativePath(kit.files.morning)}), and this command needs the whole kit`);
      return 1;
    }
    return nodeRun(kit, kit.files.morning, ['--now']);
  }
  if (args.length > 0) {
    error(`brief takes --local or nothing, not ${args[0]}`);
    return 1;
  }
  if (!isFile(kit.files.briefDispatch)) {
    error(`no brief dispatch beside this engine (${nativePath(kit.files.briefDispatch)}), and this command needs the whole kit`);
    return 1;
  }
  const res = nodeRead(kit, kit.files.briefDispatch, [], { stdio: ['inherit', 'pipe', 'inherit'] });
  const { slug, line, reason } = dispatchAnswer(res);
  if (res.code !== 0) {
    warn(`brief: the day could not be handed to the cloud; ${reason}`);
    return 1;
  }
  ok(line);
  info(`watch it: https://github.com/${slug}/actions/workflows/${require(kit.files.briefDispatch).BRIEF_WORKFLOW}`);
  return 0;
};

/**
 * The repo's own `npm test` at its root with <args> after `--`, and nothing
 * else: npm runs it through the script shell, so the one recorder sees the run.
 * @param {object} kit
 * @param {...string} args handed to the runner
 * @returns {number|Promise<number>} npm's code; 1 inside an npm test, with no
 *   npm, or for a root with no test script
 */
const test = async (kit, ...args) => {
  // Inside an npm test, `workkit` is the package's bin; reaching this one means
  // it is missing, and running npm test again would loop.
  if (kit.env.npm_lifecycle_event === 'test') {
    error('test: workkit-core is not installed here: run npm install');
    return 1;
  }
  if (onPath('npm', { env: kit.env }) === null) {
    error('test: the verb runs npm test, and there is no npm on PATH');
    return 1;
  }
  const root = rootHere();
  if (!hasTestScript(readJsonOrNull(path.join(root, 'package.json')))) {
    error(`test: ${nativePath(root)}/package.json has no test script`);
    return 1;
  }
  const child = spawn('npm', ['test', '--', ...args], {
    stdio: 'inherit', cwd: root, env: kit.env, windowsHide: true,
  });
  return (await childEnd(child)).code;
};

/**
 * One verb of the kit's own copy of workkit-core's bin, run at the repo root,
 * so it answers before npm install; the error line is led by the verb.
 * @param {object} kit
 * @param {string} verb
 * @param {string[]} args
 * @returns {number|Promise<number>} the bin's code; 1 with no bin beside the engine
 */
const runCoreBin = (kit, verb, args) => {
  const bin = kit.files.coreBin;
  if (!isFile(bin)) {
    error(`${verb}: no workkit-core beside this engine (${nativePath(bin)}), and this command needs the whole kit`);
    return 1;
  }
  return nodeRun(kit, bin, [verb, ...args], { cwd: rootHere() });
};

/**
 * The tools the repo's suites name through needs(), so a cloud setup can read
 * the list before npm install.
 * @param {object} kit
 * @param {...string} args handed to the bin
 * @returns {number|Promise<number>} the bin's code
 */
const tools = (kit, ...args) => runCoreBin(kit, 'tools', args);

/**
 * The repo's old-shape suites rewritten onto Node's test functions, its paths
 * read from the repo root.
 * @param {object} kit
 * @param {...string} args handed to the bin
 * @returns {number|Promise<number>} the bin's code
 */
const convert = (kit, ...args) => runCoreBin(kit, 'convert', args);

module.exports = {
  publish, brief, test, tools, convert,
};
