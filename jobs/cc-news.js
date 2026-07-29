//
// Upstream Claude Code news — everything that shipped since the last brief,
// organized by topic.
//
// Claude Code releases most days, and its CHANGELOG is the only announcement.
// The job does NOT judge which entries matter — that is the digest model's
// call, made with the board in view: a new feature the kit could use, a change
// that breaks something the kit built, an improvement worth adopting. What the
// job owns is the mechanical half: read the upstream file, keep every entry
// newer than the last brief, and hand them over grouped by topic so the digest
// reads a table of contents instead of a wall.
//
// The source is the raw `CHANGELOG.md` on the default branch, not the releases
// API: it is the same text without a token, a rate limit, or a schema.
//
// The seen mark is one key, `ccNews`, in the machine's disposable cache file
// (`~/.workkit/.cache.json`, issue #80) — a cursor is exactly what that file is
// for, and deleting it costs one repeated brief. It advances only when the
// caller says the payload printed — a morning that died before the notification
// REPEATS rather than losing the news.
//
// FIRST RUN SEEDS, IT DOES NOT REPORT. With no mark there is no "since", and
// the honest answer for a machine that has never looked is the entire history —
// hundreds of entries, which would bury the brief it was meant to inform. So a
// first run records the latest version, reports nothing, and every morning
// after is a true diff.
//
// Every failure here is SILENT: no network, a non-200, an unparseable file, and
// the brief prints without a CC NEWS block and without moving the mark. The
// morning brief must never fail because GitHub was unreachable.
//
// Usage:
//   const { collectCcNews } = require('./cc-news');
//   const news = collectCcNews();          // null, or { version, matches, commit }
//   if (news) news.commit();               // after the payload printed
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKKIT_DIR = '.workkit';
// The machine's disposable file, and this module's one key in it. Never inside
// a checkout, and never in the hand-edited settings.json beside it.
const CACHE_FILE = '.cache.json';
const CACHE_KEY = 'ccNews';

// `WORKKIT_CC_CHANGELOG` overrides the source — a seam for the suite, which
// points it at a `file://` fixture so running the tests never reaches the
// network (curl reads both schemes, so the fetch has no test-only branch).
const SOURCE = process.env.WORKKIT_CC_CHANGELOG
  || 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';

// The topics, in the order the block prints them — the kit's own surfaces
// first, the rest under `other`. A table of contents, not a gate: an entry
// matching nothing still rides, it just files last. First match wins.
const TOPICS = [
  { name: 'hooks', re: /\bhooks?\b/i },
  { name: 'agents', re: /\b(?:sub)?agents?\b/i },
  { name: 'skills', re: /\bskills?\b/i },
  { name: 'plugins', re: /\bplugins?\b/i },
  { name: 'settings', re: /\b[Ss]ettings?\b|\b[Ee]nv(?:ironment)? [Vv]ar\w*\b|\bCLAUDE_[A-Z0-9_]+\b/ },
  { name: 'MCP', re: /\bMCP\b/i },
  { name: 'statusline', re: /\bstatus ?line\b/i },
];

const defaultExec = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

/** The upstream text, or null when it could not be read. */
const fetchChangelog = (source, exec) => {
  try {
    const text = exec('curl', ['-sSfL', '--max-time', '20', source]);
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    // Offline, DNS down, a 404 on a renamed branch — all the same answer.
    return null;
  }
};

/**
 * Compare two dotted numeric versions.
 * @returns {number} negative when a < b, positive when a > b, 0 when equal
 */
const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * The `## <version>` sections of a CHANGELOG, each with its `- ` entries.
 * Headings that are not a dotted number (a title, an `[Unreleased]`) are not
 * releases and are skipped along with whatever sits under them.
 * @param {string} text
 * @returns {Array<{version: string, entries: string[]}>}
 */
const parseSections = (text) => {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+v?(\d+(?:\.\d+)*)\s*$/);
    if (heading) {
      current = { version: heading[1], entries: [] };
      sections.push(current);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      current = null;
      continue;
    }
    const entry = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (entry && current) current.entries.push(entry[1]);
  }
  return sections.filter((s) => s.entries.length > 0);
};

/** The topic an entry files under — the first TOPICS match, or 'other'. */
const topicOf = (entry) => (TOPICS.find(({ re }) => re.test(entry)) || { name: 'other' }).name;

/** The whole cache file, or an empty object when it is absent or unreadable. */
const readCache = (file) => {
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cache && typeof cache === 'object' ? cache : {};
  } catch {
    return {};
  }
};

/** The recorded last-seen version, or null when this machine has never looked. */
const readMark = (file) => {
  const mark = readCache(file)[CACHE_KEY];
  return mark && typeof mark.version === 'string' ? mark.version : null;
};

/**
 * Every upstream entry since the last brief, each carrying its topic.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {string} [opts.source] the CHANGELOG URL (or any curl-readable path)
 * @param {Function} [opts.exec] (cmd, args) => stdout — the curl seam
 * @returns {{version: string, since: string|null, matches: Array<{version: string, topic: string, entry: string}>, commit: Function}|null}
 */
const collectCcNews = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome || path.join(home, WORKKIT_DIR);
  const cacheFile = path.join(workflowHome, CACHE_FILE);
  const exec = opts.exec || defaultExec;

  const text = fetchChangelog(opts.source || SOURCE, exec);
  if (!text) return null;

  const sections = parseSections(text);
  if (sections.length === 0) return null;

  const latest = sections
    .map((s) => s.version)
    .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));

  const since = readMark(cacheFile);
  const matches = [];
  if (since) {
    for (const section of sections) {
      if (compareVersions(section.version, since) <= 0) continue;
      for (const entry of section.entries) {
        matches.push({ version: section.version, topic: topicOf(entry), entry });
      }
    }
  }

  // Never move the mark backwards: a source that briefly served an older file
  // would otherwise re-report everything between.
  const version = since && compareVersions(since, latest) > 0 ? since : latest;

  return {
    version,
    since,
    matches,
    /** Record what this run reported. The caller calls it once the brief printed. */
    commit: () => {
      // An unwritable mark must not veto the brief the payload already printed —
      // the run simply repeats tomorrow, which is the failure semantics anyway.
      //
      // Read-modify-WRITE, never a plain write: the Discussions id cache shares
      // this file, and a morning that ran both would otherwise drop whichever
      // key it did not own.
      try {
        const cache = readCache(cacheFile);
        cache[CACHE_KEY] = { version, updatedAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
      } catch {
        // silent by design — see the header
      }
    },
  };
};

/**
 * The CC NEWS block appended after the payload, or '' when there is nothing to
 * say — a seeding run and a quiet upstream both print no block at all.
 * Entries group under their topic in TOPICS order, `other` last, each line
 * carrying the version it shipped in.
 * @param {object|null} news what collectCcNews returned
 * @returns {string}
 */
const renderCcNews = (news) => {
  if (!news || news.matches.length === 0) return '';
  const order = TOPICS.map(({ name }) => name).concat('other');
  const groups = order
    .map((topic) => ({ topic, lines: news.matches.filter((m) => m.topic === topic) }))
    .filter(({ lines }) => lines.length > 0)
    .map(({ topic, lines }) => `[${topic}]\n${lines.map((m) => `${m.version} — ${m.entry}`).join('\n')}`);
  return `\n--- CC NEWS ---\nEverything Claude Code shipped since ${news.since}, by topic:\n${groups.join('\n')}\n`;
};

module.exports = { collectCcNews, renderCcNews, parseSections, topicOf, compareVersions, SOURCE };
