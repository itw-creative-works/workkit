#!/usr/bin/env node
/* eslint-disable no-console */
//
// Fill in a CHANGELOG entry's generated metadata — the commit link and the
// contributor handle.
//
// Nobody types a sha. An entry is written during ordinary work as
//   - [#4](../../issues/4) — Plugins install from settings.json.
// and this script turns it into
//   - [#4](../../issues/4) [`1de1308`](../../commit/1de1308) Thanks [@who]! — Plugins install from settings.json.
//
// Every link is written in its SHORT form, so the repo URL appears nowhere in
// the file: `../..` paths are relative links GitHub resolves against the blob
// path (they also follow a fork), and `[@who]` is a shortcut reference defined
// once at the bottom of the file however many entries a person appears in.
//
// `../..` assumes the CHANGELOG sits at the repo root on a branch whose name
// has no slash — the blob path is `/<owner>/<repo>/blob/<branch>/CHANGELOG.md`.
// A nested `--file` or a `feature/x` branch shifts that depth and the links
// land short. Both are outside how this is used; worth knowing before moving
// the file.
//
// Entries are matched to commits through the `Fixes #N` trailer the commit
// already carries, so the mapping is the one git records rather than a second
// list to maintain. An entry already carrying a commit link is left untouched,
// which makes a re-run a no-op. The handle comes from the GitHub API (it maps
// the commit email to the account exactly); without network the commit link
// still lands and the attribution is simply absent.
//
// Run at release time, from the repo root:
//   node ~/.claude/workkit/changelog-links.js [--file CHANGELOG.md] [--range v3.1.0..HEAD] [--dry-run]
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// What an entry IS, and what "already linked" means, come from changelog.js —
// the same shapes the guards enforce. A second copy here would drift, and the
// two files would disagree about which entries still need filling.
const { COMMIT_RE, ISSUE_LINK_RE, META_RE, parseEntries } = require('./changelog');

const TRAILER_RE = /\b(?:fixes|closes|resolves)\s+#(\d+)\b/gi;

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The origin remote's URL, or null when the repo has no origin remote.
 * @param {string} cwd repo directory
 * @returns {string|null}
 */
const originUrl = (cwd) => {
  try {
    return run('git', ['remote', 'get-url', 'origin'], cwd);
  } catch {
    return null;
  }
};

/**
 * owner/name for the origin remote, from either URL form. A trailing slash on
 * the URL is tolerated — remotes get pasted with one.
 * @param {string} cwd repo directory
 * @returns {string|null}
 */
const repoSlug = (cwd) => {
  const url = originUrl(cwd);
  if (url === null) return null;
  const match = /(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return match ? match[1] : null;
};

/**
 * The default range: everything since the most recent tag, or all history in a
 * repo that has never been tagged.
 * @param {string} cwd repo directory
 * @returns {string}
 */
const defaultRange = (cwd) => {
  try {
    return `${run('git', ['describe', '--tags', '--abbrev=0'], cwd)}..HEAD`;
  } catch {
    return 'HEAD';
  }
};

/**
 * Map every issue closed in the range to the commits that closed it.
 * @param {string} range a git rev-range
 * @param {string} cwd repo directory
 * @returns {Map<string, string[]>} issue number → short shas, oldest first
 */
const commitsByIssue = (range, cwd) => {
  const log = run('git', ['log', range, '--format=%h%x1f%B%x1e'], cwd);
  const byIssue = new Map();
  for (const record of log.split('\x1e')) {
    const [sha, body] = record.split('\x1f');
    if (!sha || !body) continue;
    const seen = new Set();
    for (const hit of body.matchAll(TRAILER_RE)) {
      if (seen.has(hit[1])) continue;
      seen.add(hit[1]);
      if (!byIssue.has(hit[1])) byIssue.set(hit[1], []);
      byIssue.get(hit[1]).unshift(sha.trim());
    }
  }
  return byIssue;
};

/**
 * The GitHub login that authored a commit, or null when it cannot be resolved
 * (no `gh`, no network, an unauthenticated machine, an unmatched email).
 * @param {string} slug owner/name
 * @param {string} sha
 * @param {string} cwd repo directory
 * @param {Map<string, string|null>} cache
 * @returns {string|null}
 */
const authorHandle = (slug, sha, cwd, cache) => {
  if (cache.has(sha)) return cache.get(sha);
  let handle = null;
  try {
    const out = run('gh', ['api', `repos/${slug}/commits/${sha}`, '--jq', '.author.login'], cwd);
    handle = out && out !== 'null' ? out : null;
  } catch {
    handle = null;
  }
  cache.set(sha, handle);
  return handle;
};

/**
 * Rewrite the entries that are missing their generated metadata.
 *
 * Only entries the parser reports under `[Unreleased]` are candidates. A raw
 * line-walk would also rewrite bullets inside a fenced block (a CHANGELOG
 * documenting its own format) and entries in old released sections whose issue
 * number happens to recur in the range — both permanent corruption. Filling
 * before the release move is also the documented order in the ship skill.
 * @param {string} text the CHANGELOG
 * @param {object} ctx { byIssue, resolve }
 * @returns {{text: string, filled: number, unmatched: string[]}}
 */
const fill = (text, { byIssue, resolve }) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // The file's dominant line ending, detected once and used for the one join
  // below — a CRLF file must come back CRLF, not silently rewritten line by
  // line to LF.
  const crlf = (text.match(/\r\n/g) || []).length;
  const eol = crlf > lines.length - 1 - crlf ? '\r\n' : '\n';
  const contributors = new Set();
  const unmatched = [];
  let filled = 0;

  for (const entry of parseEntries(text)) {
    if (entry.kind !== 'unreleased') continue;

    const index = entry.line - 1;
    const line = lines[index];
    // "Already linked" means a commit link in the generated metadata RUN, the
    // same anchor the lint uses — a commit-link-shaped string in the prose must
    // not suppress the fill (or it would be skipped and never reported).
    const meta = META_RE.exec(entry.prose);
    if (meta && COMMIT_RE.test(meta[0])) continue;

    const issue = ISSUE_LINK_RE.exec(line);
    if (!issue) continue;

    const shas = byIssue.get(issue[1]);
    if (!shas || shas.length === 0) {
      // No commit in this range closed it — the entry names an issue whose
      // commit carries no `Fixes #N` trailer. Reported, never silently passed.
      unmatched.push(issue[1]);
      continue;
    }

    // Relative link: GitHub resolves it against the blob path, so the repo URL
    // never appears in the file and a fork's CHANGELOG points at the fork.
    const links = shas.map((sha) => `[\`${sha}\`](../../commit/${sha})`).join(' ');
    const handles = [...new Set(shas.map(resolve).filter(Boolean))];
    handles.forEach((h) => contributors.add(h));
    // Shortcut reference: one definition at the bottom serves every entry a
    // person appears in, instead of repeating their profile URL on each line.
    //
    // An entry written during ordinary work often already carries its
    // attribution, and appending regardless shipped every one of them as
    // "Thanks [@who]! Thanks [@who]! —". What the entry has, it keeps: the
    // attribution is only ever inserted where the metadata run has none.
    const thanks = handles.length && !(meta && /Thanks\s+\[/.test(meta[0]))
      ? ` Thanks ${handles.map((h) => `[@${h}]`).join(' ')}!`
      : '';

    const at = issue.index + issue[0].length;
    lines[index] = `${line.slice(0, at)} ${links}${thanks}${line.slice(at)}`;
    filled++;
  }

  return { text: defineContributors(lines, contributors).join(eol), filled, unmatched };
};

const CONTRIBUTORS_HEADING = '## Contributors';
const DEFINITION_RE = /^\[@([^\]]+)\]:\s*(\S.*)$/;

/**
 * Rebuild the Contributors section at the bottom of the file: a visible roll of
 * everyone credited above, followed by the one `[@who]: url` definition each
 * that makes every `Thanks [@who]!` in the file a link.
 *
 * Idempotent — rebuilding an unchanged file reproduces it byte for byte — and
 * an existing definition's URL is carried over rather than regenerated, so a
 * hand-edited one survives.
 * @param {string[]} lines the file, already rewritten
 * @param {Set<string>} handles every handle referenced
 * @returns {string[]}
 */
const defineContributors = (lines, handles) => {
  let out = lines.slice();

  // Only the TAIL of the file is rewritten. A `[@who]: url` line inside a
  // fenced example earlier in the file (a CHANGELOG documenting its own format)
  // is not part of this section and must survive untouched.
  let cut = out.length;
  // Search from the END, and only accept a heading whose entire remainder is
  // this section's own shape. Taking the FIRST match instead would cut at a
  // `## Contributors` line inside a fenced example — everything below it, every
  // released version section, discarded on write. Same permanent damage `fill`
  // is written to avoid, and workkit:migrate points this script at other
  // repos' histories.
  let headingAt = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].trim().toLowerCase() !== CONTRIBUTORS_HEADING.toLowerCase()) continue;
    const ours = out.slice(i + 1).every(
      (l) => l.trim() === '' || /^-\s+\[@[^\]]+\]\s*$/.test(l) || DEFINITION_RE.test(l),
    );
    if (ours) headingAt = i;
    break;
  }
  if (headingAt !== -1) {
    cut = headingAt;
  } else {
    // The shape before this section existed: bare definitions at the very end.
    while (cut > 0 && (out[cut - 1].trim() === '' || DEFINITION_RE.test(out[cut - 1]))) cut--;
  }

  // Markdown labels are case-insensitive, so `[@Who]:` already defines `who`.
  const people = new Map();
  for (const line of out.slice(cut)) {
    const match = DEFINITION_RE.exec(line);
    if (match) people.set(match[1].toLowerCase(), { handle: match[1], url: match[2].trim() });
  }
  for (const handle of handles) {
    if (!people.has(handle.toLowerCase())) {
      people.set(handle.toLowerCase(), { handle, url: `https://github.com/${handle}` });
    }
  }
  if (people.size === 0) return lines;

  const roll = [...people.values()].sort((a, b) => a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()));

  out = out.slice(0, cut);
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  // The rule above the heading belongs to this section — drop it too, or every
  // rebuild would stack another one. Only when the section was actually there:
  // a CHANGELOG whose last content line is its own `---` would otherwise lose
  // it, silently and permanently, on the first backfill.
  if (headingAt !== -1 && out[out.length - 1] === '---') {
    out.pop();
    while (out.length && out[out.length - 1].trim() === '') out.pop();
  }

  out.push('', '---', '', CONTRIBUTORS_HEADING, '');
  out.push(...roll.map((p) => `- [@${p.handle}]`));
  // The blank line matters: a definition placed directly under a bullet is
  // absorbed as that paragraph's lazy continuation, and every reference it
  // defines then renders as literal text.
  out.push('');
  out.push(...roll.map((p) => `[@${p.handle}]: ${p.url}`));
  out.push('');
  return out;
};

const main = (argv) => {
  let badFlag = null;
  const flag = (name, fallback) => {
    const at = argv.indexOf(name);
    if (at === -1) return fallback;
    const value = argv[at + 1];
    // A flag with nothing after it would otherwise reach path.resolve or git as
    // undefined and surface as a raw stack trace instead of the typo it is.
    if (value === undefined || value.startsWith('--')) badFlag = name;
    return value;
  };

  const cwd = process.cwd();
  let root;
  try {
    root = run('git', ['rev-parse', '--show-toplevel'], cwd);
  } catch {
    console.error('changelog-links: not a git repository.');
    return 1;
  }

  const fileArg = flag('--file', 'CHANGELOG.md');
  const rangeArg = flag('--range', null);
  if (badFlag) {
    console.error(`changelog-links: ${badFlag} needs a value.`);
    return 2;
  }

  const file = path.resolve(root, fileArg);
  if (!fs.existsSync(file)) {
    console.error(`changelog-links: no CHANGELOG at ${file}.`);
    return 1;
  }

  // Two distinct failures, two distinct messages: no origin remote at all
  // (add one) versus an origin that is not GitHub-shaped (nothing to link to).
  if (originUrl(root) === null) {
    console.error('changelog-links: this repo has no origin remote — nothing to link to.');
    return 1;
  }
  const slug = repoSlug(root);
  if (!slug) {
    console.error('changelog-links: origin is not a GitHub remote — nothing to link to.');
    return 1;
  }

  const range = rangeArg || defaultRange(root);
  let byIssue;
  try {
    byIssue = commitsByIssue(range, root);
  } catch {
    console.error(`changelog-links: git cannot read the range ${range}.`);
    return 1;
  }
  const cache = new Map();
  const text = fs.readFileSync(file, 'utf8');
  const result = fill(text, {
    byIssue,
    resolve: (sha) => authorHandle(slug, sha, root, cache),
  });

  // An unmatched entry is the "you forgot the Fixes #N trailer" signal — the
  // one thing that leaves an entry unlinkable, so it is never passed in silence.
  for (const issue of new Set(result.unmatched)) {
    console.log(`changelog-links: #${issue} has no closing commit in ${range} — add a "Fixes #${issue}" trailer, or link it by hand.`);
  }

  if (result.filled === 0) {
    console.log(`changelog-links: nothing to fill in (range ${range}).`);
    return 0;
  }

  if (argv.includes('--dry-run')) {
    console.log(`changelog-links: would fill ${result.filled} entries (range ${range}).`);
    return 0;
  }

  fs.writeFileSync(file, result.text);
  console.log(`changelog-links: filled ${result.filled} entries from ${range}.`);
  if ([...cache.values()].some((h) => h === null)) {
    console.log('changelog-links: some handles could not be resolved — commit links landed without attribution.');
  }
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards whatever console.log
  // has buffered when stdout is a PIPE, so a caller reading this output can see
  // it truncated. Same fix as changelog.js.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { repoSlug, commitsByIssue, fill, defaultRange, defineContributors };
