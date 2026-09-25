#!/usr/bin/env node
/* eslint-disable no-console */
//
// The ship's release commit, made by one command instead of by hand: the three
// edits the ship skill's release step used to spell out, in its order.
//
//   1. Bump: `version` is set by TEXT in every version file that carries a
//      top-level one (package.json, and a plugin repo's
//      .claude-plugin/plugin.json), the first `"version": "<old>"` in each, so
//      its formatting, its key order and its line endings stay byte for byte
//      (never `npm version`, which commits). A file with no version is left
//      alone.
//   2. Backfill: each `[Unreleased]` entry gains its commit link and handle,
//      through changelog-links.js's own functions rather than a second copy.
//   3. Move: every `[Unreleased]` entry whose leading `[#N](...)` link is not
//      in `--keep` moves under a new `## [x.y.z] - <today>` section placed
//      directly after `[Unreleased]`, in the `### Category` it sat in and the
//      order the categories had. Kept entries stay under `[Unreleased]` in
//      theirs. A category left empty on either side is dropped. Everything
//      below the last `[Unreleased]` entry (the older sections, the link
//      references at the bottom) stays where it is.
//
// Each file is read once and written once, and only after every check has
// passed, so a refusal leaves both exactly as they were. A CRLF file stays CRLF.
//
// Run from the repo root:
//   node ~/.claude/workkit/release.js <x.y.z> [--keep N,M] [--dir <root>] [--dry-run]
// `--keep` takes issue numbers, comma separated or repeated. Prints
// `released x.y.z (<each file bumped>): N entries moved, M kept under [Unreleased]`,
// exit 0, and never commits, tags or pushes. `--dry-run` prints the same line
// and writes nothing. A moved entry the backfill could not link (no `Fixes #N`
// trailer in the range) and a `--keep` number matching no `[Unreleased]` entry
// are each named on stderr, and the release stands.
//
// A refusal prints one `release: ...` line on stderr, exit 1, nothing written:
// a version that is not semver or is one a version file already carries, no
// version file carrying a version at all, a CHANGELOG with no `[Unreleased]`
// heading, a release that would move nothing, and a line among the
// `[Unreleased]` entries that is neither an entry nor a category heading
// (moving it would be a guess). A usage error is exit 2.
//

const fs = require('fs');
const path = require('path');
const {
  ISSUE_LINK_RE, SECTION_RE, sectionKind, parseEntries,
} = require('./changelog');
const {
  repoSlug, commitsByIssue, authorHandle, fill, defaultRange,
} = require('./changelog-links');
const { isSemver } = require('./semver');

const USAGE = 'usage: release.js <x.y.z> [--keep N,M] [--dir <root>] [--dry-run]';
// The files a repo keeps its version in, by path from the root: the twin of the
// commit gate's version-stamp list (hooks/safety/commit-gate/run.sh), which
// passes exactly these bumps as bookkeeping. One changes, both change.
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

/**
 * A version file with its version set to `version`, by text: only the value
 * inside the first `"version": "<old>"` changes.
 * @param {string} text - the file as read
 * @param {string} version - the new version, already known to be semver
 * @param {string} name - the file's path from the root, for the messages
 * @returns {string|null} null when the file carries no top-level version
 */
const bumpVersion = (text, version, name) => {
  let current;
  try {
    current = JSON.parse(text).version;
  } catch {
    throw new ReleaseError(`release: ${name} does not parse as JSON; nothing was written.`);
  }
  if (typeof current !== 'string') return null;
  if (current === version) {
    throw new ReleaseError(`release: ${name} is already at ${version}; nothing was written.`);
  }
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`("version"\\s*:\\s*")${escaped}(")`);
  return text.replace(line, (_, open, close) => `${open}${version}${close}`);
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
  const bumps = [];
  for (const name of VERSION_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = bumpVersion(fs.readFileSync(file, 'utf8'), version, name);
    if (text !== null) bumps.push({ name, file, text });
  }
  if (bumps.length === 0) {
    throw new ReleaseError(`release: neither ${VERSION_FILES.join(' nor ')} carries a version; nothing was written.`);
  }

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

  if (!dryRun) {
    for (const bump of bumps) fs.writeFileSync(bump.file, bump.text);
    fs.writeFileSync(logFile, result.lines.join(eol));
  }
  return {
    bumped: bumps.map((b) => b.name), moved: result.moved, kept: result.kept, warnings,
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
  // Set the code, never process.exit(): exiting discards whatever console.log
  // has buffered when stdout is a PIPE. Same fix as changelog.js.
  process.exitCode = main(process.argv.slice(2));
}
