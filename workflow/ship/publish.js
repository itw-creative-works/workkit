#!/usr/bin/env node
/* eslint-disable no-console */
// The ship's publish: the plan plan.js prints, then each `publish` line in plan
// order, asking npm first and stopping at the first failure (the rules and the
// lines: `skills/ship/SKILL.md` Step 5); a run that published runs the repo's
// afterPublish hooks (hooks.js).
//
// Run from the repo root:
//   workkit ship publish [--dir <root>]

const { report, npmEnd } = require('./plan');
const { spawnSync } = require('../lib/run');
const { runHooks } = require('./hooks');
const { repoRoot } = require('../lib/git');
const { errLine } = require('../lib/say');

/**
 * Is `name@version` already on the registry? The `safety:release-taken` hook's
 * npm question, flag for flag, asked here since that hook never sees a publish
 * inside this run. E404 answers free; any other failure stands the check down
 * on stderr and answers free, so npm itself refuses a taken version.
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
 * Publish the plan's `publish` lines in order; the first failure stops the run,
 * and a run that published at least one package ends on the afterPublish hooks.
 */
const publishAll = (root, result) => {
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
  // The hooks live in the repo's settings, above a member's --dir; a folder
  // outside any repo reads its own.
  if (runHooks(repoRoot(root) ?? root, 'afterPublish') === 0) return 0;
  console.error(`publish-plan: ${published} published; an afterPublish hook failed.`);
  return 1;
};

if (require.main === module) {
  const { code, root, result } = report(process.argv.slice(2));
  // Set the code, never process.exit(): exiting discards console.log output
  // still buffered for a pipe.
  process.exitCode = code === 0 ? publishAll(root, result) : code;
}
