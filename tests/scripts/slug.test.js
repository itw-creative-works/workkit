// Tests for workflow/lib/slug.sh, the engine's slug seam: `owner/repo` out of
// whatever git hands back for a remote. Sourced directly, so a second parse in
// lib.sh cannot pass here. Its Node twin, `slugFromRemote` in workflow/slug.js,
// is cased against the same forms in tests/tower/repos.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC, NODE_DIR, shellPath, gitPath, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mkOriginRepo } = require('../lib/git-repo');

const SLUG = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'slug.sh'));

/**
 * Source slug.sh and run one line of shell in it, the way every caller does.
 * A `home` makes the run that scratch home, with node on the PATH as a hook has it.
 */
const inSeam = (script, args = [], home = null) => {
  const res = spawnSync(
    BASH,
    [...NO_RC, '-c', `. ${JSON.stringify(SLUG)}\n${script}`, 'bash', ...args],
    {
      env: home ? { PATH: systemPathWith(NODE_DIR), HOME: shellPath(home) } : { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/**
 * The answer, with the shell's own status read first: the empty answer is a
 * real one here, and a shell that never sourced the seam prints exactly the
 * same thing, so nothing below may compare it without asking the status too.
 */
const slug = (url) => {
  const { code, out, err } = inSeam('wk_slug_from_remote "$1"', [url]);
  assertEq(code, 0, `the shell sourced the seam and answered: ${err}`);
  return out;
};

const run = async () => {
  group('slug.sh: sourcing it');

  await test('sourcing defines the four functions', () => {
    // The contract this file shares with platform.sh and participation.sh: a
    // caller sources it at load time and gets functions, in a shell whose
    // options are its own.
    const out = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    assertEq(out.code, 0, `it sources clean, stderr: ${out.err}`);
    assertEq(out.out, 'wk_is_kit_checkout wk_repo_slug wk_roster_path wk_slug_from_remote ',
      `the four, and nothing else named wk_*, got: ${out.out}`);
  });

  await test('sourcing sets no variable and runs nothing', () => {
    // A seam that set something would change the shell of every caller. The
    // control runs `:` where the other sources the file, so the comparison is
    // against a command that does nothing (bash sets PIPESTATUS at the first).
    const vars = (first) => spawnSync(
      BASH,
      [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: 20000 },
    );
    const before = vars(':');
    const after = vars(`. ${JSON.stringify(SLUG)}`);
    assertEq(after.stdout, before.stdout, 'the same variables as a shell that sourced nothing');
    assertEq(after.stderr, '', `and nothing printed at load, got: ${after.stderr}`);
  });

  group('slug.sh: wk_slug_from_remote');

  await test('every form git writes a GitHub remote in answers the same slug', () => {
    assertEq(slug('git@github.com:owner/repo.git'), 'owner/repo', 'ssh shorthand');
    assertEq(slug('ssh://git@github.com/owner/repo'), 'owner/repo', 'ssh URL');
    assertEq(slug('https://github.com/owner/repo.git'), 'owner/repo', 'https');
    assertEq(slug('https://github.com/owner/repo/'), 'owner/repo', 'a trailing slash');
    assertEq(slug('https://github.com/owner/repo//'), 'owner/repo', 'every trailing slash, not one');
  });

  await test('a local path answers in either separator, the native Windows one included', () => {
    assertEq(slug('/Users/x/theirs.git'), 'x/theirs', 'a POSIX path');
    assertEq(slug('C:/Users/x/theirs.git'), 'x/theirs', 'the mixed form Git Bash prints');
    assertEq(slug('C:\\Users\\x\\theirs.git'), 'x/theirs', 'the native form git stores verbatim');
    assertEq(slug('C:\\Users\\x\\theirs.git\\'), 'x/theirs', 'and a trailing backslash comes off like a trailing slash');
  });

  await test('a remote with no owner segment answers nothing', () => {
    assertEq(slug(''), '', 'no remote at all');
    assertEq(slug('notaremote'), '', 'a bare word');
  });

  group('slug.sh: wk_is_kit_checkout');

  await test('a git dir whose origin is a workkit repo is the kit; any other is not', () => {
    const repoWith = (origin) => mkOriginRepo(mkTmp('slug-'), origin);
    const answer = (dir) => inSeam('wk_is_kit_checkout "$1"', [dir]).code;
    assertEq(answer(shellPath(repoWith('https://github.com/owner/workkit.git'))), 0, 'owner/workkit answers yes');
    assertEq(answer(shellPath(repoWith('https://github.com/owner/other.git'))), 1, 'owner/other answers no');
    assertEq(answer(''), 1, 'an empty argument answers no');
  });

  group('slug.sh: wk_roster_path');

  // A scratch home whose roster (~/.workkit/.repos.json) holds one enabled and
  // one declined repo, keyed by the root in git's spelling as the engine keys it.
  const rosterWorld = () => {
    const home = mkTmp('slug-home-');
    const enabled = mkOriginRepo(mkTmp('slug-'), 'git@github.com:Owner/Mine.git');
    const declined = mkOriginRepo(mkTmp('slug-'), 'https://github.com/owner/theirs.git');
    const repos = { [gitPath(enabled)]: 'enabled', [gitPath(declined)]: 'declined' };
    fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(home, '.workkit', '.repos.json'), `${JSON.stringify({ version: 1, repos })}\n`);
    return { home, enabled };
  };
  const roster = (home, name) => inSeam('wk_roster_path "$1"', [name], home);

  await test('an enabled entry whose origin is the slug answers its folder', () => {
    const { home, enabled } = rosterWorld();
    const { code, out, err } = roster(home, 'Owner/Mine');
    assertEq(code, 0, `found, stderr: ${err}`);
    assertEq(out.trim(), gitPath(enabled), 'the roster folder, as the roster keys it');
  });

  await test('the slug matches in any letter case', () => {
    const { home, enabled } = rosterWorld();
    const { code, out, err } = roster(home, 'owner/MINE');
    assertEq(code, 0, `found, stderr: ${err}`);
    assertEq(out.trim(), gitPath(enabled), 'the same folder');
  });

  await test('a declined entry is never matched', () => {
    const { home } = rosterWorld();
    const { code, out } = roster(home, 'owner/theirs');
    assertEq(code, 1, 'a declined repo has not opted in');
    assertEq(out, '', `prints nothing, got: ${out}`);
  });

  await test('a slug no roster entry carries returns 1', () => {
    const { home } = rosterWorld();
    const { code, out } = roster(home, 'owner/absent');
    assertEq(code, 1, 'not on the roster');
    assertEq(out, '', `prints nothing, got: ${out}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
