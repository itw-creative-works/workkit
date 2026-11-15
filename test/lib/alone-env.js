// The env a child node runs under when it starts a suite file or a run of its own.
// Node marks a run inside its own test file with NODE_TEST_CONTEXT: a suite started
// under it prints a binary stream, and a run() under it runs nothing, so it goes.
// A proof's WORKKIT_TEST_SUMMARY goes too, so no fixture run writes to its file.

/**
 * This process's env less NODE_TEST_CONTEXT and WORKKIT_TEST_SUMMARY, `extra` over it.
 * @param {object} [extra] - more of the child's env, kept whole
 * @returns {object}
 */
const aloneEnv = (extra = {}) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.WORKKIT_TEST_SUMMARY;
  return { ...env, ...extra };
};

module.exports = { aloneEnv };
