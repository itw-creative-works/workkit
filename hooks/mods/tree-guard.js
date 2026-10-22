/**
 * hooks/mods/tree-guard.js: safety:tree-guard. The working tree is shared, so
 * this bounces the git commands that discard or park state the agent cannot
 * see: a checkout carrying a pathspec, a forced switch, restore unless
 * index-only, stash but `list`/`show`, a forced clean, `reset --hard`. Always
 * on; `WORKKIT_ALLOW_DISCARD=1` is the owner's escape, heard out loud
 * (docs/hooks.md § safety:tree-guard).
 */

import {
  PLACEHOLDER, foldRedirectAmp, gitSubcommand, hasEscape, isGitWord, isShortCluster, peelPrefixes, redirectSpan, stripHeredocs, stripQuotes, wordsOf,
} from './command.js';

const forces = (word) => isShortCluster(word) && word.includes('f');

// A clause's arguments: a redirection with its target dropped, and everything
// from an unquoted `#` on.
function argumentsOf(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w[0] === '#') break;
    if (!w.includes('>') && !w.includes('<')) out.push(w);
    else if (redirectSpan(w) === 0) out.push(w);
    else if (redirectSpan(w) === 2 && i + 1 < words.length) i += 1;
  }
  return out;
}

// A token naming a PATH rather than a ref; a quoted operand is how a glob is passed.
async function isPath(word, exists) {
  if (/^(\.|\.\.|\.\/.*|\.\.\/.*|\/.*|~\/.*)$/s.test(word) || /[*?[]/.test(word) || word.startsWith(PLACEHOLDER)) return true;
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

// The discarding shape a git clause carries, named for the message, or ''.
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
 * tree-guard's verdict on a Bash command: the block text when it discards or
 * parks working-tree state, the stand-aside notice when the escape is set,
 * else null.
 * @param {{command: string, cwd: string, exists: function}} facts the command,
 *   its folder and `exists(rel)` (async, whether `<cwd>/<rel>` is there); the
 *   escape is the `WORKKIT_ALLOW_DISCARD=1` assignment on the command alone
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function treeGuardVerdict({ command, exists }) {
  if (!command) return null;
  const stripped = foldRedirectAmp(stripQuotes(stripHeredocs(command)));
  let found = '';
  for (const clause of stripped.split(/[;|&\n]/)) {
    const words = argumentsOf(wordsOf(clause));
    const { skip, word } = peelPrefixes(words);
    if (!isGitWord(word)) continue;
    const { sub, rest } = gitSubcommand(words.slice(skip + 1));
    found = await discardOf(sub, rest, exists);
    if (found) break;
  }
  if (!found) return null;
  if (hasEscape(stripped, 'WORKKIT_ALLOW_DISCARD')) {
    return { context: `tree-guard: stood aside for a deliberate discard: WORKKIT_ALLOW_DISCARD=1 is set on this command (${found}).` };
  }
  return { deny: `tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it (issue #157).\nRevert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it.` };
}

/**
 * The guard's run over the Bash facts.
 * @param {{command: string, cwd: string, exists: function}} facts the chain's facts
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export function treeGuardGuard(facts) {
  return treeGuardVerdict({ command: facts.command, cwd: facts.cwd, exists: facts.exists });
}
