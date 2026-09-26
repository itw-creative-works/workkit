// tower/api/lib/telemetry/pricing.js: what a token costs: the per-million rates
// per model, the counter coercion, the model lookup and the cost of a bundle.
// telemetry.js requires it; no piece requires telemetry.js.

// USD per MILLION tokens, per model, priced separately for each counter a usage
// block carries. These are Anthropic's published API list prices and they are a
// SNAPSHOT, hand-entered: nothing on disk states a rate, so a price change
// lands here or nowhere.
//
// Only input and output are published per model. The three cache rates are
// DERIVED from the input rate by the multipliers Anthropic states once for the
// whole family: a cache read is 0.1x input, and a cache write is 1.25x input at
// the default 5-minute TTL (`cacheCreation`) or 2x input at the 1-hour TTL
// (`cacheCreation1h`). The one exception is noted on its own row.
//
// The sonnet-5 row carries the STANDARD $3.00 / $15.00 rates. An introductory
// discount of $2.00 / $10.00 runs through 2026-08-31; pricing the promotion
// would make this snapshot wrong by design the moment it lapses, so sonnet-5
// cost reads about 33% high until that date and is correct after it.
//
// A model absent from this table prices as null, never as zero: the tower would
// rather show no number than a wrong one, and the tokens are reported either
// way. Anything released after this snapshot lands in that case until a rate is
// entered for it.
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
  // The one row whose cache rates are PUBLISHED rather than derived, and they
  // do not match the multipliers: $0.03 where 0.1x would be $0.025, and $0.30
  // where 1.25x would be $0.3125. The published number is the one billed.
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheCreation: 0.3, cacheCreation1h: 0.5 },
};

const MILLION = 1000000;

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

/** A usage counter, coerced: a missing or non-numeric field counts as none. */
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The pricing row for a model id, or null when this table has none.
 *
 * Ids arrive decorated: a dated build (`claude-opus-4-1-20250805`) and a context
 * variant (`claude-opus-5[1m]`) are the same model at the same rate, so both
 * decorations are stripped before the lookup and a longest-prefix match catches
 * the rest.
 *
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
 *
 * `cacheCreation` is the TOTAL cache write, matching the counter the response
 * carries. `cacheCreation1h` is the share of it written at the 1-hour TTL,
 * which costs 2x input rather than 1.25x; whatever the split does not account
 * for is priced at the default TTL, which is the whole of it for a usage block
 * that carries no split at all. Cost is one number, so it absorbs the two rates
 * without the response ever growing a second counter.
 *
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
