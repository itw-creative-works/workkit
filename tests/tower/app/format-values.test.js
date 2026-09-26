//
// Tests for the tower dashboard's format.js: values into markup.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs } = require('./helpers');

const run = async () => {
  const { format } = await loadLibs();

  group('tower/app: format - values into markup');

  await test('esc turns every markup character into text', () => {
    assertEq(format.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', 'escaped');
    assertEq(format.esc('a & b'), 'a &amp; b', 'the ampersand goes first, so nothing is double-escaped');
    assertEq(format.esc(null), '', 'null is nothing, never the word null');
    assertEq(format.esc(0), '0', 'and zero is still zero');
  });

  await test('num keeps a real zero and only shows a dash for the unknown', () => {
    assertEq(format.num(0), '0', 'zero open issues is a fact');
    assertEq(format.num(null), '-', 'unknown is not zero');
    assertEq(format.num(undefined), '-', 'and neither is absent');
  });

  await test('compact scales at each threshold and refuses a non-number', () => {
    assertEq(format.compact(999), '999', 'under a thousand is itself');
    assertEq(format.compact(1000), '1.0K', 'the thousand boundary');
    assertEq(format.compact(1234567), '1.23M', 'millions to two places');
    assertEq(format.compact(2500000000), '2.50B', 'billions too');
    assertEq(format.compact(-1500), '-1.5K', 'a negative scales the same way');
    assertEq(format.compact('nope'), '-', 'a non-number is unknown, not NaN on the page');
  });

  await test('money is precise where a cost is small and rounder where it is not', () => {
    assertEq(format.money(0.0125), '$0.013', 'three places under ten dollars');
    assertEq(format.money(42.5), '$42.50', 'two places above it');
    // An unpriced model is `null`, and every caller checks for it before asking
    // for a dollar amount - what reaches here is always a number or a mistake.
    assertEq(format.money('nope'), '-', 'a non-number is a dash, never $NaN');
  });

  await test('day draws the day, and the caller says what no date looks like', () => {
    const stamp = '2026-08-19T09:00:00Z';
    const drawn = format.day(stamp);
    assert(drawn.includes('2026') && drawn !== stamp, `a timestamp is drawn as its day, never as the string it arrived as: ${drawn}`);
    // The two surfaces want opposite things out of an absent date, which is why
    // the fallback is an argument rather than a decision made here.
    assertEq(format.day(''), '', 'a line that is only a date would rather be absent than be a dash');
    assertEq(format.day(undefined), '', 'and an absent value is the same nothing');
    assertEq(format.day('not a date', '-'), '-', 'while a labelled row asks for the dash it draws');
    assertEq(format.day(undefined, '-'), '-', 'whatever shape the missing date arrived in');
  });

  await test('documentMeta is what a post is and when, and never a lone separator', () => {
    const stamp = '2026-08-19T09:00:00Z';
    assertEq(format.documentMeta({ kind: 'brief', createdAt: stamp }), `brief · ${format.day(stamp)}`,
      'what it is and the day it was published');
    assertEq(format.documentMeta({ kind: 'summary' }), 'summary', 'a post with no date is its kind alone');
    assertEq(format.documentMeta({ createdAt: stamp }), format.day(stamp), 'and one with no kind is the day alone');
    assertEq(format.documentMeta({}), '', 'a document that says neither says nothing at all');
  });

  await test('shortPath names a repo by its last segment', () => {
    assertEq(format.shortPath('/Users/alice/Developer/Repositories/acme/workkit'), 'workkit', 'the leaf');
    assertEq(format.shortPath('/trailing/slash/'), 'slash', 'a trailing slash is not a segment');
    assertEq(format.shortPath(''), '', 'nothing in, nothing out');
  });

  await test('the board’s columns are the pipeline in stage order, the waiting states apart from it', () => {
    assertEq(format.STATUSES.map((s) => s.key).join(','), 'inbox,specced,building,qa,complete,blocked,backlog',
      'the stages in the order the spec defines them, `complete` between the check and the ship (#196)');
    assertEq(format.STATUSES.map((s) => s.label).join(','), 'Inbox,Specced,Building,QA,Complete,Blocked,Backlog',
      'and each column is titled the way a human reads it');
    assertEq(format.STATUSES.length, 7, 'seven lanes - a missing label is not a place an issue lives (#118)');
    assert(!format.STATUSES.some((s) => !s.key), 'so no column stands for the absence of one');
    // The pocket flag is what the Board splits its two regions on (#196), so a
    // status added without one lands in the pipeline by default - which is what
    // a new STAGE is, and a new waiting state has to say otherwise out loud.
    assertEq(format.STATUSES.filter((s) => !s.pocket).map((s) => s.key).join(','), 'inbox,specced,building,qa,complete',
      'the pipeline is the five stages, and they read as a flow');
    assertEq(format.STATUSES.filter((s) => s.pocket).map((s) => s.key).join(','), 'blocked,backlog',
      'and the pockets are the two states of waiting, which are no stage at all');
  });

  await test('every status has a colour, and one the pipeline does not name still has one', () => {
    for (const status of format.STATUSES) {
      assert(format.statusColor(status.key).startsWith('var(--omega-'), `${status.key || 'no status'} resolves to a theme token`);
    }
    assertEq(format.statusToken('nonsense'), '--omega-ink-muted', 'an unknown status is drawn, not dropped');
    assert(format.statusToken('building') !== format.statusToken(''),
      'in-flight work and a status the vocabulary does not name never share a colour');
    // Issue #135: one lane, one colour. A column header, a card chip and a
    // chart slice are all read by hue, so two statuses sharing one would make
    // the board say less than it draws.
    const tokens = format.STATUSES.map((status) => format.statusToken(status.key));
    assertEq(new Set(tokens).size, tokens.length, 'no two statuses are drawn in one colour');
    // Issue #196: the ok green is a VERDICT, so it moved up a rung with the
    // verdict - `complete` is the check passed, and `qa` is now the waiting for
    // it, drawn in the one ramp slot no vocabulary had taken.
    assertEq(format.statusToken('complete'), '--omega-ok', 'complete wears the ok green - the check passed, ready to ship');
    assertEq(format.statusToken('qa'), '--omega-chart-4', 'qa gives that green up for the magenta - waiting on a check is no verdict (#203)');
    assertEq(format.statusToken('specced'), '--omega-chart-3', 'and specced gave it up for the categorical purple before either');
  });

  await test('a priority is drawn from the theme, and the unlabelled middle is neutral', () => {
    assertEq(format.priorityToken('high'), '--omega-danger', 'high takes the theme’s alarm red');
    assertEq(format.priorityToken('low'), '--omega-ink-faint', 'and low the faint end');
    assertEq(format.priorityToken(''), '--omega-ink-muted', 'normal priority is never written on an issue and is drawn neutral');
    assertEq(format.priorityToken('nonsense'), '--omega-ink-muted', 'and so is a priority the vocabulary does not name');
    // Both ends are shared with the status they say the same thing as (#149):
    // a hue is unique inside a vocabulary and free across them, since every
    // chip carries its own word and its own glyph. "High" and "blocked" are
    // both the thing that wants attention; "low" and "backlog" both say the
    // opposite about urgency.
    assertEq(format.priorityToken('high'), format.statusToken('blocked'), 'the loud end is the one the pipeline raises its hand in');
    assertEq(format.priorityToken('low'), format.statusToken('backlog'), 'and the quiet end is the one the pipeline parks in');
    assertEq(new Set([format.priorityToken('high'), format.priorityToken('low')]).size, 2,
      'and the two ends of the one vocabulary are never the same colour');
  });

  await test('a status chip is the colour its Board column header carries', () => {
    for (const status of format.STATUSES) {
      const chip = format.statusChip(status.key);
      assert(chip.includes(`--omega-tone: ${format.statusColor(status.key)}`), `${status.key} is drawn in the column’s own token`);
      assert(chip.includes('omega-badge-tone'), 'through the framework’s tone chip, never a colour of its own');
      assert(chip.includes(`>${status.key}<`), 'labelled with the status itself');
    }
    assertEq(format.statusChip(''), '', 'an issue carrying no status draws no chip');
    assert(!format.statusChip('<img src=x>').includes('<img'), 'a hostile status is escaped');
  });

  // ── The alert that replaced the No-status column (#118) ──────────────────
  //
  // A missing `status:` label is a pipeline fault the daily heal repairs, not a
  // place an issue lives, so it is drawn as an alarm above the board instead of
  // a lane of its own. These are the questions that lane used to answer.

  await test('issues carrying no status label become one danger alert, not a column', () => {
    const markup = format.noStatusAlert([
      { repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'https://github.com/ITW/workkit/issues/4' },
      { repo: 'ITW/workkit', number: 9, title: 'Other thing', status: '', url: 'https://github.com/ITW/workkit/issues/9' },
      { repo: 'ITW/workkit', number: 12, title: 'Fine', status: 'building', url: 'https://github.com/ITW/workkit/issues/12' },
    ]);
    assert(markup.includes('alert-danger'), 'in the theme’s danger tone, which no ordinary board state uses');
    assert(markup.includes('2 issues carry no status label'), 'counting only the ones missing a label');
    assert(markup.includes('href="https://github.com/ITW/workkit/issues/4"'), 'each one a link to its GitHub page');
    assert(markup.includes('href="https://github.com/ITW/workkit/issues/9"'), 'including the one whose label is the empty string');
    assert(!markup.includes('/issues/12'), 'and an issue that carries a status is not in it');
    assert(markup.includes('target="_blank"') && markup.includes('rel="noopener"'), 'opening away from the board, like every other external link');
  });

  await test('the alert says the singular when there is one, and nothing at all when there are none', () => {
    const one = format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, title: 'Alone', url: 'u' }]);
    assert(one.includes('1 issue carries no status label'), 'one issue is not "1 issues"');
    assertEq(format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, status: 'inbox', title: 'Fine', url: 'u' }]), '',
      'a board whose every issue is labelled draws nothing - the normal day');
    assertEq(format.noStatusAlert([]), '', 'and neither does an empty board');
  });

  await test('the alert names the repo only when the board is showing several', () => {
    const issues = [{ repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'u' }];
    const many = format.noStatusAlert(issues, true);
    assert(many.includes('ITW/workkit') && many.includes('#4'), 'a multi-repo board qualifies the issue by repo, as its cards do');
    const one = format.noStatusAlert(issues, false);
    assert(!one.includes('ITW/workkit') && one.includes('#4'), 'and a single-repo board does not repeat what the whole page already says');
  });

  await test('a hostile title in the alert renders as text', () => {
    const markup = format.noStatusAlert([{
      repo: '<img src=x>', number: 4, title: '<script>alert(1)</script>', url: '" onmouseover="x',
    }], true);
    assert(!markup.includes('<script>'), 'the title is escaped');
    assert(!markup.includes('<img'), 'and so is the repo slug');
    assert(!markup.includes('" onmouseover="x"'), 'and a url cannot break out of its attribute');
  });

  await test('the chart series keeps unlabeled issues visible, and only while they exist', () => {
    // #118: the Board surfaces a missing status as its danger alert; a chart
    // that silently dropped those issues would sum short of the open count
    // beside it. Hard-coded expectations either side of the boundary.
    const clean = format.statusBreakdown([
      { status: 'inbox' }, { status: 'building' }, { status: 'building' },
    ]);
    assertEq(clean.labels.join(','), 'Inbox,Specced,Building,QA,Complete,Blocked,Backlog', 'no drift means seven slices, nothing more');
    assertEq(clean.values.join(','), '1,0,2,0,0,0,0', 'each status counts its own');
    assertEq(clean.labels.length, clean.colors.length, 'labels and colors stay in step');
    // The series is the column list's own (#196): the Overview's ring gained the
    // `complete` slice from STATUSES rather than from a list of its own.
    assertEq(clean.labels.length, format.STATUSES.length, 'one slice per lane, and the lanes are format.js’s');

    const drifted = format.statusBreakdown([{ status: 'inbox' }, { status: '' }, {}]);
    assertEq(drifted.labels[drifted.labels.length - 1], 'No status', 'an unlabeled issue is a visible slice');
    assertEq(drifted.values.join(','), '1,0,0,0,0,0,0,2', 'counted, so the ring sums to the open count');
    assertEq(drifted.values.reduce((sum, value) => sum + value, 0), 3, 'nothing dropped');
    assert(drifted.colors[drifted.colors.length - 1] !== format.statusColor('blocked'), 'and its color is no pipeline status’s');
  });

  await test('a priority chip is drawn through the same system, at both ends', () => {
    const high = format.priorityChip('high');
    const low = format.priorityChip('low');
    assert(high.includes('--omega-tone: var(--omega-danger)') && high.includes('>high<'), 'high in the alarm colour');
    assert(low.includes('--omega-tone: var(--omega-ink-faint)') && low.includes('>low<'), 'low in the faint one');
    assert(high.includes('omega-badge-tone') && low.includes('omega-badge-tone'), 'both through the tone chip');
    assertEq(format.priorityChip(''), '', 'the unlabelled middle draws nothing');
    assertEq(format.priorityChip('nonsense'), '', 'and neither does a priority that is not one');
  });

  await test('a column reads in three priority bands, newest first inside each', () => {
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
    assertEq(sorted.map((one) => one.priority || 'normal').join(','), 'high,high,normal,normal,low,low',
      'high above the unlabelled middle, and low below it');
    assertEq(sorted.map((one) => one.updatedAt).join(','), '2026-07-21,2026-07-20,2026-07-29,2026-07-28,2026-07-31,2026-07-30',
      'and the band is broken by the most recently touched');
    assert(format.byPriority(issue('high', '2026-07-01'), issue('low', '2026-07-31')) < 0,
      'a stale high still outranks a fresh low');
    assertEq(format.byPriority(issue(null, ''), issue(null, '')), 0, 'two issues with nothing to sort by tie');
  });

  await test('the Board sorts its columns with the shared comparator, not one of its own', () => {
    // The band arithmetic is pinned above; this pins the PAGE to it. Without
    // this, a silent revert to a date-only sort in board.js leaves every other
    // test green and the issue's headline behavior gone.
    const fs = require('fs');
    const boardPage = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*byPriority[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(boardPage),
      'the comparator comes from format.js');
    assert(boardPage.includes('.sort(byPriority)'), 'and the columns actually sort by it');
  });

  await test('an empty state is an icon above a line, and says which nothing it is', () => {
    const state = format.empty('nothing here');
    assert(state.includes('fa-regular fa-folder-open'), 'the neutral default icon');
    assert(state.includes('aria-hidden="true"'), 'which is decorative - the line carries the meaning');
    assert(state.includes('>nothing here<'), 'and the line itself');
    assert(state.includes('text-body-secondary'), 'drawn in the theme’s quiet ink, never as an alarm');
    const chosen = format.empty('no live sessions', 'fa-regular fa-moon');
    assert(chosen.includes('fa-regular fa-moon') && !chosen.includes('fa-folder-open'), 'the caller’s icon replaces the default');
    assert(!format.empty('<script>x</script>', '"><img src=x>').includes('<script>'), 'a hostile message is escaped');
    assert(!format.empty('nothing', '"><img src=x>').includes('<img'), 'and so is an icon name');
  });

  await test('that icon is centred by a rule of its own, over the line it sits above (#142)', () => {
    // The defect this proves against: the glyph sat LEFT of the line under it,
    // on every empty state the tower draws. `text-center` centres inline
    // content and this icon is not inline - `d-block` is one of Bootstrap's
    // `!important` utilities and beats the framework's
    // `i[data-omega-fa] { display: inline-flex }`, which leaves a BLOCK box one
    // em wide hugging the left edge whatever the text around it is aligned to.
    // Neither half is visible from Node, so both are pinned by hand.
    const fs = require('fs');
    assert(format.empty('nothing here').includes('class="omega-tower-empty '), 'the helper carries the hook the sheet centres from');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const rule = /\.omega-tower-empty i \{ margin-inline: (\S+?); \}/.exec(sheet);
    assert(rule, 'and the sheet centres the icon box - once, for every caller of the helper');
    assertEq(rule[1], 'auto', 'the one way a block box of known width centres itself');
  });

  await test('a model id falls in its family whatever it is decorated with', () => {
    assertEq(format.modelKey('claude-opus-5'), 'opus', 'the plain id');
    assertEq(format.modelKey('claude-opus-5[1m]'), 'opus', 'a context variant is the same model');
    assertEq(format.modelKey('claude-opus-4-1-20250805'), 'opus', 'and so is a dated build');
    assertEq(format.modelKey('claude-3-7-sonnet'), 'sonnet', 'the family is not always last in the id');
    assertEq(format.modelKey('claude-haiku-4-5'), 'haiku', 'haiku');
    assertEq(format.modelKey('fable'), 'fable', 'and the top rung');
    assertEq(format.modelKey('<synthetic>'), 'other', 'a locally generated message belongs to no model');
    assertEq(format.modelKey(null), 'other', 'and an unknown model still has a slot');
  });

  await test('an agent class falls in its own slot, prefixed or not', () => {
    assertEq(format.classKey('worker'), 'worker', 'the bare name the API sends');
    assertEq(format.classKey('workkit:verifier'), 'verifier', 'and the namespaced one');
    assertEq(format.classKey('manager'), 'manager', 'the root tier telemetry counts');
    assertEq(format.classKey('general-purpose'), 'other', 'a built-in agent is drawn neutral, not as crew');
    assertEq(format.classKey(''), 'other', 'and so is no class at all');
  });

  await test('a badge is a chip in its tone, and its label is text', () => {
    const badge = format.modelBadge('claude-opus-5[1m]');
    assert(badge.includes('omega-chip omega-badge-tone omega-tone-2'), 'the theme chip, in the opus tone');
    assert(badge.includes('claude-opus-5[1m]'), 'labelled with the id itself');
    assertEq(format.badgeColor('opus'), 'var(--omega-chart-2)', 'and the chart reads the same tone as a token');
    assert(!format.classBadge('<img src=x>').includes('<img'), 'a hostile class name is escaped');
    assert(format.modelBadge(null).includes('model unknown'), 'an unknown model says so rather than drawing empty');
  });

  await test('every name the tower draws has a tone, and no vocabulary repeats one', () => {
    const models = ['fable', 'opus', 'sonnet', 'haiku'].map((key) => format.badgeColor(key));
    const classes = ['manager', 'advisor', 'worker', 'verifier', 'scout', 'reviewer'].map((key) => format.badgeColor(key));
    assert(models.every((color) => color.startsWith('var(--omega-chart-')), 'a model is drawn from the ramp');
    assert(classes.every((color) => color.startsWith('var(--omega-chart-')), 'and so is a crew class');
    assertEq(new Set(models).size, models.length, 'two models never share a tone');
    assertEq(new Set(classes).size, classes.length, 'and neither do two classes');
    // Ten names over a six-slot ramp: a name with no tone is drawn in the muted
    // ink `.omega-badge-tone` falls back to, never in another name's colour.
    assertEq(format.badgeColor('other'), 'var(--omega-ink-muted)', 'and everything else is neutral');
    assert(!format.classBadge('general-purpose').includes('omega-tone-'), 'which is no tone class at all');
    // Sharing across the vocabularies is forced (ten names, six slots), so the
    // table pins WHO shares: the class chip and the model chip that sit
    // together on a real crew card - the manager ladder's pairings - never
    // match (hooks/manager/ladder.json: manager and advisor run fable, scouts
    // sonnet, workers and verifiers opus; a reviewer inherits the session's
    // model, so it pairs with fable and opus both).
    const pairings = [
      ['manager', 'fable'], ['advisor', 'fable'], ['scout', 'sonnet'],
      ['worker', 'opus'], ['verifier', 'opus'], ['reviewer', 'opus'], ['reviewer', 'fable'],
    ];
    for (const [cls, model] of pairings) {
      assert(format.badgeColor(cls) !== format.badgeColor(model), `${cls} and ${model} appear side by side and must differ`);
    }
  });

  await test('cap shows the head of a list and counts what it held back', () => {
    const five = [1, 2, 3, 4, 5];
    assertEq(format.cap(five).shown.length, 5, 'exactly five fits');
    assertEq(format.cap(five).hidden, 0, 'with nothing behind it');
    assertEq(format.cap([...five, 6, 7]).shown.length, 5, 'a longer list is cut');
    assertEq(format.cap([...five, 6, 7]).hidden, 2, 'and says how many are on the other page');
    assertEq(format.cap([]).hidden, 0, 'an empty list hides nothing');
    assertEq(format.cap(undefined).shown.length, 0, 'and a list that is not there is empty, not a crash');
    assertEq(format.cap(five, 2).shown.length, 2, 'the caller can set the limit');
  });

  await test('a stat cell is a link only when it is given somewhere to go', () => {
    assert(format.statCell('Open', 3).startsWith('<div'), 'a plain tile is a div');
    const linked = format.statCell('Open', 3, '/board');
    assert(linked.startsWith('<a') && linked.includes('href="/board"'), 'and a linked one is an anchor');
  });

  await test('a tile with no reading says a dash and carries why as its tooltip', () => {
    const cell = format.statCell('Live sessions', format.num(null), '/crew', format.LOCAL_ONLY_NOTICE);
    assert(cell.includes('>-</h3>'), 'the value is a dash, never a fabricated 0');
    assert(cell.includes(`title="${format.LOCAL_ONLY_NOTICE}"`), 'and the sentence behind it is one hover away');
    assert(!format.statCell('Open', 3, '/board').includes('title='), 'a tile with a real number needs none');
  });

  await test('a tile wears a sub-line only when there is a comparison to draw', () => {
    // Issue #55: how this number compares with a week ago, under it. A tile
    // with no history behind it keeps exactly the shape it always had.
    const cell = format.statCell('Open issues', 12, '/board', undefined, 'down 3 from last week');
    assert(cell.includes('>down 3 from last week</p>'), 'the comparison is drawn as its own line');
    assert(cell.indexOf('</h3>') < cell.indexOf('down 3'), 'under the number, not beside the label');
    assert(!format.statCell('Open issues', 12, '/board').includes('<p'), 'and a tile with nothing to compare carries no line');
    assert(format.statCell('Open', 1, '', undefined, '<img src=x>').includes('&lt;img'), 'a sub-line is escaped like every other value');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
