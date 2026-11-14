// The env a child node runs under when it starts a suite file or a run of its own.
// Node marks a run inside its own test file with NODE_TEST_CONTEXT: a suite started
// under it prints a binary stream, and a run() under it runs nothing, so it goes.

/**
 * This process's env with `extra` over it, NODE_TEST_CONTEXT dropped.
 * @param {object} [extra] - more of the child's env
 * @returns {object}
 */
const aloneEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

module.exports = { aloneEnv };
