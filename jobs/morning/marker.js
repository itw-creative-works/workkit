/**
 * jobs/morning/marker.js: the brief marker, `<user dir>/brief-status.json`,
 * the date of the newest brief on the home repo's board, read here because a
 * session start may reach no network. Never a lie: every way it can fail
 * leaves the marker as it was and names the skip (jobs/README.md § The
 * morning on this machine).
 * Usage: const { recordBriefStatus } = require('./marker');
 */

const fs = require('fs');
const path = require('path');
const { BRIEF_TITLE_PREFIX } = require('../../tower/api/lib/history');
const { ready } = require('../../workflow/lib/discussions');
const { nativePath } = require('../../workflow/lib/platform');
const { homeSlug } = require('../../workflow/lib/settings');
const { spin } = require('../../workflow/lib/spin');
const { writeWhole } = require('../../workflow/lib/write');
const { userDir } = require('../../workflow/user-dir');
const { bounded, secondsOf } = require('../lib/machine');

// The board is shared (the daily summaries publish beside the briefs), and the
// gap this exists to notice is measured in days.
const WINDOW = 50;

// The read's bound when WORKKIT_GH_TIMEOUT names none, in seconds.
const GH_TIMEOUT_S = 10;

const QUERY = `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        discussions(first:${WINDOW}, orderBy:{field:CREATED_AT, direction:DESC}){
          nodes { title }
        }
      }
    }`;

/** The read's bound in ms: a captive portal answers the handshake and never the request. */
const readBound = () => secondsOf(process.env.WORKKIT_GH_TIMEOUT, GH_TIMEOUT_S) * 1000;

/**
 * The newest posts' titles on `slug`, or null when the read did not answer.
 * @param {string} slug
 * @returns {Promise<string[]|null>}
 */
const titlesOn = async (slug) => {
  const [owner] = slug.split('/');
  const name = slug.split('/').pop();
  const args = ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${QUERY}`];
  // stdout alone: a notice gh prints on stderr is no part of the answer.
  const { status, stdout } = await spin('reading the newest brief', () => bounded('gh', args, { bound: readBound() }), { line: false });
  if (status !== 0 || !stdout) return null;
  try {
    const nodes = JSON.parse(stdout)?.data?.repository?.discussions?.nodes;
    return Array.isArray(nodes) ? nodes.map((node) => node?.title).filter((title) => typeof title === 'string') : [];
  } catch {
    return [];
  }
};

/** The date the newest brief's title carries, or null when none of `titles` is a brief's. */
const lastBriefOf = (titles) => {
  const title = titles.find((each) => each.startsWith(BRIEF_TITLE_PREFIX));
  const date = title === undefined ? '' : title.slice(BRIEF_TITLE_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

/**
 * The marker written whole, so the hook never reads half of one; a write that
 * fails leaves the old one with its line.
 * @param {object} run the morning's run
 * @param {string} slug
 * @param {string} last the newest brief's date
 */
const writeMarker = (run, slug, last) => {
  const dir = userDir();
  const marker = path.join(dir, 'brief-status.json');
  const checkedAt = run.now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // A folder that cannot be made fails the write below, and that names it.
  }
  try {
    writeWhole(marker, `${JSON.stringify({ version: 1, lastBrief: last, checkedAt }, null, 2)}\n`);
  } catch (err) {
    run.notes.noteWarn(err.syscall === 'rename'
      ? `marker: ${nativePath(marker)} could not be written; the board says the newest brief is ${last}`
      : `marker: the marker could not be written in ${nativePath(dir)}; ${nativePath(marker)} was left as it was (the board says the newest brief is ${last})`);
    return;
  }
  run.notes.note(`marker: the newest brief on ${slug} is ${last}; recorded in ${nativePath(marker)}`);
};

/**
 * The marker step.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const recordBriefStatus = async (run) => {
  const { noteSkip, noteWarn } = run.notes;
  if (run.cloud) {
    noteSkip('marker: the brief marker is read at session start on a machine; a runner has no home that outlives the job, skipped');
    return;
  }
  if (!ready()) {
    noteSkip('marker: gh is what reads the board; the brief marker was left as it was');
    return;
  }
  const slug = homeSlug(userDir());
  if (!slug) {
    noteSkip('marker: no home repo configured; there is no board to read the newest brief from');
    return;
  }
  const titles = await titlesOn(slug);
  if (titles === null) {
    noteWarn(`marker: the board on ${slug} could not be read; the brief marker was left as it was`);
    return;
  }
  const last = lastBriefOf(titles);
  if (last === null) {
    noteSkip(`marker: nothing titled ${BRIEF_TITLE_PREFIX}<date> in the newest ${WINDOW} posts on ${slug}; the brief marker was left as it was`);
    return;
  }
  writeMarker(run, slug, last);
};

module.exports = { recordBriefStatus };
