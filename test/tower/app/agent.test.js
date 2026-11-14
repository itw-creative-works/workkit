//
// Tests for the tower dashboard's agent.js and clock.js: the activity indicator.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, drawnIndicator, NOW } = require('./helpers');

describe('tower/app: agent - the activity indicator', () => {
  let format, agent, secondHand, modal;
  before(async () => { ({ format, agent, secondHand, modal } = await loadLibs()); });

  test('an agent that is moving is working, one that just stopped is idle, and a quiet one is gone', () => {
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'running and fresh').toBe('working');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 2000 }, NOW), 'stopped, but only just').toBe('idle');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 10 * 60000 }, NOW), 'a session quiet ten minutes shows nothing, whatever the API still calls it').toBe('none');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), 'and neither does one that finished ten minutes ago').toBe('none');
  });

  test('the gray band is reachable - the state word alone can never decide it', () => {
    // Gating gray on `state !== 'working'` makes it unreachable: the API drops
    // that word only after its own 45-minute window, long after the indicator is
    // gone. Freshness decides the motion; the word is only necessary for it.
    expect(agent.WORKING_MS, 'two poll cycles of the live feeds').toBe(20000);
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 30000 }, NOW), 'still called working by the API, but quiet half a minute - gray').toBe('idle');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 20000 }, NOW), 'exactly two cycles still spins').toBe('working');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 20001 }, NOW), 'a millisecond past it does not').toBe('idle');
    expect(agent.activityPhase({ state: 'stale', lastActivity: NOW - 3000 }, NOW), 'a lapsed assertion over a fresh transcript is gray, not gone').toBe('idle');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 10000 }, NOW), 'and a subagent that just finished stays on screen, still').toBe('idle');
  });

  test('the cutoff is a minute, and the boundary belongs to the indicator', () => {
    expect(agent.ACTIVITY_WINDOW_MS, 'one minute').toBe(60000);
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 60000 }, NOW), 'exactly a minute is still gray-but-live').toBe('idle');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 60001 }, NOW), 'a millisecond past it is muted, not gone').toBe('quiet');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 61000 }, NOW), 'the word working does not exempt anything from it').toBe('quiet');
  });

  test('a briefly quiet agent stays on the page for five minutes, muted (#99)', () => {
    // A ninety-second pause between turns must not empty the Crew page while
    // agents are running: muted and still is the honest middle.
    expect(agent.QUIET_WINDOW_MS, 'five minutes before it leaves').toBe(5 * 60000);
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'inside the working window it still spins').toBe('working');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 60000 }, NOW), 'at the minute it is gray and still on the clock').toBe('idle');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW - 60001 }, NOW), 'a millisecond past the minute it goes muted').toBe('quiet');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 3 * 60000 }, NOW), 'three minutes in it is still there').toBe('quiet');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - 5 * 60000 }, NOW), 'exactly five minutes is the last second it is drawn').toBe('quiet');
    expect(agent.activityPhase({ state: 'done', lastActivity: NOW - (5 * 60000 + 1) }, NOW), 'and a millisecond past THAT it is gone').toBe('none');
  });

  test('the muted band is a class the page already ships, on the card and on the row', () => {
    expect(agent.mutedClass('working'), 'a working agent is not muted').toBe('');
    expect(agent.mutedClass('idle'), 'nor one that only just stopped').toBe('');
    expect(agent.mutedClass('quiet'), 'a quiet one wears the muted class').toBe(agent.MUTED_CLASS);
    expect(agent.mutedClass('none'), 'and so does one whose indicator has gone entirely').toBe(agent.MUTED_CLASS);
    expect(agent.MUTED_CLASS, 'the framework\'s own muted text class - no new colour pairing').toBe('text-body-secondary');
    expect(agent.cardMuted({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'a card draws it from the node it already has').toBe('');
    expect(agent.cardMuted({ state: 'working', lastActivity: NOW - 90000 }, NOW), 'through the one arithmetic, never a second threshold').toBe(agent.MUTED_CLASS);
  });

  test('the Board draws the glyph only for work an agent actually holds', () => {
    // The claim is the agent:claimed label; an assignee is a person, never a claim.
    const claimed = agent.claimGlyph({ status: 'specced', agentClaimed: true, assignees: [] });
    expect(claimed.includes('omega-tower-activity--idle'), 'a specced issue carrying agent:claimed wears the still glyph').toBeTruthy();
    expect(agent.claimGlyph({ status: 'specced', agentClaimed: false, assignees: ['alice'] }), 'an assignee alone draws nothing').toBe('');
    expect(agent.claimGlyph({ status: 'specced', assignees: ['alice'] }), 'nor one with no agentClaimed field at all').toBe('');
    expect(agent.claimGlyph({ status: 'specced', agentClaimed: false, assignees: [] }), 'specced but unclaimed is not work in flight').toBe('');
    expect(agent.claimGlyph({ status: 'inbox', agentClaimed: true }), 'a claim before the spec is accepted is not either').toBe('');
    expect(agent.claimGlyph({ status: 'blocked', agentClaimed: true }), 'nor a claim on something blocked').toBe('');
    expect(agent.claimGlyph({}), 'and an issue with nothing on it draws nothing').toBe('');
  });

  test('a building card spins the gear - the status says the work is in motion (#141)', () => {
    const building = agent.claimGlyph({ status: 'building', agentClaimed: true, assignees: ['alice'] });
    expect(building.includes('omega-tower-activity--working'), 'a building issue wears the working glyph').toBeTruthy();
    expect(building.includes('fa-spin'), 'and the gear turns').toBeTruthy();
    expect(building.includes('title="held by workkit-agent[bot]"'), 'saying the agent has it, the label being the claim').toBeTruthy();
    expect(!building.includes('@alice'), 'and never naming the assignee, who is a person, not the holder').toBeTruthy();
    expect(building.includes('<span class="visually-hidden">building</span>'), 'a screen reader hears the honest word').toBeTruthy();
    const assigned = agent.claimGlyph({ status: 'building', agentClaimed: false, assignees: ['alice'] });
    expect(assigned.includes('fa-spin'), 'building without the claim label is still work in flight, so it spins too').toBeTruthy();
    expect(assigned.includes('title="building"'), 'with the status as its hover text: an assignee is not a holder').toBeTruthy();
    const unheld = agent.claimGlyph({ status: 'building', assignees: [] });
    expect(unheld.includes('fa-spin'), 'and so does one with nothing on it but the status').toBeTruthy();
    expect(unheld.includes('title="building"'), 'with the same hover text').toBeTruthy();
  });

  test('a claim announces itself as a claim, not as an idle agent', () => {
    expect(agent.claimGlyph({ status: 'specced', agentClaimed: true }).includes('<span class="visually-hidden">claimed</span>'), 'the word a screen reader hears is the caller\'s').toBeTruthy();
    expect(agent.activityIcon('idle').includes('<span class="visually-hidden">idle</span>'), 'and the phase name is still the default').toBeTruthy();
    for (const status of ['specced', 'building']) {
      expect(!agent.claimGlyph({ status, agentClaimed: true, assignees: ['<img src=x>'] }).includes('<img'),
        `a hostile handle never reaches a ${status} glyph: the glyph reads no assignee`).toBeTruthy();
    }
  });

  test('a roster with no timestamps falls back to the word it does carry', () => {
    expect(agent.activityPhase({ state: 'working' }, NOW), 'the fallback roster still says who is running').toBe('working');
    expect(agent.activityPhase({ state: 'idle' }, NOW), 'and anything else draws nothing rather than a guess').toBe('none');
    expect(agent.activityPhase({}, NOW), 'an empty node is nothing at all').toBe('none');
    expect(agent.activityPhase({ state: 'working', lastActivity: NOW + 5000 }, NOW), 'a clock ahead of ours is this instant, not the future').toBe('working');
  });

  test('a span is named in the largest unit that is still true', () => {
    expect(agent.sinceLabel(0), 'this instant').toBe('0s');
    expect(agent.sinceLabel(12000), 'seconds').toBe('12s');
    expect(agent.sinceLabel(59999), 'up to the minute').toBe('59s');
    expect(agent.sinceLabel(60000), 'and over it').toBe('1m');
    expect(agent.sinceLabel(3 * 60000), 'minutes').toBe('3m');
    expect(agent.sinceLabel(2 * 3600000), 'hours').toBe('2h');
    expect(agent.sinceLabel(50 * 3600000), 'days').toBe('2d');
    expect(agent.sinceLabel(-5000), 'a negative span is now, never a minus sign on the card').toBe('0s');
    expect(agent.sinceLabel('nope'), 'and a non-number says nothing at all').toBe('');
  });

  test('the indicator is one wordless glyph, animated only while the agent is', () => {
    const working = agent.activityIcon('working', 'running for 3m');
    expect(working.includes('fa-gear') && working.includes('fa-spin'), 'the working glyph spins').toBeTruthy();
    expect(working.includes('omega-tower-activity--working'), 'and carries the class its colour is on').toBeTruthy();
    expect(working.includes('title="running for 3m"'), 'the hover text is how long it has been up').toBeTruthy();
    const idle = agent.activityIcon('idle');
    expect(idle.includes('fa-gear') && !idle.includes('fa-spin'), 'the same glyph, still').toBeTruthy();
    expect(!idle.includes('title='), 'with no hover text when none was given').toBeTruthy();
    const quiet = agent.activityIcon('quiet');
    expect(quiet.includes('omega-tower-activity--quiet') && !quiet.includes('fa-spin'), 'the muted band is the same glyph, still').toBeTruthy();
    expect(agent.activityIcon('none'), 'and an agent past the five minutes draws nothing at all').toBe('');
    expect(agent.activityIcon('working').includes('visually-hidden'), 'the word survives for a screen reader, which has no colour to read').toBeTruthy();
  });

  test('a hostile hover text reaches the indicator as text', () => {
    expect(!agent.activityIcon('idle', '"><script>alert(1)</script>').includes('<script>'), 'escaped like every other interpolated field').toBeTruthy();
  });

  test('a crew card says the freshness beside the glyph and the uptime on it', () => {
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    expect(markup.includes('fa-spin'), 'the working glyph').toBeTruthy();
    expect(markup.includes('>12s<'), 'twelve seconds since it last moved').toBeTruthy();
    expect(markup.includes('title="running for 3m"'), 'and three minutes since it started').toBeTruthy();
    expect(agent.crewActivity({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), 'a card whose agent went quiet loses the indicator entirely').toBe('');
    const muted = agent.crewActivity({ state: 'working', lastActivity: NOW - 90000, aliveSince: NOW - 3 * 60000 }, NOW);
    expect(muted.includes('omega-tower-activity--quiet'), 'ninety seconds in, the glyph is still drawn - muted').toBeTruthy();
    expect(!muted.includes('fa-spin'), 'and it has stopped turning').toBeTruthy();
    expect(muted.includes('>1m<'), 'with the same age beside it as ever').toBeTruthy();
    expect(agent.crewActivity({ state: 'working' }, NOW).includes('up for an unknown span'), 'a node with no times still says the honest thing').toBeTruthy();
  });

  test('a drawn indicator carries the stamps the clock reads back off it', () => {
    // The element holds the raw epochs: feeds land every ten seconds, and the
    // second hand re-decides the phase and the age in between from them alone.
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    expect(markup.includes(`data-live-ts="${NOW - 12000}"`), 'the epoch it last moved, raw').toBeTruthy();
    expect(markup.includes(`data-live-alive="${NOW - 3 * 60000}"`), 'and the one it started at').toBeTruthy();
    expect(markup.includes('data-live-state="working"'), 'plus the state word, which the phase needs and no arithmetic can recover').toBeTruthy();
    expect(markup.includes('data-live-age'), 'the age label is findable - it is the one text the tick rewrites').toBeTruthy();
    const timeless = agent.crewActivity({ state: 'working' }, NOW);
    expect(!timeless.includes('data-live-ts'), 'a node with no timestamp carries no stamp - an absent one must not become the epoch').toBeTruthy();
  });

  test('the second hand decides exactly what the paint decided', () => {
    // Same thresholds, one home: the tick reads the dataset the markup above
    // wrote, and any drift between the two is a card whose colour and whose
    // label disagree for up to ten seconds.
    const stamps = (last, state = 'working') => ({ liveState: state, liveTs: String(NOW - last), liveAlive: String(NOW - 3 * 60000) });
    expect(agent.activityTick(stamps(5000), NOW).phase, 'running and fresh').toBe('working');
    expect(agent.activityTick(stamps(20000), NOW).phase, 'exactly two poll cycles still spins').toBe('working');
    expect(agent.activityTick(stamps(20001), NOW).phase, 'a millisecond past it goes gray').toBe('idle');
    expect(agent.activityTick(stamps(60000), NOW).phase, 'exactly a minute is still on the clock').toBe('idle');
    expect(agent.activityTick(stamps(60001), NOW).phase, 'and a millisecond past THAT is muted').toBe('quiet');
    expect(agent.activityTick(stamps(5 * 60000), NOW).phase, 'five minutes is the last second it is drawn').toBe('quiet');
    expect(agent.activityTick(stamps(5 * 60000 + 1), NOW).phase, 'past five minutes it is gone').toBe('none');
    expect(agent.activityTick(stamps(2000, 'done'), NOW).phase, 'the state word still decides the motion').toBe('idle');
    expect(agent.activityTick({ liveState: 'working' }, NOW).phase, 'a stampless element falls back to the word, as the paint does').toBe('working');
    expect(agent.activityTick({}, NOW).phase, 'and an element carrying nothing draws nothing').toBe('none');
  });

  test('a tick a second later moves the number, and one in the same second moves nothing', () => {
    const stamps = { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) };
    const first = agent.activityTick(stamps, NOW);
    expect(first.age, 'the seconds since it last moved').toBe('12s');
    expect(first.title, 'and how long it has been up, for the hover').toBe('running for 3m');
    expect(agent.activityTick(stamps, NOW + 1000).age, 'a second later the label has moved').toBe('13s');
    // Idempotence is what makes a 1s timer cheap: the same second in gives the
    // same answer out, so the DOM comparison behind every write finds nothing
    // to do rather than recalculating a style sixty times a minute.
    const again = agent.activityTick(stamps, NOW);
    expect(again.age, 'the same second in, the same label out').toBe(first.age);
    expect(again.phase, 'and the same phase').toBe(first.phase);
    expect(again.title, 'and the same hover text').toBe(first.title);
  });

  test('a tick a second later moves the label and touches nothing else', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1000);
    expect(drawn.label.textContent, 'the number moved').toBe('13s');
    expect(drawn.label.writes, 'in one write').toBe(1);
    expect(drawn.icon.writes, 'the icon was left alone - same phase, same hover text').toBe(0);
    expect(drawn.glyph.writes, 'and the glyph never stopped turning').toBe(0);
    expect(drawn.wrapper.wipes, 'nothing was replaced').toBe(0);
    expect(drawn.host.querySelector('[data-live-ts]'), 'the element the walk finds is the same object it found before').toBe(drawn.wrapper);
    expect(drawn.icon.querySelector('i'), 'and so is the glyph under it - a replaced node is a restarted animation').toBe(drawn.glyph);
  });

  test('a tick in the same second writes nothing at all', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW);
    secondHand.applyLive(drawn.host, NOW);
    const writes = [drawn.wrapper, drawn.icon, drawn.glyph, drawn.spoken, drawn.label].map((part) => part.writes);
    expect(writes.join(','), 'every mutation is behind a comparison, so a second that says the same thing costs nothing').toBe('0,0,0,0,0');
  });

  test('the idle crossing flips the classes on the element that is already there', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '20s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 20000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    expect(drawn.icon.className, 'the colour went gray').toBe('omega-tower-activity omega-tower-activity--idle');
    expect(drawn.glyph.className, 'the motion stopped').toBe('fa-solid fa-gear');
    expect(drawn.spoken.textContent, 'and what a screen reader hears went with it').toBe('idle');
    expect(drawn.wrapper.wipes, 'in place - the crossing replaced no node').toBe(0);
    expect(drawn.icon.querySelector('i'), 'it is the same glyph, restyled').toBe(drawn.glyph);
  });

  test('the sixtieth second mutes the card instead of taking it off the page (#99)', () => {
    const drawn = drawnIndicator({
      phase: 'idle', age: '60s', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    expect(drawn.wrapper.wipes, 'the indicator is still there').toBe(0);
    expect(drawn.icon.className, 'wearing the muted band').toBe('omega-tower-activity omega-tower-activity--quiet');
    expect(drawn.spoken.textContent, 'and saying so to a screen reader').toBe('quiet');
    expect(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card it sits on is muted with it, live - not at the next poll').toBeTruthy();
    expect(drawn.host.querySelectorAll('[data-live-ts]').length, 'and it stays in the walk, so it can come back').toBe(1);
    // Coming back is a fresher stamp, which a feed brings; the mute comes off
    // the same second the phase does.
    drawn.wrapper.dataset.liveTs = String(NOW - 1000);
    secondHand.applyLive(drawn.host, NOW + 2);
    expect(!drawn.card.className.split(' ').includes('text-body-secondary'), 'an agent that moves again is not muted a second longer').toBeTruthy();
  });

  test('the five-minute mark empties the wrapper and takes it out of the walk', () => {
    const drawn = drawnIndicator({
      phase: 'quiet', age: '5m', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 5 * 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    expect(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card is muted on its way out').toBeTruthy();
    expect(drawn.wrapper.wipes, 'past the cutoff the indicator is not gray, it is gone').toBe(1);
    expect(drawn.wrapper.children.length, 'the glyph and its label with it').toBe(0);
    expect(drawn.wrapper.dataset.liveTs, 'and the stamp is gone too').toBe(undefined);
    expect(drawn.host.querySelectorAll('[data-live-ts]').length, 'so the walk no longer finds it - only a paint can bring it back').toBe(0);
    secondHand.applyLive(drawn.host, NOW + 120000);
    expect(drawn.wrapper.wipes, 'and every later tick passes it by').toBe(1);
  });

  test('the agent dialog carries the stamps too, so an open one ages like the card behind it', () => {
    const body = modal.agentDialog({
      id: 'a1', role: 'worker', state: 'working', lastActivity: NOW - 6000, aliveSince: NOW - 4 * 60000,
    }, NOW).body;
    expect(body.includes(`data-live-ts="${NOW - 6000}"`), 'the stamp the tick reads back').toBeTruthy();
    expect(body.includes('data-live-state="working"'), 'and the state word it decides the motion from').toBeTruthy();
    expect(body.includes('data-live-age'), 'plus the label the tick rewrites').toBeTruthy();
  });

  test('the Overview draws its state cell with the one shared builder, stamps and all', () => {
    // What that builder hands it, for a session in the shape /api/crew
    // sends one - the stamps are the whole point of the delegation.
    const cell = agent.crewActivity({ state: 'working', lastActivity: NOW - 4000, aliveSince: NOW - 90000 }, NOW);
    expect(cell.includes(`data-live-ts="${NOW - 4000}"`), 'so the Overview markup carries the stamp the tick reads back').toBeTruthy();
    expect(cell.includes('data-live-age'), 'and the label the tick rewrites').toBeTruthy();
  });

  test('the indicator is a gear, so a still one does not read as a broken spinner (#137)', () => {
    // A specced claim is still on purpose (work at rest), so its glyph has to
    // read at rest rather than as a stalled loading ring.
    const held = agent.claimGlyph({ status: 'specced', agentClaimed: true });
    expect(held.includes('fa-gear'), 'the Board says a claim with a gear at rest').toBeTruthy();
    expect(!held.includes('fa-spin'), 'still - a specced claim is held, not running').toBeTruthy();
    expect(agent.activityIcon('working').includes('fa-gear'), 'and the Crew turns the same one').toBeTruthy();
    for (const markup of [held, agent.activityIcon('working'), agent.activityIcon('quiet')]) {
      expect(!markup.includes('circle-notch'), 'the loader\'s ring is gone from every phase - one glyph, one story').toBeTruthy();
    }
  });

  test('every role has its own glyph, in the colour that class is drawn in everywhere else', () => {
    const roles = ['manager', 'worker', 'scout', 'verifier', 'advisor', 'reviewer'];
    const glyphs = roles.map((name) => agent.roleGlyph(name));
    expect(new Set(glyphs).size, 'no two roles share a glyph').toBe(roles.length);
    expect(agent.roleGlyph('workkit:worker'), 'a prefixed class is the same role').toBe(agent.roleGlyph('worker'));
    expect(agent.roleGlyph('general-purpose'), 'and everything the crew does not name is the one neutral glyph').toBe(agent.roleGlyph('nobody'));
    const icon = agent.roleIcon('workkit:scout');
    expect(icon.includes(agent.roleGlyph('scout')), 'the glyph').toBeTruthy();
    expect(icon.includes(format.badgeColor('scout')), 'in the same colour as the chip under it').toBeTruthy();
    expect(icon.includes('title="workkit:scout"'), 'named on hover').toBeTruthy();
    expect(!agent.roleIcon('<img src=x>').includes('<img'), 'and a hostile class name is text').toBeTruthy();
  });
});
