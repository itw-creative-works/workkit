//
// Tests for workflow/release.js: the ship's release commit, made by one command
// instead of by hand. It bumps `version` in package.json, backfills each
// entry's commit link, and moves `[Unreleased]` into a dated section, the
// `--keep` items staying behind. Every refusal writes nothing.
//
// Each case builds a real git repository with real commits carrying real
// `Fixes #N` trailers, so the backfill reads the history git records. Nothing
// here stubs `gh`: the child's world is a scratch home (`homeEnv`) on the system
// PATH, so any `gh` it reaches is one with no account, and the handle is simply
// absent, which is the offline release the backfill is written to allow.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { SYSTEM_PATH, homeEnv } = require('../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'release.js');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
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
const PLUGIN_FILE = path.join('.claude-plugin', 'plugin.json');

/** The text of a version file with its top-level version moved to 1.3.0. */
const bumped = (text) => text.replace('"version": "1.2.3"', '"version": "1.3.0"');

const COMMITS = ['feat: one\n\nFixes #1', 'feat: two\n\nFixes #2', 'fix: three\n\nFixes #3'];

/**
 * A repo holding the CHANGELOG and the version files (`pkg`, and `plugin` when
 * given; a null `pkg` writes no package.json), a GitHub origin unless `remote`
 * is false, then one commit per message.
 * The shas come back keyed by the issue each message closes.
 */
const mkRepo = ({
  changelog = CHANGELOG, pkg = PACKAGE, plugin = null, commits = COMMITS, remote = true,
} = {}) => {
  const dir = mkTmp();
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
  const home = mkTmp();
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir], {
    cwd: home,
    env: homeEnv(home, { PATH: SYSTEM_PATH }),
    encoding: 'utf8',
    timeout: 20000,
  });
  cleanup(home);
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
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

const run = async () => {
  group('release: the version bump');

  await test('the version lands and every other byte of package.json stays', () => {
    const { dir } = mkRepo();
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, 'package.json'), bumped(PACKAGE), 'only the first version line changed');
    assertEq(res.stdout, 'released 1.3.0 (package.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names the file');
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

  await test('both files carrying a version are both bumped, each keeping its own line ending', () => {
    const { dir } = mkRepo({ pkg: PACKAGE.replace(/\n/g, '\r\n'), plugin: PLUGIN });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    assertEq(read(dir, 'package.json'), bumped(PACKAGE).replace(/\n/g, '\r\n'), 'package.json bumped, still CRLF');
    assertEq(read(dir, PLUGIN_FILE), bumped(PLUGIN), 'the manifest bumped, still LF');
    assertEq(res.stdout, 'released 1.3.0 (package.json, .claude-plugin/plugin.json): 3 entries moved, 0 kept under [Unreleased]\n', 'the line names both');
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

  await test('the line counts what moved and what stayed', () => {
    const { dir } = mkRepo();
    const res = release(dir, ['1.3.0', '--keep', '3']);
    assertEq(res.stdout, 'released 1.3.0 (package.json): 2 entries moved, 1 kept under [Unreleased]\n', 'the one line');
    cleanup(dir);
  });

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

  await test('a CRLF CHANGELOG and package.json come back CRLF', () => {
    const crlf = (t) => t.replace(/\n/g, '\r\n');
    const { dir } = mkRepo({ changelog: crlf(CHANGELOG), pkg: crlf(PACKAGE) });
    const res = release(dir, ['1.3.0']);
    assertEq(res.code, 0, `exit 0 (stderr: ${res.stderr})`);
    const text = read(dir, 'CHANGELOG.md');
    assert(!/(^|[^\r])\n/.test(text), 'no bare LF in the CHANGELOG');
    assert(text.includes(`## [Unreleased]\r\n\r\n## [1.3.0] - ${today()}\r\n`), `moved, got: ${JSON.stringify(text.slice(0, 200))}`);
    assertEq(read(dir, 'package.json'), crlf(PACKAGE.replace('"version": "1.2.3"', '"version": "1.3.0"')), 'package.json bumped, still CRLF');
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
    // VERSION_FILES and the gate's version-stamp case arm are twins tied by a
    // comment at each home; this pins them, the way the Proof pattern's twins
    // are pinned in tests/scripts/ship-items.test.js.
    const files = /const VERSION_FILES = \[([^\]]+)\]/.exec(fs.readFileSync(SCRIPT, 'utf8'));
    assert(files, 'release.js declares VERSION_FILES');
    const names = files[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    const gate = fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'safety', 'commit-gate', 'run.sh'), 'utf8');
    assert(gate.includes(`      ${names.join('|')})\n`), `the gate's case arm is ${names.join('|')}`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
