// The shared prologue of the safety:release-taken logic suites beside this one:
// the release commit's verdict, releaseCommitVerdict({ subject, root, facts }) in
// hooks/mods/release-taken.js, the commit-msg hook's call, over the real
// machine's io in a scratch repo whose `npm` and `gh` are stubs on PATH. Nothing
// here reaches a registry or GitHub.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkTmp } = require('../../lib/harness');
const { stubTool, homeEnv, joinPath } = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { mkOriginRepo, commitGh } = require('../../lib/git-repo');
const { ioIn } = require('../../../workflow/lib/io');
const { mods, textOf } = require('../../lib/mods-inputs');

const PKG = { name: 'widget', version: '1.2.3', private: false, files: ['dist'] };
// The release commit's subject, as the commit-msg hook hands it over.
const RELEASE = 'chore(release): 1.2.3';

// The line every bounce ends on names HOOK_DISABLE=1 as the override, and the
// retired loader nowhere.
const isOverride = (line) => typeof line === 'string' && line.includes('HOOK_DISABLE=1') && !/loader/i.test(line);
// A bounce's lines above its override line, byte for byte the HEAD hook's.
const TAKEN = (what, ...hits) => hits.map((hit) => `release-taken: BLOCKED ${what}: ${hit}`).join('\n');

// The answer a suite reads: the raw result, its `deny` above the override line
// (null for none), that `override` line, every line it said, and the providers' calls.
const answerOf = (result, calls) => {
  const bounce = result && typeof result.deny === 'string' ? result.deny.replace(/\n$/, '').split('\n') : null;
  const override = bounce ? bounce.pop() : null;
  const deny = bounce ? bounce.join('\n') : null;
  return { result, deny, override, text: textOf(result).replace(/\n$/, ''), calls };
};

// An `npm` answering `npm view <name>@<version> version` as the HEAD stubs did,
// every call recorded: the version for a taken spec, exit 0 and nothing for a
// known name, an E404 otherwise, ENOTFOUND for every view when `npmFails`.
const npmStub = (binDir, { npmTaken = [], npmKnown = [], npmFails = false }) => {
  const log = path.join(path.dirname(binDir), 'npm.log');
  stubTool(binDir, 'npm', [
    '#!/usr/bin/env bash',
    recordArgv(log),
    'if [[ "$1" == view ]]; then',
    ...(npmFails ? ["  echo 'npm error code ENOTFOUND request to https://registry.npmjs.org failed' >&2", '  exit 1'] : []),
    '  spec="${@: -2:1}"',
    '  case "$spec" in',
    ...npmTaken.map((t) => `    '${t}') echo '${t.slice(t.lastIndexOf('@') + 1)}'; exit 0 ;;`),
    '  esac',
    ...npmKnown.map((name) => `  [[ "\${spec%@*}" == '${name}' ]] && exit 0`),
    "  echo 'npm error code E404' >&2",
    '  exit 1',
    'fi',
    'exit 0',
  ]);
  return () => readArgv(log).filter((argv) => argv[0] === 'view').map((argv) => argv[argv.length - 2]);
};

/**
 * The release commit's verdict on `subject` over a scratch repo: `pkg` its
 * package.json (null for none), `members` the workspace package files by folder
 * from the root, written where they stand, `origin` the remote url (null for no
 * origin); the rest is the stub providers' world: `npmTaken` the specs npm has,
 * `npmKnown` the names it knows, `tags` the GitHub releases, and `npmFails` /
 * `ghFails` a provider that answers as an offline one does.
 */
const judgeRelease = async (subject, {
  pkg = PKG, members = {}, origin = 'https://github.com/acme/widgets.git', npmTaken, npmKnown, npmFails, tags = [], ghFails = false,
} = {}) => {
  const dir = mkTmp('release-taken-');
  const root = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  if (origin) mkOriginRepo(root, origin);
  else spawnSync('git', ['init', '-q'], { cwd: root });
  if (pkg) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  for (const [rel, member] of Object.entries(members)) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, 'package.json'), JSON.stringify(member, null, 2));
  }
  const gh = commitGh({ tags, fails: ghFails });
  const npmBin = path.join(dir, 'npm-bin');
  fs.mkdirSync(npmBin, { recursive: true });
  const npmCalls = npmStub(npmBin, { npmTaken, npmKnown, npmFails });
  const env = homeEnv(home, { PATH: joinPath(npmBin, gh.binDir, process.env.PATH) });
  const result = await mods('release-taken').releaseCommitVerdict({ subject, root, facts: ioIn(env) });
  const calls = {
    npm: npmCalls(),
    github: gh.calls().filter((argv) => argv[0] === 'release' && argv[1] === 'view').map((argv) => argv[2]),
  };
  return answerOf(result, calls);
};

module.exports = {
  PKG, RELEASE, TAKEN, isOverride, judgeRelease,
};
