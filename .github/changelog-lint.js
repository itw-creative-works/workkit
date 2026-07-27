#!/usr/bin/env node
// Vendored from the workflow core's changelog.js by standards.sh — the kit is the SSOT; edit it there. This copy is resynced on every heal.
/* eslint-disable no-console */
//
// CHANGELOG entry format — the single home for the rules (SSOT).
//
// The layering: git history carries the full story (why, what was tried, what
// review caught); the CHANGELOG is the index a human scans to answer "what
// changed in this version, and does it affect me?". So an entry is one short
// paragraph pointing at the depth, never a second copy of the commit body.
//
// Canonical shapes — every link in its short form, so the repo URL appears
// nowhere in the file:
//   [Unreleased]  - [#4](../../issues/4) — Plugins install from settings.json.
//   released      - [#4](../../issues/4) [`1de1308`](../../commit/1de1308) Thanks [@who]! — Plugins install from settings.json.
//
// The commit link is derivable offline (remote URL + sha) so released sections
// require it; the @handle needs the GitHub API, so it is generated when
// resolvable and never demanded — an offline release still produces a valid
// CHANGELOG. Both are written by changelog-links.js, never by hand.
//
// Consumers: the docs/changelog-guard hook (write time, fast feedback) and the
// safety/commit-gate hook (commit time, the authority — it sees hand edits too).
// Both call this module so the rule has one home.
//
// CLI:
//   node changelog.js <file> [--added-only] [--staged] [--unreleased-only]
//     --added-only  judge only entries this change introduced (vs HEAD), so a
//                   repo with a legacy CHANGELOG is never bounced for history
//     --staged      read the file from the index and diff the index vs HEAD
//     --unreleased-only
//                   judge only the [Unreleased] section — the CI mode. A
//                   runner has the whole file and no notion of which lines a
//                   change added, and released history is already published,
//                   so holding a pull request to it would bounce work that
//                   did not touch it. Unreleased entries are the ones still
//                   being written, and the ones a release will publish.
//   Exits 1 with the violations on stderr, 0 when clean.
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RULES = {
  maxWords: 50,
};

const SECTION_RE = /^##\s+\[([^\]]+)\]/;
const HEADING_RE = /^#{1,2}(?!#)\s/;
const FENCE_RE = /^\s*(?:```|~~~)/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
// Links are written in their SHORT forms, so the repo URL appears nowhere in
// the file: `../../issues/4` and `../../commit/<sha>` are relative links GitHub
// resolves against the blob path, and `[@who]` is a shortcut reference whose one
// definition sits at the bottom of the file. Absolute URLs still parse — a repo
// migrating in keeps working — they are simply not what the generator writes.
const ISSUE_LINK_RE = /\[#(\d+)\]\([^)\s]+\)/;
const ISSUE_RE = /^(?:\[#\d+\]\([^)\s]+\)|\(no issue\))/;
const COMMIT_RE = /\[`[0-9a-f]{7,40}`\]\([^)\s]+\)/;
// The generated metadata run: the issue, then any commit links, then the
// attribution. The separator is required immediately AFTER it — searching the
// whole entry for an em dash would accept prose that merely contains one.
const META_RE = new RegExp(
  `^(?:\\[#\\d+\\]\\([^)\\s]+\\)|\\(no issue\\))`
  + `(?:\\s+\\[\`[0-9a-f]{7,40}\`\\]\\([^)\\s]+\\))*`
  + `(?:\\s+Thanks(?:\\s+\\[@[^\\]]+\\](?:\\([^)\\s]+\\))?)+!)?`,
);
const SEPARATOR = ' — ';

/**
 * Classify a `## [...]` heading. Only a semver-shaped label is a released
 * version — "any label with a digit" also caught prose headings like
 * `## [Plans for 2026]`, whose bullets then demanded commit links. Other `##`
 * headings (a prose section) are not changelog bodies and hold no entries.
 * @param {string} label the text inside the brackets
 * @returns {'unreleased'|'released'|null}
 */
const sectionKind = (label) => {
  if (/^unreleased$/i.test(label)) return 'unreleased';
  if (/^\d+\.\d+\.\d+/.test(label)) return 'released';
  return null;
};

/**
 * Split a CHANGELOG into entries. An entry is a top-level bullet plus its
 * INDENTED continuation lines, and it belongs to the nearest `## [...]` section
 * above it.
 *
 * Three things are deliberately not entries, because a guard that judges them
 * bounces correct work: anything inside a fenced code block (a file documenting
 * its own format), anything under a `##` heading that is not a version section
 * (a prose appendix), and any flush-left line after a bullet — which is what
 * keepachangelog's `[1.0.0]: <url>` reference footer is made of.
 * @param {string} text the whole file
 * @returns {Array<{line: number, endLine: number, section: string, kind: string, prose: string, multiParagraph: boolean}>}
 */
const parseEntries = (text) => {
  // A CRLF file must parse identically: `$` sits before the `\r`, so every
  // pattern here would miss and the whole file would read as zero entries —
  // a guard passing everything, silently.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  let section = null;
  let kind = null;
  let fenced = false;

  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const heading = SECTION_RE.exec(lines[i]);
    if (heading) {
      section = heading[1];
      kind = sectionKind(section);
      continue;
    }
    // A `#`/`##` heading that is not a version section ends the section it
    // follows; `###` is a category inside one and leaves it standing.
    if (HEADING_RE.test(lines[i])) {
      section = null;
      kind = null;
      continue;
    }
    if (lines[i].startsWith('#')) continue;
    if (!kind) continue;

    const bullet = BULLET_RE.exec(lines[i]);
    if (!bullet) continue;

    // Consume the wrapped continuation, which is always indented. A blank line
    // ends the entry UNLESS indented content follows — that is a second
    // paragraph, which the one-paragraph rule reports rather than swallowing.
    const body = [bullet[1]];
    let multiParagraph = false;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '') {
        const next = lines[j + 1];
        if (next === undefined || !/^\s+\S/.test(next)) break;
        multiParagraph = true;
        continue;
      }
      if (!/^\s+\S/.test(line)) break;
      body.push(line.trim());
      end = j;
    }

    entries.push({
      line: i + 1,
      endLine: end + 1,
      section,
      kind,
      prose: body.join(' ').replace(/\s+/g, ' ').trim(),
      multiParagraph,
    });
    i = end;
  }

  return entries;
};

/**
 * Judge one entry against every rule.
 * @param {object} entry from parseEntries
 * @returns {Array<{line: number, rule: string, message: string}>}
 */
const lintEntry = (entry) => {
  const found = [];
  const fail = (rule, message) => found.push({ line: entry.line, rule, message });

  if (!ISSUE_RE.test(entry.prose)) {
    fail('issue-link', 'must start with its issue link — `- [#4](../../issues/4) — text.` — or the literal `(no issue)` when there is none.');
  }

  // Anchor every metadata judgment to the generated run at the START of the
  // entry, never to the whole prose: an entry whose text merely MENTIONS a
  // commit-link-shaped string must not satisfy the released-section rule.
  const meta = META_RE.exec(entry.prose);

  // Only an entry naming its issue can be linked: the generator finds commits
  // through their `Fixes #N` trailers. `(no issue)` therefore means no links —
  // a nudge toward filing one, never a demand for a hand-typed sha.
  if (entry.kind === 'released' && /^\[#\d+\]/.test(entry.prose) && !(meta && COMMIT_RE.test(meta[0]))) {
    fail('commit-link', 'a released entry must carry its commit link (`[`1de1308`](…/commit/1de1308)`). Run changelog-links.js — the links are generated at release time, never typed.');
  }

  // Anchor the separator to the END of the metadata run, never to the first em
  // dash anywhere: entries use em dashes inside their prose, and searching the
  // whole line accepts an entry that never separated its links from its text
  // and then measures the word count from the wrong offset.
  const rest = meta ? entry.prose.slice(meta[0].length) : entry.prose;
  const separated = rest.startsWith(SEPARATOR);
  if (!separated) {
    fail('separator', 'an em dash surrounded by spaces (` — `) goes between the links and the text.');
  }

  const prose = separated ? rest.slice(SEPARATOR.length) : rest;
  const words = prose.split(/\s+/).filter(Boolean).length;
  if (words > RULES.maxWords) {
    fail('word-cap', `${words} words (max ${RULES.maxWords}) — say what changed and who it affects; the why, the evidence, and the journey stay in the commit message.`);
  }

  if (entry.multiParagraph) {
    fail('one-paragraph', 'one paragraph per entry — a second paragraph is detail that belongs in the commit message or the issue.');
  }

  return found;
};

/**
 * Did this change touch any line of the entry? Editing only a wrapped entry's
 * SECOND line still rewrites the entry, so anchoring on its first line alone
 * lets an edit walk straight past the guard.
 * @param {object} entry from parseEntries
 * @param {Set<number>} lines 1-based added line numbers
 * @returns {boolean}
 */
const entryTouched = (entry, lines) => {
  for (let n = entry.line; n <= entry.endLine; n++) {
    if (lines.has(n)) return true;
  }
  return false;
};

/**
 * Lint a CHANGELOG's text.
 * @param {string} text the whole file
 * @param {Set<number>|null} onlyLines judge only entries touching these 1-based
 *   lines; null judges every entry
 * @param {boolean} unreleasedOnly judge only entries in the [Unreleased]
 *   section. Composes with onlyLines — both filters apply.
 * @returns {Array<{line: number, rule: string, message: string}>}
 */
const lintText = (text, onlyLines = null, unreleasedOnly = false) => parseEntries(text)
  .filter((entry) => !onlyLines || entryTouched(entry, onlyLines))
  .filter((entry) => !unreleasedOnly || entry.kind === 'unreleased')
  .flatMap(lintEntry);

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The 1-based line numbers this change ADDS to a file, relative to HEAD.
 * A file git does not know about yet counts as entirely added.
 * @param {string} file absolute path
 * @param {boolean} staged compare the index (rather than the working tree) to HEAD
 * @returns {Set<number>|null} null when git cannot answer — the caller then judges everything
 */
const addedLines = (file, staged) => {
  const cwd = path.dirname(file);
  let diff;
  try {
    const args = ['diff', '--unified=0'];
    if (staged) args.push('--cached');
    diff = git([...args, 'HEAD', '--', file], cwd);
  } catch {
    return null;
  }

  // No diff at all: either untracked (everything is new) or unchanged (nothing is).
  if (!diff.trim()) {
    try {
      git(['ls-files', '--error-unmatch', '--', file], cwd);
      return new Set();
    } catch {
      return null;
    }
  }

  const lines = new Set();
  let cursor = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      cursor = parseInt(hunk[1], 10);
      inHunk = true;
      continue;
    }
    // The `+++ b/file` header is only a header BEFORE the first hunk. Inside
    // one, a line reading `+++ …` is file content that happens to start with a
    // plus, and skipping it without advancing the cursor would misnumber every
    // added line after it.
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      lines.add(cursor);
      cursor++;
    }
  }
  return lines;
};

/**
 * Read the content to judge — the index's copy when gating a commit, the file
 * on disk otherwise.
 * @param {string} file absolute path
 * @param {boolean} staged
 * @returns {string|null} null when there is nothing to read
 */
const readSource = (file, staged) => {
  if (!staged) return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const cwd = path.dirname(file);
  try {
    const rel = git(['ls-files', '--full-name', '--', file], cwd).trim();
    if (!rel) return null;
    return git(['show', `:${rel}`], cwd);
  } catch {
    return null;
  }
};

const main = (argv) => {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: changelog.js <file> [--added-only] [--staged] [--unreleased-only]');
    return 2;
  }

  const abs = path.resolve(file);
  const staged = flags.has('--staged');
  const text = readSource(abs, staged);
  if (text === null) return 0;

  const onlyLines = flags.has('--added-only') ? addedLines(abs, staged) : null;
  const violations = lintText(text, onlyLines, flags.has('--unreleased-only'));
  if (violations.length === 0) return 0;

  console.error(`${path.basename(abs)} — the entry format (see docs/project-state.md → "CHANGELOG entries"):`);
  for (const v of violations) {
    console.error(`  line ${v.line} [${v.rule}] ${v.message}`);
  }
  return 1;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards whatever console.error
  // has buffered when stdout/stderr is a PIPE, so a caller counting the
  // violations got a short, varying list. Node exits on its own once the
  // streams have flushed (found by review 2026-07-25, standards.sh consumer).
  process.exitCode = main(process.argv.slice(2));
}

// Exported for the guards (RULES, parseEntries, lintText) and for
// changelog-links.js, which must agree with this file about what an entry looks
// like and what "already has its links" means — one home, no second copy.
module.exports = { RULES, COMMIT_RE, ISSUE_LINK_RE, META_RE, parseEntries, lintText };
