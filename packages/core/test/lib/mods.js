/**
 * A plugin's own tests as one case of a Node suite: `claude plugin test` over
 * the plugin's folder, started through the kit's program starter, so on
 * Windows a `claude.cmd` npm installed starts too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test } from './cases.js';
import { start } from './spawn.js';
import { suiteDeadline } from './suite-deadline.js';
import { howEnded } from './node-test.js';
import { filesOnPath } from './on-path.js';

// Why the case skips when no file named claude is on the PATH.
const NO_CLAUDE = 'no claude binary on PATH';

// How long before the suite deadline the tool is ended, so its own watchdog reports first:
// room for end()'s ladder (three rungs 1.5 s apart), PIPE_GRACE_MS and the suite's load.
// Half the deadline at most, so a short TEST_DEADLINE still leaves the tool half of it.
const TOOL_GAP = 10000;

// The tool's line for one failed test: `(fail) <name>`, then its time when it gives one.
const FAIL_LINE = /^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/;

// Why the tool's run is no pass: how it ended (a time-out naming the <deadline> it had),
// each failed test it named, then its whole output.
const failureOf = ({ status, signal, timedOut }, output, deadline) => {
  const how = timedOut ? `timed out after ${deadline / 1000}s` : howEnded({ code: status, signal });
  const failed = output.split(/\r?\n/).map((line) => line.match(FAIL_LINE)?.[1]).filter(Boolean);
  const lines = [`claude plugin test ${how}`];
  if (failed.length > 0) lines.push(`failed: ${failed.join(', ')}`);
  if (output.trim() !== '') lines.push(output.trimEnd());
  return new Error(lines.join('\n'));
};

/**
 * One case, `claude plugin test (<the folder's own name>)`, which runs
 * `claude plugin test <folder>` in that folder and passes when it exits 0.
 * Any other end fails it, naming each `(fail)` test, the exit and the output;
 * with no `claude` on the PATH it skips. One case holds the whole tool run, so
 * its deadline is the suite deadline `TEST_DEADLINE` sets, and the tool is
 * ended a little before it, its output kept. A missing folder throws at the call.
 * @param {string} folder the plugin's folder, from the cwd when relative
 * @returns {void}
 */
export const modCase = (folder) => {
  const dir = path.resolve(folder);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`modCase: no folder ${dir}`);
  const { deadline, error } = suiteDeadline();
  if (error !== null) throw new Error(error);
  const toolDeadline = deadline - Math.min(TOOL_GAP, deadline / 2);
  test(`claude plugin test (${path.basename(dir)})`, { timeout: deadline }, async (t) => {
    const tool = start('claude', ['plugin', 'test', dir], { cwd: dir, deadline: toolDeadline });
    let ended;
    try {
      ended = await tool.done;
    } catch (err) {
      // A tool with a pid started, so its rejection (a watchdog end that failed) is no start failure.
      if (tool.pid !== undefined) throw err;
      // A found claude can fail ENOENT too (a `#!` line naming a missing program), so the PATH decides.
      if (filesOnPath('claude').length > 0) throw new Error(`claude did not start: ${err.message}`);
      t.skip(NO_CLAUDE);
      return;
    }
    if (ended.status !== 0 || ended.timedOut) throw failureOf(ended, tool.output(), toolDeadline);
  });
};
