/**
 * workflow/workkit/identity.js: the agent's GitHub identity, workkit-agent[bot]:
 * setup's sign-in and install steps and the two doctor lines. The client
 * (identity/token.js) answers and the sign-in (identity/login.js) runs, each a
 * program of the running Node; this says what they did.
 * Usage: const { identityStep, identityInstallStep, identityReport } = require('./identity');
 */

const fs = require('fs');
const {
  ok, skip, info, warn, warnLines,
} = require('../lib/voice');
const { spin } = require('../lib/spin');
const {
  askYes, opener, openUrl, poll,
} = require('../lib/flows');
const { nativePath } = require('../lib/platform');
const { isCloud } = require('../lib/cloud');
const { repoSlug } = require('../lib/repo');
const { readOrNull } = require('../lib/read');
const { secretStep } = require('../lib/command-log');
const { bounded } = require('../lib/bounded');
const { rosterOf, rosterPath } = require('../../hooks/mods/optin.js');
const { chomp } = require('../../hooks/mods/text.js');
const { nodeRead, nodeRun } = require('./kit');

// One installation lookup's bound, past the client's worst case (a 5s repo
// read, the 15s ask, a 5s id read), so the client's own refusal lands inside it.
const LOOKUP_TIMEOUT_S = 45;

// The marker the client's refusal names the owner and its install page after.
const INSTALL_ON = 'install workkit-agent[bot] on ';

/** The first line of <text>. */
const firstLine = (text) => text.split('\n')[0];

/** A skip line on stderr: WK_LOG_STDERR for this one line. */
const skipOnStderr = (message) => {
  const was = process.env.WK_LOG_STDERR;
  process.env.WK_LOG_STDERR = '1';
  try {
    skip(message);
  } finally {
    if (was === undefined) delete process.env.WK_LOG_STDERR;
    else process.env.WK_LOG_STDERR = was;
  }
};

/**
 * Whether the client can be asked at all, the client
 * beside this engine; a miss is one skip line through <say>.
 * @param {object} kit
 * @param {((message: string) => void)|null} [say] skip by default; null says nothing
 * @returns {number} 0 when it passes, else 1
 */
const identityPrecheck = (kit, say = skip) => {
  if (fs.existsSync(kit.files.identityClient)) return 0;
  say?.(`identity: the client is missing beside ${nativePath(kit.engine)} (${nativePath(kit.files.identityClient)}); the kit is incomplete`);
  return 1;
};

/**
 * `token.js --status`, read once per run into
 * kit.run.identity (`{ signedIn, user }`); clearing it asks again. A client
 * that cannot answer warns its message, a line per warning, unless <loud> is false.
 * @param {object} kit
 * @param {boolean} [loud]
 * @returns {number} 0 when read, else 1
 */
const identityReadStatus = (kit, loud = true) => {
  if (kit.run.identity) return 0;
  const res = nodeRead(kit, kit.files.identityClient, ['--status']);
  const json = chomp(`${res.stdout}${res.stderr}`);
  let status;
  try {
    status = res.code === 0 ? JSON.parse(json) : undefined;
  } catch { /* the warning below names what came back */ }
  if (status === undefined || (status !== null && typeof status !== 'object') || Array.isArray(status)) {
    if (loud) warnLines('identity', `identity: the client could not report its state: ${json || 'no output'}`);
    return 1;
  }
  const login = status?.login;
  kit.run.identity = { signedIn: String(status?.signedIn) === 'true', user: login === null || login === undefined || login === false ? '' : String(login) };
  return 0;
};

/**
 * The client's lookup for <slug>, bounded, its two
 * streams one answer: the verdict on the first line, the client's message after.
 * @param {object} kit
 * @param {string} slug
 * @param {'--installation'|'--probe'} [flag] `--probe` asks for the verdict alone
 * @returns {Promise<{code: number, answer: string}>}
 */
const identityInstallation = async (kit, slug, flag = '--installation') => {
  const read = await bounded(process.execPath, [kit.files.identityClient, flag, slug], { bound: LOOKUP_TIMEOUT_S * 1000, env: kit.env });
  // stdout first, as the client writes it first: the verdict is always the first line.
  return { code: read.status, answer: chomp(`${read.stdout}${read.stderr}`) };
};

/** The lookup under its wait line. */
const identityInstallLookup = (kit, slug) => spin(`asking the token service whether workkit-agent[bot] is installed on ${slug}`, () => identityInstallation(kit, slug));

/**
 * One lookup's answer for <slug> in words: the ok line
 * when installed, else a warning carrying the service's message or the failure.
 * @param {object} kit
 * @param {string} slug
 * @param {number} code the lookup's code
 * @param {string} answer the lookup's answer
 * @returns {number} 0 when installed, else 1
 */
const identityInstallSay = (kit, slug, code, answer) => {
  const verdict = firstLine(answer);
  const message = answer.includes('\n') ? answer.slice(answer.indexOf('\n') + 1) : '';
  if (code === 0 && verdict === 'installed') {
    ok(`identity: workkit-agent[bot] installed on ${slug}`);
    return 0;
  }
  let said;
  if (code === 0 && verdict === 'not installed') said = `identity: workkit-agent[bot] is not installed on ${slug}${message ? `: ${message}` : ''}`;
  else if (!answer) said = `identity: the installation check on ${slug} did not answer within ${LOOKUP_TIMEOUT_S}s`;
  else said = `identity: the installation check on ${slug} failed: ${answer}`;
  warnLines('identity', said);
  return 1;
};

/**
 * The cwd's origin when signed in, each caller adding
 * its repo rule; '' having said nothing otherwise.
 * @param {object} kit
 * @returns {string}
 */
const identitySignedSlug = (kit) => {
  if (identityPrecheck(kit, null) !== 0 || identityReadStatus(kit, false) !== 0) return '';
  return kit.run.identity.signedIn ? repoSlug(process.cwd()) : '';
};

/**
 * The sign-in verdict.
 * @param {object} kit
 * @param {boolean} [okLine] false leaves the signed-in line out
 * @returns {number} 0 with the ok line when signed in, else 1 with the warning naming the command
 */
const identitySayStatus = (kit, okLine = true) => {
  if (kit.run.identity?.signedIn) {
    if (okLine) ok(`identity: signed in as @${kit.run.identity.user}`);
    return 0;
  }
  warn('identity: not signed in; run `workkit setup --login`');
  return 1;
};

/**
 * Setup's sign-in. Signed in is said; not signed in asks at a
 * keyboard (Enter is yes) and is a warning anywhere else. <force> (`setup
 * --login`) asks nothing and signs in whatever stands.
 * @param {object} kit
 * @param {*} [force] truthy for `setup --login`
 * @returns {Promise<number>} 0; forced, 1 when the sign-in did not end signed in
 */
const identityStep = async (kit, force) => {
  const fail = force ? 1 : 0;
  if (identityPrecheck(kit) !== 0 || identityReadStatus(kit) !== 0) return fail;
  if (force) {
    info("identity: signing in to GitHub, so the agent's issue bookkeeping posts as workkit-agent[bot]");
  } else if (kit.run.identity.signedIn || !kit.interactive
    || !await askYes("Sign in to GitHub now, so the agent's issue bookkeeping posts as workkit-agent[bot]?", 'y')) {
    identitySayStatus(kit);
    return 0;
  }
  const open = opener({ platform: kit.platform, env: kit.env });
  // The device code is the sign-in's own, so it shows on the terminal, never in a log.
  const code = await secretStep(kit, 'the GitHub sign-in (identity/login.js)', ({ stdout, stderr }) => (
    nodeRun(kit, kit.files.identityLogin, open ? ['--open', open] : [], { stdio: ['inherit', stdout, stderr] })
  ));
  // A skipped step's one line is secretStep's own; it is a sign-in not done.
  if (code === null) return fail;
  // A declined or abandoned sign-in is the status read's to report, but a forced one.
  if (code !== 0 && force) {
    warn('identity: the sign-in did not finish; run `workkit setup --login` again');
    return 1;
  }
  kit.run.identity = null;
  if (identityReadStatus(kit) !== 0 || identitySayStatus(kit) !== 0) return fail;
  return 0;
};

/** Whether <slug> is an enabled entry of this machine's roster, matched by each folder's origin. */
const onRoster = async (kit, slug) => (await rosterPath(slug, await rosterOf(kit.env, readOrNull), repoSlug)) !== null;

/**
 * The doctor lines. `machine` says whether this machine is
 * signed in; `repo` whether workkit-agent[bot] is installed on the cwd's
 * origin when signed in and enabled on the roster. A cloud session has no bot.
 * @param {object} kit
 * @param {'machine'|'repo'} scope
 * @param {{okLine?: boolean}} [options] okLine false leaves the signed-in line
 *   out, the count unchanged (`update --auto`)
 * @returns {Promise<number>} how many need attention, 0 or 1
 */
const identityReport = async (kit, scope, { okLine = true } = {}) => {
  if (isCloud(kit.env)) {
    // At the call: setup.js holds the not-applicable table and loads this file.
    if (scope !== 'repo') await require('./setup').cloudNa(kit, 'signin');
    return 0;
  }
  if (scope === 'repo') {
    if (identityPrecheck(kit, null) !== 0) return 0;
    const slug = identitySignedSlug(kit);
    if (!slug || !await onRoster(kit, slug)) return 0;
    const { code, answer } = await identityInstallLookup(kit, slug);
    return identityInstallSay(kit, slug, code, answer);
  }
  if (identityPrecheck(kit) !== 0) return 0;
  if (identityReadStatus(kit) !== 0) return 1;
  return identitySayStatus(kit, okLine);
};

/**
 * `setup --bot`'s repo, the cwd's origin, when signed in;
 * else the warning naming what to do first. The flag is the opt-in.
 * @param {object} kit
 * @returns {string} '' after its line when there is none
 */
const identityBotSlug = (kit) => {
  if (identityPrecheck(kit, skipOnStderr) !== 0 || identityReadStatus(kit) !== 0) return '';
  if (!kit.run.identity.signedIn) {
    warn('identity: not signed in; run `workkit setup --login` first');
    return '';
  }
  const slug = repoSlug(process.cwd());
  if (!slug) warn(`identity: ${nativePath(process.cwd())} has no GitHub origin to install workkit-agent[bot] for`);
  return slug;
};

/**
 * Setup's This repo step, signed in and opted in.
 * Installed is said; not installed at a keyboard offers the install page (an
 * owner's click) and polls; anything else warns with that page. <force>
 * (`setup --bot`) runs in any repo with a GitHub origin.
 * @param {object} kit
 * @param {*} [force] truthy for `setup --bot`
 * @returns {Promise<number>} 0; forced, 1 unless the App ends installed
 */
const identityInstallStep = async (kit, force) => {
  const fail = force ? 1 : 0;
  let slug;
  if (force) {
    if (identityPrecheck(kit, skipOnStderr) !== 0) return 1;
    slug = identityBotSlug(kit);
    if (!slug) return 1;
  } else {
    if (identityPrecheck(kit, null) !== 0) return 0;
    // At the call: install.js is the machine steps' file, not this one's.
    if (await require('./install').repoState(kit) !== 'enabled') return 0;
    slug = identitySignedSlug(kit);
    if (!slug) return 0;
  }
  let last = await identityInstallLookup(kit, slug);
  // The refusal names the canonical owner and its page, so a renamed owner is offered under its new login.
  const line = firstLine(last.answer.includes(INSTALL_ON) ? last.answer.slice(last.answer.indexOf(INSTALL_ON) + INSTALL_ON.length) : last.answer);
  const owner = line.includes(': ') ? line.slice(0, line.indexOf(': ')) : line;
  const page = line.includes(': ') ? line.slice(line.indexOf(': ') + 2) : line;
  const notInstalled = () => last.code === 0 && firstLine(last.answer) === 'not installed';
  if (!notInstalled() || !page.startsWith('https://')) return identityInstallSay(kit, slug, last.code, last.answer) === 0 ? 0 : fail;
  if (kit.interactive && await askYes(`Install workkit-agent[bot] on ${owner} now?`, 'y')) {
    info(`identity: install workkit-agent[bot] on ${owner} at ${page}`);
    openUrl(page);
    await poll(`waiting for workkit-agent[bot] to be installed on ${owner}`, 15, async () => {
      last = await identityInstallation(kit, slug, '--probe');
      return last.code === 0 && firstLine(last.answer) === 'installed';
    });
  }
  if (notInstalled()) {
    warn(`identity: workkit-agent[bot] is not installed on ${slug}; install it on ${owner} at ${page}`);
    return fail;
  }
  return identityInstallSay(kit, slug, last.code, last.answer) === 0 ? 0 : fail;
};

module.exports = {
  identityStep,
  identityInstallStep,
  identityReport,
  identityPrecheck,
  identityReadStatus,
  identityInstallation,
  identityInstallLookup,
  identityInstallSay,
  identitySignedSlug,
  identitySayStatus,
  identityBotSlug,
};
