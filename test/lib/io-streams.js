/**
 * The streams a case hands a terminal question of workflow/lib/flows.js in place of the process's own: a stdin
 * holding the input, ended unless kept open, and a stderr that keeps what it was told. Consumers:
 * test/scripts/flows.test.js and test/hooks/twins.test.js.
 */

const { PassThrough, Writable } = require('stream');

/**
 * `io` for a flows.js call, and what its stderr was told so far.
 * @param {string} [input] what the stdin holds
 * @param {{tty?: boolean, open?: boolean}} [opts] a stdin that reads as a terminal; a stdin left open after the input
 * @returns {{io: {stdin: PassThrough, stderr: Writable}, said: Function}}
 */
const ioOf = (input = '', { tty = false, open = false } = {}) => {
  const stdin = new PassThrough();
  if (tty) stdin.isTTY = true;
  if (open) stdin.write(input);
  else stdin.end(input);
  let said = '';
  const stderr = new Writable({
    write(chunk, _encoding, done) {
      said += chunk.toString();
      done();
    },
  });
  return { io: { stdin, stderr }, said: () => said };
};

module.exports = { ioOf };
