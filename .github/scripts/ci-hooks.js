#!/usr/bin/env node
// .github/scripts/ci-hooks.js <event> [repo]: ci.yml's ciSetup and ciPostInstall steps. Runs each
// hooks.<event> entry of the repo's .workkit/settings.json (commandsOf) through `bash -c` from the
// repo root in order, on PATH's Node, not the kit's; the first failure names it and exits with its
// code. No file or key runs nothing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../../workflow/lib/run');
const { readOrNull } = require('../../workflow/lib/read');
const { isDir } = require('../../workflow/lib/lock');
const { sayAs } = require('../../workflow/lib/say');
const { exitOf } = require('../../workflow/lib/detach');
const { HooksError, commandsOf } = require('../../workflow/ship/entries');
const { isPlain } = require('../../hooks/mods/settings.js');

const PREFIXES = { ciSetup: 'ci-setup', ciPostInstall: 'ci-post-install' };
const SETTINGS = '.workkit/settings.json';

/** One line on stdout, written to the fd so it lands before a child's output that follows it. */
const out = (line) => fs.writeSync(1, `${line}\n`);

/**
 * The entries the repo declares for the event, or a line saying why none can run.
 * @returns {{entries: {command: string, local: boolean}[]}|{fault: string}}
 */
const entriesOf = (root, event) => {
  const text = readOrNull(path.join(root, SETTINGS));
  if (text === null || text.trim() === '') return { entries: [] };
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    return { fault: `${SETTINGS} is not valid JSON: ${err.message}` };
  }
  if (!isPlain(settings)) return { fault: `${SETTINGS} is not a JSON object` };
  if (settings.hooks === undefined || settings.hooks === null) return { entries: [] };
  if (!isPlain(settings.hooks)) return { fault: `hooks in ${SETTINGS} is not an object` };
  if (settings.hooks[event] === undefined || settings.hooks[event] === null) return { entries: [] };
  try {
    return { entries: commandsOf(settings, event) };
  } catch (err) {
    if (!(err instanceof HooksError)) throw err;
    return { fault: err.message };
  }
};

const main = (argv) => {
  const [event, dir = '.'] = argv;
  if (!Object.hasOwn(PREFIXES, event ?? '')) {
    sayAs('ci-hooks')(`the event is ciSetup or ciPostInstall, got: ${event || 'none'}`);
    return 1;
  }
  const say = sayAs(PREFIXES[event]);
  const root = path.resolve(dir);
  if (!isDir(root)) {
    sayAs('ci-hooks')(`${dir} is no folder`);
    return 1;
  }
  const found = entriesOf(root, event);
  if (found.fault) {
    say(found.fault);
    return 1;
  }
  for (const { command, local } of found.entries) {
    if (local) {
      out(`${PREFIXES[event]}: skipped, local only: ${command}`);
      continue;
    }
    out(`::group::${PREFIXES[event]}: ${command}`);
    // By name through a shell, so the command finds PATH's Node; stdin stays the step's own.
    const res = spawnSync('bash', ['-c', command], { cwd: root, stdio: 'inherit' });
    out('::endgroup::');
    const code = exitOf(res.status, res.signal);
    if (code !== 0) {
      say(`failed: ${command}`);
      return code;
    }
  }
  return 0;
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
