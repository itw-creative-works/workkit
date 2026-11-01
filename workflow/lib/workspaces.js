#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/workspaces.js: a repo's npm workspace members and their links,
// read as the publish plan reads them (ship/plan.js), and the members a package
// cannot see, which its record's tree id leaves out (wk_tree_hash in suite.sh).
// Usage: node workspaces.js <root> <pkg>   prints one excluded folder per line

const fs = require('fs');
const path = require('path');
const {
  PlanError, depNamesOf, expandWorkspaces, readJson,
} = require('../ship/plan');

const USAGE = 'usage: workspaces.js <root> <pkg>';

/** Whether folder `outer` is folder `inner` or holds it, both relative to the root. */
const holds = (outer, inner) => outer === inner || inner.startsWith(`${outer}/`);

/**
 * The workspace members the root package.json declares, expanded by plan.js's
 * expandWorkspaces.
 * @param {string} root the repo root
 * @returns {Array<{name: string, dir: string, deps: string[]}>} `dir` relative
 *   to the root, `deps` the member names it depends on; [] with no `workspaces`
 * @throws {PlanError} a package.json or a pattern plan.js refuses, its message plan.js's
 */
const membersOf = (root) => {
  const rootFile = path.join(root, 'package.json');
  if (!fs.existsSync(rootFile)) return [];
  const { workspaces } = readJson(rootFile);
  const found = expandWorkspaces(root, workspaces, []).map((abs) => {
    const pkg = readJson(path.join(abs, 'package.json'));
    return { name: pkg.name, dir: path.relative(root, abs).split(path.sep).join('/'), deps: depNamesOf(pkg) };
  });
  const names = new Set(found.map((m) => m.name));
  return found.map((m) => ({ ...m, deps: m.deps.filter((n) => names.has(n)) }));
};

/**
 * The members `pkg` neither is, holds, sits in, nor depends on (directly or
 * through other members), less any holding a kept member's folder: the
 * folders its tree id leaves out.
 * @param {string} root the repo root
 * @param {string} pkg a package folder relative to the root, `.` for the root
 * @returns {string[]} the member folders, sorted; [] for `.` or a PlanError, its message on stderr
 */
const excludedFor = (root, pkg) => {
  if (pkg === '.') return [];
  let members;
  let ownDeps = [];
  try {
    members = membersOf(root);
    const file = path.join(root, pkg, 'package.json');
    if (fs.existsSync(file)) ownDeps = depNamesOf(readJson(file));
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    console.error(`workspaces: ${err.message.replace(/\.$/, '')}; ${pkg} keyed to the whole tree`);
    return [];
  }
  const byName = new Map(members.map((m) => [m.name, m]));
  const near = members.filter((m) => holds(m.dir, pkg) || holds(pkg, m.dir));
  const kept = new Set(near);
  const queue = [...ownDeps, ...near.flatMap((m) => m.deps)].filter((n) => byName.has(n));
  while (queue.length > 0) {
    const member = byName.get(queue.pop());
    if (kept.has(member)) continue;
    kept.add(member);
    queue.push(...member.deps);
  }
  // Dropping a folder drops every folder in it, so a member holding a kept one stays.
  const keptDirs = [...kept].map((m) => m.dir);
  return members
    .filter((m) => !kept.has(m) && !keptDirs.some((dir) => holds(m.dir, dir)))
    .map((m) => m.dir)
    .sort();
};

/**
 * The CLI: one excluded folder per line.
 * @param {string[]} argv `<root> <pkg>`
 * @returns {number} the exit code
 */
const main = (argv) => {
  const [root, pkg] = argv;
  if (!root || !pkg) {
    console.error(USAGE);
    return 2;
  }
  for (const dir of excludedFor(root, pkg)) console.log(dir);
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { membersOf, excludedFor };
