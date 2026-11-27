/**
 * workflow/workkit/site.js: the dashboard site question setup asks once,
 * whether the home repo publishes and at what domain, the one guarded write
 * both answers make to the machine's settings file, and that file's path.
 * Usage: const { offerSitePublish, setSitePublish, settingsOf } = require('./site');
 */

const path = require('path');
const { homeRun, homeMissing } = require('./kit');
const { askYes, readLine } = require('../lib/flows');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { writeErr, writeOut } = require('../lib/say');
const { nativePath } = require('../lib/platform');
const { editJson } = require('../lib/write');
const { readJsonOrNull } = require('../lib/read');
const { isFile, takeLock, dropLock, stateLockPath } = require('../lib/lock');
const { siteOption } = require('../lib/settings');
const { isPlain } = require('../../hooks/mods/settings.js');
const { chomp } = require('../../hooks/mods/text.js');

/**
 * The machine's settings file the site options live in, `<user dir>/settings.json`.
 * @param {object} kit
 * @returns {string}
 */
const settingsOf = (kit) => `${kit.userDir}/settings.json`;

/** siteOption of the machine's file, or null after the line naming broken kit defaults. */
const siteText = (kit, key) => {
  try {
    return siteOption(key, settingsOf(kit));
  } catch {
    writeErr(`workkit: the kit's settings defaults ${nativePath(path.join(kit.root, 'defaults', 'settings.json'))} are missing or not a JSON object; reinstall the kit\n`);
    return null;
  }
};

/** The home repo's slug as home.js names it, '' for none; its warnings reach stderr. */
const homeSlug = (kit) => {
  const res = homeRun(kit, ['slug']);
  return res.code === 0 ? chomp(res.stdout) : '';
};

/**
 * The one guarded write of a site option: `site` merged with `{ <key>: <value> }`
 * under the state mutex every writer of the machine's file takes (a `site`
 * of null or false reads as none). A failed take still writes.
 * @param {object} kit
 * @param {string} key
 * @param {*} value the JSON value written
 * @returns {Promise<number>} 0 written, 1 after editJson's warning
 */
const writeSiteOption = async (kit, key, value) => {
  const lock = stateLockPath(kit.userDir);
  const locked = await takeLock(lock);
  const written = editJson(settingsOf(kit), (old) => {
    if (old !== null && !isPlain(old)) throw new Error('site: the settings are not an object');
    const top = old ?? {};
    const site = top.site === null || top.site === false || top.site === undefined ? {} : top.site;
    if (!isPlain(site)) throw new Error('site: site is not an object');
    return { ...top, site: { ...site, [key]: value } };
  });
  if (locked) dropLock(lock);
  return written ? 0 : 1;
};

/**
 * Record the publish answer, in the voice of what it means.
 * @param {object} kit
 * @param {'true'|'false'} value
 * @returns {Promise<number>} 0
 */
const setSitePublish = async (kit, value) => {
  const file = nativePath(settingsOf(kit));
  if (await writeSiteOption(kit, 'publish', value === 'true') !== 0) {
    warn(`site: the answer could not be written to ${file}; set \`site.publish\` there by hand`);
  } else if (value === 'true') {
    ok('site: publishing is on; `workkit publish` builds it now, and the daily job publishes after the morning brief (what Pages serves is public, even from a private repo)');
  } else {
    ok(`site: publishing stays off; set \`site.publish\` to true in ${file} whenever you want the dashboard live`);
  }
  return 0;
};

/**
 * Record the custom domain, in the same voice.
 * @param {object} kit
 * @param {string} url
 * @returns {Promise<number>} 0
 */
const setSiteUrl = async (kit, url) => {
  if (await writeSiteOption(kit, 'url', url) !== 0) {
    warn(`site: the domain could not be written to ${nativePath(settingsOf(kit))}; set \`site.url\` there by hand`);
  } else {
    ok(`site: the site answers at ${url}; the publish writes the CNAME, and the DNS record is yours to point at GitHub Pages`);
  }
  return 0;
};

/**
 * The custom domain, its question on stdout. Empty means the plain github.io
 * address, so nothing is written; anything typed is taken at its word.
 * @param {object} kit
 * @returns {Promise<number>} 0
 */
const askSiteUrl = async (kit) => {
  writeOut('Custom domain for the site? [enter for none] ');
  const answer = await readLine();
  return answer ? setSiteUrl(kit, answer) : 0;
};

/** The step's reads before any answer: the line that ends it, or the current answer. */
const current = (kit) => {
  const file = settingsOf(kit);
  if (!isFile(kit.files.home)) {
    skip(homeMissing(kit, 'site'));
    return { done: 0 };
  }
  if (!isFile(file)) {
    skip(`site: ${nativePath(file)} does not exist yet; the first heal seeds it, and the next setup asks`);
    return { done: 0 };
  }
  // The file is asked to hold an object first: the merged read takes a broken layer as unanswered.
  if (!isPlain(readJsonOrNull(file))) {
    warn(`site: ${nativePath(file)} does not parse as JSON; the publish question was not asked; fix the file, then re-run \`workkit setup\``);
    return { done: 0 };
  }
  const publish = siteText(kit, 'publish');
  if (publish === null) return { done: 1 };
  if (homeSlug(kit) === '') {
    skip('site: no home repo yet; the publish question comes once there is one to publish from');
    return { done: 0 };
  }
  return { publish };
};

/**
 * The site switch, asked once: `true` and `false` are answers, null or no key
 * the unanswered state. Sets kit.run.sitePublish to what this run leaves it
 * reading ('true', 'false' on a fresh no, '' for every other ending).
 * @param {object} kit
 * @returns {Promise<number>} 0, or 1 after the line naming broken kit defaults
 */
const offerSitePublish = async (kit) => {
  kit.run.sitePublish = '';
  const read = current(kit);
  if ('done' in read) return read.done;
  const file = nativePath(settingsOf(kit));
  if (read.publish === 'true') {
    kit.run.sitePublish = 'true';
    skip(`site: publishing is on; edit \`site.publish\` in ${file} to change it`);
    return 0;
  }
  if (read.publish === 'false') {
    skip(`site: publishing is off; edit \`site.publish\` in ${file} to change it`);
    return 0;
  }
  if (!kit.interactive) {
    info(`site: nobody has been asked whether to publish the dashboard; without a terminal, set \`site.publish\` to true or false in ${file} to answer; until then nothing is published`);
    return 0;
  }
  const value = (await askYes('Publish the dashboard site to GitHub Pages?', 'n')) ? 'true' : 'false';
  await setSitePublish(kit, value);
  kit.run.sitePublish = value;
  // The domain rides the fresh yes alone, the one moment no address is in use.
  if (value === 'true' && !siteText(kit, 'url')) await askSiteUrl(kit);
  return 0;
};

module.exports = { offerSitePublish, setSitePublish, settingsOf };
