// The shared prologue of the safety:release-taken logic suites beside this one:
// releaseTakenVerdict({ command, cwd, packageJson, members, lookups, origin }) in
// hooks/mods/release-taken.js, called over plain facts. The providers are
// `lookups`, each answering { exitCode, stdout, stderr } as `npm view` and
// `gh release view` do, so nothing here reaches a registry or GitHub.

const { mods, runResult, textOf } = require('../../lib/mods-inputs');

const ROOT = '/w/repo';
const PKG = { name: 'widget', version: '1.2.3', private: false, files: ['dist'] };
const RELEASE = 'git commit -m "chore(release): 1.2.3"';

// The line every bounce ends on names HOOK_DISABLE=1 as the override, and the
// retired loader nowhere.
const isOverride = (line) => typeof line === 'string' && line.includes('HOOK_DISABLE=1') && !/loader/i.test(line);
// A bounce's lines above its override line, byte for byte the HEAD hook's.
const TAKEN = (what, ...hits) => hits.map((hit) => `release-taken: BLOCKED ${what}: ${hit}`).join('\n');

// The providers as the HEAD stubs answered: a taken version prints itself; a
// free one is an E404 or, for a package npm knows (`npmKnown`), exit 0 with
// nothing printed; `npmFails` / `ghFails` answer the way an offline one does.
const makeLookups = ({ npmTaken = [], npmKnown = [], tags = [], npmFails = false, ghFails = false } = {}) => {
  const calls = { npm: [], github: [] };
  const lookups = {
    npm: async (name, version) => {
      const spec = `${name}@${version}`;
      calls.npm.push(spec);
      if (npmFails) return runResult({ exitCode: 1, stderr: 'npm error code ENOTFOUND request to https://registry.npmjs.org failed\n' });
      if (npmTaken.includes(spec)) return runResult({ stdout: `${version}\n` });
      if (npmKnown.includes(name)) return runResult();
      return runResult({ exitCode: 1, stderr: 'npm error code E404\n' });
    },
    github: async (tag) => {
      calls.github.push(tag);
      if (ghFails) return runResult({ exitCode: 1, stderr: 'gh: To get started with GitHub CLI, please run: gh auth login\n' });
      if (tags.includes(tag)) return runResult({ stdout: `${tag}\n` });
      return runResult({ exitCode: 1, stderr: 'release not found\n' });
    },
  };
  return { lookups, calls };
};

/**
 * One verdict over a repo at ROOT: `pkg` its package.json (null for none),
 * `members` the workspace package files by folder from the root, `origin` the
 * remote url (null for no origin), the rest the providers' world.
 * Answers the raw result, its `deny` above the override line (null for none),
 * that `override` line, every line it said, and the providers' calls.
 */
const judge = async (command, { pkg = PKG, members = {}, origin = 'https://github.com/acme/widgets.git', ...world } = {}) => {
  const { lookups, calls } = makeLookups(world);
  const result = await mods('release-taken').releaseTakenVerdict({
    command, cwd: ROOT, packageJson: pkg, members, lookups, origin,
  });
  const bounce = result && typeof result.deny === 'string' ? result.deny.replace(/\n$/, '').split('\n') : null;
  const override = bounce ? bounce.pop() : null;
  const deny = bounce ? bounce.join('\n') : null;
  return { result, deny, override, text: textOf(result).replace(/\n$/, ''), calls };
};

module.exports = {
  ROOT, PKG, RELEASE, TAKEN, isOverride, makeLookups, judge,
};
