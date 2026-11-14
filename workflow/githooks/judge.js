/**
 * workflow/githooks/judge.js: `node judge.js <pre-commit|commit-msg> <root>
 * [<message file>]`, the git hooks' ruling on the commit git is making in
 * <root>, and `node judge.js tree-guard -- <argv...>`, the `git` shim's ruling
 * on one git call (workflow/gitshim/git). Its facts come from the real machine
 * (workflow/lib/io.js) in the caller's own environment, so git answers from the
 * commit's index. A deny goes to stderr and exits 1; notices go to stderr and exit 0.
 */

const fs = require('fs');
const path = require('path');
const { ioIn } = require('../lib/io');

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
  const { GIT_VALUE_FLAGS } = mod('tree-guard');
  let dir = cwd;
  for (let i = 0; i < argv.length && argv[i][0] === '-'; i += 1) {
    if (argv[i] === '-C' && argv[i + 1]) dir = path.resolve(dir, argv[i + 1]);
    if (GIT_VALUE_FLAGS.has(argv[i])) i += 1;
  }
  return dir;
}

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

const USAGE = 'usage: judge.js <pre-commit|commit-msg> <root> [<message file>] | judge.js tree-guard -- <argv...>\n';

/**
 * The ruling, said on stderr.
 * @param {string[]} argv the hook, the repo root, and commit-msg's message
 *   file; or `tree-guard`, `--` and git's arguments
 * @returns {Promise<number>} the exit code: 1 for a deny, 2 for a usage error
 */
async function main([hook, root, file, ...more]) {
  const isTree = hook === 'tree-guard' && root === '--';
  if (!isTree && (!root || !['pre-commit', 'commit-msg'].includes(hook) || (hook === 'commit-msg' && !file))) {
    process.stderr.write(USAGE);
    return 2;
  }
  const g = isTree ? null : mod('facts').bashFacts(ioIn(process.env), process.env, { cwd: root });
  let verdict;
  if (isTree) verdict = await treeGuard([file, ...more].filter((a) => a !== undefined));
  else if (hook === 'pre-commit') verdict = await mod('commit-gate').preCommitVerdict(mod('commit-gate').commitFacts(g, root));
  else verdict = await commitMsg(g, root, file);
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
