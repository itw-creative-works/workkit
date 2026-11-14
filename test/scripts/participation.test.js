// Tests for workflow/lib/participation.sh: the engine's participation seam, the one
// home of what the kit means by a repo root and by a repo's own answer. The engine
// and the hook layer both source it, so it has its own suite; every case sources
// the real file against fixtures on disk and compares literals.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NO_RC, NO_EXEC_BIT, shellPath,
} = require('../lib/platform');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const PARTICIPATION_FILE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'participation.sh');
const PARTICIPATION = shellPath(PARTICIPATION_FILE);
// Where wk_node lives, which every caller sources before this seam.
const PLATFORM = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source participation.sh and run one line of shell in it, the way every caller does. */
const inSeam = (script, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(PARTICIPATION)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
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

describe('participation.sh: sourcing it', () => {
  test('sourcing defines the nine functions', () => {
    // The contract this file shares with platform.sh: a caller sources it at
    // load time and gets functions, in a shell whose options are its own.
    const out = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    expect(out.code, `it sources clean, stderr: ${out.err}`).toBe(0);
    expect(out.out, `the nine, and nothing else named wk_*, got: ${out.out}`).toBe('wk_githooks_kit wk_githooks_kitlike wk_githooks_spelled wk_is_repo_root wk_opted_in wk_session_judges wk_setting wk_settings_declined wk_settings_enabled ');
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
    const after = vars(`. ${JSON.stringify(PARTICIPATION)}`);
    expect(after.stdout, 'the same variables as a shell that sourced nothing').toBe(before.stdout);
    expect(after.stderr, `and nothing printed at load, got: ${after.stderr}`).toBe('');
  });
});

describe('participation.sh: wk_is_repo_root', () => {
  test('a checkout says yes and a plain directory says no', () => {
    const dir = mkTmp('wf-participation-');
    const repo = path.join(dir, 'repo');
    const plain = path.join(dir, 'plain');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    expect(ask('wk_is_repo_root', repo), 'a `.git` directory is a repo root').toBe('yes');
    expect(ask('wk_is_repo_root', plain), 'a directory with no `.git` is not').toBe('no');
    cleanup(dir);
  });

  test('a worktree says yes: its `.git` is a FILE', () => {
    // The whole reason the test is `-e` and never `-d`. A `-d` reading answers
    // no here, and every walk, guard and roster that asked would skip a
    // checkout that works perfectly.
    const dir = mkTmp('wf-participation-');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    git('-c', 'user.name=wk', '-c', 'user.email=wk@localhost', 'commit', '-q', '--allow-empty', '-m', 'chore: seed');
    const tree = path.join(dir, 'worktree');
    git('worktree', 'add', '-q', tree, '-b', 'side');
    expect(fs.statSync(path.join(tree, '.git')).isFile(), 'the fixture carries a `.git` FILE').toBe(true);
    expect(ask('wk_is_repo_root', tree), 'a worktree is a repo root').toBe('yes');
    cleanup(dir);
  });

  test('a directory that does not exist says no', () => {
    const dir = mkTmp('wf-participation-');
    expect(ask('wk_is_repo_root', path.join(dir, 'never-made')), 'nothing there is not a repo').toBe('no');
    cleanup(dir);
  });
});

describe('participation.sh: wk_settings_declined and wk_settings_enabled', () => {
  const answers = (file) => `${ask('wk_settings_declined', file)}/${ask('wk_settings_enabled', file)}`;

  test('a declined file is declined, and an enabled file is enabled', () => {
    const dir = mkTmp('wf-participation-');
    expect(answers(settingsFile(dir, '{ "version": 1, "enabled": false }\n')), 'the deliberate no').toBe('yes/no');
    cleanup(dir);
    const other = mkTmp('wf-participation-');
    expect(answers(settingsFile(other, OPT_IN_SHAPES.current)), 'the yes').toBe('no/yes');
    cleanup(other);
  });

  test('a file with no `enabled` key is neither', () => {
    // The two are not each other's negation, and this is the case that says so:
    // a file with no answer is no decline and no yes.
    const dir = mkTmp('wf-participation-');
    expect(answers(settingsFile(dir, '{ "version": 1 }\n')), 'neither declined nor enabled').toBe('no/no');
    cleanup(dir);
  });

  test('the spacing of the key is not the answer', () => {
    // The published file is jq's, which spaces the colon; a hand-edited one may
    // not, and the repo's answer cannot depend on that.
    const dir = mkTmp('wf-participation-');
    expect(answers(settingsFile(dir, '{"enabled":false}\n')), 'no space after the colon').toBe('yes/no');
    cleanup(dir);
    const spaced = mkTmp('wf-participation-');
    expect(answers(settingsFile(spaced, '{ "enabled"  :   true }\n')), 'and spaces around it').toBe('no/yes');
    cleanup(spaced);
  });

  test('a missing file and an empty file are both no answer at all', () => {
    const dir = mkTmp('wf-participation-');
    expect(answers(path.join(dir, 'settings.json')), 'a file that is not there').toBe('no/no');
    expect(answers(settingsFile(dir, '')), 'and one holding nothing').toBe('no/no');
    cleanup(dir);
  });

  test('under node, only the top-level enabled key declines, and text that does not parse is declined', () => {
    const declined = (body) => {
      const dir = mkTmp('wf-participation-');
      const file = settingsFile(dir, body);
      const out = inSeam(`. ${JSON.stringify(PLATFORM)}\nif wk_settings_declined ${JSON.stringify(shellPath(file))}; then printf yes; else printf no; fi`,
        { WORKKIT_NODE: shellPath(process.execPath) });
      cleanup(dir);
      return out.out;
    };
    expect(declined('{"enabled": true, "manager": {"enabled": false}}'), 'a nested enabled: false leaves an opted-in repo in').toBe('no');
    expect(declined('{"enabled": false}'), 'the top-level decline').toBe('yes');
    expect(declined('{"manager": {"enabled": false}}'), 'a nested decline alone is no decline').toBe('no');
    expect(declined('not json'), 'text that does not parse').toBe('yes');
    const both = (body) => {
      const dir = mkTmp('wf-participation-');
      const file = JSON.stringify(shellPath(settingsFile(dir, body)));
      const out = inSeam(`. ${JSON.stringify(PLATFORM)}\nfor f in wk_settings_declined wk_settings_enabled; do if $f ${file}; then printf yes; else printf no; fi; done`,
        { WORKKIT_NODE: shellPath(process.execPath) });
      cleanup(dir);
      return out.out;
    };
    expect(both(''), 'an empty file is no answer at all, neither declined nor enabled').toBe('nono');
    expect(both('  \n'), 'and so is a whitespace-only one').toBe('nono');
  });

  test('an unreadable file reads as declined, and says nothing on stderr', { skip: IS_WINDOWS && NO_EXEC_BIT }, () => {
    // A guard reading this must not print the shell's complaint into a session's
    // context, so the silencing lives in the seam rather than at each call. The
    // text says enabled, so only the unreadable read can make it a decline.
    const dir = mkTmp('wf-participation-');
    const file = settingsFile(dir, OPT_IN_SHAPES.current);
    fs.chmodSync(file, 0o000);
    const out = inSeam(`wk_settings_declined ${JSON.stringify(shellPath(file))}; printf 'rc=%s' "$?"`);
    expect(out.out, 'unreadable is a decline, as the hooks module reads it').toBe('rc=0');
    expect(out.err, `and nothing reaches stderr, got: ${out.err}`).toBe('');
    fs.chmodSync(file, 0o600);
    cleanup(dir);
  });
});

describe('participation.sh: wk_opted_in', () => {
  test('a repo opts in only with a top-level "enabled": true, and a machine file saying true turns none on', () => {
    // Every row runs under a home whose own settings file says "enabled": true,
    // so a reader that let the machine file answer would turn the no rows on.
    const home = mkTmp('wf-participation-');
    fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(home, '.workkit', 'settings.json'), '{ "enabled": true }\n');
    const shapes = {
      'enabled true': ['{ "enabled": true }', 'yes'],
      'enabled false': ['{ "enabled": false }', 'no'],
      'no enabled key': ['{ "hooks": {} }', 'no'],
      'an empty object': ['{}', 'no'],
      'a version alone': ['{ "version": 1 }\n', 'no'],
      'an empty file': ['', 'no'],
      'no settings file': [null, 'no'],
      'a folder named settings.json': [{}, 'no'],
    };
    for (const [name, [body, want]] of Object.entries(shapes)) {
      const root = mkTmp('wf-participation-');
      const settings = path.join(root, '.workkit', 'settings.json');
      if (body !== null) fs.mkdirSync(path.dirname(settings), { recursive: true });
      if (typeof body === 'string') fs.writeFileSync(settings, body);
      if (typeof body === 'object' && body !== null) fs.mkdirSync(settings);
      const out = inSeam(`. ${JSON.stringify(PLATFORM)}\nif wk_opted_in ${JSON.stringify(shellPath(root))}; then printf yes; else printf no; fi`,
        { HOME: shellPath(home), WORKFLOW_HOME: shellPath(path.join(home, '.workkit')) });
      expect(out.out, `${name}: ${want}, stderr: ${out.err}`).toBe(want);
      cleanup(root);
    }
    cleanup(home);
  });
});

describe('participation.sh: wk_setting', () => {
  /**
   * What `wk_setting <root> <key>` prints, parsed as JSON, for a repo whose file
   * holds `repo` and a machine file holding `user` (each an object, undefined for no file).
   */
  const setting = (key, { repo, user } = {}) => {
    const dir = mkTmp('wf-participation-');
    const root = path.join(dir, 'repo');
    const home = path.join(dir, 'home');
    for (const [where, body] of [[root, repo], [home, user]]) {
      fs.mkdirSync(path.join(where, '.workkit'), { recursive: true });
      if (body !== undefined) fs.writeFileSync(path.join(where, '.workkit', 'settings.json'), `${JSON.stringify(body)}\n`);
    }
    const out = inSeam(`. ${JSON.stringify(PLATFORM)}\nwk_setting ${JSON.stringify(shellPath(root))} ${key}`,
      { HOME: shellPath(home), WORKFLOW_HOME: shellPath(path.join(home, '.workkit')) });
    cleanup(dir);
    expect(out.code, `wk_setting ${key} answers, stderr: ${out.err}`).toBe(0);
    return JSON.parse(out.out.trim());
  };

  test('a key set in neither file prints the kit default', () => {
    expect(setting('findings.file'), 'findings.file').toBe(false);
  });

  test('the machine value where the repo sets none, the repo value where it does, false included', () => {
    expect(setting('findings.file', { repo: { enabled: true }, user: { findings: { file: true } } }), 'the machine value').toBe(true);
    expect(setting('findings.file', { repo: { enabled: true, findings: { file: false } }, user: { findings: { file: true } } }), 'the repo false').toBe(false);
  });

  test('a null leaves the lower layer\'s value, and an array replaces the lower one', () => {
    expect(setting('tests.budget', { repo: { enabled: true, tests: { budget: null } }, user: { tests: { budget: 5 } } }), 'a repo null leaves the machine budget').toBe(5);
    expect(JSON.stringify(setting('proof.rootOnly', { repo: { enabled: true, proof: { rootOnly: ['c'] } }, user: { proof: { rootOnly: ['a', 'b'] } } })), 'the repo list alone').toBe('["c"]');
  });

  test('kit defaults missing or broken: a line naming the file, and 1', () => {
    // A scratch kit holding this file, its defaults two folders above it as it
    // finds them, so a case can take the defaults away or break them.
    for (const [what, body] of [['missing', null], ['broken', '{ "enabled": ']]) {
      const kit = mkTmp('wf-participation-');
      const lib = path.join(kit, 'workflow', 'lib');
      fs.mkdirSync(lib, { recursive: true });
      fs.copyFileSync(PARTICIPATION_FILE, path.join(lib, 'participation.sh'));
      fs.mkdirSync(path.join(kit, 'defaults'));
      if (body !== null) fs.writeFileSync(path.join(kit, 'defaults', 'settings.json'), body);
      const script = `. ${JSON.stringify(PLATFORM)}\n. ${JSON.stringify(shellPath(path.join(lib, 'participation.sh')))}\nwk_setting ${JSON.stringify(shellPath(kit))} findings.file`;
      const res = spawnSync(BASH, [...NO_RC, '-c', script], {
        env: { PATH: SYSTEM_PATH, HOME: shellPath(kit), WORKFLOW_HOME: shellPath(kit) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const said = `${res.stdout || ''}${res.stderr || ''}`;
      expect(res.status, `${what}: 1, got: ${said}`).toBe(1);
      expect(/defaults[\\/]settings\.json/.test(said), `${what}: the line names the file, got: ${said}`).toBeTruthy();
      cleanup(kit);
    }
  });

  test('enabled is the repo file\'s alone: a machine true turns no repo on', () => {
    expect(setting('enabled', { repo: {}, user: { enabled: true } }), 'a repo file with no key').toBe(false);
    expect(setting('enabled', { user: { enabled: true } }), 'no repo file').toBe(false);
    expect(setting('enabled', { repo: { enabled: true }, user: { enabled: false } }), 'the repo true').toBe(true);
  });
});
