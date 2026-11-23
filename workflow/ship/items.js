#!/usr/bin/env node
// workflow/ship/items.js (`workkit ship items [--repo owner/name]`): what a ship
// carries, with the proof call already read: the open issues at `status:qa` then
// `status:complete`, one `<stage> #<N> <proved|unproved> <title>` line each.
// Without --repo gh resolves the repo from the current directory.

const { PublicError, runGh, ghJson } = require('../public/lib');
const { sayAs } = require('../lib/say');
const { PROOF_RE } = require('../../hooks/mods/proof.js');

const USAGE = 'usage: workkit ship items [--repo owner/name]';
// A usage error is exit 2, the code watch.js beside it uses for one.
const USAGE_CODE = 2;

const say = sayAs('ship-items');

/** A stop the verb names on stderr before it exits 1. */
class ItemsError extends Error {}

/**
 * The --repo arguments gh gets, the last --repo winning, or a usage line.
 * @param {string[]} argv the verb's arguments
 * @returns {{repoArgs: string[]}|{usage: string}}
 */
const parseArgs = (argv) => {
  let repoArgs = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== '--repo') return { usage: `unknown argument: ${argv[i]}` };
    if (!argv[i + 1]) return { usage: '--repo needs a value' };
    repoArgs = ['--repo', argv[i + 1]];
  }
  return { repoArgs };
};

/**
 * Whether an issue carries a comment line opening `Proof:`.
 * @param {object} issue one entry of gh's list
 * @returns {boolean}
 */
const proved = (issue) => issue.comments.some((comment) => PROOF_RE.test(comment.body));

/**
 * One stage's lines, by issue number.
 * @param {string} stage `qa` or `complete`
 * @param {string[]} repoArgs the --repo arguments, empty for gh's own pick
 * @returns {string[]}
 * @throws {ItemsError} when gh fails or answers no readable list
 */
const stageLines = (stage, repoArgs) => {
  let answer = null;
  const gh = (args, opts) => {
    answer = runGh(args, opts);
    return answer;
  };
  let issues;
  try {
    issues = ghJson(gh, ['issue', 'list', '--state', 'open', '--label', `status:${stage}`,
      '--json', 'number,title,comments', '--limit', '1000', ...repoArgs], process.cwd());
  } catch (err) {
    if (!(err instanceof PublicError)) throw err;
    if (!answer.ok) {
      const reason = answer.stderr.replace(/\r/g, '').split('\n').find((line) => line !== '');
      throw new ItemsError(`gh issue list failed for status:${stage}: ${reason || 'no reason given'}`);
    }
    // An answer of nothing at all lists no issue, as jq read it.
    issues = answer.stdout.trim() === '' ? [] : null;
  }
  if (!Array.isArray(issues)) throw new ItemsError(`gh answered no readable issue list for status:${stage}`);
  return [...issues].sort((a, b) => a.number - b.number)
    .map((issue) => `${stage} #${issue.number} ${proved(issue) ? 'proved' : 'unproved'} ${issue.title}`);
};

/**
 * The verb: both stages read before anything prints, so a failure on the
 * second leaves stdout empty rather than half a list.
 * @param {string[]} argv the verb's arguments
 * @returns {number} the exit code
 */
const main = (argv) => {
  const args = parseArgs(argv);
  if (args.usage) {
    say(`${args.usage} (${USAGE})`);
    return USAGE_CODE;
  }
  let lines;
  try {
    lines = [...stageLines('qa', args.repoArgs), ...stageLines('complete', args.repoArgs)];
  } catch (err) {
    if (!(err instanceof ItemsError)) throw err;
    say(err.message);
    return 1;
  }
  process.stdout.write(lines.length === 0 ? 'ship-items: nothing at qa or complete\n' : `${lines.join('\n')}\n`);
  return 0;
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
