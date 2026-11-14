//
// Tests for the tower dashboard's format.js: values into markup.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

describe('tower/app: format - values into markup', () => {
  let format;
  before(async () => { ({ format } = await loadLibs()); });

  test('esc turns every markup character into text', () => {
    expect(format.esc('<img src=x onerror="alert(1)">'), 'escaped').toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(format.esc('a & b'), 'the ampersand goes first, so nothing is double-escaped').toBe('a &amp; b');
    expect(format.esc(null), 'null is nothing, never the word null').toBe('');
    expect(format.esc(0), 'and zero is still zero').toBe('0');
  });

  test('num keeps a real zero and only shows a dash for the unknown', () => {
    expect(format.num(0), 'zero open issues is a fact').toBe('0');
    expect(format.num(null), 'unknown is not zero').toBe('-');
    expect(format.num(undefined), 'and neither is absent').toBe('-');
  });

  test('compact scales at each threshold and refuses a non-number', () => {
    expect(format.compact(999), 'under a thousand is itself').toBe('999');
    expect(format.compact(1000), 'the thousand boundary').toBe('1.0K');
    expect(format.compact(1234567), 'millions to two places').toBe('1.23M');
    expect(format.compact(2500000000), 'billions too').toBe('2.50B');
    expect(format.compact(-1500), 'a negative scales the same way').toBe('-1.5K');
    expect(format.compact('nope'), 'a non-number is unknown, not NaN on the page').toBe('-');
  });

  test('money is precise where a cost is small and rounder where it is not', () => {
    expect(format.money(0.0125), 'three places under ten dollars').toBe('$0.013');
    expect(format.money(42.5), 'two places above it').toBe('$42.50');
    // An unpriced model is `null`, and every caller checks for it before asking
    // for a dollar amount - what reaches here is always a number or a mistake.
    expect(format.money('nope'), 'a non-number is a dash, never $NaN').toBe('-');
  });

  test('day draws the day, and the caller says what no date looks like', () => {
    const stamp = '2026-08-19T09:00:00Z';
    const drawn = format.day(stamp);
    expect(drawn.includes('2026') && drawn !== stamp, `a timestamp is drawn as its day, never as the string it arrived as: ${drawn}`).toBeTruthy();
    // The two surfaces want opposite things out of an absent date, which is why
    // the fallback is an argument rather than a decision made here.
    expect(format.day(''), 'a line that is only a date would rather be absent than be a dash').toBe('');
    expect(format.day(undefined), 'and an absent value is the same nothing').toBe('');
    expect(format.day('not a date', '-'), 'while a labelled row asks for the dash it draws').toBe('-');
    expect(format.day(undefined, '-'), 'whatever shape the missing date arrived in').toBe('-');
  });

  test('documentMeta is what a post is and when, and never a lone separator', () => {
    const stamp = '2026-08-19T09:00:00Z';
    expect(format.documentMeta({ kind: 'brief', createdAt: stamp }), 'what it is and the day it was published').toBe(`brief · ${format.day(stamp)}`);
    expect(format.documentMeta({ kind: 'summary' }), 'a post with no date is its kind alone').toBe('summary');
    expect(format.documentMeta({ createdAt: stamp }), 'and one with no kind is the day alone').toBe(format.day(stamp));
    expect(format.documentMeta({}), 'a document that says neither says nothing at all').toBe('');
  });

  test('shortPath names a repo by its last segment', () => {
    expect(format.shortPath('/Users/alice/Developer/Repositories/acme/workkit'), 'the leaf').toBe('workkit');
    expect(format.shortPath('/trailing/slash/'), 'a trailing slash is not a segment').toBe('slash');
    expect(format.shortPath(''), 'nothing in, nothing out').toBe('');
  });

  test('the board’s columns are the pipeline in stage order, the waiting states apart from it', () => {
    expect(format.STATUSES.map((s) => s.key).join(','), 'the stages in the order the spec defines them, `complete` between the check and the ship (#196)').toBe('inbox,specced,building,qa,complete,blocked,backlog');
    expect(format.STATUSES.map((s) => s.label).join(','), 'and each column is titled the way a human reads it').toBe('Inbox,Specced,Building,QA,Complete,Blocked,Backlog');
    expect(format.STATUSES.length, 'seven lanes - a missing label is not a place an issue lives (#118)').toBe(7);
    expect(!format.STATUSES.some((s) => !s.key), 'so no column stands for the absence of one').toBeTruthy();
    // The pocket flag splits the Board's two regions, so a status added without
    // one lands in the pipeline as a stage; a waiting state has to say so.
    expect(format.STATUSES.filter((s) => !s.pocket).map((s) => s.key).join(','), 'the pipeline is the five stages, and they read as a flow').toBe('inbox,specced,building,qa,complete');
    expect(format.STATUSES.filter((s) => s.pocket).map((s) => s.key).join(','), 'and the pockets are the two states of waiting, which are no stage at all').toBe('blocked,backlog');
  });

  test('every status has a colour, and one the pipeline does not name still has one', () => {
    for (const status of format.STATUSES) {
      expect(format.statusColor(status.key).startsWith('var(--omega-'), `${status.key || 'no status'} resolves to a theme token`).toBeTruthy();
    }
    expect(format.statusToken('nonsense'), 'an unknown status is drawn, not dropped').toBe('--omega-ink-muted');
    expect(format.statusToken('building') !== format.statusToken(''),
      'in-flight work and a status the vocabulary does not name never share a colour').toBeTruthy();
    // One lane, one colour: a column header, a card chip and a chart slice are
    // all read by hue.
    const tokens = format.STATUSES.map((status) => format.statusToken(status.key));
    expect(new Set(tokens).size, 'no two statuses are drawn in one colour').toBe(tokens.length);
    // The ok green is a verdict: `complete` is the check passed, and `qa`, the
    // wait for it, wears the one ramp slot no vocabulary had taken.
    expect(format.statusToken('complete'), 'complete wears the ok green - the check passed, ready to ship').toBe('--omega-ok');
    expect(format.statusToken('qa'), 'qa gives that green up for the magenta - waiting on a check is no verdict (#203)').toBe('--omega-chart-4');
    expect(format.statusToken('specced'), 'and specced gave it up for the categorical purple before either').toBe('--omega-chart-3');
  });

  test('a priority is drawn from the theme, and the unlabelled middle is neutral', () => {
    expect(format.priorityToken('high'), 'high takes the theme’s alarm red').toBe('--omega-danger');
    expect(format.priorityToken('low'), 'and low the faint end').toBe('--omega-ink-faint');
    expect(format.priorityToken(''), 'normal priority is never written on an issue and is drawn neutral').toBe('--omega-ink-muted');
    expect(format.priorityToken('nonsense'), 'and so is a priority the vocabulary does not name').toBe('--omega-ink-muted');
    // A hue is unique inside a vocabulary and free across them, since every chip
    // carries its own word and glyph. "High" and "blocked" both want attention;
    // "low" and "backlog" both say the opposite about urgency.
    expect(format.priorityToken('high'), 'the loud end is the one the pipeline raises its hand in').toBe(format.statusToken('blocked'));
    expect(format.priorityToken('low'), 'and the quiet end is the one the pipeline parks in').toBe(format.statusToken('backlog'));
    expect(new Set([format.priorityToken('high'), format.priorityToken('low')]).size, 'and the two ends of the one vocabulary are never the same colour').toBe(2);
  });

  test('a status chip is the colour its Board column header carries', () => {
    for (const status of format.STATUSES) {
      const chip = format.statusChip(status.key);
      expect(chip.includes(`--omega-tone: ${format.statusColor(status.key)}`), `${status.key} is drawn in the column’s own token`).toBeTruthy();
      expect(chip.includes('omega-badge-tone'), 'through the framework’s tone chip, never a colour of its own').toBeTruthy();
      expect(chip.includes(`>${status.key}<`), 'labelled with the status itself').toBeTruthy();
    }
    expect(format.statusChip(''), 'an issue carrying no status draws no chip').toBe('');
    expect(!format.statusChip('<img src=x>').includes('<img'), 'a hostile status is escaped').toBeTruthy();
  });

  // ── The missing-status alert ─────────────────────────────────────────────
  // A missing `status:` label is a pipeline fault the daily heal repairs, not a
  // place an issue lives, so it is drawn as an alarm above the board.

  test('issues carrying no status label become one danger alert, not a column', () => {
    const markup = format.noStatusAlert([
      { repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'https://github.com/ITW/workkit/issues/4' },
      { repo: 'ITW/workkit', number: 9, title: 'Other thing', status: '', url: 'https://github.com/ITW/workkit/issues/9' },
      { repo: 'ITW/workkit', number: 12, title: 'Fine', status: 'building', url: 'https://github.com/ITW/workkit/issues/12' },
    ]);
    expect(markup.includes('alert-danger'), 'in the theme’s danger tone, which no ordinary board state uses').toBeTruthy();
    expect(markup.includes('2 issues carry no status label'), 'counting only the ones missing a label').toBeTruthy();
    expect(markup.includes('href="https://github.com/ITW/workkit/issues/4"'), 'each one a link to its GitHub page').toBeTruthy();
    expect(markup.includes('href="https://github.com/ITW/workkit/issues/9"'), 'including the one whose label is the empty string').toBeTruthy();
    expect(!markup.includes('/issues/12'), 'and an issue that carries a status is not in it').toBeTruthy();
    expect(markup.includes('target="_blank"') && markup.includes('rel="noopener"'), 'opening away from the board, like every other external link').toBeTruthy();
  });

  test('the alert says the singular when there is one, and nothing at all when there are none', () => {
    const one = format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, title: 'Alone', url: 'u' }]);
    expect(one.includes('1 issue carries no status label'), 'one issue is not "1 issues"').toBeTruthy();
    expect(format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, status: 'inbox', title: 'Fine', url: 'u' }]), 'a board whose every issue is labelled draws nothing - the normal day').toBe('');
    expect(format.noStatusAlert([]), 'and neither does an empty board').toBe('');
  });

  test('the alert names the repo only when the board is showing several', () => {
    const issues = [{ repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'u' }];
    const many = format.noStatusAlert(issues, true);
    expect(many.includes('ITW/workkit') && many.includes('#4'), 'a multi-repo board qualifies the issue by repo, as its cards do').toBeTruthy();
    const one = format.noStatusAlert(issues, false);
    expect(!one.includes('ITW/workkit') && one.includes('#4'), 'and a single-repo board does not repeat what the whole page already says').toBeTruthy();
  });

  test('a hostile title in the alert renders as text', () => {
    const markup = format.noStatusAlert([{
      repo: '<img src=x>', number: 4, title: '<script>alert(1)</script>', url: '" onmouseover="x',
    }], true);
    expect(!markup.includes('<script>'), 'the title is escaped').toBeTruthy();
    expect(!markup.includes('<img'), 'and so is the repo slug').toBeTruthy();
    expect(!markup.includes('" onmouseover="x"'), 'and a url cannot break out of its attribute').toBeTruthy();
  });

  test('the chart series keeps unlabeled issues visible, and only while they exist', () => {
    // A chart that dropped unlabeled issues would sum short of the open count
    // beside it. Hard-coded expectations either side of the boundary.
    const clean = format.statusBreakdown([
      { status: 'inbox' }, { status: 'building' }, { status: 'building' },
    ]);
    expect(clean.labels.join(','), 'no drift means seven slices, nothing more').toBe('Inbox,Specced,Building,QA,Complete,Blocked,Backlog');
    expect(clean.values.join(','), 'each status counts its own').toBe('1,0,2,0,0,0,0');
    expect(clean.labels.length, 'labels and colors stay in step').toBe(clean.colors.length);
    // The series is the column list's own: STATUSES, never a list of its own.
    expect(clean.labels.length, 'one slice per lane, and the lanes are format.js’s').toBe(format.STATUSES.length);

    const drifted = format.statusBreakdown([{ status: 'inbox' }, { status: '' }, {}]);
    expect(drifted.labels[drifted.labels.length - 1], 'an unlabeled issue is a visible slice').toBe('No status');
    expect(drifted.values.join(','), 'counted, so the ring sums to the open count').toBe('1,0,0,0,0,0,0,2');
    expect(drifted.values.reduce((sum, value) => sum + value, 0), 'nothing dropped').toBe(3);
    expect(drifted.colors[drifted.colors.length - 1] !== format.statusColor('blocked'), 'and its color is no pipeline status’s').toBeTruthy();
  });

  test('a priority chip is drawn through the same system, at both ends', () => {
    const high = format.priorityChip('high');
    const low = format.priorityChip('low');
    expect(high.includes('--omega-tone: var(--omega-danger)') && high.includes('>high<'), 'high in the alarm colour').toBeTruthy();
    expect(low.includes('--omega-tone: var(--omega-ink-faint)') && low.includes('>low<'), 'low in the faint one').toBeTruthy();
    expect(high.includes('omega-badge-tone') && low.includes('omega-badge-tone'), 'both through the tone chip').toBeTruthy();
    expect(format.priorityChip(''), 'the unlabelled middle draws nothing').toBe('');
    expect(format.priorityChip('nonsense'), 'and neither does a priority that is not one').toBe('');
  });

  test('a column reads in three priority bands, newest first inside each', () => {
    const issue = (priority, updatedAt) => ({ priority, updatedAt });
    const shuffled = [
      issue('low', '2026-07-30'),
      issue(null, '2026-07-28'),
      issue('high', '2026-07-20'),
      issue(null, '2026-07-29'),
      issue('high', '2026-07-21'),
      issue('low', '2026-07-31'),
    ];
    const sorted = [...shuffled].sort(format.byPriority);
    expect(sorted.map((one) => one.priority || 'normal').join(','), 'high above the unlabelled middle, and low below it').toBe('high,high,normal,normal,low,low');
    expect(sorted.map((one) => one.updatedAt).join(','), 'and the band is broken by the most recently touched').toBe('2026-07-21,2026-07-20,2026-07-29,2026-07-28,2026-07-31,2026-07-30');
    expect(format.byPriority(issue('high', '2026-07-01'), issue('low', '2026-07-31')) < 0,
      'a stale high still outranks a fresh low').toBeTruthy();
    expect(format.byPriority(issue(null, ''), issue(null, '')), 'two issues with nothing to sort by tie').toBe(0);
  });

  test('an empty state is an icon above a line, and says which nothing it is', () => {
    const state = format.empty('nothing here');
    expect(state.includes('fa-regular fa-folder-open'), 'the neutral default icon').toBeTruthy();
    expect(state.includes('aria-hidden="true"'), 'which is decorative - the line carries the meaning').toBeTruthy();
    expect(state.includes('>nothing here<'), 'and the line itself').toBeTruthy();
    expect(state.includes('text-body-secondary'), 'drawn in the theme’s quiet ink, never as an alarm').toBeTruthy();
    const chosen = format.empty('no live sessions', 'fa-regular fa-moon');
    expect(chosen.includes('fa-regular fa-moon') && !chosen.includes('fa-folder-open'), 'the caller’s icon replaces the default').toBeTruthy();
    expect(!format.empty('<script>x</script>', '"><img src=x>').includes('<script>'), 'a hostile message is escaped').toBeTruthy();
    expect(!format.empty('nothing', '"><img src=x>').includes('<img'), 'and so is an icon name').toBeTruthy();
  });

  test('that icon is centred by a rule of its own, over the line it sits above (#142)', () => {
    // `text-center` centres inline content, and `d-block` (a Bootstrap
    // `!important` utility) beats the framework's `i[data-omega-fa] { display:
    // inline-flex }`, leaving a block box hugging the left edge.
    expect(format.empty('nothing here').includes('class="omega-tower-empty '), 'the helper carries the hook the sheet centres from').toBeTruthy();
  });

  test('a model id falls in its family whatever it is decorated with', () => {
    expect(format.modelKey('claude-opus-5'), 'the plain id').toBe('opus');
    expect(format.modelKey('claude-opus-5[1m]'), 'a context variant is the same model').toBe('opus');
    expect(format.modelKey('claude-opus-4-1-20250805'), 'and so is a dated build').toBe('opus');
    expect(format.modelKey('claude-3-7-sonnet'), 'the family is not always last in the id').toBe('sonnet');
    expect(format.modelKey('claude-haiku-4-5'), 'haiku').toBe('haiku');
    expect(format.modelKey('fable'), 'and the top rung').toBe('fable');
    expect(format.modelKey('<synthetic>'), 'a locally generated message belongs to no model').toBe('other');
    expect(format.modelKey(null), 'and an unknown model still has a slot').toBe('other');
  });

  test('an agent class falls in its own slot, prefixed or not', () => {
    expect(format.classKey('worker'), 'the bare name the API sends').toBe('worker');
    expect(format.classKey('workkit:verifier'), 'and the namespaced one').toBe('verifier');
    expect(format.classKey('manager'), 'the root tier telemetry counts').toBe('manager');
    expect(format.classKey('general-purpose'), 'a built-in agent is drawn neutral, not as crew').toBe('other');
    expect(format.classKey(''), 'and so is no class at all').toBe('other');
  });

  test('a badge is a chip in its tone, and its label is text', () => {
    const badge = format.modelBadge('claude-opus-5[1m]');
    expect(badge.includes('omega-chip omega-badge-tone omega-tone-2'), 'the theme chip, in the opus tone').toBeTruthy();
    expect(badge.includes('claude-opus-5[1m]'), 'labelled with the id itself').toBeTruthy();
    expect(format.badgeColor('opus'), 'and the chart reads the same tone as a token').toBe('var(--omega-chart-2)');
    expect(!format.classBadge('<img src=x>').includes('<img'), 'a hostile class name is escaped').toBeTruthy();
    expect(format.modelBadge(null).includes('model unknown'), 'an unknown model says so rather than drawing empty').toBeTruthy();
  });

  test('every name the tower draws has a tone, and no vocabulary repeats one', () => {
    const models = ['fable', 'opus', 'sonnet', 'haiku'].map((key) => format.badgeColor(key));
    const classes = ['manager', 'advisor', 'worker', 'verifier', 'scout', 'reviewer'].map((key) => format.badgeColor(key));
    expect(models.every((color) => color.startsWith('var(--omega-chart-')), 'a model is drawn from the ramp').toBeTruthy();
    expect(classes.every((color) => color.startsWith('var(--omega-chart-')), 'and so is a crew class').toBeTruthy();
    expect(new Set(models).size, 'two models never share a tone').toBe(models.length);
    expect(new Set(classes).size, 'and neither do two classes').toBe(classes.length);
    // Ten names over a six-slot ramp: a name with no tone is drawn in the muted
    // ink `.omega-badge-tone` falls back to, never in another name's colour.
    expect(format.badgeColor('other'), 'and everything else is neutral').toBe('var(--omega-ink-muted)');
    expect(!format.classBadge('general-purpose').includes('omega-tone-'), 'which is no tone class at all').toBeTruthy();
    // Ten names over six slots forces sharing, so the table pins who shares: a
    // class chip and the model chip beside it on a real crew card never match
    // (pairings per hooks/manager/resources/ladder.json; a reviewer inherits the
    // session's model, so it pairs with fable and opus both).
    const pairings = [
      ['manager', 'fable'], ['advisor', 'fable'], ['scout', 'sonnet'],
      ['worker', 'opus'], ['verifier', 'opus'], ['reviewer', 'opus'], ['reviewer', 'fable'],
    ];
    for (const [cls, model] of pairings) {
      expect(format.badgeColor(cls) !== format.badgeColor(model), `${cls} and ${model} appear side by side and must differ`).toBeTruthy();
    }
  });

  test('cap shows the head of a list and counts what it held back', () => {
    const five = [1, 2, 3, 4, 5];
    expect(format.cap(five).shown.length, 'exactly five fits').toBe(5);
    expect(format.cap(five).hidden, 'with nothing behind it').toBe(0);
    expect(format.cap([...five, 6, 7]).shown.length, 'a longer list is cut').toBe(5);
    expect(format.cap([...five, 6, 7]).hidden, 'and says how many are on the other page').toBe(2);
    expect(format.cap([]).hidden, 'an empty list hides nothing').toBe(0);
    expect(format.cap(undefined).shown.length, 'and a list that is not there is empty, not a crash').toBe(0);
    expect(format.cap(five, 2).shown.length, 'the caller can set the limit').toBe(2);
  });

  test('a stat cell is a link only when it is given somewhere to go', () => {
    expect(format.statCell('Open', 3).startsWith('<div'), 'a plain tile is a div').toBeTruthy();
    const linked = format.statCell('Open', 3, '/board');
    expect(linked.startsWith('<a') && linked.includes('href="/board"'), 'and a linked one is an anchor').toBeTruthy();
  });

  test('a tile with no reading says a dash and carries why as its tooltip', () => {
    const cell = format.statCell('Live sessions', format.num(null), '/crew', format.LOCAL_ONLY_NOTICE);
    expect(cell.includes('>-</h3>'), 'the value is a dash, never a fabricated 0').toBeTruthy();
    expect(cell.includes(`title="${format.LOCAL_ONLY_NOTICE}"`), 'and the sentence behind it is one hover away').toBeTruthy();
    expect(!format.statCell('Open', 3, '/board').includes('title='), 'a tile with a real number needs none').toBeTruthy();
  });

  test('a tile wears a sub-line only when there is a comparison to draw', () => {
    // The sub-line compares the number with a week ago; a tile with no history
    // behind it keeps its plain shape.
    const cell = format.statCell('Open issues', 12, '/board', undefined, 'down 3 from last week');
    expect(cell.includes('>down 3 from last week</p>'), 'the comparison is drawn as its own line').toBeTruthy();
    expect(cell.indexOf('</h3>') < cell.indexOf('down 3'), 'under the number, not beside the label').toBeTruthy();
    expect(!format.statCell('Open issues', 12, '/board').includes('<p'), 'and a tile with nothing to compare carries no line').toBeTruthy();
    expect(format.statCell('Open', 1, '', undefined, '<img src=x>').includes('&lt;img'), 'a sub-line is escaped like every other value').toBeTruthy();
  });
});
