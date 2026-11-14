// Tests for workflow/lib/slug.sh, the engine's slug seam: `owner/repo` out of
// whatever git hands back for a remote. Sourced directly, so a second parse in
// lib.sh cannot pass here. Its Node twin, `slugFromRemote` in workflow/slug.js,
// is cased against the same forms in test/tower/repos.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC, NODE_DIR, shellPath, gitPath, systemPathWith,
} = require('../lib/platform');
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
      timeout: SPAWN_DEADLINE,
    },
  );
  expect(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/**
 * The answer, with the shell's own status read first: the empty answer is a
 * real one here, and a shell that never sourced the seam prints exactly the
 * same thing, so nothing below may compare it without asking the status too.
 */
const slug = (url) => {
  const { code, out, err } = inSeam('wk_slug_from_remote "$1"', [url]);
  expect(code, `the shell sourced the seam and answered: ${err}`).toBe(0);
  return out;
};

describe('slug.sh: sourcing it', () => {
  test('sourcing defines the four functions', () => {
    // The contract this file shares with platform.sh and participation.sh: a
    // caller sources it at load time and gets functions, in a shell whose
    // options are its own.
    const out = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    expect(out.code, `it sources clean, stderr: ${out.err}`).toBe(0);
    expect(out.out, `the four, and nothing else named wk_*, got: ${out.out}`).toBe('wk_is_kit_checkout wk_repo_slug wk_roster_path wk_slug_from_remote ');
  });

  test('sourcing sets no variable and runs nothing', () => {
    // A seam that set something would change the shell of every caller. The
    // control runs `:` where the other sources the file, so the comparison is
    // against a command that does nothing (bash sets PIPESTATUS at the first).
    const vars = (first) => spawnSync(
      BASH,
      [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE },
    );
    const before = vars(':');
    const after = vars(`. ${JSON.stringify(SLUG)}`);
    expect(after.stdout, 'the same variables as a shell that sourced nothing').toBe(before.stdout);
    expect(after.stderr, `and nothing printed at load, got: ${after.stderr}`).toBe('');
  });
});

describe('slug.sh: wk_slug_from_remote', () => {
  test('every form git writes a GitHub remote in answers the same slug', () => {
    expect(slug('git@github.com:owner/repo.git'), 'ssh shorthand').toBe('owner/repo');
    expect(slug('ssh://git@github.com/owner/repo'), 'ssh URL').toBe('owner/repo');
    expect(slug('https://github.com/owner/repo.git'), 'https').toBe('owner/repo');
    expect(slug('https://github.com/owner/repo/'), 'a trailing slash').toBe('owner/repo');
    expect(slug('https://github.com/owner/repo//'), 'every trailing slash, not one').toBe('owner/repo');
  });

  test('a local path answers in either separator, the native Windows one included', () => {
    expect(slug('/Users/x/theirs.git'), 'a POSIX path').toBe('x/theirs');
    expect(slug('C:/Users/x/theirs.git'), 'the mixed form Git Bash prints').toBe('x/theirs');
    expect(slug('C:\\Users\\x\\theirs.git'), 'the native form git stores verbatim').toBe('x/theirs');
    expect(slug('C:\\Users\\x\\theirs.git\\'), 'and a trailing backslash comes off like a trailing slash').toBe('x/theirs');
  });

  test('a remote with no owner segment answers nothing', () => {
    expect(slug(''), 'no remote at all').toBe('');
    expect(slug('notaremote'), 'a bare word').toBe('');
  });
});

describe('slug.sh: wk_is_kit_checkout', () => {
  test('a git dir whose origin is a workkit repo is the kit; any other is not', () => {
    const repoWith = (origin) => mkOriginRepo(mkTmp('slug-'), origin);
    const answer = (dir) => inSeam('wk_is_kit_checkout "$1"', [dir]).code;
    expect(answer(shellPath(repoWith('https://github.com/owner/workkit.git'))), 'owner/workkit answers yes').toBe(0);
    expect(answer(shellPath(repoWith('https://github.com/owner/other.git'))), 'owner/other answers no').toBe(1);
    expect(answer(''), 'an empty argument answers no').toBe(1);
  });
});

describe('slug.sh: wk_roster_path', () => {
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

  test('an enabled entry whose origin is the slug answers its folder', () => {
    const { home, enabled } = rosterWorld();
    const { code, out, err } = roster(home, 'Owner/Mine');
    expect(code, `found, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the roster folder, as the roster keys it').toBe(gitPath(enabled));
  });

  test('the slug matches in any letter case', () => {
    const { home, enabled } = rosterWorld();
    const { code, out, err } = roster(home, 'owner/MINE');
    expect(code, `found, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the same folder').toBe(gitPath(enabled));
  });

  test('a declined entry is never matched', () => {
    const { home } = rosterWorld();
    const { code, out } = roster(home, 'owner/theirs');
    expect(code, 'a declined repo has not opted in').toBe(1);
    expect(out, `prints nothing, got: ${out}`).toBe('');
  });

  test('with a match, the first enabled folder it accepts answers, handed the slug lowercased', () => {
    const { home, enabled } = rosterWorld();
    // The match accepts any folder holding a `paired` file naming the slug, the declined one included.
    const { repos } = JSON.parse(fs.readFileSync(path.join(home, '.workkit', '.repos.json'), 'utf8'));
    for (const folder of Object.keys(repos)) fs.writeFileSync(path.join(folder, 'paired'), 'acme/public\n');
    const paired = 'paired() { [[ "$(cat "$1/paired" 2>/dev/null)" == "$2" ]]; }';
    const { code, out, err } = inSeam(`${paired}\nwk_roster_path "$1" paired`, ['Acme/Public'], home);
    expect(code, `found, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the enabled folder the match accepts, never the declined one').toBe(gitPath(enabled));
  });

  test('a slug no roster entry carries returns 1', () => {
    const { home } = rosterWorld();
    const { code, out } = roster(home, 'owner/absent');
    expect(code, 'not on the roster').toBe(1);
    expect(out, `prints nothing, got: ${out}`).toBe('');
  });
});
