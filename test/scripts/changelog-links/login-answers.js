// makeGhStub's answer, run in the fake gh's own process (helpers.js beside it).
// It loads nothing, so the stand-in starts on any PATH a case narrows
// (docs/tests.md § The shape).

/** makeGhStub's answer to every call: the login on its own line, or 1. */
const answerLogin = ({ login, fails }) => {
  if (fails) return 1;
  process.stdout.write(`${login}\n`);
  return 0;
};

module.exports = { answerLogin };
