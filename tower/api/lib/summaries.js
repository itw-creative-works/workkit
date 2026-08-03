//
// The published summaries, read back — what the brief says about yesterday.
//
// The 9am job's first step COMPOSES the day and publishes it as a Discussion on
// the home repo (`jobs/claude-nightly.sh`). This module is the read side of that
// same board: the brief names the newest one and links it, so the morning opens
// with what the night before actually produced rather than with counts alone.
//
// One helper, two readers — `jobs/brief-payload.js` (the 9am job and the cloud
// runner) and the tower's `/api/brief`. Both attach the SAME two keys onto the
// payload `buildBrief` returned, so the notification and the Brief page cannot
// tell different stories.
//
// THE TITLE IS WHAT SAYS WHAT A POST IS, not the category. A summary is titled
// `<cadence>: <date>` by the job that writes it, while the category it lands in
// is negotiable — categories cannot be created over the API, so a repo without
// a `Daily` falls back to `General` (workflow/discussions.sh). Reading by title
// is the one question that answers the same on every home repo, and it is the
// same reasoning `jobs/cc-news.js` reads the briefs by.
//
// EVERY FAILURE IS null. No home repo, no `gh`, a token that refuses, an answer
// that is not the shape asked for, a board that carries no summary yet — all of
// them are "nothing to say", and the caller turns that into a named skip. A
// brief must never fail because Discussions were unreachable.
//
// Usage:
//   const { briefSummaries, newestSummary } = require('./summaries');
//   Object.assign(payload, briefSummaries({ generatedAt, workflowHome, exec }));
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKKIT_DIR = '.workkit';
// The hand-edited file that names the home repo — the board the summaries live on.
const SETTINGS_FILE = 'settings.json';

// The title prefix each cadence publishes under, from the job that writes them
// (`jobs/claude-nightly.sh`: `<cadence>: <date>`).
const CADENCE_PREFIX = {
  daily: 'daily: ',
  weekly: 'weekly: ',
};

// 100 is the GraphQL page maximum, and the window is wide for the same reason
// cc-news.js's is: the board is SHARED — the briefs publish beside the summaries
// — and a weekly rollup is one post in a week of them. A narrow window would
// scroll the answer out of view and read as a board with nothing on it.
const WINDOW = 100;

const SUMMARY_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:${WINDOW}, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title url createdAt }
    }
  }
}`;

const defaultExec = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
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

/** Where ~/.workkit is for this call — the same resolution cc-news.js makes. */
const workflowHomeOf = (opts) => opts.workflowHome
  || process.env.WORKFLOW_HOME
  || path.join(opts.home || os.homedir(), WORKKIT_DIR);

/**
 * The home repo these summaries would be read from, or null when this machine
 * has none. Exported for the callers that report a SKIP: a board that could not
 * be read and a machine that has no board at all are different silences, and
 * only the first is worth a line.
 *
 * @param {object} [opts] the same options the readers take
 * @returns {string|null}
 */
const homeSlugFor = (opts = {}) => homeSlug(workflowHomeOf(opts));

/**
 * The newest published summary of one cadence, or null.
 *
 * @param {'daily'|'weekly'} cadence
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout — the gh seam
 * @returns {{title: string, url: string, createdAt: string|null}|null}
 */
const newestSummary = (cadence, opts = {}) => {
  const prefix = CADENCE_PREFIX[cadence];
  if (!prefix) return null;

  const slug = homeSlugFor(opts);
  if (!slug) return null;
  const [owner, name] = slug.split('/');
  const exec = opts.exec || defaultExec;

  let nodes;
  try {
    const out = exec('gh', ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${SUMMARY_QUERY}`]);
    nodes = JSON.parse(out).data.repository.discussions.nodes;
  } catch {
    // Offline, a `gh` that refuses, an answer that is not this shape — the same
    // answer as a board with nothing on it, because neither is worth a broken
    // brief.
    return null;
  }
  if (!Array.isArray(nodes)) return null;

  // Newest first is what the query asked for, so the first match is the answer.
  const found = nodes.find((node) => node && typeof node.title === 'string' && node.title.startsWith(prefix));
  if (!found) return null;
  return {
    title: found.title,
    url: found.url || '',
    createdAt: found.createdAt || null,
  };
};

/** Is this stamp a Monday, in the local morning it belongs to? */
const isMonday = (generatedAt) => {
  const when = new Date(generatedAt);
  return !Number.isNaN(when.getTime()) && when.getDay() === 1;
};

/**
 * The summary keys a brief carries — the ONE shape both call sites attach.
 *
 * `findings` is the newest daily summary and rides every morning. `week` is the
 * weekly rollup and rides MONDAYS ONLY: there is one brief a day, richer on a
 * Monday, rather than a second delivery nobody asked for. Any other day the key
 * is absent entirely — an absent key draws nothing, where a null would have to
 * be explained.
 *
 * @param {object} [opts]
 * @param {string} [opts.generatedAt] the stamp the payload is built under
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout — the gh seam
 * @returns {{findings: object|null, week?: object|null}}
 */
const briefSummaries = (opts = {}) => {
  const out = { findings: newestSummary('daily', opts) };
  if (isMonday(opts.generatedAt || new Date().toISOString())) out.week = newestSummary('weekly', opts);
  return out;
};

module.exports = { briefSummaries, newestSummary, homeSlugFor, isMonday };
