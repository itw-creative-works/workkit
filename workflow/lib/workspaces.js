/* eslint-disable no-console */
// workflow/lib/workspaces.js: a repo's npm workspace members and their links,
// read by the one expansion the publish plan uses (expand-workspaces.js), and
// the members a package cannot see, which its record's tree id leaves out
// (treeId in tree-hash.js).
// Usage: const { membersOf, excludedFor } = require('./workspaces');

const fs = require('fs');
const path = require('path');
const { expandWorkspaces, PlanError } = require('./expand-workspaces');
const { depNamesOf, readJson } = require('../ship/plan');

/** Whether folder `outer` is folder `inner` or holds it, both relative to the root. */
const holds = (outer, inner) => outer === inner || inner.startsWith(`${outer}/`);

/**
 * The workspace members the root package.json declares, expanded by
 * expand-workspaces.js.
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

module.exports = { membersOf, excludedFor };
