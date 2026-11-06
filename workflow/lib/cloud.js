// workflow/lib/cloud.js: whether this is a claude.ai/code cloud session, the Node
// twin of `wk_is_cloud` in ./platform.sh.
// Usage: const { isCloud } = require('../lib/cloud');

/**
 * Whether the environment is a cloud session's (`CLAUDE_CODE_REMOTE` is `true`).
 * @param {object} [env] the environment to read, process.env by default
 * @returns {boolean}
 */
const isCloud = (env = process.env) => env.CLAUDE_CODE_REMOTE === 'true';

module.exports = { isCloud };
