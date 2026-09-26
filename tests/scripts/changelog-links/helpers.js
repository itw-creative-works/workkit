//
// The shared prologue of the workflow/changelog-links.js suites, the
// `*.test.js` files beside this one, which test the release-time step that
// fills a CHANGELOG entry's commit link and contributor handle in from git and
// the GitHub API, so nobody types a sha. A plain module, never a suite: the
// runner only loads files ending in `.test.js`.
//
// Each test builds a real git repository with real commits carrying real
// `Fixes #N` trailers; only `gh` is stubbed on PATH, because it is the one
// dependency that would reach the network.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { skipSuite } = require('../../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB, SYSTEM_PATH, stubTool, pathWith } = require('../../lib/platform');
const { recordArgv } = require('../../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'workflow', 'changelog-links.js');
const { repoSlug } = require(SCRIPT);

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cll-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A fake `gh` that answers the commit-author query, or fails outright. */
const makeGhStub = ({ login = 'who', fails = false } = {}) => {
  const dir = mkTmp();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(path.join(dir, 'gh.log')),
    ...(fails ? ['exit 1'] : [`printf '%s\\n' "${login}"`, 'exit 0']),
  ]);
  return { binDir: bin, dir };
};

// ` - ` in the fixtures below is the CHANGELOG entry separator (a spaced hyphen).
const CHANGELOG = (...bullets) => [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  ...bullets.flatMap((b) => [b, '']),
].join('\n');

/** A repo whose CHANGELOG is the given text, plus commits closing the issues. */
const mkRepo = (changelog, commits) => {
  const dir = mkTmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  const shas = [];
  for (const message of commits) {
    fs.appendFileSync(path.join(dir, 'work.txt'), `${message}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    shas.push(git(dir, 'rev-parse', '--short', 'HEAD'));
  }
  return { dir, shas };
};

const runScript = (cwd, stub, args = []) => {
  const res = spawnSync('node', [SCRIPT, ...args], {
    cwd,
    env: { ...process.env, PATH: stub ? pathWith(stub.binDir) : SYSTEM_PATH },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
};

const readLog = (dir) => fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

// Every suite asks this first. Every case here puts a fake `gh` in front of
// the script under test, and the script reaches it through execFile: no stub is
// startable that way on Windows (tests/lib/platform.js, `stubTool`), so each
// case would ask the machine's own gh instead of the one it wrote. The suite
// says so rather than passing on an answer it never asked for.
const skipOnWindows = () => {
  if (IS_WINDOWS) {
    skipSuite(NO_NODE_STUB);
  }
};

module.exports = {
  repoSlug, mkTmp, cleanup, git, makeGhStub, CHANGELOG, mkRepo, runScript, readLog, skipOnWindows,
};
