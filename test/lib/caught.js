// The one home for "run this and give me what it threw": a case that reads the
// error itself, rather than asserting with toThrow, gets it here.

/**
 * Call `fn` and await what it returns.
 * @param {Function} fn - sync or async
 * @returns {Promise<*>} the error it threw or rejected with, or null when it returned or resolved
 */
const caught = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
};

module.exports = { caught };
