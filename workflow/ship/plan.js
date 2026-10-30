#!/usr/bin/env node
/* eslint-disable no-console */
// The ship's publish plan: which packages of a repo go to npm, in which order,
// and which are skipped and why (the rules and the lines: `skills/ship/SKILL.md`
// Step 5). Members are read from their own package.json files, never through
// `npm query .workspace`, which answers nothing before `npm install`. The
// library release.js and publish.js require, with how both start npm and name
// its end; publish.js does the publishing.
//
// Run from the repo root:
//   workkit ship plan [--dir <root>]

const fs = require('fs');
const path = require('path');
const { isSemver } = require('./semver');

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];
const GLOB_RE = /[*?[]/;
// On Windows npm is `npm.cmd`, which Node starts only through a shell; every argument
// passed to it (a package name, a version, a flag, a workspace folder, which the release
// step refuses when it has whitespace) has none, so the shell form is safe.
const NPM_SHELL = process.platform === 'win32';

/** How an npm call ended, for a line that names it: its exit code, or why it never had one. */
const npmEnd = (res) => {
  if (res.error) return `npm could not be run, ${res.error.code || res.error.message}`;
  if (res.status === null) return `npm was killed by ${res.signal}`;
  return `npm exited ${res.status}`;
};

/** A refusal: the plan cannot be made, and the message says why. */
class PlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanError';
  }
}

/**
 * Read a JSON object from a file, refusing one that does not parse, or parses
 * to something that is not an object, rather than reading it as absent.
 */
const readJson = (file) => {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new PlanError(`publish-plan: ${file} does not parse as JSON, so no plan was made.`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanError(`publish-plan: ${file} does not hold a JSON object, so no plan was made.`);
  }
  return value;
};

/**
 * The workspace member directories a root declares, expanded for a literal
 * directory and `dir/*`, refusing every other glob shape and a literal member
 * with no package.json. A `dir/*` that matches nothing is a note, never a
 * silence: the same line the `safety:release-taken` hook prints.
 */
const expandWorkspaces = (root, workspaces, notes) => {
  let patterns = [];
  if (Array.isArray(workspaces)) patterns = workspaces;
  else if (workspaces && Array.isArray(workspaces.packages)) patterns = workspaces.packages;

  const dirs = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith('/*') && !GLOB_RE.test(pattern.slice(0, -2))) {
      const parent = path.join(root, pattern.slice(0, -2));
      const entries = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }) : [];
      let matched = 0;
      for (const entry of entries) {
        const dir = path.join(parent, entry.name);
        if (entry.isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) {
          dirs.add(dir);
          matched += 1;
        }
      }
      if (matched === 0) notes.push(`publish-plan: the workspace pattern ${pattern} matched no package, so nothing under it was planned.`);
    } else if (GLOB_RE.test(pattern)) {
      throw new PlanError(`publish-plan: the workspace pattern ${pattern} is not one this plan expands (a directory, or dir/*), so no plan was made.`);
    } else {
      const dir = path.join(root, pattern);
      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        throw new PlanError(`publish-plan: the workspace member ${pattern} holds no package.json, so no plan was made.`);
      }
      dirs.add(dir);
    }
  }
  return [...dirs];
};

/** Why a package is not a candidate, or null when it is one. */
const skipReason = (pkg) => {
  if (!('private' in pkg)) return 'private absent';
  if (pkg.private !== false) return 'private';
  if (pkg.files == null && pkg.publishConfig == null) return 'no publish signal';
  return null;
};

/** The candidates in publish order: dependencies first, ties by name. */
const order = (candidates) => {
  const byName = new Map(candidates.map((c) => [c.name, c]));
  const needs = new Map(candidates.map((c) => [
    c.name,
    new Set(DEP_FIELDS.flatMap((field) => Object.keys(c.pkg[field] || {})).filter((n) => byName.has(n))),
  ]));

  const done = [];
  const left = new Set([...byName.keys()].sort());
  while (left.size > 0) {
    const ready = [...left].find((name) => [...needs.get(name)].every((dep) => !left.has(dep)));
    if (ready === undefined) throw new PlanError(`publish-plan: the workspaces depend on each other in a cycle, ${findCycle(left, needs)}, so they have no publish order.`);
    left.delete(ready);
    done.push(byName.get(ready));
  }
  return done;
};

/** One cycle among the packages left unordered, spelled `a -> b -> a`. */
const findCycle = (left, needs) => {
  const stack = [];
  const seen = new Set();
  const walk = (name) => {
    const at = stack.indexOf(name);
    if (at !== -1) return [...stack.slice(at), name].join(' -> ');
    if (seen.has(name)) return null;
    seen.add(name);
    stack.push(name);
    for (const dep of [...needs.get(name)].filter((n) => left.has(n)).sort()) {
      const found = walk(dep);
      if (found) return found;
    }
    stack.pop();
    return null;
  };
  for (const name of left) {
    const found = walk(name);
    if (found) return found;
  }
  // Unreachable: every package left has an unfinished dependency that is
  // itself left, so a walk along them must revisit one.
  throw new Error('publish-plan: no cycle found among packages with no order');
};

/**
 * The publish plan for a repo.
 * @param {string} root - the repo root holding the package.json
 * @returns {{publish: Array<{name: string, version: string, scoped: boolean}>, skip: Array<{name: string, version: string, reason: string}>, notes: string[], workspaces: boolean}}
 *   `notes` are the stderr lines a plan that stands still owes (a pattern that matched nothing);
 *   `workspaces` is whether the root declares them, which is how its packages publish
 * @throws {PlanError} when the plan cannot be made, its message the line to print
 */
const plan = (root) => {
  const rootFile = path.join(root, 'package.json');
  if (!fs.existsSync(rootFile)) throw new PlanError(`publish-plan: no package.json at ${root}, so there is nothing to plan.`);
  const rootPkg = readJson(rootFile);
  const notes = [];

  // The packages: the root alone, or every workspace member and never the root.
  const files = rootPkg.workspaces === undefined
    ? [rootFile]
    : expandWorkspaces(root, rootPkg.workspaces, notes).map((dir) => path.join(dir, 'package.json'));

  const candidates = [];
  const skip = [];
  for (const file of files) {
    const pkg = file === rootFile ? rootPkg : readJson(file);
    const where = path.relative(root, path.dirname(file)) || '.';
    const reason = skipReason(pkg);
    if (reason) {
      skip.push({ name: pkg.name || where, version: pkg.version || '-', reason });
      continue;
    }
    if (!pkg.name || !pkg.version) {
      throw new PlanError(`publish-plan: the package at ${where} has no name or no version, so it cannot be published.`);
    }
    if (!isSemver(pkg.version)) {
      throw new PlanError(`publish-plan: ${pkg.name} has the version ${pkg.version}, which is not a semver version.`);
    }
    const twin = candidates.find((c) => c.name === pkg.name);
    if (twin) throw new PlanError(`publish-plan: two packages are named ${pkg.name} (${twin.where} and ${where}), so no plan was made.`);
    candidates.push({ name: pkg.name, version: pkg.version, where, pkg });
  }

  return {
    publish: order(candidates).map((c) => ({ name: c.name, version: c.version, scoped: c.name.startsWith('@') })),
    skip: skip.sort((a, b) => (a.name < b.name ? -1 : 1)),
    notes,
    workspaces: rootPkg.workspaces !== undefined,
  };
};

/**
 * The CLI's shared half: read `--dir`, make the plan, print its lines. Any
 * other argument is refused, so a flag meant for another command never runs
 * this one silently.
 * @param {string[]} argv - the arguments after the script
 * @returns {{code: number, root?: string, result?: object}} the exit code, and
 *   on 0 the root and the plan, for publish.js to publish
 */
const report = (argv) => {
  let dir;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--dir') {
      console.error(`publish-plan: ${argv[i]} is not an argument this command takes; it takes only --dir <root>.`);
      return { code: 2 };
    }
    dir = argv[i + 1];
    if (dir === undefined || dir.startsWith('--')) {
      console.error('publish-plan: --dir needs a value.');
      return { code: 2 };
    }
    i += 1;
  }

  const root = path.resolve(dir || process.cwd());
  let result;
  try {
    result = plan(root);
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    console.error(err.message);
    return { code: 1 };
  }
  for (const note of result.notes) console.error(note);
  for (const p of result.publish) console.log(`publish ${p.name} ${p.version} ${p.scoped ? 'scoped' : 'unscoped'}`);
  for (const s of result.skip) console.log(`skip ${s.name} ${s.version} ${s.reason}`);
  return { code: 0, root, result };
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards console.log output
  // still buffered for a pipe.
  process.exitCode = report(process.argv.slice(2)).code;
}

module.exports = {
  plan, expandWorkspaces, PlanError, report, NPM_SHELL, npmEnd,
};
