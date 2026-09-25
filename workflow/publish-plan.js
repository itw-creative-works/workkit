#!/usr/bin/env node
/* eslint-disable no-console */
//
// The ship's publish plan: which packages of a repo go to npm, in which order,
// and which are skipped and why. The ship skill's Step 5 runs this; without
// `--run` nothing here publishes, and with it the plan is published as printed.
//
// A root package.json with no `workspaces` is its own one candidate. With
// `workspaces` (the array, or the object's `packages`) the members are read
// from their own package.json files, never through `npm query .workspace`,
// which answers nothing until `npm install` has linked them: a fresh clone
// would read as nothing to publish. The expansion is the one the
// `safety/release-taken` hook makes, a literal directory and `dir/*` (every
// direct subdirectory holding a package.json), and the root of a workspaces
// repo is never a candidate. Any other glob shape refuses: a plan that leaves
// packages out in silence is a wrong plan.
//
// A package is a candidate when `private` is explicitly false AND it carries
// `files` or `publishConfig`; every other package is a skip with its reason.
// Candidates publish after every candidate they name in `dependencies`,
// `devDependencies` or `peerDependencies`, ties broken by name, so an exact
// internal pin is already on the registry when its dependent lands. A cycle
// has no order and refuses, spelled out.
//
// Run from the repo root:
//   node ~/.claude/workkit/publish-plan.js [--dir <root>]
// Prints `publish <name> <version> <scoped|unscoped>` lines in publish order,
// then `skip <name> <version> <reason>` lines. A `dir/*` pattern that matches
// no package is named on stderr and the plan stands. A refusal prints the
// first problem as one `publish-plan: ...` line on stderr, nothing on stdout,
// exit 1. A usage error (a flag with no value) is exit 2.
//
//   node ~/.claude/workkit/publish-plan.js --run [--dir <root>]
// Makes and prints the same plan, then publishes its `publish` lines in order
// from the root: `npm publish --workspace=<name>` when the root declares
// `workspaces`, a plain `npm publish` otherwise, `--access public` when the
// name is scoped, npm's own output left on the terminal. It never runs
// `prepare`; the ship runs that before it. A refusal publishes nothing.
//
// Each package asks the registry first, the question the `safety/release-taken`
// hook asks: that hook only sees a command whose word is `npm`, so a publish
// inside this run is not its trigger and the run asks for itself. A version
// already out prints `skipped <name> <version> already on npm` and the run goes
// on; a check that cannot be made says so on stderr and the publish proceeds,
// since npm itself refuses a taken version. Each publish prints
// `published <name> <version>`. The first failed publish stops the run with one
// `publish-plan: npm publish failed ...` line naming what was and was not
// published, exit 1. When every package was already out, one
// `nothing to publish: ...` line closes the run, exit 0.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isSemver } = require('./semver');

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];
const GLOB_RE = /[*?[]/;
// On Windows npm is `npm.cmd`, which Node starts only through a shell; every argument
// passed here (a package name, a version, a flag) has no whitespace, so the shell form is safe.
const NPM_SHELL = process.platform === 'win32';

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
 * silence: the same line the `safety/release-taken` hook prints.
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

/** How an npm call ended, for a line that names it: its exit code, or why it never had one. */
const npmEnd = (res) => {
  if (res.error) return `npm could not be run, ${res.error.code || res.error.message}`;
  if (res.status === null) return `npm was killed by ${res.signal}`;
  return `npm exited ${res.status}`;
};

/**
 * Is `name@version` already on the registry? The `safety/release-taken` hook's
 * npm question, flag for flag: one try, fifteen seconds, no prompt, no update
 * banner. E404 is the registry answering that the version is free; any other
 * failure stands the check down on stderr and answers free, so the publish
 * goes ahead and npm refuses the version itself if it is taken.
 */
const onRegistry = (root, { name, version }) => {
  const res = spawnSync('npm', ['view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', `${name}@${version}`, 'version'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: NPM_SHELL,
  });
  if (res.status === 0) return res.stdout.trim() === version;
  const stderr = res.stderr || '';
  if (res.status !== null && stderr.includes('E404')) return false;
  const why = stderr.split('\n')[0].trim() || npmEnd(res);
  console.error(`publish-plan: the npm check stood down for ${name}@${version}: ${why}; publishing anyway, npm refuses a taken version.`);
  return false;
};

/** Publish the plan's `publish` lines in order; the first failure stops the run. */
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
    const res = spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: NPM_SHELL });
    if (res.status !== 0) {
      const left = result.publish.slice(i + 1).map((l) => l.name);
      const end = res.error || res.status === null ? npmEnd(res) : `exit ${res.status}`;
      console.error(`publish-plan: npm publish failed for ${p.name}@${p.version} (${end}); ${published} published, ${left.length} not attempted: ${left.join(', ') || 'none'}.`);
      return 1;
    }
    published += 1;
    console.log(`published ${p.name} ${p.version}`);
  }
  if (result.publish.length > 0 && published === 0) {
    console.log('nothing to publish: every package is already on npm at its version');
  }
  return 0;
};

const main = (argv) => {
  let badFlag = null;
  const flag = (name) => {
    const at = argv.indexOf(name);
    if (at === -1) return undefined;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) badFlag = name;
    return value;
  };
  const dir = flag('--dir');
  if (badFlag) {
    console.error(`publish-plan: ${badFlag} needs a value.`);
    return 2;
  }

  const root = path.resolve(dir || process.cwd());
  let result;
  try {
    result = plan(root);
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    console.error(err.message);
    return 1;
  }
  for (const note of result.notes) console.error(note);
  for (const p of result.publish) console.log(`publish ${p.name} ${p.version} ${p.scoped ? 'scoped' : 'unscoped'}`);
  for (const s of result.skip) console.log(`skip ${s.name} ${s.version} ${s.reason}`);
  return argv.includes('--run') ? publishAll(root, result) : 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards whatever console.log
  // has buffered when stdout is a PIPE. Same fix as changelog.js.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { plan, PlanError };
