// The env a child node runs under when it starts a suite file or a run of its own.
// Node marks a run inside its own test file with NODE_TEST_CONTEXT: a suite started
// under it prints a binary stream, and a run() under it runs nothing, so it goes.
// WORKKIT_TEST_SUMMARY and WORKKIT_TEST_NO_MATCH go too, so no fixture run writes to their files.

/**
 * This process's env less NODE_TEST_CONTEXT, WORKKIT_TEST_SUMMARY and WORKKIT_TEST_NO_MATCH, `extra` over it.
 * @param {object} [extra] - more of the child's env, kept whole
 * @returns {object}
 */
const aloneEnv = (extra = {}) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.WORKKIT_TEST_SUMMARY;
  delete env.WORKKIT_TEST_NO_MATCH;
  return { ...env, ...extra };
};

module.exports = { aloneEnv };
