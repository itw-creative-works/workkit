/**
 * workflow/workkit/links.js: the pointers this command keeps on the machine:
 * the engine's address (asked of standards.js, which owns it), the
 * `~/.local/bin/workkit` command and on Windows its `workkit.cmd`, the
 * `~/.local/bin/gh` shim, and the order `machineLinks` makes them in with npm's
 * script-shell and the kit's allow rules.
 * Usage: const { machineLinks, reportBinLink, linkCommand, renderCmd, reportCmdLink, pathLine, GH_SHIM_OURS } = require('./links');
 */

const fs = require('fs');
const path = require('path');
const { nodeRead } = require('./kit');
const { scriptShell, windowsPath } = require('./npm-shell');
const { keepAllowRules } = require('./allow');
const {
  ok, skip, info, warn, plain, quiet,
} = require('../lib/voice');
const { nativePath, physicalDir, cloneOutranks } = require('../lib/platform');
const { link, isLink } = require('../lib/link');
const { isFile, isDir } = require('../lib/lock');
const { keyOf } = require('../lib/run');
const { writeWhole } = require('../lib/write');
const { readOrNull } = require('../lib/read');

// A gh link naming any workkit kit's shim is the kit's to repoint; any other is a human's.
const GH_SHIM_OURS = /\/workflow\/identity\/gh$/;

/** The text a link holds, or null for no link. */
const readLink = (address) => {
  try {
    return fs.readlinkSync(address);
  } catch {
    return null;
  }
};

/** A path's text with `\` made `/`, so one rule reads either spelling. */
const slashed = (p) => p.replace(/\\/g, '/');

/**
 * The engine's address kept by standards.js's `--engine-link`, whose engine
 * lines are re-said under this command's glyph; silence is read back, so a
 * refusal never reads as current.
 * @param {object} kit
 * @returns {number} 0
 */
const refreshEngineLink = (kit) => {
  const { standards } = kit.files;
  // A missing engine is a broken checkout, never a current machine.
  if (!isFile(standards)) {
    warn(`engine: standards.js is missing at ${nativePath(standards)}; the kit is incomplete, so the engine address cannot be maintained`);
    return 0;
  }
  const res = nodeRead(kit, standards, ['--engine-link', kit.root]);
  if (res.code !== 0) {
    warn(`engine: the address step could not run (exit ${res.code}); run \`node ${nativePath(standards)} --engine-link ${nativePath(kit.root)}\` to see why`);
    return 0;
  }
  const lines = plain(res.stderr).split('\n').filter((line) => line.startsWith('engine:'));
  if (lines.length > 0) {
    for (const line of lines) ok(line);
    return 0;
  }
  const linked = physicalDir(kit.engineLink);
  const address = nativePath(kit.engineLink);
  if (isLink(kit.engineLink) && linked === kit.engine) skip(`engine: ${address} is current`);
  else if (isLink(kit.engineLink) && linked && cloneOutranks(kit.root, linked)) skip(`engine: ${address} is current: it names the workkit clone at ${nativePath(linked)}, which outranks the plugin cache`);
  else skip(`engine: ${address} was left as it is; this engine does not take the address`);
  return 0;
};

/**
 * Whether <address> names <target>, or the same file in a workkit clone that
 * outranks the plugin cache: the link's text ends in <target>'s path below
 * this kit, and what comes before it is the clone's root.
 */
const binLinkCurrent = (kit, target, address) => {
  const current = readLink(address);
  if (current === null) return false;
  if (current === target) return true;
  const root = `${slashed(kit.root)}/`;
  const tail = `/${slashed(target).startsWith(root) ? slashed(target).slice(root.length) : slashed(target)}`;
  const text = slashed(current);
  return text.endsWith(tail) && cloneOutranks(kit.root, text.slice(0, -tail.length));
};

/** Whether <address> is a link whose text misses <ours>: a human's, warned and left. */
const binLinkForeign = (address, label, ours) => {
  const current = ours ? readLink(address) : null;
  if (current === null || ours.test(slashed(current))) return false;
  warn(`${label}: ${nativePath(address)} is someone else's link to ${nativePath(current)}; move it aside, then re-run \`workkit update\``);
  return true;
};

/**
 * A ~/.local/bin link kept at <target>: one elsewhere is repointed (a moved
 * checkout), a real file or a link missing <ours> is a human's and only
 * reported. The link is made through lib/link.js, judged by what the address
 * resolves to afterwards.
 * @returns {number} 1 when the address was left alone: no ~/.local/bin on the quiet path, or a human's
 */
const keepBinLink = (kit, target, address, label, ours) => {
  // The quiet path creates no ~/.local/bin, the restraint the engine shows with ~/.claude.
  if (quiet() && !isDir(kit.binDir)) return 1;
  let verb = 'linked';
  if (isLink(address)) {
    const current = readLink(address);
    if (current === target) {
      skip(`${label}: ${nativePath(address)} is current`);
      return 0;
    }
    if (binLinkCurrent(kit, target, address)) {
      skip(`${label}: ${nativePath(address)} is current: it names the workkit clone's ${nativePath(current)}, which outranks the plugin cache`);
      return 0;
    }
    if (binLinkForeign(address, label, ours)) return 1;
    verb = 'repointed';
  } else if (fs.existsSync(address)) {
    warn(`${label}: ${nativePath(address)} is a real file; move it aside, then re-run \`workkit update\``);
    return 1;
  } else {
    try {
      fs.mkdirSync(kit.binDir, { recursive: true });
    } catch { /* the link that follows fails too */ }
  }
  if (link(target, address)) ok(`${label}: ${verb} ${nativePath(address)} → ${nativePath(target)}`);
  return 0;
};

/**
 * doctor's line for a ~/.local/bin link, <ours> as keepBinLink takes it.
 * @param {object} kit
 * @param {string} target
 * @param {string} address
 * @param {string} label
 * @param {RegExp} [ours] GH_SHIM_OURS for the gh shim; none for the command
 * @returns {number} 1 when it needs attention
 */
const reportBinLink = (kit, target, address, label, ours) => {
  if (binLinkCurrent(kit, target, address)) {
    ok(`${label}: ${nativePath(address)} → ${nativePath(readLink(address))}`);
    return 0;
  }
  if (!binLinkForeign(address, label, ours)) warn(`${label}: ${nativePath(address)} is missing or points elsewhere; run \`workkit update\``);
  return 1;
};

/**
 * Whether PATH holds <dir>, read as the kit's system reads it: split on that
 * system's separator, each folder compared with either slash and no trailing
 * one, case folded on Windows alone.
 */
const pathHolds = (kit, dir) => {
  const windows = kit.platform === 'win32';
  const searchPath = kit.env[keyOf(kit.env, 'PATH') ?? 'PATH'] || '';
  const folded = (p) => {
    const spelled = slashed(p).replace(/\/+$/, '');
    return windows ? spelled.toLowerCase() : spelled;
  };
  const delimiter = windows ? path.win32.delimiter : path.posix.delimiter;
  return searchPath.split(delimiter).some((entry) => folded(entry) === folded(nativePath(dir)));
};

/**
 * The line naming ~/.local/bin when PATH lacks it, or null when PATH holds
 * it: setup's two-line hint (an info), or doctor's one line (a warning). On
 * Windows the folder in its Windows form, to add in Windows' own settings.
 * @param {object} kit
 * @param {'doctor'} [mode]
 * @returns {string|null}
 */
const pathLine = (kit, mode) => {
  if (pathHolds(kit, kit.binDir)) return null;
  if (kit.platform === 'win32') {
    return `command: ${windowsPath(kit.binDir)} is not on your PATH; add it to your user PATH in Windows' settings (Edit environment variables for your account)`;
  }
  const dir = nativePath(kit.binDir);
  if (mode === 'doctor') return `command: ${dir} is not on your PATH; add \`export PATH="$HOME/.local/bin:$PATH"\` to your shell rc`;
  return `command: ${dir} is not on your PATH; add it to your shell rc:\n    export PATH="$HOME/.local/bin:$PATH"`;
};

// The command's old entry, the shell one, below a kit's root.
const OLD_ENTRY = '/workflow/workkit.sh';

/**
 * The entry the command link should name: a link to a workkit clone's old
 * workkit.sh, where that clone outranks this kit, keeps its clone and names
 * the clone's workkit.js; any other names this kit's.
 */
const commandTarget = (kit) => {
  const current = readLink(kit.binLink);
  if (current === null || !slashed(current).endsWith(OLD_ENTRY)) return kit.files.entry;
  const clone = current.slice(0, -OLD_ENTRY.length);
  return cloneOutranks(kit.root, clone) ? `${current.slice(0, -'.sh'.length)}.js` : kit.files.entry;
};

/**
 * ~/.local/bin/workkit → the kit's workkit.js, any link elsewhere (an old
 * workkit.sh's included) repointed, an outranking clone's old one to that
 * clone's workkit.js; then the PATH line when ~/.local/bin is not on PATH.
 * standards.js --command-link runs this step alone.
 * @param {object} kit
 * @returns {number} 0
 */
const linkCommand = (kit) => {
  if (keepBinLink(kit, commandTarget(kit), kit.binLink, 'command') !== 0) return 0;
  const line = pathLine(kit);
  if (line !== null) info(line);
  return 0;
};

/**
 * The text of `workkit.cmd` from its template: one line naming the engine's
 * workkit.js, ended by a CRLF.
 * @param {string} template the template's text, `{{ENGINE}}` its one slot
 * @param {{engine: string}} slots the engine address in its Windows form
 * @returns {string}
 */
const renderCmd = (template, { engine }) => `${template.replace(/[\r\n]+$/, '').split('{{ENGINE}}').join(engine)}\r\n`;

/** The text workkit.cmd should hold, or null when the template is not there. */
const cmdText = (kit) => {
  const template = readOrNull(kit.files.cmdTemplate);
  return template === null ? null : renderCmd(template, { engine: windowsPath(kit.engineLink) });
};

/**
 * On Windows, ~/.local/bin/workkit.cmd beside the Git Bash link, so cmd and
 * PowerShell find the command: written from the template only when its text
 * differs. Nothing on any other system.
 * @param {object} kit
 * @returns {number} 0
 */
const keepCmdLink = (kit) => {
  if (kit.platform !== 'win32' || (quiet() && !isDir(kit.binDir))) return 0;
  const want = cmdText(kit);
  if (want === null) {
    warn(`command: the template ${nativePath(kit.files.cmdTemplate)} is missing, so ${nativePath(kit.cmdLink)} was not written; the kit is incomplete`);
    return 0;
  }
  if (readOrNull(kit.cmdLink) === want) {
    skip(`command: ${nativePath(kit.cmdLink)} is current`);
    return 0;
  }
  try {
    fs.mkdirSync(kit.binDir, { recursive: true });
    writeWhole(kit.cmdLink, want);
  } catch {
    warn(`command: could not write ${nativePath(kit.cmdLink)}; run \`workkit update\` again`);
    return 0;
  }
  ok(`command: wrote ${nativePath(kit.cmdLink)} for cmd and PowerShell`);
  return 0;
};

/**
 * doctor's line for workkit.cmd on Windows; nothing on any other system.
 * @param {object} kit
 * @returns {number} 1 when it needs attention
 */
const reportCmdLink = (kit) => {
  if (kit.platform !== 'win32') return 0;
  const want = cmdText(kit);
  if (want !== null && readOrNull(kit.cmdLink) === want) {
    ok(`command: ${nativePath(kit.cmdLink)} is current`);
    return 0;
  }
  warn(`command: ${nativePath(kit.cmdLink)} is missing or differs; run \`workkit update\``);
  return 1;
};

/** ~/.local/bin/gh → identity/gh, the shim that outranks the real gh; only a link into a kit's shim is the kit's. */
const linkGhShim = (kit) => {
  keepBinLink(kit, kit.files.ghShim, kit.ghShimLink, 'gh shim', GH_SHIM_OURS);
  return 0;
};

/**
 * The pointers in their one order, then npm's script-shell and the kit's
 * allow and ask rules, as update, setup and setup --cloud make them.
 * @param {object} kit
 * @returns {number} 0
 */
const machineLinks = (kit) => {
  refreshEngineLink(kit);
  linkCommand(kit);
  keepCmdLink(kit);
  linkGhShim(kit);
  scriptShell(kit);
  keepAllowRules(kit);
  return 0;
};

module.exports = {
  machineLinks, reportBinLink, linkCommand, renderCmd, reportCmdLink, pathLine, GH_SHIM_OURS,
};
