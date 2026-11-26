// The `schtasks` stand-in the Task Scheduler suites put first on a PATH: a Node
// program that records each call's arguments, answers by a state the case sets,
// and keeps a copy of the file `/create /xml` named, so a case reads the bytes
// the installer handed it after its scratch file is gone.

const fs = require('fs');
const path = require('path');
const { stubToolJs } = require('./platform');
const { recordArgvJs, readArgv } = require('./argv-log');

/**
 * Write `schtasks` into `dir`. `exists` is whether the task is registered, so
 * `/query` answers 0 (true) or 1 (false); `create` is the code `/create` exits
 * with, and `createErr` what a `/create` that fails writes to stderr. Any other
 * call exits 0.
 * @param {string} dir - the PATH folder, which must exist
 * @param {{ exists?: boolean, create?: number, createErr?: string }} [state]
 * @returns {{ calls: () => string[][], creates: () => string[][], kept: () => Buffer|null, set: Function }}
 *   `set(state)` changes the answers for the calls after it
 */
const schtasksStub = (dir, state = {}) => {
  const log = path.join(dir, 'schtasks-argv.log');
  const stateFile = path.join(dir, 'schtasks-state.json');
  const kept = path.join(dir, 'schtasks-kept.xml');
  const set = (next) => fs.writeFileSync(stateFile, JSON.stringify({
    exists: false, create: 0, createErr: '', ...next,
  }));
  set(state);
  stubToolJs(dir, 'schtasks', [
    "const fs = require('fs');",
    recordArgvJs(JSON.stringify(log), 'process.argv.slice(2)'),
    `const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));`,
    'const args = process.argv.slice(2);',
    "if (args[0] === '/query') process.exitCode = state.exists ? 0 : 1;",
    "if (args[0] === '/create') {",
    `  fs.copyFileSync(args[args.indexOf('/xml') + 1], ${JSON.stringify(kept)});`,
    '  if (state.create !== 0) process.stderr.write(state.createErr);',
    '  process.exitCode = state.create;',
    '}',
  ].join('\n'));
  const calls = () => readArgv(log);
  return {
    calls,
    creates: () => calls().filter((c) => c[0] === '/create'),
    kept: () => (fs.existsSync(kept) ? fs.readFileSync(kept) : null),
    set,
  };
};

module.exports = { schtasksStub };
