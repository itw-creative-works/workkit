//
// Tests for the tower dashboard's agent.js and clock.js: the activity indicator.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, drawnIndicator, NOW } = require('./helpers');

const run = async () => {
  const { format, agent, secondHand, modal } = await loadLibs();

  group('tower/app: agent - the activity indicator');

  await test('an agent that is moving is working, one that just stopped is idle, and a quiet one is gone', () => {
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'working', 'running and fresh');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 2000 }, NOW), 'idle', 'stopped, but only just');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'a session quiet ten minutes shows nothing, whatever the API still calls it');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'and neither does one that finished ten minutes ago');
  });

  await test('the gray band is reachable - the state word alone can never decide it', () => {
    // The defect this proves against: gating gray on `state !== 'working'`
    // makes it unreachable, because the API only drops that word after its own
    // 45-minute window, decided from the SAME file time - by which point the
    // indicator is long gone. Freshness decides the motion; the word is only
    // necessary for it.
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
    // The defect this proves against: one boundary for both questions. An agent
    // that stops for ninety seconds - between turns, waiting on a tool - used
    // to vanish from the Crew page outright, so the page said nobody was
    // running while four agents were. Muted and still IS the honest middle.
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
    const claimed = agent.claimGlyph({ status: 'specced', assignees: ['alice'] });
    assert(claimed.includes('omega-tower-activity--idle'), 'a specced issue with an assignee carries the still glyph');
    assert(claimed.includes('title="held by @alice"'), 'saying who has it');
    assertEq(agent.claimGlyph({ status: 'specced', assignees: [] }), '', 'specced but unclaimed is not work in flight');
    assertEq(agent.claimGlyph({ status: 'specced' }), '', 'and neither is one with no assignee field at all');
    assertEq(agent.claimGlyph({ status: 'inbox', assignees: ['alice'] }), '', 'a claim before the spec is accepted is not either');
    assertEq(agent.claimGlyph({ status: 'blocked', assignees: ['alice'] }), '', 'nor a claim on something blocked');
    assertEq(agent.claimGlyph({}), '', 'and an issue with nothing on it draws nothing');
  });

  await test('a building card spins the gear - the status says the work is in motion (#141)', () => {
    const building = agent.claimGlyph({ status: 'building', assignees: ['alice'] });
    assert(building.includes('omega-tower-activity--working'), 'a building issue wears the working glyph');
    assert(building.includes('fa-spin'), 'and the gear turns');
    assert(building.includes('title="held by @alice"'), 'saying who has it');
    assert(building.includes('<span class="visually-hidden">building</span>'), 'a screen reader hears the honest word');
    const unheld = agent.claimGlyph({ status: 'building', assignees: [] });
    assert(unheld.includes('fa-spin'), 'building without a holder is still work in flight, so it spins too');
    assert(unheld.includes('title="building"'), 'with the status as its hover text, having no holder to name');
  });

  await test('a claim announces itself as a claim, not as an idle agent', () => {
    assert(agent.claimGlyph({ status: 'specced', assignees: ['alice'] }).includes('<span class="visually-hidden">claimed</span>'), 'the word a screen reader hears is the caller\'s');
    assert(agent.activityIcon('idle').includes('<span class="visually-hidden">idle</span>'), 'and the phase name is still the default');
    assert(!agent.claimGlyph({ status: 'specced', assignees: ['<img src=x>'] }).includes('<img'), 'a hostile handle is text in both the title and the label');
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
    // The defect this proves against: markup that carries only the WORDS made
    // from the stamps. A feed lands every ten seconds; the second hand has to
    // re-decide the phase and the age in between, and it has nothing to decide
    // from unless the element itself holds the raw epochs.
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

  await test('the classes the phase wears are written once, for both the paint and the tick', () => {
    assert(agent.activityIcon('working').includes(`class="${agent.activityClass('working')}"`), 'the paint draws them from the one helper');
    assertEq(agent.activityClass('idle'), 'omega-tower-activity omega-tower-activity--idle', 'and a phase crossing has one name to write');
  });

  await test('the second hand has one home, and it is not a page', () => {
    const fs = require('fs');
    const clock = fs.readFileSync(path.join(libs, 'clock.js'), 'utf8');
    assert(clock.includes('setInterval'), 'the timer lives in clock.js');
    assert(/import \{[^}]*activityTick[^}]*\} from '\.\/agent\.js'/.test(clock), 'and it re-decides through the shared arithmetic rather than a copy of the thresholds');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      assert(!fs.readFileSync(path.join(pages, name), 'utf8').includes('setInterval'), `${name} runs no clock of its own`);
    }
    assert(fs.readFileSync(path.join(libs, 'page.js'), 'utf8').includes('startClock(document.body)'), 'the runtime arms it once, over the whole document - the dialogs carry indicators and sit outside the page mount');
  });

  await test('the paint and the double draw the same node - the selectors the tick walks by', () => {
    // What keeps the fake DOM below honest: every hook applyLive reaches for is
    // one the real builder actually writes. If crewActivity renames one of
    // these, this fails here rather than leaving the lifecycle test passing
    // against a shape that no longer exists.
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes('data-live-ts='), 'the wrapper the walk finds');
    assert(markup.includes('class="omega-tower-activity omega-tower-activity--working"'), 'the icon the tick re-classes');
    assert(markup.includes('<i class="fa-solid fa-gear fa-spin"'), 'the glyph it toggles the motion on');
    assert(markup.includes('class="visually-hidden">working<'), 'the word it keeps in step with the colour');
    assert(markup.includes('data-live-age'), 'and the label it rewrites');
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
    // The defect this proves against: the dialog drew the bare glyph, with no
    // stamps on it, so it was the one surface the second hand could not reach -
    // a dialog left open showed a green spinning circle for an agent that had
    // been quiet for ten minutes.
    const body = modal.agentDialog({
      id: 'a1', role: 'worker', state: 'working', lastActivity: NOW - 6000, aliveSince: NOW - 4 * 60000,
    }, NOW).body;
    assert(body.includes(`data-live-ts="${NOW - 6000}"`), 'the stamp the tick reads back');
    assert(body.includes('data-live-state="working"'), 'and the state word it decides the motion from');
    assert(body.includes('data-live-age'), 'plus the label the tick rewrites');
  });

  await test('the Overview draws its state cell with the one shared builder, stamps and all', () => {
    // The defect this proves against: a SECOND hand-rolled copy of the crew
    // card's wrapper. The Overview built its own span around the bare glyph, so
    // its indicator carried no stamps, the second hand walked straight past it,
    // and the landing page's numbers sat still while the Crew page's moved.
    const fs = require('fs');
    const overview = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    assert(!overview.includes('activityIcon('), 'it wraps nothing of its own around the bare glyph');
    // And what that builder hands it, for a session in the shape /api/crew
    // sends one - the stamps are the whole point of the delegation.
    const cell = agent.crewActivity({ state: 'working', lastActivity: NOW - 4000, aliveSince: NOW - 90000 }, NOW);
    assert(cell.includes(`data-live-ts="${NOW - 4000}"`), 'so the Overview markup carries the stamp the tick reads back');
    assert(cell.includes('data-live-age'), 'and the label the tick rewrites');
  });

  await test('the class the glyph spins on names a rule that exists', () => {
    // The defect this proves against: `fa-spin` is Font Awesome's class and the
    // theme ships its icons WITHOUT its stylesheet, so the markup asked for an
    // animation nothing in the bundle defined and the glyph was still from the
    // day it shipped. Whether it visibly turns is a browser's answer; that the
    // rule is in the sheet at all is this one's.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const rule = /\.omega-tower-activity \.fa-spin \{ animation: (\S+) /.exec(sheet);
    assert(rule, 'the indicator gives its own glyph the animation');
    assertEq(rule[1], 'spin', 'reusing the keyframes the framework already ships');
    // Anchored on the block that disables THIS animation, not on the sheet's
    // first `prefers-reduced-motion` - an unrelated reduced-motion block added
    // higher up would otherwise fail a rule that is perfectly well ordered.
    const disable = /@media \(prefers-reduced-motion: reduce\) \{\s*\.omega-tower-activity \.fa-spin \{ animation: none; \}/.exec(sheet);
    assert(disable, 'and reduced motion turns this animation off by name');
    assert(disable.index > sheet.indexOf('.omega-tower-activity .fa-spin {'), 'after the rule it overrides, so it still wins the tie');
  });

  await test('the glyph turns about its own centre, still or spinning (#137)', () => {
    // The defect this proves against: the animation was on an `<i>` with no box
    // of its own, so its size was the LINE it sat on - taller than the 1em SVG
    // the framework's renderer fills it with, since a replaced element rests on
    // the baseline with the strut's leading under it. A rotation turns about
    // the box's centre, which sat ~2px below the glyph's at .75rem, so the
    // glyph orbited instead of turning. The box has to BE the glyph.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const box = /\.omega-tower-activity i \{([^}]*)\}/.exec(sheet);
    assert(box, 'the indicator sizes the glyph it draws');
    for (const declaration of ['height: 1em', 'width: 1em']) {
      assert(box[1].includes(declaration), `one square em (${declaration}), so the box's centre is the glyph's`);
    }
    for (const declaration of ['display: flex', 'align-items: center', 'justify-content: center']) {
      assert(box[1].includes(declaration), `and the glyph is centred in it (${declaration}), never laid out on a baseline`);
    }
    assert(/^\.omega-tower-activity i \{/m.test(sheet), 'at the top level - a box behind a media query is a box half the readers do not get');
    // The box is NOT the spinning phase's: the still glyph wears the same one,
    // so a card keeps its size across the second the motion starts or stops.
    const motion = /\.omega-tower-activity \.fa-spin \{ (.*?) \}/.exec(sheet);
    assertEq(motion[1], 'animation: spin 1s linear infinite;', 'the phase rule says the motion and nothing about the box');
    // And what the sheet is scoped to is what the markup actually draws - the
    // rule missing its element is the whole of #65 and half of this one.
    const working = agent.activityIcon('working', 'running for 3m');
    assert(/class="omega-tower-activity[^"]*"/.test(working), 'the wrapper the box and the motion are both scoped under');
    assert(/<i class="fa-solid fa-gear fa-spin"/.test(working), 'the `i` the box sizes, wearing the class the motion is on');
  });

  await test('the indicator is a gear, so a still one does not read as a broken spinner (#137)', () => {
    // The defect this proves against: the notched ring - the universal loading
    // spinner - drawn STILL on a claimed Board card, which is what a board
    // whose spinners "do not work" looks like. A specced claim is still on
    // purpose (work at rest), so the fix is a shape that reads at rest.
    const held = agent.claimGlyph({ status: 'specced', assignees: ['alice'] });
    assert(held.includes('fa-gear'), 'the Board says a claim with a gear at rest');
    assert(!held.includes('fa-spin'), 'still - a specced claim is held, not running');
    assert(agent.activityIcon('working').includes('fa-gear'), 'and the Crew turns the same one');
    for (const markup of [held, agent.activityIcon('working'), agent.activityIcon('quiet')]) {
      assert(!markup.includes('circle-notch'), 'the loader\'s ring is gone from every phase - one glyph, one story');
    }
  });

  await test('the loading ring is the framework\'s, placed centered by the tower (#137)', () => {
    // The ring is still Bootstrap's `.spinner-border`, animated by the bundle's
    // own `@keyframes spinner-border` - format.loading only PLACES it, centered
    // over the space the content will take (owner ruling, 2026-08-19), because
    // a spinner crushed into the top-left corner of a body reads as a misrender
    // rather than a wait. It keeps spinning only while this sheet writes no
    // rule of that name; a local override is exactly how a working spinner stops.
    const markup = format.loading('reading the board…');
    assert(markup.includes('spinner-border'), 'the ring is Bootstrap\'s, never one the tower draws itself');
    assert(markup.includes('justify-content-center') && markup.includes('align-items-center'),
      'centered both ways over the body it stands in for');
    assert(markup.includes('role="status"'), 'announced as a wait, not read as content');
    assert(markup.includes('reading the board…'), 'with the caller\'s line beneath it');
    assert(format.loading('<b>x</b>').includes('&lt;b&gt;'), 'the line is escaped like every other interpolation');
    const fs = require('fs');
    const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(!/\bloading[^}]*\} from '@omega\.js\/client\/modules\/live-page'/.test(page),
      'the Board takes the wait state from the shared vocabulary, not the framework\'s corner-flush inline one');
    assert(/import \{[^}]*\bloading\b[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(page),
      'and it imports the tower\'s own');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    assert(!sheet.includes('.spinner-border'), 'and this sheet leaves the animation alone');
  });

  await test('the muted band borrows the gray the still glyph already wears', () => {
    // No new colour pairing for #99: the quiet phase names the SAME faint token
    // the idle one does, so there is one gray on the tower rather than two.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const rule = /\.omega-tower-activity--idle,\s*\.omega-tower-activity--quiet \{ color: (.+?); \}/.exec(sheet);
    assert(rule, 'the two bands share one rule');
    assert(rule[1].includes('--omega-ink-faint'), 'and it is the theme\'s faint ink, not a hex of its own');
  });

  await test('both crew surfaces mark the card the tick mutes (#99)', () => {
    // The defect this proves against: the mute drawn only at paint time. The
    // feeds land every ten seconds and the crossing is measured in seconds, so
    // the card has to carry the hook the second hand walks - the same bet the
    // `data-live-*` stamps beside it make.
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['crew.js', 'index.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(source.includes('data-live-card'), `${name} marks the element that goes muted`);
      assert(/import \{[^}]*cardMuted[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(source), `${name} draws that mute from the one arithmetic, never a threshold of its own`);
    }
    const clock = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'libs', 'tower', 'clock.js'), 'utf8');
    assert(clock.includes('data-live-card'), 'and the second hand walks them');
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

  await test('that glyph wears the shell\'s tile, and keeps its own colour inside it (#142)', () => {
    // A bare coloured glyph on a crew card, where every other icon in the shell
    // sits in a small rounded square. The box is the THEME's - the markup wears
    // `.omega-icon-chip--neutral` rather than the sheet hand-rolling the same
    // tile - and only the box is borrowed: the colour is the role's, written
    // inline by the markup, which beats the chip's neutral ink.
    assert(agent.roleIcon('worker').includes('omega-icon-chip omega-icon-chip--neutral'), 'the markup wears the theme\'s own tile');
    assert(agent.roleIcon('worker').includes(`color: ${format.badgeColor('worker')}`), 'and still writes the role colour inline');
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const local = /\.omega-tower-role \{([^}]*)\}/.exec(sheet);
    assert(local, 'the sheet still sizes the glyph');
    for (const declaration of ['height', 'width', 'background', 'border-radius', 'color']) {
      // Anchored to a declaration start so `line-height` does not read as `height`.
      assert(!new RegExp(`(^|[\\s;])${declaration}:`).test(local[1]), `without redrawing what the chip ships (${declaration})`);
    }
    // The chip is inline-flex, which is what keeps BOTH placements: the crew
    // card centres the tile with `text-center`, which reaches inline-level boxes
    // and nothing else, and the agent dialog's head lays it out as one flex item.
    const crewPage = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'crew.js'), 'utf8');
    assert(/<div class="text-center mb-2">\$\{roleIcon\(/.test(crewPage), 'the crew card centres it as inline content');
  });

  await test('the pages route their indicators through the one helper', () => {
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const crewPage = fs.readFileSync(path.join(pages, 'crew.js'), 'utf8');
    assert(/import \{[^}]*crewActivity[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(crewPage), 'the Crew page takes the indicator from the shared lib');
    const boardPage = fs.readFileSync(path.join(pages, 'board.js'), 'utf8');
    assert(/import \{[^}]*claimGlyph[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(boardPage), 'the Board takes the claim glyph AND its gate from the same lib');
    const overview = fs.readFileSync(path.join(pages, 'index.js'), 'utf8');
    assert(/import \{[^}]*crewActivity[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(overview), 'and the Overview\'s crew table draws the same indicator - the same builder, not a pill or a wrapper of its own');
    assert(!/pill\((?:[^)]*)working/.test(overview), 'no page decides on its own what a working agent looks like');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(!source.includes('fa-spin'), `${name} writes no glyph of its own - the helper owns what the indicator looks like`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
