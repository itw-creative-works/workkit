/**
 * jobs/lib/task-scheduler.js: the Windows half of jobs/install.js, the 9am job
 * as a Task Scheduler task: the task file rendered and encoded for `schtasks`,
 * its registration, and the `--check` against the copy kept of the registered
 * file. The copy is the "installed" mark, as the plist is on a Mac. Its XML
 * escape is the plist's too.
 * Usage: const { escaped, renderTask, installTask, checkTask, copyPath } = require('./lib/task-scheduler');
 */

const fs = require('fs');
const path = require('path');
const { codeOf } = require('../../workflow/lib/detach');
const { isFile } = require('../../workflow/lib/lock');
const { spawnSync } = require('../../workflow/lib/run');
const { lastErrLine } = require('../../workflow/lib/say');
const { withScratch } = require('../../workflow/lib/scratch');
const { spin } = require('../../workflow/lib/spin');
const { writeWhole } = require('../../workflow/lib/write');
const { holds, skippedLine } = require('./schedule');

// The Task Scheduler folder every kit task is registered in.
const TASK_FOLDER = 'workkit';

const XML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};

/** A task's full name: `workkit\<label>`, the `\` a folder to `schtasks`. */
const taskName = (label) => `${TASK_FOLDER}\\${label}`;

/** `value` as XML text: each of `&<>"'` escaped. */
const escaped = (value) => String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/**
 * The task file's text: `template` with `{{NODE}}`, `{{HOME}}` and `{{USER}}`
 * replaced in one pass, each value escaped for XML. Pure.
 * @param {string} template
 * @param {{node: string, home: string, user: string}} values
 * @returns {string}
 */
const renderTask = (template, { node, home, user }) => {
  const values = { NODE: node, HOME: home, USER: user };
  return template.replace(/\{\{(NODE|HOME|USER)\}\}/g, (_, key) => escaped(values[key]));
};

/** The bytes `schtasks /xml` reads: the byte order mark `FF FE`, then `text` as UTF-16LE. */
const encodeTask = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

/** The copy kept of a registered task file, under the machine folder `dir`. */
const copyPath = (label, dir) => path.join(dir, 'scheduled', `${label}.xml`);

/** A `schtasks` call, hidden and its output dropped; the shell's code it ended with. */
const schtasks = (message, args, env) => codeOf(spin(message, () => spawnSync('schtasks', args, {
  env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
}), { line: false }));

/**
 * `schtasks /create` of `text`, from a scratch file in the form it reads, removed
 * after; stdout dropped, stderr read for the reason a refusal gives.
 * @returns {{code: number, reason: string}}
 * @throws {Error} when no scratch folder can be made
 */
const register = (label, text, env) => {
  const res = withScratch((scratch) => {
    const file = path.join(scratch, `${label}.xml`);
    fs.writeFileSync(file, encodeTask(text), { mode: 0o600 });
    return spin(`registering ${label}`, () => spawnSync('schtasks', ['/create', '/tn', taskName(label), '/xml', file, '/f'], {
      env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
    }), { line: false });
  }, 'workkit-install.');
  if (res === null) throw new Error('install: no scratch folder could be made for the task file');
  // A start that failed has no stderr to read.
  return { code: codeOf(res), reason: lastErrLine(res) };
};

/** The answer and its line; the installer says it. */
const said = (code, line) => ({ code, line });

/**
 * Register the task only when its file changed or the task is gone; the copy
 * is written after a `/create` that answered 0, so a failed one is tried again.
 * @param {{label: string, text: string, copy: string, when: string, scheduleOk: boolean, env?: object}} run
 *   `when` is the schedule, as a person reads it
 * @returns {{code: number, line: string}}
 */
const installTask = ({
  label, text, copy, when, scheduleOk, env = process.env,
}) => {
  if (!scheduleOk) return said(0, skippedLine(label, 'register it'));
  const current = holds(copy, text);
  if (current && schtasks(`reading ${label}`, ['/query', '/tn', taskName(label)], env) === 0) {
    return said(0, `${label} → already installed`);
  }
  const { code, reason } = register(label, text, env);
  if (code !== 0) return said(code, `${label} → the task was not registered (schtasks exit ${code}${reason ? `: ${reason}` : ''})`);
  if (current) return said(0, `${label} → registered again (task file unchanged)`);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  writeWhole(copy, text);
  return said(0, `${label} → installed (${when})`);
};

/**
 * The drift question against the copy, starting no program: one line for a
 * task not installed or out of date, else the empty string.
 * @param {{label: string, text: string, copy: string}} run
 * @returns {{line: string}}
 */
const checkTask = ({ label, text, copy }) => {
  let line = '';
  if (!isFile(copy)) line = `${label} → not installed`;
  else if (!holds(copy, text)) line = `${label} → out of date for this kit`;
  return { line };
};

module.exports = {
  TASK_FOLDER, taskName, escaped, renderTask, encodeTask, copyPath, installTask, checkTask,
};
