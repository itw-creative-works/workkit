/**
 * workflow/githooks/judge.js: `node judge.js <pre-commit|commit-msg> <root>
 * [<message file>]`, the git hooks' ruling on the commit git is making in
 * <root>. Its facts come from the real machine (workflow/lib/io.js) in the
 * hook's own environment, so git answers from the commit's index. A deny goes
 * to stderr and exits 1; notices go to stderr and exit 0.
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

// commit-msg's three rulings in order, the first deny ending it, the notices kept.
async function commitMsg(g, root, file) {
  const message = messageOf(fs.readFileSync(path.resolve(root, file), 'utf8'));
  const steps = [
    () => mod('commit-gate').commitMsgVerdict(mod('commit-gate').commitFacts(g, root, message)),
    async () => ((await g.originless()) ? null : mod('commit-language').commitLanguageVerdict(message)),
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
 * The hook's ruling, said on stderr.
 * @param {string[]} argv the hook, the repo root, and commit-msg's message file
 * @returns {Promise<number>} the exit code: 1 for a deny, 2 for a usage error
 */
async function main([hook, root, file]) {
  if (!root || !['pre-commit', 'commit-msg'].includes(hook) || (hook === 'commit-msg' && !file)) {
    process.stderr.write('usage: judge.js <pre-commit|commit-msg> <root> [<message file>]\n');
    return 2;
  }
  const g = mod('guards').bashFacts(ioIn(process.env), process.env, { command: '', cwd: root });
  const verdict = hook === 'pre-commit'
    ? await mod('commit-gate').preCommitVerdict(mod('commit-gate').commitFacts(g, root))
    : await commitMsg(g, root, file);
  if (verdict?.deny) {
    process.stderr.write(`${verdict.deny}\n`);
    return 1;
  }
  if (verdict?.context) process.stderr.write(`${verdict.context}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`${process.argv[2]}: the workkit judge failed before it could judge this commit, so the commit did not land: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, messageOf };
