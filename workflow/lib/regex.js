/**
 * workflow/lib/regex.js: the engine's regex escape, a literal text made safe
 * inside a built RegExp. CJS, requiring nothing, so a hook mod outside the
 * load set of hooks/register.js may import it; one inside that set keeps its own.
 * Usage: const { escapeRegex } = require('../lib/regex');
 */

/**
 * The text with every regex metacharacter escaped.
 * @param {string} text
 * @returns {string} a regex source that matches the text alone
 */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegex };
