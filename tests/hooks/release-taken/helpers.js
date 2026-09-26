//
// The shared prologue of the hooks/safety/release-taken suites, the `*.test.js`
// files beside this one, which test the PreToolUse hook that refuses a
// release whose version a provider already has: the release commit and
// `npm publish` both ask npm for every package with publish intent, and the
// release commit asks GitHub for the tag it is about to cut. A plain module,
// never a suite: the runner only loads files ending in `.test.js`.
//
// Every case runs against PATH-shim `npm` and `gh` stubs answering from a
// fixture, so nothing here reaches a registry or GitHub.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { BASH, NO_RC, shellPath, stubTool, systemPathWith } = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'release-taken', 'run.sh');
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
const PKG = { name: 'widget', version: '1.2.3', private: false, files: ['dist'] };
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

module.exports = {
  HOOK, cleanup, makeStubs, npmCalls, ghCalls, PKG, mkRepo, runHook, RELEASE,
};
