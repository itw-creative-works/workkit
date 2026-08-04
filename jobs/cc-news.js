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
// THE CURSOR LIVES ON THE BOARD (issue #86). Where the last brief counted to is
// read back off the home repo's Discussions: every published brief carries one
// machine-readable line, `<!-- cc-news: <version> -->`, and the newest one is
// the "since" this run diffs against. Nothing on this machine records it — the
// job state that used to sit in `~/.workkit/.cache.json` was a local-only
// limitation, and the publish IS the commit, so there is no callback to call.
//
// FIRST RUN SEEDS, IT DOES NOT REPORT. With no brief on the board there is no
// "since", and the honest answer for a machine that has never looked is the
// entire history — hundreds of entries, which would bury the brief it was meant
// to inform. So a first run reports nothing and lets the publish carry the
// latest version, and every morning after is a true diff.
//
// A BOARD THAT COULD NOT BE READ IS NOT AN EMPTY BOARD. A `gh` that refuses or
// answers something else is a FAILED read, and a failed read reports nothing AND
// publishes no version line: the last brief that carried one stays the newest
// cursor, so the next good morning still diffs against it. Only a board that
// genuinely carries no brief seeds.
//
// Every failure here is SILENT: no network, a non-200, an unparseable file, a
// `gh` that refuses, and the brief prints without a CC NEWS block. The morning
// brief must never fail because GitHub was unreachable. When the upstream read
// failed but the board had a version, that version rides forward unchanged —
// the cursor never goes backward for want of a network.
//
// Usage:
//   const { collectCcNews, renderVersionMark } = require('./cc-news');
//   const news = collectCcNews();          // { version, since, matches }
//   renderVersionMark(news.version);       // the line the published brief carries
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { BRIEF_TITLE_PREFIX } = require('../tower/api/lib/history');

const WORKKIT_DIR = '.workkit';
// The hand-edited file that names the home repo — the board the cursor lives on.
const SETTINGS_FILE = 'settings.json';

// The published briefs, by the title `brief-publish.sh` gives them — read from
// the module that owns that prefix now that a second reader shares it
// (tower/api/lib/history.js, issue #55) — and the line each one carries. THIS
// MODULE OWNS THE LINE'S SHAPE: the runner never writes it by hand, it appends
// the file `renderVersionMark` was rendered into, so the writer and the reader
// cannot drift.
const MARK_RE = /<!--\s*cc-news:\s*(\d+(?:\.\d+)*)\s*-->/;
const renderVersionMark = (version) => `<!-- cc-news: ${version} -->`;

// The briefs on the home repo, newest first. No category argument: a brief
// publishes in whatever category the repo's fallback resolved to, and the title
// is what says it is a brief.
//
// 100 is the GraphQL page maximum, and the window has to be wide because the
// board is SHARED: the summaries post beside the briefs, and a run of mornings
// whose send failed carries no version line at all. A narrow window lets the
// last line-carrying brief scroll out of view, which reads as an empty board and
// re-seeds the cursor — every entry in between silently never reported.
const BRIEF_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:100, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title body }
    }
  }
}`;

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

/** The home repo's slug, or null when this machine has no home repo. */
const homeSlug = (workflowHome) => {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(workflowHome, SETTINGS_FILE), 'utf8'));
    const repo = settings && settings.site && settings.site.repo;
    return typeof repo === 'string' && repo.includes('/') ? repo : null;
  } catch {
    return null;
  }
};

/**
 * The board, read TRI-STATE. A version is a cursor; `ok` with no version is a
 * board that genuinely carries no brief (a first run, and a machine with no home
 * repo, which has no board and never will); `ok: false` is a read that FAILED —
 * a `gh` that refused, an answer that is not the shape asked for — where the
 * board's real contents are unknown and must not be mistaken for empty.
 * @returns {{ok: boolean, version: string|null}}
 */
const readBoardVersion = (workflowHome, exec) => {
  const slug = homeSlug(workflowHome);
  if (!slug) return { ok: true, version: null };
  const [owner, name] = slug.split('/');

  let out;
  try {
    out = exec('gh', ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${BRIEF_QUERY}`]);
  } catch {
    return { ok: false, version: null };
  }

  let nodes;
  try {
    nodes = JSON.parse(out).data.repository.discussions.nodes;
  } catch {
    return { ok: false, version: null };
  }
  if (!Array.isArray(nodes)) return { ok: false, version: null };

  for (const node of nodes) {
    if (!node || typeof node.title !== 'string') continue;
    if (!node.title.startsWith(BRIEF_TITLE_PREFIX)) continue;
    const found = MARK_RE.exec(typeof node.body === 'string' ? node.body : '');
    // A brief published before the line existed is passed over, not treated
    // as a cursor of its own — the next one down may still carry a version.
    if (found) return { ok: true, version: found[1] };
  }
  return { ok: true, version: null };
};

/**
 * Every upstream entry since the last brief, each carrying its topic.
 *
 * Always answers — there is no failure return. `version` is what the brief
 * about to be published should record (null when nothing has ever been read),
 * `since` is where this run counted from, and `matches` is empty whenever there
 * is nothing to say. A board that could not be read answers null to all three:
 * no report, and no line, so the last published cursor stands.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {string} [opts.source] the CHANGELOG URL (or any curl-readable path)
 * @param {Function} [opts.exec] (cmd, args) => stdout — the curl and gh seam
 * @returns {{version: string|null, since: string|null, matches: Array<{version: string, topic: string, entry: string}>}}
 */
const collectCcNews = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome
    || process.env.WORKFLOW_HOME
    || path.join(home, WORKKIT_DIR);
  const exec = opts.exec || defaultExec;

  const board = readBoardVersion(workflowHome, exec);
  // The board could not be read. Reporting nothing is the easy half; the half
  // that matters is publishing NO version line, so the newest cursor stays the
  // one the last good brief carried instead of being re-seeded to latest.
  if (!board.ok) return { version: null, since: null, matches: [] };
  const since = board.version;

  const text = fetchChangelog(opts.source || SOURCE, exec);
  const sections = text ? parseSections(text) : [];
  // The upstream read failed, or served something that is not a changelog. The
  // board's version rides forward so the brief about to publish does not rewind
  // the cursor for everyone who reads it next.
  if (sections.length === 0) return { version: since, since, matches: [] };

  const latest = sections
    .map((s) => s.version)
    .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));

  const matches = [];
  if (since) {
    for (const section of sections) {
      if (compareVersions(section.version, since) <= 0) continue;
      for (const entry of section.entries) {
        matches.push({ version: section.version, topic: topicOf(entry), entry });
      }
    }
  }

  // Never move the cursor backwards: a source that briefly served an older file
  // would otherwise re-report everything between.
  const version = since && compareVersions(since, latest) > 0 ? since : latest;

  return { version, since, matches };
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

module.exports = {
  collectCcNews,
  renderCcNews,
  renderVersionMark,
  parseSections,
  topicOf,
  compareVersions,
  BRIEF_TITLE_PREFIX,
  SOURCE,
};
