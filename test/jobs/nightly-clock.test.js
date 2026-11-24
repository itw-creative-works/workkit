// Tests for the clock of jobs/claude-nightly.js: which cadences a day adds, and
// where a rollup's window opens, each rule handed a fixed time. The zone is
// pinned to one whose date differs from UTC's at these times, so a rule that
// read the UTC date instead of the local one answers wrong.

const path = require('path');
const {
  describe, test, expect, before, after,
} = require('../lib/harness');

const { cadencesOn, sinceOf } = require(path.join(__dirname, '..', '..', 'jobs', 'claude-nightly.js'));

// UTC+13 in November: each instant below is 00:30 or 09:00 local, the day before in UTC.
const ZONE = 'Pacific/Auckland';
const TUESDAY = new Date('2026-11-23T20:00:00Z');
const SUNDAY = new Date('2026-11-21T11:30:00Z');
const FIRST = new Date('2026-11-30T11:30:00Z');
const SUNDAY_FIRST = new Date('2026-10-31T11:30:00Z');
const NEW_YEAR = new Date('2026-12-31T11:30:00Z');

describe('jobs/claude-nightly: the clock', () => {
  let zone;
  before(() => {
    zone = process.env.TZ;
    process.env.TZ = ZONE;
  });
  after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  test('a Sunday adds the weekly summary to the daily one', () => {
    expect(cadencesOn(TUESDAY), 'a weekday is the daily alone').toEqual(['daily']);
    expect(cadencesOn(SUNDAY), 'the local Sunday, a Saturday in UTC').toEqual(['daily', 'weekly']);
  });

  test('the 1st adds the monthly summary', () => {
    expect(cadencesOn(FIRST), 'the local 1st, the 30th in UTC').toEqual(['daily', 'monthly']);
    expect(cadencesOn(SUNDAY_FIRST), 'a Sunday that is the 1st adds both').toEqual(['daily', 'weekly', 'monthly']);
  });

  test('the weekly window opens 7 days back, at 00:00:00Z of the local date', () => {
    expect(sinceOf('weekly', SUNDAY), 'Sunday the 22nd').toBe('2026-11-15T00:00:00Z');
    expect(sinceOf('weekly', SUNDAY_FIRST), 'across a month').toBe('2026-10-25T00:00:00Z');
  });

  test('the monthly window opens 1 month back, at 00:00:00Z of the local date', () => {
    expect(sinceOf('monthly', FIRST), 'the 1st of December').toBe('2026-11-01T00:00:00Z');
    expect(sinceOf('monthly', NEW_YEAR), 'across a year').toBe('2026-12-01T00:00:00Z');
  });
});
