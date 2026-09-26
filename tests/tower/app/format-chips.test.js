//
// Tests for the tower dashboard's format.js: the chips an issue carries.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
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
    // #149: the rule is within-category uniqueness - three types, three hues.
    // Across the categories a hue is free (`idea` and `specced` share the
    // purple), because a chip says its own word and wears its own glyph.
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
    // Hard-coded on purpose: the glyphs are what makes a column of cards
    // readable at a glance, and a silent re-pick is a different board. The
    // table is the ONE home - the card and the dialog both read it, so a chip
    // cannot say different things on the two surfaces.
    assertEq(format.CHIP_GLYPHS.bug, 'fa-bug', 'a bug is a bug');
    assertEq(format.CHIP_GLYPHS.enhancement, 'fa-wand-magic-sparkles', 'an enhancement is the wand');
    assertEq(format.CHIP_GLYPHS.idea, 'fa-lightbulb', 'an idea is the lamp');
    assertEq(format.CHIP_GLYPHS.high, 'fa-angles-up', 'high points up');
    assertEq(format.CHIP_GLYPHS.low, 'fa-angles-down', 'and low points down');
    // #149: a status wears the act it names, which is also what lets it share
    // a hue with a type or a priority without the two being read as one.
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
    // This row IS the Board card's chip row - the page hands it the card's
    // spacing and nothing more (pinned in the board suite below) - so what one
    // card renders is what this renders.
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
    // The defect this proves against: the chip is an inline-BLOCK - the theme's
    // `.omega-badge-tone` sets it and comes after `.omega-chip`'s inline-flex
    // at equal specificity - so the flex gap the markup was written against
    // never applied and the glyph rendered flush against the word. Both halves
    // of the fix are pinned by hand: neither is visible from Node, and both are
    // exactly the kind of thing a later edit drops without noticing.
    const fs = require('fs');
    for (const chip of [format.typeChip('bug'), format.priorityChip('low')]) {
      assert(/<i class="fa-solid fa-[a-z-]+ me-1"/.test(chip), 'the glyph carries the framework\'s own margin utility, since there is no gap to inherit');
    }
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const nudge = /\.omega-chip i\.fa-solid svg(?:, [^{]+)? \{ vertical-align: (\S+?); \}/.exec(sheet);
    assert(nudge, 'and the sheet nudges the svg the renderer fills that `i` with - `.fa svg`, the framework\'s own rule, never reaches an `i` written `fa-solid` alone');
    assertEq(nudge[1], '-.125em', 'by the framework\'s own number, so a chip glyph sits where every other icon does');
  });

  await test('the Board card draws that row, and no surface names a glyph of its own (#136)', () => {
    const fs = require('fs');
    const js = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js');
    const source = fs.readFileSync(path.join(js, 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*issueChips[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(source), 'the chips come from format.js');
    assert(source.includes('${issueChips(issue, \'mt-auto omega-tower-issue__chips\', open)}'),
      'and the card hands it spacing, never a chip of its own');
    // Every name in the table against every surface that draws chips: a
    // hand-written `<i class="fa-solid fa-lightbulb">` beside the row is a
    // second table, and the drift starts the day the two disagree.
    for (const surface of ['pages/board.js', 'pages/brief.js', 'libs/tower/modal/issue.js', 'libs/tower/modal/agent.js', 'libs/tower/modal/document.js']) {
      const drawn = fs.readFileSync(path.join(js, ...surface.split('/')), 'utf8');
      for (const glyph of Object.values(format.CHIP_GLYPHS)) {
        assert(!drawn.includes(glyph), `${surface} names no chip glyph (${glyph}) - the table owns which picture means what`);
      }
    }
  });

  await test('the Board column header wears the status glyph its chip wears (#289)', () => {
    // The header names a status the way a chip does, so it draws the same
    // picture from the same table, through the one helper - never a glyph of
    // its own (the case above holds that for the page).
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*chipGlyph[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(source), 'the glyph comes from format.js');
    assert(source.includes('<span>${chipGlyph(status.key)}${esc(status.label)}</span>'), 'and the header draws it before the label');
    // The header is no chip, so the chip's vertical nudge (the case above)
    // has to name it too, or the glyph sits high there exactly as #136 found.
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    assert(/\.omega-panel-head i\.fa-solid svg[^{]*\{ vertical-align: -\.125em; \}/.test(sheet), 'and the sheet nudges the header glyph by the same number');
  });

  await test('every nav, topbar and page header icon carries its own Font Awesome classes (#288)', () => {
    // The theme emits an `icon` verbatim and adds only its size, so a bare
    // name (`gauge-high`) builds `<i class="gauge-high fa-sm">`, which no
    // renderer resolves: the glyph draws nothing and nothing says so. The
    // three sites are data, so a regex over their text is the whole read.
    const fs = require('fs');
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src');
    const sections = path.join(src, '_includes', 'backend', 'sections');
    const pages = path.join(src, 'pages');
    const sites = [
      path.join(sections, 'sidebar.json'),
      path.join(sections, 'topbar.json'),
      ...fs.readdirSync(pages).filter((name) => name.endsWith('.md')).map((name) => path.join(pages, name)),
    ];
    const bare = [];
    for (const site of sites) {
      const icons = [...fs.readFileSync(site, 'utf8').matchAll(/\bicon:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
      assert(icons.length > 0, `${path.basename(site)} carries an icon to check`);
      bare.push(...icons.filter((icon) => !/^fa-(solid|regular|brands) fa-[a-z0-9-]+$/.test(icon)).map((icon) => `${path.basename(site)}: ${icon}`));
    }
    assertEq(bare.join(', '), '', 'every icon is a family and a name');
  });

  await test('an issue waiting on one the board still holds wears a chip saying so', () => {
    // Issue #103: advisory and nothing more - the chip is the plain muted one
    // every undyed value wears, never a status or priority hue, and it is drawn
    // only while the blocker is on the board the card sits on.
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
