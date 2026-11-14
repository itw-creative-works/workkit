/**
 * hooks/mods/tree-guard.js: safety:tree-guard. The working tree is shared, so
 * this bounces the git commands that discard or park state the agent cannot
 * see: a checkout carrying a pathspec, a forced switch, restore unless
 * index-only, stash but `list`/`show`, a forced clean, `reset --hard`. It
 * judges git's real arguments, as the `git` shim (workflow/gitshim/git) hands
 * them to `judge.js tree-guard`. Always on; `WORKKIT_ALLOW_DISCARD=1` is the
 * owner's escape, heard out loud (docs/hooks.md § safety:tree-guard).
 */

/** git's global options that take the next argument as their value; workflow/gitshim/git's VALUE_FLAGS is its bash twin. */
export const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

const isShortCluster = (word) => word.length > 1 && word[0] === '-' && word[1] !== '-';
const forces = (word) => isShortCluster(word) && word.includes('f');

// The subcommand past git's global options, and the arguments after it.
function gitSubcommand(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (GIT_VALUE_FLAGS.has(a)) i += 1;
    else if (a[0] !== '-') return { sub: a, rest: argv.slice(i + 1) };
  }
  return { sub: '', rest: [] };
}

// A word naming a PATH rather than a ref: a path shape, a glob, or a path there.
async function isPath(word, exists) {
  if (/^(\.|\.\.|\.\/.*|\.\.\/.*|\/.*|~\/.*)$/s.test(word) || /[*?[]/.test(word)) return true;
  return Boolean(await exists(word));
}

// `git checkout`'s arguments: does a pathspec sit among them?
async function checkoutDiscards(args, exists) {
  let operands = 0;
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i];
    if (w === '--' || w === '--force' || w === '--pathspec-from-file' || w.startsWith('--pathspec-from-file=')) return true;
    if (w === '--conflict' || w === '--start-point') {
      i += 1;
    } else if (isShortCluster(w)) {
      if (w.includes('f')) return true;
      if (/[bB]$/.test(w)) i += 1;
    } else if (w[0] !== '-') {
      operands += 1;
      if (await isPath(w, exists)) return true;
    }
  }
  return operands > 1;
}

// `git restore`'s arguments: the index-only form leaves the working tree alone.
function restoreDiscards(args) {
  let staged = false;
  let worktree = false;
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i];
    if (w === '--staged') staged = true;
    else if (w === '--worktree') worktree = true;
    else if (w === '--source' || w === '-s') i += 1;
    else if (isShortCluster(w)) {
      if (w.includes('S')) staged = true;
      if (w.includes('W')) worktree = true;
    }
  }
  return !(staged && !worktree);
}

// The discarding shape a git call carries, named for the message, or ''.
async function discardOf(sub, args, exists) {
  if (sub === 'stash') return args[0] === 'list' || args[0] === 'show' ? '' : 'git stash';
  if (sub === 'checkout') return (await checkoutDiscards(args, exists)) ? 'git checkout with a pathspec' : '';
  if (sub === 'switch') return args.some((w) => w === '--discard-changes' || w === '--force' || forces(w)) ? 'git switch --discard-changes/--force' : '';
  if (sub === 'restore') return restoreDiscards(args) ? 'git restore over the working tree' : '';
  if (sub === 'clean') return args.some((w) => w === '--force' || forces(w)) ? 'git clean -f' : '';
  if (sub === 'reset') return args.includes('--hard') ? 'git reset --hard' : '';
  return '';
}

/**
 * tree-guard's verdict on one git call: the block text when it discards or
 * parks working-tree state, the stand-aside notice when the escape is set,
 * else null.
 * @param {{argv: string[], exists: function, allow: boolean}} facts git's
 *   real argument list as the shim got it, `exists(rel)` (async, whether
 *   `rel` is there in the shim's own folder), and `allow`, true when
 *   `WORKKIT_ALLOW_DISCARD=1` is set in the shim's environment
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function treeGuardVerdict({ argv, exists, allow }) {
  const { sub, rest } = gitSubcommand(argv);
  const found = await discardOf(sub, rest, exists);
  if (!found) return null;
  if (allow) {
    return { context: `tree-guard: stood aside for a deliberate discard: WORKKIT_ALLOW_DISCARD=1 is set on this command (${found}).` };
  }
  return { deny: `tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it.\nRevert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it.` };
}
