/**
 * workflow/workkit/token.js: the token handover, setup's last site step: this
 * machine's gh login token handed to the published dashboard's Settings page
 * in the URL fragment, which a browser never sends to a server, once Pages
 * serves the publish. Every ending is a named line and a 0.
 * Usage: const { handoverToken } = require('./token');
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../lib/run');
const { bounded } = require('../lib/bounded');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { spin } = require('../lib/spin');
const { opener } = require('../lib/flows');
const { nativePath } = require('../lib/platform');
const { chomp } = require('../../hooks/mods/text.js');
const { homeMissing } = require('./kit');
const { settingsOf } = require('./site');
const {
  ghAuthToken, homeValue, scratchDir, tempFile,
} = require('./secrets');

// The handover page's name before its random tail; the sweep takes every one.
const PAGE_PREFIX = 'workkit-handover.';

// How often the Pages build is read again, and how many empty reads running end the wait.
const PAGES_EVERY_S = 5;
const BLANKS_LIMIT = 3;

// How long the page outlives a normal end, since the browser reads it asynchronously.
const PAGE_LINGER_MS = 3000;

// A character that would break the page's string literal or open its own fragment.
const URL_UNSAFE = /["\\<>#\s]/;

/** A leftover page of an interrupted run, gone before anything new is written. */
const sweepPages = (kit) => {
  let names = [];
  try {
    names = fs.readdirSync(scratchDir(kit));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(PAGE_PREFIX)) fs.rmSync(path.join(scratchDir(kit), name), { force: true });
  }
};

/** The Settings page's address: a custom domain at its root, github.io under `/<name>/`, its owner lowercased as a hostname is. */
const settingsUrl = (kit, slug) => {
  const host = homeValue(kit, 'host');
  if (host) return `https://${host}/settings`;
  const owner = slug.split('/')[0].toLowerCase();
  const name = slug.slice(slug.lastIndexOf('/') + 1);
  return `https://${owner}.github.io/${name}/settings`;
};

/** One bounded `gh api <route> --jq <filter>` under its wait line, its stdout as `$(...)` takes it. */
const ghRead = async (kit, message, route, filter) => {
  const read = await spin(message, () => bounded('gh', ['api', route, '--jq', filter], { bound: kit.secrets.timeout * 1000, env: kit.env }), { line: false });
  return chomp(read.stdout);
};

/**
 * Wait until Pages has built <sha>: a read every five seconds up to
 * kit.pagesWait; three empty reads running, an errored build or the wait
 * running out is the line that ends it.
 * @returns {Promise<boolean>} whether the publish is served
 */
const pagesServed = async (kit, slug, sha, url) => {
  let waited = 0;
  let blanks = 0;
  for (;;) {
    const latest = await ghRead(kit, 'reading the latest Pages build', `repos/${slug}/pages/builds/latest`, '[.status, .commit] | @tsv');
    const status = latest.split('\t')[0];
    const commit = latest.slice(latest.lastIndexOf('\t') + 1);
    // Any status, `building` included, resets the count.
    if (!latest) {
      blanks += 1;
      if (blanks >= BLANKS_LIMIT) {
        skip(`site: three reads of ${slug}'s latest Pages build came back with nothing, so the token was not handed over; Pages may be off (https://github.com/${slug}/settings/pages) or unreachable; open ${url} and paste \`gh auth token\` on its Settings page`);
        return false;
      }
    } else {
      blanks = 0;
    }
    if (status === 'errored') {
      warn(`site: the GitHub Pages build for ${slug} errored, so nothing was handed over; open ${url} once it is green and paste \`gh auth token\` on its Settings page`);
      return false;
    }
    if (status === 'built' && commit === sha) return true;
    if (waited >= kit.pagesWait) {
      skip(`site: GitHub Pages has not served the publish after ${kit.pagesWait}s, so the token was not handed over; open ${url} and paste \`gh auth token\` on its Settings page`);
      return false;
    }
    await new Promise((resolve) => { setTimeout(resolve, PAGES_EVERY_S * 1000); });
    waited += PAGES_EVERY_S;
  }
};

/**
 * The page's removal for the rest of the run: PAGE_LINGER_MS after the run's
 * end, at once on INT and TERM, which then end the run with 130 and 143,
 * since a handler that returned would swallow the interrupt.
 * The wait is a timer, so a signal lands during it: kit.run.atEnd's at the
 * command's end, or the loop's emptying for a caller with no atEnd.
 */
const guardPage = (kit, page) => {
  const remove = () => fs.rmSync(page, { force: true });
  let until = null;
  let waited = null;
  const done = () => {
    process.removeListener('exit', atExit);
    process.removeListener('beforeExit', linger);
    remove();
  };
  // Begun once, whichever end reaches it first.
  const linger = () => {
    if (waited) return waited;
    until = Date.now() + PAGE_LINGER_MS;
    waited = new Promise((resolve) => { setTimeout(resolve, PAGE_LINGER_MS); }).then(done);
    return waited;
  };
  // An end by process.exit that no timer reached waits blocked, for what is left of the wait.
  function atExit() {
    const left = until === null ? PAGE_LINGER_MS : Math.max(0, until - Date.now());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, left);
    remove();
  }
  const ending = (code) => () => {
    process.removeListener('exit', atExit);
    remove();
    process.exit(code);
  };
  process.on('exit', atExit);
  process.on('beforeExit', linger);
  process.on('SIGINT', ending(130));
  process.on('SIGTERM', ending(143));
  kit.run.atEnd.push(linger);
};

/**
 * The sweep of old pages, then the checks (home.js, a home repo, the site URL,
 * an opener), the Pages wait, and the token written into a mode 600 page that the
 * opener hands to the browser; the token is never an argument and never printed.
 * @param {object} kit
 * @returns {Promise<number>} 0 on every named ending
 */
const handoverToken = async (kit) => {
  sweepPages(kit);
  if (!fs.existsSync(kit.files.home)) {
    skip(homeMissing(kit, 'site'));
    return 0;
  }
  const slug = homeValue(kit, 'slug');
  if (!slug) {
    skip('site: the token handover needs a home repo to name the published site');
    return 0;
  }
  const url = settingsUrl(kit, slug);
  if (URL_UNSAFE.test(url)) {
    skip(`site: the recorded \`site.url\` cannot be put in a URL as it stands, so the token was not handed over; fix it in ${nativePath(settingsOf(kit))}, then re-run \`workkit setup\``);
    return 0;
  }
  // The skips name the URL without the fragment, the by-hand address.
  const open = opener({ platform: kit.platform, env: kit.env });
  if (!open) {
    skip(`site: the token handover needs a browser opener; open ${url} and paste \`gh auth token\` on its Settings page`);
    return 0;
  }
  // The commit the publish pushed: waiting on any build would hand the token to whatever Pages serves.
  const { PAGES_BRANCH } = require('../home/options');
  const sha = await ghRead(kit, `reading ${PAGES_BRANCH} on ${slug}`, `repos/${slug}/git/ref/heads/${PAGES_BRANCH}`, '.object.sha');
  if (!sha) {
    skip(`site: ${slug}'s ${PAGES_BRANCH} head could not be read, so there is no publish to wait for; open ${url} and paste \`gh auth token\` on its Settings page`);
    return 0;
  }
  info('site: waiting for GitHub Pages to serve the publish');
  if (!await pagesServed(kit, slug, sha, url)) return 0;

  const token = ghAuthToken(kit);
  if (!token) {
    skip(`site: \`gh auth token\` returned nothing, so there was no token to hand over; run \`gh auth login\`, then open ${url} and paste it on the Settings page`);
    return 0;
  }
  // A gh token is URL-safe as it stands; anything else is not escaped on a guess.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    skip(`site: this login's token carries characters a URL fragment would have to escape, so it was not handed over; open ${url} and paste \`gh auth token\` on its Settings page`);
    return 0;
  }
  const page = tempFile(kit, PAGE_PREFIX, '.html');
  guardPage(kit, page);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><script>location.replace("${url}#token=${token}")</script>`);
  if (spawnSync(open, [page], { stdio: 'ignore', env: kit.env, windowsHide: true }).status !== 0) {
    warn(`site: \`${open}\` did not open the handover page, so the token was not handed over; open ${url} and paste \`gh auth token\` on its Settings page`);
    return 0;
  }
  ok("site: the dashboard's Settings page was opened with this machine's gh login token; the browser now holds it");
  return 0;
};

module.exports = { handoverToken };
