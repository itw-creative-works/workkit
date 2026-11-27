/**
 * workflow/workkit/main.js: the command's run once the floor is met: the list
 * guard, the hand-off to the command log, then the route. Each piece is loaded
 * where it is needed, so a missing one stops only the commands that need it,
 * with one line naming it.
 * Usage: const { main, dispatch } = require('./main');
 */

const path = require('path');
const { writeErr } = require('../lib/say');
const { nativePath, unreadPathStop } = require('../lib/platform');

// The commands with a file of their own here, and the function each runs;
// every other listed word is the routing table's (verbs.js).
const ROUTES = {
  setup: ['setup', 'setup'],
  update: ['update', 'update'],
  doctor: ['doctor', 'doctor'],
  publish: ['commands', 'publish'],
  brief: ['commands', 'brief'],
  test: ['commands', 'test'],
  tools: ['commands', 'tools'],
  convert: ['commands', 'convert'],
  log: ['log', 'log'],
};

const HELP_WORDS = ['help', '-h', '--help'];

/** One of the command's own files, loaded now; a missing one throws as require does. */
const own = (rel) => require(path.join(__dirname, rel));

/**
 * The file of the kit a failed require found missing, or null for any other
 * failure (a missing package is not the kit's own file).
 * @param {Error} err
 * @returns {string|null}
 */
const missingOf = (err) => {
  if (err.code !== 'MODULE_NOT_FOUND' || !Array.isArray(err.requireStack)) return null;
  // The whole first line between its first and last quote, so a path holding `'` stays whole.
  const request = (/^Cannot find module '(.*)'$/m.exec(err.message) || [])[1];
  if (!request || !/^(\.|\/|[A-Za-z]:[\\/])/.test(request)) return null;
  const file = path.resolve(path.dirname(err.requireStack[0]), request);
  return path.extname(file) ? file : `${file}.js`;
};

/**
 * The command <argv> routed, unlogged, in this process.
 * @param {object} kit
 * @param {string[]} argv the command's arguments; an empty or missing first word is `help`
 * @returns {Promise<number>} the code the command ends with
 */
const dispatch = async (kit, argv) => {
  const verb = argv[0] || 'help';
  const args = argv.slice(1);
  if (HELP_WORDS.includes(verb)) {
    own('help.js').usage(process.stdout);
    return 0;
  }
  if (!(verb in ROUTES)) return own('verbs.js').route(kit, verb, args);
  const [file, fn] = ROUTES[verb];
  return own(`${file}.js`)[fn](kit, ...args);
};

/** The refusal of a word the list does not hold: the error, an empty line and the map on stderr, 1. */
const unknownCommand = (word) => {
  own('../lib/voice.js').error(`unknown command ${word}`);
  process.stderr.write('\n');
  own('help.js').usage(process.stderr);
  return 1;
};

/** The command log, or the route here; a call made inside a logged command is in that log already. */
const routed = (kit, argv) => {
  if (!kit.env.WK_COMMAND_LOGGED) {
    const log = own('../lib/command-log.js');
    const name = log.logName(argv);
    if (name !== null) return log.runLogged(kit, name, argv, dispatch);
  }
  return dispatch(kit, argv);
};

/** The guard, the command log and the route, in that order, then what the run left for its end. */
const run = async (argv) => {
  const verb = argv[0] || 'help';
  if (verb !== '-h' && verb !== '--help' && !own('command-list.js').commandListed(verb)) return unknownCommand(argv[0]);
  const kit = own('kit.js').kitOf();
  const code = await routed(kit, argv);
  // Each answers a promise (the handover page's wait), awaited in turn while signals still land.
  for (const atEnd of kit.run.atEnd) await atEnd();
  return code;
};

// The code a shell gives a command whose reader went away (128 + SIGPIPE's 13).
const PIPE_CLOSED = 141;

/**
 * A reader that closed early (`| head`) ends the command quietly with 141,
 * whether the failed write threw in a timer, a stream's error event or a
 * promise no one awaited; any other uncaught error ends it as Node's default does.
 */
const endOnClosedPipe = () => {
  process.on('uncaughtException', (err) => {
    if (err && err.code === 'EPIPE') process.exit(PIPE_CLOSED);
    writeErr(`${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
};

/**
 * The command: refuse a word the command list does not hold, hand a logged
 * command to the command log, else route it here.
 * @param {string[]} argv the command's arguments
 * @returns {Promise<number>} the code the command ends with; 1 with one line
 *   for a kit missing one of the command's own files or a path nativePath
 *   could not read; 141 when its reader closed early
 */
const main = async (argv) => {
  // The command starts loud whatever its caller set; update --auto quiets itself.
  process.env.QUIET = '0';
  endOnClosedPipe();
  try {
    return await run(argv);
  } catch (err) {
    if (err && err.code === 'EPIPE') return PIPE_CLOSED;
    const missing = missingOf(err);
    if (missing === null) return unreadPathStop(err);
    writeErr(`workkit: the kit is incomplete: ${nativePath(missing)} is missing\n`);
    return 1;
  }
};

module.exports = { main, dispatch };
