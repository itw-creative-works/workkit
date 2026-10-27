// Tests for safety:vendor-guard's logic, vendorGuardVerdict({ file, root,
// ignored, kindOf }) in hooks/mods/vendor-guard.js: an edit to generated,
// vendored or installed output (node_modules, vendor, .bundle, a dist/ or
// build/ directly under a package root, lockfiles, gitignored files) is
// refused; _attic/, .workkit/ and .env* are the allowlist. Each case ports the
// HEAD case its name quotes, the tree it walked now a table of kinds; the
// check-ignore and kind probes run in test/mods/pre-tool-use-files.test.ts.
// Nothing is dropped: "missing file_path: exit 0" is a null file here.

const { group, test, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const TAIL = 'Edit the SOURCE, not the output; a bug in a dependency gets fixed upstream, never patched in place.';
const BLOCK = (file, why) => `vendor-guard: BLOCKED edit to ${file}: ${why} ${TAIL}`;
const NODE_MODULES = 'node_modules/ is installed output.';
const VENDORED = 'generated/vendored directory.';
const OUTPUT_DIR = 'a dist/ or build/ directly under a package root is generated output.';
const LOCKFILE = 'lockfiles are owned by their package managers.';
const IGNORED = 'the file is gitignored: generated/runtime files are not hand-edited (designed exceptions: _attic/, .workkit/, .env*).';

// A tree of kinds: every path not listed is absent (null), the answer a path
// that does not exist gives, so its dist/ cannot be disproved.
const kinds = (table) => async (path) => (path in table ? table[path] : null);
const NOTHING = kinds({ '/': 'dir' });
const never = async () => false;

const judge = (file, { root = null, ignored = never, kindOf = NOTHING } = {}) => mods('vendor-guard')
  .vendorGuardVerdict({ file, root, ignored, kindOf });

const denyOf = (r) => (r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null);

const blocks = async (file, why, facts) => {
  assertEq(denyOf(await judge(file, facts)), BLOCK(file, why), `must block: ${file}`);
};

const passes = async (file, facts) => {
  const r = await judge(file, facts);
  assertEq(denyOf(r), null, `must pass: ${file}`);
};

// A monorepo: a repo root holding a package.json and a build/, a package with
// its own package.json and dist/, and source trees whose paths merely hold a build/.
const MONO = '/w/mono';
const MONO_FACTS = {
  root: MONO,
  kindOf: kinds({
    '/': 'dir',
    '/w': 'dir',
    [MONO]: 'dir',
    [`${MONO}/.git`]: 'dir',
    [`${MONO}/package.json`]: 'file',
    [`${MONO}/build`]: 'dir',
    [`${MONO}/packages`]: 'dir',
    [`${MONO}/packages/foo`]: 'dir',
    [`${MONO}/packages/foo/package.json`]: 'file',
    [`${MONO}/packages/foo/dist`]: 'dir',
    [`${MONO}/packages/foo/src`]: 'dir',
    [`${MONO}/packages/foo/src/test`]: 'dir',
    [`${MONO}/packages/foo/src/test/suites`]: 'dir',
    [`${MONO}/packages/foo/src/test/suites/build`]: 'dir',
    [`${MONO}/src`]: 'dir',
    [`${MONO}/src/assets`]: 'dir',
    [`${MONO}/src/assets/build`]: 'dir',
  }),
};

// A repo whose .gitignore holds generated.json and .env.
const GIT = '/w/git';
const GIT_FACTS = {
  root: GIT,
  ignored: async (path) => [`${GIT}/generated.json`, `${GIT}/.env`].includes(path),
  kindOf: kinds({ '/': 'dir', '/w': 'dir', [GIT]: 'dir', [`${GIT}/.git`]: 'dir' }),
};

const cases = async () => {
  group('vendor-guard: blocked paths');

  await test('ports "node_modules/: exit 2": names itself and points at the source-not-output rule', async () => {
    await blocks('/repo/node_modules/lodash/index.js', NODE_MODULES);
  });

  await test('ports "dist/, build/, vendor/, .bundle/ segments: exit 2"', async () => {
    await blocks('/repo/dist/app.js', OUTPUT_DIR);
    await blocks('/repo/build/out.css', OUTPUT_DIR);
    await blocks('/repo/vendor/lib.rb', VENDORED);
    await blocks('/repo/.bundle/config', VENDORED);
  });

  await test('ports "lockfiles: exit 2": explains lockfile ownership', async () => {
    for (const p of ['/repo/package-lock.json', '/repo/yarn.lock', '/repo/pnpm-lock.yaml', '/repo/Gemfile.lock']) {
      await blocks(p, LOCKFILE);
    }
  });

  await test('ports "RELATIVE vendor paths blocked; relative _attic/ exempt (review regression)"', async () => {
    await blocks('node_modules/foo/index.js', NODE_MODULES);
    await blocks('dist/app.js', OUTPUT_DIR);
    await passes('_attic/old.js');
  });

  group('vendor-guard: allowed paths');

  await test('ports "ordinary source file: exit 0": silent', async () => {
    const r = await judge('/repo/src/index.js');
    assertEq(r ?? null, null, 'a source edit says nothing');
  });

  await test('ports "_attic/ is exempt even with vendor segments: exit 0"', async () => {
    await passes('/repo/_attic/dist/old-thing.js');
  });

  // The repo gitignores .workkit/ as the workflow spec says; the exemption
  // stands ahead of the gitignore check.
  await test('ports ".workkit/ is exempt: agent state and the capture file"', async () => {
    const facts = {
      root: '/repo',
      ignored: async (path) => path.includes(`/${W}/`),
      kindOf: kinds({ '/': 'dir', '/repo': 'dir', '/repo/.git': 'dir' }),
    };
    await passes(`/repo/${W}/fable-cutover.md`, facts);
    await passes(`${W}/capture.md`, facts);
    await passes(`/repo/${W}/settings.json`, facts);
  });

  await test('ports ".workkit/ nested in a vendor directory still blocks (review regression)"', async () => {
    await blocks(`/repo/node_modules/pkg/${W}/notes.md`, NODE_MODULES);
    await blocks(`/repo/dist/${W}/capture.md`, OUTPUT_DIR);
    await blocks(`node_modules/pkg/${W}/settings.json`, NODE_MODULES);
    await passes(`/repo/_attic/dist/${W}/notes.md`);
  });

  await test('ports "file merely NAMED dist.js: exit 0 (segment match only)"', async () => {
    await passes('/repo/src/dist.js');
  });

  group('vendor-guard: dist/ and build/ anchored to package roots');

  await test('ports "src/test/suites/build/ is committed source: exit 0"', async () => {
    await passes(`${MONO}/packages/foo/src/test/suites/build/x.test.js`, MONO_FACTS);
  });

  await test('ports "build/ at the repo root still bounces: exit 2": names the package-root anchor', async () => {
    await blocks(`${MONO}/build/out.js`, OUTPUT_DIR, MONO_FACTS);
  });

  await test('ports "packages/<pkg>/dist/ with a package.json present: exit 2"', async () => {
    await blocks(`${MONO}/packages/foo/dist/index.js`, OUTPUT_DIR, MONO_FACTS);
  });

  await test('ports "nested non-output build/ under a non-package dir: exit 0"', async () => {
    await passes(`${MONO}/src/assets/build/tool.js`, MONO_FACTS);
  });

  group('vendor-guard: gitignored files');

  await test('ports "gitignored file in a repo: exit 2": names the reason', async () => {
    await blocks(`${GIT}/generated.json`, IGNORED, GIT_FACTS);
  });

  await test('ports ".env is allowed even though gitignored"', async () => {
    await passes(`${GIT}/.env`, GIT_FACTS);
  });

  await test('ports "tracked file in a repo: exit 0"', async () => {
    await passes(`${GIT}/src.js`, GIT_FACTS);
  });

  group('vendor-guard: fail-open');

  await test('ports "missing file_path: exit 0"', async () => {
    const r = await judge(null);
    assertEq(r ?? null, null, 'no file, no verdict');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
