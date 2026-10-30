#!/usr/bin/env node
/* eslint-disable no-console */
// The ship's release commit in one command: the bump (through npm, so the
// lockfile moves too), the backfill, and the move of every `[Unreleased]` entry
// not in `--keep` under a new version section (`workflow/README.md`, the
// ship/release.js row). Every check passes before a write; CRLF stays CRLF.
//
// Run from the repo root:
//   workkit ship release <x.y.z> [--keep N,M] [--dir <root>] [--dry-run]

const fs = require('fs');
const path = require('path');
const {
  ISSUE_LINK_RE, SECTION_RE, sectionKind, parseEntries,
} = require('../changelog/lint');
const {
  repoSlug, commitsByIssue, authorHandle, fill, defaultRange,
} = require('../changelog/changelog-links');
const { isSemver } = require('./semver');
const {
  expandWorkspaces, PlanError, spawnNpm, npmEnd,
} = require('./plan');

const USAGE = 'usage: workkit ship release <x.y.z> [--keep N,M] [--dir <root>] [--dry-run]';
// The files a repo keeps its version in, by path from the root: every one is in
// the commit gate's version-stamp list (isManifest in hooks/mods/commit-gate/checks.js), which
// passes these bumps, and a nested package.json's or plugin manifest's, as bookkeeping.
const VERSION_FILES = ['package.json', '.claude-plugin/plugin.json'];
const CATEGORY_RE = /^###\s+\S/;

/** A refusal: the release cannot be made, and the message says why. */
class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseError';
  }
}

/** Today in the local calendar, as the section heading spells it. */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A version file's top-level version, refusing a file that does not parse. */
const versionOf = (text, name) => {
  try {
    return JSON.parse(text).version;
  } catch {
    throw new ReleaseError(`release: ${name} does not parse as JSON; nothing was written.`);
  }
};

/**
 * A version file's top-level version, refusing one already at `version`.
 * @param {string} text - the file as read
 * @param {string} version - the new version, already known to be semver
 * @param {string} name - the file's path from the root, for the messages
 * @returns {string|null} null when the file carries no top-level version
 */
const currentVersion = (text, version, name) => {
  const current = versionOf(text, name);
  if (typeof current !== 'string') return null;
  if (current === version) {
    throw new ReleaseError(`release: ${name} is already at ${version}; nothing was written.`);
  }
  return current;
};

/**
 * A version file npm does not know with its version set to `version`, by
 * text: only the value inside the first `"version": "<current>"` changes.
 * @param {string} text - the file as read
 * @param {string} current - its version, from currentVersion
 * @param {string} version - the new version
 * @returns {string}
 */
const bumpVersion = (text, current, version) => {
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`("version"\\s*:\\s*")${escaped}(")`);
  return text.replace(line, (_, open, close) => `${open}${version}${close}`);
};

/**
 * The lockstep members: every workspace member of the root package.json whose
 * version is `old`; a member at any other version moves on its own.
 * @param {string} root - the repo root
 * @param {string} old - the version the root's version files carried
 * @returns {Array<{name: string, dir: string}>} each member's package.json and
 *   folder, by path from the root
 */
const lockstepMembers = (root, old) => {
  const rootFile = path.join(root, 'package.json');
  if (!fs.existsSync(rootFile)) return [];
  const { workspaces } = JSON.parse(fs.readFileSync(rootFile, 'utf8'));
  if (workspaces === undefined) return [];
  let dirs;
  try {
    dirs = expandWorkspaces(root, workspaces, []);
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    throw new ReleaseError(`release: the workspace members cannot be read (${err.message}); nothing was written.`);
  }
  const members = [];
  for (const dir of dirs.sort()) {
    const file = path.join(dir, 'package.json');
    const name = path.relative(root, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    if (versionOf(text, name) !== old) continue;
    const folder = path.posix.dirname(name);
    if (/\s/.test(folder)) {
      throw new ReleaseError(`release: workspace folder '${folder}' has whitespace, which npm's Windows shell start would split; nothing was written.`);
    }
    members.push({ name, dir: folder });
  }
  return members;
};

/**
 * Set the version through npm: package.json, each lockstep member's, and the
 * lockfile's spots for each, with no commit and no tag. A workspaces bump ends
 * in an install that syncs the lockfile; `--package-lock-only` keeps that
 * install to the lockfile and node_modules untouched, and with no lockfile
 * `--no-workspaces-update` skips it, so none is made. npm writes before its
 * `version` script runs, so on any failure every file it may write is put back.
 * @param {string} root - the repo root
 * @param {string} version - the new version
 * @param {object} bump - { withRoot: whether package.json carries a version, members: lockstepMembers' }
 */
const npmVersion = (root, version, { withRoot, members }) => {
  const lockfile = path.join(root, 'package-lock.json');
  const args = ['version', version, '--no-git-tag-version', '--package-lock-only', '--no-update-notifier'];
  for (const m of members) args.push(`--workspace=${m.dir}`);
  if (withRoot && members.length > 0) args.push('--include-workspace-root');
  if (members.length > 0 && !fs.existsSync(lockfile)) args.push('--no-workspaces-update');
  const saved = ['package.json', ...members.map((m) => m.name), 'package-lock.json'].map((name) => {
    const file = path.join(root, name);
    return { file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null };
  });
  const res = spawnNpm(args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) return;
  for (const { file, bytes } of saved) {
    if (bytes === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, bytes);
  }
  const said = (res.stderr || '').split('\n').map((l) => l.trim()).find(Boolean);
  throw new ReleaseError(`release: npm ${args.join(' ')} failed (${npmEnd(res)}${said ? `: ${said}` : ''}); every file npm wrote was put back, and nothing else was written.`);
};

/** Does this line head the `[Unreleased]` section? */
const isUnreleasedHeading = (line) => {
  const heading = SECTION_RE.exec(line);
  return Boolean(heading) && sectionKind(heading[1]) === 'unreleased';
};

/**
 * The CHANGELOG's lines with `[Unreleased]` split into what stays and a new
 * `## [<version>] - <date>` section holding what moves.
 * @param {string[]} lines - the file, one element per line, no line endings
 * @param {object} release - { version, date, keep: Set<string> of issue numbers }
 * @returns {{lines: string[], moved: number, kept: number, strays: string[]}}
 *   `strays` are the `keep` numbers no entry's leading link names
 */
const moveUnreleased = (lines, { version, date, keep }) => {
  const entries = parseEntries(lines.join('\n')).filter((e) => e.kind === 'unreleased');
  if (entries.length === 0) {
    if (!lines.some(isUnreleasedHeading)) {
      throw new ReleaseError('release: CHANGELOG.md has no [Unreleased] heading; nothing was written.');
    }
    throw new ReleaseError(`release: nothing under [Unreleased] would move to ${version}; nothing was written.`);
  }

  // The heading is the nearest one above the first entry: parseEntries named
  // that entry's section from exactly that line.
  let headingAt = entries[0].line - 1;
  while (!isUnreleasedHeading(lines[headingAt])) headingAt--;
  const lastEnd = entries[entries.length - 1].endLine - 1;

  // Walk the body, heading to last entry, into category blocks. A block keeps
  // the blank lines under its heading (`lead`), and each entry the blank lines
  // after it (`gap`), so a kept block reads the way it was written.
  const byLine = new Map(entries.map((e) => [e.line - 1, e]));
  const blocks = [];
  let block = null;
  for (let i = headingAt + 1; i <= lastEnd; i++) {
    const entry = byLine.get(i);
    if (entry) {
      if (!block) {
        block = { heading: null, lead: [], items: [] };
        blocks.push(block);
      }
      const issue = ISSUE_LINK_RE.exec(entry.prose);
      const kept = Boolean(issue) && issue.index === 0 && keep.has(issue[1]);
      block.items.push({ lines: lines.slice(i, entry.endLine), gap: [], kept });
      i = entry.endLine - 1;
      continue;
    }
    if (lines[i].trim() === '') {
      if (block) (block.items.length ? block.items[block.items.length - 1].gap : block.lead).push(lines[i]);
      continue;
    }
    if (CATEGORY_RE.test(lines[i])) {
      block = { heading: lines[i], lead: [], items: [] };
      blocks.push(block);
      continue;
    }
    throw new ReleaseError(`release: CHANGELOG.md line ${i + 1} under [Unreleased] is neither an entry nor a category heading; nothing was written.`);
  }

  /** One side of a block, or null when that side holds no entry. */
  const side = (b, wanted) => {
    const items = b.items.filter((item) => item.kept === wanted);
    if (items.length === 0) return null;
    const out = b.heading === null ? [] : [b.heading, ...b.lead];
    items.forEach((item, n) => out.push(...item.lines, ...(n < items.length - 1 ? item.gap : [])));
    return out;
  };
  const stays = blocks.map((b) => side(b, true)).filter(Boolean);
  const moves = blocks.map((b) => side(b, false)).filter(Boolean);
  if (moves.length === 0) {
    throw new ReleaseError(`release: nothing under [Unreleased] would move to ${version}; nothing was written.`);
  }

  const out = [...lines.slice(0, headingAt + 1), ''];
  for (const b of stays) out.push(...b, '');
  out.push(`## [${version}] - ${date}`, '');
  moves.forEach((b, n) => out.push(...b, ...(n < moves.length - 1 ? [''] : [])));
  out.push(...lines.slice(lastEnd + 1));

  const count = (wanted) => blocks.reduce((sum, b) => sum + b.items.filter((i) => i.kept === wanted).length, 0);
  const issues = new Set(entries.map((e) => ISSUE_LINK_RE.exec(e.prose)).filter((m) => m && m.index === 0).map((m) => m[1]));
  const strays = [...keep].filter((n) => !issues.has(n));
  return {
    lines: out, moved: count(false), kept: count(true), strays,
  };
};

/**
 * Make the release in `root`: every check, then every write.
 * @param {string} root - the repo root holding the version files and CHANGELOG.md
 * @param {object} options - { version, keep: Set<string>, dryRun, date }
 * @returns {{bumped: string[], moved: number, kept: number, warnings: string[]}}
 *   `bumped` names each version file written, by path from the root
 */
const release = (root, { version, keep, dryRun, date }) => {
  if (!isSemver(version)) {
    throw new ReleaseError(`release: ${version} is not a semver version; nothing was written.`);
  }
  const logFile = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(logFile)) {
    throw new ReleaseError(`release: no CHANGELOG.md in ${root}; nothing was written.`);
  }
  const found = [];
  for (const name of VERSION_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const current = currentVersion(text, version, name);
    if (current !== null) found.push({ name, file, text, current });
  }
  if (found.length === 0) {
    throw new ReleaseError(`release: neither ${VERSION_FILES.join(' nor ')} carries a version; nothing was written.`);
  }
  // npm owns package.json and the lockfile; a version file it does not know is set by text.
  const npm = { withRoot: found[0].name === 'package.json', members: lockstepMembers(root, found[0].current) };
  const byNpm = npm.withRoot || npm.members.length > 0;
  const byText = found.filter((f) => f.name !== 'package.json');
  const bumped = [...found.map((f) => f.name), ...npm.members.map((m) => m.name)];
  if (byNpm && fs.existsSync(path.join(root, 'package-lock.json'))) bumped.push('package-lock.json');

  const range = defaultRange(root);
  let byIssue;
  try {
    byIssue = commitsByIssue(range, root);
  } catch {
    throw new ReleaseError(`release: git cannot read the range ${range} in ${root}; nothing was written.`);
  }
  // The commit links are relative and need no remote; the handle needs a
  // GitHub one, and without it the entry simply carries no attribution.
  const slug = repoSlug(root);
  const cache = new Map();
  const filled = fill(fs.readFileSync(logFile, 'utf8'), {
    byIssue,
    resolve: slug ? (sha) => authorHandle(slug, sha, root, cache) : () => null,
  });

  // fill() hands the file back joined with its one dominant line ending, so
  // that answer is read off its output rather than decided a second time.
  const eol = filled.text.includes('\r\n') ? '\r\n' : '\n';
  const result = moveUnreleased(filled.text.split(eol), { version, date, keep });

  const warnings = [
    ...result.strays.map((n) => `release: --keep #${n} matches no [Unreleased] entry.`),
    ...[...new Set(filled.unmatched)]
      .filter((n) => !keep.has(n))
      .map((n) => `release: #${n} has no closing commit in ${range}; its entry moved without a commit link: add a "Fixes #${n}" trailer, or link it by hand.`),
  ];

  // npm goes first: it is the write that can still fail, and then nothing else is written.
  if (!dryRun) {
    if (byNpm) npmVersion(root, version, npm);
    for (const f of byText) fs.writeFileSync(f.file, bumpVersion(f.text, f.current, version));
    fs.writeFileSync(logFile, result.lines.join(eol));
  }
  return {
    bumped, moved: result.moved, kept: result.kept, warnings,
  };
};

/** The arguments, or a usage message. */
const parseArgs = (argv) => {
  const args = { keep: new Set(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--keep' || arg === '--dir') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) return { usage: `release: ${arg} needs a value.` };
      if (arg === '--dir') {
        args.dir = value;
        continue;
      }
      for (const n of value.split(',').map((s) => s.trim())) {
        if (!/^\d+$/.test(n)) return { usage: `release: --keep takes issue numbers, got "${n}".` };
        args.keep.add(n);
      }
    } else if (arg.startsWith('--') || args.version !== undefined) {
      return { usage: `release: unexpected argument ${arg}; ${USAGE}` };
    } else {
      args.version = arg;
    }
  }
  if (args.version === undefined) return { usage: `release: ${USAGE}` };
  return args;
};

const main = (argv) => {
  const args = parseArgs(argv);
  if (args.usage) {
    console.error(args.usage);
    return 2;
  }
  let result;
  try {
    result = release(path.resolve(args.dir || process.cwd()), { ...args, date: today() });
  } catch (err) {
    if (!(err instanceof ReleaseError)) throw err;
    console.error(err.message);
    return 1;
  }
  for (const warning of result.warnings) console.error(warning);
  console.log(`released ${args.version} (${result.bumped.join(', ')}): ${result.moved} entries moved, ${result.kept} kept under [Unreleased]`);
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards console.log output
  // still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}
