#!/usr/bin/env node
/* eslint-disable no-console */
// The ship's publish: the plan plan.js prints, then each `publish` line in plan
// order, asking npm first and stopping at the first failure (the rules and the
// lines: `skills/ship/SKILL.md` Step 5); a run that published runs the repo's
// afterPublish hooks (hooks.js). It publishes what HEAD holds: a folder that
// differs from HEAD publishes from a copy of HEAD, never from the folder.
//
// Run from the repo root:
//   workkit ship publish [--dir <root>]

const fs = require('fs');
const path = require('path');
const { rootArg, report, npmEnd } = require('./plan');
const { spawnSync } = require('../lib/run');
const { runHooks } = require('./hooks');
const { repoRoot, headSha, gitIn } = require('../lib/git');
const { errLine } = require('../lib/say');
const { proofBase, proofDir } = require('../lib/proof-dir');
const {
  checkOut, fillIgnored, worktreeAdd, worktreeRemove,
} = require('../lib/tree-copy');
const { treeId, indexTreeId } = require('../lib/tree-hash');

/**
 * Is `name@version` already on the registry? The npm question the
 * `safety:release-taken` hook asks at the release commit, flag for flag; no
 * hook judges a publish, so the ship asks it here. E404 answers free; any other
 * failure stands the check down on stderr and answers free, so npm itself refuses a taken version.
 */
const onRegistry = (root, { name, version }) => {
  const res = spawnSync('npm', ['view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', `${name}@${version}`, 'version'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) return res.stdout.trim() === version;
  const stderr = res.stderr || '';
  if (res.status !== null && stderr.includes('E404')) return false;
  const why = errLine(res, npmEnd(res));
  console.error(`publish-plan: the npm check stood down for ${name}@${version}: ${why}; publishing anyway, npm refuses a taken version.`);
  return false;
};

/**
 * Publish the plan's `publish` lines in order from `root`; the first failure
 * stops the run, and a run that published at least one package ends on the
 * afterPublish hooks of `hooksAt`.
 */
const publishAll = (root, result, hooksAt) => {
  let published = 0;
  for (const [i, p] of result.publish.entries()) {
    if (onRegistry(root, p)) {
      console.log(`skipped ${p.name} ${p.version} already on npm`);
      continue;
    }
    const args = ['publish'];
    if (result.workspaces) args.push(`--workspace=${p.name}`);
    if (p.scoped) args.push('--access', 'public');
    const res = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) {
      const left = result.publish.slice(i + 1).map((l) => l.name);
      console.error(`publish-plan: npm publish failed for ${p.name}@${p.version} (${npmEnd(res)}); ${published} published, ${left.length} not attempted: ${left.join(', ') || 'none'}.`);
      return 1;
    }
    published += 1;
    console.log(`published ${p.name} ${p.version}`);
  }
  if (published === 0) {
    if (result.publish.length > 0) console.log('nothing to publish: every package is already on npm at its version');
    return 0;
  }
  if (runHooks(hooksAt, 'afterPublish') === 0) return 0;
  console.error(`publish-plan: ${published} published; an afterPublish hook failed.`);
  return 1;
};

/** The plan of `root` printed, then published from there; the exit code. */
const publishFrom = (root, hooksAt) => {
  const { code, result } = report(root);
  return code === 0 ? publishAll(root, result, hooksAt) : code;
};

/**
 * The paths the folder of the repo `top` holds unlike HEAD: each tracked file
 * changed, staged or not, and each untracked file git does not ignore.
 * @returns {number|null} the count, null when git could not tell
 */
const changedCount = (top) => {
  const res = gitIn(top, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res.status === 0 ? res.stdout.split('\0').filter(Boolean).length : null;
};

/** The copy and its run folder removed; a worktree git still lists after the removal says so. */
const dropCopy = (top, { tmp, copy }) => {
  if (copy !== null && !worktreeRemove(top, copy)) {
    console.error(`publish-plan: git still lists the removed worktree ${copy} (run git -C ${top} worktree prune).`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
};

/**
 * A copy of the commit `sha` to publish from: a detached worktree of the repo
 * `top` in a new run folder (proofDir), checked out and filled with the live
 * folder's gitignored files as `workkit prove` fills its own, and refused
 * unless its tree is still HEAD's.
 * @returns {{tmp: string, copy: string}} the run folder and the copy in it
 * @throws {Error} why it could not be made, whatever it made removed
 */
const copyOf = (top, sha) => {
  const made = { tmp: proofDir(), copy: null };
  if (made.tmp === null) throw new Error(`could not make a run folder under ${proofBase()}`);
  try {
    const copy = `${made.tmp}/copy`;
    worktreeAdd(top, copy);
    made.copy = copy;
    if (!checkOut(copy, sha)) throw new Error(`could not check ${sha.slice(0, 7)} out into ${copy}`);
    fillIgnored(top, copy);
    // The fill reads the folder's ignore rules, the copy holds HEAD's: its
    // working tree must still be its index's, which the checkout made HEAD's.
    const held = treeId(copy);
    if (!held) throw new Error("could not hash the copy's tree");
    if (held !== indexTreeId(copy)) throw new Error("the copy holds a file HEAD's ignore rules do not ignore");
  } catch (err) {
    dropCopy(top, made);
    throw err;
  }
  return made;
};

/**
 * The command: the root `--dir` names published in place when its folder
 * equals HEAD or lies in no repo, else from a copy of HEAD at the same path,
 * the copy removed on every exit. Never the live folder of a repo that differs.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
const main = (argv) => {
  const arg = rootArg(argv);
  if (arg.root === undefined) return arg.code;
  const top = repoRoot(arg.root);
  // The hooks live in the repo's settings, above a member's --dir; a folder
  // outside any repo reads its own.
  const hooksAt = top ?? arg.root;
  const changed = top === null ? 0 : changedCount(top);
  if (changed === 0) return publishFrom(arg.root, hooksAt);
  const sha = headSha(top);
  const refuse = (why) => {
    console.error(`publish-plan: could not make a copy of ${sha === null ? 'HEAD' : sha.slice(0, 7)} to publish from (${why}); nothing was published.`);
    return 1;
  };
  if (changed === null) return refuse(`git could not read the status of ${top}`);
  if (sha === null) return refuse('the repo has no commit');
  let made;
  try {
    made = copyOf(top, sha);
  } catch (err) {
    return refuse(err.cause ? `${err.message}: ${err.cause.message}` : err.message);
  }
  console.error(`publish-plan: the folder differs from HEAD (${changed} ${changed === 1 ? 'path' : 'paths'}), so this publishes from a copy of ${sha.slice(0, 7)}.`);
  try {
    return publishFrom(path.join(made.copy, path.relative(top, fs.realpathSync(arg.root))), hooksAt);
  } finally {
    dropCopy(top, made);
  }
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards console.log output
  // still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}
