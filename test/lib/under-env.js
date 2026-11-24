// The one home for "run this with these keys laid on this process's env": a
// case that calls a job's function in process, under a world's env, gets it here.

/**
 * `fn` awaited with `over` laid on this process's env, every key put back after.
 * @param {object} over - the keys to lay on, each a string
 * @param {Function} fn - sync or async
 * @returns {Promise<*>} what `fn` returned or resolved with
 */
const underEnv = async (over, fn) => {
  const saved = {};
  for (const [key, value] of Object.entries(over)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

module.exports = { underEnv };
