//
// The `gh` answers the tower suites fake, in one place.
//
// tower/api/lib/*.js reaches GitHub through a single exec seam, so a suite
// exercising a limit, a refusal or a plain response builds the bytes `gh` would
// have printed. Four suites needed the same bytes, so the shapes live here: the
// raw `--include` response, the error a non-zero exit throws, and the two `gh`
// stubs a spent budget and a refused token wear.
//
// Usage:
//   const { httpAnswer, execError, resetIn, clockAt, mkLimited, mkRefused } = require('../lib/gh');
//   fetchBoard(ROSTER, { exec: mkLimited(resetIn(18)) });
//

/**
 * What `gh api graphql --include` prints: the status line, the response's own
 * headers, a blank line, then the body. CRLF, as the wire has it, since the
 * split has to survive both endings.
 */
const httpAnswer = (status, headers, body) => [
  `HTTP/2.0 ${status} ${status === 200 ? 'OK' : 'Refused'}`,
  ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  '',
  typeof body === 'string' ? body : JSON.stringify(body),
].join('\r\n');

/**
 * The error execFileSync throws on a non-zero exit: the message, the streams it
 * captured, and the status. `gh api graphql` exits 1 whenever the response
 * carries an errors array - WITH the complete payload on stdout - so this shape
 * is the difference between a partial board and a blank one.
 */
const execError = (message, { stdout = '', stderr = '', status = 1, code = null } = {}) => {
  const err = new Error(message);
  err.stdout = stdout;
  err.stderr = stderr;
  err.status = status;
  if (code) err.code = code;
  return err;
};

/** The epoch SECOND a limit lifting `minutes` from now resets at. */
const resetIn = (minutes) => Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

/** The reader's own clock, which is what the sentence promises to speak in. */
const clockAt = (second) => new Date(second * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * A `gh` answering the live GraphQL rate limit (issue #216): HTTP 200, the
 * budget spent in the headers, and a RATE_LIMIT error where the data would be.
 * gh exits non-zero on an errors array, so it arrives on the error's stdout.
 */
const mkLimited = (reset) => () => {
  throw execError('Command failed: gh api graphql', {
    stdout: httpAnswer(200, {
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(reset),
    }, { errors: [{ type: 'RATE_LIMIT', code: 'graphql_rate_limit', message: 'API rate limit already exceeded for user ID 1.' }] }),
  });
};

/** A `gh` whose token was refused - the same 403 a limit wears, the other problem. */
const mkRefused = () => () => {
  throw execError('Command failed: gh api graphql', {
    stdout: httpAnswer(403, {
      'X-RateLimit-Remaining': '4999',
      'X-RateLimit-Reset': String(resetIn(30)),
    }, { message: 'Bad credentials', status: '403' }),
  });
};

module.exports = { httpAnswer, execError, resetIn, clockAt, mkLimited, mkRefused };
