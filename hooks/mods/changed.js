/**
 * hooks/mods/changed.js: the files a repo's working tree changed since a
 * moment, read off disk: what safety:script-write checks after a Bash call,
 * and the one export another plugin calls with its own start time to run its
 * own write checks on the same files (docs/hooks.md § safety:script-write).
 */

/** The capture file's path from its repo root. */
export const CAPTURE_PATH = '.workkit/capture.md';
// The two kit files git ignores that a write check still judges, the session queue beside the capture file.
const KEPT_IGNORED = [CAPTURE_PATH, '.workkit/agents/session.md'];

// The NUL-separated paths one git listing prints in `root`; a listing git refuses is a throw.
async function listed(io, root, argv) {
  const run = await io.run(argv, { cwd: root });
  if (run.exitCode !== 0) {
    throw new Error(`git ${argv[1]} failed in ${root}: ${String(run.stderr ?? '').trim() || `exit ${run.exitCode}`}`);
  }
  return run.stdout.split('\0').filter(Boolean);
}

/**
 * The repo-relative paths under `root` changed at or after `ms`: git's
 * modified and untracked files (`git ls-files -m -o --exclude-standard`), its
 * staged ones (`git diff --cached --name-only`, so a file written and staged
 * in one call is seen) and the two `.workkit` files, each once, kept where it
 * is there and its modified time is at or after `ms`, in path order. A
 * listing git refuses is a throw.
 * @param {{run: function, stat: function}} io `run(argv, { cwd })` and `stat(path)` (`{ kind, mtimeMs }` or null)
 * @param {string} root the repo root
 * @param {number} ms the moment, epoch ms
 * @returns {Promise<string[]>}
 */
export async function changedSince(io, root, ms) {
  // -z keeps each name as it is, never quoted.
  const [worked, staged] = await Promise.all([
    listed(io, root, ['git', 'ls-files', '-z', '-m', '-o', '--exclude-standard']),
    listed(io, root, ['git', 'diff', '--cached', '--name-only', '-z']),
  ]);
  const rels = [...new Set([...worked, ...staged, ...KEPT_IGNORED])].sort();
  const stats = await Promise.all(rels.map((rel) => io.stat(`${root}/${rel}`)));
  return rels.filter((_, i) => stats[i] && stats[i].kind !== 'dir' && stats[i].mtimeMs >= ms);
}
