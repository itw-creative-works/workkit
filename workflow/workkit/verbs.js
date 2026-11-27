/**
 * workflow/workkit/verbs.js: the routing table of every command that hands its
 * whole run to a Node program of the kit: the seven verbs with subcommands,
 * each `<verb> <sub>` its `<verb>/<sub>.js`, and `tower`, `enable`, `decline`,
 * `heal`, `state`, `prove`, `supervise`, `watch` and `note`. Each program
 * speaks for itself, and its code is the command's.
 * Usage: const { route } = require('./verbs');
 */

const path = require('path');
const { nodeRun, missingLine } = require('./kit');
const { commandVerbs } = require('./command-list');
const { error } = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');

// Each verb's subcommands, in the order its refusal names them.
const SUBCOMMANDS = {
  changelog: ['lint'],
  checkpoint: ['safe'],
  proof: commandVerbs('proof'),
  public: ['intake', 'mirror', 'close'],
  review: ['covers', 'mark'],
  triage: ['mark'],
  ship: commandVerbs('ship'),
};

// The program a subcommand runs, where it is not `<verb>/<sub>.js`.
const SUB_FILES = { 'checkpoint safe': 'checkpoint/mark.js' };

// The standards heal's flag for each verb that hands it the repo.
const STANDARDS_FLAGS = {
  enable: ['--enable'], decline: ['--decline'], heal: [], state: ['--state'],
};

/** Words as a sentence: `a`, `a or b`, `a, b or c`. */
const listed = (words) => (words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

/** <file> run as <step>'s program, or the line naming it missing from an incomplete kit, 1. */
const runProgram = (kit, step, file, args) => {
  if (!isFile(file)) {
    error(missingLine(step, file));
    return 1;
  }
  return nodeRun(kit, file, args);
};

/** `<verb> <sub>` run as its program, or the refusal naming the subcommands there are, 1. */
const runSub = (kit, verb, [sub = '', ...args]) => {
  if (!SUBCOMMANDS[verb].includes(sub)) {
    error(`${verb}: unknown subcommand ${sub || '(none)'}; use ${listed(SUBCOMMANDS[verb])}`);
    return 1;
  }
  const step = `${verb} ${sub}`;
  return runProgram(kit, step, path.join(kit.engine, SUB_FILES[step] || path.join(verb, `${sub}.js`)), args);
};

/** The tower, which lives in the kit beside the engine: a copy of the engine alone has none. */
const tower = (kit, args) => {
  if (!isFile(kit.files.tower)) {
    error(`tower: no tower beside this engine (${nativePath(kit.files.tower)}), and this command needs the whole kit`);
    return 1;
  }
  return nodeRun(kit, kit.files.tower, args);
};

/**
 * Run <verb> with <args>: one of the seven verbs with subcommands, or one of
 * the nine that hand the run to their program.
 * @param {object} kit
 * @param {string} verb
 * @param {string[]} args the words after the verb
 * @returns {number|Promise<number>} the program's code, or 1 for an unknown subcommand or a missing program
 * @throws {Error} a verb with no route here: the command list holds a word nothing routes
 */
const route = (kit, verb, args) => {
  if (verb in SUBCOMMANDS) return runSub(kit, verb, args);
  // Only the first argument reaches the heal; an empty or missing one is this folder.
  if (verb in STANDARDS_FLAGS) return runProgram(kit, verb, kit.files.standards, [...STANDARDS_FLAGS[verb], args[0] || process.cwd()]);
  if (verb === 'tower') return tower(kit, args);
  if (['prove', 'supervise', 'watch', 'note'].includes(verb)) return runProgram(kit, verb, kit.files[verb], args);
  throw new Error(`workkit: no route for the command ${verb}`);
};

module.exports = { route };
