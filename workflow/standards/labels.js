/**
 * workflow/standards/labels.js: the heals that talk to GitHub about the repo
 * itself: branch protection (best effort), the label sync from labels.json, and
 * the public pairing: its key, the status labels on the public repo, the mirror
 * sweep. The sync's answer is kept as `run.labels`, the public repo as
 * `run.publicRepo`, since the claim sweeps (claims.js) and the mirror read them.
 * Usage: const { ensureBranchProtection, syncLabels } = require('./labels');
 */

const path = require('path');
const { gitIn, defaultBranch } = require('../lib/git');
const { isFile } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { readJsonOrNull } = require('../lib/read');
const { isKitCheckout } = require('../lib/repo');
const { spawnSync, onPath } = require('../lib/run');
const { writeErr } = require('../lib/say');
const { settingsAt } = require('../lib/settings');
const { spin } = require('../lib/spin');
const { ok, skip, warn, warnLines } = require('../lib/voice');
const { SLUG_RE, runGh } = require('../public/lib');
const { CALLER } = require('../ship/caller');
const { TEMPLATE, checksRewrite } = require('../changelog/job');
const { flag } = require('./flag');

const LABELS_JSON = path.join(__dirname, '..', 'labels.json');
const MIRROR = path.join(__dirname, '..', 'public', 'mirror.js');

/** `text` less its trailing newlines, as a shell's `$(...)` takes it. */
const chomp = (text) => text.replace(/\n+$/, '');

/**
 * gh run in the repo, `input` its stdin when given. Its output is captured,
 * so it prints no wait line.
 * @param {{root: string}} run
 * @param {string[]} args
 * @param {string} [input]
 * @returns {{ok: boolean, stdout: string, stderr: string}}
 */
const ghStep = (run, args, input) => runGh(args, { cwd: run.root, input });

/**
 * A gh read: `text` its stdout less trailing newlines, `list` the JSON in it,
 * or null when it holds none.
 * @param {{root: string}} run
 * @param {string[]} args
 * @returns {{ok: boolean, text: string, list: any}}
 */
const ghRead = (run, args) => {
  const res = ghStep(run, args);
  const text = chomp(res.stdout);
  let list = null;
  try {
    list = JSON.parse(text);
  } catch {
    list = null;
  }
  return { ok: res.ok, text, list };
};

/**
 * Whether the repo can talk to GitHub: null when gh is on PATH, signed in, and
 * the repo has an origin; else why not, in syncLabels's words.
 * @param {{root: string}} run
 * @returns {string|null}
 */
const ghReadiness = (run) => {
  if (onPath('gh') === null) return 'gh not installed';
  if (!ghStep(run, ['auth', 'status']).ok) return 'gh not authenticated';
  if (gitIn(run.root, ['remote', 'get-url', 'origin'], { stdio: 'ignore' }).status !== 0) return 'no origin remote';
  return null;
};

/**
 * A required `test` becomes `check` once `branch` carries the caller, all else
 * kept; the JSON read from the probe's first `{` line.
 * @returns {boolean} true swapped or tried (one line says which), false nothing to swap yet
 */
const swapRequiredTestCheck = (run, repo, branch, check, probe) => {
  if (check === 'test') return false;
  const at = probe.search(/^\{/m);
  let protection;
  try {
    protection = JSON.parse(at < 0 ? '' : probe.slice(at));
  } catch {
    return false;
  }
  const required = protection && protection.required_status_checks;
  if (required === null || required === undefined || required === false) return false;
  const listed = required.checks ?? (required.contexts ?? []).map((context) => ({ context }));
  if (!Array.isArray(listed) || !listed.some((c) => c.context === 'test')) return false;
  const checks = [];
  for (const c of listed) {
    const swapped = c.context === 'test' ? { ...c, context: check } : { ...c };
    if (swapped.app_id === null || swapped.app_id === undefined) delete swapped.app_id;
    if (!checks.some((kept) => kept.context === swapped.context)) checks.push(swapped);
  }
  // Until the caller is on the default branch, its pushes still report `test`.
  const remote = ghStep(run, [
    'api', `repos/${repo}/contents/${CALLER}?ref=${branch}`, '-H', 'Accept: application/vnd.github.raw+json',
  ]);
  if (!remote.ok) return false;
  const caller = checksRewrite(TEMPLATE, run.root);
  if (caller.status !== 0 || chomp(remote.stdout) !== chomp(caller.text)) return false;
  const patched = ghStep(run, [
    'api', '-X', 'PATCH', `repos/${repo}/branches/${branch}/protection/required_status_checks`, '--input', '-',
  ], JSON.stringify({ checks }));
  if (patched.ok) {
    ok(`protection: ${branch} now requires ${check} in place of test, the check the kit's caller reports`);
  } else {
    flag(run, `protection: ${branch} still requires test, which the kit's caller reports as ${check}, so merges wait on it; swap it in the branch protection settings`);
  }
  return true;
};

/**
 * Branch protection, best effort, never a failure: it needs admin, and free
 * plans protect only public repos, so every miss is a quiet skip. An existing
 * protection is left as found, but for the one check the caller renamed.
 * @param {{root: string, needsAttention: boolean}} run
 */
const ensureBranchProtection = (run) => {
  if (ghReadiness(run) !== null) return;
  const read = ghStep(run, ['api', 'repos/{owner}/{repo}', '-q', '.full_name']);
  if (!read.ok) return;
  const repo = chomp(read.stdout);
  // The heal's one gh wait a person sees: every other call's output is captured.
  const branch = spin('reading the default branch', () => defaultBranch(run.root));
  if (!repo || !branch) return;

  // The caller's job `checks` runs ci.yml's `test`, which GitHub reports as
  // `checks / test`; the kit's own checks.yml defines `test` itself.
  const check = isKitCheckout(run.root) ? 'test' : 'checks / test';

  // Only an explicit "not protected" answer may lead to a PUT: any other
  // failure is indistinguishable from "protected but unreadable".
  const probe = ghStep(run, ['api', `repos/${repo}/branches/${branch}/protection`]);
  if (probe.ok) {
    if (!swapRequiredTestCheck(run, repo, branch, check, probe.stdout)) skip(`protection: ${branch} already protected`);
    return;
  }
  const said = `${probe.stdout}${probe.stderr}`;
  if (!said.includes('Branch not protected') && !said.includes('HTTP 404')) return;
  const payload = JSON.stringify({
    required_status_checks: { strict: false, contexts: [check] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
  });
  if (ghStep(run, ['api', '-X', 'PUT', `repos/${repo}/branches/${branch}/protection`, '--input', '-'], payload).ok) {
    ok(`protection: ${branch} now requires the ${check} check before merge`);
  } else {
    skip(`protection: not applied to ${branch} (needs admin, and GitHub enforces it on private repos only on paid plans)`);
  }
};

/**
 * The desired labels of labels.json, every group's or one group's:
 * `<group>:<value>`, its description, its color or the group's.
 * @param {string} only a group name, or '' for every group
 * @returns {Array<{name: string, description: string, color: string}>}
 */
const desiredLabels = (only) => {
  const manifest = readJsonOrNull(LABELS_JSON);
  if (!manifest || !manifest.groups) return [];
  return Object.entries(manifest.groups)
    .filter(([group]) => only === '' || group === only)
    .flatMap(([group, set]) => Object.entries(set.values).map(([value, label]) => ({
      name: `${group}:${value}`, description: `${label.description}`, color: `${label.color ?? set.color}`,
    })));
};

/**
 * The labels.json labels (one group's, or every one for '') made and
 * corrected against `existing`, gh's label list, each gh call given `extra`.
 * @param {{root: string, needsAttention: boolean}} run
 * @param {string} task the lines' task word
 * @param {Array<{name: string, description: string, color: string}>} existing
 * @param {string} group
 * @param {string[]} extra trailing gh arguments
 */
const syncLabelSet = (run, task, existing, group, extra) => {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const { name, description, color } of desiredLabels(group)) {
    const current = existing.find((label) => label.name === name);
    if (!current) {
      if (ghStep(run, ['label', 'create', name, '--description', description, '--color', color, ...extra]).ok) {
        created += 1;
      } else {
        // A label the manifest asks for is still missing: retry next session.
        flag(run, `${task}: could not create ${name}`);
      }
      continue;
    }
    // Hex case is not meaningful.
    if (`${current.description}` === description && `${current.color}`.toLowerCase() === color.toLowerCase()) {
      unchanged += 1;
      continue;
    }
    if (ghStep(run, ['label', 'edit', name, '--description', description, '--color', color, ...extra]).ok) {
      updated += 1;
    } else {
      flag(run, `${task}: could not update ${name}`);
    }
  }
  if (created > 0) ok(`${task}: created ${created}`);
  if (updated > 0) ok(`${task}: corrected ${updated}`);
  if (unchanged > 0) skip(`${task}: ${unchanged} already correct`);
};

/**
 * The repo's labels synced from labels.json. A missing or unparsable manifest
 * is a broken install, so the run is flagged for a retry. Keeps gh's list as `run.labels`,
 * null when the sync never reached GitHub or it answered nothing.
 * @param {{root: string, needsAttention: boolean}} run
 */
const syncLabels = (run) => {
  if (!isFile(LABELS_JSON)) {
    flag(run, `labels: labels.json missing at ${nativePath(LABELS_JSON)}; reinstall the workflow core`);
    return;
  }
  if (readJsonOrNull(LABELS_JSON) === null) {
    flag(run, `labels: labels.json at ${nativePath(LABELS_JSON)} cannot be read as JSON; reinstall the workflow core`);
    return;
  }
  const reason = ghReadiness(run);
  if (reason !== null) {
    skip(`labels: ${reason}; skipped`);
    return;
  }
  const read = ghRead(run, ['label', 'list', '--json', 'name,description,color', '--limit', '300']);
  if (!read.ok) {
    skip('labels: could not reach GitHub; skipped');
    return;
  }
  const existing = Array.isArray(read.list) ? read.list : [];
  run.labels = read.text === '' ? null : existing;
  syncLabelSet(run, 'labels', existing, '', []);
};

/**
 * The `public` setting into `run.publicRepo`, the merged view's, '' when there
 * is none; a value that is no slug is a warning naming the key, and the
 * pairing stays off.
 * @param {{root: string, needsAttention: boolean}} run
 */
const readPublicRepo = (run) => {
  run.publicRepo = '';
  let value;
  try {
    value = settingsAt(run.root).public;
  } catch (err) {
    // A broken kit says so; the heal goes on and ends unfinished.
    writeErr(`${err.message}\n`);
    run.needsAttention = true;
    return;
  }
  if (value === null || value === undefined) return;
  const shown = typeof value === 'string' ? value : JSON.stringify(value);
  if (shown === '') return;
  if (SLUG_RE.test(shown)) {
    run.publicRepo = shown;
    return;
  }
  flag(run, `public: the public key in the settings is '${shown}', not an owner/name slug; the public pairing is off until it is one`);
};

/**
 * The status group of labels.json on the public repo, never the other groups.
 * Runs only after the repo's own sync reached GitHub.
 * @param {{root: string, publicRepo?: string, labels?: object[]|null}} run
 */
const syncPublicLabels = (run) => {
  if (!run.publicRepo || !run.labels) return;
  const read = ghRead(run, [
    'label', 'list', '--repo', run.publicRepo, '--json', 'name,description,color', '--limit', '300',
  ]);
  if (!read.ok) {
    warn(`public labels: could not read the labels of ${run.publicRepo}; skipped`);
    return;
  }
  syncLabelSet(run, 'public labels', Array.isArray(read.list) ? read.list : [], 'status', ['--repo', run.publicRepo]);
};

/**
 * The session-start sweep: every open linked issue's status mirrored onto its
 * public issue (public/mirror.js --all). A failed mirror is a warning, never a
 * failed heal.
 * @param {{root: string, publicRepo?: string, labels?: object[]|null}} run
 */
const sweepPublicMirror = (run) => {
  if (!run.publicRepo || !run.labels) return;
  const res = spawnSync(process.execPath, [MIRROR, '--all'], {
    cwd: run.root, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true,
  });
  for (const line of (res.stdout || '').split('\n')) {
    if (line) ok(line);
  }
  warnLines('public', res.error ? res.error.message : (res.stderr || ''));
};

module.exports = {
  LABELS_JSON,
  ghRead,
  ghStep,
  ghReadiness,
  ensureBranchProtection,
  readPublicRepo,
  syncLabels,
  syncPublicLabels,
  sweepPublicMirror,
};
