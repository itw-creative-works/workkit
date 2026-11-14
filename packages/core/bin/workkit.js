#!/usr/bin/env node
/* eslint-disable no-console */
// The package's `workkit` bin, the one npm puts first on PATH inside `npm test`:
// `workkit test [paths]` runs the test runner over the current folder,
// `workkit tools` prints what its suites need and `workkit convert [paths...]`
// moves old-shape suites onto Node's test functions. Every other verb belongs
// to the global `workkit` command, so it exits 2 naming it.

import { main } from '../test/run.js';
import { main as tools } from '../test/tools.js';
import { main as convert } from '../test/convert.js';

const [verb, ...args] = process.argv.slice(2);

if (verb === 'test') {
  main(args);
} else if (verb === 'tools') {
  tools(args);
} else if (verb === 'convert') {
  convert(args);
} else {
  // The global command's error shape (wk_error): `✖ <verb>: <message>`.
  const named = verb === undefined ? 'workkit' : `workkit ${verb}`;
  console.error(`✖ ${verb ?? 'workkit'}: workkit-core's bin runs only \`workkit test [paths]\`, \`workkit tools\` and \`workkit convert [paths...]\`; \`${named}\` belongs to the global workkit command (the workkit plugin's workflow/workkit.sh)`);
  process.exitCode = 2;
}
