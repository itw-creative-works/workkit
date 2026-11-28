#!/usr/bin/env node
// .github/scripts/ci-env.js <node|temp>: a value the later steps of a job read, appended to the file
// GITHUB_ENV names. `node` sets WORKKIT_NODE, the Node that runs this script, which the kit's scripts
// run on; `temp` sets TEMP and TMPDIR to the runner's long-form temp dir (RUNNER_TEMP).

const { sayAs, writeErr } = require('../../workflow/lib/say');
const { appendTo } = require('../../workflow/lib/step-value');

const USAGE = 'usage: ci-env.js <node|temp>';

/**
 * The lines one word sets, a line saying why it cannot, or null for a word that names none.
 * @param {string|undefined} word
 * @returns {{lines: string}|{fault: string}|null}
 */
const linesOf = (word) => {
  if (word === 'node') return { lines: `WORKKIT_NODE=${process.execPath}\n` };
  if (word !== 'temp') return null;
  const temp = process.env.RUNNER_TEMP;
  if (!temp) return { fault: 'RUNNER_TEMP names no folder' };
  return { lines: `TEMP=${temp}\nTMPDIR=${temp}\n` };
};

const main = (argv) => {
  const found = linesOf(argv[0]);
  if (found === null) {
    writeErr(`${USAGE}\n`);
    return 1;
  }
  if (found.fault) {
    sayAs('ci-env')(found.fault);
    return 1;
  }
  return appendTo('ci-env', 'GITHUB_ENV', found.lines);
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
