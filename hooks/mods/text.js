/**
 * hooks/mods/text.js: the small text rules the hooks module and the engine's
 * Node files share, one home for both: the mods import it, the engine
 * `require()`s it.
 */

/**
 * The text without its trailing newlines, as a shell's `$(...)` takes a
 * program's output; null or undefined reads as ''.
 * @param {*} text the text
 * @returns {string}
 */
export const chomp = (text) => String(text ?? '').replace(/\n+$/, '');
