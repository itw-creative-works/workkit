/**
 * workflow/lib/child-end.js: the wait on a child as a shell waits on its
 * foreground command: INT held off while it runs (the terminal gave it to the
 * child too), HUP and TERM passed on to it, and its end read as a shell's code.
 * A child that died by INT ends this process as by that INT, as bash does.
 * Usage: const { childEnd } = require('../lib/child-end');
 */

const { exitOf } = require('./detach');

/** INT raised on this process, as bash does after its foreground child died by it: <end> answered only if a handler lets the process live. */
const raiseInt = (resolve, end) => {
  if (process.listenerCount('SIGINT') > 0) {
    // A signal's watcher holds no process open, so this keeps it until the handlers ran.
    const keep = setInterval(() => {}, 1000);
    process.once('SIGINT', () => {
      clearInterval(keep);
      resolve(end);
    });
  }
  process.kill(process.pid, 'SIGINT');
};

/**
 * A child's end, waited on as a shell waits on its foreground command. When
 * the child died by INT, the INT is raised on this process once the wait lets
 * go: its own INT handlers run, and with none it dies by the signal. A child
 * that caught INT and exited by itself is answered as any end.
 * @param {object} child the child, as `spawn` of lib/run.js answers it
 * @param {{reraise?: boolean}} [options] reraise false answers an INT death as its code (the command log's own wait)
 * @returns {Promise<{code: number, signal: string|null}>} the child's code (a
 *   signal's as 128 + its number), and the HUP or TERM this process caught
 * @throws {Error} a child that could not be started
 */
const childEnd = (child, { reraise = true } = {}) => new Promise((resolve, reject) => {
  let caught = null;
  const hold = () => {};
  const passOn = (signal) => {
    caught = signal;
    child.kill(signal);
  };
  const release = () => {
    process.removeListener('SIGINT', hold);
    process.removeListener('SIGHUP', passOn);
    process.removeListener('SIGTERM', passOn);
  };
  process.on('SIGINT', hold);
  process.on('SIGHUP', passOn);
  process.on('SIGTERM', passOn);
  child.on('error', (err) => {
    release();
    reject(err);
  });
  child.on('close', (code, signal) => {
    release();
    const end = { code: exitOf(code, signal), signal: caught };
    if (signal === 'SIGINT' && reraise) raiseInt(resolve, end);
    else resolve(end);
  });
});

module.exports = { childEnd };
