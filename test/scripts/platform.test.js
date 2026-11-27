// Tests for workflow/lib/platform.sh: the shell's platform seam, the one home of
// the spellings macOS, Windows (Git Bash) and Linux disagree about. The hooks, the
// shims and the starters source it, so it has its own suite; the Windows branch is
// driven by an inherited OSTYPE plus a `cygpath` on PATH.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NO_RC, shellPath, cygpathStub,
  stubTool, stubNode, pathWith, systemPathWith, linkTool, which, joinPath, WINDOWS_CSC, samePath, spawnBash,
} = require('../lib/platform');

const PLATFORM = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source platform.sh and run one line of shell in it, the way every caller does. */
const inPlatform = (script, env = {}) => {
  const res = spawnBash([...NO_RC, '-c', `. ${JSON.stringify(PLATFORM)}\n${script}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** A PATH directory holding the seam's cygpath, the Windows branch's one tool. */
const cygpathWorld = () => {
  const dir = mkTmp('wf-platform-');
  cygpathStub(dir);
  return dir;
};

/** A scratch home and a PATH folder, each holding the node stubs `nodes` names (`path`, `default`, nvm `vX.Y.Z`). */
const nodeWorld = (nodes) => {
  const dir = mkTmp('wf-platform-node-');
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  for (const [where, version] of Object.entries(nodes)) {
    if (where === 'path') stubNode(bin, version);
    else if (where === 'default') stubNode(path.join(home, '.nvm', 'default-bin'), version);
    else stubNode(path.join(home, '.nvm', 'versions', 'node', where, 'bin'), version);
  }
  fs.mkdirSync(bin, { recursive: true });
  return { env: { PATH: systemPathWith(bin), HOME: shellPath(home) }, bin, home };
};

describe('platform.sh: wk_native_path', () => {
  test('on the Windows branch a path is spelled the way git spells it', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_native_path /c/Users/x', {
      OSTYPE: 'msys', PATH: pathWith(dir),
    });
    expect(out, `the mixed form, got: ${JSON.stringify(out)}`).toBe('C:/Users/x');
    cleanup(dir);
  });

  test('cygwin takes the same branch as msys', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_native_path /c/Users/x', {
      OSTYPE: 'cygwin', PATH: pathWith(dir),
    });
    expect(out, `one branch for both runtimes, got: ${JSON.stringify(out)}`).toBe('C:/Users/x');
    cleanup(dir);
  });

  test('the answer carries no trailing newline, so a key is the path alone', () => {
    const dir = cygpathWorld();
    const { out } = inPlatform('wk_native_path /c/Users/x; printf "|"', {
      OSTYPE: 'msys', PATH: pathWith(dir),
    });
    expect(out, `nothing after the path, got: ${JSON.stringify(out)}`).toBe('C:/Users/x|');
    cleanup(dir);
  });

  test('this machine answers for itself: unchanged off Windows, git\'s spelling on it', () => {
    // No OSTYPE override and no stub: the shell's own answer, which is the one
    // every real run of the engine gets. The drive-mount spelling is the input
    // because it is the one that differs: off Windows it comes back byte for
    // byte, which is the identity this seam promises there.
    const { out } = inPlatform('wk_native_path /c/Users/x/repo; printf "|"');
    const expected = IS_WINDOWS ? 'C:/Users/x/repo|' : '/c/Users/x/repo|';
    expect(out, `the platform's own spelling, got: ${JSON.stringify(out)}`).toBe(expected);
  });

  test('a linux OSTYPE is the identity too, with no cygpath anywhere near it', () => {
    const { out } = inPlatform('wk_native_path /home/x/repo; printf "|"', { OSTYPE: 'linux-gnu' });
    expect(out, `untouched, got: ${JSON.stringify(out)}`).toBe('/home/x/repo|');
  });

  test('sourcing the file runs nothing and sets nothing', () => {
    const { out } = inPlatform('printf "sourced"');
    expect(out, `only what the caller asked for, got: ${JSON.stringify(out)}`).toBe('sourced');
  });

  test('wk_native_path off Windows prints its input, a drive-mount spelling included', {
    skip: IS_WINDOWS && 'off-Windows identity; the Windows spelling is the case below',
  }, () => {
    const { code, out } = inPlatform('wk_native_path /d/a/x');
    expect(code, 'answered').toBe(0);
    expect(out.replace(/\n$/, ''), `unchanged, got: ${JSON.stringify(out)}`).toBe('/d/a/x');
  });

  test('wk_native_path on Windows prints the drive form a person reads', {
    skip: !IS_WINDOWS && 'the native spelling exists only under Git Bash on Windows',
  }, () => {
    const { code, out } = inPlatform('wk_native_path /d/a/x');
    expect(code, 'answered').toBe(0);
    expect(out.replace(/\n$/, ''), `the native spelling, got: ${JSON.stringify(out)}`).toBe('D:/a/x');
  });
});

describe('platform.sh: wk_user_dir', () => {
  test('wk_user_dir: WORKFLOW_HOME wins, else ~/.workkit, and an unset HOME never aborts set -u', () => {
    expect(inPlatform('wk_user_dir', { WORKFLOW_HOME: '/w/kit', HOME: '/h' }).out, 'the override').toBe('/w/kit\n');
    expect(inPlatform('wk_user_dir', { HOME: '/h' }).out, 'the default').toBe('/h/.workkit\n');
    const bare = inPlatform('set -u; unset HOME; wk_user_dir');
    expect(bare.code, `no unbound-variable abort: ${bare.err}`).toBe(0);
    expect(bare.out, 'the default with no HOME').toBe('/.workkit\n');
  });
});

describe('platform.sh: wk_node', () => {
  test('the finder\'s floor is the engines floor of the root package.json and of packages/core/package.json', () => {
    const { code, out, err } = inPlatform('printf "%s" "$WK_NODE_FLOOR"');
    expect(code, `the floor was read, stderr: ${err}`).toBe(0);
    const kit = path.join(__dirname, '..', '..');
    for (const file of [path.join(kit, 'package.json'), path.join(kit, 'packages', 'core', 'package.json')]) {
      const { engines } = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(`>=${out}`, `${path.relative(kit, file)}'s engines.node against WK_NODE_FLOOR`).toBe(engines.node);
    }
  });

  test('wk_node: a PATH node at 22.21, one below the floor, is passed over for the newer one nvm keeps', () => {
    const w = nodeWorld({ path: '22.21.9', 'v24.1.0': '24.1.0' });
    const { code, out, err } = inPlatform('wk_node', w.env);
    expect(code, `a qualifying node was found, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the nvm node, not the PATH one').toBe(`${shellPath(w.home)}/.nvm/versions/node/v24.1.0/bin/node`);
  });

  test('wk_node: a PATH node at exactly 22.22.0 is the pick, ahead of a newer nvm node', () => {
    const w = nodeWorld({ path: '22.22.0', 'v24.1.0': '24.1.0' });
    const { code, out, err } = inPlatform('wk_node', w.env);
    expect(code, `the floor itself qualifies, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the PATH node, first in the order').toBe(`${shellPath(w.bin)}/node`);
  });

  test('wk_node: with no node at 22.22 or newer anywhere it looks, it prints nothing and exits 1', () => {
    const w = nodeWorld({ path: '20.15.1', default: '21.7.3', 'v18.20.4': '18.20.4' });
    const { code, out } = inPlatform('wk_node', w.env);
    expect(code, 'none qualifies').toBe(1);
    expect(out, `no path printed, got: ${JSON.stringify(out)}`).toBe('');
  });
});

// The test library's own seam rather than platform.sh: the `.exe` launcher
// test/lib/platform.js puts beside a PATH stub so Node starts it by name.
describe('test/lib/platform.js: the stub launcher', () => {
  const onlyWindows = (!IS_WINDOWS || !fs.existsSync(WINDOWS_CSC)) && 'the launcher needs Windows and its C# compiler';

  test('a stub is started from Node by its bare name, its argv whole and its exit code back', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'gh', ['#!/bin/bash', 'echo "$1|$2"', 'exit 3']);
    const res = spawnSync('gh', ['a "b" c', 'd e'],
      { env: { ...process.env, PATH: pathWith(dir) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the stub's exit code, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(3);
    expect(res.stdout, 'each argument whole, quotes and spaces kept').toBe('a "b" c|d e\n');
    cleanup(dir);
  });

  test('an exe mirrored by linkTool is started from Node by its bare name', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    linkTool(dir, which('git'));
    expect(fs.existsSync(path.join(dir, 'git.exe')), 'the mirror holds the launcher, ahead of the real git on PATH').toBeTruthy();
    const res = spawnSync('git', ['--version'],
      { env: { ...process.env, PATH: joinPath(dir, SYSTEM_PATH) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `git answered, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith('git version'), `git's own answer, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    cleanup(dir);
  });

  test('two stubs in one process share one launcher build', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'one', ['#!/bin/bash', 'exit 0']);
    const first = fs.readFileSync(path.join(dir, 'one.exe'));
    // csc stamps every build with a fresh id, so the byte-equal cache entry is this build;
    // only finished `<digest>.exe` entries are read, never another build's temp file.
    const cacheDir = path.join(os.tmpdir(), 'workkit-stub-launcher');
    const cached = fs.readdirSync(cacheDir).filter((name) => /^[0-9a-f]{12}\.exe$/.test(name))
      .map((name) => path.join(cacheDir, name)).filter((file) => fs.readFileSync(file).equals(first));
    expect(cached.length, `one cached launcher matches the copy, got: ${cached.join(', ')}`).toBe(1);
    const built = fs.statSync(cached[0]).mtimeMs;
    stubTool(dir, 'two', ['#!/bin/bash', 'exit 0']);
    expect(fs.readFileSync(path.join(dir, 'two.exe')).equals(first), 'the second stub got the same launcher').toBeTruthy();
    expect(fs.statSync(cached[0]).mtimeMs, 'csc did not run again: the cached build is untouched').toBe(built);
    cleanup(dir);
  });
});

describe('test/lib/platform.js: samePath', () => {
  test('samePath reads a Windows path in any spelling as one path, and nothing else as one', () => {
    expect(samePath('/d/a/x', 'D:\\a\\X', 'win32'), 'a drive mount, backslashes and case are one path on win32').toBe(true);
    expect(samePath('/d/a/x', '/d/a/y', 'win32'), 'two files stay two').toBe(false);
    expect(samePath('/a', '/A', 'darwin'), 'off win32 the case is part of the name').toBe(false);
  });
});
