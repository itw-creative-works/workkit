// tower/api/lib/telemetry/pricing.js: what a token costs: the per-million rates
// per model, the counter coercion, the model lookup and the cost of a bundle.
// telemetry.js requires it; no piece requires telemetry.js.

// USD per million tokens per model and counter: Anthropic's published list
// prices, a hand-entered snapshot. Cache rates derive from input (a read 0.1x, a
// write 1.25x at the 5-minute TTL or 2x at 1 hour) unless a row says otherwise.
// sonnet-5 carries its standard rates, never an introductory discount.
const PRICING = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25, cacheCreation1h: 10 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheCreation: 12.5, cacheCreation1h: 20 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25, cacheCreation1h: 10 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25, cacheCreation1h: 2 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1, cacheCreation1h: 1.6 },
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  // The one row whose cache rates are published rather than derived, and they
  // do not match the multipliers: $0.03 where 0.1x would be $0.025, and $0.30
  // where 1.25x would be $0.3125. The published number is the one billed.
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheCreation: 0.3, cacheCreation1h: 0.5 },
};

const MILLION = 1000000;

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

/** A usage counter, coerced: a missing or non-numeric field counts as none. */
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The pricing row for a model id, or null when this table has none. A dated
 * build suffix and a context variant (`[1m]`) are stripped, and a longest-prefix
 * match catches the rest.
 * @param {string|null} model
 * @returns {{input: number, output: number, cacheRead: number, cacheCreation: number}|null}
 */
const priceOf = (model) => {
  if (!model) return null;
  const base = String(model).replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  if (PRICING[base]) return PRICING[base];
  let best = null;
  for (const key of Object.keys(PRICING)) {
    if (base.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICING[best] : null;
};

/**
 * What a token bundle costs under a model, or null when the model is unpriced.
 * `cacheCreation` is the total cache write and `cacheCreation1h` its 1-hour
 * share; the rest prices at the default TTL.
 * @param {string|null} model
 * @param {{input: number, output: number, cacheRead: number, cacheCreation: number, cacheCreation1h?: number}} tokens
 * @returns {number|null} USD
 */
const costOf = (model, tokens) => {
  const rate = priceOf(model);
  if (!rate) return null;
  const long = num(tokens.cacheCreation1h);
  const short = Math.max(0, num(tokens.cacheCreation) - long);
  return (num(tokens.input) * rate.input
    + num(tokens.output) * rate.output
    + num(tokens.cacheRead) * rate.cacheRead
    + short * rate.cacheCreation
    + long * rate.cacheCreation1h) / MILLION;
};

module.exports = {
  PRICING,
  zeroTokens,
  num,
  costOf,
};
