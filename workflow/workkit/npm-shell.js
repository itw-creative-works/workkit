/**
 * workflow/workkit/npm-shell.js: npm's script-shell pointed at the kit, the
 * wrapper reached through the engine address or, on Windows, the executable
 * built from script-shell.cs into the machine folder, and a path's Windows
 * form, which the machine steps share.
 * Usage: const { scriptShell, scriptShellExe, windowsPath } = require('./npm-shell');
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, onPath } = require('../lib/run');
const {
  ok, skip, warn, quiet,
} = require('../lib/voice');
const { nativePath, physicalPath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { scriptShellExeOf } = require('../../hooks/mods/log.js');
const { chomp } = require('../../hooks/mods/text.js');

// The values npm prints for a script-shell nobody set.
const UNSET = ['', 'null', 'undefined'];

/**
 * A path in its Windows form: its native spelling with every `/` made `\`.
 * @param {string} p
 * @returns {string}
 */
const windowsPath = (p) => nativePath(p).replace(/\//g, '\\');

/** A file's modification time, or null when there is none to read. */
const mtimeOf = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Whether the Windows script shell exists and its source is not newer.
 * @param {object} kit
 * @returns {boolean}
 */
const scriptShellExeCurrent = (kit) => {
  const exe = scriptShellExeOf(kit.env);
  if (!isFile(exe)) return false;
  const source = mtimeOf(path.join(kit.engine, 'script-shell.cs'));
  return source === null || source <= mtimeOf(exe);
};

/**
 * The Windows script shell built with the compiler every Windows ships, when
 * missing or older than its source. The compiler is
 * started directly, every path in its Windows form.
 * @param {object} kit
 * @returns {number} 0 when current or built, 1 after its skip or warning
 */
const scriptShellExe = (kit) => {
  const root = kit.env.SYSTEMROOT || kit.env.SystemRoot || 'C:/Windows';
  const csc = `${root}/Microsoft.NET/Framework64/v4.0.30319/csc.exe`;
  const out = scriptShellExeOf(kit.env);
  if (scriptShellExeCurrent(kit)) return 0;
  if (!isFile(csc)) {
    skip(`npm: no C# compiler at ${nativePath(csc)}, so the Windows script shell cannot be built and script-shell stays unset`);
    return 1;
  }
  const args = ['-nologo', '-optimize', '-target:exe', `-out:${windowsPath(out)}`, windowsPath(path.join(kit.engine, 'script-shell.cs'))];
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
  } catch { /* the compile that follows fails and says so */ }
  const res = spawnSync(csc, args, { stdio: 'ignore', env: kit.env, windowsHide: true });
  if (res.status === 0) {
    ok(`npm: built ${nativePath(out)} from script-shell.cs`);
    return 0;
  }
  warn(`npm: could not build ${nativePath(out)}; run \`${[csc, ...args].join(' ')}\` to see why`);
  return 1;
};

/** npm's script-shell value, a CRLF's half dropped, or null when `npm config get` fails. */
const npmScriptShell = (kit) => {
  const res = spawnSync('npm', ['config', 'get', 'script-shell'], {
    stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8', env: kit.env, windowsHide: true,
  });
  return res.status === 0 ? chomp(res.stdout.replace(/\r/g, '')) : null;
};

/** The unset value set to the kit's, where a human's run may set it. */
const setUnset = (kit, want) => {
  if (quiet()) return 0;
  // The wrapper is reached through the engine link, which a machine with no
  // ~/.claude never gets; on Windows the exe hands every script to it.
  const wrapper = `${kit.engineLink}/script-shell.sh`;
  if (!isFile(wrapper)) {
    skip(`npm: the engine link ${nativePath(kit.engineLink)} is missing or points elsewhere, so the wrapper ${nativePath(wrapper)} is not there to point npm at; script-shell stays unset`);
    return 0;
  }
  const res = spawnSync('npm', ['config', 'set', 'script-shell', want], { stdio: 'ignore', env: kit.env, windowsHide: true });
  if (res.status === 0) ok(`npm: script-shell set to ${want} (a root npm test now records the tree it proved)`);
  else warn(`npm: could not set script-shell; run \`npm config set script-shell ${want}\``);
  return 0;
};

/** Someone else's value, reported and left; an exported one outranks every npmrc, so its fix is the export. */
const foreign = (kit, have, want, doctor) => {
  const note = kit.env.npm_config_script_shell
    ? `npm: script-shell is ${have}, exported as npm_config_script_shell by your shell, and left as it is; drop that export so \`workkit update\` can point npm at the kit`
    : `npm: script-shell is ${have}, set by someone else, and left as it is; \`npm config set script-shell ${want}\` points it at the kit`;
  if (!quiet()) warn(note);
  return doctor ? 1 : 0;
};

/**
 * npm's script-shell kept at the kit's wrapper, named through the engine
 * address, or on Windows the executable that hands each call to it. Only a
 * human's run sets it (never quiet); someone else's value is reported, never replaced.
 * @param {object} kit
 * @param {'doctor'} [mode] doctor reports alone
 * @returns {number} 0, or 1 in doctor when it needs attention
 */
const scriptShell = (kit, mode) => {
  const doctor = mode === 'doctor';
  let want = `${kit.engineLink}/script-shell.sh`;
  if (kit.platform === 'win32') {
    const exe = scriptShellExeOf(kit.env);
    try {
      want = nativePath(exe);
    } catch {
      return 0;
    }
    if (doctor && !scriptShellExeCurrent(kit)) {
      warn(`npm: ${nativePath(exe)} is missing or older than script-shell.cs; run \`workkit update\``);
      return 1;
    }
    if (!doctor && !quiet() && scriptShellExe(kit) !== 0) return 0;
  }
  if (onPath('npm', { env: kit.env }) === null) {
    skip('npm: not on this machine, so there is no script-shell to point at the kit');
    return 0;
  }
  let have = npmScriptShell(kit);
  if (have === null) {
    warn('npm: `npm config get script-shell` failed; run it to see why');
    return doctor ? 1 : 0;
  }
  // The kit's own shell reached through a linked folder is current too, by the gate's physical compare.
  if (have !== want && physicalPath(have) !== null && physicalPath(have) === physicalPath(want)) have = want;
  if (have === want) {
    (doctor ? ok : skip)('npm: script-shell is current');
    return 0;
  }
  if (!UNSET.includes(have)) return foreign(kit, have, want, doctor);
  if (!doctor) return setUnset(kit, want);
  warn('npm: script-shell is not set, so a root `npm test` records nothing; run `workkit update`');
  return 1;
};

module.exports = {
  scriptShell, scriptShellExe, windowsPath,
};
