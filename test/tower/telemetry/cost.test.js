//
// Tests for tower/api/lib/telemetry.js: cost (the per-million rates, the unpriced
// model, the cache rates, the TTL split). Prologue: ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const {
  readUsage, costOf, PRICING, cleanup, PRICED, assistantLine, mkWorld, mkSession,
} = require('./helpers');

describe('tower/telemetry: cost', () => {
  test('a known model prices per million tokens, each counter at its own rate', () => {
    const rate = PRICING[PRICED];
    const cost = costOf(PRICED, {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheCreation: 1000000,
    });
    expect(cost, 'a million of each is one rate each').toBe(rate.input + rate.output + rate.cacheRead + rate.cacheCreation);
    expect(costOf(`${PRICED}-20250805`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), 'a dated build is the same model').toBe(rate.input);
    expect(costOf(`${PRICED}[1m]`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), 'and so is a context variant').toBe(rate.input);
  });

  test('an unknown model prices null, never zero, and still reports its tokens', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'x', model: 'claude-from-the-future', input: 500, output: 10 })] });
    const usage = readUsage(file);
    expect(usage.tokens.total, 'the tokens are known even when the price is not').toBe(510);
    expect(usage.cost, 'and the price says so rather than claiming free').toBe(null);
    expect(costOf(null, { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }), 'no model at all is null too').toBe(null);
    cleanup(w.root);
  });

  test('one unpriced line makes the whole file unpriced - never a partial total', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'p', model: PRICED, input: 1000000 }),
        assistantLine({ id: 'u', model: 'claude-from-the-future', input: 1000000 }),
      ],
    });
    expect(readUsage(file).cost, 'an under-count would read as a real number').toBe(null);
    cleanup(w.root);
  });

  test('an unpriced line that spent NOTHING does not make the file unpriced', () => {
    const w = mkWorld();
    // Claude Code writes `<synthetic>` lines with an all-zero usage block for
    // messages it generated locally. One of those must not turn a fully priced
    // session's cost to null - zero tokens cost zero at any rate.
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'p', model: PRICED, input: 1000000 }),
        assistantLine({ id: 'z', model: '<synthetic>' }),
      ],
    });
    expect(readUsage(file).cost, 'the real spend is still reported').toBe(PRICING[PRICED].input);
    cleanup(w.root);
  });

  test('claude-opus-5 is priced, so the model everything runs on reports a cost', () => {
    expect(costOf('claude-opus-5', {
      input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0,
    }), 'input at $5 per million').toBe(5);
    expect(costOf('claude-opus-5[1m]', {
      input: 0, output: 1000000, cacheRead: 0, cacheCreation: 0,
    }), 'output at $25, context variant and all').toBe(25);
  });

  test('every row derives its three cache rates from its own input rate', () => {
    // Rounded, because 3 * 0.1 is 0.30000000000000004 in binary floating point
    // and the table carries the rate a human would write.
    const near = (n) => Math.round(n * 1e6);
    // claude-3-haiku is the one row taken from published cache rates instead,
    // and they do not follow the multipliers ($0.03 against a derived $0.025).
    // The published number is what gets billed, so the table keeps it and this
    // check names the exception rather than bending the rate to fit.
    const published = new Set(['claude-3-haiku']);
    for (const [model, rate] of Object.entries(PRICING)) {
      expect(near(rate.cacheCreation1h), `${model}: a 1-hour cache write is 2x input`).toBe(near(rate.input * 2));
      if (published.has(model)) continue;
      expect(near(rate.cacheRead), `${model}: a cache read is 0.1x input`).toBe(near(rate.input * 0.1));
      expect(near(rate.cacheCreation), `${model}: and a 5-minute cache write 1.25x`).toBe(near(rate.input * 1.25));
    }
    expect(PRICING['claude-3-haiku'].cacheRead, 'the published rate, not the derived 0.025').toBe(0.03);
  });

  test('the models the crew actually runs on are all priced', () => {
    // Every model seen in a live transcript on this machine. A gap here is the
    // Usage page's cost column going empty for whoever is running that model.
    for (const model of ['claude-opus-5', 'claude-fable-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      expect(costOf(model, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }) > 0, `${model} has a rate`).toBeTruthy();
    }
    expect(PRICING['claude-sonnet-5'].input, 'sonnet-5 carries the STANDARD rate, not the promotion through 2026-08-31').toBe(3);
  });

  test('a cache write is priced by its TTL - 1.25x input at 5 minutes, 2x at an hour', () => {
    const rate = PRICING['claude-opus-5'];
    // The whole write at each TTL, so the two rates are visible on their own.
    expect(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 0,
    }), 'all five-minute').toBe(rate.cacheCreation);
    expect(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 1000000,
    }), 'all one-hour').toBe(rate.cacheCreation1h);
    // A block carrying no split at all is the legacy shape and stays at 5m.
    expect(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000,
    }), 'no split named, so the default TTL').toBe(rate.cacheCreation);
  });

  test('a transcript carrying both TTL counters blends the two rates', () => {
    const w = mkWorld();
    const rate = PRICING['claude-opus-5'];
    const file = mkSession(w, {
      lines: [
        assistantLine({
          id: 'blend', model: 'claude-opus-5', cacheCreation: 1000000, ttl5: 400000, ttl1h: 600000,
        }),
      ],
    });
    const usage = readUsage(file);
    expect(usage.tokens.cacheCreation, 'the counter stays ONE total - the contract is untouched').toBe(1000000);
    expect(usage.tokens.total, 'and so does the token total').toBe(1000000);
    expect(usage.cost, 'the cost carries the split').toBe(0.4 * rate.cacheCreation + 0.6 * rate.cacheCreation1h);
    cleanup(w.root);
  });

  test('the legacy shape, with only the total and no split, prices at five minutes', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [assistantLine({ id: 'legacy', model: 'claude-opus-5', cacheCreation: 1000000 })],
    });
    expect(readUsage(file).cost, 'the default TTL').toBe(PRICING['claude-opus-5'].cacheCreation);
    cleanup(w.root);
  });
});
