//
// Tests for the tower dashboard's format.js: the chips an issue carries.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

describe('tower/app: format - the issue chips', () => {
  let format;
  before(async () => { ({ format } = await loadLibs()); });

  test('an issue shows exactly the chips it earns', () => {
    const chips = format.issueChips({
      type: 'bug', priority: 'high', agentOk: true, assignees: ['alice', 'someone'],
    });
    expect(chips.includes('>bug<'), 'the type').toBeTruthy();
    expect(chips.includes('high'), 'the priority').toBeTruthy();
    expect(chips.includes('agent:ok'), 'the agent grant').toBeTruthy();
    expect(chips.includes('@alice, @someone'), 'every assignee, each with its handle').toBeTruthy();
  });

  test('both ends of the priority scale are drawn through the one colour system', () => {
    const ends = { high: '--omega-danger', low: '--omega-ink-faint' };
    for (const [priority, token] of Object.entries(ends)) {
      const chips = format.issueChips({ type: 'bug', priority });
      expect(chips.includes(`--omega-tone: var(${token})`), `${priority} is drawn in its own token`).toBeTruthy();
      expect(chips.includes(format.priorityChip(priority)), `${priority} is the chip format.js draws`).toBe(true);
      expect(!chips.includes('omega-chip--accent'), 'and never a colour decided at the call site').toBeTruthy();
    }
    expect(!format.issueChips({ type: '', priority: '' }).includes('omega-badge-tone'),
      'the unlabelled middle still draws no priority chip').toBeTruthy();
  });

  test('a type is drawn through the one colour system, in a ramp slot no other type holds', () => {
    // A hue is unique within a category (three types, three hues) and free
    // across them: every chip says its own word and wears its own glyph.
    const slots = { bug: '--omega-danger', enhancement: '--omega-chart-5', idea: '--omega-chart-3' };
    for (const [type, token] of Object.entries(slots)) {
      const chips = format.issueChips({ type, priority: '' });
      expect(chips.includes(`--omega-tone: var(${token})`), `${type} is drawn in its own slot`).toBeTruthy();
      expect(chips.includes(format.typeChip(type)), `${type} is the chip format.js draws`).toBe(true);
    }
    const tokens = Object.keys(slots).map((type) => format.typeToken(type));
    expect(new Set(tokens).size, 'no two types are drawn in one colour').toBe(tokens.length);
    expect(format.typeToken('idea'), 'and the purple is shared with the status that means authorized').toBe(format.statusToken('specced'));
    const foreign = format.typeChip('question');
    expect(foreign.includes('omega-chip') && !foreign.includes('omega-badge-tone'),
      'a type outside the vocabulary stays a plain chip').toBeTruthy();
    expect(format.typeChip(''), 'no type, no chip').toBe('');
  });

  test('every status, type and priority has one glyph, and one table is the whole of it (#136, #149)', () => {
    // Hard-coded on purpose: a silent re-pick is a different board. The table is
    // the one home, read by the card and the dialog alike.
    expect(format.CHIP_GLYPHS.bug, 'a bug is a bug').toBe('fa-bug');
    expect(format.CHIP_GLYPHS.enhancement, 'an enhancement is the wand').toBe('fa-wand-magic-sparkles');
    expect(format.CHIP_GLYPHS.idea, 'an idea is the lamp').toBe('fa-lightbulb');
    expect(format.CHIP_GLYPHS.high, 'high points up').toBe('fa-angles-up');
    expect(format.CHIP_GLYPHS.low, 'and low points down').toBe('fa-angles-down');
    // A status wears the act it names, which lets it share a hue with a type or
    // a priority without the two reading as one.
    expect(format.CHIP_GLYPHS.inbox, 'inbox is the tray it was captured into').toBe('fa-inbox');
    expect(format.CHIP_GLYPHS.specced, 'specced is the signed-off clipboard').toBe('fa-clipboard-check');
    expect(format.CHIP_GLYPHS.building, 'building is the hammer').toBe('fa-hammer');
    expect(format.CHIP_GLYPHS.qa, 'qa is the owner’s eye').toBe('fa-eye');
    expect(format.CHIP_GLYPHS.complete, 'complete is the tick that eye gave it (#196)').toBe('fa-circle-check');
    expect(format.CHIP_GLYPHS.blocked, 'blocked is the raised hand').toBe('fa-hand');
    expect(format.CHIP_GLYPHS.backlog, 'and backlog is the pause').toBe('fa-circle-pause');
    const glyphs = Object.values(format.CHIP_GLYPHS);
    expect(new Set(glyphs).size, 'no two names share a glyph').toBe(glyphs.length);
    expect(Object.keys(format.CHIP_GLYPHS).sort().join(','), 'and the table names the three vocabularies and nothing else').toBe('backlog,blocked,bug,building,complete,enhancement,high,idea,inbox,low,qa,specced');
    for (const status of format.STATUSES) {
      expect(format.statusChip(status.key).includes(`<i class="fa-solid ${format.CHIP_GLYPHS[status.key]} me-1"`),
        `a ${status.key} chip wears its own glyph`).toBeTruthy();
    }
    expect(!format.typeChip('question').includes('<i '), 'and a type outside the vocabulary has neither colour nor glyph').toBeTruthy();
  });

  test('a chip draws its glyph before the word, decorative and in the chip’s own colour (#136)', () => {
    // This row is the Board card's chip row (the page adds only spacing, pinned
    // in the board suite), so what one card renders is what this renders.
    const chips = format.issueChips({ type: 'bug', priority: 'high' }, 'mt-auto omega-tower-issue__chips');
    expect(chips.includes('<i class="fa-solid fa-bug me-1" aria-hidden="true"></i>bug'), 'the type chip is glyph then word').toBeTruthy();
    expect(chips.includes('<i class="fa-solid fa-angles-up me-1" aria-hidden="true"></i>high'), 'and so is the priority chip').toBeTruthy();
    expect(format.statusChip('building').includes('<i class="fa-solid fa-hammer me-1" aria-hidden="true"></i>building'),
      'and so is the status chip the dialog draws (#149)').toBeTruthy();
    expect(!/<i [^>]*style=/.test(chips), 'the glyph takes no colour of its own - it inherits the chip’s tone').toBeTruthy();
    expect(!/<i [^>]*tabindex|<i [^>]*role=/.test(chips), 'and it is no new focus target').toBeTruthy();
    expect(!chips.includes('<svg'), 'drawn by the framework’s one icon mechanism, not a hand-cut one').toBeTruthy();
    expect(!format.issueChips({ type: '', priority: '' }).includes('<i '), 'an issue with neither draws no glyph at all').toBeTruthy();
  });

  test('the glyph is spaced off the word and sits on its optical centre (#136)', () => {
    // The theme's `.omega-badge-tone` makes the chip inline-block after
    // `.omega-chip`'s inline-flex at equal specificity, so a flex gap never
    // applies.
    for (const chip of [format.typeChip('bug'), format.priorityChip('low')]) {
      expect(/<i class="fa-solid fa-[a-z-]+ me-1"/.test(chip), 'the glyph carries the framework\'s own margin utility, since there is no gap to inherit').toBeTruthy();
    }
  });

  test('an issue waiting on one the board still holds wears a chip saying so', () => {
    // Advisory only: the plain muted chip every undyed value wears, drawn only
    // while the blocker is on the board the card sits on.
    const issue = {
      repo: 'owner/repo',
      type: 'bug',
      blockedBy: [{ repo: 'owner/repo', number: 12 }, { repo: 'other/repo', number: 3 }],
    };
    const open = new Set(['owner/repo#12', 'other/repo#3']);
    const chips = format.issueChips(issue, '', open);
    expect(chips.includes('<span class="omega-chip">waits on #12</span>'), 'a blocker in the same repo is said the short way').toBeTruthy();
    expect(chips.includes('<span class="omega-chip">waits on other/repo#3</span>'), 'and one in another repo carries its slug').toBeTruthy();
    expect(!format.waitsOnChips(issue, open).includes('omega-badge-tone'),
      'in the plain muted chip, borrowing no status or priority colour').toBeTruthy();
    expect(chips.includes(format.waitsOnChips(issue, open)), 'the row draws format.js’s own helper, not a second copy of it').toBe(true);
  });

  test('a blocker spelled in another case is the same issue, said the short way', () => {
    // Repo names are case-insensitive on GitHub, and the inline fallback is
    // hand-typed - the chip must not vanish over a capital letter.
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'OWNER/Repo', number: 12 }] };
    const chips = format.issueChips(issue, '', new Set(['owner/repo#12']));
    expect(chips.includes('<span class="omega-chip">waits on #12</span>'),
      'matched against the sweep and recognized as this repo despite the spelling').toBeTruthy();
  });

  test('a blocker the board is not holding is drawn nowhere', () => {
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'owner/repo', number: 12 }] };
    expect(format.issueChips(issue, '', new Set(['owner/repo#9'])).includes('waits on'), 'a closed dependency, or one outside the sweep, is not a chip').toBe(false);
    expect(format.issueChips(issue).includes('waits on'), 'and a caller with no board to judge against draws none').toBe(false);
    expect(format.waitsOnChips({}, new Set()), 'an issue with no edges at all draws nothing').toBe('');
  });

  test('a hostile blocker repo comes back as text', () => {
    const chips = format.issueChips(
      { repo: 'owner/repo', blockedBy: [{ repo: '<img src=x>/repo', number: 4 }] },
      '',
      new Set(['<img src=x>/repo#4']),
    );
    expect(!chips.includes('<img'), 'the blocker’s repo is remote data like every other value').toBeTruthy();
    expect(chips.includes('&lt;img src=x&gt;/repo#4'), 'and shows as what it says').toBeTruthy();
  });

  test('an issue with nothing to say draws no chips', () => {
    const chips = format.issueChips({ type: '', priority: '', agentOk: false, assignees: [] });
    expect(!chips.includes('omega-chip'), 'no chip markup at all').toBeTruthy();
    expect(!chips.includes('@'), 'and no empty handle').toBeTruthy();
  });

  test('a hostile issue field comes back as text', () => {
    const chips = format.issueChips({ type: '<script>x</script>', assignees: ['<b>me</b>'] });
    expect(!chips.includes('<script>'), 'the type is escaped').toBeTruthy();
    expect(!chips.includes('<b>'), 'and so is the handle').toBeTruthy();
  });

  test('the caller can space the chip row without a second copy of it', () => {
    expect(format.issueChips({ type: 'bug' }, 'mt-1').includes('gap-1 mt-1'), 'the extra class lands on the row').toBeTruthy();
    expect(!format.issueChips({ type: 'bug' }).includes('gap-1 '), 'and nothing dangles when none is given').toBeTruthy();
  });
});
