/**
 * workflow/githooks/judge.js: `node judge.js <pre-commit|commit-msg> [<message
 * file>]`, the git hooks' ruling on the commit git is making in the repo it
 * runs in, and `node judge.js tree-guard [--too-deep <alias>] -- <argv...>`, the
 * `git` shim's ruling on one git call (workflow/gitshim/git). Each rules only
 * where the session rule holds for the repo's root (sessionJudges), else 0 and
 * no line. Its facts come from the real machine (workflow/lib/io.js) in the
 * caller's own environment, so git answers from the commit's index. A deny goes
 * to stderr and exits 1; notices go to stderr and exit 0. Its floor check is
 * written in syntax an older Node still reads, so the floor's line prints there.
 */

// The floor first, ahead of every other require, in syntax an older Node reads.
if (require.main === module) {
  const floor = require('../lib/floor');
  const below = floor.floorLine(process.version, floor.floorOf());
  if (below) {
    require('fs').writeSync(2, `${below}\n`);
    process.exit(1);
  }
}

const fs = require('fs');
const path = require('path');
const { ioIn } = require('../lib/io');
const { repoRoot } = require('../lib/git');
const { readOrNull } = require('../lib/read');

const MODS = path.join(__dirname, '..', '..', 'hooks', 'mods');
const mod = (name) => require(path.join(MODS, `${name}.js`));

// The line `git commit --verbose` puts above the diff; it and all below it are never committed.
const SCISSORS = '# ------------------------ >8 ------------------------';

/**
 * The message as git commits it under `-m` and `-F`, whose cleanup keeps
 * every `#` line: the scissors line and all below it dropped, and the blank
 * lines at either end trimmed.
 * @param {string} text the message file's text
 * @returns {string}
 */
function messageOf(text) {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  const cut = all.indexOf(SCISSORS);
  const kept = cut === -1 ? all : all.slice(0, cut);
  return kept.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

// commit-msg's four rulings in order, the first deny ending it, the notices kept.
async function commitMsg(g, root, file) {
  const message = messageOf(fs.readFileSync(path.resolve(root, file), 'utf8'));
  const steps = [
    () => mod('commit-gate').commitMsgVerdict(mod('commit-gate').commitFacts(g, root, message)),
    async () => ((await g.originless()) ? null : mod('commit-language').commitLanguageVerdict(message)),
    async () => (mod('settings').attributionOff(await mod('settings').rootSettings(root, g.env, g))
      ? mod('commit-attribution').commitAttributionVerdict(message) : null),
    () => mod('release-taken').releaseCommitVerdict({ subject: message.split('\n')[0], root, facts: g }),
  ];
  const notices = [];
  for (const step of steps) {
    const verdict = await step();
    if (verdict?.deny) return verdict;
    if (verdict?.context) notices.push(verdict.context);
  }
  return notices.length > 0 ? { context: notices.join('\n') } : null;
}

/**
 * The folder git acts in: each `-C <dir>` before the subcommand folded onto
 * `cwd` in order, each relative to the one before, an empty one no move.
 * @param {string[]} argv git's arguments
 * @param {string} cwd the folder git was started in
 * @returns {string}
 */
function gitFolder(argv, cwd) {
  const { GIT_VALUE_FLAGS, gitGlobals } = mod('tree-guard');
  const globals = gitGlobals(argv);
  let dir = cwd;
  for (let i = 0; i < globals.length; i += GIT_VALUE_FLAGS.has(globals[i]) ? 2 : 1) {
    if (globals[i] === '-C' && globals[i + 1]) dir = path.resolve(dir, globals[i + 1]);
  }
  return dir;
}

// Whether the session rule holds for the repo at <root>; no root is never judged.
function judged(root) {
  if (!root) return false;
  return mod('gate').sessionJudges(process.env, readOrNull(mod('settings').repoSettingsFile(root)));
}

// The refusal of an alias chain the shim could not follow to its verb.
const tooDeep = (alias) => ({
  deny: `tree-guard: BLOCKED this command: the git alias ${alias} is a chain deeper than five hops, so the verb it runs cannot be judged.\nRun the git command itself, spelled out, instead of the alias.`,
});

// tree-guard's ruling on git's real argument list, `exists` asked in the folder git acts in.
function treeGuard(argv) {
  const io = ioIn(process.env);
  const dir = gitFolder(argv, process.cwd());
  return mod('tree-guard').treeGuardVerdict({
    argv,
    exists: (rel) => io.exists(path.resolve(dir, rel)),
    allow: process.env.WORKKIT_ALLOW_DISCARD === '1',
  });
}

/**
 * The shim's call read: the alias a too-deep chain names, or null, and git's
 * arguments after `--`; null for any other shape.
 * @param {string[]} rest the arguments after `tree-guard`
 * @returns {{deep: string|null, call: string[]}|null}
 */
function treeArgs(rest) {
  if (rest[0] === '--') return { deep: null, call: rest.slice(1) };
  if (rest[0] === '--too-deep' && rest[1] && rest[2] === '--') return { deep: rest[1], call: rest.slice(3) };
  return null;
}

/**
 * A hook's call read: the root, git's top level of the folder the hook runs
 * in, and commit-msg's message file.
 * @param {string} hook
 * @param {string[]} rest the arguments after the hook
 * @returns {{root: string|null, file: string|undefined}|null} null for a wrong count
 */
function hookArgs(hook, rest) {
  if (rest.length !== (hook === 'commit-msg' ? 1 : 0)) return null;
  return { root: repoRoot(process.cwd()), file: rest[0] };
}

const USAGE = 'usage: judge.js <pre-commit|commit-msg> [<message file>] | judge.js tree-guard [--too-deep <alias>] -- <argv...>\n';

/**
 * The ruling, said on stderr.
 * @param {string[]} argv the hook and commit-msg's message file; or
 *   `tree-guard`, an optional `--too-deep <alias>`, `--` and git's arguments
 * @returns {Promise<number>} the exit code: 1 for a deny, 2 for a usage error
 */
async function main([hook, ...rest]) {
  const tree = hook === 'tree-guard' ? treeArgs(rest) : null;
  const call = ['pre-commit', 'commit-msg'].includes(hook) ? hookArgs(hook, rest) : null;
  if (!tree && !call) {
    process.stderr.write(USAGE);
    return 2;
  }
  const root = tree ? repoRoot(process.cwd(), mod('tree-guard').gitGlobals(tree.call)) : call.root;
  if (!judged(root)) return 0;
  let verdict;
  if (tree) verdict = tree.deep !== null ? tooDeep(tree.deep) : await treeGuard(tree.call);
  else {
    const g = mod('facts').bashFacts(ioIn(process.env), process.env, { cwd: root });
    if (hook === 'pre-commit') verdict = await mod('commit-gate').preCommitVerdict(mod('commit-gate').commitFacts(g, root));
    else verdict = await commitMsg(g, root, call.file);
  }
  if (verdict?.deny) {
    process.stderr.write(`${verdict.deny}\n`);
    return 1;
  }
  if (verdict?.context) process.stderr.write(`${verdict.context}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    const what = process.argv[2] === 'tree-guard' ? 'this git call, so git did not run' : 'this commit, so the commit did not land';
    process.stderr.write(`${process.argv[2]}: the workkit judge failed before it could judge ${what}: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, messageOf };
