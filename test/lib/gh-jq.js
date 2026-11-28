// The `--jq` the suite's fake gh answers with, in Node: a path (`.login`,
// `.a.b`), an index (`.[0]`), an array's iteration (`.[]`, `.check_runs[]`) and a
// closing `// empty`, printed as gh prints them. A module only: the fake gh
// answers `--jq` in its own process.

// One step of a path: `.name`, `.[N]`, or `.[]` (`[]` without its dot only after a step).
const STEP = /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|\.\[(\d+)\]|(\.?)\[\])/;
const EMPTY_TAIL = /\s*\/\/\s*empty$/;

const refuse = (expr, why) => { throw new Error(`the stub does not serve --jq ${expr}${why ? `: ${why}` : ''}`); };

/** `expr` read into its steps and whether it closes on `// empty`; any other shape throws naming it. */
const parse = (expr) => {
  const orEmpty = EMPTY_TAIL.test(expr);
  let rest = expr.replace(EMPTY_TAIL, '').trim();
  const steps = [];
  while (rest) {
    const m = STEP.exec(rest);
    if (!m || (m[3] === '' && !steps.length)) refuse(expr);
    if (m[1] !== undefined) steps.push({ key: m[1] });
    else if (m[2] !== undefined) steps.push({ index: Number(m[2]) });
    else steps.push({ each: true });
    rest = rest.slice(m[0].length);
  }
  if (!steps.length) refuse(expr);
  return { steps, orEmpty };
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every value one step makes of `v`, as jq makes them; a step jq would refuse throws. */
const apply = (expr, step, v) => {
  if (step.key !== undefined) {
    if (v === null) return [null];
    if (!isObject(v)) refuse(expr, `cannot index ${JSON.stringify(v)} with "${step.key}"`);
    return [v[step.key] === undefined ? null : v[step.key]];
  }
  if (step.index !== undefined) {
    if (v === null) return [null];
    if (!Array.isArray(v)) refuse(expr, `cannot index ${JSON.stringify(v)} with ${step.index}`);
    return [v[step.index] === undefined ? null : v[step.index]];
  }
  if (Array.isArray(v)) return v;
  if (isObject(v)) return refuse(expr, 'iterating an object');
  return refuse(expr, `cannot iterate over ${JSON.stringify(v)}`);
};

const sortedKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])]));
};

/**
 * `value` through `--jq expr` as gh prints it, one line per result: a string raw,
 * null as an empty line, any other value compact with sorted keys; `// empty`
 * prints nothing for null or false.
 * @param {string} expr
 * @param {*} value - parsed JSON
 * @returns {string}
 */
const ghJq = (expr, value) => {
  const { steps, orEmpty } = parse(expr);
  let results = [value];
  for (const step of steps) results = results.flatMap((v) => apply(expr, step, v));
  if (orEmpty) results = results.filter((v) => v !== null && v !== false);
  return results.map((v) => {
    if (v === null) return '\n';
    return typeof v === 'string' ? `${v}\n` : `${JSON.stringify(sortedKeys(v))}\n`;
  }).join('');
};

module.exports = { ghJq };
