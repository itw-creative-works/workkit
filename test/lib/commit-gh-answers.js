// commitGh's answers, run in the fake gh's own process (git-repo.js). It loads
// only Node's modules and plain test files, so the stand-in starts on any PATH a
// case narrows (docs/tests.md § The shape).

const fs = require('fs');
const { ghJq } = require('./gh-jq');

// What the fake gh's refused `workflow run` prints, as an Actions token without write gets.
const DISPATCH_REFUSAL = 'could not create workflow dispatch event: HTTP 403: Resource not accessible by integration';

/** The value after the last `-q`/`--jq` in `argv`, or '' when none is given. */
const jqOf = (argv) => argv.reduce((q, arg, i) => (argv[i - 1] === '-q' || argv[i - 1] === '--jq' ? arg : q), '');

/**
 * commitGh's answer to one call, its options as `config`; what it prints, and its exit code.
 * @returns {number}
 */
const answerCommitGh = ({
  issues, tags, lateFile, fails, createExit, createSays, onCreate, onView, runs, dispatchFails,
}, argv) => {
  const say = (text) => process.stdout.write(text);
  const complain = (text) => process.stderr.write(text);
  // A Function body sees only globals, so the call's argv and `require` are handed in.
  const runHook = (source) => new Function('argv', 'require', source)(argv, require);
  if (fails) {
    complain('gh: To get started with GitHub CLI, please run: gh auth login\n');
    return 1;
  }
  const command = `${argv[0]} ${argv[1]}`;
  const tag = argv[2];
  if (command === 'issue view') {
    if (!Object.hasOwn(issues, String(tag))) return 1;
    say(JSON.stringify(issues[tag]));
    return 0;
  }
  if (command === 'release view') {
    runHook(onView);
    if (tags.includes(tag)) { say(`${tag}\n`); return 0; }
    const late = JSON.parse(fs.readFileSync(lateFile, 'utf8'));
    if (Object.hasOwn(late, String(tag))) {
      if (late[tag] <= 0) { say(`${tag}\n`); return 0; }
      late[tag] -= 1;
      fs.writeFileSync(lateFile, JSON.stringify(late));
    }
    complain('release not found\n');
    return 1;
  }
  if (command === 'release create') {
    runHook(onCreate);
    if (createSays) complain(`${createSays}\n`);
    return createExit;
  }
  if (command === 'run list') {
    const q = jqOf(argv);
    say(q ? ghJq(q, runs) : JSON.stringify(runs));
    return 0;
  }
  if (command === 'workflow run' && dispatchFails.includes(tag)) {
    complain(`${DISPATCH_REFUSAL}\n`);
    return 1;
  }
  return 0;
};

module.exports = { answerCommitGh };
