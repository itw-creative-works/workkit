//
// Tests for tower/api/lib/telemetry.js: cost (the per-million rates, the
// unpriced model, the cache rates and the TTL split).
// The shared prologue (the transcript line builders, the scratch world and its sessions, the collect call, the module under test) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  readUsage, costOf, PRICING, cleanup, PRICED, assistantLine, mkWorld, mkSession,
} = require('./helpers');

const run = async () => {
  group('tower/telemetry: cost');

  await test('a known model prices per million tokens, each counter at its own rate', () => {
    const rate = PRICING[PRICED];
    const cost = costOf(PRICED, {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheCreation: 1000000,
    });
    assertEq(cost, rate.input + rate.output + rate.cacheRead + rate.cacheCreation, 'a million of each is one rate each');
    assertEq(costOf(`${PRICED}-20250805`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), rate.input, 'a dated build is the same model');
    assertEq(costOf(`${PRICED}[1m]`, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }), rate.input, 'and so is a context variant');
  });

  await test('an unknown model prices null, never zero, and still reports its tokens', () => {
    const w = mkWorld();
    const file = mkSession(w, { lines: [assistantLine({ id: 'x', model: 'claude-from-the-future', input: 500, output: 10 })] });
    const usage = readUsage(file);
    assertEq(usage.tokens.total, 510, 'the tokens are known even when the price is not');
    assertEq(usage.cost, null, 'and the price says so rather than claiming free');
    assertEq(costOf(null, { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }), null, 'no model at all is null too');
    cleanup(w.root);
  });

  await test('one unpriced line makes the whole file unpriced - never a partial total', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [
        assistantLine({ id: 'p', model: PRICED, input: 1000000 }),
        assistantLine({ id: 'u', model: 'claude-from-the-future', input: 1000000 }),
      ],
    });
    assertEq(readUsage(file).cost, null, 'an under-count would read as a real number');
    cleanup(w.root);
  });

  await test('an unpriced line that spent NOTHING does not make the file unpriced', () => {
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
    assertEq(readUsage(file).cost, PRICING[PRICED].input, 'the real spend is still reported');
    cleanup(w.root);
  });

  await test('claude-opus-5 is priced, so the model everything runs on reports a cost', () => {
    assertEq(costOf('claude-opus-5', {
      input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0,
    }), 5, 'input at $5 per million');
    assertEq(costOf('claude-opus-5[1m]', {
      input: 0, output: 1000000, cacheRead: 0, cacheCreation: 0,
    }), 25, 'output at $25, context variant and all');
  });

  await test('every row derives its three cache rates from its own input rate', () => {
    // Rounded, because 3 * 0.1 is 0.30000000000000004 in binary floating point
    // and the table carries the rate a human would write.
    const near = (n) => Math.round(n * 1e6);
    // claude-3-haiku is the one row taken from published cache rates instead,
    // and they do NOT follow the multipliers - $0.03 against a derived $0.025.
    // The published number is what gets billed, so the table keeps it and this
    // check names the exception rather than bending the rate to fit.
    const published = new Set(['claude-3-haiku']);
    for (const [model, rate] of Object.entries(PRICING)) {
      assertEq(near(rate.cacheCreation1h), near(rate.input * 2), `${model}: a 1-hour cache write is 2x input`);
      if (published.has(model)) continue;
      assertEq(near(rate.cacheRead), near(rate.input * 0.1), `${model}: a cache read is 0.1x input`);
      assertEq(near(rate.cacheCreation), near(rate.input * 1.25), `${model}: and a 5-minute cache write 1.25x`);
    }
    assertEq(PRICING['claude-3-haiku'].cacheRead, 0.03, 'the published rate, not the derived 0.025');
  });

  await test('the models the crew actually runs on are all priced', () => {
    // Every model seen in a live transcript on this machine. A gap here is the
    // Usage page's cost column going empty for whoever is running that model.
    for (const model of ['claude-opus-5', 'claude-fable-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      assert(costOf(model, { input: 1000000, output: 0, cacheRead: 0, cacheCreation: 0 }) > 0, `${model} has a rate`);
    }
    assertEq(PRICING['claude-sonnet-5'].input, 3, 'sonnet-5 carries the STANDARD rate, not the promotion through 2026-08-31');
  });

  await test('a cache write is priced by its TTL - 1.25x input at 5 minutes, 2x at an hour', () => {
    const rate = PRICING['claude-opus-5'];
    // The whole write at each TTL, so the two rates are visible on their own.
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 0,
    }), rate.cacheCreation, 'all five-minute');
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000, cacheCreation1h: 1000000,
    }), rate.cacheCreation1h, 'all one-hour');
    // A block carrying no split at all is the legacy shape and stays at 5m.
    assertEq(costOf('claude-opus-5', {
      input: 0, output: 0, cacheRead: 0, cacheCreation: 1000000,
    }), rate.cacheCreation, 'no split named, so the default TTL');
  });

  await test('a transcript carrying both TTL counters blends the two rates', () => {
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
    assertEq(usage.tokens.cacheCreation, 1000000, 'the counter stays ONE total - the contract is untouched');
    assertEq(usage.tokens.total, 1000000, 'and so does the token total');
    assertEq(usage.cost, 0.4 * rate.cacheCreation + 0.6 * rate.cacheCreation1h, 'the cost carries the split');
    cleanup(w.root);
  });

  await test('the legacy shape, with only the total and no split, prices at five minutes', () => {
    const w = mkWorld();
    const file = mkSession(w, {
      lines: [assistantLine({ id: 'legacy', model: 'claude-opus-5', cacheCreation: 1000000 })],
    });
    assertEq(readUsage(file).cost, PRICING['claude-opus-5'].cacheCreation, 'the default TTL');
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
