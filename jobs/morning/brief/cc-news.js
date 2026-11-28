// jobs/morning/brief/cc-news.js: every upstream Claude Code CHANGELOG entry
// since the last brief, grouped by topic. The job never judges which matter; the
// digest model does. The cursor lives on the board, read off the newest brief,
// and every failure is silent (jobs/README.md § The upstream news).
//
// Usage: const { collectCcNews, renderVersionMark } = require('./cc-news');
//   await collectCcNews()        // { version, since, matches }
//   renderVersionMark(version)   // the line the published brief carries

const fs = require('fs');
const { fileURLToPath } = require('url');
const { execFileSync } = require('../../../workflow/lib/run');

const { BRIEF_TITLE_PREFIX } = require('../../../tower/api/lib/history');
const { compareVersions } = require('../../../workflow/ship/semver');
const { userDir } = require('../../../workflow/user-dir');
const { homeSlug } = require('../../../workflow/lib/settings');

// The briefs' title prefix comes from the module that owns it; this module owns
// the mark line's shape. The runner appends the file `renderVersionMark` was
// rendered into, never a hand-written line, so the writer and reader cannot drift.
const MARK_RE = /<!--\s*cc-news:\s*(\d+(?:\.\d+)*)\s*-->/;
const renderVersionMark = (version) => `<!-- cc-news: ${version} -->`;

// The briefs on the home repo, newest first; the title, not a category, says a
// brief. 100 is the GraphQL page maximum, and the window needs it: summaries and
// briefs with no version line share the board, and losing the last line-carrying
// brief re-seeds the cursor, every entry in between silently never reported.
const BRIEF_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:100, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title body }
    }
  }
}`;

// `WORKKIT_CC_CHANGELOG` overrides the source: a seam for the suite, which
// points it at a local server or a `file:` fixture so running the tests never
// reaches the network.
const SOURCE = process.env.WORKKIT_CC_CHANGELOG
  || 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';

// How long the upstream read may take, its answer included.
const FETCH_BOUND_MS = 20000;

// The topics, in the order the block prints them: the kit's own surfaces
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
  windowsHide: true,
});

/**
 * The upstream text, or null when it could not be read within the bound.
 * A `file:` address is read from disk, any other fetched within the bound.
 * @param {string} source the CHANGELOG's URL
 * @param {number} [boundMs] the bound, FETCH_BOUND_MS by default
 * @returns {Promise<string|null>}
 */
const fetchChangelog = async (source, boundMs = FETCH_BOUND_MS) => {
  if (source.startsWith('file:')) {
    try {
      const text = fs.readFileSync(fileURLToPath(source), 'utf8');
      return text.trim() ? text : null;
    } catch {
      // A missing or unreadable file: the same answer as an unreachable address.
      return null;
    }
  }
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(boundMs) });
    // Read whole either way, so a refused answer holds no connection open.
    const text = await res.text();
    return res.ok && text.trim() ? text : null;
  } catch {
    // Offline, DNS down, a stall past the bound: all the same answer.
    return null;
  }
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

/** The topic an entry files under: the first TOPICS match, or 'other'. */
const topicOf = (entry) => (TOPICS.find(({ re }) => re.test(entry)) || { name: 'other' }).name;

/**
 * The board, read tri-state. A version is a cursor; `ok` with no version is a
 * board that genuinely carries no brief (a first run, and a machine with no home
 * repo, which has no board and never will); `ok: false` is a read that failed
 * (a `gh` that refused, an answer that is not the shape asked for) where the
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
    // as a cursor of its own: the next one down may still carry a version.
    if (found) return { ok: true, version: found[1] };
  }
  return { ok: true, version: null };
};

/**
 * Every upstream entry since the last brief, each carrying its topic. Always
 * answers: `version` is what the next brief records, `since` where this run
 * counted from; a board that could not be read answers null to all three.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {string} [opts.source] the CHANGELOG URL, or a `file:` one
 * @param {Function} [opts.exec] (cmd, args) => stdout: the gh seam
 * @returns {Promise<{version: string|null, since: string|null, matches: Array<{version: string, topic: string, entry: string}>}>}
 */
const collectCcNews = async (opts = {}) => {
  const workflowHome = opts.workflowHome || userDir(opts.home);
  const exec = opts.exec || defaultExec;

  const board = readBoardVersion(workflowHome, exec);
  // The board could not be read. Reporting nothing is the easy half; the half
  // that matters is publishing no version line, so the newest cursor stays the
  // one the last good brief carried instead of being re-seeded to latest.
  if (!board.ok) return { version: null, since: null, matches: [] };
  const since = board.version;

  const text = await fetchChangelog(opts.source || SOURCE);
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
 * say: a seeding run and a quiet upstream both print no block at all.
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
    .map(({ topic, lines }) => `[${topic}]\n${lines.map((m) => `${m.version}: ${m.entry}`).join('\n')}`);
  return `\n--- CC NEWS ---\nEverything Claude Code shipped since ${news.since}, by topic:\n${groups.join('\n')}\n`;
};

module.exports = {
  collectCcNews,
  fetchChangelog,
  renderCcNews,
  renderVersionMark,
  parseSections,
  topicOf,
  BRIEF_TITLE_PREFIX,
  SOURCE,
};
