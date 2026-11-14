// Tests for the package's own expect, reached through workkit-core/test: each
// matcher passes on a matching value and throws an AssertionError on another.
// A pass is "nothing threw"; a failure is judged by the caught error, never by expect.

const { describe, test, expect } = require('./lib/harness');
const { caught } = require('./lib/caught');

// 'pass' when fn returns or resolves, else the name of the error it threw.
const outcome = async (fn) => {
  try {
    await fn();
    return 'pass';
  } catch (err) {
    return err.name;
  }
};

// The error fn threw or rejected with; the case fails when fn returned or resolved.
const failure = async (fn) => {
  const err = await caught(fn);
  if (err === null) throw new Error('expected a failure, got a return');
  return err;
};

// Each row is [label, a call that must pass, a call that must fail]. The rows that
// did otherwise, one per line, so an empty string means every row held.
const misses = async (rows) => {
  const out = [];
  for (const [label, passes, fails] of rows) {
    const onPass = await outcome(passes);
    const onFail = await outcome(fails);
    if (onPass !== 'pass' || onFail !== 'AssertionError') out.push(`${label}: ${onPass} / ${onFail}`);
  }
  return out.join('\n');
};

// Each row is [label, a call that must throw an AssertionError]. The rows that did
// otherwise, one per line with what they gave, so an empty string means every row held.
const unrefused = async (rows) => {
  const out = [];
  for (const [label, fails] of rows) {
    const got = await outcome(fails);
    if (got !== 'AssertionError') out.push(`${label}: ${got}`);
  }
  return out.join('\n');
};

// A promise rejected with reason. The catch keeps a case that throws before expect
// awaits it from ending the process; the promise itself stays rejected.
const rejecting = (reason) => {
  const promise = Promise.reject(reason);
  promise.catch(() => {});
  return promise;
};

describe('expect: a failed matcher and its message', () => {
  test('toBe(1) on 1 passes; toBe(2) on 1 throws an AssertionError carrying actual and expected', async () => {
    expect(1).toBe(1);
    const err = await failure(() => expect(1).toBe(2));
    expect(err instanceof Error, 'the failure is an Error').toBeTruthy();
    expect(err.name, 'name').toBe('AssertionError');
    expect(err.message, 'message').toBe('expected 1 to be 2');
    expect(err.actual, 'actual').toBe(1);
    expect(err.expected, 'expected').toBe(2);
  });

  test('.not reads "not to", and a given message goes in front', async () => {
    const negated = await failure(() => expect(1).not.toBe(1));
    expect(negated.message, 'the .not message').toBe('expected 1 not to be 1');
    const labelled = await failure(() => expect(1, 'count').toBe(2));
    expect(labelled.message, 'the labelled message').toBe('count: expected 1 to be 2');
  });
});

describe('expect: the matchers', () => {
  test('toBe holds NaN to NaN and tells 0 from -0', async () => {
    expect(NaN).toBe(NaN);
    const err = await failure(() => expect(0).toBe(-0));
    expect(err.name, '0 toBe -0').toBe('AssertionError');
  });

  test('toEqual ignores an undefined key and compares arrays, Date, RegExp, Map and Set by value', async () => {
    expect(await misses([
      ['an undefined key', () => expect({ a: 1, b: undefined }).toEqual({ a: 1 }), () => expect({ a: 1, b: undefined }).toEqual({ a: 2 })],
      ['nested arrays', () => expect([[1, [2]]]).toEqual([[1, [2]]]), () => expect([[1, [2]]]).toEqual([[1, [3]]])],
      ['a Date', () => expect(new Date(0)).toEqual(new Date(0)), () => expect(new Date(0)).toEqual(new Date(1))],
      ['a RegExp', () => expect(/a/g).toEqual(/a/g), () => expect(/a/g).toEqual(/a/i)],
      ['a Map', () => expect(new Map([['a', 1]])).toEqual(new Map([['a', 1]])), () => expect(new Map([['a', 1]])).toEqual(new Map([['a', 2]]))],
      ['a Set', () => expect(new Set([1, 2])).toEqual(new Set([1, 2])), () => expect(new Set([1, 2])).toEqual(new Set([1, 3]))],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('toStrictEqual counts an undefined key and a class instance against a plain object', async () => {
    class Point {
      constructor() {
        this.a = 1;
      }
    }
    expect(await misses([
      ['an undefined key', () => expect({ a: 1 }).toStrictEqual({ a: 1 }), () => expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 })],
      ['a class instance', () => expect(new Point()).toStrictEqual(new Point()), () => expect(new Point()).toStrictEqual({ a: 1 })],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('toEqual holds an undefined array item equal to a missing one; toStrictEqual does not', async () => {
    const passing = [
      ['[undefined] toEqual []', () => expect([undefined]).toEqual([])],
      ['[1, undefined] toEqual [1]', () => expect([1, undefined]).toEqual([1])],
      ['[] toEqual [undefined]', () => expect([]).toEqual([undefined])],
    ];
    const unpassed = [];
    for (const [label, call] of passing) {
      const got = await outcome(call);
      if (got !== 'pass') unpassed.push(`${label}: ${got}`);
    }
    expect(unpassed.join('\n'), 'calls that did not pass').toBe('');
    expect(await unrefused([
      ['[1] toEqual [1, 2]', () => expect([1]).toEqual([1, 2])],
      ['[undefined, 1] toEqual [1]', () => expect([undefined, 1]).toEqual([1])],
      ['[undefined] toStrictEqual []', () => expect([undefined]).toStrictEqual([])],
      ['[1, undefined] toStrictEqual [1]', () => expect([1, undefined]).toStrictEqual([1])],
      ['[] toStrictEqual [undefined]', () => expect([]).toStrictEqual([undefined])],
    ]), 'calls that did not throw an AssertionError').toBe('');
  });

  test('toMatchObject passes on a superset and throws on a differing value', async () => {
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
    const err = await failure(() => expect({ a: 2 }).toMatchObject({ a: 1 }));
    expect(err.name, '{ a: 2 } toMatchObject { a: 1 }').toBe('AssertionError');
  });

  test('toContain finds an array item by identity, a substring and a Set member', async () => {
    const item = { a: 1 };
    expect(await misses([
      ['an array item', () => expect([item]).toContain(item), () => expect([item]).toContain({ a: 1 })],
      ['a substring', () => expect('hello').toContain('ell'), () => expect('hello').toContain('xyz')],
      ['a Set member', () => expect(new Set([1])).toContain(1), () => expect(new Set([1])).toContain(2)],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('toContain holds a string to strings only, and an array item and a Set member to ===', async () => {
    expect(await unrefused([
      ["'a1' toContain 1", () => expect('a1').toContain(1)],
      ['[NaN] toContain NaN', () => expect([NaN]).toContain(NaN)],
      ['Set [NaN] toContain NaN', () => expect(new Set([NaN])).toContain(NaN)],
    ]), 'calls that did not throw an AssertionError').toBe('');
  });

  test('toHaveLength(2) holds for an array and a string', async () => {
    expect(await misses([
      ['an array', () => expect([1, 2]).toHaveLength(2), () => expect([1]).toHaveLength(2)],
      ['a string', () => expect('ab').toHaveLength(2), () => expect('a').toHaveLength(2)],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('toHaveProperty takes a dotted path, a key array and a value', async () => {
    const value = { a: { b: 3 } };
    expect(value).toHaveProperty('a.b');
    expect(value).toHaveProperty(['a', 'b']);
    expect(value).toHaveProperty('a.b', 3);
    const err = await failure(() => expect(value).toHaveProperty('a.b', 4));
    expect(err.name, "toHaveProperty('a.b', 4)").toBe('AssertionError');
  });

  test('toHaveProperty refuses a path that is no string or array, and an empty array, under .not too', async () => {
    const value = { a: 1 };
    const refusals = [
      ['a number path', () => expect(value).toHaveProperty(1), (message) => message.includes('expected a path')],
      ['a number path under .not', () => expect(value).not.toHaveProperty(1), (message) => message.includes('expected a path')],
      ['an object path', () => expect(value).toHaveProperty({}), (message) => message.includes('expected a path')],
      ['an empty array', () => expect(value).toHaveProperty([]), (message) => message === 'expected a path'],
      ['an empty array under .not', () => expect(value).not.toHaveProperty([]), (message) => message === 'expected a path'],
    ];
    const out = [];
    for (const [label, call, holds] of refusals) {
      const err = await caught(call);
      if (err?.name !== 'AssertionError' || !holds(err.message)) out.push(`${label}: ${err ? `${err.name} (${err.message})` : 'pass'}`);
    }
    expect(out.join('\n'), 'calls that did not throw an AssertionError saying expected a path').toBe('');
  });

  test('toMatch takes a substring and a RegExp', async () => {
    expect(await misses([
      ['a substring', () => expect('hello').toMatch('ell'), () => expect('hello').toMatch('xyz')],
      ['a RegExp', () => expect('hello').toMatch(/^h/), () => expect('hello').toMatch(/^e/)],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('toMatch refuses an expected value that is no string or RegExp, under .not too', async () => {
    const out = [];
    for (const [label, call] of [
      ["'1' toMatch(1)", () => expect('1').toMatch(1)],
      ["'undefined' toMatch(undefined)", () => expect('undefined').toMatch(undefined)],
      ["'hello' not.toMatch(undefined)", () => expect('hello').not.toMatch(undefined)],
    ]) {
      const err = await caught(call);
      if (err?.name !== 'AssertionError' || !err.message.includes('expected a string or a RegExp')) out.push(`${label}: ${err ? `${err.name} (${err.message})` : 'pass'}`);
    }
    expect(out.join('\n'), 'calls that did not throw an AssertionError saying expected a string or a RegExp').toBe('');
  });

  test('toBeCloseTo holds 0.1 + 0.2 to 0.3', async () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    const err = await failure(() => expect(0.4).toBeCloseTo(0.3));
    expect(err.name, '0.4 toBeCloseTo 0.3').toBe('AssertionError');
  });

  test('the truthiness, defined, null and NaN matchers each pass for their own value only', async () => {
    expect(await misses([
      ['toBeTruthy', () => expect(1).toBeTruthy(), () => expect(0).toBeTruthy()],
      ['toBeFalsy', () => expect(0).toBeFalsy(), () => expect(1).toBeFalsy()],
      ['toBeDefined', () => expect(0).toBeDefined(), () => expect(undefined).toBeDefined()],
      ['toBeUndefined', () => expect(undefined).toBeUndefined(), () => expect(null).toBeUndefined()],
      ['toBeNull', () => expect(null).toBeNull(), () => expect(undefined).toBeNull()],
      ['toBeNaN', () => expect(NaN).toBeNaN(), () => expect(1).toBeNaN()],
    ]), 'rows that did not pass on their value and throw on another').toBe('');
  });

  test('the four comparisons, toBeInstanceOf and toBeTypeOf each pass on a match only', async () => {
    expect(await misses([
      ['toBeGreaterThan', () => expect(2).toBeGreaterThan(1), () => expect(1).toBeGreaterThan(1)],
      ['toBeGreaterThanOrEqual', () => expect(2).toBeGreaterThanOrEqual(2), () => expect(1).toBeGreaterThanOrEqual(2)],
      ['toBeLessThan', () => expect(1).toBeLessThan(2), () => expect(2).toBeLessThan(2)],
      ['toBeLessThanOrEqual', () => expect(2).toBeLessThanOrEqual(2), () => expect(3).toBeLessThanOrEqual(2)],
      ['toBeInstanceOf', () => expect(new TypeError('x')).toBeInstanceOf(Error), () => expect({}).toBeInstanceOf(Error)],
      ['toBeTypeOf', () => expect('x').toBeTypeOf('string'), () => expect(1).toBeTypeOf('string')],
    ]), 'rows that did not pass on a match and throw on a mismatch').toBe('');
  });

  test('a misused matcher under .not still throws an AssertionError', async () => {
    expect(await unrefused([
      ["[1] not.toHaveLength('1')", () => expect([1]).not.toHaveLength('1')],
      ["undefined not.toHaveProperty('a')", () => expect(undefined).not.toHaveProperty('a')],
      ['1 not.toMatchObject({})', () => expect(1).not.toMatchObject({})],
      ["'a2' not.toContain(1)", () => expect('a2').not.toContain(1)],
      ["1 not.toBeGreaterThan('a')", () => expect(1).not.toBeGreaterThan('a')],
    ]), 'calls that did not throw an AssertionError').toBe('');
  });

  test('toThrow with no argument, a string, a RegExp and a class passes on a matching error only', async () => {
    const throwsPart = () => {
      throw new TypeError('a part of it');
    };
    const throwsOther = () => {
      throw new RangeError('something else');
    };
    const returns = () => 1;
    expect(await misses([
      ['toThrow() with nothing thrown', () => expect(throwsPart).toThrow(), () => expect(returns).toThrow()],
      ['toThrow(string) on another error', () => expect(throwsPart).toThrow('part'), () => expect(throwsOther).toThrow('part')],
      ['toThrow(string) with nothing thrown', () => expect(throwsPart).toThrow('part'), () => expect(returns).toThrow('part')],
      ['toThrow(RegExp) on another error', () => expect(throwsPart).toThrow(/part/), () => expect(throwsOther).toThrow(/part/)],
      ['toThrow(RegExp) with nothing thrown', () => expect(throwsPart).toThrow(/part/), () => expect(returns).toThrow(/part/)],
      ['toThrow(class) on another error', () => expect(throwsPart).toThrow(TypeError), () => expect(throwsOther).toThrow(TypeError)],
      ['toThrow(class) with nothing thrown', () => expect(throwsPart).toThrow(TypeError), () => expect(returns).toThrow(TypeError)],
    ]), 'rows that did not pass on a match and throw an AssertionError otherwise').toBe('');
  });

  test('toThrow on a value that is no function throws "expected a function"', async () => {
    const err = await failure(() => expect(1).toThrow());
    expect(err.name, 'name').toBe('AssertionError');
    expect(err.message.includes('expected a function'), `message: ${err.message}`).toBeTruthy();
  });
});

describe('expect: promises', () => {
  test('.resolves and .rejects apply the matcher to the settled value', async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1);
    await expect(rejecting(new Error('x'))).rejects.toThrow('x');
    const resolved = await failure(() => expect(Promise.resolve(1)).resolves.toBe(2));
    expect(resolved.name, '.resolves.toBe(2) on 1').toBe('AssertionError');
    const rejected = await failure(() => expect(rejecting(new Error('x'))).rejects.toThrow('y'));
    expect(rejected.name, ".rejects.toThrow('y') on x").toBe('AssertionError');
  });

  test('.resolves refuses a function, and .rejects calls one for its promise', async () => {
    const onFunction = await failure(() => expect(() => Promise.resolve(1)).resolves.toBe(1));
    expect(onFunction.name, '.resolves on a function').toBe('AssertionError');
    await expect(() => Promise.reject(new Error('x'))).rejects.toThrow('x');
  });

  test('.rejects.toThrow on a rejection that is no Error throws an AssertionError, and passes under .not', async () => {
    expect(await unrefused([
      ["a string rejection, toThrow('str')", () => expect(rejecting('str')).rejects.toThrow('str')],
      ['an undefined rejection, toThrow()', () => expect(rejecting(undefined)).rejects.toThrow()],
    ]), 'calls that did not throw an AssertionError').toBe('');
    await expect(rejecting('str')).rejects.not.toThrow();
  });

  test('.not after .resolves and .rejects negates the matcher on the settled value', async () => {
    await expect(Promise.resolve(1)).resolves.not.toBe(2);
    await expect(rejecting(new Error('x'))).rejects.not.toThrow('y');
    const err = await failure(() => expect(Promise.resolve(1)).resolves.not.toBe(1));
    expect(err.name, 'name').toBe('AssertionError');
    expect(err.message, 'message').toBe('expected 1 not to be 1');
  });

  test('.resolves on a rejection and .rejects on a resolution each throw an AssertionError naming what happened', async () => {
    const onReject = await failure(() => expect(rejecting(new Error('x'))).resolves.toBe(1));
    expect(onReject.name, '.resolves on a rejection').toBe('AssertionError');
    expect(onReject.message.includes('rejected'), `.resolves on a rejection: ${onReject.message}`).toBeTruthy();
    const onResolve = await failure(() => expect(Promise.resolve(1)).rejects.toThrow('x'));
    expect(onResolve.name, '.rejects on a resolution').toBe('AssertionError');
    expect(onResolve.message.includes('resolved'), `.rejects on a resolution: ${onResolve.message}`).toBeTruthy();
  });
});

describe('expect: fail and extend', () => {
  test("expect.fail('stop') throws an AssertionError whose message is stop", async () => {
    const err = await failure(() => expect.fail('stop'));
    expect(err.name, 'name').toBe('AssertionError');
    expect(err.message, 'message').toBe('stop');
  });

  test('an extended matcher passes, fails with its own message, and fails under .not', async () => {
    expect.extend({
      toBeEven: (actual) => ({ pass: actual % 2 === 0, message: () => `${actual} is odd` }),
    });
    expect(2).toBeEven();
    const odd = await failure(() => expect(3).toBeEven());
    expect(odd.name, 'toBeEven on 3').toBe('AssertionError');
    expect(odd.message, 'toBeEven on 3').toBe('3 is odd');
    const negated = await failure(() => expect(2).not.toBeEven());
    expect(negated.name, 'not.toBeEven on 2').toBe('AssertionError');
  });

  test('an extended matcher reads this.isNot: true under .not, false without', async () => {
    const seen = [];
    expect.extend({
      toSeeNot() {
        seen.push(this.isNot);
        return { pass: this.isNot, message: () => 'm' };
      },
    });
    const negated = await failure(() => expect(1).not.toSeeNot());
    const plain = await failure(() => expect(1).toSeeNot());
    expect(seen.join(','), 'isNot as the matcher saw it, under .not then without').toBe('true,false');
    expect(negated.message, 'not.toSeeNot message').toBe('m');
    expect(plain.message, 'toSeeNot message').toBe('m');
  });

  test("an extended matcher reads this.promise: '' plain, then resolves, then rejects", async () => {
    const seen = [];
    expect.extend({
      toSeePromise() {
        seen.push(this.promise);
        return { pass: true, message: () => 'm' };
      },
    });
    expect(1).toSeePromise();
    await expect(Promise.resolve(1)).resolves.toSeePromise();
    await expect(rejecting(new Error('x'))).rejects.toSeePromise();
    expect(JSON.stringify(seen), 'promise as the matcher saw it').toBe('["","resolves","rejects"]');
  });

  test('extend refuses a built-in name, naming it, and toBe stays the built-in', async () => {
    const err = await failure(() => expect.extend({ toBe() {} }));
    expect(err.message.includes('toBe'), `message: ${err.message}`).toBeTruthy();
    const still = await failure(() => expect(1).toBe(2));
    expect(still.message, 'toBe after the refused extend').toBe('expected 1 to be 2');
  });
});
