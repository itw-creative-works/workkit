// The published summaries, read back: the newest daily (and on Mondays the
// weekly) on the home repo, attached onto the brief (jobs/README.md § The
// payload). A post is known by its title, never its category, which falls back
// to `General` on a home repo without `Daily` (workflow/lib/discussions.sh).
//
// Usage:
//   Object.assign(payload, briefSummaries({ generatedAt, workflowHome, exec }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The sweep's round trip, and with it the reading of a refusal: one `gh api
// graphql` and one answer to "why did that come back empty" for the whole tower.
const { ask } = require('./board');

const WORKKIT_DIR = '.workkit';
// The hand-edited file that names the home repo: the board the summaries live on.
const SETTINGS_FILE = 'settings.json';

// The title prefix each cadence publishes under, from the job that writes them
// (`jobs/claude-nightly.sh`: `<cadence>: <date>`).
const CADENCE_PREFIX = {
  daily: 'daily: ',
  weekly: 'weekly: ',
};

// 100 is the GraphQL page maximum, and the window is wide because the board is
// shared: the briefs publish beside the summaries, and a narrow window would
// scroll a weekly rollup out of view.
const WINDOW = 100;

const SUMMARY_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:${WINDOW}, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title url createdAt }
    }
  }
}`;

// stderr is piped, not ignored: `gh` writes its "gh auth login" guidance there,
// and the reading that names an auth failure as one needs that text (board.js).
const defaultExec = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

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

/** Where ~/.workkit is for this call: the same resolution cc-news.js makes. */
const workflowHomeOf = (opts) => opts.workflowHome
  || process.env.WORKFLOW_HOME
  || path.join(opts.home || os.homedir(), WORKKIT_DIR);

/**
 * The home repo these summaries would be read from, or null when this machine
 * has none: no board at all is a different silence from a board not read.
 * @param {object} [opts] the same options the readers take
 * @returns {string|null}
 */
const homeSlugFor = (opts = {}) => homeSlug(workflowHomeOf(opts));

/**
 * The summary board, and why it could not be read.
 *
 * @param {object} [opts] the readers' own options
 * @returns {{nodes: Array<object>|null, reason: string|null}}
 */
const readSummaries = (opts = {}) => {
  const slug = homeSlugFor(opts);
  // No home repo is a fact about the machine, not a failure to report.
  if (!slug) return { nodes: null, reason: null };
  const [owner, name] = slug.split('/');

  const { payload, reason } = ask(opts.exec || defaultExec, SUMMARY_QUERY, { owner, name });
  if (!payload) return { nodes: null, reason };

  const nodes = (((payload.data || {}).repository || {}).discussions || {}).nodes;
  // An answer that came back with data of another shape is not a refusal: there
  // is nothing to name, and "the board could not be read" is the whole of what
  // the caller can say about it.
  return { nodes: Array.isArray(nodes) ? nodes : null, reason: null };
};

/**
 * The newest summary of one cadence on a board already read, so a Monday's two
 * cadences come off one read.
 * @param {Array<object>|null} nodes the board `readSummaries` brought back
 * @param {'daily'|'weekly'} cadence
 * @returns {{title: string, url: string, createdAt: string|null}|null}
 */
const pickSummary = (nodes, cadence) => {
  const prefix = CADENCE_PREFIX[cadence];
  if (!prefix || !nodes) return null;

  // Newest first is what the query asked for, so the first match is the answer.
  const found = nodes.find((node) => node && typeof node.title === 'string' && node.title.startsWith(prefix));
  if (!found) return null;
  return {
    title: found.title,
    url: found.url || '',
    createdAt: found.createdAt || null,
  };
};

/**
 * The newest published summary of one cadence, and why the board could not be
 * read where there is none. Both keys, always: only an unreachable board has a reason.
 * @param {'daily'|'weekly'} cadence
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout: the gh seam
 * @returns {{summary: {title: string, url: string, createdAt: string|null}|null, reason: string|null}}
 */
const newestSummary = (cadence, opts = {}) => {
  // A cadence nobody publishes is no summary to go looking for, and looking
  // costs the round trip the answer never needed.
  if (!CADENCE_PREFIX[cadence]) return { summary: null, reason: null };

  const { nodes, reason } = readSummaries(opts);
  if (!nodes) return { summary: null, reason };
  return { summary: pickSummary(nodes, cadence), reason: null };
};

/** Is this stamp a Monday, in the local morning it belongs to? */
const isMonday = (generatedAt) => {
  const when = new Date(generatedAt);
  return !Number.isNaN(when.getTime()) && when.getDay() === 1;
};

/**
 * The summary keys a brief carries, the one shape both call sites attach:
 * `findings` every morning, `week` on Mondays only (absent otherwise: an absent
 * key draws nothing), and `summariesReason`, null on a board that answered.
 * @param {object} [opts]
 * @param {string} [opts.generatedAt] the stamp the payload is built under
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout: the gh seam
 * @returns {{findings: object|null, summariesReason: string|null, week?: object|null}}
 */
const briefSummaries = (opts = {}) => {
  // One read, both cadences, and one reason: a Monday's rollup is on the board
  // the daily came back on.
  const { nodes, reason } = readSummaries(opts);
  const out = { findings: pickSummary(nodes, 'daily'), summariesReason: reason };
  if (isMonday(opts.generatedAt || new Date().toISOString())) {
    out.week = pickSummary(nodes, 'weekly');
  }
  return out;
};

module.exports = { briefSummaries, newestSummary, homeSlugFor, isMonday };
