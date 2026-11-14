// The case deadline's wrap: Node's `test` or `it` with a default `timeout`, in
// every call form Node takes. The door builds its `test` and `it` from it.

const isOptions = (value) => value !== null && typeof value === 'object';

// The arguments with `timeout: ms` in the options a case states none in: the
// options come first when the name does not, else second, made when absent.
const withTimeout = (args, ms) => {
  const at = typeof args[0] === 'function' || isOptions(args[0]) ? 0 : 1;
  const given = args[at];
  if (isOptions(given)) return given.timeout === undefined ? args.with(at, { ...given, timeout: ms }) : args;
  if (typeof given === 'function') return args.toSpliced(at, 0, { timeout: ms });
  if (given === undefined || given === null) return args.length > at ? args.with(at, { timeout: ms }) : [...args, { timeout: ms }];
  return args;
};

/**
 * Node's `word` (its `test` or `it`), where a case that states no `timeout`
 * gets `ms`; one that states its own keeps it. Every property Node's word
 * carries (`.skip`, `.todo`, `.only`, `.mock` and the rest) is Node's own,
 * its lazy getters kept lazy.
 * @param {Function} word
 * @param {number} ms
 * @returns {Function}
 */
export const withDeadline = (word, ms) => Object.defineProperties(
  (...args) => word(...withTimeout(args, ms)),
  Object.getOwnPropertyDescriptors(word),
);
