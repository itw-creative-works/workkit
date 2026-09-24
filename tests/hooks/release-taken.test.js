//
// Tests for hooks/safety/release-taken, the PreToolUse hook that refuses a
// release whose version a provider already has: the release commit and
// `npm publish` both ask npm for every package with publish intent, and the
// release commit asks GitHub for the tag it is about to cut.
//
// Every case runs against PATH-shim `npm` and `gh` stubs answering from a
// fixture, so nothing here reaches a registry or GitHub.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, NO_RC, shellPath, stubTool, systemPathWith } = require('../lib/platform');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'release-taken', 'run.sh');
const mkTmp = (prefix = 'release-taken-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// PATH shims: an `npm` answering `npm view <name>@<version> version` and a `gh`
// answering `gh release view v<version>`, each recording its argv. `npmFails` /
// `ghFails` make the tool answer the way an offline or unauthenticated one
// does, which is the provider's cannot-tell.
//
// npm has TWO answers for a free version and the provider must read both: a
// package it has never heard of is an E404, and a package it knows without
// that version exits 0 printing nothing (`npmKnown`).
const makeStubs = ({ npmTaken = [], npmKnown = [], tags = [], npmFails = false, ghFails = false } = {}) => {
  const dir = mkTmp('release-taken-bin-');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const npmLog = path.join(dir, 'npm.log');
  const ghLog = path.join(dir, 'gh.log');
  const arm = (values) => (values.length ? values.join('|') : '__none__');

  stubTool(binDir, 'npm', [
    '#!/usr/bin/env bash',
    recordArgv(npmLog),
    '[[ "$1" == "view" ]] || exit 0',
    'spec=""',
    'for a in "$@"; do case "$a" in -*|view|version) ;; *) spec="$a" ;; esac; done',
    ...(npmFails ? [
      'echo "npm error code ENOTFOUND request to https://registry.npmjs.org failed" >&2',
      'exit 1',
    ] : [
      `case "$spec" in ${arm(npmTaken)}) printf '%s\\n' "\${spec##*@}"; exit 0 ;; esac`,
      `case "\${spec%@*}" in ${arm(npmKnown)}) exit 0 ;; esac`,
      `echo "npm error code E404" >&2`,
      'exit 1',
    ]),
  ]);

  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    '[[ "$1 $2" == "release view" ]] || exit 0',
    ...(ghFails ? [
      'echo "gh: To get started with GitHub CLI, please run: gh auth login" >&2',
      'exit 1',
    ] : [
      `case "$3" in ${arm(tags)}) printf '%s\\n' "$3"; exit 0 ;; esac`,
      'echo "release not found" >&2',
      'exit 1',
    ]),
  ]);

  return { binDir, npmLog, ghLog, dir };
};

const npmCalls = (stubs) => readArgv(stubs.npmLog);
const ghCalls = (stubs) => readArgv(stubs.ghLog);

// A repo the hook can read: a git repository with an origin (the slug the
// github-release bounce names) and a package.json, plus any workspace members.
const PKG = { name: 'widget', version: '1.2.3', files: ['dist'] };
const mkRepo = ({ pkg = PKG, members = {}, origin = 'https://github.com/acme/widgets.git' } = {}) => {
  const dir = fs.realpathSync(mkTmp());
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (origin) spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [rel, member] of Object.entries(members)) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify(member));
  }
  return dir;
};

const runHook = (command, cwd, stubs) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: shellPath(cwd), tool_input: { command } }),
    env: {
      HOME: shellPath(os.homedir()),
      PATH: systemPathWith(stubs.binDir),
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const RELEASE = 'git commit -m "chore(release): 1.2.3"';

const run = async () => {
  group('release-taken: the release commit at npm');

  await test('a version npm already has bounces, naming the provider and the pair', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'a taken version must not reach the release commit');
    assert(stderr.includes('release-taken'), 'names itself');
    assert(stderr.includes('this release commit'), `names the trigger, got: ${stderr}`);
    assert(stderr.includes('npm already has widget@1.2.3'), `names the provider and the pair, got: ${stderr}`);
    assert(stderr.includes('HOOK_DISABLE=1'), `names the override, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assert(calls.some((c) => isCall(c, 'view') && c.includes('widget@1.2.3')),
      `the version was asked for by name, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a free version passes silently, in both of npm answers for free', () => {
    // A package npm never heard of (E404), and a package it knows without this
    // version (exit 0, nothing printed).
    for (const world of [{}, { npmKnown: ['widget'] }]) {
      const stubs = makeStubs(world);
      const dir = mkRepo();
      const { code, stderr } = runHook(RELEASE, dir, stubs);
      assertEq(code, 0, `nobody has it, so the commit stands, got: ${stderr}`);
      assertEq(stderr.trim(), '', 'a provider that answered says nothing');
      assertEq(npmCalls(stubs).length, 1, `the one package was asked once, got: ${fmtCalls(npmCalls(stubs))}`);
      cleanup(dir);
      cleanup(stubs.dir);
    }
  });

  await test('a private package is never asked about at npm', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo({ pkg: { ...PKG, private: true } });
    const { code } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'a private package publishes nowhere, so nothing is taken');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a package with no publish signal is never asked either', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo({ pkg: { name: 'widget', version: '1.2.3' } });
    const { code } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'no files and no publishConfig means the package never opted into npm');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the heredoc idiom carries the subject on its own line', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      'chore(release): 1.2.3',
      '',
      'The entries this release carries.',
      'EOF',
      ')"',
    ].join('\n');
    const { code, stderr } = runHook(command, dir, stubs);
    assertEq(code, 2, 'a body line that IS the subject is the subject');
    assert(stderr.includes('npm already has widget@1.2.3'), `names the pair, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: the release commit at GitHub');

  await test('a tag the repo already carries bounces, naming the release and the repo', () => {
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('github-release already has v1.2.3'), `names the provider and the tag, got: ${stderr}`);
    assert(stderr.includes('acme/widgets'), `names the repo it asked, got: ${stderr}`);
    const calls = ghCalls(stubs);
    assert(calls.some((c) => isCall(c, 'release', 'view', 'v1.2.3')),
      `the tag was asked for, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('an origin spelled natively on Windows still names its repo', () => {
    // The slug comes from the engine's one rule (workflow/slug.sh), which takes
    // a remote in either separator: git stores a path exactly as it was typed,
    // so a Windows checkout's origin comes back with backslashes and a reader
    // that took only a forward slash left the clause off the bounce.
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo({ origin: 'C:\\Users\\x\\theirs.git' });
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('x/theirs'), `names the repo it asked, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a repo with no origin bounces with no repo clause at all', () => {
    // The slug is left empty rather than guessed at, and the clause rides only
    // when it is known: the bounce still names the provider and the tag, and
    // says nothing about a repo nothing could name.
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo({ origin: null });
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('github-release already has v1.2.3'),
      `names the provider and the tag, got: ${stderr}`);
    assert(!/already has v1\.2\.3 at /.test(stderr),
      `and no repo clause is invented, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: what it never asks about');

  await test('a commit that is not a release, and a command that is no commit at all', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    for (const c of [
      'git commit -m "feat: x"',
      'git status',
      'npm run build',
    ]) {
      assertEq(runHook(c, dir, stubs).code, 0, `not this hook's business: ${c}`);
    }
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the release subject mentioned mid-message is not a subject', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code } = runHook(
      'git commit -m "docs(ship): explain how chore(release): 1.2.3 is judged"', dir, stubs);
    assertEq(code, 0, 'a commit ABOUT the release rule is not the release commit');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a dry run publishes nothing, so it is not a publish', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    for (const c of ['npm publish --dry-run', 'npm publish --dry-run=true']) {
      assertEq(runHook(c, dir, stubs).code, 0, `nothing is published: ${c}`);
    }
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a quoted mention of the release subject is not a commit', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code } = runHook('echo "chore(release): 1.2.3"', dir, stubs);
    assertEq(code, 0, 'talking about a release is not cutting one');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: npm publish');

  await test('a taken version bounces the publish, and GitHub is not asked', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook('npm publish --access public', dir, stubs);
    assertEq(code, 2, 'the registry already has it');
    assert(stderr.includes('this npm publish'), `names the trigger, got: ${stderr}`);
    assert(stderr.includes('npm already has widget@1.2.3'), `names the pair, got: ${stderr}`);
    assertEq(ghCalls(stubs).length, 0,
      `the release legitimately precedes the publish, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: workspaces');

  await test('a packages/* member that is taken bounces, and a private member is not asked', () => {
    const stubs = makeStubs({ npmTaken: ['@fam/core@2.0.0'] });
    const dir = mkRepo({
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/core': { name: '@fam/core', version: '2.0.0', files: ['dist'] },
        'packages/secret': { name: '@fam/secret', version: '2.0.0', private: true, files: ['dist'] },
      },
    });
    const { code, stderr } = runHook('git commit -m "chore(release): 2.0.0"', dir, stubs);
    assertEq(code, 2, 'one taken member is a taken family release');
    assert(stderr.includes('npm already has @fam/core@2.0.0'), `names the member, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assertEq(calls.length, 1, `only the publishable member is asked, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.some((a) => a.includes('@fam/secret'))),
      `the private member is never asked, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: fail-open');

  await test('a provider that cannot tell stands down out loud, and the commit stands', () => {
    const stubs = makeStubs({ npmFails: true, ghFails: true });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'an unanswerable check never blocks a release');
    assert(/npm[\s\S]*stood down/.test(stderr), `the npm check says it stood down, got: ${stderr}`);
    assert(/github-release[\s\S]*stood down/.test(stderr),
      `the github-release check says it stood down, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a publish behind a cd cannot be placed, so it stands down out loud', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook('cd /other && npm publish', dir, stubs);
    assertEq(code, 0, 'the package the command would publish is not the one here');
    assert(stderr.includes('stood down'), `says the check did not run, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 0,
      `the session directory package is never judged instead, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a message in a file leaves no subject to read, and says so', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    for (const c of ['git commit -F msg.txt', 'git commit --file=msg.txt']) {
      const { code, stderr } = runHook(c, dir, stubs);
      assertEq(code, 0, `an unreadable subject never blocks: ${c}`);
      assert(stderr.includes('stood down'), `says the check did not run for ${c}, got: ${stderr}`);
    }
    assertEq(npmCalls(stubs).length, 0, `nothing is asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a workspace member that is not there is named, never skipped in silence', () => {
    const stubs = makeStubs();
    const dir = mkRepo({
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/gone', 'apps/*'] },
    });
    const { code, stderr } = runHook('git commit -m "chore(release): 2.0.0"', dir, stubs);
    assertEq(code, 0, 'a member that is not there takes nothing with it');
    assert(stderr.includes('packages/gone'), `names the missing member, got: ${stderr}`);
    assert(stderr.includes('apps/*'), `names the pattern that matched nothing, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('malformed JSON, exit 0', () => {
    const stubs = makeStubs();
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: 'not json',
      env: { HOME: shellPath(os.homedir()), PATH: systemPathWith(stubs.binDir) },
      encoding: 'utf8',
      timeout: 30000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
    cleanup(stubs.dir);
  });

  group('release-taken: wiring');

  await test('hooks.json registers the hook under PreToolUse Bash, after commit-language', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    const names = bash.hooks.map((h) => h.command);
    const mine = names.findIndex((c) => c.includes('safety:release-taken'));
    assert(mine > 0, `the Bash block routes safety:release-taken through the loader, got: ${names.join(' ')}`);
    assert(names[mine - 1].includes('safety:commit-language'),
      `it sits after safety:commit-language, got: ${names.join(' ')}`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
