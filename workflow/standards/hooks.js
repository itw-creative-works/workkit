/**
 * workflow/standards/hooks.js: the once-a-day assertion that the hook layer
 * beside the engine is alive (`workflow/README.md` § The hook layer
 * self-check). A step of the heal.
 * Usage: const { checkHookLayer } = require('./hooks');
 */

const { isFile } = require('../lib/lock');
const { onPath, spawnSync } = require('../lib/run');
const { skip, warn } = require('../lib/voice');
const { flag } = require('./flag');
const { chomp } = require('../../hooks/mods/text.js');

// The tools the guards run on. Without node a checked commit and a guarded git
// verb stop on one line and gh does not start, so a missing one is named first.
const HOOK_TOOLS = ['git', 'node'];

// The import node runs; the module's path rides argv, so node builds the file URL.
const LOAD = 'const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);';

// An error's own line, which names the cause; a missing import's first line is node's internals.
const ERROR_LINE = /^[A-Za-z]*Error( \[[A-Z_]+\])?:/;

/**
 * Whether the hooks module loads the way node loads it, which pulls in every
 * module under hooks/mods/. False with no module or no node to try it with
 * (the tool warning names a missing node); a module that fails flags the run.
 * @param {{hooksDir: string, needsAttention: boolean}} run
 * @returns {boolean}
 */
const checkHookModule = (run) => {
  const module = `${run.hooksDir}/register.js`;
  if (!isFile(module) || onPath('node') === null) return false;
  const res = spawnSync('node', ['--no-warnings', '--input-type=module', '-e', LOAD, module], {
    encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (res.status === 0) return true;
  const lines = chomp((res.stderr ?? '').replace(/\r/g, '')).split('\n');
  const line = lines.find((each) => ERROR_LINE.test(each)) ?? lines[0];
  flag(run, `hooks: the hooks module fails to load: ${line}`);
  return false;
};

/**
 * The hooks module loads and the tools the hooks call are present. No hook
 * layer beside the engine is the engine installed on its own, not a broken
 * install; a missing tool warns without flagging the run, since no repo can fix it.
 * @param {{hooksDir: string, needsAttention: boolean}} run
 */
const checkHookLayer = (run) => {
  if (!isFile(`${run.hooksDir}/hooks.json`)) return;
  const missing = HOOK_TOOLS
    .filter((name) => onPath(name) === null)
    .map((name) => ` ${name}`)
    .join('');
  if (missing !== '') {
    warn(`hooks: the hook layer needs${missing} on PATH; without node a checked commit and a guarded git verb stop on one line, and gh does not start`);
  }
  if (checkHookModule(run)) skip('hooks: the hooks module loads');
};

module.exports = { checkHookLayer };
