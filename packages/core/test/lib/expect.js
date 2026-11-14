// `expect(actual, message?)`: Jest's matchers, names and behaviour, for any suite
// on this package. A failed matcher throws an AssertionError carrying `actual` and
// `expected`; `expect.extend` is the one way to add a matcher. Imports nothing.

class AssertionError extends Error {
  constructor(message, actual, expected) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

const FORMS = ['not', 'resolves', 'rejects'];
const extensions = Object.create(null);

const tagOf = (value) => Object.prototype.toString.call(value);
const isNumber = (value) => typeof value === 'number' || typeof value === 'bigint';

// Own enumerable keys, symbols included; `ownKeys` leaves out an array's indexes.
const enumerableKeys = (obj) => Reflect.ownKeys(obj).filter((key) => Object.prototype.propertyIsEnumerable.call(obj, key));
const ownKeys = (obj) => enumerableKeys(obj).filter((key) => !(Array.isArray(obj) && typeof key === 'string' && /^\d+$/.test(key)));

const showKey = (key) => {
  if (typeof key === 'symbol') return `[${String(key)}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
};

/** One value as a message shows it: strings quoted, `-0` kept, nesting cut at depth 3. */
const show = (value, depth = 0, seen = []) => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object' || value === null) return String(value);
  if (seen.includes(value)) return '[Circular]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  const name = value.constructor?.name;
  if (depth >= 3) return Array.isArray(value) ? '[Array]' : `[${name || 'Object'}]`;
  const inner = (item) => show(item, depth + 1, [...seen, value]);
  if (value instanceof Map) return `Map {${[...value].map(([key, item]) => `${inner(key)} => ${inner(item)}`).join(', ')}}`;
  if (value instanceof Set) return `Set {${[...value].map(inner).join(', ')}}`;
  if (Array.isArray(value)) return `[${value.map(inner).join(', ')}]`;
  const body = ownKeys(value).map((key) => `${showKey(key)}: ${inner(value[key])}`).join(', ');
  return `${name && name !== 'Object' ? `${name} ` : ''}{${body ? ` ${body} ` : ''}}`;
};

// Deep equality by value. Loose, an undefined property or array item equals a
// missing one; `strict` is toStrictEqual's: those, an array's length and holes,
// and the prototype all count.
const equals = (a, b, strict, pairs = []) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const pair = pairs.find(([x, y]) => x === a || y === b);
  if (pair) return pair[0] === a && pair[1] === b;
  const deeper = [...pairs, [a, b]];
  const same = (x, y) => equals(x, y, strict, deeper);

  if (tag === '[object Date]') return Object.is(a.getTime(), b.getTime());
  if (tag === '[object RegExp]') return a.source === b.source && a.flags === b.flags;
  if (['[object Number]', '[object String]', '[object Boolean]'].includes(tag)) return Object.is(a.valueOf(), b.valueOf());
  if (tag === '[object Map]') {
    return a.size === b.size && [...a].every(([key, item]) => (b.has(key)
      ? same(item, b.get(key))
      : [...b].some(([other, value]) => same(key, other) && same(item, value))));
  }
  if (tag === '[object Set]') {
    return a.size === b.size && [...a].every((item) => b.has(item) || [...b].some((other) => same(item, other)));
  }
  if (tag === '[object Error]' && (a.name !== b.name || a.message !== b.message)) return false;
  if (strict && Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (strict && (i in a) !== (i in b)) return false;
      if (!same(a[i], b[i])) return false;
    }
  }
  const keysOf = (obj) => (strict ? ownKeys(obj) : enumerableKeys(obj)).filter((key) => strict || obj[key] !== undefined);
  const keys = keysOf(a);
  return keys.length === keysOf(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
};

// toMatchObject's test: every property `expected` names is in `actual`, recursively;
// an array matches only an array of its length.
const subset = (actual, expected) => {
  if (typeof expected !== 'object' || expected === null) return equals(actual, expected, false);
  if (typeof actual !== 'object' || actual === null) return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => subset(actual[i], item));
  }
  if (tagOf(expected) !== '[object Object]') return equals(actual, expected, false);
  return ownKeys(expected).every((key) => key in actual && subset(actual[key], expected[key]));
};

const messageOf = (thrown) => (typeof thrown?.message === 'string' ? thrown.message : String(thrown));

const compare = (verb, test) => (actual, [expected]) => {
  if (!isNumber(actual) || !isNumber(expected)) return { error: 'expected a number' };
  return { pass: test(actual, expected), verb, expected };
};

// Each built-in returns { pass, verb, expected?, text?, detail?, actual? } or
// { error }: a misuse that fails under `.not` too. `text` replaces the shown expected.
const builtins = {
  toBe: (actual, [expected]) => ({ pass: Object.is(actual, expected), verb: 'be', expected }),
  toEqual: (actual, [expected]) => ({ pass: equals(actual, expected, false), verb: 'equal', expected }),
  toStrictEqual: (actual, [expected]) => ({ pass: equals(actual, expected, true), verb: 'strictly equal', expected }),
  toMatchObject: (actual, [expected]) => {
    if (typeof actual !== 'object' || actual === null) return { error: 'expected an object' };
    if (typeof expected !== 'object' || expected === null) return { error: 'expected an object to match' };
    return { pass: subset(actual, expected), verb: 'match', expected };
  },
  toBeTruthy: (actual) => ({ pass: Boolean(actual), verb: 'be truthy' }),
  toBeFalsy: (actual) => ({ pass: !actual, verb: 'be falsy' }),
  toBeDefined: (actual) => ({ pass: actual !== undefined, verb: 'be defined' }),
  toBeUndefined: (actual) => ({ pass: actual === undefined, verb: 'be undefined' }),
  toBeNull: (actual) => ({ pass: actual === null, verb: 'be null' }),
  toBeNaN: (actual) => ({ pass: Number.isNaN(actual), verb: 'be NaN' }),
  toContain: (actual, [expected]) => {
    if (typeof actual === 'string') {
      if (typeof expected !== 'string') return { error: 'expected a string' };
      return { pass: actual.includes(expected), verb: 'contain', expected };
    }
    if (typeof actual?.[Symbol.iterator] !== 'function') return { error: 'expected a string or an iterable' };
    // `indexOf` is Jest's strict `===`: NaN is never found.
    return { pass: Array.from(actual).indexOf(expected) !== -1, verb: 'contain', expected };
  },
  toHaveLength: (actual, [expected]) => {
    if (typeof actual?.length !== 'number') return { error: 'expected a value with a length' };
    if (!Number.isInteger(expected) || expected < 0) return { error: 'expected a whole number' };
    return { pass: actual.length === expected, verb: 'have length', expected, detail: `, its length is ${actual.length}` };
  },
  toHaveProperty: (actual, args) => {
    const [keyPath, value] = args;
    if (actual === undefined || actual === null) return { error: 'expected a value' };
    if (typeof keyPath !== 'string' && !(Array.isArray(keyPath) && keyPath.length > 0)) return { error: 'expected a path' };
    const keys = Array.isArray(keyPath) ? keyPath : String(keyPath).replace(/\[(\w+)\]/g, '.$1').replace(/^\./, '').split('.');
    let node = actual;
    let found = true;
    for (const key of keys) {
      if (node === undefined || node === null || !(key in Object(node))) {
        found = false;
        break;
      }
      node = node[key];
    }
    const withValue = args.length > 1;
    return {
      pass: found && (!withValue || equals(node, value, false)),
      verb: 'have property',
      expected: withValue ? value : keyPath,
      text: `${show(keyPath)}${withValue ? ` with value ${show(value)}` : ''}`,
    };
  },
  toMatch: (actual, [expected]) => {
    if (typeof actual !== 'string') return { error: 'expected a string' };
    if (typeof expected !== 'string' && !(expected instanceof RegExp)) return { error: 'expected a string or a RegExp' };
    const pass = expected instanceof RegExp ? actual.search(expected) !== -1 : actual.includes(expected);
    return { pass, verb: 'match', expected };
  },
  toBeInstanceOf: (actual, [expected]) => {
    if (typeof expected !== 'function') return { error: 'expected a class' };
    return { pass: actual instanceof expected, verb: 'be an instance of', expected, text: expected.name || 'anonymous' };
  },
  toBeGreaterThan: compare('be greater than', (a, b) => a > b),
  toBeGreaterThanOrEqual: compare('be greater than or equal to', (a, b) => a >= b),
  toBeLessThan: compare('be less than', (a, b) => a < b),
  toBeLessThanOrEqual: compare('be less than or equal to', (a, b) => a <= b),
  toBeCloseTo: (actual, [expected, digits = 2]) => {
    if (typeof actual !== 'number' || typeof expected !== 'number') return { error: 'expected a number' };
    const pass = (actual === expected) || Math.abs(expected - actual) < 10 ** -digits / 2;
    return { pass, verb: 'be close to', expected };
  },
  toBeTypeOf: (actual, [expected]) => ({ pass: typeof actual === expected, verb: 'be of type', expected }),
  // Under `.resolves` or `.rejects` the settled value is the thrown error, as in
  // Jest, and a value that is no Error counts as nothing thrown.
  toThrow: (actual, args, how) => {
    let threw = Boolean(how.promise) && (actual instanceof Error || tagOf(actual) === '[object Error]');
    let thrown = threw ? actual : undefined;
    if (!how.promise) {
      if (typeof actual !== 'function') return { error: 'expected a function' };
      try {
        actual();
      } catch (err) {
        threw = true;
        thrown = err;
      }
    }
    const [expected] = args;
    const message = messageOf(thrown);
    const matches = expected === undefined ? true
      : typeof expected === 'string' ? message.includes(expected)
        : expected instanceof RegExp ? message.search(expected) !== -1
          : typeof expected === 'function' ? thrown instanceof expected
            : message === messageOf(expected);
    const text = typeof expected === 'function' ? expected.name || 'anonymous' : show(expected);
    return {
      pass: threw && matches,
      verb: 'throw',
      ...(expected === undefined ? {} : { expected, text }),
      detail: how.promise && threw ? '' : `, it threw ${threw ? show(thrown) : 'nothing'}`,
      actual: thrown,
    };
  },
};

const raise = (text, how, actual, expected) => {
  throw new AssertionError(how.message ? `${how.message}: ${text}` : text, actual, expected);
};

const verdict = (result, received, how) => {
  if (result.error) raise(result.error, how, received, undefined);
  if (result.pass !== how.isNot) return;
  const shown = 'text' in result || 'expected' in result ? ` ${result.text ?? show(result.expected)}` : '';
  const actual = 'actual' in result ? result.actual : received;
  raise(`expected ${show(received)} ${how.isNot ? 'not to' : 'to'} ${result.verb}${shown}${result.detail ?? ''}`, how, actual, result.expected);
};

// One matcher run. An extension may return its verdict in a promise, as in Jest.
const judge = (name, actual, args, how) => {
  if (Object.hasOwn(builtins, name)) return verdict(builtins[name](actual, args, how), actual, how);
  const settle = ({ pass, message }) => {
    if (Boolean(pass) === how.isNot) raise(message(), how, actual, args[0]);
  };
  const outcome = extensions[name].call({ isNot: how.isNot, promise: how.promise }, actual, ...args);
  return typeof outcome?.then === 'function' ? outcome.then(settle) : settle(outcome);
};

const names = () => [...Object.keys(builtins), ...Object.keys(extensions)];

const matchers = (actual, how) => Object.fromEntries(names().map((name) => [name, (...args) => judge(name, actual, args, how)]));

// The value a promise settles to, or the AssertionError naming how it settled
// when that is not the way `promise` (`resolves` or `rejects`) asks for. As in Jest,
// only `.rejects` calls a function to get its promise.
const settled = async (actual, how) => {
  const target = typeof actual === 'function' && how.promise === 'rejects' ? actual() : actual;
  if (typeof target?.then !== 'function') raise('expected a promise', how, target, undefined);
  const [rejected, value] = await target.then((result) => [false, result], (err) => [true, err]);
  if (rejected && how.promise === 'resolves') raise(`expected the promise to resolve, it rejected with ${show(value)}`, how, value, undefined);
  if (!rejected && how.promise === 'rejects') raise(`expected the promise to reject, it resolved with ${show(value)}`, how, value, undefined);
  return value;
};

const awaited = (actual, message, promise) => {
  const forms = (isNot) => {
    const how = { message, isNot, promise };
    return Object.fromEntries(names().map((name) => [name, async (...args) => judge(name, await settled(actual, how), args, how)]));
  };
  return { ...forms(false), get not() { return forms(true); } };
};

/**
 * The matchers for one value. `message`, when given, leads every failure as `<message>: `.
 * @param {*} actual
 * @param {string} [message]
 */
export const expect = (actual, message) => ({
  ...matchers(actual, { message, isNot: false, promise: '' }),
  get not() { return matchers(actual, { message, isNot: true, promise: '' }); },
  get resolves() { return awaited(actual, message, 'resolves'); },
  get rejects() { return awaited(actual, message, 'rejects'); },
});

/** Fail on the spot: throws the AssertionError with `message`. */
expect.fail = (message) => {
  throw new AssertionError(message, undefined, undefined);
};

/**
 * Add matchers, each `(actual, ...args) => ({ pass, message })`, `message` a function
 * returning the failure text. A name a built-in matcher or form holds throws.
 * @param {Record<string, Function>} added
 */
expect.extend = (added) => {
  for (const [name, matcher] of Object.entries(added)) {
    if (Object.hasOwn(builtins, name) || FORMS.includes(name)) throw new Error(`expect.extend: ${name} is a built-in matcher`);
    if (typeof matcher !== 'function') throw new Error(`expect.extend: ${name} is not a function`);
  }
  Object.assign(extensions, added);
};
