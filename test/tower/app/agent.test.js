//
// Tests for the tower dashboard's agent.js and clock.js: the activity indicator.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, drawnIndicator, NOW } = require('./helpers');

const cases = async () => {
  const { format, agent, secondHand, modal } = await loadLibs();

  group('tower/app: agent - the activity indicator');

  await test('an agent that is moving is working, one that just stopped is idle, and a quiet one is gone', () => {
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'working', 'running and fresh');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 2000 }, NOW), 'idle', 'stopped, but only just');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'a session quiet ten minutes shows nothing, whatever the API still calls it');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'and neither does one that finished ten minutes ago');
  });

  await test('the gray band is reachable - the state word alone can never decide it', () => {
    // Gating gray on `state !== 'working'` makes it unreachable: the API drops
    // that word only after its own 45-minute window, long after the indicator is
    // gone. Freshness decides the motion; the word is only necessary for it.
    assertEq(agent.WORKING_MS, 20000, 'two poll cycles of the live feeds');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 30000 }, NOW), 'idle', 'still called working by the API, but quiet half a minute - gray');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 20000 }, NOW), 'working', 'exactly two cycles still spins');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 20001 }, NOW), 'idle', 'a millisecond past it does not');
    assertEq(agent.activityPhase({ state: 'stale', lastActivity: NOW - 3000 }, NOW), 'idle', 'a lapsed assertion over a fresh transcript is gray, not gone');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 10000 }, NOW), 'idle', 'and a subagent that just finished stays on screen, still');
  });

  await test('the cutoff is a minute, and the boundary belongs to the indicator', () => {
    assertEq(agent.ACTIVITY_WINDOW_MS, 60000, 'one minute');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60000 }, NOW), 'idle', 'exactly a minute is still gray-but-live');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60001 }, NOW), 'quiet', 'a millisecond past it is muted, not gone');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 61000 }, NOW), 'quiet', 'the word working does not exempt anything from it');
  });

  await test('a briefly quiet agent stays on the page for five minutes, muted (#99)', () => {
    // A ninety-second pause between turns must not empty the Crew page while
    // agents are running: muted and still is the honest middle.
    assertEq(agent.QUIET_WINDOW_MS, 5 * 60000, 'five minutes before it leaves');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'working', 'inside the working window it still spins');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 60000 }, NOW), 'idle', 'at the minute it is gray and still on the clock');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 60001 }, NOW), 'quiet', 'a millisecond past the minute it goes muted');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 3 * 60000 }, NOW), 'quiet', 'three minutes in it is still there');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 5 * 60000 }, NOW), 'quiet', 'exactly five minutes is the last second it is drawn');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - (5 * 60000 + 1) }, NOW), 'none', 'and a millisecond past THAT it is gone');
  });

  await test('the muted band is a class the page already ships, on the card and on the row', () => {
    assertEq(agent.mutedClass('working'), '', 'a working agent is not muted');
    assertEq(agent.mutedClass('idle'), '', 'nor one that only just stopped');
    assertEq(agent.mutedClass('quiet'), agent.MUTED_CLASS, 'a quiet one wears the muted class');
    assertEq(agent.mutedClass('none'), agent.MUTED_CLASS, 'and so does one whose indicator has gone entirely');
    assertEq(agent.MUTED_CLASS, 'text-body-secondary', 'the framework\'s own muted text class - no new colour pairing');
    assertEq(agent.cardMuted({ state: 'working', lastActivity: NOW - 5000 }, NOW), '', 'a card draws it from the node it already has');
    assertEq(agent.cardMuted({ state: 'working', lastActivity: NOW - 90000 }, NOW), agent.MUTED_CLASS, 'through the one arithmetic, never a second threshold');
  });

  await test('the Board draws the glyph only for work an agent actually holds', () => {
    // The claim is the agent:claimed label; an assignee is a person, never a claim.
    const claimed = agent.claimGlyph({ status: 'specced', agentClaimed: true, assignees: [] });
    assert(claimed.includes('omega-tower-activity--idle'), 'a specced issue carrying agent:claimed wears the still glyph');
    assertEq(agent.claimGlyph({ status: 'specced', agentClaimed: false, assignees: ['alice'] }), '', 'an assignee alone draws nothing');
    assertEq(agent.claimGlyph({ status: 'specced', assignees: ['alice'] }), '', 'nor one with no agentClaimed field at all');
    assertEq(agent.claimGlyph({ status: 'specced', agentClaimed: false, assignees: [] }), '', 'specced but unclaimed is not work in flight');
    assertEq(agent.claimGlyph({ status: 'inbox', agentClaimed: true }), '', 'a claim before the spec is accepted is not either');
    assertEq(agent.claimGlyph({ status: 'blocked', agentClaimed: true }), '', 'nor a claim on something blocked');
    assertEq(agent.claimGlyph({}), '', 'and an issue with nothing on it draws nothing');
  });

  await test('a building card spins the gear - the status says the work is in motion (#141)', () => {
    const building = agent.claimGlyph({ status: 'building', agentClaimed: true, assignees: ['alice'] });
    assert(building.includes('omega-tower-activity--working'), 'a building issue wears the working glyph');
    assert(building.includes('fa-spin'), 'and the gear turns');
    assert(building.includes('title="held by workkit-agent[bot]"'), 'saying the agent has it, the label being the claim');
    assert(!building.includes('@alice'), 'and never naming the assignee, who is a person, not the holder');
    assert(building.includes('<span class="visually-hidden">building</span>'), 'a screen reader hears the honest word');
    const assigned = agent.claimGlyph({ status: 'building', agentClaimed: false, assignees: ['alice'] });
    assert(assigned.includes('fa-spin'), 'building without the claim label is still work in flight, so it spins too');
    assert(assigned.includes('title="building"'), 'with the status as its hover text: an assignee is not a holder');
    const unheld = agent.claimGlyph({ status: 'building', assignees: [] });
    assert(unheld.includes('fa-spin'), 'and so does one with nothing on it but the status');
    assert(unheld.includes('title="building"'), 'with the same hover text');
  });

  await test('a claim announces itself as a claim, not as an idle agent', () => {
    assert(agent.claimGlyph({ status: 'specced', agentClaimed: true }).includes('<span class="visually-hidden">claimed</span>'), 'the word a screen reader hears is the caller\'s');
    assert(agent.activityIcon('idle').includes('<span class="visually-hidden">idle</span>'), 'and the phase name is still the default');
    for (const status of ['specced', 'building']) {
      assert(!agent.claimGlyph({ status, agentClaimed: true, assignees: ['<img src=x>'] }).includes('<img'),
        `a hostile handle never reaches a ${status} glyph: the glyph reads no assignee`);
    }
  });

  await test('a roster with no timestamps falls back to the word it does carry', () => {
    assertEq(agent.activityPhase({ state: 'working' }, NOW), 'working', 'the fallback roster still says who is running');
    assertEq(agent.activityPhase({ state: 'idle' }, NOW), 'none', 'and anything else draws nothing rather than a guess');
    assertEq(agent.activityPhase({}, NOW), 'none', 'an empty node is nothing at all');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW + 5000 }, NOW), 'working', 'a clock ahead of ours is this instant, not the future');
  });

  await test('a span is named in the largest unit that is still true', () => {
    assertEq(agent.sinceLabel(0), '0s', 'this instant');
    assertEq(agent.sinceLabel(12000), '12s', 'seconds');
    assertEq(agent.sinceLabel(59999), '59s', 'up to the minute');
    assertEq(agent.sinceLabel(60000), '1m', 'and over it');
    assertEq(agent.sinceLabel(3 * 60000), '3m', 'minutes');
    assertEq(agent.sinceLabel(2 * 3600000), '2h', 'hours');
    assertEq(agent.sinceLabel(50 * 3600000), '2d', 'days');
    assertEq(agent.sinceLabel(-5000), '0s', 'a negative span is now, never a minus sign on the card');
    assertEq(agent.sinceLabel('nope'), '', 'and a non-number says nothing at all');
  });

  await test('the indicator is one wordless glyph, animated only while the agent is', () => {
    const working = agent.activityIcon('working', 'running for 3m');
    assert(working.includes('fa-gear') && working.includes('fa-spin'), 'the working glyph spins');
    assert(working.includes('omega-tower-activity--working'), 'and carries the class its colour is on');
    assert(working.includes('title="running for 3m"'), 'the hover text is how long it has been up');
    const idle = agent.activityIcon('idle');
    assert(idle.includes('fa-gear') && !idle.includes('fa-spin'), 'the same glyph, still');
    assert(!idle.includes('title='), 'with no hover text when none was given');
    const quiet = agent.activityIcon('quiet');
    assert(quiet.includes('omega-tower-activity--quiet') && !quiet.includes('fa-spin'), 'the muted band is the same glyph, still');
    assertEq(agent.activityIcon('none'), '', 'and an agent past the five minutes draws nothing at all');
    assert(agent.activityIcon('working').includes('visually-hidden'), 'the word survives for a screen reader, which has no colour to read');
  });

  await test('a hostile hover text reaches the indicator as text', () => {
    assert(!agent.activityIcon('idle', '"><script>alert(1)</script>').includes('<script>'), 'escaped like every other interpolated field');
  });

  await test('a crew card says the freshness beside the glyph and the uptime on it', () => {
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes('fa-spin'), 'the working glyph');
    assert(markup.includes('>12s<'), 'twelve seconds since it last moved');
    assert(markup.includes('title="running for 3m"'), 'and three minutes since it started');
    assertEq(agent.crewActivity({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), '', 'a card whose agent went quiet loses the indicator entirely');
    const muted = agent.crewActivity({ state: 'working', lastActivity: NOW - 90000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(muted.includes('omega-tower-activity--quiet'), 'ninety seconds in, the glyph is still drawn - muted');
    assert(!muted.includes('fa-spin'), 'and it has stopped turning');
    assert(muted.includes('>1m<'), 'with the same age beside it as ever');
    assert(agent.crewActivity({ state: 'working' }, NOW).includes('up for an unknown span'), 'a node with no times still says the honest thing');
  });

  await test('a drawn indicator carries the stamps the clock reads back off it', () => {
    // The element holds the raw epochs: feeds land every ten seconds, and the
    // second hand re-decides the phase and the age in between from them alone.
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes(`data-live-ts="${NOW - 12000}"`), 'the epoch it last moved, raw');
    assert(markup.includes(`data-live-alive="${NOW - 3 * 60000}"`), 'and the one it started at');
    assert(markup.includes('data-live-state="working"'), 'plus the state word, which the phase needs and no arithmetic can recover');
    assert(markup.includes('data-live-age'), 'the age label is findable - it is the one text the tick rewrites');
    const timeless = agent.crewActivity({ state: 'working' }, NOW);
    assert(!timeless.includes('data-live-ts'), 'a node with no timestamp carries no stamp - an absent one must not become the epoch');
  });

  await test('the second hand decides exactly what the paint decided', () => {
    // Same thresholds, one home: the tick reads the dataset the markup above
    // wrote, and any drift between the two is a card whose colour and whose
    // label disagree for up to ten seconds.
    const stamps = (last, state = 'working') => ({ liveState: state, liveTs: String(NOW - last), liveAlive: String(NOW - 3 * 60000) });
    assertEq(agent.activityTick(stamps(5000), NOW).phase, 'working', 'running and fresh');
    assertEq(agent.activityTick(stamps(20000), NOW).phase, 'working', 'exactly two poll cycles still spins');
    assertEq(agent.activityTick(stamps(20001), NOW).phase, 'idle', 'a millisecond past it goes gray');
    assertEq(agent.activityTick(stamps(60000), NOW).phase, 'idle', 'exactly a minute is still on the clock');
    assertEq(agent.activityTick(stamps(60001), NOW).phase, 'quiet', 'and a millisecond past THAT is muted');
    assertEq(agent.activityTick(stamps(5 * 60000), NOW).phase, 'quiet', 'five minutes is the last second it is drawn');
    assertEq(agent.activityTick(stamps(5 * 60000 + 1), NOW).phase, 'none', 'past five minutes it is gone');
    assertEq(agent.activityTick(stamps(2000, 'done'), NOW).phase, 'idle', 'the state word still decides the motion');
    assertEq(agent.activityTick({ liveState: 'working' }, NOW).phase, 'working', 'a stampless element falls back to the word, as the paint does');
    assertEq(agent.activityTick({}, NOW).phase, 'none', 'and an element carrying nothing draws nothing');
  });

  await test('a tick a second later moves the number, and one in the same second moves nothing', () => {
    const stamps = { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) };
    const first = agent.activityTick(stamps, NOW);
    assertEq(first.age, '12s', 'the seconds since it last moved');
    assertEq(first.title, 'running for 3m', 'and how long it has been up, for the hover');
    assertEq(agent.activityTick(stamps, NOW + 1000).age, '13s', 'a second later the label has moved');
    // Idempotence is what makes a 1s timer cheap: the same second in gives the
    // same answer out, so the DOM comparison behind every write finds nothing
    // to do rather than recalculating a style sixty times a minute.
    const again = agent.activityTick(stamps, NOW);
    assertEq(again.age, first.age, 'the same second in, the same label out');
    assertEq(again.phase, first.phase, 'and the same phase');
    assertEq(again.title, first.title, 'and the same hover text');
  });

  await test('a tick a second later moves the label and touches nothing else', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1000);
    assertEq(drawn.label.textContent, '13s', 'the number moved');
    assertEq(drawn.label.writes, 1, 'in one write');
    assertEq(drawn.icon.writes, 0, 'the icon was left alone - same phase, same hover text');
    assertEq(drawn.glyph.writes, 0, 'and the glyph never stopped turning');
    assertEq(drawn.wrapper.wipes, 0, 'nothing was replaced');
    assertEq(drawn.host.querySelector('[data-live-ts]'), drawn.wrapper, 'the element the walk finds is the same object it found before');
    assertEq(drawn.icon.querySelector('i'), drawn.glyph, 'and so is the glyph under it - a replaced node is a restarted animation');
  });

  await test('a tick in the same second writes nothing at all', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW);
    secondHand.applyLive(drawn.host, NOW);
    const writes = [drawn.wrapper, drawn.icon, drawn.glyph, drawn.spoken, drawn.label].map((part) => part.writes);
    assertEq(writes.join(','), '0,0,0,0,0', 'every mutation is behind a comparison, so a second that says the same thing costs nothing');
  });

  await test('the idle crossing flips the classes on the element that is already there', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '20s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 20000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assertEq(drawn.icon.className, 'omega-tower-activity omega-tower-activity--idle', 'the colour went gray');
    assertEq(drawn.glyph.className, 'fa-solid fa-gear', 'the motion stopped');
    assertEq(drawn.spoken.textContent, 'idle', 'and what a screen reader hears went with it');
    assertEq(drawn.wrapper.wipes, 0, 'in place - the crossing replaced no node');
    assertEq(drawn.icon.querySelector('i'), drawn.glyph, 'it is the same glyph, restyled');
  });

  await test('the sixtieth second mutes the card instead of taking it off the page (#99)', () => {
    const drawn = drawnIndicator({
      phase: 'idle', age: '60s', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assertEq(drawn.wrapper.wipes, 0, 'the indicator is still there');
    assertEq(drawn.icon.className, 'omega-tower-activity omega-tower-activity--quiet', 'wearing the muted band');
    assertEq(drawn.spoken.textContent, 'quiet', 'and saying so to a screen reader');
    assert(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card it sits on is muted with it, live - not at the next poll');
    assertEq(drawn.host.querySelectorAll('[data-live-ts]').length, 1, 'and it stays in the walk, so it can come back');
    // Coming back is a fresher stamp, which a feed brings; the mute comes off
    // the same second the phase does.
    drawn.wrapper.dataset.liveTs = String(NOW - 1000);
    secondHand.applyLive(drawn.host, NOW + 2);
    assert(!drawn.card.className.split(' ').includes('text-body-secondary'), 'an agent that moves again is not muted a second longer');
  });

  await test('the five-minute mark empties the wrapper and takes it out of the walk', () => {
    const drawn = drawnIndicator({
      phase: 'quiet', age: '5m', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 5 * 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assert(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card is muted on its way out');
    assertEq(drawn.wrapper.wipes, 1, 'past the cutoff the indicator is not gray, it is gone');
    assertEq(drawn.wrapper.children.length, 0, 'the glyph and its label with it');
    assertEq(drawn.wrapper.dataset.liveTs, undefined, 'and the stamp is gone too');
    assertEq(drawn.host.querySelectorAll('[data-live-ts]').length, 0, 'so the walk no longer finds it - only a paint can bring it back');
    secondHand.applyLive(drawn.host, NOW + 120000);
    assertEq(drawn.wrapper.wipes, 1, 'and every later tick passes it by');
  });

  await test('the agent dialog carries the stamps too, so an open one ages like the card behind it', () => {
    const body = modal.agentDialog({
      id: 'a1', role: 'worker', state: 'working', lastActivity: NOW - 6000, aliveSince: NOW - 4 * 60000,
    }, NOW).body;
    assert(body.includes(`data-live-ts="${NOW - 6000}"`), 'the stamp the tick reads back');
    assert(body.includes('data-live-state="working"'), 'and the state word it decides the motion from');
    assert(body.includes('data-live-age'), 'plus the label the tick rewrites');
  });

  await test('the Overview draws its state cell with the one shared builder, stamps and all', () => {
    // What that builder hands it, for a session in the shape /api/crew
    // sends one - the stamps are the whole point of the delegation.
    const cell = agent.crewActivity({ state: 'working', lastActivity: NOW - 4000, aliveSince: NOW - 90000 }, NOW);
    assert(cell.includes(`data-live-ts="${NOW - 4000}"`), 'so the Overview markup carries the stamp the tick reads back');
    assert(cell.includes('data-live-age'), 'and the label the tick rewrites');
  });

  await test('the indicator is a gear, so a still one does not read as a broken spinner (#137)', () => {
    // A specced claim is still on purpose (work at rest), so its glyph has to
    // read at rest rather than as a stalled loading ring.
    const held = agent.claimGlyph({ status: 'specced', agentClaimed: true });
    assert(held.includes('fa-gear'), 'the Board says a claim with a gear at rest');
    assert(!held.includes('fa-spin'), 'still - a specced claim is held, not running');
    assert(agent.activityIcon('working').includes('fa-gear'), 'and the Crew turns the same one');
    for (const markup of [held, agent.activityIcon('working'), agent.activityIcon('quiet')]) {
      assert(!markup.includes('circle-notch'), 'the loader\'s ring is gone from every phase - one glyph, one story');
    }
  });

  await test('every role has its own glyph, in the colour that class is drawn in everywhere else', () => {
    const roles = ['manager', 'worker', 'scout', 'verifier', 'advisor', 'reviewer'];
    const glyphs = roles.map((name) => agent.roleGlyph(name));
    assertEq(new Set(glyphs).size, roles.length, 'no two roles share a glyph');
    assertEq(agent.roleGlyph('workkit:worker'), agent.roleGlyph('worker'), 'a prefixed class is the same role');
    assertEq(agent.roleGlyph('general-purpose'), agent.roleGlyph('nobody'), 'and everything the crew does not name is the one neutral glyph');
    const icon = agent.roleIcon('workkit:scout');
    assert(icon.includes(agent.roleGlyph('scout')), 'the glyph');
    assert(icon.includes(format.badgeColor('scout')), 'in the same colour as the chip under it');
    assert(icon.includes('title="workkit:scout"'), 'named on hover');
    assert(!agent.roleIcon('<img src=x>').includes('<img'), 'and a hostile class name is text');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
