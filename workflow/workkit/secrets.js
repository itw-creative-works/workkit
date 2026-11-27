/**
 * workflow/workkit/secrets.js: the cloud brief's two secrets on the home repo:
 * the bounded listing and its ages, the Claude token's mint under a
 * pty, the gh login's push, and the three callers (setup's step, `setup
 * --token`, and the report `doctor` and `update` print). A token value travels
 * by pipe, and its one file is the mint's own capture.
 * Usage: const { secretsStep, tokenStep, secretsReport, extractToken, canMintClaudeToken, offerClaudeToken, pushHomeToken, ghAuthToken, scratchDir, tempFile, homeValue } = require('./secrets');
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { onPath, spawnSync } = require('../lib/run');
const { bounded } = require('../lib/bounded');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { spin } = require('../lib/spin');
const { askYes } = require('../lib/flows');
const { secretStep } = require('../lib/command-log');
const { nodeRead, homeMissing } = require('./kit');
const { runUnderPty } = require('./pty');
const { chomp } = require('../../hooks/mods/text.js');

/**
 * The scratch folder, TMPDIR else the system's temp folder, for the mint's
 * capture and the handover's page.
 * @param {object} kit
 * @returns {string}
 */
const scratchDir = (kit) => kit.env.TMPDIR || os.tmpdir();

/**
 * A new empty file `<prefix><six random characters><suffix>` in scratchDir,
 * mode 600 from its first byte.
 * @param {object} kit
 * @param {string} prefix
 * @param {string} [suffix]
 * @returns {string} its path
 */
const tempFile = (kit, prefix, suffix = '') => {
  const file = path.join(scratchDir(kit), `${prefix}${crypto.randomBytes(3).toString('hex')}${suffix}`);
  fs.closeSync(fs.openSync(file, 'wx', 0o600));
  return file;
};

/**
 * One verb of home.js (`slug`, `host`) read: its stdout whatever its code,
 * '' when it printed nothing; its stderr dropped.
 * @param {object} kit
 * @param {string} verb
 * @returns {string}
 */
const homeValue = (kit, verb) => chomp(nodeRead(kit, kit.files.home, [verb], { stdio: ['inherit', 'pipe', 'ignore'] }).stdout);

/**
 * `gh secret list --json name,updatedAt` for <slug>, bounded
 * by kit.secrets.timeout, or whatever it printed when it failed (an
 * unauthenticated gh, no Actions, no network).
 * @param {object} kit
 * @param {string} slug
 * @returns {Promise<string>}
 */
const secretsJson = async (kit, slug) => {
  const list = ['secret', 'list', '--repo', slug, '--json', 'name,updatedAt'];
  const read = await spin(`reading the secrets on ${slug}`, () => bounded('gh', list, { bound: kit.secrets.timeout * 1000, env: kit.env }), { line: false });
  return chomp(read.stdout);
};

/**
 * Whether a listing came back at all, a JSON array.
 * @param {string} text
 * @returns {boolean}
 */
const isListing = (text) => {
  try {
    return Array.isArray(JSON.parse(text));
  } catch {
    return false;
  }
};

// The one timestamp shape jq's fromdateiso8601 reads, once fractional seconds are gone.
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * How many whole days ago <name> was last set on the
 * listing <text>: a number as text (negative for a future time), `unknown` for
 * a timestamp that does not read, '' when the listing holds no such secret.
 * @param {string} text the listing, isListing's
 * @param {string} name
 * @returns {string}
 */
const secretAgeDays = (text, name) => {
  const entry = JSON.parse(text).find((item) => item?.name === name);
  if (entry === undefined) return '';
  const stamp = typeof entry.updatedAt === 'string' ? entry.updatedAt.replace(/\.[0-9]+/, '') : '';
  const at = ISO_SECONDS.test(stamp) ? Date.parse(stamp) : NaN;
  // A date that rolls over (month 13) reads back different: jq refuses it too.
  if (Number.isNaN(at) || `${new Date(at).toISOString().slice(0, 19)}Z` !== stamp) return 'unknown';
  return String(Math.floor((Date.now() - at) / 86400000));
};

/**
 * The token out of `claude setup-token`'s screen, colors and
 * carriage returns stripped first: the last `sk-ant-` match, else the last line
 * of nothing but 24 or more token characters, its blanks removed.
 * @param {string} text
 * @returns {string} the token, '' for none
 */
const extractToken = (text) => {
  const plain = String(text).replace(/\r/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  const prefixed = plain.match(/sk-ant-[A-Za-z0-9_-]+/g);
  if (prefixed) return prefixed[prefixed.length - 1];
  const bare = plain.split('\n').filter((line) => /^[ \t\v\f]*[A-Za-z0-9_-]{24,}[ \t\v\f]*$/.test(line));
  return bare.length ? bare[bare.length - 1].replace(/[ \t\v\f]/g, '') : '';
};

/** `printf '%s' "$token" | gh secret set <name> --repo <slug>` under its wait, both streams away; whether it landed. */
const setSecret = (kit, name, slug, token) => spin(`setting ${name} on ${slug}`, () => spawnSync('gh', ['secret', 'set', name, '--repo', slug], {
  input: token, stdio: ['pipe', 'ignore', 'ignore'], env: kit.env, windowsHide: true,
}), { line: false }).status === 0;

/**
 * This machine's gh login token, `gh auth token` under its wait, its stderr
 * away; never printed.
 * @param {object} kit
 * @returns {string} the token, '' when gh failed or answered nothing
 */
const ghAuthToken = (kit) => {
  const read = spin('reading the gh login token', () => spawnSync('gh', ['auth', 'token'], {
    stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8', env: kit.env, windowsHide: true,
  }), { line: false });
  return read.status === 0 ? chomp(read.stdout) : '';
};

/** The capture's removal, for this process's exit and its INT and TERM, after which the run goes on. */
const captureGuard = (capture) => {
  const remove = () => fs.rmSync(capture, { force: true });
  process.on('exit', remove);
  process.on('SIGINT', remove);
  process.on('SIGTERM', remove);
  return () => {
    remove();
    process.removeListener('exit', remove);
    process.removeListener('SIGINT', remove);
    process.removeListener('SIGTERM', remove);
  };
};

/**
 * `claude setup-token` under a pty as a secret step, its
 * screen caught in a mode 600 capture removed on every path, then the token on
 * `gh secret set`'s stdin. Every path that did not push names the manual commands.
 * @param {object} kit
 * @param {string} slug
 * @returns {Promise<number>} 0
 */
const mintClaudeToken = async (kit, slug) => {
  const name = kit.secrets.claude;
  const capture = tempFile(kit, 'workkit-mint.');
  const release = captureGuard(capture);
  let rc;
  let raw = '';
  try {
    info(`secrets: running \`claude setup-token\`; approve it in the browser, and the token goes straight to ${slug}, where the cloud brief runs`);
    rc = await secretStep(kit, 'the token mint (claude setup-token)', (stdio) => runUnderPty(kit, ['claude', 'setup-token'], capture, stdio));
    try {
      raw = chomp(fs.readFileSync(capture, 'utf8'));
    } catch { /* a capture an INT already removed holds nothing */ }
  } finally {
    release();
  }
  // A skipped step's one line is secretStep's own; nothing was minted.
  if (rc === null) return 0;
  if (rc !== 0) {
    warn(`secrets: \`claude setup-token\` did not finish (exit ${rc}); run it by hand, then \`gh secret set ${name} --repo ${slug}\``);
    return 0;
  }
  const token = extractToken(raw);
  if (!token) {
    warn(`secrets: \`claude setup-token\` printed no token this run; run it by hand, then \`gh secret set ${name} --repo ${slug}\``);
    return 0;
  }
  if (!setSecret(kit, name, slug, token)) {
    warn(`secrets: ${name} could not be written to ${slug}; run \`gh secret set ${name} --repo ${slug}\` by hand`);
    return 0;
  }
  ok(`secrets: ${name} is set on ${slug}; the value went from the mint into the secret, and the file it passed through is gone`);
  return 0;
};

/**
 * What a mint needs that no run can supply: the claude
 * CLI, `expect` or `script`, and a terminal for the browser approval. Each miss is one line.
 * @param {object} kit
 * @param {string} slug
 * @param {string} reason the secret's state, in the line's words
 * @returns {number} 0 when a mint can run, else 1
 */
const canMintClaudeToken = (kit, slug, reason) => {
  const name = kit.secrets.claude;
  if (!onPath('claude', { env: kit.env })) {
    skip(`secrets: ${name} ${reason} on ${slug}; minting it needs the claude CLI`);
    return 1;
  }
  if (!onPath('expect', { env: kit.env }) && !onPath('script', { env: kit.env })) {
    skip(`secrets: ${name} ${reason} on ${slug}; minting it needs \`expect\` or \`script\`, which give \`claude setup-token\` the terminal it draws on: run \`claude setup-token\` by hand, then \`gh secret set ${name} --repo ${slug}\``);
    return 1;
  }
  if (!kit.interactive) {
    info(`secrets: ${name} ${reason} on ${slug}; run these two at a terminal:\n    claude setup-token\n    gh secret set ${name} --repo ${slug}`);
    return 1;
  }
  return 0;
};

/**
 * The mint, asked first; Enter is no.
 * @param {object} kit
 * @param {string} slug
 * @param {string} reason
 * @returns {Promise<number>} 0
 */
const offerClaudeToken = async (kit, slug, reason) => {
  const name = kit.secrets.claude;
  if (canMintClaudeToken(kit, slug, reason) !== 0) return 0;
  if (await askYes(`${name} ${reason} on ${slug}. Mint one now with \`claude setup-token\`?`, 'n')) return mintClaudeToken(kit, slug);
  skip(`secrets: ${name} left as it is; \`workkit setup\` offers again`);
  return 0;
};

/**
 * The cross-repo token from this machine's gh login, on
 * `gh secret set`'s stdin.
 * @param {object} kit
 * @param {string} slug
 * @returns {number} 0
 */
const pushHomeToken = (kit, slug) => {
  const name = kit.secrets.home;
  const token = ghAuthToken(kit);
  if (!token) {
    warn(`secrets: ${name} is not set on ${slug} and \`gh auth token\` returned nothing; run \`gh auth login\`, then re-run \`workkit setup\``);
    return 0;
  }
  if (!setSecret(kit, name, slug, token)) {
    warn(`secrets: ${name} could not be written to ${slug}; run \`gh auth token | gh secret set ${name} --repo ${slug}\` by hand`);
    return 0;
  }
  ok(`secrets: ${name} is set on ${slug} from this machine's gh login; the run on ${slug} reads every board with it, so it carries that login's reach (jobs/README.md names the narrower alternative)`);
  return 0;
};

/**
 * The checks before a secret step: gh, home.js, a home repo and a listing
 * that came back, each miss a named skip. Sets kit.run.secretsSlug and
 * kit.run.secretsJson.
 * @param {object} kit
 * @returns {Promise<number>} 0 when all pass, else 1
 */
const secretsPrecheck = async (kit) => {
  kit.run.secretsSlug = '';
  kit.run.secretsJson = '';
  if (!onPath('gh', { env: kit.env })) {
    skip("secrets: the cloud brief's secrets need gh");
    return 1;
  }
  // A kit with no home.js cannot name a slug at all, unlike a machine that has no home repo yet.
  if (!fs.existsSync(kit.files.home)) {
    skip(homeMissing(kit, 'secrets'));
    return 1;
  }
  kit.run.secretsSlug = homeValue(kit, 'slug');
  if (!kit.run.secretsSlug) {
    skip("secrets: this machine names no home repo; the cloud brief runs there and posts the morning brief there, so its secrets live there too; setup's home step makes one");
    return 1;
  }
  kit.run.secretsJson = await secretsJson(kit, kit.run.secretsSlug);
  if (!isListing(kit.run.secretsJson)) {
    skip(`secrets: ${kit.run.secretsSlug}'s secrets could not be read; \`gh secret list --repo ${kit.run.secretsSlug}\` says why`);
    return 1;
  }
  return 0;
};

/** Whether an age secretAgeDays gave is past the token's refresh. */
const stale = (kit, age) => age !== 'unknown' && Number(age) > kit.secrets.maxAgeDays;

/**
 * Setup's step, acting on what is missing or stale and silent
 * about what is set and fresh. Both ages read the one listing taken first.
 * @param {object} kit
 * @returns {Promise<number>} 0
 */
const secretsStep = async (kit) => {
  if (await secretsPrecheck(kit) !== 0) return 0;
  const { secretsSlug: slug, secretsJson: listing } = kit.run;
  const claudeAge = secretAgeDays(listing, kit.secrets.claude);
  if (!claudeAge) await offerClaudeToken(kit, slug, 'is not set');
  else if (stale(kit, claudeAge)) await offerClaudeToken(kit, slug, `was set ${claudeAge} days ago and the token lives about a year`);
  else skip(`secrets: ${kit.secrets.claude} is set on ${slug}`);
  if (!secretAgeDays(listing, kit.secrets.home)) pushHomeToken(kit, slug);
  else skip(`secrets: ${kit.secrets.home} is set on ${slug}`);
  return 0;
};

/**
 * `setup --token`, the flag the yes: no age check and no
 * question, the mint's own guards kept.
 * @param {object} kit
 * @returns {Promise<number>} 0
 */
const tokenStep = async (kit) => {
  if (await secretsPrecheck(kit) !== 0) return 0;
  if (canMintClaudeToken(kit, kit.run.secretsSlug, 'is being re-minted') !== 0) return 0;
  return mintClaudeToken(kit, kit.run.secretsSlug);
};

/**
 * `doctor` says one line per secret, `update` only the warnings.
 * @param {object} kit
 * @param {'doctor'|'update'} mode
 * @returns {Promise<number>} how many need attention, 0 to 2
 */
const secretsReport = async (kit, mode) => {
  if (await secretsPrecheck(kit) !== 0) return 0;
  const { secretsSlug: slug, secretsJson: listing } = kit.run;
  let attention = 0;
  for (const name of [kit.secrets.claude, kit.secrets.home]) {
    const age = secretAgeDays(listing, name);
    if (!age) {
      warn(`secrets: ${name} is not set on ${slug}; run \`workkit setup\``);
      attention += 1;
    } else if (stale(kit, age)) {
      warn(`secrets: ${name} on ${slug} was set ${age} days ago; run \`workkit setup\` to refresh it`);
      attention += 1;
    } else if (mode === 'doctor') {
      ok(age === 'unknown' ? `secrets: ${name} is set on ${slug}` : `secrets: ${name} is set on ${slug} (${age} days ago)`);
    }
  }
  return attention;
};

module.exports = {
  secretsStep,
  tokenStep,
  secretsReport,
  extractToken,
  canMintClaudeToken,
  offerClaudeToken,
  pushHomeToken,
  ghAuthToken,
  scratchDir,
  tempFile,
  homeValue,
};
