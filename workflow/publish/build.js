#!/usr/bin/env node
/**
 * workflow/publish/build.js: the one home of the commands that turn a tower
 * project into a built site. publish.js and home's install step run it on the
 * home clone, the pages workflow on tower/app.
 * Usage: node build.js <install|mint|build> <project dir> [path prefix]
 */

const fs = require('fs');
const path = require('path');
const { isPlain } = require('../../hooks/mods/settings.js');
const { chomp } = require('../../hooks/mods/text.js');
const { file } = require('../home/committed');
const { towerApp, siteSidebar } = require('../home/options');
const { physical } = require('../lib/link');
const { isDir } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { spawnSync } = require('../lib/run');
const { writeErr } = require('../lib/say');
const { warn } = require('../lib/voice');

const SIDEBAR_REL = 'targets/web/src/_includes/backend/sections/sidebar.json';

// What awk's [[:space:]] matches on one line.
const BLANK = '[ \\t\\r\\f\\v]';
const CLOSING = new RegExp(`^${BLANK}*\\],?${BLANK}*$`);
const TRAILING = new RegExp(`^${BLANK}*(\\}${BLANK}*)?$`);
const EMPTY_OR_COMMENT = new RegExp(`^${BLANK}*(//.*)?$`);
const OPEN_ENDED = new RegExp(`[,[]${BLANK}*$`);

/**
 * A program run in the foreground, its code the answer.
 * @param {string} cmd a bare name or a path
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, stdio?: *}} [options] `env` adds to the process's own; `stdio` is spawn's, the terminal's by default
 * @returns {number} the program's own code, 1 when it never started or a signal ended it
 */
const runProgram = (cmd, args, { cwd, env, stdio = 'inherit' } = {}) => {
  const res = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio });
  // A start that failed is named, so a log of the step is never empty; a
  // caller that silenced the program silences this too.
  if (res.error && stdio !== 'ignore') writeErr(`build: could not start ${path.isAbsolute(cmd) ? nativePath(cmd) : cmd}\n`);
  return res.status ?? 1;
};

/**
 * The group rows of site.sidebar, one JSON row per line with the trailing
 * comma the JSON5 app file allows, or null when it is not a list of groups.
 * @param {string} raw the setting as JSON
 * @returns {string[]|null}
 */
const sidebarRows = (raw) => {
  let groups;
  try {
    groups = JSON.parse(raw);
  } catch {
    return null;
  }
  const shaped = Array.isArray(groups) && groups.every((group) => isPlain(group)
    && typeof group.header === 'string' && Array.isArray(group.links) && group.links.every(isPlain));
  if (!shaped) return null;
  return groups
    .flatMap((group) => [{ header: true, label: group.header }, ...group.links])
    .map((row) => `    ${JSON.stringify(row)},`);
};

/**
 * The app's text with <rows> before the links list's closing bracket, the
 * rest kept; null when that list is not last. The file is JSON5, so no JSON
 * parser reads it.
 * @param {string} app
 * @param {string[]} rows
 * @returns {string|null}
 */
const spliceSidebar = (app, rows) => {
  const lines = chomp(app).split('\n');
  const close = lines.findLastIndex((line) => CLOSING.test(line));
  if (close < 0) return null;
  if (!lines.slice(close + 1).every((line) => TRAILING.test(line))) return null;
  let prev = close - 1;
  while (prev > 0 && EMPTY_OR_COMMENT.test(lines[prev])) prev -= 1;
  if (prev >= 0 && !OPEN_ENDED.test(lines[prev])) lines[prev] += ',';
  return chomp([...lines.slice(0, close), ...rows, ...lines.slice(close)].join('\n'));
};

/**
 * site.sidebar's groups after the built-in ones in <clone>, rebuilt from the
 * app's copy on every run so a second build holds them once. The app itself
 * is never touched: the central copy builds it and never reads the setting.
 * @param {string} clone
 * @returns {(() => void)|null} the restore of the app's bytes, null when nothing was merged
 */
const mergeSidebar = (clone) => {
  const app = towerApp();
  if (physical(clone) === app) return null;
  const raw = siteSidebar();
  if (!raw) return null;
  const rows = sidebarRows(raw);
  if (!rows) {
    warn('sidebar: site.sidebar is not a list of groups; the built-in sidebar is published');
    return null;
  }
  const text = app ? file(app, SIDEBAR_REL) : null;
  if (text === null) {
    warn(`sidebar: the app's ${SIDEBAR_REL} could not be read; ${nativePath(clone)} keeps its own sidebar`);
    return null;
  }
  const merged = spliceSidebar(text, rows);
  if (merged === null) {
    warn(`sidebar: the app's ${SIDEBAR_REL} does not end in its links list; the built-in sidebar is published`);
    return null;
  }
  const target = path.join(clone, SIDEBAR_REL);
  const restore = () => {
    const original = file(app, SIDEBAR_REL);
    try {
      fs.writeFileSync(target, original ?? '');
      if (original !== null) return;
    } catch {
      // Named below, as an app copy that could not be read is.
    }
    warn(`sidebar: could not put the app's ${SIDEBAR_REL} back in ${nativePath(clone)}`);
  };
  fs.writeFileSync(target, `${merged}\n`);
  return restore;
};

/**
 * The project's dependencies, installed from inside it with `cd -P`, never
 * `--prefix`: the folder may be a link, and a prefixed npm keys the tree from
 * the caller's cwd.
 * @param {string} dir
 * @param {{stdio?: *}} [options] spawn's stdio for npm, the terminal's by default
 * @returns {number} 0, or npm's own code for a failed install
 */
const install = (dir, { stdio } = {}) => {
  const cwd = physical(dir);
  return runProgram('npm', ['install'], { cwd, env: { PWD: cwd }, stdio });
};

/**
 * The brand assets, minted at the brand root, the mirror of the build. A call
 * can exit 0 and mint nothing, and the pages reference the minted logo
 * unconditionally.
 * @param {string} dir
 * @param {{stdio?: *}} [options] spawn's stdio for omega, the terminal's by default
 * @returns {number} 0, omega's own code for a failed mint, 1 for no logo
 */
const mint = (dir, { stdio } = {}) => {
  const cwd = path.resolve(dir);
  const code = runProgram(path.join(cwd, 'node_modules', '.bin', 'omega'), ['manage', '--service=assets'], { cwd, env: { PWD: cwd }, stdio });
  if (code !== 0) return code;
  if (!isDir(path.join(cwd, '.omega', 'assets', 'logo'))) {
    writeErr(`build: the mint left no logo at ${nativePath(dir)}/.omega/assets/logo\n`);
    return 1;
  }
  return 0;
};

/**
 * The site, built in the target, since `omega build` belongs to the web
 * package; the prefix is the path the site serves at. The app's sidebar is
 * back in the clone after the build, failed or not.
 * @param {string} dir
 * @param {string} prefix
 * @param {{stdio?: *}} [options] spawn's stdio for npm, the terminal's by default
 * @returns {number} 0, npm's own code for a failed build, 1 for no output
 */
const build = (dir, prefix, { stdio } = {}) => {
  const restore = mergeSidebar(dir);
  try {
    const code = runProgram('npm', ['--prefix', path.join(dir, 'targets', 'web'), 'run', 'build'], { env: { OMEGA_PATH_PREFIX: prefix }, stdio });
    if (code !== 0) return code;
    if (!isDir(path.join(dir, 'targets', 'web', 'dist'))) {
      writeErr(`build: the build left no output at ${nativePath(dir)}/targets/web/dist\n`);
      return 1;
    }
    return 0;
  } finally {
    if (restore) restore();
  }
};

/**
 * The usage line, with what was wrong, and code 2.
 * @param {string} why
 * @returns {number}
 */
const usage = (why) => {
  writeErr(`usage: build.js <install|mint|build> <project dir> [path prefix]; ${why}\n`);
  return 2;
};

/**
 * The program: one verb on one project folder.
 * @param {string[]} args
 * @returns {number} 0, a failed step's code, 2 for a usage error
 */
const main = ([verb = '', dir = '', prefix = '']) => {
  if (!['install', 'mint', 'build'].includes(verb)) return usage(`unknown verb '${verb}'`);
  if (!dir) return usage('no project dir');
  if (!isDir(dir)) return usage(`no folder at ${nativePath(dir)}`);
  if (verb === 'install') return install(dir);
  if (verb === 'mint') return mint(dir);
  if (!prefix) return usage('no path prefix');
  return build(dir, prefix);
};

module.exports = {
  install, mint, build, spliceSidebar, sidebarRows, SIDEBAR_REL,
};

if (require.main === module) {
  // An end signal waits for the step in hand and its sidebar restore, then ends
  // the program. Set the code, never process.exit(): exiting discards output
  // still buffered for a pipe; a code the hold's end set (Windows) stays.
  const { holdSignals } = require('../lib/interrupt');
  const hold = holdSignals();
  const code = main(process.argv.slice(2));
  hold.end().then(() => { process.exitCode ??= code; });
}
