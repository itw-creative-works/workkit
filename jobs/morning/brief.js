/**
 * jobs/morning/brief.js: the brief on this machine, and the compose and the
 * send both environments share. The scheduled morning hands the day to the
 * cloud; the rehearsal (`--now`) and a prompt compose and send here and
 * publish nothing (jobs/README.md § The morning on this machine).
 * Usage: const { compose, send, localSend, dispatch } = require('./brief');
 */

const path = require('path');
const { codeOf, startFailed } = require('../../workflow/lib/detach');
const { spawnSync } = require('../../workflow/lib/run');
const { writeErr, writeOut } = require('../../workflow/lib/say');
const { spin } = require('../../workflow/lib/spin');
const { dispatchBrief } = require('../brief-dispatch');
const { notify } = require('../lib/machine');
const { block, captured } = require('../lib/notes');

const PAYLOAD = path.join(__dirname, 'brief', 'brief-payload.js');

// A payload or a digest is text, never near this, and a cap must not cut one.
const MAX_BUFFER = 64 * 1024 * 1024;

// The send's rails, written in this one place.
const SEND_RAILS = ['--model', 'haiku', '--effort', 'low', '--safe-mode', '--no-session-persistence', '--tools', '', '--max-budget-usd', '0.25'];

// How much of the message the log block quotes, in characters.
const QUOTED_CHARS = 200;

/** A child's output read whole, stdout and stderr apart, stdin closed. */
const read = (cmd, args) => spawnSync(cmd, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER, windowsHide: true,
});

/**
 * The payload, composed the same way in both environments. Its stderr is kept
 * apart: a crash, or the line naming repos the sweep could not read, belongs
 * in the log and never in what Claude is handed.
 * @returns {{status: number, message: string, err: string}}
 */
const compose = () => {
  const res = read(process.execPath, [PAYLOAD]);
  return { status: codeOf(res), message: captured(res.stdout ?? ''), err: captured(res.stderr ?? '') };
};

/**
 * The send. Its stderr is kept apart: the Actions log must never carry the
 * digest, and the local block carries the error beside the response.
 * @param {string} message
 * @returns {{status: number, response: string, err: string}}
 */
const send = (message) => {
  const res = spin('asking Claude for the brief', () => read('claude', ['-p', message, ...SEND_RAILS]), { line: false });
  const status = codeOf(res);
  // A child that never started (startFailed with no code of its own) said its reason in the error.
  const err = status === startFailed && res.status === null ? res.error.message : (res.stderr ?? '');
  return { status, response: captured(res.stdout ?? ''), err: captured(err) };
};

/**
 * The brief composed and sent here: the rehearsal, or a prompt sent as it is.
 * A payload crash still logs and notifies, and ends the morning with its code.
 * @param {object} run the morning's run
 * @returns {Promise<{status: number}|{stop: number}>} the send's code, or the composer's to stop on
 */
const localSend = async (run) => {
  let message = run.prompt.join(' ');
  if (run.prompt.length === 0) {
    const payload = compose();
    if (payload.status !== 0) {
      block(run.logFile, run.stamp, `[brief-payload exit ${payload.status}]\n${payload.err}\n`);
      notify(`❌ brief-payload exit ${payload.status}; ${payload.err}`, run.notes);
      return { stop: payload.status };
    }
    if (payload.err) run.notes.noteWarn(payload.err);
    message = payload.message;
  }
  const { status, response, err } = send(message);
  const failed = status === 0 ? '' : `[exit ${status}]\n${err ? `${err}\n` : ''}`;
  block(run.logFile, run.stamp, `> ${Array.from(message).slice(0, QUOTED_CHARS).join('')}\n${failed}${response}\n`);
  // The brief leads with its HEADLINE line: that is the notification.
  notify(status === 0 ? response.split('\n')[0] : `❌ exit ${status}; ${err || response}`, run.notes);
  writeOut(`${response}\n`);
  return { status };
};

/**
 * The scheduled morning's brief: the day handed to the cloud. A dispatch that
 * cannot be made is a briefless morning, said in the log and on stderr.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const dispatch = async (run) => {
  const { dispatched, line, reason } = await dispatchBrief();
  if (dispatched) {
    run.notes.note(line);
    writeOut(`${line}\n`);
    return;
  }
  const briefless = `brief: the day could not be handed to the cloud (${reason}); no brief this morning`;
  run.notes.noteWarn(briefless);
  writeErr(`${briefless}\n`);
};

module.exports = {
  compose, send, localSend, dispatch,
};
