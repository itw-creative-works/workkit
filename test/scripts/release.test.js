// Tests for workflow/ship/release.js: the ship's release commit in one command (the
// bump, the commit-link backfill, the dated section; a refusal writes nothing).
// Each case builds a real repo with real `Fixes #N` commits, and the child's scratch
// home reaches no gh account, so the handle is absent: the offline release. The
// bump runs the real npm, offline, so a fetch it tried would fail the case.

const path = require('path');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { skipWithoutNpm, npmEnv } = require('../lib/core-repo');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ship', 'release.js');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Today in the local calendar, the date a release section is headed with. */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Formatting no serializer would write, and a second `version` key below the
// top-level one, so "every other byte stays" is a claim the bytes can check.
const PACKAGE = [
  '{',
  '    "name":  "scratch",',
  '    "version": "1.2.3",',
  '    "description": "a fixture",',
  '    "config": { "version": "1.2.3" }',
  '}',
  '',
].join('\n');

// ` - ` in the fixtures below is the CHANGELOG entry separator (a spaced hyphen).
const UNRELEASED = [
  '## [Unreleased]',
  '',
  '### Added',
  '- [#1](../../issues/1) - First added thing.',
  '- [#2](../../issues/2) - Second added thing,',
  '  wrapped onto a second line.',
  '',
  '### Fixed',
  '- [#3](../../issues/3) - A fixed thing.',
  '',
];

const RELEASED = [
  '## [1.2.3] - 2026-01-01',
  '',
  '### Added',
  '- [#9](../../issues/9) [`abc1234`](../../commit/abc1234) - The first release.',
  '',
  '[1.2.3]: ../../releases/tag/v1.2.3',
  '',
];

const CHANGELOG = ['# Changelog', '', ...UNRELEASED, ...RELEASED].join('\n');

// A plugin repo's manifest, the second of the two files the commit gate reads a
// version stamp in, and the shape workkit itself has: a package.json with no
// version beside it.
const PLUGIN = [
  '{',
  '  "name": "scratch",',
  '  "description": "a fixture plugin",',
  '  "version": "1.2.3",',
  '  "author": { "name": "Test" }',
  '}',
  '',
].join('\n');
const UNVERSIONED = '{\n  "name": "scratch",\n  "private": true\n}\n';
// The kit's own shape: an unversioned workspace root over its packages/* members.
const WORKSPACE_ROOT = '{\n  "name": "scratch",\n  "private": true,\n  "workspaces": ["packages/*"]\n}\n';
const member = (name, version) => `{\n  "name": "${name}",\n  "version": "${version}",\n  "private": false\n}\n`;
const PLUGIN_FILE = path.join('.claude-plugin', 'plugin.json');

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
// A lockfile as npm writes one: the version at the top and in the root entry
// (absent when the root has none), and a dependency at the same version, which
// is not the package's and must not move.
const lockfile = (rootVersion, packages) => json({
  name: 'scratch',
  ...(rootVersion ? { version: rootVersion } : {}),
  lockfileVersion: 3,
  requires: true,
  packages,
});
const LOCK = lockfile('1.2.3', {
  '': { name: 'scratch', version: '1.2.3' },
  'node_modules/dep': { version: '1.2.3' },
});
const VERSIONED_ROOT = json({
  name: 'scratch', version: '1.2.3', private: true, workspaces: ['packages/*'],
});
/** A workspaces lockfile: the root entry, then each member's link and its own entry. */
const workspaceLock = (rootVersion) => lockfile(rootVersion, {
  '': { name: 'scratch', ...(rootVersion ? { version: rootVersion } : {}), workspaces: ['packages/*'] },
  'node_modules/scratch-core': { resolved: 'packages/core', link: true },
  'node_modules/scratch-other': { resolved: 'packages/other', link: true },
  'packages/core': { name: 'scratch-core', version: '1.2.3' },
  'packages/other': { name: 'scratch-other', version: '0.4.0' },
});
const MEMBERS = {
  'packages/core/package.json': member('scratch-core', '1.2.3'),
  'packages/other/package.json': member('scratch-other', '0.4.0'),
};

/** The text of a version file with its top-level version bumped to 1.3.0. */
const bumped = (text) => text.replace('"version": "1.2.3"', '"version": "1.3.0"');

const COMMITS = ['feat: one\n\nFixes #1', 'feat: two\n\nFixes #2', 'fix: three\n\nFixes #3'];

/**
 * A repo holding the CHANGELOG and the version files (`pkg`, and `plugin` when
 * given; a null `pkg` writes no package.json), any `files` (path to text), a
 * GitHub origin unless `remote` is false, then one commit per message.
 * The shas come back keyed by the issue each message closes.
 */
const mkRepo = ({
  changelog = CHANGELOG, pkg = PACKAGE, plugin = null, commits = COMMITS, remote = true, files = {},
} = {}) => {
  const dir = mkTmp('release-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  if (remote) git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  if (pkg !== null) fs.writeFileSync(path.join(dir, 'package.json'), pkg);
  if (plugin !== null) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'));
    fs.writeFileSync(path.join(dir, PLUGIN_FILE), plugin);
  }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  const shas = {};
  for (const message of commits) {
    fs.appendFileSync(path.join(dir, 'work.txt'), `${message}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    shas[/#(\d+)/.exec(message)[1]] = git(dir, 'rev-parse', '--short', 'HEAD');
  }
  return { dir, shas };
};

/** The script run from a scratch home against `--dir <repo>`. */
const release = (dir, args) => {
  const home = mkTmp('release-');
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir], {
    cwd: home,
    env: npmEnv(home, { npm_config_offline: 'true' }),
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  cleanup(home);
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const parsed = (dir, file) => JSON.parse(read(dir, file));
const exists = (dir, file) => fs.existsSync(path.join(dir, file));

/** An entry line as the backfill writes it, its commit link after the issue. */
const linked = (n, sha, text) => `- [#${n}](../../issues/${n}) [\`${sha}\`](../../commit/${sha}) - ${text}`;

/** The refusal shape: exit 1, one `release:` line on stderr, nothing on stdout or disk. */
const assertRefused = (dir, res, says) => {
  assertEq(res.code, 1, `exit 1 (stderr: ${res.stderr})`);
  assertEq(res.stdout, '', 'nothing on stdout');
  const lines = res.stderr.trim().split('\n');
  assertEq(lines.length, 1, `one stderr line, got: ${res.stderr}`);
  assert(lines[0].startsWith('release: '), `the line opens with release:, got: ${lines[0]}`);
  assert(lines[0].includes(says), `names why (${says}), got: ${lines[0]}`);
};

const cases = async () => {
  skipWithoutNpm();
  group('release: the version bump');

  await test('a single package moves package.json and both lockfile spots, and names each', () => {
    const { dir } = mkRepo({ files: { 'package-lock.json': LOCK } });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(JSON.stringify(parsed(dir, 'package.json')),
      '{"name":"scratch","version":"1.3.0","description":"a fixture","config":{"version":"1.2.3"}}', 'only the top-level version moved');
    const lock = parsed(dir, 'package-lock.json');
    assertEq(lock.version, '1.3.0', 'the lockfile\'s top-level version');
    assertEq(lock.packages[''].version, '1.3.0', 'the lockfile\'s root entry');
    assertEq(lock.packages['node_modules/dep'].version, '1.2.3', 'a dependency at the old number stays');
    assertEq(res.stdout, 'released 1.3.0 (package.json, package-lock.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names both');
    cleanup(dir);
  });

  await test('a plugin manifest alone is bumped, and named', () => {
    const { dir } = mkRepo({ pkg: null, plugin: PLUGIN });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, PLUGIN_FILE), bumped(PLUGIN), 'only the version line changed');
    assert(!exists(dir, 'package.json'), 'no package.json appears');
    assertEq(res.stdout, 'released 1.3.0 (.claude-plugin/plugin.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names it');
    cleanup(dir);
  });

  await test('a package.json with no version is left alone beside a versioned manifest', () => {
    const { dir } = mkRepo({ pkg: UNVERSIONED, plugin: PLUGIN });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, 'package.json'), UNVERSIONED, 'package.json untouched');
    assertEq(read(dir, PLUGIN_FILE), bumped(PLUGIN), 'the manifest bumped');
    assert(res.stdout.startsWith('released 1.3.0 (.claude-plugin/plugin.json): '), `names only the manifest, got: ${res.stdout}`);
    cleanup(dir);
  });

  await test('a plugin manifest moves with package.json and the lockfile, each keeping its own line ending', () => {
    const { dir } = mkRepo({ pkg: PACKAGE.replace(/\n/g, '\r\n'), plugin: PLUGIN, files: { 'package-lock.json': LOCK } });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, PLUGIN_FILE), bumped(PLUGIN), 'the manifest bumped, every other byte kept');
    const pkg = read(dir, 'package.json');
    assertEq(JSON.parse(pkg).version, '1.3.0', 'package.json bumped');
    assert(!/(^|[^\r])\n/.test(pkg), `package.json still CRLF, got: ${JSON.stringify(pkg)}`);
    assertEq(parsed(dir, 'package-lock.json').packages[''].version, '1.3.0', 'the lockfile bumped');
    assertEq(res.stdout, 'released 1.3.0 (package.json, .claude-plugin/plugin.json, package-lock.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names all three');
    cleanup(dir);
  });

  await test('a workspaces repo moves the root, each lockstep member and their lockfile entries; a member at another version stays', () => {
    const { dir } = mkRepo({ pkg: VERSIONED_ROOT, files: { ...MEMBERS, 'package-lock.json': workspaceLock('1.2.3') } });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(parsed(dir, 'package.json').version, '1.3.0', 'the root bumped');
    assertEq(parsed(dir, 'packages/core/package.json').version, '1.3.0', 'the lockstep member bumped');
    assertEq(read(dir, 'packages/other/package.json'), MEMBERS['packages/other/package.json'], 'the member at its own version untouched');
    const lock = parsed(dir, 'package-lock.json');
    assertEq(lock.version, '1.3.0', 'the lockfile\'s top-level version');
    assertEq(lock.packages[''].version, '1.3.0', 'the lockfile\'s root entry');
    assertEq(lock.packages['packages/core'].version, '1.3.0', 'the lockstep member\'s lockfile entry');
    assertEq(lock.packages['packages/other'].version, '0.4.0', 'the other member\'s lockfile entry stays');
    assert(!exists(dir, 'node_modules'), 'npm installed nothing');
    assertEq(res.stdout, 'released 1.3.0 (package.json, packages/core/package.json, package-lock.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names each file');
    cleanup(dir);
  });

  await test('an unversioned workspace root under a plugin manifest stays, and its lockstep member moves', () => {
    const { dir } = mkRepo({
      pkg: WORKSPACE_ROOT, plugin: PLUGIN, files: { ...MEMBERS, 'package-lock.json': workspaceLock(null) },
    });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, PLUGIN_FILE), bumped(PLUGIN), 'the manifest bumped');
    assertEq(read(dir, 'package.json'), WORKSPACE_ROOT, 'the unversioned root untouched');
    assertEq(parsed(dir, 'packages/core/package.json').version, '1.3.0', 'the lockstep member bumped');
    const lock = parsed(dir, 'package-lock.json');
    assertEq(lock.packages['packages/core'].version, '1.3.0', 'its lockfile entry bumped');
    assertEq(lock.version, undefined, 'the lockfile gains no root version');
    cleanup(dir);
  });

  await test('a lockstep member with no name moves by its folder', () => {
    const nameless = '{\n  "version": "1.2.3",\n  "private": true\n}\n';
    const { dir } = mkRepo({ pkg: WORKSPACE_ROOT, plugin: PLUGIN, files: { 'packages/core/package.json': nameless } });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(parsed(dir, 'packages/core/package.json').version, '1.3.0', 'the nameless member bumped');
    cleanup(dir);
  });

  await test('a workspaces repo with no lockfile gets none, and its lockstep member moves', () => {
    const { dir } = mkRepo({ pkg: VERSIONED_ROOT, files: MEMBERS });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(parsed(dir, 'package.json').version, '1.3.0', 'the root bumped');
    assertEq(parsed(dir, 'packages/core/package.json').version, '1.3.0', 'the lockstep member bumped');
    assert(!exists(dir, 'package-lock.json'), 'no lockfile appears');
    assertEq(res.stdout, 'released 1.3.0 (package.json, packages/core/package.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names no lockfile');
    cleanup(dir);
  });

  await test('the release step makes no commit and no tag', () => {
    const { dir } = mkRepo({ files: { 'package-lock.json': LOCK } });
    const head = git(dir, 'rev-parse', 'HEAD');
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(git(dir, 'rev-parse', 'HEAD'), head, 'HEAD did not move');
    assertEq(git(dir, 'tag', '--list'), '', 'no tag');
    assertEq(git(dir, 'status', '--porcelain', '--', 'package.json'), 'M package.json', 'the bump waits uncommitted');
    cleanup(dir);
  });

  group('release: the move');

  await test('every entry moves under a dated section, categories kept, each with its commit link', () => {
    const { dir, shas } = mkRepo();
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const expected = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      `## [1.3.0] - ${today()}`,
      '',
      '### Added',
      linked(1, shas[1], 'First added thing.'),
      linked(2, shas[2], 'Second added thing,'),
      '  wrapped onto a second line.',
      '',
      '### Fixed',
      linked(3, shas[3], 'A fixed thing.'),
      '',
      ...RELEASED,
    ].join('\n');
    assertEq(read(dir, 'CHANGELOG.md'), expected, 'the released file');
    cleanup(dir);
  });

  await test('--keep leaves the named entry under [Unreleased] and drops the category it emptied', () => {
    const { dir, shas } = mkRepo();
    const res = release(dir, ['1.3.0', '--keep', '3']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const expected = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Fixed',
      linked(3, shas[3], 'A fixed thing.'),
      '',
      `## [1.3.0] - ${today()}`,
      '',
      '### Added',
      linked(1, shas[1], 'First added thing.'),
      linked(2, shas[2], 'Second added thing,'),
      '  wrapped onto a second line.',
      '',
      ...RELEASED,
    ].join('\n');
    assertEq(read(dir, 'CHANGELOG.md'), expected, 'Fixed stays behind, and appears nowhere in the release');
    cleanup(dir);
  });

  await test('a first release keeps the rule and Contributors below the new section', () => {
    // [Unreleased] as the only section: everything after its last entry is the
    // file's tail, and it stays at the bottom rather than moving with the entries.
    const tail = ['---', '', '## Contributors', '', '- [@who]', '', '[@who]: https://github.com/who', ''];
    const { dir, shas } = mkRepo({ changelog: ['# Changelog', '', ...UNRELEASED, ...tail].join('\n') });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const expected = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      `## [1.3.0] - ${today()}`,
      '',
      '### Added',
      linked(1, shas[1], 'First added thing.'),
      linked(2, shas[2], 'Second added thing,'),
      '  wrapped onto a second line.',
      '',
      '### Fixed',
      linked(3, shas[3], 'A fixed thing.'),
      '',
      ...tail,
    ].join('\n');
    assertEq(read(dir, 'CHANGELOG.md'), expected, 'the tail stays last');
    cleanup(dir);
  });

  await test('--keep takes a comma list or a repeated flag, alike', () => {
    const comma = mkRepo();
    const repeated = mkRepo();
    assertEq(release(comma.dir, ['1.3.0', '--keep', '1,3']).code, 0, 'the comma form exits 0');
    assertEq(release(repeated.dir, ['1.3.0', '--keep', '1', '--keep', '3']).code, 0, 'the repeated form exits 0');
    const text = read(comma.dir, 'CHANGELOG.md');
    const unreleased = text.slice(text.indexOf('## [Unreleased]'), text.indexOf('## [1.3.0]'));
    assert(unreleased.includes('[#1]') && unreleased.includes('[#3]') && !unreleased.includes('[#2]'), `#1 and #3 stay, got: ${unreleased}`);
    assert(unreleased.includes('### Added') && unreleased.includes('### Fixed'), `both categories stay, got: ${unreleased}`);
    const shaFree = (t) => t.replace(/`[0-9a-f]{7,40}`\]\(\.\.\/\.\.\/commit\/[0-9a-f]{7,40}\)/g, 'SHA');
    assertEq(shaFree(read(repeated.dir, 'CHANGELOG.md')), shaFree(text), 'the two forms write the same file');
    cleanup(comma.dir); cleanup(repeated.dir);
  });

  await test('a moved entry with no closing commit moves without a link, and says so', () => {
    const { dir } = mkRepo({ commits: ['feat: one\n\nFixes #1', 'fix: three\n\nFixes #3'] });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assert(read(dir, 'CHANGELOG.md').includes('- [#2](../../issues/2) - Second added thing,'), 'moved unlinked');
    assert(/release: #2 has no closing commit/.test(res.stderr), `named on stderr, got: ${res.stderr}`);
    assert(res.stderr.includes('add a "Fixes #2" trailer, or link it by hand'), `says how to fix it, got: ${res.stderr}`);
    cleanup(dir);
  });

  await test('a repo with no remote still links every moved entry, with no handle', () => {
    // The commit links are relative and need no remote; only the handle needs
    // a GitHub one, so without it the attribution is simply absent.
    const { dir, shas } = mkRepo({ remote: false });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const text = read(dir, 'CHANGELOG.md');
    assert(text.includes(linked(1, shas[1], 'First added thing.')), `#1 linked, got: ${text}`);
    assert(text.includes(linked(3, shas[3], 'A fixed thing.')), `#3 linked, got: ${text}`);
    assert(!text.includes('Thanks'), `no handle, got: ${text}`);
    cleanup(dir);
  });

  await test('a kept entry with no closing commit is not reported', () => {
    const { dir } = mkRepo({ commits: ['feat: one\n\nFixes #1', 'feat: two\n\nFixes #2'] });
    const res = release(dir, ['1.3.0', '--keep', '3']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(res.stderr, '', 'an open item is expected to have no commit yet');
    cleanup(dir);
  });

  await test('a --keep number matching no entry is named, and the release goes on', () => {
    const { dir } = mkRepo();
    const res = release(dir, ['1.3.0', '--keep', '3,33']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(res.stderr, 'release: --keep #33 matches no [Unreleased] entry.\n', 'the typo named, the match not');
    assert(res.stdout.includes('2 entries moved, 1 kept'), `released, got: ${res.stdout}`);
    cleanup(dir);
  });

  group('release: the printed line');

  await test('--dry-run prints the same line and writes nothing', () => {
    const { dir } = mkRepo();
    const res = release(dir, ['1.3.0', '--keep', '3', '--dry-run']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(res.stdout, 'released 1.3.0 (package.json): 2 entries moved, 1 kept under [Unreleased]\n', 'the one line');
    assertEq(read(dir, 'package.json'), PACKAGE, 'package.json untouched');
    assertEq(read(dir, 'CHANGELOG.md'), CHANGELOG, 'CHANGELOG untouched');
    cleanup(dir);
  });

  group('release: line endings');

  await test('a CRLF CHANGELOG comes back CRLF', () => {
    const crlf = (t) => t.replace(/\n/g, '\r\n');
    const { dir } = mkRepo({ changelog: crlf(CHANGELOG) });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const text = read(dir, 'CHANGELOG.md');
    assert(!/(^|[^\r])\n/.test(text), 'no bare LF in the CHANGELOG');
    assert(text.includes(`## [Unreleased]\r\n\r\n## [1.3.0] - ${today()}\r\n`), `moved, got: ${JSON.stringify(text.slice(0, 200))}`);
    cleanup(dir);
  });

  group('release: refusals write nothing');

  /** A refusal case: run it, assert the shape, and assert every file unchanged. */
  const refuses = async (name, args, says, fixture = {}) => {
    await test(name, () => {
      const { dir } = mkRepo(fixture);
      const files = ['package.json', PLUGIN_FILE, 'CHANGELOG.md'].filter((f) => exists(dir, f));
      const before = files.map((f) => read(dir, f));
      assertRefused(dir, release(dir, args), says);
      files.forEach((f, i) => assertEq(read(dir, f), before[i], `${f} untouched`));
      cleanup(dir);
    });
  };

  await refuses('a version that is not semver', ['1.3'], 'not a semver version');
  await refuses('the version package.json already carries', ['1.2.3'], 'already at 1.2.3');
  await refuses('neither version file carrying a version', ['1.3.0'], 'neither package.json nor .claude-plugin/plugin.json', {
    pkg: UNVERSIONED,
  });
  await refuses('no version file at all', ['1.3.0'], 'neither package.json nor .claude-plugin/plugin.json', {
    pkg: null,
  });
  await test('a version script failing after npm wrote puts every file back, and the fixed rerun releases', () => {
    // The member's script fails after npm has written the root, the member and the lockfile.
    const failing = json({ name: 'scratch-core', version: '1.2.3', scripts: { version: 'exit 1' } });
    const files = { ...MEMBERS, 'packages/core/package.json': failing, 'package-lock.json': workspaceLock('1.2.3') };
    const { dir } = mkRepo({ pkg: VERSIONED_ROOT, plugin: PLUGIN, files });
    const names = ['package.json', 'packages/core/package.json', 'package-lock.json', PLUGIN_FILE, 'CHANGELOG.md'];
    const before = names.map((f) => read(dir, f));
    assertRefused(dir, release(dir, ['1.3.0']), 'npm version');
    names.forEach((f, i) => assertEq(read(dir, f), before[i], `${f} as it was`));
    fs.writeFileSync(path.join(dir, 'packages/core/package.json'), MEMBERS['packages/core/package.json']);
    const rerun = release(dir, ['1.3.0']);
    assertEq(rerun.code, 0, `the rerun exits 0 (stderr: ${rerun.stderr})`);
    assertEq(parsed(dir, 'package-lock.json').packages['packages/core'].version, '1.3.0', 'the rerun moved the lockfile');
    cleanup(dir);
  });
  await refuses('a lockstep member whose folder has whitespace', ['1.3.0'], "workspace folder 'packages/my core' has whitespace", {
    pkg: VERSIONED_ROOT,
    files: { 'packages/my core/package.json': member('scratch-core', '1.2.3') },
  });
  await refuses('a CHANGELOG with no [Unreleased] heading', ['1.3.0'], 'no [Unreleased] heading', {
    changelog: ['# Changelog', '', ...RELEASED].join('\n'),
  });
  await refuses('an empty [Unreleased]', ['1.3.0'], 'nothing under [Unreleased]', {
    changelog: ['# Changelog', '', '## [Unreleased]', '', ...RELEASED].join('\n'),
  });
  await refuses('every entry kept', ['1.3.0', '--keep', '1,2,3'], 'nothing under [Unreleased]');
  await refuses('a line under [Unreleased] that is neither an entry nor a category', ['1.3.0'], 'neither an entry nor a category heading', {
    changelog: ['# Changelog', '', ...UNRELEASED.slice(0, 7), 'A stray paragraph.', '', ...UNRELEASED.slice(7), ...RELEASED].join('\n'),
  });

  group('release: usage');

  await test('no version is a usage error, exit 2, nothing written', () => {
    const { dir } = mkRepo();
    const res = release(dir, []);
    assertEq(res.code, 2, 'exit 2');
    assert(res.stderr.startsWith('release: '), `one release: line, got: ${res.stderr}`);
    assertEq(read(dir, 'CHANGELOG.md'), CHANGELOG, 'CHANGELOG untouched');
    cleanup(dir);
  });

  await test('--keep with no value, or not a number, is a usage error', () => {
    const { dir } = mkRepo();
    assertEq(release(dir, ['1.3.0', '--keep']).code, 2, 'no value');
    assertEq(release(dir, ['1.3.0', '--keep', 'x']).code, 2, 'not a number');
    assertEq(read(dir, 'CHANGELOG.md'), CHANGELOG, 'CHANGELOG untouched');
    cleanup(dir);
  });

  group('release: the script itself');

  await test('its version files are the ones the commit gate passes as bookkeeping', () => {
    // The gate's version manifests (isManifest in hooks/mods/commit-gate/checks.js)
    // are VERSION_FILES at the root and nested, and the lockfile npm moves with
    // them, and nothing else.
    const files = /const VERSION_FILES = \[([^\]]+)\]/.exec(fs.readFileSync(SCRIPT, 'utf8'));
    assert(files, 'release.js declares VERSION_FILES');
    const names = files[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    const { isManifest } = mods('commit-gate/checks');
    const missed = names.flatMap((n) => [n, `packages/a/${n}`]).filter((p) => !isManifest(p));
    assertEq(missed.join(', '), '', 'every version file, at the root and nested, is a manifest to the gate');
    assert(isManifest('package-lock.json'), 'the lockfile npm moves with them is one too');
    const others = ['plugin.json', 'packages/a/package.json.bak', 'claude-plugin/plugin.json', 'app.js'];
    assertEq(others.filter((p) => isManifest(p)).join(', '), '', 'and nothing beside them is');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
