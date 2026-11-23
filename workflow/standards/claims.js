/**
 * workflow/standards/claims.js: the heals that read the open issues: stale
 * agent claims released, claimed specs flipped to building, and the check that
 * every open issue carries conforming labels. Each reads the label list the
 * sync kept (`run.labels`, labels.js).
 * Usage: const { sweepStaleClaims, flipClaimedSpecced, checkIssueLabels } = require('./claims');
 */

const { isFile } = require('../lib/lock');
const { readJsonOrNull } = require('../lib/read');
const { ok, warn } = require('../lib/voice');
const { flag } = require('./flag');
const {
  LABELS_JSON, ghRead, ghStep, ghReadiness,
} = require('./labels');

// An agent's claim and how long it may sit idle before the heal releases it.
// The label is the claim; an assignee is a person's mark and never read as one.
const CLAIM_LABEL = 'agent:claimed';
const CLAIM_STALE_SECONDS = 86400;
// The two pipeline states a release moves between: an unclaimed issue whose
// spec is still accepted is specced, not building.
const BUILDING_LABEL = 'status:building';
const SPECCED_LABEL = 'status:specced';

/** Whether a gh list of labels (or an issue's `labels`) names `name`. */
const hasLabel = (labels, name) => Array.isArray(labels) && labels.some((label) => label && label.name === name);

/** The issues of a gh answer, or none when it is no list. */
const issuesOf = (list) => (Array.isArray(list) ? list : []);

/**
 * Agent claims that went quiet are released. Only an answer from GitHub
 * licenses a write. The release takes CLAIM_LABEL off and leaves every
 * assignee; a building issue goes back to specced in the same edit.
 * @param {{root: string, labels?: object[]|null, needsAttention: boolean}} run
 */
const sweepStaleClaims = (run) => {
  if (ghReadiness(run) !== null) return;
  // Without the sync's answer the label may not exist here yet, and a query for
  // a label a repo does not have is not a failure worth reporting.
  if (!run.labels || !hasLabel(run.labels, CLAIM_LABEL)) return;
  // `gh issue edit` fails whole on a label the repo lacks, so a missing
  // SPECCED_LABEL releases without the flip.
  const canFlip = hasLabel(run.labels, SPECCED_LABEL);

  const read = ghRead(run, [
    'issue', 'list', '--state', 'open', '--label', CLAIM_LABEL, '--json', 'number,updatedAt,labels', '--limit', '1000',
  ]);
  if (!read.ok) {
    flag(run, `claims: could not list the issues carrying ${CLAIM_LABEL}; every claim is left in place`);
    return;
  }
  const cutoff = Date.now() - CLAIM_STALE_SECONDS * 1000;
  const stale = issuesOf(read.list).filter((issue) => Date.parse(issue.updatedAt) < cutoff);

  let moved = 0;
  let failed = false;
  for (const issue of stale) {
    const n = issue.number;
    const args = ['--remove-label', CLAIM_LABEL];
    // The status flip rides along in the same edit: two edits would leave a
    // window where the issue is unclaimed but still reads as in flight.
    const building = canFlip && hasLabel(issue.labels, BUILDING_LABEL);
    if (building) args.push('--remove-label', BUILDING_LABEL, '--add-label', SPECCED_LABEL);

    if (!ghStep(run, ['issue', 'edit', `${n}`, ...args]).ok) {
      warn(`claims: could not release the stale claim on #${n}; left as it was`);
      failed = true;
      continue;
    }
    // The comment follows the release: a comment about a release that then
    // failed would record something that did not happen.
    let body = `Released by the standards stale-claim sweep: this issue carried ${CLAIM_LABEL} with no activity for 24 hours, so the label was cleared. Any assignee stays: an assignee is a person, never the claim. It is free to claim again.`;
    if (building) {
      body = `${body} It also went back from ${BUILDING_LABEL} to ${SPECCED_LABEL}: the spec is still accepted, the work is simply unclaimed; whatever partial progress exists is in this issue's own trail.`;
    }
    if (!ghStep(run, ['issue', 'comment', `${n}`, '--body', body]).ok) {
      warn(`claims: released #${n} but could not comment on it`);
    }
    moved += 1;
  }

  if (failed) run.needsAttention = true;
  if (moved > 0) ok(`claims: released ${moved} stale ${CLAIM_LABEL} claim(s); idle for over 24 hours`);
};

/**
 * A claimed spec is work in flight: specced plus CLAIM_LABEL flips to
 * building; an assignee alone flips nothing. The release sweep runs first, so
 * the two never fight. A repo missing BUILDING_LABEL or CLAIM_LABEL is left alone.
 * @param {{root: string, labels?: object[]|null, needsAttention: boolean}} run
 */
const flipClaimedSpecced = (run) => {
  if (ghReadiness(run) !== null) return;
  if (!run.labels || !hasLabel(run.labels, BUILDING_LABEL) || !hasLabel(run.labels, CLAIM_LABEL)) return;

  const read = ghRead(run, [
    'issue', 'list', '--state', 'open', '--label', CLAIM_LABEL, '--json', 'number,labels', '--limit', '1000',
  ]);
  if (!read.ok) {
    flag(run, `claims: could not list the issues carrying ${CLAIM_LABEL}; nothing was flipped`);
    return;
  }
  const claimed = issuesOf(read.list)
    .filter((issue) => hasLabel(issue.labels, SPECCED_LABEL) && hasLabel(issue.labels, CLAIM_LABEL));

  let moved = 0;
  let failed = false;
  for (const { number: n } of claimed) {
    if (!ghStep(run, [
      'issue', 'edit', `${n}`, '--remove-label', SPECCED_LABEL, '--add-label', BUILDING_LABEL,
    ]).ok) {
      warn(`claims: could not flip #${n} to ${BUILDING_LABEL}; left as it was`);
      failed = true;
      continue;
    }
    // The comment follows the edit: the trail records what happened.
    const body = `Flipped to ${BUILDING_LABEL} by the standards sweep: this issue was ${SPECCED_LABEL} and carried ${CLAIM_LABEL}, which is a claim on an authorized spec, work in flight. If nobody is working on it, remove ${CLAIM_LABEL} and put ${SPECCED_LABEL} back.`;
    if (!ghStep(run, ['issue', 'comment', `${n}`, '--body', body]).ok) {
      warn(`claims: flipped #${n} but could not comment on it`);
    }
    moved += 1;
  }

  if (failed) run.needsAttention = true;
  if (moved > 0) ok(`claims: flipped ${moved} claimed ${SPECCED_LABEL} issue(s) to ${BUILDING_LABEL}`);
};

/**
 * The open issues whose labels break the manifest's `exclusive` and
 * `required` groups: two from one exclusive group, or none from a required one.
 * @param {object[]} issues gh's `number,labels` answer
 * @param {object} manifest labels.json
 * @returns {string} each as `#N`, space-separated
 */
const nonconforming = (issues, manifest) => {
  const rules = Object.entries(manifest.groups)
    .filter(([, group]) => group.exclusive === true)
    .map(([key, group]) => ({ key, required: group.required === true }));
  return issues
    .filter((issue) => rules.some((rule) => {
      const n = (issue.labels || []).filter((label) => `${label.name}`.startsWith(`${rule.key}:`)).length;
      return n > 1 || (rule.required && n === 0);
    }))
    .map((issue) => `#${issue.number}`)
    .join(' ');
};

/**
 * Open issues carry conforming labels. A violation flags the run every
 * session until it is routed, since a captured issue can arrive unlabeled and
 * sit outside every queue. No gh or auth skips silently.
 * @param {{root: string, needsAttention: boolean}} run
 */
const checkIssueLabels = (run) => {
  if (!isFile(LABELS_JSON)) return;
  if (ghReadiness(run) !== null) return;
  const read = ghRead(run, ['issue', 'list', '--json', 'number,labels', '--limit', '1000']);
  if (!read.ok || read.text === '') return;
  const manifest = readJsonOrNull(LABELS_JSON);
  if (!manifest || !manifest.groups || !Array.isArray(read.list)) return;
  const bad = nonconforming(read.list, manifest);
  if (bad === '') return;
  flag(run, `issues: ${bad} missing a required status:/type: label or carrying two from one exclusive group; run the workkit:triage skill to route them`);
};

module.exports = { sweepStaleClaims, flipClaimedSpecced, checkIssueLabels };
