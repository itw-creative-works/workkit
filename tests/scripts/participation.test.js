//
// Tests for workflow/participation.sh: the engine's participation seam, the one
// home of what the kit means by a repo root and by a repo's own answer.
//
// The seam has its own suite because it has its own two consumers: the engine
// sources it (lib.sh, and standards.sh through it) and so does the hook layer
// beside it (hooks/_lib.sh, plus docs/session and safety/vendor-guard from their
// own physical location), and no consumer's suite owns it. Those suites prove
// their own callers answer correctly; this proves what the seam itself answers.
//
// Every case sources the real file in a real bash and reads what it printed,
// against fixtures on disk: a repo, a worktree whose `.git` is a FILE, a plain
// directory, and settings files carrying each of the three answers. Every
// expected value is a literal.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assertEq, testUnless, summary } = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NO_RC, NO_EXEC_BIT, shellPath,
} = require('../lib/platform');

const PARTICIPATION = shellPath(path.join(__dirname, '..', '..', 'workflow', 'participation.sh'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-participation-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source participation.sh and run one line of shell in it, the way every caller does. */
const inSeam = (script, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(PARTICIPATION)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** `yes` or `no`, so a predicate's answer is a value a case compares literally. */
const ask = (predicate, argument) => inSeam(
  `if ${predicate} ${JSON.stringify(shellPath(argument))}; then printf yes; else printf no; fi`,
).out;

/** A settings file holding `body`, under a directory of its own. */
const settingsFile = (dir, body) => {
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, body);
  return file;
};

const run = async () => {
  group('participation.sh: sourcing it');

  await test('sourcing defines the three functions', () => {
    // The contract this file shares with platform.sh: a caller sources it at
    // load time and gets functions, in a shell whose options are its own.
    const out = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    assertEq(out.code, 0, `it sources clean, stderr: ${out.err}`);
    assertEq(out.out, 'wk_is_repo_root wk_settings_declined wk_settings_enabled ',
      `the three, and nothing else named wk_*, got: ${out.out}`);
  });

  await test('sourcing sets no variable and runs nothing', () => {
    // A seam that set something would change the shell of every hook and script
    // that loads it before doing its own work.
    // The control runs `:` where the other sources the file, so the comparison
    // is the seam against a command that does nothing, rather than against a
    // shell that has run no command at all (bash sets PIPESTATUS at the first).
    const vars = (first) => spawnSync(
      BASH,
      [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: 20000 },
    );
    const before = vars(':');
    const after = vars(`. ${JSON.stringify(PARTICIPATION)}`);
    assertEq(after.stdout, before.stdout, 'the same variables as a shell that sourced nothing');
    assertEq(after.stderr, '', `and nothing printed at load, got: ${after.stderr}`);
  });

  group('participation.sh: wk_is_repo_root');

  await test('a checkout says yes and a plain directory says no', () => {
    const dir = mkTmp();
    const repo = path.join(dir, 'repo');
    const plain = path.join(dir, 'plain');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    assertEq(ask('wk_is_repo_root', repo), 'yes', 'a `.git` directory is a repo root');
    assertEq(ask('wk_is_repo_root', plain), 'no', 'a directory with no `.git` is not');
    cleanup(dir);
  });

  await test('a worktree says yes: its `.git` is a FILE', () => {
    // The whole reason the test is `-e` and never `-d`. A `-d` reading answers
    // no here, and every walk, guard and roster that asked would skip a
    // checkout that works perfectly.
    const dir = mkTmp();
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    git('-c', 'user.name=wk', '-c', 'user.email=wk@localhost', 'commit', '-q', '--allow-empty', '-m', 'chore: seed');
    const tree = path.join(dir, 'worktree');
    git('worktree', 'add', '-q', tree, '-b', 'side');
    assertEq(fs.statSync(path.join(tree, '.git')).isFile(), true, 'the fixture carries a `.git` FILE');
    assertEq(ask('wk_is_repo_root', tree), 'yes', 'a worktree is a repo root');
    cleanup(dir);
  });

  await test('a directory that does not exist says no', () => {
    const dir = mkTmp();
    assertEq(ask('wk_is_repo_root', path.join(dir, 'never-made')), 'no', 'nothing there is not a repo');
    cleanup(dir);
  });

  group('participation.sh: wk_settings_declined and wk_settings_enabled');

  const answers = (file) => `${ask('wk_settings_declined', file)}/${ask('wk_settings_enabled', file)}`;

  await test('a declined file is declined, and an enabled file is enabled', () => {
    const dir = mkTmp();
    assertEq(answers(settingsFile(dir, '{ "version": 1, "enabled": false }\n')), 'yes/no',
      'the deliberate no');
    cleanup(dir);
    const other = mkTmp();
    assertEq(answers(settingsFile(other, '{ "version": 1, "enabled": true }\n')), 'no/yes', 'the yes');
    cleanup(other);
  });

  await test('a file with no `enabled` key is neither: the legacy opt-in', () => {
    // The two are not each other's negation, and this is the case that says so:
    // a file written before the key existed is a yes by being no DECLINE.
    const dir = mkTmp();
    assertEq(answers(settingsFile(dir, '{ "version": 1 }\n')), 'no/no', 'neither declined nor enabled');
    cleanup(dir);
  });

  await test('the spacing of the key is not the answer', () => {
    // The published file is jq's, which spaces the colon; a hand-edited one may
    // not, and the repo's answer cannot depend on that.
    const dir = mkTmp();
    assertEq(answers(settingsFile(dir, '{"enabled":false}\n')), 'yes/no', 'no space after the colon');
    cleanup(dir);
    const spaced = mkTmp();
    assertEq(answers(settingsFile(spaced, '{ "enabled"  :   true }\n')), 'no/yes', 'and spaces around it');
    cleanup(spaced);
  });

  await test('a missing file and an empty file are both no answer at all', () => {
    const dir = mkTmp();
    assertEq(answers(path.join(dir, 'settings.json')), 'no/no', 'a file that is not there');
    assertEq(answers(settingsFile(dir, '')), 'no/no', 'and one holding nothing');
    cleanup(dir);
  });

  await testUnless(IS_WINDOWS, NO_EXEC_BIT)('an unreadable file is no answer, and says nothing on stderr', () => {
    // A guard reading this must not print the shell's complaint into a session's
    // context, so the silencing lives in the seam rather than at each call.
    const dir = mkTmp();
    const file = settingsFile(dir, '{ "enabled": false }\n');
    fs.chmodSync(file, 0o000);
    const out = inSeam(`wk_settings_declined ${JSON.stringify(shellPath(file))}; printf 'rc=%s' "$?"`);
    assertEq(out.out, 'rc=1', 'unreadable is not a decline');
    assertEq(out.err, '', `and nothing reaches stderr, got: ${out.err}`);
    fs.chmodSync(file, 0o600);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
