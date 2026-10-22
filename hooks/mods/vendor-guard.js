/**
 * hooks/mods/vendor-guard.js: safety:vendor-guard, the mechanical half of
 * "edit the SOURCE, not the output". An Edit or Write bounces off a vendor
 * segment (`node_modules/`, `vendor/`, `.bundle/`), a `dist/` or `build/`
 * directly under a package root, a lockfile and a gitignored file; `_attic/`
 * (checked first), `.env*` and `.workkit/` (after the vendor block) pass
 * (docs/hooks.md § safety:vendor-guard).
 */

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Gemfile.lock', 'Podfile.lock', 'composer.lock',
]);

// A path segment at the start or after a slash, as the shell's `*/x/*|x/*` spells it.
const under = (file, dir) => file.startsWith(`${dir}/`) || file.includes(`/${dir}/`);

const blocked = (file, why) => ({
  deny: `vendor-guard: BLOCKED edit to ${file}: ${why} Edit the SOURCE, not the output; a bug in a dependency gets fixed upstream, never patched in place.`,
});

// A package root is the repo root or a folder holding a package.json; a folder
// that is not there cannot be disproved, so it counts as one.
async function isPackageRoot(dir, kindOf) {
  const at = dir || '/';
  if ((await kindOf(at)) !== 'dir') return true;
  if ((await kindOf(`${at}/package.json`)) === 'file') return true;
  return (await kindOf(`${at}/.git`)) !== null;
}

// A dist/ or build/ folder directly under a package root; deeper in a source
// tree it is source. The last segment is the file itself, never a folder.
async function inOutputDir(file, kindOf) {
  let prefix = file.startsWith('/') ? '' : '.';
  let rest = file.startsWith('/') ? file.slice(1) : file;
  while (rest) {
    const cut = rest.indexOf('/');
    if (cut < 0) break;
    const seg = rest.slice(0, cut);
    rest = rest.slice(cut + 1);
    if ((seg === 'dist' || seg === 'build') && (await isPackageRoot(prefix, kindOf))) return true;
    prefix = `${prefix}/${seg}`;
  }
  return false;
}

/**
 * vendor-guard's verdict on the file an Edit or Write names.
 * @param {{file: string, root: string|null, ignored: function, kindOf: function}} facts
 *   the written file, the repo root holding its folder (null outside a repo),
 *   `ignored(path)` (async, whether `git check-ignore` matches it) and
 *   `kindOf(path)` (async, `'file'`, `'dir'` or null when nothing is there)
 * @returns {Promise<{deny: string}|null>}
 */
export async function vendorGuardVerdict({ file, root, ignored, kindOf }) {
  if (!file || under(file, '_attic')) return null;
  if (under(file, 'node_modules')) return blocked(file, 'node_modules/ is installed output.');
  if (under(file, 'vendor') || under(file, '.bundle')) return blocked(file, 'generated/vendored directory.');
  if (await inOutputDir(file, kindOf)) return blocked(file, 'a dist/ or build/ directly under a package root is generated output.');
  const base = file.split('/').pop();
  if (LOCKFILES.has(base)) return blocked(file, 'lockfiles are owned by their package managers.');
  // Secrets live in .env BECAUSE it is gitignored; .workkit/ is session state,
  // after the vendor checks so one nested in installed output stays blocked.
  if (base === '.env' || base.startsWith('.env.') || under(file, '.workkit')) return null;
  if (root && (await ignored(file))) {
    return blocked(file, 'the file is gitignored: generated/runtime files are not hand-edited (designed exceptions: _attic/, .workkit/, .env*).');
  }
  return null;
}

/**
 * The guard's run over the file facts: the path judged is the one the input
 * typed, so a link into installed output is judged by its link, and the repo
 * is asked from that path's folder.
 * @param {{typed: string|null, top: function, run: function, stat: function}} facts the chain's file facts
 * @returns {Promise<{deny: string}|null>}
 */
export async function vendorGuardGuard({ typed, top, run, stat }) {
  if (!typed) return null;
  const dir = typed.slice(0, typed.lastIndexOf('/')) || '/';
  return vendorGuardVerdict({
    file: typed,
    root: await top(dir),
    ignored: async (path) => (await run(['git', 'check-ignore', '-q', '--', path], { cwd: dir })).exitCode === 0,
    kindOf: async (path) => (await stat(path))?.kind ?? null,
  });
}
