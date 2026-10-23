//
// Tests for the tower dashboard's format.js: the chips an issue carries.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

const run = async () => {
  const { format } = await loadLibs();

  group('tower/app: format - the issue chips');

  await test('an issue shows exactly the chips it earns', () => {
    const chips = format.issueChips({
      type: 'bug', priority: 'high', agentOk: true, assignees: ['alice', 'someone'],
    });
    assert(chips.includes('>bug<'), 'the type');
    assert(chips.includes('high'), 'the priority');
    assert(chips.includes('agent:ok'), 'the agent grant');
    assert(chips.includes('@alice, @someone'), 'every assignee, each with its handle');
  });

  await test('both ends of the priority scale are drawn through the one colour system', () => {
    const ends = { high: '--omega-danger', low: '--omega-ink-faint' };
    for (const [priority, token] of Object.entries(ends)) {
      const chips = format.issueChips({ type: 'bug', priority });
      assert(chips.includes(`--omega-tone: var(${token})`), `${priority} is drawn in its own token`);
      assertEq(chips.includes(format.priorityChip(priority)), true, `${priority} is the chip format.js draws`);
      assert(!chips.includes('omega-chip--accent'), 'and never a colour decided at the call site');
    }
    assert(!format.issueChips({ type: '', priority: '' }).includes('omega-badge-tone'),
      'the unlabelled middle still draws no priority chip');
  });

  await test('a type is drawn through the one colour system, in a ramp slot no other type holds', () => {
    // A hue is unique within a category (three types, three hues) and free
    // across them: every chip says its own word and wears its own glyph.
    const slots = { bug: '--omega-danger', enhancement: '--omega-chart-5', idea: '--omega-chart-3' };
    for (const [type, token] of Object.entries(slots)) {
      const chips = format.issueChips({ type, priority: '' });
      assert(chips.includes(`--omega-tone: var(${token})`), `${type} is drawn in its own slot`);
      assertEq(chips.includes(format.typeChip(type)), true, `${type} is the chip format.js draws`);
    }
    const tokens = Object.keys(slots).map((type) => format.typeToken(type));
    assertEq(new Set(tokens).size, tokens.length, 'no two types are drawn in one colour');
    assertEq(format.typeToken('idea'), format.statusToken('specced'), 'and the purple is shared with the status that means authorized');
    const foreign = format.typeChip('question');
    assert(foreign.includes('omega-chip') && !foreign.includes('omega-badge-tone'),
      'a type outside the vocabulary stays a plain chip');
    assertEq(format.typeChip(''), '', 'no type, no chip');
  });

  await test('every status, type and priority has one glyph, and one table is the whole of it (#136, #149)', () => {
    // Hard-coded on purpose: a silent re-pick is a different board. The table is
    // the one home, read by the card and the dialog alike.
    assertEq(format.CHIP_GLYPHS.bug, 'fa-bug', 'a bug is a bug');
    assertEq(format.CHIP_GLYPHS.enhancement, 'fa-wand-magic-sparkles', 'an enhancement is the wand');
    assertEq(format.CHIP_GLYPHS.idea, 'fa-lightbulb', 'an idea is the lamp');
    assertEq(format.CHIP_GLYPHS.high, 'fa-angles-up', 'high points up');
    assertEq(format.CHIP_GLYPHS.low, 'fa-angles-down', 'and low points down');
    // A status wears the act it names, which lets it share a hue with a type or
    // a priority without the two reading as one.
    assertEq(format.CHIP_GLYPHS.inbox, 'fa-inbox', 'inbox is the tray it was captured into');
    assertEq(format.CHIP_GLYPHS.specced, 'fa-clipboard-check', 'specced is the signed-off clipboard');
    assertEq(format.CHIP_GLYPHS.building, 'fa-hammer', 'building is the hammer');
    assertEq(format.CHIP_GLYPHS.qa, 'fa-eye', 'qa is the owner’s eye');
    assertEq(format.CHIP_GLYPHS.complete, 'fa-circle-check', 'complete is the tick that eye gave it (#196)');
    assertEq(format.CHIP_GLYPHS.blocked, 'fa-hand', 'blocked is the raised hand');
    assertEq(format.CHIP_GLYPHS.backlog, 'fa-circle-pause', 'and backlog is the pause');
    const glyphs = Object.values(format.CHIP_GLYPHS);
    assertEq(new Set(glyphs).size, glyphs.length, 'no two names share a glyph');
    assertEq(Object.keys(format.CHIP_GLYPHS).sort().join(','), 'backlog,blocked,bug,building,complete,enhancement,high,idea,inbox,low,qa,specced',
      'and the table names the three vocabularies and nothing else');
    for (const status of format.STATUSES) {
      assert(format.statusChip(status.key).includes(`<i class="fa-solid ${format.CHIP_GLYPHS[status.key]} me-1"`),
        `a ${status.key} chip wears its own glyph`);
    }
    assert(!format.typeChip('question').includes('<i '), 'and a type outside the vocabulary has neither colour nor glyph');
  });

  await test('a chip draws its glyph before the word, decorative and in the chip’s own colour (#136)', () => {
    // This row is the Board card's chip row (the page adds only spacing, pinned
    // in the board suite), so what one card renders is what this renders.
    const chips = format.issueChips({ type: 'bug', priority: 'high' }, 'mt-auto omega-tower-issue__chips');
    assert(chips.includes('<i class="fa-solid fa-bug me-1" aria-hidden="true"></i>bug'), 'the type chip is glyph then word');
    assert(chips.includes('<i class="fa-solid fa-angles-up me-1" aria-hidden="true"></i>high'), 'and so is the priority chip');
    assert(format.statusChip('building').includes('<i class="fa-solid fa-hammer me-1" aria-hidden="true"></i>building'),
      'and so is the status chip the dialog draws (#149)');
    assert(!/<i [^>]*style=/.test(chips), 'the glyph takes no colour of its own - it inherits the chip’s tone');
    assert(!/<i [^>]*tabindex|<i [^>]*role=/.test(chips), 'and it is no new focus target');
    assert(!chips.includes('<svg'), 'drawn by the framework’s one icon mechanism, not a hand-cut one');
    assert(!format.issueChips({ type: '', priority: '' }).includes('<i '), 'an issue with neither draws no glyph at all');
  });

  await test('the glyph is spaced off the word and sits on its optical centre (#136)', () => {
    // The theme's `.omega-badge-tone` makes the chip inline-block after
    // `.omega-chip`'s inline-flex at equal specificity, so a flex gap never
    // applies.
    for (const chip of [format.typeChip('bug'), format.priorityChip('low')]) {
      assert(/<i class="fa-solid fa-[a-z-]+ me-1"/.test(chip), 'the glyph carries the framework\'s own margin utility, since there is no gap to inherit');
    }
  });

  await test('an issue waiting on one the board still holds wears a chip saying so', () => {
    // Advisory only: the plain muted chip every undyed value wears, drawn only
    // while the blocker is on the board the card sits on.
    const issue = {
      repo: 'owner/repo',
      type: 'bug',
      blockedBy: [{ repo: 'owner/repo', number: 12 }, { repo: 'other/repo', number: 3 }],
    };
    const open = new Set(['owner/repo#12', 'other/repo#3']);
    const chips = format.issueChips(issue, '', open);
    assert(chips.includes('<span class="omega-chip">waits on #12</span>'), 'a blocker in the same repo is said the short way');
    assert(chips.includes('<span class="omega-chip">waits on other/repo#3</span>'), 'and one in another repo carries its slug');
    assert(!format.waitsOnChips(issue, open).includes('omega-badge-tone'),
      'in the plain muted chip, borrowing no status or priority colour');
    assertEq(chips.includes(format.waitsOnChips(issue, open)), true, 'the row draws format.js’s own helper, not a second copy of it');
  });

  await test('a blocker spelled in another case is the same issue, said the short way', () => {
    // Repo names are case-insensitive on GitHub, and the inline fallback is
    // hand-typed - the chip must not vanish over a capital letter.
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'OWNER/Repo', number: 12 }] };
    const chips = format.issueChips(issue, '', new Set(['owner/repo#12']));
    assert(chips.includes('<span class="omega-chip">waits on #12</span>'),
      'matched against the sweep and recognized as this repo despite the spelling');
  });

  await test('a blocker the board is not holding is drawn nowhere', () => {
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'owner/repo', number: 12 }] };
    assertEq(format.issueChips(issue, '', new Set(['owner/repo#9'])).includes('waits on'), false,
      'a closed dependency, or one outside the sweep, is not a chip');
    assertEq(format.issueChips(issue).includes('waits on'), false, 'and a caller with no board to judge against draws none');
    assertEq(format.waitsOnChips({}, new Set()), '', 'an issue with no edges at all draws nothing');
  });

  await test('a hostile blocker repo comes back as text', () => {
    const chips = format.issueChips(
      { repo: 'owner/repo', blockedBy: [{ repo: '<img src=x>/repo', number: 4 }] },
      '',
      new Set(['<img src=x>/repo#4']),
    );
    assert(!chips.includes('<img'), 'the blocker’s repo is remote data like every other value');
    assert(chips.includes('&lt;img src=x&gt;/repo#4'), 'and shows as what it says');
  });

  await test('an issue with nothing to say draws no chips', () => {
    const chips = format.issueChips({ type: '', priority: '', agentOk: false, assignees: [] });
    assert(!chips.includes('omega-chip'), 'no chip markup at all');
    assert(!chips.includes('@'), 'and no empty handle');
  });

  await test('a hostile issue field comes back as text', () => {
    const chips = format.issueChips({ type: '<script>x</script>', assignees: ['<b>me</b>'] });
    assert(!chips.includes('<script>'), 'the type is escaped');
    assert(!chips.includes('<b>'), 'and so is the handle');
  });

  await test('the caller can space the chip row without a second copy of it', () => {
    assert(format.issueChips({ type: 'bug' }, 'mt-1').includes('gap-1 mt-1'), 'the extra class lands on the row');
    assert(!format.issueChips({ type: 'bug' }).includes('gap-1 '), 'and nothing dangles when none is given');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
